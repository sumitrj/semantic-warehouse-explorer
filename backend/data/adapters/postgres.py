"""External Postgres adapter.

Reads from a user-specified Postgres database, materializes the
table/query into DuckDB so the rest of the pipeline can treat it
uniformly. DuckDB has a postgres_scanner extension; we use it.
"""
from __future__ import annotations

from backend.core.duck import duck
from backend.data.adapters.base import SourceAdapter, IngestionResult


class PostgresAdapter(SourceAdapter):
    kind = "postgres"

    def _attach(self) -> str:
        """Attach the external Postgres as a DuckDB schema. Returns the alias."""
        d = duck()
        alias = self.config.get("alias", "ext_pg")
        dsn = self.config["dsn"]  # e.g. host=... port=... dbname=... user=... password=...
        d.execute("INSTALL postgres; LOAD postgres;")
        # ATTACH is idempotent-safe with IF NOT EXISTS only on newer DuckDB; guard.
        try:
            d.execute(f"ATTACH '{dsn}' AS {alias} (TYPE POSTGRES, READ_ONLY);")
        except Exception:
            pass  # already attached
        return alias

    def ingest(self, target_table: str) -> IngestionResult:
        d = duck()
        alias = self._attach()
        src = self.config.get("query") or f"SELECT * FROM {alias}.{self.config['table']}"
        d.execute(f"DROP TABLE IF EXISTS {target_table}")
        d.execute(f"CREATE TABLE {target_table} AS {src}")

        cols_df = d.describe(target_table)
        columns = [
            {"name": r["column_name"], "dtype": r["column_type"]}
            for _, r in cols_df.iterrows()
        ]
        n = int(d.sql(f"SELECT COUNT(*) AS n FROM {target_table}").iloc[0]["n"])
        return IngestionResult(duckdb_table=target_table, row_count=n, columns=columns)

    def preview(self, limit: int = 10) -> list[dict]:
        d = duck()
        alias = self._attach()
        src = self.config.get("query") or f"SELECT * FROM {alias}.{self.config['table']}"
        df = d.sql(f"SELECT * FROM ({src}) LIMIT {limit}")
        return df.to_dict(orient="records")
