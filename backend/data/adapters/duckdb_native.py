"""DuckDB-native adapter.

Used for the default mock dataset that's already sitting in DuckDB.
The 'ingest' is a no-op (data is already there); preview just selects.
"""
from __future__ import annotations

from backend.core.duck import duck
from backend.data.adapters.base import SourceAdapter, IngestionResult


class DuckDBNativeAdapter(SourceAdapter):
    kind = "duckdb_native"

    def ingest(self, target_table: str) -> IngestionResult:
        d = duck()
        if not d.table_exists(target_table):
            raise RuntimeError(
                f"DuckDB table '{target_table}' does not exist. "
                "Run the seed job or pick a different source."
            )
        cols_df = d.describe(target_table)
        columns = [
            {"name": r["column_name"], "dtype": r["column_type"]}
            for _, r in cols_df.iterrows()
        ]
        n = int(d.sql(f"SELECT COUNT(*) AS n FROM {target_table}").iloc[0]["n"])
        return IngestionResult(duckdb_table=target_table, row_count=n, columns=columns)

    def preview(self, limit: int = 10) -> list[dict]:
        table = self.config.get("table")
        if not table:
            return []
        df = duck().read_table(table, limit=limit)
        return df.to_dict(orient="records")
