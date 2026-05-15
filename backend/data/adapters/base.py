"""SourceAdapter interface.

Every data-source kind (DuckDB-native, Postgres, Parquet, Unity Catalog)
implements this. The adapter's only job is to land data into a DuckDB
table that the rest of the pipeline can operate on.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class IngestionResult:
    duckdb_table: str
    row_count: int
    columns: list[dict]  # [{name, dtype}]


class SourceAdapter(ABC):
    """Contract: given a source config, ingest into DuckDB and return metadata."""

    kind: str = "base"

    def __init__(self, config: dict):
        self.config = config

    @abstractmethod
    def ingest(self, target_table: str) -> IngestionResult:
        """Land source data into the given DuckDB table name."""
        ...

    @abstractmethod
    def preview(self, limit: int = 10) -> list[dict]:
        """Return a small sample for the UI without doing a full ingest."""
        ...
