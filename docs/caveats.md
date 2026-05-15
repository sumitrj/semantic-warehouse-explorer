# Caveats

## Known limitations

### Backend must run from the repo root

Uvicorn must be started from the `semantic-warehouse-explorer/` directory so that relative imports and the DuckDB file path (`./data/semexp.duckdb`) resolve correctly. If the `.venv` scripts have a stale shebang (e.g., after the repo was moved or renamed), use `python3.13 -m uvicorn` directly:

```bash
cd semantic-warehouse-explorer
.venv/bin/python3.13 -m uvicorn backend.api.main:app --reload --host 127.0.0.1 --port 8000
```

Prompt templates are stored in Postgres and no longer depend on file paths — LLM endpoints will not 500 due to missing `.txt` files.

### Pipeline preprocessing is defined but not active

`Pipeline` and its `steps` JSONB column are modelled and persisted, but `run_clustering()` does not currently apply any pipeline to the data before extracting features. The feature extractor does inline standardization and one-hot encoding. To activate pipelines, you would need to apply the step list inside `feature_extractor.py` before the sklearn transforms.

### Unity Catalog adapter is a stub

`backend/data/adapters/unity_catalog.py` raises `NotImplementedError`. If you need Databricks Unity Catalog ingestion, implement `ingest()` using the Unity Catalog REST API or a JDBC/ODBC driver.

### Parquet adapter is not written

The `SourceKind.parquet` enum value exists but there is no corresponding adapter class. Reading a local or remote Parquet file via DuckDB is straightforward — DuckDB can `SELECT * FROM 'path/to/file.parquet'` natively.

### No authentication

The API has no auth layer. All endpoints are publicly accessible to anyone who can reach port 8000. Do not expose this service outside localhost without adding authentication (e.g., HTTP Basic via an Nginx reverse proxy, OAuth2 via FastAPI's built-in security, or an API gateway).

### In-process DuckDB concurrency

DuckDB runs as a single file opened by one process. Concurrent write access from multiple backend workers (e.g., `uvicorn --workers 4`) will fail. In development this is not a problem because `--reload` implies a single worker. For production with multiple workers, either:
- Use a single Uvicorn worker for the DuckDB process, or
- Switch to a DuckDB server (MotherDuck, or a dedicated DuckDB server process), or
- Use a different OLAP backend

### Postgres schema migrations

Tables are created with `Base.metadata.create_all()` on startup. This is safe for a fresh database but does **not** apply schema changes to an existing database. If you add a column to a model, you must write and run an Alembic migration. Alembic is installed as a dev dependency but no migration files ship in this skeleton.

### Silhouette score is approximate

For large datasets, silhouette is computed on a random sample of up to 1,000 points (`sample_size=min(1000, n_valid)`). This is fast but can vary between runs if sampling is non-deterministic. The random seed is fixed at 42 so results are reproducible for a given dataset and label set.

### DBSCAN cluster IDs include -1 (noise)

DBSCAN labels outliers as cluster `-1`. The scatter plot renders these as a "Noise" dataset. The centroid profile and LLM interpretation endpoints accept `-1` as a valid `cluster_id`, but the LLM prompt was written for named clusters and may produce less meaningful output for the noise group.

### LLM output normalization is heuristic

`_normalize_output()` in `describe_cluster.py` handles small local models (like `qwen2.5:3b`) that sometimes return `characteristics` entries as dicts instead of strings. The normalization tries several common dict keys (`text`, `value`, `label`, `description`, `summary`) before falling back to joining all key-value pairs. Larger models (GPT-4o, Claude, Gemini) reliably produce plain strings.

### No streaming cache

The SSE narrative stream (`interpret/stream`) is never cached. Each click streams a fresh LLM call. Only the structured interpretation is cached in Postgres. If you want to cache narrative text, add a `narrative` column to `Interpretation` and write it after the stream completes.

### MLflow is optional but not invisible

EDA (`log_eda_run`), join discovery (`log_join_discovery_run`), and training schema (`log_schema_run`) all catch MLflow errors and return an empty `run_id` instead of raising. The wizard steps will complete successfully even if MLflow is down, but no lineage is recorded. The `mlflow_run_id` column on the affected records will be `null`. For clustering and LLM calls, the safe `mlrun()` wrapper in `backend/core/mlflow_client.py` provides the same behaviour.

### Columns ending in `_id` are silently dropped from feature extraction

`feature_extractor.py` calls `_looks_like_id()` which drops any column whose name ends in `_id` (plus common names like `id`, `uuid`, `partner_id`). This applies even to columns the user explicitly added to a feature group — for example, `tier_id` in the `value_segment` group will not appear in the clustering matrix. Rename the column or add its decoded counterpart (e.g., `tier_name`) to include the signal.

### MLflow child run nesting

MLflow child runs for LLM calls are opened with `mlflow.start_run(nested=True)`. If the backend is started without an active MLflow run context, child run creation silently skips. The clustering parent run is always created; LLM child runs are best-effort.

### Space description is not automatically refreshed

`TableSpace.description` is generated once when the space is seeded and is not automatically regenerated when tables or column annotations change. Call `refresh_description(db, space)` from `backend/services/space_service.py` explicitly after significant schema or EDA changes.

---

## Performance notes

### Cold start

The first clustering run after boot is the slowest because:
1. DuckDB opens the file and loads data into memory
2. sklearn's KMeans runs with `n_init=10` (10 random restarts)
3. MLflow logs params and artifacts over the network to the Docker container

Subsequent runs with identical configs return from the Postgres cache in < 5 ms.

### Large datasets

The feature extractor loads the entire table into a pandas DataFrame in memory. For tables larger than ~500 MB, consider:
- Using DuckDB's `USING SAMPLE n` clause (the `sample` parameter of `extract()` supports this)
- Running MiniBatchKMeans instead of KMeans for the initial exploration
- Chunked ingestion rather than a single `SELECT *`

### LLM latency

| Provider | Typical latency (3B-equivalent) |
|----------|---------------------------------|
| Ollama (local, M-series Mac) | 5–30 seconds |
| OpenAI gpt-4o-mini | 1–4 seconds |
| Anthropic claude-haiku-4-5 | 1–3 seconds |
| Gemini gemini-1.5-flash | 1–3 seconds |

The `LITELLM_TIMEOUT` setting (default 60 seconds) controls the hard timeout. Increase it for large prompts or slow hardware.

---

## Security considerations

- **No input sanitization for DuckDB queries** beyond column name inclusion in SQL strings — all column names come from the Postgres `FeatureGroup.columns` list, not from user-supplied query parameters, so the attack surface is small. Still, do not expose the API publicly without auth.
- **CORS** is restricted to `["http://localhost:5173"]` by default. Update `CORS_ORIGINS` if you deploy the frontend elsewhere.
- **API keys** are read from environment variables and never logged or stored. Do not commit a `.env` file containing real keys.
- **MLflow** has no built-in authentication. The Docker container is only accessible on localhost by default.
- **DuckDB file** is stored at `./data/semexp.duckdb`. It contains all ingested row data. Protect it accordingly in any non-local deployment.
