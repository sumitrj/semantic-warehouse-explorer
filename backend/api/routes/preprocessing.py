"""Preprocessing pipeline routes."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.db import get_session
from backend.api.schemas import PipelineIn, PipelineUpdateIn, PipelineOut
from backend.repositories import PipelineRepository
from backend.services.preprocessing_service import (
    create_pipeline, update_pipeline, STEP_CATALOGUE,
)

router = APIRouter(prefix="/api", tags=["preprocessing"])


@router.get("/preprocessing/steps")
def step_catalogue():
    """Return the catalogue of available preprocessing step types."""
    return STEP_CATALOGUE


@router.post("/pipelines", response_model=PipelineOut)
def create(payload: PipelineIn, db: Session = Depends(get_session)):
    return create_pipeline(db, payload.dataset_id, payload.name, payload.steps)


@router.get("/datasets/{dataset_id}/pipelines", response_model=list[PipelineOut])
def list_pipelines(dataset_id: uuid.UUID, db: Session = Depends(get_session)):
    return PipelineRepository(db).for_dataset(dataset_id)


@router.get("/pipelines/{pipeline_id}", response_model=PipelineOut)
def get(pipeline_id: uuid.UUID, db: Session = Depends(get_session)):
    obj = PipelineRepository(db).get(pipeline_id)
    if not obj:
        raise HTTPException(404, "pipeline not found")
    return obj


@router.patch("/pipelines/{pipeline_id}", response_model=PipelineOut)
def update(pipeline_id: uuid.UUID, payload: PipelineUpdateIn, db: Session = Depends(get_session)):
    if not PipelineRepository(db).get(pipeline_id):
        raise HTTPException(404, "pipeline not found")
    return update_pipeline(db, pipeline_id, payload.steps)


@router.delete("/pipelines/{pipeline_id}", status_code=204)
def delete(pipeline_id: uuid.UUID, db: Session = Depends(get_session)):
    PipelineRepository(db).delete(pipeline_id)
