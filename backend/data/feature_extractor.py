"""Feature extraction.

Given a DuckDB table + a set of FeatureGroups + weights, produce the
numeric matrix that goes into the clustering algorithm.

Categorical columns get one-hot encoded; numeric columns get
standardized; ID-like columns get dropped automatically.
"""
from __future__ import annotations

from dataclasses import dataclass
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

from backend.core.duck import duck


@dataclass
class ExtractionResult:
    matrix: np.ndarray
    column_names: list[str]  # post-encoding column names in matrix order
    source_columns: list[str]  # original column names used
    row_index: pd.Index  # so we can join back to the source rows


def _looks_like_id(col: str, dtype: str) -> bool:
    if col.lower() in {"id", "uuid", "partner_id", "entity_id"}:
        return True
    if col.lower().endswith("_id"):
        return True
    return False


def extract(
    duckdb_table: str,
    feature_groups: list[dict],   # [{name, columns, weight}]
    *,
    sample: int | None = None,
) -> ExtractionResult:
    d = duck()
    schema_df = d.describe(duckdb_table)
    dtype_map = dict(zip(schema_df["column_name"], schema_df["column_type"]))

    # gather all columns referenced across groups
    requested_columns: list[str] = []
    col_to_weight: dict[str, float] = {}
    for g in feature_groups:
        for c in g["columns"]:
            if c not in dtype_map:
                continue
            if c not in requested_columns:
                requested_columns.append(c)
            col_to_weight[c] = g.get("weight", 1.0)

    if not requested_columns:
        raise ValueError("no usable columns found in feature groups")

    col_list = ", ".join(f'"{c}"' for c in requested_columns)
    q = f"SELECT {col_list} FROM {duckdb_table}"
    if sample:
        q += f" USING SAMPLE {sample}"
    df = d.sql(q)

    # drop ID-like columns
    df = df.drop(
        columns=[c for c in df.columns if _looks_like_id(c, str(dtype_map.get(c, "")))],
        errors="ignore",
    )

    # split numeric vs categorical
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    cat_cols = [c for c in df.columns if c not in numeric_cols]

    # numeric: standardize
    if numeric_cols:
        num = pd.DataFrame(
            StandardScaler().fit_transform(df[numeric_cols].fillna(df[numeric_cols].mean(numeric_only=True))),
            columns=numeric_cols,
            index=df.index,
        )
    else:
        num = pd.DataFrame(index=df.index)

    # categorical: one-hot
    if cat_cols:
        cat = pd.get_dummies(df[cat_cols].astype(str).fillna("__missing__"), prefix=cat_cols).astype(float)
    else:
        cat = pd.DataFrame(index=df.index)

    encoded = pd.concat([num, cat], axis=1)

    # apply weights — for one-hot columns inherit weight from the source col
    for col in encoded.columns:
        if col in col_to_weight:
            encoded[col] *= col_to_weight[col]
        else:
            # one-hot expansion: find which original column produced this
            base = col.split("_")[0] if "_" in col else col
            for src in cat_cols:
                if col.startswith(f"{src}_"):
                    encoded[col] *= col_to_weight.get(src, 1.0)
                    break

    return ExtractionResult(
        matrix=encoded.to_numpy(dtype=float),
        column_names=encoded.columns.tolist(),
        source_columns=df.columns.tolist(),
        row_index=df.index,
    )
