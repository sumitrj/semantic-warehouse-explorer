"""Join discovery service — finds FK and natural joins between tables.

No LLM. Three scoring signals combined into a confidence score:

  name_score:    exact column-name match = 1.0
                 one is the other + '_id' suffix = 0.85
                 both end in '_id' and share a stem = 0.7
                 no match = 0.0

  subset_score:  fraction of left column values that appear in right column
                 (directional FK check). We take max(L⊆R, R⊆L).

  overlap_score: |L ∩ R| / min(|distinct_L|, |distinct_R|)

  confidence = 0.35 * name_score + 0.40 * subset_score + 0.25 * overlap_score

Only column pairs with compatible base types are compared. Pairs where both
tables are the same are skipped.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from itertools import combinations

import mlflow
import mlflow.pyfunc
import pandas as pd

from backend.core.duck import duck
from backend.core.settings import settings

_NUMERIC_BASES = {
    "INTEGER", "BIGINT", "HUGEINT", "SMALLINT", "TINYINT", "UBIGINT",
    "UINTEGER", "USMALLINT", "UTINYINT", "FLOAT", "DOUBLE", "DECIMAL",
    "REAL", "NUMERIC",
}


@dataclass
class JoinCandidate:
    left_table: str
    left_column: str
    right_table: str
    right_column: str
    confidence: float
    join_type: str   # fk | natural | overlap


def _base_type(dtype: str) -> str:
    return dtype.upper().split("(")[0].strip()


def _types_compatible(dt1: str, dt2: str) -> bool:
    b1, b2 = _base_type(dt1), _base_type(dt2)
    if b1 == b2:
        return True
    if b1 in _NUMERIC_BASES and b2 in _NUMERIC_BASES:
        return True
    return False


def _name_score(c1: str, c2: str) -> float:
    a, b = c1.lower(), c2.lower()
    if a == b:
        return 1.0
    # one is suffix of the other e.g. 'user_id' vs 'id'
    if a == b + "_id" or b == a + "_id":
        return 0.85
    # shared stem: both end in _id and the stem matches
    if a.endswith("_id") and b.endswith("_id"):
        stem_a = a[:-3]  # strip _id
        stem_b = b[:-3]
        if stem_a == stem_b:
            return 0.9
        # partial stem match
        if stem_a in stem_b or stem_b in stem_a:
            return 0.6
    return 0.0


def _overlap_and_subset(table1: str, col1: str, table2: str, col2: str) -> tuple[float, float, str]:
    """Return (overlap_score, subset_score, join_type).

    Uses DuckDB SQL only. Returns (0, 0, 'overlap') on any error.
    """
    db = duck()
    try:
        dist_df = db.sql(
            f'SELECT '
            f'(SELECT COUNT(DISTINCT "{col1}") FROM "{table1}") AS d1, '
            f'(SELECT COUNT(DISTINCT "{col2}") FROM "{table2}") AS d2'
        )
        d1 = int(dist_df["d1"].iloc[0])
        d2 = int(dist_df["d2"].iloc[0])
        if d1 == 0 or d2 == 0:
            return 0.0, 0.0, "overlap"

        # Intersection size
        inter_df = db.sql(
            f'SELECT COUNT(*) AS cnt FROM ('
            f'  SELECT DISTINCT CAST("{col1}" AS VARCHAR) AS v FROM "{table1}" WHERE "{col1}" IS NOT NULL'
            f'  INTERSECT'
            f'  SELECT DISTINCT CAST("{col2}" AS VARCHAR) AS v FROM "{table2}" WHERE "{col2}" IS NOT NULL'
            f')'
        )
        inter = int(inter_df["cnt"].iloc[0])
        overlap = inter / min(d1, d2)

        # Subset check: is left ⊆ right?
        l_not_in_r_df = db.sql(
            f'SELECT COUNT(DISTINCT CAST("{col1}" AS VARCHAR)) AS cnt FROM "{table1}" '
            f'WHERE "{col1}" IS NOT NULL '
            f'AND CAST("{col1}" AS VARCHAR) NOT IN ('
            f'  SELECT DISTINCT CAST("{col2}" AS VARCHAR) FROM "{table2}" WHERE "{col2}" IS NOT NULL'
            f')'
        )
        l_not_in_r = int(l_not_in_r_df["cnt"].iloc[0])
        subset_l = 1.0 - (l_not_in_r / max(d1, 1))

        # Is right ⊆ left?
        r_not_in_l_df = db.sql(
            f'SELECT COUNT(DISTINCT CAST("{col2}" AS VARCHAR)) AS cnt FROM "{table2}" '
            f'WHERE "{col2}" IS NOT NULL '
            f'AND CAST("{col2}" AS VARCHAR) NOT IN ('
            f'  SELECT DISTINCT CAST("{col1}" AS VARCHAR) FROM "{table1}" WHERE "{col1}" IS NOT NULL'
            f')'
        )
        r_not_in_l = int(r_not_in_l_df["cnt"].iloc[0])
        subset_r = 1.0 - (r_not_in_l / max(d2, 1))

        subset = max(subset_l, subset_r)

        # Classify join type
        if subset >= 0.9:
            jtype = "fk"
        elif overlap >= 0.6:
            jtype = "natural"
        else:
            jtype = "overlap"

        return round(overlap, 3), round(subset, 3), jtype
    except Exception:
        return 0.0, 0.0, "overlap"


def discover_joins(tables: list[str], threshold: float = 0.30) -> list[JoinCandidate]:
    """Discover join candidates across a list of DuckDB tables.

    Examines all inter-table column pairs with compatible types.
    Returns candidates sorted by confidence descending.
    """
    db = duck()
    schemas: dict[str, dict[str, str]] = {}  # table → {col: dtype}
    for table in tables:
        try:
            df = db.describe(table)
            schemas[table] = {
                row["column_name"]: row["column_type"]
                for _, row in df.iterrows()
            }
        except Exception:
            schemas[table] = {}

    candidates: list[JoinCandidate] = []

    for t1, t2 in combinations(tables, 2):
        cols1 = schemas.get(t1, {})
        cols2 = schemas.get(t2, {})

        for c1, dtype1 in cols1.items():
            for c2, dtype2 in cols2.items():
                if not _types_compatible(dtype1, dtype2):
                    continue

                ns = _name_score(c1, c2)
                # Skip expensive SQL if no name signal at all
                if ns == 0.0:
                    continue

                overlap, subset, jtype = _overlap_and_subset(t1, c1, t2, c2)
                confidence = round(0.35 * ns + 0.40 * subset + 0.25 * overlap, 3)

                if confidence >= threshold:
                    candidates.append(
                        JoinCandidate(
                            left_table=t1,
                            left_column=c1,
                            right_table=t2,
                            right_column=c2,
                            confidence=confidence,
                            join_type=jtype,
                        )
                    )

    candidates.sort(key=lambda c: c.confidence, reverse=True)
    return candidates


# ─── MLflow pyfunc model ──────────────────────────────────────────────────────

class _JoinDiscoveryPyfunc(mlflow.pyfunc.PythonModel):
    """Pyfunc wrapper for the join discovery tool."""

    def predict(self, context, model_input: pd.DataFrame) -> pd.DataFrame:
        tables = model_input["table"].unique().tolist()
        candidates = discover_joins(tables)
        return pd.DataFrame([asdict(c) for c in candidates])


def log_join_discovery_run(tables: list[str], candidates: list[JoinCandidate]) -> str:
    """Log a join-discovery session to MLflow. Returns run_id."""
    mlflow.set_experiment(settings.mlflow_experiment)
    with mlflow.start_run(run_name=f"joins__{'+'.join(tables[:3])}") as run:
        mlflow.log_param("tables", ",".join(tables))
        mlflow.log_param("n_tables", len(tables))
        mlflow.log_metric("n_candidates", len(candidates))
        mlflow.log_metric("n_fk", sum(1 for c in candidates if c.join_type == "fk"))
        mlflow.log_metric("n_natural", sum(1 for c in candidates if c.join_type == "natural"))

        mlflow.log_dict(
            {"tables": tables, "candidates": [asdict(c) for c in candidates]},
            "join_candidates.json",
        )
        mlflow.pyfunc.log_model(
            artifact_path="join_discovery_tool",
            python_model=_JoinDiscoveryPyfunc(),
        )

        return run.info.run_id
