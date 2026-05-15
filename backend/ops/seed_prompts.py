"""Seed default PromptTemplate and LLMFunctionConfig rows on startup.

Idempotent — skips any function_name that already has a config row.
Imports _DEFAULTS from prompt_store so the source of truth is one place.
"""
from __future__ import annotations

from backend.ai.prompt_store import _DEFAULTS
from backend.core.db import session_scope
from backend.domain.models import LLMFunctionConfig, PromptTemplate


def seed_prompts() -> None:
    with session_scope() as db:
        for fn, meta in _DEFAULTS.items():
            # Idempotent: skip if already seeded
            existing_cfg = db.query(LLMFunctionConfig).filter_by(function_name=fn).first()
            if existing_cfg:
                continue

            pt = PromptTemplate(
                function_name=fn,
                name=f"{meta['display_name']} — v1",
                system_prompt=meta["system"],
                user_template=meta["user_template"],
                variables=meta.get("variables", []),
                version="v1",
                is_active=True,
            )
            db.add(pt)
            db.flush()

            cfg = LLMFunctionConfig(
                function_name=fn,
                display_name=meta["display_name"],
                description=meta.get("description", ""),
                model=None,  # null = use global settings.litellm_model
                temperature=meta["temperature"],
                max_tokens=meta["max_tokens"],
                active_prompt_id=pt.id,
            )
            db.add(cfg)

    print("[seed:prompts] LLM function configs ready")
