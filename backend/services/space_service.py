"""Table Space service — create, query, and describe analysis spaces.

A TableSpace is a named, persisted scope that groups DuckDB tables under
a source for coordinated analysis (EDA → joins → ML → exploration).

The description generator produces LLM-ready markdown from:
  1. DuckDB DESCRIBE for column schemas
  2. ColumnAnnotation records for semantic types (if EDA has been run)
  3. JoinSuggestion records for confirmed relationships
  4. Live row counts from DuckDB

No LLM is used in generation — the output is intended for future LLM use.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from textwrap import dedent

from sqlalchemy.orm import Session

from backend.core.duck import duck
from backend.domain.models import (
    ColumnAnnotation, JoinSuggestion, Source, TableSpace,
)
from backend.ops.loyalty_data import COLUMN_DESCRIPTIONS


# ─── CRUD ─────────────────────────────────────────────────────────────────────

def create_space(
    session: Session,
    name: str,
    display_name: str,
    source_id: uuid.UUID,
    tables: list[str],
    primary_table: str | None = None,
    is_default: bool = False,
) -> TableSpace:
    src = session.get(Source, source_id)
    if not src:
        raise ValueError(f"source {source_id} not found")

    existing = session.query(TableSpace).filter_by(name=name).first()
    if existing:
        existing.display_name = display_name
        existing.source_id = source_id
        existing.tables = tables
        existing.primary_table = primary_table or (tables[0] if tables else None)
        existing.is_default = is_default or existing.is_default
        existing.updated_at = datetime.utcnow()
        return existing

    space = TableSpace(
        name=name,
        display_name=display_name,
        source_id=source_id,
        tables=tables,
        primary_table=primary_table or (tables[0] if tables else None),
        is_default=is_default,
    )
    session.add(space)
    session.flush()
    return space


def list_spaces(session: Session) -> list[TableSpace]:
    return session.query(TableSpace).order_by(TableSpace.created_at).all()


def get_space(session: Session, space_id: uuid.UUID) -> TableSpace | None:
    return session.get(TableSpace, space_id)


def update_space(
    session: Session,
    space_id: uuid.UUID,
    *,
    display_name: str | None = None,
    tables: list[str] | None = None,
    primary_table: str | None = None,
    is_default: bool | None = None,
) -> TableSpace:
    space = session.get(TableSpace, space_id)
    if not space:
        raise LookupError(f"space {space_id} not found")
    if display_name is not None:
        space.display_name = display_name
    if tables is not None:
        space.tables = tables
        if primary_table is None and space.primary_table not in tables:
            space.primary_table = tables[0] if tables else None
    if primary_table is not None:
        space.primary_table = primary_table
    if is_default is not None:
        if is_default:
            # Clear other defaults for this source
            session.query(TableSpace).filter(
                TableSpace.source_id == space.source_id,
                TableSpace.id != space_id,
            ).update({"is_default": False})
        space.is_default = is_default
    space.updated_at = datetime.utcnow()
    return space


def delete_space(session: Session, space_id: uuid.UUID) -> None:
    space = session.get(TableSpace, space_id)
    if not space:
        raise LookupError(f"space {space_id} not found")
    session.delete(space)


# ─── Description generator ────────────────────────────────────────────────────

def _row_count(table: str) -> int:
    try:
        df = duck().sql(f'SELECT COUNT(*) AS n FROM "{table}"')
        return int(df["n"].iloc[0])
    except Exception:
        return 0


def _col_schema(table: str) -> list[tuple[str, str]]:
    """Return [(col_name, col_type), ...] via DuckDB DESCRIBE."""
    try:
        df = duck().describe(table)
        return list(zip(df["column_name"].tolist(), df["column_type"].tolist()))
    except Exception:
        return []


def _col_annotations(
    session: Session, source_id: uuid.UUID, tables: list[str],
) -> dict[tuple[str, str], ColumnAnnotation]:
    """Return {(table, col): ColumnAnnotation} for all available EDA records."""
    rows = (
        session.query(ColumnAnnotation)
        .filter(
            ColumnAnnotation.source_id == source_id,
            ColumnAnnotation.table_name.in_(tables),
        )
        .all()
    )
    return {(r.table_name, r.column_name): r for r in rows}


def _confirmed_joins(
    session: Session, source_id: uuid.UUID, tables: list[str],
) -> list[JoinSuggestion]:
    return (
        session.query(JoinSuggestion)
        .filter(
            JoinSuggestion.source_id == source_id,
            JoinSuggestion.left_table.in_(tables),
            JoinSuggestion.status == "confirmed",
        )
        .all()
    )


def _sem_type_label(stype: str) -> str:
    return {
        "id": "Identifier",
        "category": "Category",
        "numeric": "Numeric",
        "date": "Date / Time",
        "boolean": "Boolean",
        "text": "Free Text",
    }.get(stype, stype.title())


def _build_table_section(
    table: str,
    col_schema: list[tuple[str, str]],
    annotations: dict[tuple[str, str], ColumnAnnotation],
) -> str:
    rc = _row_count(table)
    lines = [f"## {table}  ({rc:,} rows · {len(col_schema)} columns)\n"]
    descriptions = COLUMN_DESCRIPTIONS.get(table, {})

    for col, dtype in col_schema:
        desc = descriptions.get(col)
        ann = annotations.get((table, col))
        if ann:
            eff_type = ann.user_semantic_type or ann.semantic_type
            type_label = _sem_type_label(eff_type)
            null_note = f"  {ann.null_pct:.0f}% null" if ann.null_pct > 1 else ""
            distinct_note = f"  {ann.distinct_count:,} distinct values" if eff_type in ("category", "id") else ""

            detail = f"`{dtype}` · **{type_label}**{null_note}{distinct_note}"

            # Top values for categories
            top_vals = ann.stats.get("top_values", [])
            if top_vals and eff_type == "category":
                top_str = ", ".join(str(v["value"]) for v in top_vals[:5])
                detail += f" — {top_str}"

            # Range for numerics
            if eff_type == "numeric" and ann.stats.get("min") is not None:
                detail += f" — range [{ann.stats['min']:.2g} – {ann.stats['max']:.2g}]"

            if desc:
                detail += f". {desc}"

            lines.append(f"- **{col}**: {detail}")
        else:
            detail = f"`{dtype}`"
            if desc:
                detail += f". {desc}"
            lines.append(f"- **{col}**: {detail}")

    return "\n".join(lines)


def generate_description(session: Session, space: TableSpace) -> str:
    """Generate LLM-ready markdown description of a TableSpace.

    Uses EDA ColumnAnnotations if available; falls back to raw DuckDB schema.
    Includes confirmed join relationships.
    """
    tables = space.tables or []
    annotations = _col_annotations(session, space.source_id, tables)
    joins = _confirmed_joins(session, space.source_id, tables)

    total_rows = sum(_row_count(t) for t in tables)
    n_joins = len(joins)

    header = dedent(f"""
        # {space.display_name}

        **{len(tables)} tables · {total_rows:,} total rows · {n_joins} confirmed relationships**

        This space covers {", ".join(f"`{t}`" for t in tables)}.
        {"Primary entity for analysis: `" + space.primary_table + "`." if space.primary_table else ""}
    """).strip()

    table_sections: list[str] = []
    for table in tables:
        schema = _col_schema(table)
        table_sections.append(_build_table_section(table, schema, annotations))

    rel_section = ""
    if joins:
        rel_lines = ["\n## Relationships\n"]
        for j in joins:
            pct = f"{j.confidence * 100:.0f}%"
            rel_lines.append(
                f"- **{j.left_table}.{j.left_column}** → "
                f"**{j.right_table}.{j.right_column}** "
                f"[{j.join_type.upper()} · confidence {pct}]"
            )
        rel_section = "\n".join(rel_lines)

    parts = [header, ""] + table_sections
    if rel_section:
        parts.append(rel_section)

    return "\n\n".join(parts)


def refresh_description(session: Session, space: TableSpace) -> str:
    """Regenerate and persist the description for a space."""
    desc = generate_description(session, space)
    space.description = desc
    space.updated_at = datetime.utcnow()
    return desc
