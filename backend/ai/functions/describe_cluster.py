"""describe_cluster — structured and streaming variants.

Prompts and inference parameters are loaded from the DB via prompt_store.
No file-path dependency. Falls back to embedded defaults if the DB is
unreachable or the function is not yet seeded.
"""
from __future__ import annotations

from typing import Iterator, Literal

from pydantic import BaseModel, Field

from backend.ai.llm import validate_against_model
from backend.ai.prompt_store import get_config
from backend.ai.tracking import tracked_complete, tracked_stream


class ClusterDescriptionInput(BaseModel):
    cluster_id: int
    size: int
    total_population: int
    centroid: dict[str, float]
    distinguishing_features: list[dict]
    space_description: str | None = None


class ClusterDescriptionOutput(BaseModel):
    headline: str = Field(..., description="One-line cluster name")
    characteristics: list[str] = Field(..., description="2–4 short bullets")
    confidence: Literal["high", "medium", "low"]


OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "characteristics": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 2,
            "maxItems": 4,
        },
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
    },
    "required": ["headline", "characteristics", "confidence"],
}


def _feat_lines(payload: ClusterDescriptionInput) -> str:
    return "\n".join(
        f"- {f['column']}: cluster avg = {f['cluster_mean']:.2f}, "
        f"overall avg = {f['overall_mean']:.2f} (z = {f['z_score']:+.2f})"
        for f in payload.distinguishing_features[:8]
    )


def _share_pct(payload: ClusterDescriptionInput) -> str:
    return f"{100 * payload.size / max(1, payload.total_population):.1f}"


def _space_ctx(payload: ClusterDescriptionInput) -> str:
    return payload.space_description or "No Table Space description was supplied."


def describe_cluster(payload: ClusterDescriptionInput) -> ClusterDescriptionOutput:
    """Structured (blocking) — for caching to Postgres."""
    cfg = get_config("describe_cluster")
    user = cfg.user_template.format(
        cluster_id=payload.cluster_id,
        size=payload.size,
        total=payload.total_population,
        share_pct=_share_pct(payload),
        feature_lines=_feat_lines(payload),
        space_description=_space_ctx(payload),
    )
    resp = tracked_complete(
        function_name="describe_cluster",
        prompt_version=cfg.version,
        system=cfg.system,
        user=user,
        schema=OUTPUT_SCHEMA,
        temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
        model=cfg.model,
    )
    return validate_against_model(_normalize_output(resp.content), ClusterDescriptionOutput)


def describe_cluster_stream(payload: ClusterDescriptionInput) -> Iterator[str]:
    """Streaming narrative — for SSE display, no schema enforcement."""
    cfg = get_config("describe_cluster_narrative")
    user = cfg.user_template.format(
        cluster_id=payload.cluster_id,
        size=payload.size,
        total=payload.total_population,
        share_pct=_share_pct(payload),
        feature_lines=_feat_lines(payload),
        space_description=_space_ctx(payload),
    )
    yield from tracked_stream(
        function_name="describe_cluster_narrative",
        prompt_version=cfg.version,
        system=cfg.system,
        user=user,
        temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
        model=cfg.model,
    )


def _stringify_characteristic(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("text", "value", "label", "description", "summary"):
            item = value.get(key)
            if isinstance(item, str) and item.strip():
                return item.strip()
        return ", ".join(f"{k}: {v}" for k, v in value.items())
    return str(value)


def _normalize_output(content: dict) -> dict:
    """Tolerate small local models returning string fields as tiny objects."""
    normalized = dict(content)
    characteristics = normalized.get("characteristics")
    if isinstance(characteristics, list):
        normalized["characteristics"] = [
            _stringify_characteristic(item)
            for item in characteristics
            if _stringify_characteristic(item).strip()
        ][:4]
    return normalized
