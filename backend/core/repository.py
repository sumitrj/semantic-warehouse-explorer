"""Generic base repository over SQLAlchemy.

Every concrete repository inherits from this. The point is that 90% of
data access is CRUD, and CRUD shouldn't be rewritten per entity. Custom
queries get added per repo by extending this class.
"""
from __future__ import annotations

from typing import Generic, TypeVar, Type, Any
from uuid import UUID

from sqlalchemy import select, delete as sa_delete
from sqlalchemy.orm import Session

from backend.core.db import Base

T = TypeVar("T", bound=Base)


class BaseRepository(Generic[T]):
    """Generic CRUD over a SQLAlchemy model.

    Subclasses set `model` to the concrete model class. They may add
    custom finders, but should not override the base CRUD methods unless
    they have a very specific reason (e.g. soft delete semantics).
    """

    model: Type[T]

    def __init__(self, session: Session):
        self.session = session

    # ---- read ----

    def get(self, id_: UUID | str | int) -> T | None:
        return self.session.get(self.model, id_)

    def get_or_raise(self, id_: UUID | str | int) -> T:
        obj = self.get(id_)
        if obj is None:
            raise LookupError(f"{self.model.__name__} {id_} not found")
        return obj

    def list(self, *, limit: int = 100, offset: int = 0) -> list[T]:
        stmt = select(self.model).limit(limit).offset(offset)
        return list(self.session.scalars(stmt))

    def find_by(self, **filters: Any) -> list[T]:
        stmt = select(self.model).filter_by(**filters)
        return list(self.session.scalars(stmt))

    def find_one(self, **filters: Any) -> T | None:
        stmt = select(self.model).filter_by(**filters).limit(1)
        return self.session.scalars(stmt).first()

    def count(self, **filters: Any) -> int:
        stmt = select(self.model).filter_by(**filters)
        return len(list(self.session.scalars(stmt)))

    # ---- write ----

    def create(self, **fields: Any) -> T:
        obj = self.model(**fields)
        self.session.add(obj)
        self.session.flush()
        return obj

    def add(self, obj: T) -> T:
        """Add an already-constructed instance. Useful when the caller
        needs custom init logic that doesn't fit the kwargs form."""
        self.session.add(obj)
        self.session.flush()
        return obj

    def update(self, id_: UUID | str | int, **fields: Any) -> T:
        obj = self.get_or_raise(id_)
        for k, v in fields.items():
            setattr(obj, k, v)
        self.session.flush()
        return obj

    def delete(self, id_: UUID | str | int) -> None:
        obj = self.get(id_)
        if obj is not None:
            self.session.delete(obj)
            self.session.flush()

    def delete_where(self, **filters: Any) -> int:
        stmt = sa_delete(self.model).filter_by(**filters)
        result = self.session.execute(stmt)
        return result.rowcount or 0
