"""Table Space API — CRUD + description generation."""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.db import session_scope
from backend.domain.models import Source, TableSpace
from backend.services.space_service import (
    create_space, delete_space, list_spaces, refresh_description, update_space,
)

router = APIRouter(prefix="/spaces", tags=["spaces"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class SpaceOut(BaseModel):
    id: uuid.UUID
    name: str
    display_name: str
    source_id: uuid.UUID
    source_name: str
    tables: list[str]
    primary_table: str | None
    description: str | None
    is_default: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SpaceCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200, pattern=r"^[a-z0-9_\-]+$",
                      description="Lowercase slug, e.g. 'loyalty_programme'")
    display_name: str = Field(min_length=1, max_length=300)
    source_id: uuid.UUID
    tables: list[str] = Field(min_length=1)
    primary_table: str | None = None
    is_default: bool = False


class SpaceUpdateIn(BaseModel):
    display_name: str | None = None
    tables: list[str] | None = None
    primary_table: str | None = None
    is_default: bool | None = None


def _out(space: TableSpace, source_name: str) -> SpaceOut:
    return SpaceOut(
        id=space.id,
        name=space.name,
        display_name=space.display_name,
        source_id=space.source_id,
        source_name=source_name,
        tables=space.tables or [],
        primary_table=space.primary_table,
        description=space.description,
        is_default=space.is_default,
        created_at=space.created_at,
        updated_at=space.updated_at,
    )


def _source_name(session, source_id: uuid.UUID) -> str:
    src = session.get(Source, source_id)
    return src.name if src else str(source_id)


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("", response_model=list[SpaceOut])
def list_all():
    """List all Table Spaces."""
    with session_scope() as sess:
        spaces = list_spaces(sess)
        return [_out(s, _source_name(sess, s.source_id)) for s in spaces]


@router.post("", response_model=SpaceOut, status_code=201)
def create(body: SpaceCreateIn):
    """Create a new Table Space."""
    with session_scope() as sess:
        src = sess.get(Source, body.source_id)
        if not src:
            raise HTTPException(404, f"source {body.source_id} not found")
        space = create_space(
            sess,
            name=body.name,
            display_name=body.display_name,
            source_id=body.source_id,
            tables=body.tables,
            primary_table=body.primary_table,
            is_default=body.is_default,
        )
        sname = src.name
        sess.flush()
        out = _out(space, sname)
    return out


@router.get("/{space_id}", response_model=SpaceOut)
def get_one(space_id: uuid.UUID):
    with session_scope() as sess:
        space = sess.get(TableSpace, space_id)
        if not space:
            raise HTTPException(404, "space not found")
        return _out(space, _source_name(sess, space.source_id))


@router.patch("/{space_id}", response_model=SpaceOut)
def update(space_id: uuid.UUID, body: SpaceUpdateIn):
    with session_scope() as sess:
        space = update_space(
            sess, space_id,
            display_name=body.display_name,
            tables=body.tables,
            primary_table=body.primary_table,
            is_default=body.is_default,
        )
        out = _out(space, _source_name(sess, space.source_id))
    return out


@router.delete("/{space_id}", status_code=204)
def delete(space_id: uuid.UUID):
    with session_scope() as sess:
        try:
            delete_space(sess, space_id)
        except LookupError as e:
            raise HTTPException(404, str(e))


@router.post("/{space_id}/describe", response_model=SpaceOut)
def describe(space_id: uuid.UUID):
    """Regenerate the semantic description for a space. Returns the updated space."""
    with session_scope() as sess:
        space = sess.get(TableSpace, space_id)
        if not space:
            raise HTTPException(404, "space not found")
        refresh_description(sess, space)
        out = _out(space, _source_name(sess, space.source_id))
    return out
