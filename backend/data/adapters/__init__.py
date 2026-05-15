"""Adapter registry. Add a new source type by registering its class."""
from __future__ import annotations

from backend.data.adapters.base import SourceAdapter
from backend.data.adapters.duckdb_native import DuckDBNativeAdapter
from backend.data.adapters.postgres import PostgresAdapter
from backend.data.adapters.unity_catalog import UnityCatalogAdapter


REGISTRY: dict[str, type[SourceAdapter]] = {
    DuckDBNativeAdapter.kind: DuckDBNativeAdapter,
    PostgresAdapter.kind: PostgresAdapter,
    UnityCatalogAdapter.kind: UnityCatalogAdapter,
}


def make_adapter(kind: str, config: dict) -> SourceAdapter:
    if kind not in REGISTRY:
        raise ValueError(f"unknown source kind: {kind}")
    return REGISTRY[kind](config)
