"""Configuration wizard API routes.

All endpoints here are LLM-free. They drive the 5-step configuration wizard:
  Step 1 — Data source selection (uses existing /sources endpoints)
  Step 2 — Table explorer: list + select tables
  Step 3 — EDA: per-column statistical analysis
  Step 4 — Associations: join discovery + user confirmation
  Step 5 — ML config: mode + algorithm/prediction schema
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.core.db import session_scope
from backend.core.duck import duck
from backend.domain.models import (
    ColumnAnnotation,
    JoinSuggestion,
    MLConfig,
    Source,
    TableSelection,
)
from backend.services.eda_service import analyze_table, log_eda_run
from backend.services.join_service import discover_joins, log_join_discovery_run
from backend.services.prediction_service import (
    TrainingSchema,
    build_training_schema,
    log_schema_run,
)

router = APIRouter(prefix="/config", tags=["config"])


# ─── Step 2 — Table Explorer ─────────────────────────────────────────────────

class TableMeta(BaseModel):
    name: str
    row_count: int
    col_count: int
    selected: bool = False


class TableSelectIn(BaseModel):
    source_id: uuid.UUID
    selected_tables: list[str]


@router.get("/tables", response_model=list[TableMeta])
def list_tables(source_id: uuid.UUID):
    """List all DuckDB tables available in the local DuckDB instance."""
    db = duck()
    tables = db.list_tables()

    with session_scope() as sess:
        existing = {
            ts.table_name: ts.selected
            for ts in sess.query(TableSelection).filter_by(source_id=source_id)
        }

    result: list[TableMeta] = []
    for name in tables:
        try:
            rc_df = db.sql(f'SELECT COUNT(*) AS cnt FROM "{name}"')
            rc = int(rc_df["cnt"].iloc[0])
            cc = len(db.describe(name))
        except Exception:
            rc, cc = 0, 0
        result.append(TableMeta(name=name, row_count=rc, col_count=cc, selected=existing.get(name, False)))

    return result


@router.get("/tables/{table}/preview")
def preview_table(table: str, rows: int = 5) -> list[dict[str, Any]]:
    """Return the first N rows of a DuckDB table as a list of dicts."""
    try:
        df = duck().read_table(table, limit=rows)
        return df.to_dict(orient="records")
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/tables/select")
def select_tables(body: TableSelectIn):
    """Persist which tables the user wants to work with."""
    with session_scope() as sess:
        source = sess.get(Source, body.source_id)
        if not source:
            raise HTTPException(status_code=404, detail="source not found")

        # Remove old selections for this source
        sess.query(TableSelection).filter_by(source_id=body.source_id).delete()
        db = duck()
        for tname in body.selected_tables:
            try:
                rc_df = db.sql(f'SELECT COUNT(*) AS cnt FROM "{tname}"')
                rc = int(rc_df["cnt"].iloc[0])
                cc = len(db.describe(tname))
            except Exception:
                rc, cc = 0, 0
            sess.add(
                TableSelection(
                    source_id=body.source_id,
                    table_name=tname,
                    selected=True,
                    row_count=rc,
                    col_count=cc,
                )
            )

    return {"ok": True, "selected": body.selected_tables}


# ─── Step 3 — EDA ────────────────────────────────────────────────────────────

class ColumnAnnotationOut(BaseModel):
    id: uuid.UUID
    table_name: str
    column_name: str
    dtype: str
    semantic_type: str
    user_semantic_type: str | None
    null_pct: float
    distinct_count: int
    distinct_pct: float
    total_rows: int
    stats: dict
    mlflow_run_id: str | None

    model_config = {"from_attributes": True}


class SemanticTypeOverrideIn(BaseModel):
    source_id: uuid.UUID
    table_name: str
    column_name: str
    semantic_type: str


class EDARunIn(BaseModel):
    source_id: uuid.UUID
    tables: list[str] | None = None


@router.post("/eda/run")
def run_eda(body: EDARunIn):
    source_id = body.source_id
    tables = body.tables
    """Run EDA on all (or specified) selected tables for a source.

    Computes stats, persists ColumnAnnotation rows, logs to MLflow.
    """
    with session_scope() as sess:
        if tables is None:
            sels = sess.query(TableSelection).filter_by(source_id=source_id, selected=True).all()
            tables = [s.table_name for s in sels]

        if not tables:
            return {"ok": True, "message": "no tables selected", "columns": 0}

        # Clear old annotations for this source + tables
        sess.query(ColumnAnnotation).filter(
            ColumnAnnotation.source_id == source_id,
            ColumnAnnotation.table_name.in_(tables),
        ).delete(synchronize_session="fetch")

        total_cols = 0
        for table in tables:
            try:
                stats = analyze_table(table)
                run_id = log_eda_run(table, stats)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"EDA failed on {table}: {e}")

            for s in stats:
                extra: dict = {}
                if s.min_val is not None:
                    extra["min"] = s.min_val
                if s.max_val is not None:
                    extra["max"] = s.max_val
                if s.mean_val is not None:
                    extra["mean"] = s.mean_val
                if s.std_val is not None:
                    extra["std"] = s.std_val
                if s.top_values:
                    extra["top_values"] = s.top_values

                sess.add(
                    ColumnAnnotation(
                        source_id=source_id,
                        table_name=table,
                        column_name=s.column,
                        dtype=s.dtype,
                        semantic_type=s.semantic_type,
                        null_pct=s.null_pct,
                        distinct_count=s.distinct_count,
                        distinct_pct=s.distinct_pct,
                        total_rows=s.total_rows,
                        stats=extra,
                        mlflow_run_id=run_id,
                    )
                )
            total_cols += len(stats)

    return {"ok": True, "tables": tables, "columns": total_cols}


@router.get("/eda/{source_id}", response_model=list[ColumnAnnotationOut])
def get_eda(source_id: uuid.UUID, table: str | None = None):
    """Return persisted EDA results for a source, optionally filtered by table."""
    with session_scope() as sess:
        q = sess.query(ColumnAnnotation).filter_by(source_id=source_id)
        if table:
            q = q.filter_by(table_name=table)
        rows = q.all()
        # detach before returning
        result = [
            ColumnAnnotationOut(
                id=r.id, table_name=r.table_name, column_name=r.column_name,
                dtype=r.dtype, semantic_type=r.semantic_type,
                user_semantic_type=r.user_semantic_type,
                null_pct=r.null_pct, distinct_count=r.distinct_count,
                distinct_pct=r.distinct_pct, total_rows=r.total_rows,
                stats=r.stats, mlflow_run_id=r.mlflow_run_id,
            )
            for r in rows
        ]
    return result


@router.patch("/eda/override")
def override_semantic_type(body: SemanticTypeOverrideIn):
    """Let the user correct an auto-detected semantic type."""
    with session_scope() as sess:
        ann = (
            sess.query(ColumnAnnotation)
            .filter_by(
                source_id=body.source_id,
                table_name=body.table_name,
                column_name=body.column_name,
            )
            .first()
        )
        if not ann:
            raise HTTPException(status_code=404, detail="annotation not found")
        ann.user_semantic_type = body.semantic_type
    return {"ok": True}


# ─── Step 4 — Associations ───────────────────────────────────────────────────

class JoinSuggestionOut(BaseModel):
    id: uuid.UUID
    left_table: str
    left_column: str
    right_table: str
    right_column: str
    confidence: float
    join_type: str
    status: str

    model_config = {"from_attributes": True}


class JoinStatusIn(BaseModel):
    source_id: uuid.UUID
    join_id: uuid.UUID
    status: str  # confirmed | rejected


class ManualJoinIn(BaseModel):
    source_id: uuid.UUID
    left_table: str
    left_column: str
    right_table: str
    right_column: str


class DiscoverIn(BaseModel):
    source_id: uuid.UUID
    tables: list[str] | None = None


@router.post("/associations/discover")
def discover_associations(body: DiscoverIn):
    source_id = body.source_id
    """Run join discovery on all selected tables for a source."""
    with session_scope() as sess:
        tables = body.tables
        if tables is None:
            sels = sess.query(TableSelection).filter_by(source_id=source_id, selected=True).all()
            tables = [s.table_name for s in sels]

        if len(tables) < 2:
            return {"ok": True, "message": "need at least 2 tables", "candidates": 0}

        candidates = discover_joins(tables)
        run_id = log_join_discovery_run(tables, candidates)

        # Clear old pending suggestions; keep user-confirmed/rejected ones
        sess.query(JoinSuggestion).filter(
            JoinSuggestion.source_id == source_id,
            JoinSuggestion.status == "pending",
        ).delete(synchronize_session="fetch")

        for c in candidates:
            sess.add(
                JoinSuggestion(
                    source_id=source_id,
                    left_table=c.left_table,
                    left_column=c.left_column,
                    right_table=c.right_table,
                    right_column=c.right_column,
                    confidence=c.confidence,
                    join_type=c.join_type,
                    status="pending",
                    mlflow_run_id=run_id,
                )
            )

    return {"ok": True, "candidates": len(candidates)}


@router.get("/associations/{source_id}", response_model=list[JoinSuggestionOut])
def get_associations(source_id: uuid.UUID):
    with session_scope() as sess:
        rows = sess.query(JoinSuggestion).filter_by(source_id=source_id).all()
        return [
            JoinSuggestionOut(
                id=r.id, left_table=r.left_table, left_column=r.left_column,
                right_table=r.right_table, right_column=r.right_column,
                confidence=r.confidence, join_type=r.join_type, status=r.status,
            )
            for r in rows
        ]


@router.patch("/associations/status")
def set_join_status(body: JoinStatusIn):
    if body.status not in ("confirmed", "rejected", "pending"):
        raise HTTPException(status_code=422, detail="status must be confirmed | rejected | pending")
    with session_scope() as sess:
        js = sess.get(JoinSuggestion, body.join_id)
        if not js or js.source_id != body.source_id:
            raise HTTPException(status_code=404, detail="join not found")
        js.status = body.status
    return {"ok": True}


@router.post("/associations/manual")
def add_manual_join(body: ManualJoinIn):
    with session_scope() as sess:
        sess.add(
            JoinSuggestion(
                source_id=body.source_id,
                left_table=body.left_table,
                left_column=body.left_column,
                right_table=body.right_table,
                right_column=body.right_column,
                confidence=1.0,
                join_type="manual",
                status="confirmed",
            )
        )
    return {"ok": True}


# ─── Step 5 — ML Configuration ───────────────────────────────────────────────

class MLConfigIn(BaseModel):
    source_id: uuid.UUID
    mode: str  # exploration | prediction
    exploration_config: dict = {}
    prediction_config: dict = {}


class MLConfigOut(BaseModel):
    id: uuid.UUID
    source_id: uuid.UUID
    mode: str
    exploration_config: dict
    prediction_config: dict
    mlflow_run_id: str | None

    model_config = {"from_attributes": True}


class TrainingSchemaIn(BaseModel):
    source_id: uuid.UUID
    target_table: str
    target_column: str
    model_type: str
    train_ratio: float = 0.8
    user_overrides: dict[str, str] = {}


@router.post("/ml", response_model=MLConfigOut)
def save_ml_config(body: MLConfigIn):
    """Persist the user's ML configuration choice."""
    from datetime import datetime
    with session_scope() as sess:
        existing = sess.query(MLConfig).filter_by(source_id=body.source_id).first()
        if existing:
            existing.mode = body.mode
            existing.exploration_config = body.exploration_config
            existing.prediction_config = body.prediction_config
            existing.updated_at = datetime.utcnow()
            cfg = existing
        else:
            cfg = MLConfig(
                source_id=body.source_id,
                mode=body.mode,
                exploration_config=body.exploration_config,
                prediction_config=body.prediction_config,
            )
            sess.add(cfg)
        sess.flush()
        out = MLConfigOut(
            id=cfg.id, source_id=cfg.source_id, mode=cfg.mode,
            exploration_config=cfg.exploration_config,
            prediction_config=cfg.prediction_config,
            mlflow_run_id=cfg.mlflow_run_id,
        )
    return out


@router.get("/ml/{source_id}", response_model=MLConfigOut | None)
def get_ml_config(source_id: uuid.UUID):
    with session_scope() as sess:
        cfg = sess.query(MLConfig).filter_by(source_id=source_id).first()
        if not cfg:
            return None
        return MLConfigOut(
            id=cfg.id, source_id=cfg.source_id, mode=cfg.mode,
            exploration_config=cfg.exploration_config,
            prediction_config=cfg.prediction_config,
            mlflow_run_id=cfg.mlflow_run_id,
        )


@router.post("/ml/training-schema")
def build_schema(body: TrainingSchemaIn):
    """Build a training schema for prediction mode and log to MLflow."""
    with session_scope() as sess:
        anns = sess.query(ColumnAnnotation).filter_by(source_id=body.source_id).all()
        joins = (
            sess.query(JoinSuggestion)
            .filter_by(source_id=body.source_id, status="confirmed")
            .all()
        )

    # Build column_stats dict grouped by table
    from backend.services.eda_service import ColumnStats as CS
    column_stats: dict[str, list[CS]] = {}
    for ann in anns:
        if ann.table_name not in column_stats:
            column_stats[ann.table_name] = []
        column_stats[ann.table_name].append(
            CS(
                column=ann.column_name,
                dtype=ann.dtype,
                semantic_type=ann.user_semantic_type or ann.semantic_type,
                total_rows=ann.total_rows,
                null_count=int(ann.null_pct * ann.total_rows / 100),
                null_pct=ann.null_pct,
                distinct_count=ann.distinct_count,
                distinct_pct=ann.distinct_pct,
                top_values=ann.stats.get("top_values", []),
            )
        )

    confirmed_joins = [
        {
            "left_table": j.left_table, "left_column": j.left_column,
            "right_table": j.right_table, "right_column": j.right_column,
            "join_type": j.join_type,
        }
        for j in joins
    ]

    schema = build_training_schema(
        target_table=body.target_table,
        target_column=body.target_column,
        model_type=body.model_type,  # type: ignore[arg-type]
        column_stats=column_stats,
        confirmed_joins=confirmed_joins,
        train_ratio=body.train_ratio,
        user_overrides=body.user_overrides,
    )
    run_id = log_schema_run(schema)

    # Persist to ml_configs prediction_config
    from datetime import datetime
    with session_scope() as sess:
        cfg = sess.query(MLConfig).filter_by(source_id=body.source_id).first()
        if cfg:
            from dataclasses import asdict
            cfg.prediction_config = asdict(schema)
            cfg.mlflow_run_id = run_id
            cfg.updated_at = datetime.utcnow()

    return {"ok": True, "mlflow_run_id": run_id, "schema": schema}
