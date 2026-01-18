"""
Benchmark Scorer for Flowbaby Retrieval Evaluation (Step 2)

Implements scoring harness using ir_measures + pytrec_eval for:
- Recall@K, Precision@K, MRR, MAP@K, nDCG@K

All computation is offline-only (no network, no LLM calls).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any

import ir_measures
from ir_measures import Recall, Precision, RR, AP, nDCG

from benchmark.benchmark_contract import (
    BenchmarkDataset,
    Run,
    RunSummary,
)


# Default K values tied to Flowbaby UX surfaces
# K=5 is primary because chat/command surfaces show top-5 retrieved items
DEFAULT_K_VALUES: list[int] = [5, 10, 20]


@dataclass
class ScorerConfig:
    """Configuration for the benchmark scorer."""

    k_values: list[int] = field(default_factory=lambda: DEFAULT_K_VALUES.copy())
    metrics: list[str] = field(
        default_factory=lambda: ["recall", "precision", "mrr", "map", "ndcg"]
    )
    relevance_mode: str = "binary"  # "binary" or "graded"

    def __post_init__(self):
        if not self.k_values:
            self.k_values = DEFAULT_K_VALUES.copy()


@dataclass
class ScoreResult:
    """Result of scoring a benchmark run."""

    aggregate_metrics: dict[str, float]
    per_query_metrics: dict[str, dict[str, float]]
    per_slice_metrics: dict[str, dict[str, float]]
    query_count: int
    config: ScorerConfig

    def to_json(self) -> str:
        """Serialize to JSON for machine-readable output."""
        return json.dumps(
            {
                "aggregate_metrics": self.aggregate_metrics,
                "per_query_metrics": self.per_query_metrics,
                "per_slice_metrics": self.per_slice_metrics,
                "query_count": self.query_count,
                "k_values": self.config.k_values,
                "relevance_mode": self.config.relevance_mode,
            },
            indent=2,
        )


def _build_ir_measures_qrels(dataset: BenchmarkDataset) -> list[ir_measures.Qrel]:
    """Convert dataset qrels to ir_measures format."""
    return [
        ir_measures.Qrel(query_id=q.query_id, doc_id=q.canonical_item_id, relevance=q.relevance)
        for q in dataset.qrels
    ]


def _build_ir_measures_run(run: Run) -> list[ir_measures.ScoredDoc]:
    """Convert benchmark run to ir_measures format."""
    return [
        ir_measures.ScoredDoc(query_id=e.query_id, doc_id=e.canonical_item_id, score=e.score)
        for e in run.entries
    ]


def _build_metrics_list(config: ScorerConfig) -> list:
    """Build the list of ir_measures metrics to compute."""
    measures = []
    for k in config.k_values:
        if "recall" in config.metrics:
            measures.append(Recall @ k)
        if "precision" in config.metrics:
            measures.append(Precision @ k)
        if "map" in config.metrics:
            measures.append(AP @ k)
        if "ndcg" in config.metrics:
            measures.append(nDCG @ k)

    # MRR doesn't use @K in ir_measures (it's MRR, not MRR@K)
    if "mrr" in config.metrics:
        measures.append(RR)

    return measures


def compute_metrics(
    qrels: dict[str, dict[str, int]],
    run: dict[str, dict[str, float]],
    k_values: list[int] | None = None,
) -> dict[str, float]:
    """
    Compute IR metrics using ir_measures.

    Args:
        qrels: Dict mapping query_id -> {doc_id: relevance}
        run: Dict mapping query_id -> {doc_id: score}
        k_values: List of K values for @K metrics

    Returns:
        Dict mapping metric name -> aggregate value
    """
    if k_values is None:
        k_values = DEFAULT_K_VALUES

    # Convert to ir_measures format
    ir_qrels = [
        ir_measures.Qrel(query_id=qid, doc_id=did, relevance=rel)
        for qid, docs in qrels.items()
        for did, rel in docs.items()
    ]

    ir_run = [
        ir_measures.ScoredDoc(query_id=qid, doc_id=did, score=score)
        for qid, docs in run.items()
        for did, score in docs.items()
    ]

    # Build measures
    measures = []
    for k in k_values:
        measures.extend([Recall @ k, Precision @ k, AP @ k, nDCG @ k])
    measures.append(RR)

    # Compute
    results = {}
    for metric_result in ir_measures.iter_calc(measures, ir_qrels, ir_run):
        metric_name = _normalize_metric_name_str(str(metric_result.measure).lower())
        results[metric_name] = metric_result.value

    return results


def _normalize_metric_name_str(name: str) -> str:
    """Normalize metric name string to user-friendly form."""
    if name == "rr":
        return "mrr"
    elif name.startswith("r@"):
        return "recall@" + name[2:]
    elif name.startswith("p@"):
        return "precision@" + name[2:]
    elif name.startswith("ap@"):
        return "map@" + name[3:]
    return name


class BenchmarkScorer:
    """
    Scores benchmark runs against a dataset using ir_measures.

    Usage:
        scorer = BenchmarkScorer(dataset, config)
        result = scorer.score_run(run)
        summary = scorer.generate_run_summary(run, result)
    """

    def __init__(self, dataset: BenchmarkDataset, config: ScorerConfig | None = None):
        self.dataset = dataset
        self.config = config or ScorerConfig()
        self._qrels = _build_ir_measures_qrels(dataset)
        self._topic_slices = self._build_topic_slice_map()

    def _build_topic_slice_map(self) -> dict[str, str]:
        """Map query_id -> slice from topic slice_ids (first slice used for aggregation)."""
        return {
            t.query_id: t.slice_ids[0] if t.slice_ids else "default"
            for t in self.dataset.topics
        }

    def score_run(self, run: Run) -> ScoreResult:
        """
        Score a run against the dataset.

        Returns ScoreResult with aggregate, per-query, and per-slice metrics.
        """
        if not run.entries:
            return ScoreResult(
                aggregate_metrics={},
                per_query_metrics={},
                per_slice_metrics={},
                query_count=0,
                config=self.config,
            )

        ir_run = _build_ir_measures_run(run)
        measures = _build_metrics_list(self.config)

        # Compute per-query metrics
        per_query: dict[str, dict[str, float]] = {}
        aggregate_sums: dict[str, float] = {}
        aggregate_counts: dict[str, int] = {}

        for result in ir_measures.iter_calc(measures, self._qrels, ir_run):
            query_id = result.query_id
            metric_name = self._normalize_metric_name(result.measure)

            if query_id not in per_query:
                per_query[query_id] = {}
            per_query[query_id][metric_name] = result.value

            # Accumulate for aggregate
            if metric_name not in aggregate_sums:
                aggregate_sums[metric_name] = 0.0
                aggregate_counts[metric_name] = 0
            aggregate_sums[metric_name] += result.value
            aggregate_counts[metric_name] += 1

        # Compute aggregates (mean over queries)
        aggregate_metrics = {
            name: aggregate_sums[name] / aggregate_counts[name]
            for name in aggregate_sums
            if aggregate_counts[name] > 0
        }

        # Compute per-slice metrics
        per_slice = self._compute_per_slice_metrics(per_query)

        return ScoreResult(
            aggregate_metrics=aggregate_metrics,
            per_query_metrics=per_query,
            per_slice_metrics=per_slice,
            query_count=len(per_query),
            config=self.config,
        )

    def _normalize_metric_name(self, measure) -> str:
        """Convert ir_measures measure to our naming convention."""
        name = str(measure).lower()
        # Normalize to full names for clarity
        if name == "rr":
            return "mrr"
        elif name.startswith("r@"):
            return "recall@" + name[2:]
        elif name.startswith("p@"):
            return "precision@" + name[2:]
        elif name.startswith("ap@"):
            return "map@" + name[3:]
        elif name.startswith("ndcg@"):
            return name  # Already good
        return name

    def _compute_per_slice_metrics(
        self, per_query: dict[str, dict[str, float]]
    ) -> dict[str, dict[str, float]]:
        """Aggregate metrics by slice."""
        slice_sums: dict[str, dict[str, float]] = {}
        slice_counts: dict[str, dict[str, int]] = {}

        for query_id, metrics in per_query.items():
            slice_name = self._topic_slices.get(query_id, "default")

            if slice_name not in slice_sums:
                slice_sums[slice_name] = {}
                slice_counts[slice_name] = {}

            for metric_name, value in metrics.items():
                if metric_name not in slice_sums[slice_name]:
                    slice_sums[slice_name][metric_name] = 0.0
                    slice_counts[slice_name][metric_name] = 0
                slice_sums[slice_name][metric_name] += value
                slice_counts[slice_name][metric_name] += 1

        # Average
        per_slice = {}
        for slice_name, sums in slice_sums.items():
            per_slice[slice_name] = {
                metric: sums[metric] / slice_counts[slice_name][metric]
                for metric in sums
                if slice_counts[slice_name][metric] > 0
            }

        return per_slice

    def generate_run_summary(
        self,
        run: Run,
        result: ScoreResult,
        git_sha: str | None = None,
    ) -> RunSummary:
        """
        Generate a RunSummary with provenance and metrics.

        Args:
            run: The scored run
            result: The scoring result
            git_sha: Optional git commit SHA for provenance

        Returns:
            RunSummary with full provenance
        """
        return RunSummary(
            run_id=run.run_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            git_sha=git_sha,
            dataset_id=self.dataset.dataset_id,
            dataset_version=self.dataset.version,
            topics_version=None,  # Included in dataset_version
            qrels_version=None,  # Included in dataset_version
            retrieval_contract_version=None,  # TODO: Pull from contract
            canonicalization_version="v1",
            metrics=result.aggregate_metrics,
            k_values=self.config.k_values,
            query_count=result.query_count,
            duration_ms=None,  # TODO: Measure timing
            zero_edge_ratio=None,
            edge_count_summary=None,
            ontology_valid_ratio=None,
            template_artifact_counts=None,
            per_slice_metrics=result.per_slice_metrics,
        )


def format_results_markdown(result: ScoreResult) -> str:
    """
    Format scoring results as human-readable Markdown.

    Args:
        result: The ScoreResult to format

    Returns:
        Markdown string suitable for PR review
    """
    lines = [
        "# Benchmark Results",
        "",
        f"**Queries evaluated**: {result.query_count}",
        f"**K values**: {result.config.k_values}",
        "",
        "## Aggregate Metrics",
        "",
        "| Metric | Value |",
        "|--------|-------|",
    ]

    # Sort metrics for consistent output
    for metric, value in sorted(result.aggregate_metrics.items()):
        display_name = metric.replace("@", "@").title()
        lines.append(f"| {display_name} | {value:.4f} |")

    if result.per_slice_metrics:
        lines.extend(
            [
                "",
                "## Per-Slice Metrics",
                "",
            ]
        )

        # Collect all metric names
        all_metrics = set()
        for slice_metrics in result.per_slice_metrics.values():
            all_metrics.update(slice_metrics.keys())
        sorted_metrics = sorted(all_metrics)

        # Header
        header = "| Slice | " + " | ".join(m.title() for m in sorted_metrics) + " |"
        separator = "|" + "|".join(["-------"] * (len(sorted_metrics) + 1)) + "|"
        lines.extend([header, separator])

        # Rows
        for slice_name in sorted(result.per_slice_metrics.keys()):
            slice_metrics = result.per_slice_metrics[slice_name]
            values = [
                f"{slice_metrics.get(m, 0.0):.4f}" for m in sorted_metrics
            ]
            lines.append(f"| {slice_name} | " + " | ".join(values) + " |")

    return "\n".join(lines)
