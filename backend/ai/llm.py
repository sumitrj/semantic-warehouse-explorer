"""LiteLLM chokepoint — all LLM calls flow through here.

Providers are configured via LITELLM_MODEL env var:
  ollama/qwen2.5:3b          (local default)
  openai/gpt-4o-mini
  anthropic/claude-haiku-4-5
  gemini/gemini-1.5-flash

Two surfaces:
  complete_structured() — blocking, enforces JSON schema, returns parsed dict
  stream_completion()   — streaming, yields raw text tokens for SSE display
"""
from __future__ import annotations

import json
import time
from typing import Any, Iterator

import litellm
from pydantic import BaseModel, ValidationError

from backend.core.settings import settings


class LLMError(Exception):
    pass


class LLMResponse(BaseModel):
    content: dict[str, Any]
    raw: str
    latency_ms: int
    model: str


def _base_kwargs(temperature: float, max_tokens: int) -> dict[str, Any]:
    kw: dict[str, Any] = dict(
        model=settings.litellm_model,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=settings.litellm_timeout,
    )
    if settings.litellm_api_base:
        kw["api_base"] = settings.litellm_api_base
    return kw


def complete_structured(
    *,
    system: str,
    user: str,
    schema: dict,
    temperature: float = 0.2,
    max_tokens: int = 800,
) -> LLMResponse:
    """Blocking structured completion. Returns validated JSON."""
    schema_str = json.dumps(schema, indent=2)
    system_full = (
        f"{system}\n\n"
        "Respond with a single JSON object that conforms to this schema. "
        "Do not include any prose outside the JSON.\n\n"
        f"Schema:\n{schema_str}"
    )
    kw = _base_kwargs(temperature, max_tokens)
    kw["messages"] = [
        {"role": "system", "content": system_full},
        {"role": "user", "content": user},
    ]
    kw["response_format"] = {"type": "json_object"}

    t0 = time.perf_counter()
    try:
        resp = litellm.completion(**kw)
    except Exception as e:
        raise LLMError(f"completion failed: {e}") from e
    latency_ms = int((time.perf_counter() - t0) * 1000)

    raw = resp.choices[0].message.content or ""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```", 2)[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip("` \n")

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end <= start:
            raise LLMError(f"model returned non-JSON: {raw[:300]!r}")
        try:
            parsed = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as e:
            raise LLMError(f"model returned non-JSON: {raw[:300]!r}") from e

    return LLMResponse(
        content=parsed, raw=raw, latency_ms=latency_ms, model=settings.litellm_model,
    )


def stream_completion(
    *,
    system: str,
    user: str,
    temperature: float = 0.3,
    max_tokens: int = 800,
) -> Iterator[str]:
    """Yield text tokens from a streaming LLM completion.

    No schema enforcement — callers display tokens directly (SSE).
    """
    kw = _base_kwargs(temperature, max_tokens)
    kw["messages"] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    kw["stream"] = True

    try:
        for chunk in litellm.completion(**kw):
            token = chunk.choices[0].delta.content or ""
            if token:
                yield token
    except Exception as e:
        raise LLMError(f"stream failed: {e}") from e


def validate_against_model(content: dict, pydantic_model: type[BaseModel]) -> BaseModel:
    try:
        return pydantic_model.model_validate(content)
    except ValidationError as e:
        raise LLMError(f"model output failed schema validation: {e}") from e
