"""DuckDB connection wrapper.

DuckDB runs in-process. We hold a single connection to a file-backed
database. Multiple threads in the API can share it (DuckDB serializes
internally). Heavy queries should be moved to a worker if they start
blocking the API.
"""
from __future__ import annotations

import threading
from pathlib import Path

import duckdb
import pandas as pd

from backend.core.settings import settings


class Duck:
    """Lightweight wrapper around a single DuckDB connection."""

    _instance: "Duck | None" = None
    _lock = threading.Lock()

    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = duckdb.connect(str(path))

    @classmethod
    def instance(cls) -> "Duck":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls(Path(settings.duckdb_path))
        return cls._instance

    # ---- generic helpers ----

    def sql(self, query: str, params: list | None = None) -> pd.DataFrame:
        if params:
            return self.conn.execute(query, params).df()
        return self.conn.execute(query).df()

    def execute(self, query: str, params: list | None = None) -> None:
        if params:
            self.conn.execute(query, params)
        else:
            self.conn.execute(query)

    def table_exists(self, name: str) -> bool:
        df = self.sql(
            "SELECT 1 FROM information_schema.tables WHERE table_name = ?",
            [name],
        )
        return not df.empty

    def list_tables(self) -> list[str]:
        df = self.sql(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'main'"
        )
        return df["table_name"].tolist()

    def describe(self, table: str) -> pd.DataFrame:
        """Returns columns with their types. Used for schema introspection."""
        return self.sql(f"DESCRIBE {table}")

    def write_dataframe(self, df: pd.DataFrame, table: str, *, replace: bool = True) -> None:
        if replace:
            self.execute(f"DROP TABLE IF EXISTS {table}")
        self.conn.register("__tmp_write", df)
        self.execute(f"CREATE TABLE {table} AS SELECT * FROM __tmp_write")
        self.conn.unregister("__tmp_write")

    def read_table(self, table: str, *, limit: int | None = None) -> pd.DataFrame:
        q = f"SELECT * FROM {table}"
        if limit:
            q += f" LIMIT {limit}"
        return self.sql(q)


def duck() -> Duck:
    """Convenience accessor."""
    return Duck.instance()
