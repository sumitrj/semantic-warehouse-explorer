"""Concrete repositories — thin extensions of BaseRepository[T]."""
from __future__ import annotations

from backend.core.repository import BaseRepository
from backend.domain import (
    Source, Dataset, FeatureGroup, Pipeline,
    ClusteringRun, PinnedClustering, Interpretation,
    Action, Recommendation,
)


class SourceRepository(BaseRepository[Source]):
    model = Source

    def by_name(self, name: str) -> Source | None:
        return self.find_one(name=name)


class DatasetRepository(BaseRepository[Dataset]):
    model = Dataset

    def by_name(self, name: str) -> Dataset | None:
        return self.find_one(name=name)


class FeatureGroupRepository(BaseRepository[FeatureGroup]):
    model = FeatureGroup

    def for_dataset(self, dataset_id) -> list[FeatureGroup]:
        return self.find_by(dataset_id=dataset_id)


class PipelineRepository(BaseRepository[Pipeline]):
    model = Pipeline

    def for_dataset(self, dataset_id) -> list[Pipeline]:
        return self.find_by(dataset_id=dataset_id)


class ClusteringRunRepository(BaseRepository[ClusteringRun]):
    model = ClusteringRun

    def by_config_hash(self, config_hash: str) -> ClusteringRun | None:
        return self.find_one(config_hash=config_hash)

    def for_dataset(self, dataset_id) -> list[ClusteringRun]:
        return self.find_by(dataset_id=dataset_id)


class PinnedClusteringRepository(BaseRepository[PinnedClustering]):
    model = PinnedClustering

    def active(self) -> list[PinnedClustering]:
        return self.find_by(status="active")


class InterpretationRepository(BaseRepository[Interpretation]):
    model = Interpretation

    def for_run(self, clustering_run_id) -> list[Interpretation]:
        return self.find_by(clustering_run_id=clustering_run_id)

    def for_cluster(self, clustering_run_id, cluster_id: int) -> Interpretation | None:
        return self.find_one(clustering_run_id=clustering_run_id, cluster_id=cluster_id)


class ActionRepository(BaseRepository[Action]):
    model = Action

    def enabled(self) -> list[Action]:
        return self.find_by(enabled=True)

    def by_name(self, name: str) -> Action | None:
        return self.find_one(name=name)


class RecommendationRepository(BaseRepository[Recommendation]):
    model = Recommendation

    def for_cluster(self, run_id, cluster_id: int) -> Recommendation | None:
        return self.find_one(clustering_run_id=run_id, cluster_id=cluster_id, entity_id=None)

    def for_entity(self, run_id, cluster_id: int, entity_id: str) -> Recommendation | None:
        return self.find_one(clustering_run_id=run_id, cluster_id=cluster_id, entity_id=entity_id)

    def for_run(self, run_id) -> list[Recommendation]:
        return self.find_by(clustering_run_id=run_id)
