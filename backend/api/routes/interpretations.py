"""Interpretation routes — structured (cached) and streaming (SSE)."""
from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.core.db import get_session
from backend.api.schemas import InterpretationOut
from backend.repositories import InterpretationRepository
from backend.services.interpretation_service import cluster_payload, interpret_cluster
from backend.ai.functions import describe_cluster_stream

router = APIRouter(prefix="/api", tags=["interpretations"])


@router.post(
    "/clusterings/{run_id}/clusters/{cluster_id}/interpret",
    response_model=InterpretationOut,
)
def interpret(
    run_id: uuid.UUID,
    cluster_id: int,
    refresh: bool = False,
    db: Session = Depends(get_session),
):
    """Blocking structured interpretation — cached to Postgres."""
    try:
        return interpret_cluster(db, run_id, cluster_id, refresh=refresh)
    except Exception as e:
        raise HTTPException(500, f"interpretation failed: {e}")


@router.post("/clusterings/{run_id}/clusters/{cluster_id}/interpret/stream")
def interpret_stream(
    run_id: uuid.UUID,
    cluster_id: int,
    db: Session = Depends(get_session),
):
    """SSE streaming narrative interpretation — not cached, display only."""
    try:
        payload = cluster_payload(db, run_id, cluster_id)
    except (LookupError, ValueError) as e:
        raise HTTPException(404, str(e))

    def generate():
        try:
            for token in describe_cluster_stream(payload):
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
    "/clusterings/{run_id}/interpretations",
    response_model=list[InterpretationOut],
)
def list_for_run(run_id: uuid.UUID, db: Session = Depends(get_session)):
    return InterpretationRepository(db).for_run(run_id)
