"""Seed the default mock dataset into DuckDB.

Generic 'entities' table with archetype-seeded behavioral features.
Runs once on first API boot, idempotent on subsequent boots.

The columns are intentionally domain-neutral — the user will discover
their meaning by clustering, not by reading column names. This proves
the abstract-tool design.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from backend.core.duck import duck
from backend.core.settings import settings


ARCHETYPES = {
    "alpha": {"a": (18, 4), "b": (1200, 300), "c": (0.75, 0.1), "d": (5, 3),    "e": (12, 3),  "f": (0.6, 0.15), "g": (0.05, 0.02)},
    "beta":  {"a": (4, 2),  "b": (15000, 4000),"c": (0.4, 0.1),  "d": (15, 8),   "e": (5, 2),   "f": (0.9, 0.05), "g": (0.03, 0.02)},
    "gamma": {"a": (2, 1),  "b": (900, 200),  "c": (0.1, 0.05), "d": (95, 25),  "e": (1, 1),   "f": (0.5, 0.2),  "g": (0.07, 0.03)},
    "delta": {"a": (16, 3), "b": (1100, 250), "c": (0.7, 0.1),  "d": (6, 3),    "e": (3, 1),   "f": (0.05, 0.05),"g": (0.04, 0.02)},
    "eps":   {"a": (10, 3), "b": (1400, 400), "c": (0.95, 0.03),"d": (10, 5),   "e": (8, 3),   "f": (0.7, 0.15), "g": (0.06, 0.02)},
    "zeta":  {"a": (22, 5), "b": (800, 250),  "c": (0.5, 0.15), "d": (3, 2),    "e": (15, 4),  "f": (0.95, 0.03),"g": (0.35, 0.08)},
    "eta":   {"a": (14, 4), "b": (1000, 300), "c": (0.4, 0.1),  "d": (8, 4),    "e": (2, 1),   "f": (0.4, 0.2),  "g": (0.12, 0.04)},
    "theta": {"a": (1, 0.5),"b": (500, 200),  "c": (0.1, 0.05), "d": (150, 40), "e": (0.5, 0.5),"f": (0.2, 0.15),"g": (0.10, 0.05)},
}

WEIGHTS = {
    "alpha": 0.25, "beta": 0.08, "gamma": 0.15, "delta": 0.12,
    "eps": 0.13, "zeta": 0.05, "eta": 0.10, "theta": 0.12,
}

CATEGORIES = ["Type-A", "Type-B", "Type-C", "Type-D"]
TIERS = ["Tier-1", "Tier-2", "Tier-3"]
REGIONS = ["R-North", "R-South", "R-East", "R-West", "R-Central"]
LOCALES = ["en", "ja", "es", "hi", "de"]


def _draw(spec, key, low=0.0, high=None):
    mu, sigma = spec[key]
    rng = _rng()
    v = rng.normal(mu, sigma)
    v = max(v, low)
    if high is not None:
        v = min(v, high)
    return v


_RNG: np.random.Generator | None = None


def _rng() -> np.random.Generator:
    global _RNG
    if _RNG is None:
        _RNG = np.random.default_rng(42)
    return _RNG


def _reset_rng():
    global _RNG
    _RNG = np.random.default_rng(42)


def generate(n: int) -> pd.DataFrame:
    _reset_rng()
    rng = _rng()
    archs = list(ARCHETYPES.keys())
    probs = [WEIGHTS[a] for a in archs]

    rows = []
    for i in range(n):
        arch = rng.choice(archs, p=probs)
        spec = ARCHETYPES[arch]

        locale_probs = (
            [0.05, 0.30, 0.25, 0.30, 0.10] if arch == "eta"
            else [0.55, 0.10, 0.12, 0.13, 0.10]
        )

        rows.append({
            "entity_id": f"E{i:05d}",
            "category": rng.choice(CATEGORIES),
            "tier": rng.choice(TIERS, p=[0.5, 0.35, 0.15]),
            "region": rng.choice(REGIONS),
            "locale": rng.choice(LOCALES, p=locale_probs),
            "tenure_months": max(1, int(rng.normal(36, 18))),
            "metric_a": _draw(spec, "a", low=0),
            "metric_b": _draw(spec, "b", low=0),
            "metric_c": _draw(spec, "c", low=0, high=1),
            "metric_d": _draw(spec, "d", low=0),
            "metric_e": _draw(spec, "e", low=0),
            "metric_f": _draw(spec, "f", low=0, high=1),
            "metric_g": _draw(spec, "g", low=0, high=1),
            "_archetype": arch,
        })
    return pd.DataFrame(rows)


def seed_if_needed() -> dict:
    d = duck()
    table = settings.default_dataset_name
    if d.table_exists(table):
        n = int(d.sql(f"SELECT COUNT(*) AS n FROM {table}").iloc[0]["n"])
        return {"seeded": False, "table": table, "rows": n}

    df = generate(settings.default_dataset_size)
    d.write_dataframe(df, table)
    return {"seeded": True, "table": table, "rows": len(df)}


if __name__ == "__main__":
    print(seed_if_needed())
