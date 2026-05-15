# Usage

## Overview of the UI

The frontend is a single-page React application at `http://localhost:5173`. It has a persistent top navigation bar with a **Space selector** and five main pages:

| Page | Route | Purpose |
|------|-------|---------|
| Explorer | `/` (default) | Interactive clustering scatter plot |
| Sources | `/sources` | Manage data sources and feature groups |
| Preprocessing | `/preprocessing` | Inspect and define preprocessing pipelines |
| Actions | `/actions` | Define and manage action templates |
| Recommendations | `/recommendations` | Browse LLM-generated cluster/entity recommendations |
| Config Wizard | `/config` | Step-by-step guided setup for new data sources |

---

## The Explorer (primary workflow)

### Layout

The Explorer is a three-panel layout:

```
┌──────────────┬───────────────────────────────┬──────────────┐
│  Left sidebar│         Scatter plot           │ Cluster panel│
│  (controls)  │         (Chart.js PCA)         │ (detail view)│
└──────────────┴───────────────────────────────┴──────────────┘
```

### Left sidebar

**Space indicator** — shows the active Table Space (e.g., "Loyalty Programme"), how many tables it groups, and which table is the entity table used for clustering.

**Algorithm selector** — choose from:

| Algorithm | Best for |
|-----------|----------|
| K-Means | Roughly spherical, similar-sized clusters |
| DBSCAN | Irregular shapes, outlier detection (noise label = -1) |
| Agglomerative | Hierarchical / nested structure |
| Gaussian Mixture | Overlapping or varying-density clusters |

Each algorithm exposes its own parameter sliders or dropdowns (e.g., `n_clusters`, `eps`, `min_samples`, `linkage`, `covariance_type`). Hovering over the algorithm name shows its description.

**Feature weight sliders** — one slider per feature group, range 0–3. A weight of `0` removes that group's columns from the matrix; `3` triples their influence. Hovering over a slider shows which raw columns belong to that group.

**Run stats** (appears after clustering) — silhouette score, cluster count, row count, PCA explained variance, and a truncated MLflow run ID.

### How clustering is triggered

Clustering re-runs automatically ~450 ms after any slider changes (debounced). Identical configurations return immediately from the Postgres cache. You can also manually trigger a run with the refresh button (↺) in the chart header.

### Scatter plot

The scatter plot renders PCA-reduced 2D projections of every row. Each cluster is a distinct color from a 15-color palette. Points for the selected cluster are enlarged and outlined; all other clusters are dimmed to 25% opacity.

Click any point or the cluster chips in the legend bar to open the detail panel.

### Cluster chips (legend bar)

Below the scatter plot, one chip per cluster shows its label and member count (e.g., `C0: 312`). Click a chip to open that cluster's detail panel.

---

## Cluster detail panel

Opens on the right when you click a cluster. It loads the centroid profile immediately (no LLM required) and offers two LLM interaction modes.

### Distinguishing features

A ranked list of the top 8 features sorted by absolute z-score. Each row shows:
- Direction arrow (green = above average, red = below average)
- Feature name (hover for exact cluster mean, overall mean, and z-score)
- A proportional bar representing deviation magnitude
- The z-score value (e.g., `+2.14σ`)

### Centroid values

A scrollable table of exact post-standardization centroid values for every feature in the matrix.

### LLM interactions

**Narrate** — streams a free-form narrative interpretation token-by-token (SSE). The result is displayed in the "Narrative" tab. Not cached — each click streams a fresh response.

**Structured** — calls the `describe_cluster` cognitive function synchronously, validates the JSON output against a Pydantic schema, and caches the result in Postgres. The "Structured" tab shows:
- Confidence badge: `high`, `medium`, or `low`
- Model used (from the LLM response metadata)
- Headline (one-line cluster name)
- 2–4 bullet-point characteristics

Subsequent clicks on **Structured** for the same cluster return the cached interpretation instantly. Pass `refresh=true` to force a new LLM call.

---

## Table Spaces

A **Table Space** groups related DuckDB tables under a single named scope. The active space is selected from the top navigation bar.

The default space `sample_loyalty` groups:
- `members` (primary / entity table)
- `tiers`, `merchants`, `transactions`, `rewards`

When you switch spaces, the Explorer automatically loads the matching dataset and feature groups for the space's primary table.

The space also carries a **description** — auto-generated markdown that summarises the tables and their relationships. This description is injected into LLM prompts to give the model domain context without hardcoding anything in the prompts.

---

## Sources page

The Sources page lists registered data sources and lets you:
- View all sources and their datasets
- Register a new source
- Ingest a dataset from a source into DuckDB
- Create, edit, and delete feature groups

**Feature groups** are the central concept in the reweighting UI. Each group has:
- A name (used as the slider label)
- A list of column names
- A default weight (0–3)
- An optional description (shown as a tooltip)

---

## Config Wizard

The five-step config wizard guides you through connecting a new data source:

| Step | What happens |
|------|-------------|
| 1 — Data Source | Choose source kind and connection details |
| 1b — Space | Name and describe the Table Space |
| 2 — Table Explorer | Browse and select which tables to include |
| 3 — EDA | Run auto-profiling (null %, distinct count, semantic type detection) |
| 4 — Associations | Auto-discover join candidates between tables based on name similarity and value overlap |
| 5 — ML Config | Choose exploration (clustering) or prediction mode, set algorithm defaults |

---

## Swapping the LLM provider

No code changes are required. Set the appropriate env vars in `.env` and restart the backend.

```bash
# Local Ollama (default)
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

The LLM chokepoint (`backend/ai/llm.py`) reads these at call time. The cache key in Postgres includes the model name, so switching providers does not accidentally serve cached results from a different model.

---

## Checking MLflow lineage

Open `http://localhost:5050` (the MLflow UI). Every clustering run creates one parent run in the `semexp` experiment with:

| MLflow artifact / param | Value |
|------------------------|-------|
| `dataset` | Dataset name |
| `algorithm` | e.g., `kmeans` |
| `param.n_clusters` | Algorithm parameter |
| `weight.<group>` | Per-group weight at run time |
| `n_rows`, `n_features` | Matrix shape |
| `silhouette` | Silhouette score (if > 1 cluster) |
| `n_clusters_effective` | Actual cluster count (DBSCAN may differ from requested) |
| `pca_var_ratio` | PCA 2-component explained variance |
| `algorithm_config.json` | Algorithm name + params artifact |

LLM calls are logged as child runs under the parent clustering run.

---

## Promoting a run to production

A `PinnedClustering` record in Postgres marks a clustering run as production-grade. The data model and repository are wired up — you can create a pinned run directly via the API:

```bash
POST /api/clusterings/{run_id}/pin
# (not yet exposed in the UI — hook it up when needed)
```

See [additional_notes.md](additional_notes.md#promoting-a-run-to-production) for the service-level details.
