# Semantic Warehouse Explorer

This is a unique combination of LLMs and ML algorithms along with EDA tools to perform semantic exploration of data with the user. This is designed to enable deeper diagnostic insights, and is very primitive and abstract in current design (works though).

Watch Demo Here:

[Watch Demo](https://youtu.be/Ok3ZlZ9NWwc)

[![Watch Demo](https://img.youtube.com/vi/Ok3ZlZ9NWwc/0.jpg)](https://www.youtube.com/watch?v=Ok3ZlZ9NWwc)



You point it at tabular data, define feature groups, slide weights, see clusters reshape in real time, and ask a local (or cloud) LLM
to describe what each cluster has in common. All clustering runs are logged to
MLflow for lineage.

The default boot generates a 1,500-row mock dataset into DuckDB so the loop
works end-to-end with zero configuration.

## Architecture in one paragraph

**Postgres** holds app metadata (sources, datasets, feature groups, clustering
runs, pinned versions, cached interpretations). **DuckDB** holds the analytical
data — actual rows, columnar, in-process. **MLflow** tracks every clustering
run and every LLM call. **LiteLLM** is the single chokepoint for all LLM calls;
swap providers via one env var. **FastAPI + SQLAlchemy** backend with one
`BaseRepository[T]` from which every concrete repo inherits. **Vite + React**
frontend talks to the backend over a proxied `/api`.

## Run it

### 1. Bring up the supporting services

```bash
cd docker
docker compose up -d
# wait for postgres healthcheck; then pull the model:
docker exec -it docker-ollama-1 ollama pull qwen2.5:3b
```

### 2. Backend

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .
cp .env.example .env
# edit .env if you want to use OpenAI / Anthropic / Gemini instead of Ollama
uvicorn backend.api.main:app --reload --port 8000
```

On first boot you'll see `[seed] {...}` — the default dataset gets generated
into DuckDB, a Source/Dataset are auto-registered in Postgres, and five
heuristic feature groups (`structural`, `behavioral`, `recency`, `engagement`,
`fairness`) are created.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

## What you'll see

- Five sliders, one per feature group, plus an `n_clusters` slider.
- Sliding any of them re-runs the clustering (debounced ~350ms) and the
  scatter plot reshapes. Identical configs hit the Postgres cache —
  re-runs are instant.
- Click a cluster in the legend or any point in it → right panel shows
  size and an "Ask LLM" button.
- Clicking that calls the `describe_cluster` cognitive function. The
  result is cached in Postgres keyed by `(run_id, cluster_id)`, so the
  same cluster never gets re-described unless you `refresh=true`.

## The data flow

```
Source (config)
   ↓ ingest via adapter
DuckDB table
   ↓ feature_extractor (weighted)
NumPy matrix
   ↓ KMeans + PCA(2)
ClusteringRun (Postgres) + MLflow run + cached config hash
   ↓ cluster centroid profile (z-score vs population)
describe_cluster (LLM via LiteLLM)
   ↓ structured JSON output, schema-validated
Interpretation (cached in Postgres)
```

## Swap the LLM provider

One env var:

```bash
# Local default
LITELLM_MODEL=ollama/qwen2.5:3b
LITELLM_API_BASE=http://localhost:11434

# OpenAI
LITELLM_MODEL=openai/gpt-4o-mini
OPENAI_API_KEY=sk-...

# Anthropic
LITELLM_MODEL=anthropic/claude-haiku-4-5
ANTHROPIC_API_KEY=sk-ant-...

# Gemini
LITELLM_MODEL=gemini/gemini-1.5-flash
GEMINI_API_KEY=...
```

No code changes anywhere. The cognitive function still gets structured JSON
back, MLflow still logs the call, and the cache key includes the model name.

## Extending

**Add a source kind.** Subclass `SourceAdapter` in `backend/data/adapters/`,
register it in `adapters/__init__.py`. The repository, service, route, and
frontend Source picker all work without changes.

**Add a clustering algorithm.** Branch in `clustering_service.run_clustering()`.
Algorithm name flows through to MLflow params and the config hash automatically.

**Add a cognitive function.** Drop a file in `backend/ai/functions/`, follow
the `describe_cluster` pattern (Pydantic input/output models, prompt template
in `ai/prompts/`, JSON schema, call `tracked_complete`). Wire it through a new
service and a new route.

**Promote a run to production.** A `PinnedClustering` row in Postgres marks a
run as production-grade. The service to do this is left as a one-liner —
hook it up when you want the exploration / production boundary enforced.

## Key abstractions

- `BaseRepository[T]` (`backend/core/repository.py`) — generic CRUD over
  any SQLAlchemy model. Every concrete repo is ~5 lines.
- `SourceAdapter` (`backend/data/adapters/base.py`) — every source kind
  implements `ingest()` and `preview()`. Domain stays abstract.
- `FeatureGroup` (Postgres entity) — user-defined column grouping. The
  reweighting UI operates on these; no hardcoded domain assumptions.
- `complete_structured()` (`backend/ai/llm.py`) — single LLM chokepoint.
  Enforces JSON output, validates against Pydantic, logs to MLflow.
- `ClusteringRun.config_hash` — content-addressed caching. The same
  (dataset + weights + algorithm + params) always returns the same run.

## Repository layout

```
backend/
├── core/             repository base, db setup, duckdb wrapper, mlflow, settings
├── domain/           SQLAlchemy models (one file in this skeleton)
├── repositories/     thin per-entity repos, all extend BaseRepository[T]
├── data/             source adapters + feature extractor
├── services/         orchestration (source, clustering, interpretation)
├── ai/               LLM chokepoint, cognitive functions, prompts, tracking
├── ops/              seed job
└── api/              FastAPI app, routes, schemas

frontend/
└── src/
    ├── api/          typed client to /api
    ├── pages/        Explorer (the only page in this skeleton)
    └── main.tsx
```

## Known limitations

- Single-page frontend. Wizard flow (Source → Pipeline → Clustering →
  Recommendations) is collapsed into one screen; expand when you have UX bandwidth.
- Pipeline / preprocessing entity exists in the data model but isn't yet
  wired into the clustering path (extractor does standardize + one-hot inline).
- Recommendations layer is not implemented — only cluster interpretation.
  Adding it is a second cognitive function plus an `Action` rule engine.
- Unity Catalog adapter is a stub.
- No auth. Don't expose this outside localhost without adding one.
