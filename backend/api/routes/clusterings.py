"""Clustering routes."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.db import get_session
from backend.api.schemas import ClusteringRunIn, ClusteringRunOut
from backend.repositories import ClusteringRunRepository
from backend.services.algorithms import list_algorithms
from backend.services.clustering_service import RunRequest, run_clustering, cluster_centroid_profile

router = APIRouter(prefix="/api", tags=["clustering"])


@router.get("/algorithms")
def algorithms():
    """List available clustering algorithms with their parameter schemas."""
    return list_algorithms()


@router.post("/clusterings", response_model=ClusteringRunOut)
def run(payload: ClusteringRunIn, db: Session = Depends(get_session)):
    try:
        return run_clustering(db, RunRequest(
            dataset_id=payload.dataset_id,
            algorithm=payload.algorithm,
            algorithm_params=payload.algorithm_params,
            feature_weights=payload.feature_weights,
        ))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/clusterings/{run_id}", response_model=ClusteringRunOut)
def get(run_id: uuid.UUID, db: Session = Depends(get_session)):
    obj = ClusteringRunRepository(db).get(run_id)
    if not obj:
        raise HTTPException(404, "run not found")
    return obj


@router.get("/clusterings/{run_id}/clusters/{cluster_id}/profile")
def profile(run_id: uuid.UUID, cluster_id: int, db: Session = Depends(get_session)):
    try:
        return cluster_centroid_profile(db, run_id, cluster_id)
    except (LookupError, ValueError) as e:
        raise HTTPException(404, str(e))


@router.get("/datasets/{dataset_id}/clusterings", response_model=list[ClusteringRunOut])
def for_dataset(dataset_id: uuid.UUID, db: Session = Depends(get_session)):
    return ClusteringRunRepository(db).for_dataset(dataset_id)
