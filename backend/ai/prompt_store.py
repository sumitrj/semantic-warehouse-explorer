"""Prompt store — loads prompt templates and inference config from Postgres.

All four cognitive function prompts are embedded here as Python strings so
there is zero file-path dependency. The DB-backed version takes precedence;
these strings are the fallback if the DB is empty or unreachable.
"""
from __future__ import annotations

from dataclasses import dataclass


# ── Embedded prompt defaults ───────────────────────────────────────────────────
# Split into (system, user_template) tuples. No file reads anywhere.

_DEFAULTS: dict[str, dict] = {
    "describe_cluster": {
        "display_name": "Cluster Description (Structured)",
        "description": "Produces a structured JSON interpretation of a cluster: headline, characteristics, confidence.",
        "system": (
            "You are a data analyst. You will be given a description of one cluster from a clustering "
            "of business entities. Your job is to produce a short, plain-English description of what "
            "makes this cluster distinctive.\n\n"
            "Be concrete. Refer to specific feature values. Do not invent context that isn't in the input. "
            "If the distinguishing features are weak or contradictory, set confidence to \"low\".\n\n"
            "Output strictly as JSON matching the provided schema. No prose outside the JSON."
        ),
        "user_template": (
            "Cluster #{cluster_id} contains {size} of {total} entities ({share_pct}% of the population).\n\n"
            "Table Space context:\n\n{space_description}\n\n"
            "Distinguishing features (z-score is how many standard deviations this cluster's average "
            "differs from the overall population's average):\n\n{feature_lines}\n\n"
            "Produce:\n"
            "- a short headline naming this cluster\n"
            "- 2 to 4 bullet points describing common characteristics\n"
            "- a confidence assessment based on how clearly the features separate this cluster from the rest"
        ),
        "variables": [
            {"name": "cluster_id", "description": "Numeric cluster label"},
            {"name": "size", "description": "Number of entities in this cluster"},
            {"name": "total", "description": "Total population size"},
            {"name": "share_pct", "description": "Cluster share as a percentage string"},
            {"name": "feature_lines", "description": "Bullet lines of distinguishing features with z-scores"},
            {"name": "space_description", "description": "Markdown description of the Table Space"},
        ],
        "temperature": 0.2,
        "max_tokens": 400,
    },
    "describe_cluster_narrative": {
        "display_name": "Cluster Narrative (Streaming)",
        "description": "Streams a free-form narrative about a cluster — no JSON schema, displayed as markdown.",
        "system": (
            "You are a data analyst interpreting machine learning clustering results. Write a clear, "
            "insightful narrative about the cluster below. Be concrete — reference specific feature values "
            "and z-scores. Identify what makes this cluster distinctive. Write 2–3 short paragraphs. "
            "Plain English only, no JSON, no bullet points."
        ),
        "user_template": (
            "Cluster #{cluster_id} — {size} of {total} entities ({share_pct}% of the population).\n\n"
            "Table Space context:\n\n{space_description}\n\n"
            "Distinguishing features (z-score = standard deviations above/below the population mean):\n\n"
            "{feature_lines}\n\n"
            "Describe what kind of entities belong to this cluster and what patterns define them."
        ),
        "variables": [
            {"name": "cluster_id", "description": "Numeric cluster label"},
            {"name": "size", "description": "Number of entities in this cluster"},
            {"name": "total", "description": "Total population size"},
            {"name": "share_pct", "description": "Cluster share as a percentage string"},
            {"name": "feature_lines", "description": "Bullet lines of distinguishing features with z-scores"},
            {"name": "space_description", "description": "Markdown description of the Table Space"},
        ],
        "temperature": 0.4,
        "max_tokens": 500,
    },
    "recommend_cluster": {
        "display_name": "Cluster Recommendations (Streaming)",
        "description": "Streams action recommendations for a cluster based on its profile and the action catalog.",
        "system": (
            "You are a strategic recommendation engine. Given a cluster's statistical profile and a catalog "
            "of available actions, identify which interventions would be most effective for this group.\n\n"
            "For each recommendation: name the action, explain why it fits this cluster's specific "
            "characteristics, and estimate the expected impact. Limit to 1–3 recommendations ranked by "
            "priority. Write in plain English paragraphs — be specific, not generic."
        ),
        "user_template": (
            "Cluster #{cluster_id} — {size} entities ({share_pct}% of the population).\n\n"
            "Distinctive characteristics (z-score vs population mean):\n{feature_lines}\n\n"
            "Available actions:\n{actions_list}\n\n"
            "Provide your cluster-level recommendations."
        ),
        "variables": [
            {"name": "cluster_id", "description": "Numeric cluster label"},
            {"name": "size", "description": "Number of entities in this cluster"},
            {"name": "share_pct", "description": "Cluster share as a percentage string"},
            {"name": "feature_lines", "description": "Bullet lines of distinguishing features with z-scores"},
            {"name": "actions_list", "description": "Formatted list of available action templates"},
        ],
        "temperature": 0.4,
        "max_tokens": 600,
    },
    "recommend_entity": {
        "display_name": "Entity Recommendations (Streaming)",
        "description": "Streams a personalized recommendation for a single entity within its cluster.",
        "system": (
            "You are a personalization engine. Given an entity's specific attributes and the recommended "
            "actions for their cluster, provide a tailored recommendation for this particular entity.\n\n"
            "Note what makes this entity typical or atypical within their cluster. Be specific and "
            "actionable. One focused paragraph."
        ),
        "user_template": (
            "Entity: {entity_id}\n\n"
            "Entity attributes:\n{entity_data}\n\n"
            "This entity belongs to Cluster #{cluster_id}. The following actions have been recommended "
            "for this cluster:\n{cluster_recommendations}\n\n"
            "Provide a personalized recommendation for this specific entity."
        ),
        "variables": [
            {"name": "entity_id", "description": "Unique entity identifier"},
            {"name": "entity_data", "description": "Key-value lines of entity attributes"},
            {"name": "cluster_id", "description": "Numeric cluster label the entity belongs to"},
            {"name": "cluster_recommendations", "description": "Cluster-level recommendation text"},
        ],
        "temperature": 0.4,
        "max_tokens": 400,
    },
}


# ── Public API ────────────────────────────────────────────────────────────────

@dataclass
class PromptConfig:
    function_name: str
    system: str
    user_template: str
    model: str
    temperature: float
    max_tokens: int
    version: str
    prompt_id: str | None = None


def get_config(function_name: str) -> PromptConfig:
    """Return the active prompt + inference config for a function.

    Loads from Postgres; falls back to the embedded _DEFAULTS if the DB
    is empty, unreachable, or the function is not yet seeded.
    """
    from backend.core.settings import settings
    try:
        from backend.core.db import session_scope
        from backend.domain.models import LLMFunctionConfig, PromptTemplate

        with session_scope() as db:
            cfg = db.query(LLMFunctionConfig).filter_by(function_name=function_name).first()

            pt: PromptTemplate | None = None
            if cfg and cfg.active_prompt_id:
                pt = db.get(PromptTemplate, cfg.active_prompt_id)
            if pt is None:
                pt = (
                    db.query(PromptTemplate)
                    .filter_by(function_name=function_name, is_active=True)
                    .order_by(PromptTemplate.created_at.desc())
                    .first()
                )

            if pt is None or cfg is None:
                return _make_fallback(function_name, settings.litellm_model)

            return PromptConfig(
                function_name=function_name,
                system=pt.system_prompt,
                user_template=pt.user_template,
                model=cfg.model or settings.litellm_model,
                temperature=cfg.temperature,
                max_tokens=cfg.max_tokens,
                version=pt.version,
                prompt_id=str(pt.id),
            )
    except Exception as e:
        print(f"[prompt_store] falling back for '{function_name}': {e}")
        from backend.core.settings import settings as s
        return _make_fallback(function_name, s.litellm_model)


def _make_fallback(function_name: str, model: str) -> PromptConfig:
    fb = _DEFAULTS.get(function_name, {})
    return PromptConfig(
        function_name=function_name,
        system=fb.get("system", "You are a helpful AI assistant."),
        user_template=fb.get("user_template", "{input}"),
        model=model,
        temperature=fb.get("temperature", 0.3),
        max_tokens=fb.get("max_tokens", 600),
        version="embedded-default",
    )
