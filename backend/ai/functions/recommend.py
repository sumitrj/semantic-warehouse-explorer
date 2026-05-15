"""Recommendation cognitive functions — cluster-grain and entity-grain.

Prompts and inference parameters loaded from DB via prompt_store.
No file-path dependency.
"""
from __future__ import annotations

from typing import Iterator

from backend.ai.prompt_store import get_config
from backend.ai.tracking import tracked_stream


def _feat_lines(features: list[dict]) -> str:
    return "\n".join(
        f"- {f['column']}: cluster avg = {f['cluster_mean']:.2f}, "
        f"overall avg = {f['overall_mean']:.2f} (z = {f['z_score']:+.2f})"
        for f in features[:8]
    )


def _actions_text(actions: list[dict]) -> str:
    if not actions:
        return "(no actions configured — describe general strategies based on the data)"
    return "\n".join(
        f"- {a['name']}: {a.get('description') or ''}" for a in actions
    )


def recommend_cluster_stream(
    cluster_id: int,
    size: int,
    total_population: int,
    distinguishing_features: list[dict],
    actions: list[dict],
) -> Iterator[str]:
    """Stream cluster-level recommendation narrative."""
    cfg = get_config("recommend_cluster")
    share_pct = f"{100 * size / max(1, total_population):.1f}"
    user = cfg.user_template.format(
        cluster_id=cluster_id,
        size=size,
        share_pct=share_pct,
        feature_lines=_feat_lines(distinguishing_features),
        actions_list=_actions_text(actions),
    )
    yield from tracked_stream(
        function_name="recommend_cluster",
        prompt_version=cfg.version,
        system=cfg.system,
        user=user,
        temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
        model=cfg.model,
    )


def recommend_entity_stream(
    entity_id: str,
    entity_data: dict,
    cluster_id: int,
    cluster_recommendations: str,
) -> Iterator[str]:
    """Stream entity-level personalized recommendation."""
    cfg = get_config("recommend_entity")
    entity_lines = "\n".join(
        f"- {k}: {v}" for k, v in entity_data.items() if not k.startswith("_")
    )
    user = cfg.user_template.format(
        entity_id=entity_id,
        entity_data=entity_lines,
        cluster_id=cluster_id,
        cluster_recommendations=cluster_recommendations or "(no cluster recommendation available yet)",
    )
    yield from tracked_stream(
        function_name="recommend_entity",
        prompt_version=cfg.version,
        system=cfg.system,
        user=user,
        temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
        model=cfg.model,
    )
