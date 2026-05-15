# Purpose

## What is semexp?

**semexp** (Semantic Explorer) is an interactive, domain-agnostic clustering tool for tabular data. It lets you:

- Point at any tabular dataset (DuckDB, Postgres, Parquet, Unity Catalog)
- Define logical groupings of columns called *feature groups*
- Slide per-group weight sliders and watch clusters reshape in real time
- Select a cluster and ask a local or cloud LLM to describe what makes it distinctive
- Track every clustering run and LLM call to MLflow for full lineage

The tool is intentionally domain-free. It does not assume your data is about customers, sensors, or transactions — you name the groups yourself, and the reweighting UI operates on those names. The LLM interpretation uses the same abstraction: it reasons from z-score profiles, not hard-coded domain knowledge.

## The problem it solves

Exploratory cluster analysis is usually awkward:

- You write a notebook, hard-code weights, run KMeans, look at a PCA plot, change a number, re-run
- There is no audit trail linking the plot you liked to the exact parameters that produced it
- Describing *why* a cluster is interesting requires a human writing prose for every run
- Switching from Ollama to OpenAI means changing code

semexp collapses this into one interactive loop:

```
Slide a weight → debounced re-cluster → scatter plot updates → click cluster → LLM describes it
```

Every run is content-addressed (config hash), so identical sliders never re-compute. MLflow captures every parameter and metric automatically.

## Core design goals

| Goal | How it is achieved |
|------|--------------------|
| Domain-agnostic | Feature groups are user-defined; no hardcoded column names outside the seed job |
| Reproducible | `ClusteringRun.config_hash` — same (dataset + weights + algorithm + params) always returns the same stored run |
| Provider-swappable LLM | All LLM calls go through LiteLLM; one `LITELLM_MODEL` env var chooses the provider |
| Full lineage | MLflow logs params, metrics, and algorithm artifacts for every run and LLM call |
| Extensible | `SourceAdapter`, `ClusteringAlgorithm`, and cognitive function patterns each have a single well-defined extension point |

## Who should use it

- **Data scientists** exploring a new dataset to understand natural groupings before building supervised models
- **Analysts** who need interpretable, LLM-narrated cluster segments for a report
- **Engineers** who want a reference architecture for a FastAPI + DuckDB + MLflow + LiteLLM stack
- **Teams** evaluating local vs cloud LLMs for structured data interpretation tasks
