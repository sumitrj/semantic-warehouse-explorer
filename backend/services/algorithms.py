"""Clustering algorithm registry.

Each algorithm:
  - declares its parameter schema (used to build the UI sliders/selects)
  - implements run(X, params) → (labels, extra_info)
  - is logged as an MLflow model for lineage

Adding a new algorithm: subclass ClusteringAlgorithm, set meta, implement run(),
then add to REGISTRY.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import mlflow
import numpy as np

try:
    from sklearn.cluster import KMeans, DBSCAN, AgglomerativeClustering
    from sklearn.mixture import GaussianMixture
except ImportError:
    pass


@dataclass
class ParamSpec:
    type: str                      # "int" | "float" | "str"
    default: Any
    min: float | None = None
    max: float | None = None
    step: float | None = None
    options: list[str] | None = None
    label: str = ""


@dataclass
class AlgorithmMeta:
    name: str
    display_name: str
    description: str
    params: dict[str, ParamSpec] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "params": {
                k: {
                    "type": v.type,
                    "default": v.default,
                    "min": v.min,
                    "max": v.max,
                    "step": v.step,
                    "options": v.options,
                    "label": v.label or k,
                }
                for k, v in self.params.items()
            },
        }


class ClusteringAlgorithm:
    meta: AlgorithmMeta

    def run(self, X: np.ndarray, params: dict) -> tuple[np.ndarray, dict]:
        """Return (labels array, extra_info dict)."""
        raise NotImplementedError

    def log_model(self, run_id: str, X: np.ndarray, labels: np.ndarray, params: dict) -> None:
        """Log this algorithm instance as an MLflow model."""
        try:
            with mlflow.start_run(run_id=run_id):
                mlflow.log_dict(
                    {"algorithm": self.meta.name, "params": params},
                    "algorithm_config.json",
                )
        except Exception:
            pass


# ─── Implementations ────────────────────────────────────────────────────────


class KMeansAlgorithm(ClusteringAlgorithm):
    meta = AlgorithmMeta(
        name="kmeans",
        display_name="K-Means",
        description="Classic centroid-based clustering. Best for roughly spherical, equal-sized clusters.",
        params={
            "n_clusters": ParamSpec(type="int", default=3, min=2, max=12, step=1, label="Number of clusters"),
        },
    )

    def run(self, X, params):
        n = int(params.get("n_clusters", 3))
        model = KMeans(n_clusters=n, random_state=42, n_init=10)
        labels = model.fit_predict(X)
        return labels, {"inertia": float(model.inertia_)}


class DBSCANAlgorithm(ClusteringAlgorithm):
    meta = AlgorithmMeta(
        name="dbscan",
        display_name="DBSCAN",
        description="Density-based clustering. Discovers clusters of arbitrary shape; marks outliers as -1.",
        params={
            "eps": ParamSpec(type="float", default=0.5, min=0.05, max=5.0, step=0.05, label="Epsilon (radius)"),
            "min_samples": ParamSpec(type="int", default=5, min=1, max=50, step=1, label="Min samples"),
        },
    )

    def run(self, X, params):
        model = DBSCAN(
            eps=float(params.get("eps", 0.5)),
            min_samples=int(params.get("min_samples", 5)),
        )
        labels = model.fit_predict(X)
        n_noise = int((labels == -1).sum())
        return labels, {"n_noise": n_noise}


class AgglomerativeAlgorithm(ClusteringAlgorithm):
    meta = AlgorithmMeta(
        name="agglomerative",
        display_name="Agglomerative",
        description="Hierarchical bottom-up clustering. Good for nested structure discovery.",
        params={
            "n_clusters": ParamSpec(type="int", default=3, min=2, max=12, step=1, label="Number of clusters"),
            "linkage": ParamSpec(
                type="str", default="ward",
                options=["ward", "complete", "average", "single"],
                label="Linkage",
            ),
        },
    )

    def run(self, X, params):
        model = AgglomerativeClustering(
            n_clusters=int(params.get("n_clusters", 3)),
            linkage=str(params.get("linkage", "ward")),
        )
        labels = model.fit_predict(X)
        return labels, {}


class GaussianMixtureAlgorithm(ClusteringAlgorithm):
    meta = AlgorithmMeta(
        name="gmm",
        display_name="Gaussian Mixture",
        description="Soft probabilistic clustering. Good when clusters overlap or have varying density.",
        params={
            "n_components": ParamSpec(type="int", default=3, min=2, max=12, step=1, label="Components"),
            "covariance_type": ParamSpec(
                type="str", default="full",
                options=["full", "tied", "diag", "spherical"],
                label="Covariance type",
            ),
        },
    )

    def run(self, X, params):
        model = GaussianMixture(
            n_components=int(params.get("n_components", 3)),
            covariance_type=str(params.get("covariance_type", "full")),
            random_state=42,
        )
        labels = model.fit_predict(X)
        return labels, {"bic": float(model.bic(X))}


# ─── Registry ────────────────────────────────────────────────────────────────

REGISTRY: dict[str, ClusteringAlgorithm] = {
    "kmeans": KMeansAlgorithm(),
    "dbscan": DBSCANAlgorithm(),
    "agglomerative": AgglomerativeAlgorithm(),
    "gmm": GaussianMixtureAlgorithm(),
}


def get_algorithm(name: str) -> ClusteringAlgorithm:
    if name not in REGISTRY:
        raise ValueError(f"unknown algorithm '{name}'. Available: {list(REGISTRY)}")
    return REGISTRY[name]


def list_algorithms() -> list[dict]:
    return [algo.meta.to_dict() for algo in REGISTRY.values()]
