"""Unity Catalog adapter — stub for now.

The real implementation would use the databricks SDK to enumerate
catalogs/schemas/tables and read via the Delta Sharing protocol or
JDBC. For the skeleton we just raise NotImplementedError so the
abstraction is in place.
"""
from __future__ import annotations

from backend.data.adapters.base import SourceAdapter, IngestionResult


class UnityCatalogAdapter(SourceAdapter):
    kind = "unity_catalog"

    def ingest(self, target_table: str) -> IngestionResult:
        raise NotImplementedError(
            "Unity Catalog adapter is a stub. Plug in databricks-sdk + "
            "delta-sharing here."
        )

    def preview(self, limit: int = 10) -> list[dict]:
        raise NotImplementedError
