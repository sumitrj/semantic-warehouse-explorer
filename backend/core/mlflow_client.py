"""MLflow client wrapper.

Centralizes tracking-URI setup and provides helpers for nested runs.
Every clustering run becomes a parent MLflow run; every LLM call inside
it becomes a nested run. This is what gives us full lineage.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator, Any

import mlflow
from mlflow.tracking import MlflowClient

from backend.core.settings import settings


def setup_mlflow() -> None:
    """Call once at app startup."""
    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    try:
        mlflow.set_experiment(settings.mlflow_experiment)
    except Exception:
        # if the tracking server isn't up yet, don't crash the app.
        # Runs will fail gracefully later.
        pass


def client() -> MlflowClient:
    return MlflowClient(tracking_uri=settings.mlflow_tracking_uri)


@contextmanager
def run(name: str, tags: dict[str, Any] | None = None, nested: bool = False) -> Iterator[Any]:
    """Open an MLflow run. Safe to call even if MLflow is down — logs a
    warning and yields a no-op context."""
    active_run = None
    try:
        active_run = mlflow.start_run(run_name=name, tags=tags or {}, nested=nested)
        r = active_run.__enter__()
    except Exception as e:
        # Yield a stub so callers can still execute their critical path
        class _Noop:
            info = type("info", (), {"run_id": None})()
        print(f"[mlflow] run '{name}' failed to open: {e}")
        yield _Noop()
        return

    try:
        yield r
    except BaseException as e:
        active_run.__exit__(type(e), e, e.__traceback__)
        raise
    else:
        active_run.__exit__(None, None, None)
