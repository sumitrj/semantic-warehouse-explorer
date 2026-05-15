from __future__ import annotations

import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.db import get_session
from backend.api.schemas import (
    SourceIn, SourceOut, DatasetIngestIn, DatasetOut, ColumnInfo,
    FeatureGroupIn, FeatureGroupOut,
)
from backend.repositories import (
    SourceRepository, DatasetRepository, FeatureGroupRepository,
)
from backend.services import source_service

router = APIRouter(prefix="/api", tags=["sources"])


@router.post("/sources", response_model=SourceOut)
def create_source(payload: SourceIn, db: Session = Depends(get_session)):
    try:
        return source_service.register_source(db, payload.name, payload.kind, payload.config)
    except ValueError as e:
        raise HTTPException(409, str(e))


@router.get("/sources", response_model=list[SourceOut])
def list_sources(db: Session = Depends(get_session)):
    return SourceRepository(db).list()


@router.post("/datasets", response_model=DatasetOut)
def ingest(payload: DatasetIngestIn, db: Session = Depends(get_session)):
    try:
        return source_service.ingest_dataset(
            db, payload.source_id, payload.dataset_name, payload.duckdb_table,
        )
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/datasets", response_model=list[DatasetOut])
def list_datasets(db: Session = Depends(get_session)):
    return DatasetRepository(db).list()


@router.get("/datasets/{dataset_id}/schema", response_model=list[ColumnInfo])
def dataset_schema(dataset_id: uuid.UUID, db: Session = Depends(get_session)):
    try:
        return source_service.dataset_schema(db, dataset_id)
    except LookupError as e:
        raise HTTPException(404, str(e))


@router.post("/feature-groups", response_model=FeatureGroupOut)
def create_feature_group(payload: FeatureGroupIn, db: Session = Depends(get_session)):
    return source_service.create_feature_group(
        db, payload.dataset_id, payload.name, payload.columns,
        default_weight=payload.default_weight, description=payload.description,
    )


@router.get("/datasets/{dataset_id}/feature-groups", response_model=list[FeatureGroupOut])
def list_feature_groups(dataset_id: uuid.UUID, db: Session = Depends(get_session)):
    return FeatureGroupRepository(db).for_dataset(dataset_id)
