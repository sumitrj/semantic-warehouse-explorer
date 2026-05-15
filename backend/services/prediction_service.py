"""Prediction service — builds a supervised ML training schema from user selections.

No LLM. Uses EDA ColumnStats (from eda_service) to infer feature encoding
strategies per column semantic type, then packages a TrainingSchema that
downstream pipeline code can execute.

Encoding strategy rules:
  id       → drop (never a feature)
  boolean  → passthrough
  category → onehot (if distinct ≤ 20) else ordinal
  numeric  → standard_scale
  date     → extract (year, month, dayofweek) then drop original
  text     → tfidf (simple bag-of-words)

The resulting TrainingSchema is logged as an MLflow pyfunc model so that
schema definitions are fully reproducible and tracked.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal

import mlflow
import mlflow.pyfunc
import pandas as pd

from backend.core.settings import settings
from backend.services.eda_service import ColumnStats

EncodingStrategy = Literal[
    "passthrough", "standard_scale", "onehot", "ordinal",
    "tfidf", "date_extract", "drop",
]

ModelType = Literal["classification", "regression", "time_series"]


@dataclass
class FeatureSpec:
    column: str
    semantic_type: str
    encoding: EncodingStrategy
    include: bool = True


@dataclass
class TrainingSchema:
    target_table: str
    target_column: str
    target_semantic_type: str
    model_type: ModelType
    features: list[FeatureSpec] = field(default_factory=list)
    train_ratio: float = 0.8
    random_seed: int = 42
    join_path: list[dict] = field(default_factory=list)  # confirmed joins to apply


# ─── Encoding inference ───────────────────────────────────────────────────────

def _infer_encoding(stat: ColumnStats) -> EncodingStrategy:
    st = stat.semantic_type
    if st == "id":
        return "drop"
    if st == "boolean":
        return "passthrough"
    if st == "date":
        return "date_extract"
    if st == "numeric":
        return "standard_scale"
    if st == "category":
        return "onehot" if stat.distinct_count <= 20 else "ordinal"
    if st == "text":
        return "tfidf"
    return "drop"


def build_training_schema(
    target_table: str,
    target_column: str,
    model_type: ModelType,
    column_stats: dict[str, list[ColumnStats]],  # table → stats
    confirmed_joins: list[dict] | None = None,
    train_ratio: float = 0.8,
    user_overrides: dict[str, EncodingStrategy] | None = None,
) -> TrainingSchema:
    """Build a TrainingSchema from EDA stats and user selections.

    column_stats covers all selected tables. confirmed_joins is the list of
    join dicts (with left_table/left_column/right_table/right_column).
    user_overrides: col_name → encoding override from the UI.
    """
    overrides = user_overrides or {}
    target_stat = next(
        (s for s in column_stats.get(target_table, []) if s.column == target_column),
        None,
    )
    target_semantic = target_stat.semantic_type if target_stat else "numeric"

    features: list[FeatureSpec] = []
    for table, stats in column_stats.items():
        for stat in stats:
            if table == target_table and stat.column == target_column:
                continue  # skip target
            encoding = overrides.get(f"{table}.{stat.column}", _infer_encoding(stat))
            features.append(
                FeatureSpec(
                    column=f"{table}.{stat.column}" if len(column_stats) > 1 else stat.column,
                    semantic_type=stat.semantic_type,
                    encoding=encoding,
                    include=(encoding != "drop"),
                )
            )

    return TrainingSchema(
        target_table=target_table,
        target_column=target_column,
        target_semantic_type=target_semantic,
        model_type=model_type,
        features=features,
        train_ratio=train_ratio,
        join_path=confirmed_joins or [],
    )


# ─── MLflow pyfunc model ──────────────────────────────────────────────────────

class _SchemaBuilderPyfunc(mlflow.pyfunc.PythonModel):
    """Pyfunc wrapper for the training schema builder tool."""

    def __init__(self, schema: TrainingSchema):
        self._schema = schema

    def predict(self, context, model_input: pd.DataFrame) -> pd.DataFrame:
        records = []
        for feat in self._schema.features:
            records.append(asdict(feat))
        return pd.DataFrame(records)


def log_schema_run(schema: TrainingSchema) -> str:
    """Log a training schema build to MLflow. Returns run_id."""
    mlflow.set_experiment(settings.mlflow_experiment)
    with mlflow.start_run(
        run_name=f"schema__{schema.target_table}__{schema.target_column}"
    ) as run:
        mlflow.log_param("target_table", schema.target_table)
        mlflow.log_param("target_column", schema.target_column)
        mlflow.log_param("model_type", schema.model_type)
        mlflow.log_param("train_ratio", schema.train_ratio)
        mlflow.log_metric("n_features", len(schema.features))
        mlflow.log_metric("n_included", sum(1 for f in schema.features if f.include))

        mlflow.log_dict(asdict(schema), "training_schema.json")
        mlflow.pyfunc.log_model(
            artifact_path="schema_builder_tool",
            python_model=_SchemaBuilderPyfunc(schema),
        )

        return run.info.run_id
