"""LLM configuration routes — manage prompts and per-function inference config.

GET  /api/llm-config/functions                     → list all function configs
GET  /api/llm-config/functions/{name}              → get config + active prompt
PATCH /api/llm-config/functions/{name}             → update model/temperature/max_tokens
GET  /api/llm-config/functions/{name}/prompts      → list all prompt versions for function
POST /api/llm-config/functions/{name}/prompts      → create new prompt version
POST /api/llm-config/functions/{name}/activate/{prompt_id} → switch active prompt
GET  /api/llm-config/prompts/{prompt_id}           → get one prompt template
PATCH /api/llm-config/prompts/{prompt_id}          → update prompt text in-place
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.db import get_session
from backend.core.settings import settings
from backend.domain.models import LLMFunctionConfig, PromptTemplate

router = APIRouter(prefix="/api/llm-config", tags=["llm-config"])


# ─── Pydantic wire shapes ─────────────────────────────────────────────────────

class PromptTemplateOut(BaseModel):
    id: uuid.UUID
    function_name: str
    name: str
    system_prompt: str
    user_template: str
    variables: list[dict[str, Any]]
    version: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class LLMFunctionConfigOut(BaseModel):
    id: uuid.UUID
    function_name: str
    display_name: str
    description: str | None
    model: str | None
    effective_model: str          # model or global default
    temperature: float
    max_tokens: int
    active_prompt_id: uuid.UUID | None
    active_prompt: PromptTemplateOut | None
    created_at: datetime
    updated_at: datetime


class FunctionConfigPatch(BaseModel):
    model: str | None = None       # pass "" to clear (revert to global)
    temperature: float | None = None
    max_tokens: int | None = None


class PromptCreateIn(BaseModel):
    name: str
    system_prompt: str
    user_template: str
    variables: list[dict[str, Any]] = []
    activate: bool = True          # immediately set as active after creation


class PromptPatchIn(BaseModel):
    name: str | None = None
    system_prompt: str | None = None
    user_template: str | None = None
    variables: list[dict[str, Any]] | None = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _cfg_out(cfg: LLMFunctionConfig) -> LLMFunctionConfigOut:
    pt = None
    if cfg.active_prompt_id is not None:
        pass  # loaded via relationship if eager, handled below

    return LLMFunctionConfigOut(
        id=cfg.id,
        function_name=cfg.function_name,
        display_name=cfg.display_name,
        description=cfg.description,
        model=cfg.model,
        effective_model=cfg.model or settings.litellm_model,
        temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
        active_prompt_id=cfg.active_prompt_id,
        active_prompt=None,
        created_at=cfg.created_at,
        updated_at=cfg.updated_at,
    )


def _cfg_out_with_prompt(cfg: LLMFunctionConfig, db: Session) -> LLMFunctionConfigOut:
    pt: PromptTemplate | None = None
    if cfg.active_prompt_id:
        pt = db.get(PromptTemplate, cfg.active_prompt_id)
    if pt is None:
        pt = (
            db.query(PromptTemplate)
            .filter_by(function_name=cfg.function_name, is_active=True)
            .order_by(PromptTemplate.created_at.desc())
            .first()
        )
    out = _cfg_out(cfg)
    if pt:
        out.active_prompt = PromptTemplateOut.model_validate(pt)
        out.active_prompt_id = pt.id
    return out


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.get("/functions", response_model=list[LLMFunctionConfigOut])
def list_functions(db: Session = Depends(get_session)):
    cfgs = db.query(LLMFunctionConfig).order_by(LLMFunctionConfig.function_name).all()
    return [_cfg_out_with_prompt(c, db) for c in cfgs]


@router.get("/functions/{function_name}", response_model=LLMFunctionConfigOut)
def get_function(function_name: str, db: Session = Depends(get_session)):
    cfg = db.query(LLMFunctionConfig).filter_by(function_name=function_name).first()
    if not cfg:
        raise HTTPException(404, f"function '{function_name}' not found")
    return _cfg_out_with_prompt(cfg, db)


@router.patch("/functions/{function_name}", response_model=LLMFunctionConfigOut)
def patch_function(function_name: str, body: FunctionConfigPatch, db: Session = Depends(get_session)):
    cfg = db.query(LLMFunctionConfig).filter_by(function_name=function_name).first()
    if not cfg:
        raise HTTPException(404, f"function '{function_name}' not found")

    if body.model is not None:
        cfg.model = body.model if body.model != "" else None
    if body.temperature is not None:
        if not (0.0 <= body.temperature <= 2.0):
            raise HTTPException(422, "temperature must be 0.0–2.0")
        cfg.temperature = body.temperature
    if body.max_tokens is not None:
        if not (50 <= body.max_tokens <= 4096):
            raise HTTPException(422, "max_tokens must be 50–4096")
        cfg.max_tokens = body.max_tokens
    cfg.updated_at = datetime.utcnow()
    db.flush()
    return _cfg_out_with_prompt(cfg, db)


@router.get("/functions/{function_name}/prompts", response_model=list[PromptTemplateOut])
def list_prompts(function_name: str, db: Session = Depends(get_session)):
    pts = (
        db.query(PromptTemplate)
        .filter_by(function_name=function_name)
        .order_by(PromptTemplate.created_at.desc())
        .all()
    )
    return [PromptTemplateOut.model_validate(p) for p in pts]


@router.post("/functions/{function_name}/prompts", response_model=PromptTemplateOut, status_code=201)
def create_prompt(function_name: str, body: PromptCreateIn, db: Session = Depends(get_session)):
    cfg = db.query(LLMFunctionConfig).filter_by(function_name=function_name).first()
    if not cfg:
        raise HTTPException(404, f"function '{function_name}' not found")

    # Deactivate all existing prompts for this function if activating new one
    if body.activate:
        db.query(PromptTemplate).filter_by(function_name=function_name).update({"is_active": False})

    # Auto-version: count existing + 1
    count = db.query(PromptTemplate).filter_by(function_name=function_name).count()
    version = f"v{count + 1}"

    pt = PromptTemplate(
        function_name=function_name,
        name=body.name,
        system_prompt=body.system_prompt,
        user_template=body.user_template,
        variables=body.variables,
        version=version,
        is_active=body.activate,
    )
    db.add(pt)
    db.flush()

    if body.activate:
        cfg.active_prompt_id = pt.id
        cfg.updated_at = datetime.utcnow()

    return PromptTemplateOut.model_validate(pt)


@router.post("/functions/{function_name}/activate/{prompt_id}", response_model=LLMFunctionConfigOut)
def activate_prompt(function_name: str, prompt_id: uuid.UUID, db: Session = Depends(get_session)):
    cfg = db.query(LLMFunctionConfig).filter_by(function_name=function_name).first()
    if not cfg:
        raise HTTPException(404, f"function '{function_name}' not found")

    pt = db.get(PromptTemplate, prompt_id)
    if not pt or pt.function_name != function_name:
        raise HTTPException(404, "prompt not found for this function")

    db.query(PromptTemplate).filter_by(function_name=function_name).update({"is_active": False})
    pt.is_active = True
    cfg.active_prompt_id = pt.id
    cfg.updated_at = datetime.utcnow()
    db.flush()
    return _cfg_out_with_prompt(cfg, db)


@router.get("/prompts/{prompt_id}", response_model=PromptTemplateOut)
def get_prompt(prompt_id: uuid.UUID, db: Session = Depends(get_session)):
    pt = db.get(PromptTemplate, prompt_id)
    if not pt:
        raise HTTPException(404, "prompt not found")
    return PromptTemplateOut.model_validate(pt)


@router.patch("/prompts/{prompt_id}", response_model=PromptTemplateOut)
def patch_prompt(prompt_id: uuid.UUID, body: PromptPatchIn, db: Session = Depends(get_session)):
    pt = db.get(PromptTemplate, prompt_id)
    if not pt:
        raise HTTPException(404, "prompt not found")

    if body.name is not None:
        pt.name = body.name
    if body.system_prompt is not None:
        pt.system_prompt = body.system_prompt
    if body.user_template is not None:
        pt.user_template = body.user_template
    if body.variables is not None:
        pt.variables = body.variables
    pt.updated_at = datetime.utcnow()
    db.flush()
    return PromptTemplateOut.model_validate(pt)
