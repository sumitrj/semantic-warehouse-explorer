"""Interpretation service.

Wraps the describe_cluster cognitive function with caching: results
persisted in Postgres keyed by (clustering_run_id, cluster_id). Avoids
re-calling the LLM when the same cluster is viewed twice.
"""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from backend.ai.functions import (
    describe_cluster, ClusterDescriptionInput,
)
from backend.core.settings import settings
from backend.domain import Interpretation
from backend.domain.models import TableSpace
from backend.repositories import ClusteringRunRepository, DatasetRepository, InterpretationRepository
from backend.services.clustering_service import cluster_centroid_profile
from backend.ops.loyalty_data import COLUMN_DESCRIPTIONS
from backend.services.space_service import refresh_description


def _compact_space_context(space: TableSpace) -> str:
    lines = [
        f"Space: {space.display_name}",
        f"Primary entity: {space.primary_table or 'not set'}",
        f"Tables in scope: {', '.join(space.tables or [])}",
    ]
    for table in space.tables or []:
        descriptions = COLUMN_DESCRIPTIONS.get(table, {})
        if not descriptions:
            continue
        useful = []
        for column, description in descriptions.items():
            if column in {"lifecycle_status", "engagement_score", "tier_id", "member_id"} or column.endswith("_id"):
                useful.append(f"{column}: {description}")
        if useful:
            lines.append(f"{table}: " + " ".join(useful))
    return "\n".join(lines)


def cluster_payload(
    session: Session,
    clustering_run_id: uuid.UUID,
    cluster_id: int,
) -> ClusterDescriptionInput:
    """Build LLM payload with cluster profile plus Table Space context."""
    profile = cluster_centroid_profile(session, clustering_run_id, cluster_id)
    run = ClusteringRunRepository(session).get_or_raise(clustering_run_id)
    dataset = DatasetRepository(session).get_or_raise(run.dataset_id)

    space = (
        session.query(TableSpace)
        .filter(
            TableSpace.source_id == dataset.source_id,
            TableSpace.primary_table == dataset.duckdb_table,
        )
        .first()
    ) or (
        session.query(TableSpace)
        .filter(TableSpace.source_id == dataset.source_id, TableSpace.is_default == True)  # noqa: E712
        .first()
    )

    if space:
        if not space.description:
            refresh_description(session, space)
        profile["space_description"] = _compact_space_context(space)

    return ClusterDescriptionInput(**profile)


def interpret_cluster(
    session: Session,
    clustering_run_id: uuid.UUID,
    cluster_id: int,
    *,
    refresh: bool = False,
) -> Interpretation:
    repo = InterpretationRepository(session)
    if not refresh:
        cached = repo.for_cluster(clustering_run_id, cluster_id)
        if cached:
            return cached

    payload = cluster_payload(session, clustering_run_id, cluster_id)
    output = describe_cluster(payload)

    if refresh:
        existing = repo.for_cluster(clustering_run_id, cluster_id)
        if existing:
            return repo.update(
                existing.id,
                headline=output.headline,
                characteristics=output.characteristics,
                confidence=output.confidence,
            )

    return repo.create(
        clustering_run_id=clustering_run_id,
        cluster_id=cluster_id,
        headline=output.headline,
        characteristics=list(output.characteristics),
        confidence=output.confidence,
        model_used=settings.litellm_model,
        prompt_version="v1",
    )
