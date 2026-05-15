"""FastAPI app entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.core.db import Base, engine, session_scope
from backend.core.duck import duck
from backend.core.mlflow_client import setup_mlflow
from backend.core.settings import settings
from backend.ops.seed import seed_if_needed
from backend.ops.seed_loyalty import seed_loyalty
from backend.services.source_service import register_source, ingest_dataset, create_feature_group
from backend.repositories import SourceRepository

from backend.api.routes import sources, clusterings, interpretations, actions, recommendations, preprocessing
from backend.api.routes import config as config_routes
from backend.api.routes import spaces as spaces_routes


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    setup_mlflow()

    if settings.seed_default_dataset:
        info = seed_if_needed()
        print(f"[seed:entities] {info}")
        _bootstrap_default_entities(info["table"])

    loyalty_info = seed_loyalty()
    print(f"[seed:loyalty] {loyalty_info}")

    _seed_default_space()
    yield


def _bootstrap_default_entities(table_name: str) -> None:
    with session_scope() as db:
        sr = SourceRepository(db)
        if sr.list(limit=1):
            return

        source = register_source(
            db, name="local-duckdb", kind="duckdb_native",
            config={"table": table_name},
        )
        dataset = ingest_dataset(
            db, source_id=source.id,
            dataset_name="default_entities",
            duckdb_table=table_name,
        )

        schema_df = duck().describe(table_name)
        all_cols = schema_df["column_name"].tolist()

        structural = [c for c in all_cols if c in {"tenure_months", "category", "tier", "region"}]
        behavioral = [c for c in all_cols if c in {"metric_a", "metric_b", "metric_c"}]
        recency = [c for c in all_cols if c in {"metric_d"}]
        engagement = [c for c in all_cols if c in {"metric_e", "metric_f"}]
        fairness = [c for c in all_cols if c in {"metric_g", "locale"}]

        for name, cols in [
            ("structural", structural), ("behavioral", behavioral),
            ("recency", recency), ("engagement", engagement), ("fairness", fairness),
        ]:
            if cols:
                create_feature_group(db, dataset.id, name, cols)


def _seed_default_space() -> None:
    """Create the sample_loyalty space and its primary exploration dataset."""
    from backend.services.space_service import create_space
    from backend.services.space_service import refresh_description
    from backend.repositories import SourceRepository
    from backend.domain.models import FeatureGroup
    try:
        with session_scope() as db:
            sr = SourceRepository(db)
            src = sr.by_name("local-duckdb")
            if not src:
                src = register_source(
                    db,
                    name="local-duckdb",
                    kind="duckdb_native",
                    config={"table": "members"},
                )

            dataset = ingest_dataset(
                db,
                source_id=src.id,
                dataset_name="sample_loyalty_members",
                duckdb_table="members",
            )

            def ensure_group(name: str, cols: list[str], default_weight: float, description: str) -> None:
                existing = (
                    db.query(FeatureGroup)
                    .filter_by(dataset_id=dataset.id, name=name)
                    .first()
                )
                if existing:
                    existing.columns = cols
                    existing.default_weight = default_weight
                    existing.description = description
                    return
                create_feature_group(
                    db,
                    dataset.id,
                    name,
                    cols,
                    default_weight=default_weight,
                    description=description,
                )

            keep_groups = {"value_segment", "lifecycle"}
            (
                db.query(FeatureGroup)
                .filter(FeatureGroup.dataset_id == dataset.id, FeatureGroup.name.notin_(keep_groups))
                .delete(synchronize_session=False)
            )

            ensure_group(
                "value_segment",
                ["tier_id", "engagement_score"],
                1.8,
                "Tier and engagement score signals that separate casual, core, and high-value members.",
            )
            ensure_group(
                "lifecycle",
                ["lifecycle_status"],
                1.2,
                "Lifecycle persona label used to keep the sample visibly clusterable.",
            )

            space = create_space(
                db,
                name="sample_loyalty",
                display_name="Loyalty Programme",
                source_id=src.id,
                tables=["tiers", "merchants", "members", "transactions", "rewards"],
                primary_table="members",
                is_default=True,
            )
            refresh_description(db, space)
            print("[seed:space] sample_loyalty space ready")
    except Exception as e:
        print(f"[seed:space] skipped: {e}")


app = FastAPI(title="Semantic Explorer", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sources.router)
app.include_router(clusterings.router)
app.include_router(interpretations.router)
app.include_router(actions.router)
app.include_router(recommendations.router)
app.include_router(preprocessing.router)
app.include_router(config_routes.router)
app.include_router(spaces_routes.router)


@app.get("/health")
def health():
    return {"status": "ok", "model": settings.litellm_model}
