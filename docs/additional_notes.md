# Additional Notes

## Extending the system

### Adding a new source kind

1. Create `backend/data/adapters/my_adapter.py` and subclass `SourceAdapter`:

```python
from backend.data.adapters.base import SourceAdapter

class MyAdapter(SourceAdapter):
    def ingest(self, duckdb_table: str) -> None:
        # pull data from your source, write into DuckDB
        df = ...  # pandas DataFrame
        duck().conn.execute(f"CREATE OR REPLACE TABLE {duckdb_table} AS SELECT * FROM df")

    def preview(self) -> list[dict]:
        # return up to ~20 sample rows for the wizard UI
        return duck().sql(f"SELECT * FROM my_table LIMIT 20").to_dict(orient="records")
```

2. Add your kind to `SourceKind` in `backend/domain/models.py`:

```python
class SourceKind(str, Enum):
    ...
    my_kind = "my_kind"
```

3. Register the adapter in `backend/data/adapters/__init__.py`:

```python
from .my_adapter import MyAdapter

ADAPTER_REGISTRY = {
    "duckdb_native": DuckDBNativeAdapter,
    "postgres": PostgresAdapter,
    "my_kind": MyAdapter,
}
```

The source repository, service, API route, and frontend Source picker all work without changes. The `SourceIn` schema already accepts any string for `kind`.

---

### Adding a new clustering algorithm

Open `backend/services/algorithms.py`, subclass `ClusteringAlgorithm`, and add to `REGISTRY`:

```python
from sklearn.cluster import Birch

class BirchAlgorithm(ClusteringAlgorithm):
    meta = AlgorithmMeta(
        name="birch",
        display_name="BIRCH",
        description="Memory-efficient hierarchical clustering for large datasets.",
        params={
            "n_clusters": ParamSpec(type="int", default=3, min=2, max=20, step=1, label="Clusters"),
            "threshold": ParamSpec(type="float", default=0.5, min=0.1, max=2.0, step=0.1, label="Threshold"),
        },
    )

    def run(self, X, params):
        model = Birch(
            n_clusters=int(params.get("n_clusters", 3)),
            threshold=float(params.get("threshold", 0.5)),
        )
        labels = model.fit_predict(X)
        return labels, {}

REGISTRY["birch"] = BirchAlgorithm()
```

The algorithm name flows automatically into:
- The frontend algorithm dropdown (via `GET /api/algorithms`)
- MLflow params (`algorithm`, `param.*`)
- The config hash (so birch runs never collide with kmeans runs)
- The `ClusteringRun.algorithm` column

---

### Adding a new cognitive function

Cognitive functions follow the pattern in `backend/ai/functions/describe_cluster.py`.

1. **Create the prompt templates** in `backend/ai/prompts/`. Split system and user with `\n---\n`.

2. **Define Pydantic I/O models**:

```python
class MyFunctionInput(BaseModel):
    cluster_id: int
    size: int
    # ... whatever fields you need

class MyFunctionOutput(BaseModel):
    result: str
    confidence: Literal["high", "medium", "low"]
```

3. **Define the JSON schema** (used to instruct the LLM):

```python
OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "result": {"type": "string"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
    },
    "required": ["result", "confidence"],
}
```

4. **Implement the function** using `tracked_complete`:

```python
from backend.ai.tracking import tracked_complete
from backend.ai.llm import validate_against_model

def my_function(payload: MyFunctionInput) -> MyFunctionOutput:
    system = "..."
    user = "..."
    resp = tracked_complete(
        function_name="my_function",
        prompt_version="v1",
        system=system,
        user=user,
        schema=OUTPUT_SCHEMA,
        temperature=0.2,
        max_tokens=500,
    )
    return validate_against_model(resp.content, MyFunctionOutput)
```

5. **Wire it up**: add a service function that calls your cognitive function, a new repository method to cache results, and a new route.

---

### Adding a new API route

Create `backend/api/routes/my_resource.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.core.db import get_session

router = APIRouter(prefix="/api", tags=["my_resource"])

@router.get("/my-resource")
def list_things(db: Session = Depends(get_session)):
    ...
```

Register in `backend/api/main.py`:

```python
from backend.api.routes import my_resource
app.include_router(my_resource.router)
```

---

### Promoting a run to production

A `PinnedClustering` row marks a run as production-grade. The repository is already implemented in `backend/repositories/`. To expose this:

1. Add a service function:

```python
def pin_clustering(session, run_id, name, notes=None):
    return PinnedClusteringRepository(session).create(
        clustering_run_id=run_id,
        name=name,
        version=1,
        status="candidate",
        notes=notes,
    )
```

2. Add a route `POST /api/clusterings/{run_id}/pin`

3. Use `status` transitions (`candidate` → `production` → `archived`) to enforce the exploration/production boundary in downstream consumers.

---

### Extending the EDA service

`backend/services/eda_service.py` profiles columns using DuckDB queries (no LLM). It produces `ColumnAnnotation` records with:
- `dtype` — DuckDB column type string
- `semantic_type` — auto-detected (`id`, `numeric`, `categorical`, `text`, `datetime`, `boolean`)
- `null_pct`, `distinct_count`, `distinct_pct`, `total_rows`
- `stats` — JSONB with `min`, `max`, `mean`, `std`, `top_values`

To add a new auto-detection rule, edit the `_infer_semantic_type(col, dtype, total, distinct)` function in that file.

---

### Extending join discovery

`backend/services/join_service.py` finds join candidates using three heuristics (no LLM):
- **Name match** — column names are identical or share a common suffix (e.g., `member_id` ↔ `id`)
- **Value overlap** — what fraction of values in one column exist in the other
- **Subset check** — one column's value set is a subset of the other's

The confidence score is `0.35 * name_score + 0.40 * subset_score + 0.25 * overlap_score`. To add a new signal, extend `_name_score()` or `_overlap_and_subset()` and adjust the weights in `discover_joins()`.

---

## The loyalty sample dataset

`sample_data/loyalty/` contains five CSV files representing a simplified loyalty programme schema:

| File | Description |
|------|-------------|
| `members.csv` | Primary entity table — members with tier, engagement score, lifecycle status |
| `tiers.csv` | Tier definitions |
| `merchants.csv` | Merchant catalogue |
| `transactions.csv` | Member transaction history |
| `rewards.csv` | Reward redemptions |

`backend/ops/seed_loyalty.py` loads these into DuckDB on startup (idempotent — skipped if the `members` table already exists). `backend/ops/loyalty_data.py` defines the schema and can regenerate synthetic data if needed.

The `sample_loyalty` Table Space uses `members` as the primary (entity) table and comes with two feature groups:

| Group | Columns | Default weight | Purpose |
|-------|---------|---------------|---------|
| `value_segment` | `tier_id`, `engagement_score` | 1.8 | Separates casual, core, and high-value members |
| `lifecycle` | `lifecycle_status` | 1.2 | Lifecycle persona label for visible clustering |

---

## The synthetic default dataset

`backend/ops/seed.py` generates a 1,500-row synthetic entity dataset into DuckDB at boot if it does not already exist. The schema includes:

- `entity_id` — UUID primary key
- `tenure_months`, `category`, `tier`, `region` — structural features
- `metric_a`, `metric_b`, `metric_c` — behavioral metrics
- `metric_d` — recency metric
- `metric_e`, `metric_f` — engagement metrics
- `metric_g`, `locale` — fairness features

This dataset seeds the five default feature groups (`structural`, `behavioral`, `recency`, `engagement`, `fairness`) so the Explorer works end-to-end with zero configuration.

---

## Developer tools

### Running the smoke test

```bash
python -m backend.tools.smoke
```

`backend/tools/smoke.py` runs a minimal end-to-end check: connects to DuckDB, runs a query, verifies the feature extractor returns a non-empty matrix.

### Linting

```bash
ruff check backend/ frontend/src/
ruff format backend/
```

The project uses `ruff` with a 100-character line limit.

### Running tests

```bash
pytest
```

Tests live in any `test_*.py` files (none ship in the skeleton — add them alongside the code they test).
