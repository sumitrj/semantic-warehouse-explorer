"""Recommendation routes — cluster-grain and entity-grain, both SSE streaming."""
from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.core.db import get_session
from backend.api.schemas import RecommendationOut
from backend.repositories import RecommendationRepository
from backend.services.recommendation_service import (
    stream_cluster_recommendation,
    stream_entity_recommendation,
)

router = APIRouter(prefix="/api", tags=["recommendations"])


@router.post("/clusterings/{run_id}/clusters/{cluster_id}/recommend/stream")
def cluster_recommend_stream(
    run_id: uuid.UUID,
    cluster_id: int,
    refresh: bool = False,
    db: Session = Depends(get_session),
):
    """SSE stream of cluster-level recommendation narrative."""
    def generate():
        try:
            for token in stream_cluster_recommendation(db, run_id, cluster_id, refresh=refresh):
                yield f"data: {json.dumps({'token': token})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/clusterings/{run_id}/clusters/{cluster_id}/entities/{entity_id}/recommend/stream")
def entity_recommend_stream(
    run_id: uuid.UUID,
    cluster_id: int,
    entity_id: str,
    refresh: bool = False,
    db: Session = Depends(get_session),
):
    """SSE stream of entity-level personalized recommendation."""
    def generate():
        try:
            for token in stream_entity_recommendation(
                db, run_id, cluster_id, entity_id, refresh=refresh,
            ):
                yield f"data: {json.dumps({'token': token})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get(
    "/clusterings/{run_id}/recommendations",
    response_model=list[RecommendationOut],
)
def list_for_run(run_id: uuid.UUID, db: Session = Depends(get_session)):
    return RecommendationRepository(db).for_run(run_id)


@router.get(
    "/clusterings/{run_id}/clusters/{cluster_id}/recommendation",
    response_model=RecommendationOut | None,
)
def get_cluster_rec(run_id: uuid.UUID, cluster_id: int, db: Session = Depends(get_session)):
    return RecommendationRepository(db).for_cluster(run_id, cluster_id)
