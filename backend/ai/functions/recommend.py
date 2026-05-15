"""Recommendation cognitive functions — cluster-grain and entity-grain.

Both come in streaming (narrative) and structured (JSON) variants.
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterator

from backend.ai.tracking import tracked_stream

_PROMPTS = Path(__file__).parent.parent / "prompts"
PROMPT_VERSION = "v1"


def _load(name: str) -> tuple[str, str]:
    text = (_PROMPTS / name).read_text(encoding="utf-8")
    system, user_template = text.split("\n---\n", 1)
    return system.strip(), user_template.strip()


def _feat_lines(features: list[dict]) -> str:
    lines = []
    for f in features[:8]:
        lines.append(
            f"- {f['column']}: cluster avg = {f['cluster_mean']:.2f}, "
            f"overall avg = {f['overall_mean']:.2f} (z = {f['z_score']:+.2f})"
        )
    return "\n".join(lines)


def _actions_text(actions: list[dict]) -> str:
    if not actions:
        return "(no actions configured — describe general strategies based on the data)"
    lines = []
    for a in actions:
        desc = a.get("description") or ""
        lines.append(f"- {a['name']}: {desc}")
    return "\n".join(lines)


def recommend_cluster_stream(
    cluster_id: int,
    size: int,
    total_population: int,
    distinguishing_features: list[dict],
    actions: list[dict],
) -> Iterator[str]:
    """Stream cluster-level recommendation narrative."""
    system, user_template = _load("recommend_cluster.txt")
    share_pct = f"{100 * size / max(1, total_population):.1f}"

    user = user_template.format(
        cluster_id=cluster_id,
        size=size,
        share_pct=share_pct,
        feature_lines=_feat_lines(distinguishing_features),
        actions_list=_actions_text(actions),
    )

    yield from tracked_stream(
        function_name="recommend_cluster",
        prompt_version=PROMPT_VERSION,
        system=system,
        user=user,
        temperature=0.4,
        max_tokens=600,
    )


def recommend_entity_stream(
    entity_id: str,
    entity_data: dict,
    cluster_id: int,
    cluster_recommendations: str,
) -> Iterator[str]:
    """Stream entity-level personalized recommendation."""
    system, user_template = _load("recommend_entity.txt")

    entity_lines = "\n".join(f"- {k}: {v}" for k, v in entity_data.items() if not k.startswith("_"))

    user = user_template.format(
        entity_id=entity_id,
        entity_data=entity_lines,
        cluster_id=cluster_id,
        cluster_recommendations=cluster_recommendations or "(no cluster recommendation available yet)",
    )

    yield from tracked_stream(
        function_name="recommend_entity",
        prompt_version=PROMPT_VERSION,
        system=system,
        user=user,
        temperature=0.4,
        max_tokens=400,
    )
