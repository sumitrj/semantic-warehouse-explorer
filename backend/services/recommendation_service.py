"""Recommendation service.

Two paths:
  recommend_cluster_stream — cluster-grain, streaming SSE narrative
  recommend_entity_stream  — entity-grain, streaming SSE narrative

Both cache the final text to Postgres (Recommendation table) after the
stream completes so re-requests serve from cache.
"""
from __future__ import annotations

import uuid
from typing import Iterator

from sqlalchemy.orm import Session

from backend.ai.functions import recommend_cluster_stream, recommend_entity_stream
from backend.core.duck import duck
from backend.core.settings import settings
from backend.domain import Recommendation
from backend.repositories import (
    RecommendationRepository, ActionRepository, ClusteringRunRepository,
)
from backend.services.clustering_service import cluster_centroid_profile


def stream_cluster_recommendation(
    session: Session,
    run_id: uuid.UUID,
    cluster_id: int,
    *,
    refresh: bool = False,
) -> Iterator[str]:
    """Yield tokens for cluster recommendation, then cache result."""
    repo = RecommendationRepository(session)

    if not refresh:
        cached = repo.for_cluster(run_id, cluster_id)
        if cached:
            # replay cache word by word so the frontend still sees "streaming"
            for word in cached.text.split(" "):
                yield word + " "
            return

    profile = cluster_centroid_profile(session, run_id, cluster_id)
    actions = [
        {"name": a.name, "description": a.description}
        for a in ActionRepository(session).enabled()
    ]

    full_text = []
    for token in recommend_cluster_stream(
        cluster_id=profile["cluster_id"],
        size=profile["size"],
        total_population=profile["total_population"],
        distinguishing_features=profile["distinguishing_features"],
        actions=actions,
    ):
        full_text.append(token)
        yield token

    text = "".join(full_text)
    if refresh:
        existing = repo.for_cluster(run_id, cluster_id)
        if existing:
            repo.update(existing.id, text=text)
            return
    repo.create(
        clustering_run_id=run_id,
        cluster_id=cluster_id,
        entity_id=None,
        grain="cluster",
        text=text,
        model_used=settings.litellm_model,
    )


def stream_entity_recommendation(
    session: Session,
    run_id: uuid.UUID,
    cluster_id: int,
    entity_id: str,
    *,
    refresh: bool = False,
) -> Iterator[str]:
    """Yield tokens for entity recommendation, then cache result."""
    repo = RecommendationRepository(session)

    if not refresh:
        cached = repo.for_entity(run_id, cluster_id, entity_id)
        if cached:
            for word in cached.text.split(" "):
                yield word + " "
            return

    # get entity row from DuckDB
    run = ClusteringRunRepository(session).get_or_raise(run_id)
    from backend.repositories import DatasetRepository
    dataset = DatasetRepository(session).get_or_raise(run.dataset_id)

    # try to find the entity by entity_id column
    d = duck()
    try:
        df = d.sql(
            f"SELECT * FROM {dataset.duckdb_table} WHERE entity_id = ? LIMIT 1",
            [entity_id],
        )
    except Exception:
        df = d.sql(f"SELECT * FROM {dataset.duckdb_table} LIMIT 1")

    entity_data = df.iloc[0].to_dict() if not df.empty else {}

    # get cached cluster recommendation if available
    cluster_rec = repo.for_cluster(run_id, cluster_id)
    cluster_rec_text = cluster_rec.text if cluster_rec else ""

    full_text = []
    for token in recommend_entity_stream(
        entity_id=entity_id,
        entity_data=entity_data,
        cluster_id=cluster_id,
        cluster_recommendations=cluster_rec_text,
    ):
        full_text.append(token)
        yield token

    text = "".join(full_text)
    if refresh:
        existing = repo.for_entity(run_id, cluster_id, entity_id)
        if existing:
            repo.update(existing.id, text=text)
            return
    repo.create(
        clustering_run_id=run_id,
        cluster_id=cluster_id,
        entity_id=entity_id,
        grain="entity",
        text=text,
        model_used=settings.litellm_model,
    )
