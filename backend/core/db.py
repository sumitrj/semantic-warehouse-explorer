"""Postgres app-DB setup. SQLAlchemy 2.x style."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session

from backend.core.settings import settings


class Base(DeclarativeBase):
    """Shared declarative base for all app-DB models."""
    pass


engine = create_engine(
    settings.postgres_url,
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    future=True,
)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Context manager for transactional scopes outside of FastAPI."""
    sess = SessionLocal()
    try:
        yield sess
        sess.commit()
    except Exception:
        sess.rollback()
        raise
    finally:
        sess.close()


# FastAPI dependency
def get_session() -> Iterator[Session]:
    sess = SessionLocal()
    try:
        yield sess
        sess.commit()
    except Exception:
        sess.rollback()
        raise
    finally:
        sess.close()
