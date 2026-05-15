"""Pydantic wire schemas — separate from domain models."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class _Base(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ─── Sources / Datasets ───────────────────────────────────────────────────────

class SourceIn(BaseModel):
    name: str
    kind: Literal["duckdb_native", "postgres", "parquet", "unity_catalog"]
    config: dict = {}


class SourceOut(_Base):
    id: uuid.UUID
    name: str
    kind: str
    config: dict
    created_at: datetime


class DatasetIngestIn(BaseModel):
    source_id: uuid.UUID
    dataset_name: str
    duckdb_table: str


class DatasetOut(_Base):
    id: uuid.UUID
    source_id: uuid.UUID
    name: str
    duckdb_table: str
    row_count: int | None
    description: str | None
    created_at: datetime


class ColumnInfo(BaseModel):
    name: str
    dtype: str


# ─── Feature Groups ───────────────────────────────────────────────────────────

class FeatureGroupIn(BaseModel):
    dataset_id: uuid.UUID
    name: str
    columns: list[str]
    default_weight: float = 1.0
    description: str | None = None


class FeatureGroupOut(_Base):
    id: uuid.UUID
    dataset_id: uuid.UUID
    name: str
    columns: list[str]
    default_weight: float
    description: str | None


# ─── Pipelines / Preprocessing ────────────────────────────────────────────────

class PipelineIn(BaseModel):
    dataset_id: uuid.UUID
    name: str
    steps: list[dict[str, Any]] = []


class PipelineUpdateIn(BaseModel):
    steps: list[dict[str, Any]]


class PipelineOut(_Base):
    id: uuid.UUID
    dataset_id: uuid.UUID
    name: str
    steps: list[dict]
    created_at: datetime


# ─── Clustering ───────────────────────────────────────────────────────────────

class ClusteringRunIn(BaseModel):
    dataset_id: uuid.UUID
    algorithm: str = "kmeans"
    algorithm_params: dict[str, Any] = {"n_clusters": 7}
    feature_weights: dict[str, float] = {}


class ClusteringRunOut(_Base):
    id: uuid.UUID
    dataset_id: uuid.UUID
    config_hash: str
    algorithm: str
    algorithm_params: dict
    feature_weights: dict
    n_clusters: int | None
    silhouette: float | None
    mlflow_run_id: str | None
    result: dict
    created_at: datetime


# ─── Interpretations ──────────────────────────────────────────────────────────

class InterpretationOut(_Base):
    id: uuid.UUID
    clustering_run_id: uuid.UUID
    cluster_id: int
    headline: str
    characteristics: list[str]
    confidence: str
    model_used: str
    prompt_version: str
    created_at: datetime


# ─── Actions ──────────────────────────────────────────────────────────────────

class ActionIn(BaseModel):
    name: str
    description: str | None = None
    grain: Literal["cluster", "entity"] = "cluster"
    trigger_rule: dict = {}
    enabled: bool = True


class ActionOut(_Base):
    id: uuid.UUID
    name: str
    description: str | None
    grain: str
    trigger_rule: dict
    enabled: bool
    created_at: datetime


# ─── Recommendations ──────────────────────────────────────────────────────────

class RecommendationOut(_Base):
    id: uuid.UUID
    clustering_run_id: uuid.UUID
    cluster_id: int
    entity_id: str | None
    grain: str
    text: str
    model_used: str
    created_at: datetime
