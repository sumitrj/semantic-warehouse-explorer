"""Postgres domain models — one file for the skeleton.

Relationships are deliberately loose: we model configuration and lifecycle,
not the actual analytical data (that lives in DuckDB).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import String, Integer, Float, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.core.db import Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _now() -> datetime:
    return datetime.utcnow()


# ─── Source / Dataset ─────────────────────────────────────────────────────────

class SourceKind(str, Enum):
    duckdb_native = "duckdb_native"
    postgres = "postgres"
    parquet = "parquet"
    unity_catalog = "unity_catalog"


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    kind: Mapped[str] = mapped_column(String(50))
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    datasets: Mapped[list["Dataset"]] = relationship(back_populates="source", cascade="all, delete-orphan")


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sources.id"))
    name: Mapped[str] = mapped_column(String(200), unique=True)
    duckdb_table: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    schema_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    source: Mapped[Source] = relationship(back_populates="datasets")
    feature_groups: Mapped[list["FeatureGroup"]] = relationship(
        back_populates="dataset", cascade="all, delete-orphan",
    )
    pipelines: Mapped[list["Pipeline"]] = relationship(
        back_populates="dataset", cascade="all, delete-orphan",
    )


# ─── Feature Groups & Preprocessing ──────────────────────────────────────────

class FeatureGroup(Base):
    """User-defined grouping of columns within a Dataset.

    The weight slider in the UI acts on these groups — the tool is
    domain-agnostic because users name their own groups.
    """
    __tablename__ = "feature_groups"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    dataset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("datasets.id"))
    name: Mapped[str] = mapped_column(String(100))
    columns: Mapped[list[str]] = mapped_column(JSONB, default=list)
    default_weight: Mapped[float] = mapped_column(Float, default=1.0)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    dataset: Mapped[Dataset] = relationship(back_populates="feature_groups")


class Pipeline(Base):
    """Named preprocessing pipeline — steps are {op, params} JSON entries."""
    __tablename__ = "pipelines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    dataset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("datasets.id"))
    name: Mapped[str] = mapped_column(String(200))
    steps: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    dataset: Mapped[Dataset] = relationship(back_populates="pipelines")


# ─── Clustering ───────────────────────────────────────────────────────────────

class ClusteringRun(Base):
    """Immutable record of one clustering execution.

    config_hash provides content-addressable caching: same inputs → same hash
    → skip re-computation. mlflow_run_id ties to detailed run lineage.
    """
    __tablename__ = "clustering_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    dataset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("datasets.id"))
    pipeline_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("pipelines.id"), nullable=True)
    config_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    algorithm: Mapped[str] = mapped_column(String(50))
    algorithm_params: Mapped[dict] = mapped_column(JSONB, default=dict)
    feature_weights: Mapped[dict] = mapped_column(JSONB, default=dict)
    n_clusters: Mapped[int | None] = mapped_column(Integer, nullable=True)
    silhouette: Mapped[float | None] = mapped_column(Float, nullable=True)
    mlflow_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class PinnedClustering(Base):
    """A clustering run promoted to production status."""
    __tablename__ = "pinned_clusterings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    clustering_run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clustering_runs.id"))
    name: Mapped[str] = mapped_column(String(200))
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="candidate")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ─── Interpretation ───────────────────────────────────────────────────────────

class Interpretation(Base):
    """Cached structured LLM interpretation of a cluster.

    Keyed by (clustering_run_id, cluster_id). The streaming narrative is
    ephemeral (SSE only); this table stores the structured JSON result.
    """
    __tablename__ = "interpretations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    clustering_run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clustering_runs.id"))
    cluster_id: Mapped[int] = mapped_column(Integer)
    headline: Mapped[str] = mapped_column(String(500))
    characteristics: Mapped[list[str]] = mapped_column(JSONB, default=list)
    confidence: Mapped[str] = mapped_column(String(20), default="medium")
    model_used: Mapped[str] = mapped_column(String(200))
    prompt_version: Mapped[str] = mapped_column(String(50))
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ─── Actions ──────────────────────────────────────────────────────────────────

class Action(Base):
    """An action template in the action catalog.

    trigger_rule is a JSON predicate: {feature, op, threshold} triples
    that the rule engine uses to auto-match clusters without LLM involvement.
    The LLM recommendation path ignores trigger_rule and reasons from the
    cluster profile directly.
    """
    __tablename__ = "actions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    grain: Mapped[str] = mapped_column(String(20), default="cluster")  # cluster | entity
    trigger_rule: Mapped[dict] = mapped_column(JSONB, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ─── Recommendations ──────────────────────────────────────────────────────────

class Recommendation(Base):
    """Cached LLM recommendation — cluster-grain or entity-grain.

    entity_id is NULL for cluster-grain recommendations.
    text is the raw narrative from the streaming LLM call, cached after
    the stream completes.
    """
    __tablename__ = "recommendations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    clustering_run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clustering_runs.id"))
    cluster_id: Mapped[int] = mapped_column(Integer)
    entity_id: Mapped[str | None] = mapped_column(String(200), nullable=True)  # NULL = cluster-grain
    grain: Mapped[str] = mapped_column(String(20), default="cluster")
    text: Mapped[str] = mapped_column(Text)
    model_used: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ─── Configuration Wizard ─────────────────────────────────────────────────────

class TableSelection(Base):
    """Which DuckDB tables the user has chosen to work with for a given source."""
    __tablename__ = "table_selections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sources.id"))
    table_name: Mapped[str] = mapped_column(String(200))
    selected: Mapped[bool] = mapped_column(Boolean, default=True)
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    col_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class ColumnAnnotation(Base):
    """EDA results + optional user overrides for a single column in a table.

    Populated by the EDA service (no LLM). The user_semantic_type field lets
    the user correct the auto-detected semantic_type in the wizard UI.
    """
    __tablename__ = "column_annotations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sources.id"))
    table_name: Mapped[str] = mapped_column(String(200))
    column_name: Mapped[str] = mapped_column(String(200))
    dtype: Mapped[str] = mapped_column(String(100))
    semantic_type: Mapped[str] = mapped_column(String(50))       # auto-detected
    user_semantic_type: Mapped[str | None] = mapped_column(String(50), nullable=True)  # override
    null_pct: Mapped[float] = mapped_column(Float, default=0.0)
    distinct_count: Mapped[int] = mapped_column(Integer, default=0)
    distinct_pct: Mapped[float] = mapped_column(Float, default=0.0)
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    stats: Mapped[dict] = mapped_column(JSONB, default=dict)    # min,max,mean,std,top_values
    mlflow_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class JoinSuggestion(Base):
    """A proposed join between two columns across tables, discovered without LLM.

    Confidence is a [0,1] score from name + overlap + subset heuristics.
    status transitions: pending → confirmed | rejected.
    """
    __tablename__ = "join_suggestions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sources.id"))
    left_table: Mapped[str] = mapped_column(String(200))
    left_column: Mapped[str] = mapped_column(String(200))
    right_table: Mapped[str] = mapped_column(String(200))
    right_column: Mapped[str] = mapped_column(String(200))
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    join_type: Mapped[str] = mapped_column(String(30), default="natural")  # fk | natural | overlap
    status: Mapped[str] = mapped_column(String(20), default="pending")     # pending | confirmed | rejected
    mlflow_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class TableSpace(Base):
    """A named, persisted scope that groups related DuckDB tables.

    All configuration (EDA, join discovery, ML config) and analysis
    (clustering, exploration) operates within a space. Users can maintain
    multiple independent spaces for different analytical contexts.

    primary_table: the entity table used for clustering / entity-level analysis.
    description:   auto-generated semantic markdown — ready for LLM consumption.
    is_default:    one space per source may be the default selection on load.
    """
    __tablename__ = "table_spaces"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), unique=True)          # slug, e.g. "sample_loyalty"
    display_name: Mapped[str] = mapped_column(String(300))
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sources.id"))
    tables: Mapped[list[str]] = mapped_column(JSONB, default=list)       # selected table names
    primary_table: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True) # LLM-ready markdown
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    source: Mapped["Source"] = relationship("Source")


class MLConfig(Base):
    """User's ML tool configuration for a source.

    mode: exploration (clustering) or prediction (supervised ML).
    exploration_config: algorithm + params (mirrors ClusteringRunIn).
    prediction_config: target + features + encoding + model type.
    """
    __tablename__ = "ml_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sources.id"))
    mode: Mapped[str] = mapped_column(String(20), default="exploration")  # exploration | prediction
    exploration_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    prediction_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    mlflow_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
