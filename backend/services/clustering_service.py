"""Clustering service.

Orchestration:
1. Pull weighted feature matrix from DuckDB
2. Content-hash the config — cache hit returns existing run
3. Dispatch to algorithm registry (kmeans / dbscan / agglomerative / gmm)
4. PCA(2) for scatter plot projection
5. Log everything to MLflow, persist to Postgres
"""
from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass

import mlflow
import numpy as np
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score
from sqlalchemy.orm import Session

from backend.core.mlflow_client import run as mlrun
from backend.data.feature_extractor import extract
from backend.domain import ClusteringRun, Dataset, FeatureGroup
from backend.repositories import (
    ClusteringRunRepository, DatasetRepository, FeatureGroupRepository,
)
from backend.services.algorithms import get_algorithm, list_algorithms


@dataclass
class RunRequest:
    dataset_id: uuid.UUID
    algorithm: str
    algorithm_params: dict
    feature_weights: dict


def _hash_config(table: str, weights: dict, algo: str, params: dict, feature_groups: list[dict]) -> str:
    payload = json.dumps(
        {"t": table, "w": weights, "a": algo, "p": params, "fg": feature_groups},
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def _build_fg_payload(groups: list[FeatureGroup], weights: dict) -> list[dict]:
    return [
        {"name": g.name, "columns": list(g.columns), "weight": weights.get(g.name, g.default_weight)}
        for g in groups
    ]


def run_clustering(session: Session, req: RunRequest) -> ClusteringRun:
    ds_repo = DatasetRepository(session)
    fg_repo = FeatureGroupRepository(session)
    cr_repo = ClusteringRunRepository(session)

    dataset: Dataset = ds_repo.get_or_raise(req.dataset_id)
    groups = fg_repo.for_dataset(dataset.id)
    if not groups:
        raise ValueError("Dataset has no feature groups. Create at least one first.")

    fg_payload = _build_fg_payload(groups, req.feature_weights)
    config_hash = _hash_config(
        dataset.duckdb_table, req.feature_weights, req.algorithm, req.algorithm_params, fg_payload,
    )
    existing = cr_repo.by_config_hash(config_hash)
    if existing:
        return existing

    extraction = extract(dataset.duckdb_table, fg_payload)
    X = extraction.matrix

    algorithm = get_algorithm(req.algorithm)

    with mlrun(
        "clustering",
        tags={"dataset": dataset.name, "algorithm": req.algorithm},
    ) as parent:
        mlflow_run_id = getattr(parent.info, "run_id", None)

        try:
            mlflow.log_param("dataset", dataset.name)
            mlflow.log_param("algorithm", req.algorithm)
            mlflow.log_params({f"param.{k}": v for k, v in req.algorithm_params.items()})
            mlflow.log_params({f"weight.{k}": v for k, v in req.feature_weights.items()})
            mlflow.log_param("n_rows", X.shape[0])
            mlflow.log_param("n_features", X.shape[1])
        except Exception:
            pass

        labels, extra = algorithm.run(X, req.algorithm_params)

        try:
            mlflow.log_params({f"extra.{k}": v for k, v in extra.items()})
        except Exception:
            pass

        sil = None
        unique_labels = set(labels) - {-1}  # exclude DBSCAN noise
        if len(unique_labels) > 1:
            try:
                valid_mask = labels != -1
                if valid_mask.sum() > 1:
                    sil = float(silhouette_score(
                        X[valid_mask], labels[valid_mask],
                        sample_size=min(1000, valid_mask.sum()), random_state=42,
                    ))
            except Exception:
                sil = None

        pca = PCA(n_components=2, random_state=42)
        coords = pca.fit_transform(X)

        try:
            if sil is not None:
                mlflow.log_metric("silhouette", sil)
            mlflow.log_metric("n_clusters_effective", len(unique_labels))
            mlflow.log_metric("pca_var_ratio", float(pca.explained_variance_ratio_.sum()))
        except Exception:
            pass

        # Log algorithm as MLflow model artifact
        algorithm.log_model(mlflow_run_id or "", X, labels, req.algorithm_params)

        result = {
            "labels": labels.tolist(),
            "coords": coords.tolist(),
            "n_rows": int(X.shape[0]),
            "n_features": int(X.shape[1]),
            "cluster_sizes": {
                int(c): int((labels == c).sum())
                for c in set(labels)
            },
            "feature_columns": extraction.column_names,
            "pca_variance": pca.explained_variance_ratio_.tolist(),
            "extra": extra,
        }

        return cr_repo.create(
            dataset_id=dataset.id,
            config_hash=config_hash,
            algorithm=req.algorithm,
            algorithm_params=req.algorithm_params,
            feature_weights=req.feature_weights,
            n_clusters=int(len(unique_labels)),
            silhouette=sil,
            mlflow_run_id=mlflow_run_id,
            result=result,
        )


def cluster_centroid_profile(
    session: Session,
    clustering_run_id: uuid.UUID,
    cluster_id: int,
) -> dict:
    """Return centroid profile for one cluster — feeds cognitive functions."""
    cr_repo = ClusteringRunRepository(session)
    run = cr_repo.get_or_raise(clustering_run_id)
    dataset = DatasetRepository(session).get_or_raise(run.dataset_id)

    labels = np.array(run.result["labels"])
    fg_repo = FeatureGroupRepository(session)
    groups = fg_repo.for_dataset(dataset.id)
    fg_payload = [{"name": g.name, "columns": list(g.columns), "weight": 1.0} for g in groups]
    base = extract(dataset.duckdb_table, fg_payload)
    X = base.matrix
    cols = base.column_names

    cluster_mask = labels == cluster_id
    if cluster_mask.sum() == 0:
        raise ValueError(f"cluster {cluster_id} not found in run")

    overall_mean = X.mean(axis=0)
    overall_std = X.std(axis=0)
    overall_std[overall_std == 0] = 1.0

    cluster_mean = X[cluster_mask].mean(axis=0)
    z = (cluster_mean - overall_mean) / overall_std

    feats = sorted(
        [{"column": c, "cluster_mean": float(cluster_mean[i]),
          "overall_mean": float(overall_mean[i]), "z_score": float(z[i])}
         for i, c in enumerate(cols)],
        key=lambda f: abs(f["z_score"]),
        reverse=True,
    )

    return {
        "cluster_id": cluster_id,
        "size": int(cluster_mask.sum()),
        "total_population": int(len(labels)),
        "centroid": {c: float(v) for c, v in zip(cols, cluster_mean)},
        "distinguishing_features": feats[:8],
    }
