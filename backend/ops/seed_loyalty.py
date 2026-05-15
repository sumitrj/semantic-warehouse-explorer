"""Loyalty programme seed — loads CSV data into DuckDB at startup.

Resolution order:
  1. If sample_data/loyalty/*.csv exist → load from files (preserving edits)
  2. Otherwise → generate fresh CSVs into sample_data/loyalty/, then load

Idempotent: skips any table that already has the correct row count.
Emits a structured log dict so the caller can decide how to report.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from backend.core.duck import duck

# Tables and their expected sizes (used for idempotency check)
TABLES = {
    "tiers":        4,
    "merchants":     9,
    "members":      36,
    "transactions": 96,
    "rewards":      24,
}

CSV_DIR = Path(__file__).parents[2] / "sample_data" / "loyalty"


def _load_or_generate() -> dict[str, pd.DataFrame]:
    """Return DataFrames either from CSVs or freshly generated."""
    if CSV_DIR.exists() and all((CSV_DIR / f"{t}.csv").exists() for t in TABLES):
        dfs = {t: pd.read_csv(CSV_DIR / f"{t}.csv") for t in TABLES}
        if all(len(dfs[t]) == expected for t, expected in TABLES.items()):
            return dfs

    # Generate and persist for next run
    from backend.ops.loyalty_data import generate_all, save_csvs
    dfs = generate_all()
    save_csvs(CSV_DIR)
    return dfs


def seed_loyalty() -> dict:
    """Load loyalty tables into DuckDB. Returns a status dict."""
    db = duck()
    results: dict = {}

    try:
        dfs = _load_or_generate()
    except Exception as e:
        return {"error": str(e), "seeded": []}

    seeded: list[str] = []
    skipped: list[str] = []

    for table, expected_rows in TABLES.items():
        df = dfs.get(table)
        if df is None:
            continue

        # Idempotency: skip if table exists with the right size
        if db.table_exists(table):
            actual = int(db.sql(f'SELECT COUNT(*) AS n FROM "{table}"').iloc[0]["n"])
            if actual == expected_rows:
                skipped.append(table)
                continue
            # Wrong row count — re-seed
            db.execute(f'DROP TABLE IF EXISTS "{table}"')

        db.write_dataframe(df, table, replace=True)
        seeded.append(table)

    results["seeded"] = seeded
    results["skipped"] = skipped
    return results
