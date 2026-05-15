"""EDA service — column-level statistical analysis using DuckDB SQL only.

No LLM involvement. Each analysis session is logged as an MLflow pyfunc model
for full lineage. Semantic type detection uses heuristics (name patterns +
cardinality ratios + DuckDB dtype) without any ML.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass, field
from typing import Any

import mlflow
import mlflow.pyfunc
import pandas as pd

from backend.core.duck import duck
from backend.core.settings import settings

# ─── Type sets ───────────────────────────────────────────────────────────────

_NUMERIC = {
    "INTEGER", "BIGINT", "HUGEINT", "SMALLINT", "TINYINT", "UBIGINT",
    "UINTEGER", "USMALLINT", "UTINYINT", "FLOAT", "DOUBLE", "DECIMAL",
    "REAL", "NUMERIC",
}
_DATE = {"DATE", "TIMESTAMP", "TIMESTAMPTZ", "TIME", "INTERVAL"}
_BOOL = {"BOOLEAN", "BOOL"}


# ─── Result dataclass ────────────────────────────────────────────────────────

@dataclass
class ColumnStats:
    column: str
    dtype: str
    semantic_type: str          # id | category | numeric | date | boolean | text
    total_rows: int
    null_count: int
    null_pct: float
    distinct_count: int
    distinct_pct: float
    min_val: float | None = None
    max_val: float | None = None
    mean_val: float | None = None
    std_val: float | None = None
    top_values: list[dict[str, Any]] = field(default_factory=list)


# ─── Semantic type inference ──────────────────────────────────────────────────

def _infer_semantic_type(col: str, dtype: str, total: int, distinct: int) -> str:
    dt = dtype.upper().split("(")[0].strip()

    if dt in _BOOL:
        return "boolean"
    if any(d in dt for d in _DATE):
        return "date"

    ratio = distinct / max(total, 1)
    name = col.lower()
    is_id_name = name == "id" or name.endswith("_id") or name.startswith("id_") or name.endswith("_key")
    is_category_name = any(token in name for token in ("status", "type", "category", "region", "segment", "tier_name"))
    is_text_name = any(token in name for token in ("name", "email", "benefit", "description"))

    if dt in _NUMERIC:
        if is_id_name:
            return "id"
        return "numeric"

    # VARCHAR / TEXT branch
    if is_id_name and ratio > 0.5:
        return "id"
    if is_category_name:
        return "category"
    if is_text_name:
        return "text"
    if distinct <= max(3, min(50, int(total * 0.3))) or ratio <= 0.2:
        return "category"
    return "text"


# ─── Core analysis ───────────────────────────────────────────────────────────

def analyze_table(table: str) -> list[ColumnStats]:
    """Run column-level EDA on a DuckDB table. Returns one ColumnStats per column."""
    db = duck()
    schema_df = db.describe(table)

    total_df = db.sql(f"SELECT COUNT(*) AS cnt FROM \"{table}\"")
    total = int(total_df["cnt"].iloc[0])

    results: list[ColumnStats] = []
    for _, row in schema_df.iterrows():
        col = row["column_name"]
        dtype = str(row["column_type"])

        # Null + distinct in one query
        try:
            counts_df = db.sql(
                f'SELECT COUNT(*) - COUNT("{col}") AS null_count, '
                f'COUNT(DISTINCT "{col}") AS distinct_count FROM "{table}"'
            )
            null_count = int(counts_df["null_count"].iloc[0])
            distinct_count = int(counts_df["distinct_count"].iloc[0])
        except Exception:
            null_count = 0
            distinct_count = 0

        semantic = _infer_semantic_type(col, dtype, total, distinct_count)

        stat = ColumnStats(
            column=col,
            dtype=dtype,
            semantic_type=semantic,
            total_rows=total,
            null_count=null_count,
            null_pct=round(null_count / max(total, 1) * 100, 2),
            distinct_count=distinct_count,
            distinct_pct=round(distinct_count / max(total, 1) * 100, 2),
        )

        dt_base = dtype.upper().split("(")[0].strip()

        # Numeric stats
        if dt_base in _NUMERIC and semantic in ("numeric", "id"):
            try:
                num_df = db.sql(
                    f'SELECT MIN(CAST("{col}" AS DOUBLE)) AS mn, '
                    f'MAX(CAST("{col}" AS DOUBLE)) AS mx, '
                    f'AVG(CAST("{col}" AS DOUBLE)) AS avg_val, '
                    f'STDDEV(CAST("{col}" AS DOUBLE)) AS std_val '
                    f'FROM "{table}"'
                )
                r = num_df.iloc[0]
                stat.min_val = float(r["mn"]) if r["mn"] is not None else None
                stat.max_val = float(r["mx"]) if r["mx"] is not None else None
                stat.mean_val = round(float(r["avg_val"]), 4) if r["avg_val"] is not None else None
                stat.std_val = round(float(r["std_val"]), 4) if r["std_val"] is not None else None
            except Exception:
                pass

        # Top-values for categorical/boolean/low-cardinality numerics
        if semantic in ("category", "boolean") or (semantic == "numeric" and distinct_count <= 30):
            try:
                top_df = db.sql(
                    f'SELECT CAST("{col}" AS VARCHAR) AS val, COUNT(*) AS cnt '
                    f'FROM "{table}" GROUP BY "{col}" ORDER BY cnt DESC LIMIT 10'
                )
                stat.top_values = [
                    {
                        "value": str(r["val"]) if r["val"] is not None else "NULL",
                        "count": int(r["cnt"]),
                        "pct": round(int(r["cnt"]) / max(total, 1) * 100, 1),
                    }
                    for _, r in top_df.iterrows()
                ]
            except Exception:
                stat.top_values = []

        results.append(stat)

    return results


def analyze_multiple_tables(tables: list[str]) -> dict[str, list[ColumnStats]]:
    return {t: analyze_table(t) for t in tables}


# ─── MLflow pyfunc model ──────────────────────────────────────────────────────

class _EDAPyfunc(mlflow.pyfunc.PythonModel):
    """Pyfunc wrapper so EDA is a first-class MLflow artifact with full lineage."""

    def predict(self, context, model_input: pd.DataFrame) -> pd.DataFrame:
        records: list[dict] = []
        for table in model_input["table"].unique():
            for s in analyze_table(str(table)):
                d = asdict(s)
                d["table"] = table
                records.append(d)
        return pd.DataFrame(records)


def log_eda_run(table: str, stats: list[ColumnStats]) -> str:
    """Log an EDA session to MLflow. Returns the MLflow run_id, or '' if MLflow is unavailable."""
    try:
        mlflow.set_experiment(settings.mlflow_experiment)
        with mlflow.start_run(run_name=f"eda__{table}") as run:
            mlflow.log_param("table", table)
            mlflow.log_param("n_columns", len(stats))
            mlflow.log_param("total_rows", stats[0].total_rows if stats else 0)

            type_dist = Counter(s.semantic_type for s in stats)
            for stype, cnt in type_dist.items():
                mlflow.log_metric(f"semantic_type_{stype}", cnt)

            mlflow.log_dict(
                {"table": table, "columns": [asdict(s) for s in stats]},
                "eda_results.json",
            )
            mlflow.pyfunc.log_model(artifact_path="eda_tool", python_model=_EDAPyfunc())

            return run.info.run_id
    except Exception as e:
        print(f"[mlflow] EDA run for '{table}' failed to log: {e}")
        return ""
