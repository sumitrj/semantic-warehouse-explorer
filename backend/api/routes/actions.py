"""Actions CRUD routes."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.db import get_session
from backend.api.schemas import ActionIn, ActionOut
from backend.repositories import ActionRepository

router = APIRouter(prefix="/api", tags=["actions"])


@router.post("/actions", response_model=ActionOut)
def create(payload: ActionIn, db: Session = Depends(get_session)):
    repo = ActionRepository(db)
    if repo.by_name(payload.name):
        raise HTTPException(409, f"action '{payload.name}' already exists")
    return repo.create(
        name=payload.name,
        description=payload.description,
        grain=payload.grain,
        trigger_rule=payload.trigger_rule,
        enabled=payload.enabled,
    )


@router.get("/actions", response_model=list[ActionOut])
def list_actions(db: Session = Depends(get_session)):
    return ActionRepository(db).list()


@router.get("/actions/{action_id}", response_model=ActionOut)
def get(action_id: uuid.UUID, db: Session = Depends(get_session)):
    obj = ActionRepository(db).get(action_id)
    if not obj:
        raise HTTPException(404, "action not found")
    return obj


@router.patch("/actions/{action_id}", response_model=ActionOut)
def update(action_id: uuid.UUID, payload: ActionIn, db: Session = Depends(get_session)):
    repo = ActionRepository(db)
    if not repo.get(action_id):
        raise HTTPException(404, "action not found")
    return repo.update(
        action_id,
        name=payload.name,
        description=payload.description,
        grain=payload.grain,
        trigger_rule=payload.trigger_rule,
        enabled=payload.enabled,
    )


@router.delete("/actions/{action_id}", status_code=204)
def delete(action_id: uuid.UUID, db: Session = Depends(get_session)):
    ActionRepository(db).delete(action_id)
