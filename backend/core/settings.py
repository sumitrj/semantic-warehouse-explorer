"""Application settings, loaded from environment variables.

Single source of truth for config. Anything else reads from `settings`.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Postgres (app metadata)
    postgres_url: str = "postgresql+psycopg://semexp:semexp@localhost:5432/semexp"

    # DuckDB (OLAP)
    duckdb_path: str = "./data/semexp.duckdb"

    # MLflow
    mlflow_tracking_uri: str = "http://localhost:5000"
    mlflow_experiment: str = "semexp"

    # LLM via LiteLLM
    # Examples:
    #   ollama/qwen2.5:3b
    #   openai/gpt-4o-mini
    #   anthropic/claude-haiku-4-5
    #   gemini/gemini-1.5-flash
    litellm_model: str = "ollama/qwen2.5:3b"
    litellm_api_base: str | None = None  # for Ollama: http://localhost:11434
    litellm_timeout: int = 60

    # App
    cors_origins: list[str] = ["http://localhost:5173"]
    seed_default_dataset: bool = True
    default_dataset_name: str = "default_entities"
    default_dataset_size: int = 1500


settings = Settings()
