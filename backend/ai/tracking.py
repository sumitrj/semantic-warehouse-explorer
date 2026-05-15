"""Track every LLM call to MLflow — both blocking and streaming."""
from __future__ import annotations

import time
from typing import Iterator

import mlflow

from backend.ai.llm import complete_structured, stream_completion, LLMResponse, LLMError
from backend.core.mlflow_client import run as mlrun


def tracked_complete(
    *,
    function_name: str,
    prompt_version: str,
    system: str,
    user: str,
    schema: dict,
    temperature: float = 0.2,
    max_tokens: int = 800,
) -> LLMResponse:
    with mlrun(f"llm:{function_name}", nested=True, tags={"function": function_name}):
        try:
            mlflow.log_param("model", _model_name())
            mlflow.log_param("prompt_version", prompt_version)
            mlflow.log_param("temperature", temperature)
            mlflow.log_text(system, "system.txt")
            mlflow.log_text(user, "user.txt")
        except Exception:
            pass

        try:
            resp = complete_structured(
                system=system, user=user, schema=schema,
                temperature=temperature, max_tokens=max_tokens,
            )
        except LLMError as e:
            try:
                mlflow.log_param("status", "error")
                mlflow.log_text(str(e), "error.txt")
            except Exception:
                pass
            raise

        try:
            mlflow.log_metric("latency_ms", resp.latency_ms)
            mlflow.log_text(resp.raw, "response.txt")
            mlflow.log_param("status", "ok")
        except Exception:
            pass

        return resp


def tracked_stream(
    *,
    function_name: str,
    prompt_version: str,
    system: str,
    user: str,
    temperature: float = 0.3,
    max_tokens: int = 800,
) -> Iterator[str]:
    """Stream tokens and log the call to MLflow.

    Yields tokens as they arrive. MLflow run closes after the generator
    is exhausted (or abandoned).
    """
    with mlrun(f"llm:{function_name}:stream", nested=True, tags={"function": function_name, "mode": "stream"}):
        try:
            mlflow.log_param("model", _model_name())
            mlflow.log_param("prompt_version", prompt_version)
            mlflow.log_param("temperature", temperature)
            mlflow.log_text(system, "system.txt")
            mlflow.log_text(user, "user.txt")
        except Exception:
            pass

        t0 = time.perf_counter()
        full = []
        try:
            for token in stream_completion(
                system=system, user=user,
                temperature=temperature, max_tokens=max_tokens,
            ):
                full.append(token)
                yield token
        except LLMError as e:
            try:
                mlflow.log_param("status", "error")
                mlflow.log_text(str(e), "error.txt")
            except Exception:
                pass
            raise
        finally:
            try:
                latency_ms = int((time.perf_counter() - t0) * 1000)
                mlflow.log_metric("latency_ms", latency_ms)
                mlflow.log_metric("tokens_yielded", len(full))
                mlflow.log_text("".join(full), "response.txt")
                mlflow.log_param("status", "ok")
            except Exception:
                pass


def _model_name() -> str:
    from backend.core.settings import settings
    return settings.litellm_model
