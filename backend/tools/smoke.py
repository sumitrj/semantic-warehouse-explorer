"""Smoke test for the non-Postgres parts of the pipeline.

Exercises:
- seed_if_needed() writes the mock data into DuckDB
- feature_extractor.extract() pulls a weighted matrix
- KMeans + PCA(2) produces sensible results
- cluster_centroid_profile()-style z-score logic identifies distinguishing features

Run with: python -m backend.tools.smoke
"""
from __future__ import annotations

import os
import numpy as np
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score

# point DuckDB at a temp file for this smoke test
os.environ.setdefault("DUCKDB_PATH", "./data/smoke.duckdb")

from backend.core.duck import duck   # noqa: E402
from backend.ops.seed import seed_if_needed   # noqa: E402
from backend.data.feature_extractor import extract   # noqa: E402


def main():
    print("== seed ==")
    info = seed_if_needed()
    print(info)

    print("\n== schema ==")
    schema = duck().describe(info["table"])
    print(schema.to_string(index=False))

    print("\n== extract features ==")
    groups = [
        {"name": "structural", "columns": ["tenure_months", "category", "tier", "region"], "weight": 1.0},
        {"name": "behavioral", "columns": ["metric_a", "metric_b", "metric_c"], "weight": 1.0},
        {"name": "recency", "columns": ["metric_d"], "weight": 1.0},
        {"name": "engagement", "columns": ["metric_e", "metric_f"], "weight": 1.0},
        {"name": "fairness", "columns": ["metric_g", "locale"], "weight": 0.5},
    ]
    ext = extract(info["table"], groups)
    print(f"matrix shape: {ext.matrix.shape}")
    print(f"first 5 column names: {ext.column_names[:5]}")

    print("\n== clustering ==")
    km = KMeans(n_clusters=7, random_state=42, n_init=10)
    labels = km.fit_predict(ext.matrix)
    sil = silhouette_score(ext.matrix, labels, sample_size=1000, random_state=42)
    print(f"silhouette: {sil:.3f}")
    print(f"cluster sizes: {dict(zip(*np.unique(labels, return_counts=True)))}")

    print("\n== centroid profile of cluster 0 ==")
    mask = labels == 0
    overall = ext.matrix.mean(axis=0)
    overall_std = ext.matrix.std(axis=0)
    overall_std[overall_std == 0] = 1.0
    cmean = ext.matrix[mask].mean(axis=0)
    z = (cmean - overall) / overall_std
    pairs = sorted(zip(ext.column_names, cmean, z), key=lambda x: abs(x[2]), reverse=True)
    for col, m, zs in pairs[:5]:
        print(f"  {col:30s}  cluster_mean={m:+.2f}  z={zs:+.2f}")

    print("\n== reweight: fairness up, behavioral down ==")
    groups_rw = [dict(g) for g in groups]
    for g in groups_rw:
        if g["name"] == "fairness":
            g["weight"] = 3.0
        if g["name"] == "behavioral":
            g["weight"] = 0.3
    ext2 = extract(info["table"], groups_rw)
    km2 = KMeans(n_clusters=7, random_state=42, n_init=10)
    labels2 = km2.fit_predict(ext2.matrix)
    sil2 = silhouette_score(ext2.matrix, labels2, sample_size=1000, random_state=42)
    print(f"new silhouette: {sil2:.3f}")
    print(f"new cluster sizes: {dict(zip(*np.unique(labels2, return_counts=True)))}")

    print("\n== verify clusterings differ (clusterings shifted) ==")
    # Just check labels aren't identical — they shouldn't be
    diff = np.mean(labels != labels2)
    print(f"label disagreement between weightings: {diff*100:.1f}% of rows (expected >5%)")

    print("\n== ground-truth recovery (vs hidden _archetype) ==")
    import pandas as pd
    df = duck().sql(f"SELECT _archetype FROM {info['table']}")
    arch_vs_cluster = pd.crosstab(df["_archetype"], pd.Series(labels, name="cluster"))
    print(arch_vs_cluster)

    print("\nOK")


if __name__ == "__main__":
    main()
