"""Source and Dataset orchestration."""
from __future__ import annotations

import hashlib
import uuid

from sqlalchemy.orm import Session

from backend.core.duck import duck
from backend.data.adapters import make_adapter
from backend.domain import Source, Dataset, SourceKind
from backend.repositories import (
    SourceRepository, DatasetRepository, FeatureGroupRepository,
)


def register_source(
    session: Session, name: str, kind: str, config: dict,
) -> Source:
    repo = SourceRepository(session)
    if repo.by_name(name):
        raise ValueError(f"source '{name}' already exists")
    return repo.create(name=name, kind=kind, config=config)


def ingest_dataset(
    session: Session,
    source_id: uuid.UUID,
    dataset_name: str,
    duckdb_table: str,
) -> Dataset:
    source = SourceRepository(session).get_or_raise(source_id)
    adapter = make_adapter(source.kind, source.config)
    result = adapter.ingest(duckdb_table)

    schema_repr = ",".join(f"{c['name']}:{c['dtype']}" for c in result.columns)
    schema_hash = hashlib.sha256(schema_repr.encode()).hexdigest()[:16]

    ds_repo = DatasetRepository(session)
    existing = ds_repo.by_name(dataset_name)
    if existing:
        return ds_repo.update(
            existing.id,
            duckdb_table=result.duckdb_table,
            row_count=result.row_count,
            schema_hash=schema_hash,
        )
    return ds_repo.create(
        source_id=source.id,
        name=dataset_name,
        duckdb_table=result.duckdb_table,
        row_count=result.row_count,
        schema_hash=schema_hash,
    )


def dataset_schema(session: Session, dataset_id: uuid.UUID) -> list[dict]:
    """Live schema from DuckDB."""
    dataset = DatasetRepository(session).get_or_raise(dataset_id)
    df = duck().describe(dataset.duckdb_table)
    return [
        {"name": r["column_name"], "dtype": r["column_type"]}
        for _, r in df.iterrows()
    ]


def create_feature_group(
    session: Session,
    dataset_id: uuid.UUID,
    name: str,
    columns: list[str],
    *,
    default_weight: float = 1.0,
    description: str | None = None,
):
    return FeatureGroupRepository(session).create(
        dataset_id=dataset_id,
        name=name,
        columns=columns,
        default_weight=default_weight,
        description=description,
    )
