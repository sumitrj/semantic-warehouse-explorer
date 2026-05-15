"""Preprocessing service.

Applies a Pipeline's steps to a DuckDB table in-memory (pandas) before
feature extraction. Steps run in sequence; each transforms the DataFrame.

Supported ops:
  drop_columns   — remove listed columns
  fillna         — fill NaN (strategy: mean | median | constant)
  log_transform  — log1p on listed numeric columns
  filter_rows    — SQL WHERE clause applied via DuckDB
  clip           — clip values to [min, max]
"""
from __future__ import annotations

import uuid

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from backend.core.duck import duck
from backend.domain import Pipeline
from backend.repositories import PipelineRepository, DatasetRepository


def apply_pipeline(session: Session, pipeline_id: uuid.UUID, df: pd.DataFrame) -> pd.DataFrame:
    """Apply a stored pipeline's steps to a DataFrame. Returns transformed copy."""
    pipeline: Pipeline = PipelineRepository(session).get_or_raise(pipeline_id)
    for step in pipeline.steps:
        df = _apply_step(df, step)
    return df


def _apply_step(df: pd.DataFrame, step: dict) -> pd.DataFrame:
    op = step.get("op", "")
    params = step.get("params", {})

    if op == "drop_columns":
        cols = [c for c in params.get("columns", []) if c in df.columns]
        return df.drop(columns=cols)

    if op == "fillna":
        strategy = params.get("strategy", "mean")
        cols = [c for c in params.get("columns", df.columns.tolist()) if c in df.columns]
        numeric = df[cols].select_dtypes(include=[np.number]).columns.tolist()
        df = df.copy()
        for c in numeric:
            if strategy == "mean":
                df[c] = df[c].fillna(df[c].mean())
            elif strategy == "median":
                df[c] = df[c].fillna(df[c].median())
            elif strategy == "constant":
                df[c] = df[c].fillna(float(params.get("value", 0)))
        return df

    if op == "log_transform":
        cols = [c for c in params.get("columns", []) if c in df.columns]
        df = df.copy()
        for c in cols:
            if pd.api.types.is_numeric_dtype(df[c]):
                df[c] = np.log1p(df[c].clip(lower=0))
        return df

    if op == "clip":
        cols = [c for c in params.get("columns", []) if c in df.columns]
        lo = params.get("min")
        hi = params.get("max")
        df = df.copy()
        for c in cols:
            if pd.api.types.is_numeric_dtype(df[c]):
                df[c] = df[c].clip(lower=lo, upper=hi)
        return df

    # unknown op — pass through unchanged
    return df


def create_pipeline(session: Session, dataset_id: uuid.UUID, name: str, steps: list[dict]) -> Pipeline:
    return PipelineRepository(session).create(dataset_id=dataset_id, name=name, steps=steps)


def update_pipeline(session: Session, pipeline_id: uuid.UUID, steps: list[dict]) -> Pipeline:
    return PipelineRepository(session).update(pipeline_id, steps=steps)


# ─── Step schema catalogue (used by UI) ───────────────────────────────────────

STEP_CATALOGUE = [
    {
        "op": "drop_columns",
        "label": "Drop columns",
        "description": "Remove columns from the dataset before feature extraction.",
        "params": [{"name": "columns", "type": "string[]", "label": "Columns to drop"}],
    },
    {
        "op": "fillna",
        "label": "Fill missing values",
        "description": "Impute NaN values in numeric columns.",
        "params": [
            {"name": "columns", "type": "string[]", "label": "Columns (empty = all numeric)"},
            {"name": "strategy", "type": "enum", "options": ["mean", "median", "constant"], "default": "mean", "label": "Strategy"},
            {"name": "value", "type": "float", "label": "Constant value (if strategy=constant)", "default": 0},
        ],
    },
    {
        "op": "log_transform",
        "label": "Log transform",
        "description": "Apply log1p to skewed numeric columns.",
        "params": [{"name": "columns", "type": "string[]", "label": "Columns to transform"}],
    },
    {
        "op": "clip",
        "label": "Clip values",
        "description": "Clip numeric values to [min, max] range.",
        "params": [
            {"name": "columns", "type": "string[]", "label": "Columns"},
            {"name": "min", "type": "float", "label": "Min", "default": None},
            {"name": "max", "type": "float", "label": "Max", "default": None},
        ],
    },
]
