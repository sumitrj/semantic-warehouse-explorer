# Setup

Basically

```
cd docker
docker compose up --build -d
```
Should work, if it doesn't continue reading.

## Prerequisites

| Requirement | Minimum version | Notes |
|-------------|-----------------|-------|
| Python | 3.11 | 3.13 tested; 3.11+ required for `tomllib` in build tools |
| Node.js | 18 | 20+ recommended |
| Docker + Compose | any recent | needed for Postgres, MLflow, and Ollama |
| 4 GB RAM free | — | Ollama + the 3B model fits comfortably |

## Step 1 — Start the backing services

`docker/docker-compose.yml` defines four services: `postgres`, `mlflow`, `ollama`, and `frontend`.
For local development, start only the three backing services — the frontend runs with `npm run dev` (Step 3):

```bash
cd docker
docker compose up -d postgres mlflow ollama
```

Wait for the Postgres health check to go green (roughly 10 seconds):

```bash
docker compose ps   # STATE should be "healthy" for postgres
```

**Pull the default LLM model** (only needed once; ~2 GB download):

```bash
docker exec -it docker-ollama-1 ollama pull qwen2.5:3b
```

> The Ollama container name defaults to `docker-ollama-1` when started from the `docker/` directory. Run `docker ps` to confirm the name if the command above fails.

### Service URLs

| Service | Host URL | Notes |
|---------|----------|-------|
| Postgres | `localhost:5432` | App metadata |
| MLflow UI | `http://localhost:5050` | Experiment tracking UI |
| MLflow API | `http://localhost:5050` | Backend connects here (`MLFLOW_TRACKING_URI`) |
| Ollama API | `http://localhost:11434` | Local LLM inference |

> **Port note:** The MLflow container listens internally on port 5000, mapped to host port **5050** (`5050:5000`). Both `.env.example` and `MLFLOW_TRACKING_URI` use `5050`. macOS ControlCenter can bind port 5000, which is why 5050 is used.

## Step 2 — Backend

Run all commands from the repo root (`semantic-warehouse-explorer/`):

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

pip install -e .                   # installs semexp + all dependencies
```

Copy the environment template:

```bash
cp .env.example .env
```

The defaults in `.env.example` point to the Docker services started above. No edits are needed for the local Ollama setup.

Start the backend **from the repo root**:

```bash
.venv/bin/python3.13 -m uvicorn backend.api.main:app --reload --host 127.0.0.1 --port 8000
```

> **Note:** Use `python3.13 -m uvicorn` rather than `.venv/bin/uvicorn` directly — the script shebang can break if the repo is moved or renamed. Always run from the `semantic-warehouse-explorer/` directory so DuckDB's `./data/semexp.duckdb` path resolves correctly.

On first boot you will see seed output like:

```
[seed:entities] {"table": "default_entities", "status": "created", "rows": 1500}
[seed:loyalty] {"tables": ["members", "merchants", ...], "status": "seeded"}
[seed:space] sample_loyalty space ready
```

This means:
- A 1,500-row synthetic entity dataset was generated and loaded into DuckDB
- The loyalty sample tables were seeded from `sample_data/loyalty/`
- The `sample_loyalty` Table Space and its two default feature groups were created in Postgres

The backend API is now at `http://localhost:8000`.

## Step 3 — Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

Vite proxies `/api`, `/config`, `/spaces`, and `/health` to the backend at port 8000 (see `frontend/vite.config.ts`), so no CORS configuration is needed in development.

### Containerised frontend (optional)

`docker-compose.yml` also includes a `frontend` service (`Dockerfile` in `frontend/`). This is for fully containerised deployment where a `backend` service exists on the same Docker network. For local development the `npm run dev` path above is recommended — it gives hot module replacement and avoids the Docker networking constraint.

## Environment variables reference

All variables are read from `.env` (or environment) via `backend/core/settings.py`.

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_URL` | `postgresql+psycopg://semexp:semexp@localhost:5432/semexp` | SQLAlchemy connection string for Postgres |
| `DUCKDB_PATH` | `./data/semexp.duckdb` | Path to the DuckDB file |
| `MLFLOW_TRACKING_URI` | `http://localhost:5050` | MLflow tracking server (host port, not container-internal port) |
| `MLFLOW_EXPERIMENT` | `semexp` | MLflow experiment name |
| `LITELLM_MODEL` | `ollama/qwen2.5:3b` | LiteLLM model identifier (see [usage.md](usage.md#swapping-the-llm-provider) for other providers) |
| `LITELLM_API_BASE` | `http://localhost:11434` | Only required for Ollama; cloud providers auto-detect |
| `LITELLM_TIMEOUT` | `60` | Seconds before an LLM call times out |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | JSON list of allowed origins |
| `SEED_DEFAULT_DATASET` | `true` | Set to `false` to skip synthetic data generation on boot |
| `DEFAULT_DATASET_NAME` | `default_entities` | DuckDB table name for the synthetic seed dataset |
| `DEFAULT_DATASET_SIZE` | `1500` | Number of rows to generate in the synthetic dataset |

> **MLflow resilience:** All MLflow logging outside the clustering pipeline (EDA, join discovery, training schema) is best-effort. The wizard steps complete successfully even if MLflow is unreachable; affected `mlflow_run_id` columns will be `null`.

## Choosing a different LLM provider

Edit `.env` before starting the backend. No code changes are required.

**Ollama (local, default)**
```env
LITELLM_MODEL=ollama/qwen2.5:3b
LITELLM_API_BASE=http://localhost:11434
```

**OpenAI**
```env
LITELLM_MODEL=openai/gpt-4o-mini
OPENAI_API_KEY=sk-...
```

**Anthropic**
```env
LITELLM_MODEL=anthropic/claude-haiku-4-5
ANTHROPIC_API_KEY=sk-ant-...
```

**Gemini**
```env
LITELLM_MODEL=gemini/gemini-1.5-flash
GEMINI_API_KEY=...
```

## Database schema

Postgres tables are created automatically by SQLAlchemy on first boot (`Base.metadata.create_all`). There is no migration step for a fresh install. If you need schema migrations on an existing database, run Alembic (installed as a dev dependency) after writing the migration files.

## Verifying the installation

```bash
# Backend health
curl http://localhost:8000/health
# {"status": "ok", "model": "ollama/qwen2.5:3b"}

# Sources seeded
curl http://localhost:8000/api/sources
# [...{"name": "local-duckdb", "kind": "duckdb_native"}...]

# Spaces seeded
curl http://localhost:8000/spaces
# [...{"name": "sample_loyalty", "tables": ["tiers","members",...]}...]

# MLflow reachable
curl http://localhost:5050/health
# OK
```

Open the MLflow UI at `http://localhost:5050` — after your first clustering run you will see an experiment named `semexp` with one run containing params, metrics, and an `algorithm_config.json` artifact.
