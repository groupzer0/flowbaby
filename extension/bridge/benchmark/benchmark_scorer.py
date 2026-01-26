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
class LabelShapeStats:
    """
    Statistics about the positives-per-query distribution (Plan 113 M2).
    
    Used to make label shape visible and prevent misleading benchmarks.
    """
    min: int
    max: int
    mean: float
    median: float
    p95: float
    pct_zero_positives: float
    pct_one_positive: float
    pct_two_plus_positives: float
    total_queries: int


@dataclass
class ScoreResult:
    """
    Result of scoring a benchmark run.
    
    Plan 113 additions:
    - relevance_semantics: Explicitly indicates "filtered" (multi-positive) mode
    - label_shape_stats: Positives-per-query distribution for transparency
    - macro_metrics: Per-query equal weighting to mitigate hub dominance
    """

    aggregate_metrics: dict[str, float]
    per_query_metrics: dict[str, dict[str, float]]
    per_slice_metrics: dict[str, dict[str, float]]
    query_count: int
    config: ScorerConfig
    # Plan 113 additions
    relevance_semantics: str = "filtered"  # Always "filtered" for multi-positive
    label_shape_stats: LabelShapeStats | None = None
    macro_metrics: dict[str, float] = field(default_factory=dict)

    def to_json(self) -> str:
        """Serialize to JSON for machine-readable output with stable ordering."""
        data = {
            "relevance_semantics": self.relevance_semantics,
            "aggregate_metrics": dict(sorted(self.aggregate_metrics.items())),
            "macro_metrics": dict(sorted(self.macro_metrics.items())),
            "per_query_metrics": dict(sorted(self.per_query_metrics.items())),
            "per_slice_metrics": dict(sorted(self.per_slice_metrics.items())),
            "query_count": self.query_count,
            "k_values": self.config.k_values,
            "relevance_mode": self.config.relevance_mode,
        }
        if self.label_shape_stats:
            data["label_shape_stats"] = {
                "min": self.label_shape_stats.min,
                "max": self.label_shape_stats.max,
                "mean": self.label_shape_stats.mean,
                "median": self.label_shape_stats.median,
                "p95": self.label_shape_stats.p95,
                "pct_zero_positives": self.label_shape_stats.pct_zero_positives,
                "pct_one_positive": self.label_shape_stats.pct_one_positive,
                "pct_two_plus_positives": self.label_shape_stats.pct_two_plus_positives,
                "total_queries": self.label_shape_stats.total_queries,
            }
        return json.dumps(data, indent=2, sort_keys=False)


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

    def _build_topic_slice_map(self) -> dict[str, list[str]]:
        """
        Map query_id -> list of slice names.
        
        Plan 113 code review fix: Support multi-slice queries by returning
        all slice_ids for each query, not just the first one.
        """
        return {
            t.query_id: t.slice_ids if t.slice_ids else ["default"]
            for t in self.dataset.topics
        }

    def score_run(self, run: Run) -> ScoreResult:
        """
        Score a run against the dataset.

        Returns ScoreResult with aggregate, per-query, and per-slice metrics.
        
        Plan 113 code review fix:
        - aggregate_metrics: Weighted by qrel count (hub queries have more influence)
        - macro_metrics: Per-query equal weighting (each query counts the same)
        """
        # Plan 113 M2: Always compute label shape stats (from dataset, not run)
        label_shape_stats = self._compute_label_shape_stats()
        
        if not run.entries:
            return ScoreResult(
                aggregate_metrics={},
                per_query_metrics={},
                per_slice_metrics={},
                query_count=0,
                config=self.config,
                relevance_semantics="filtered",
                label_shape_stats=label_shape_stats,
                macro_metrics={},
            )

        ir_run = _build_ir_measures_run(run)
        measures = _build_metrics_list(self.config)

        # Get qrel counts per query for weighting
        qrels_by_query = self.dataset.qrels_by_query()
        
        # Compute per-query metrics
        per_query: dict[str, dict[str, float]] = {}
        # For macro: simple sum and count
        macro_sums: dict[str, float] = {}
        macro_counts: dict[str, int] = {}
        # For aggregate: weighted by qrel count
        weighted_sums: dict[str, float] = {}
        weight_totals: dict[str, float] = {}

        for result in ir_measures.iter_calc(measures, self._qrels, ir_run):
            query_id = result.query_id
            metric_name = self._normalize_metric_name(result.measure)

            if query_id not in per_query:
                per_query[query_id] = {}
            per_query[query_id][metric_name] = result.value
            
            # Get weight for this query (number of qrels)
            query_qrel_count = len(qrels_by_query.get(query_id, []))
            weight = max(query_qrel_count, 1)  # Minimum weight of 1

            # Accumulate for macro (unweighted)
            if metric_name not in macro_sums:
                macro_sums[metric_name] = 0.0
                macro_counts[metric_name] = 0
            macro_sums[metric_name] += result.value
            macro_counts[metric_name] += 1
            
            # Accumulate for aggregate (weighted by qrel count)
            if metric_name not in weighted_sums:
                weighted_sums[metric_name] = 0.0
                weight_totals[metric_name] = 0.0
            weighted_sums[metric_name] += result.value * weight
            weight_totals[metric_name] += weight

        # Compute aggregate (qrel-weighted mean)
        aggregate_metrics = {
            name: weighted_sums[name] / weight_totals[name]
            for name in weighted_sums
            if weight_totals[name] > 0
        }
        
        # Compute macro (simple mean over queries)
        macro_metrics = {
            name: macro_sums[name] / macro_counts[name]
            for name in macro_sums
            if macro_counts[name] > 0
        }

        # Compute per-slice metrics (with query counts per Plan 113)
        per_slice = self._compute_per_slice_metrics(per_query)

        return ScoreResult(
            aggregate_metrics=aggregate_metrics,
            per_query_metrics=per_query,
            per_slice_metrics=per_slice,
            query_count=len(per_query),
            config=self.config,
            relevance_semantics="filtered",  # Plan 113 M1
            label_shape_stats=label_shape_stats,  # Computed at method start
            macro_metrics=macro_metrics,
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
    ) -> dict[str, dict[str, Any]]:
        """
        Aggregate metrics by slice.
        
        Plan 113 M3: Now includes query_count per slice for hub dominance visibility.
        Plan 113 code review fix: Multi-slice queries count toward ALL their slices.
        """
        slice_sums: dict[str, dict[str, float]] = {}
        slice_counts: dict[str, dict[str, int]] = {}
        slice_query_counts: dict[str, int] = {}

        for query_id, metrics in per_query.items():
            # Get all slices this query belongs to
            slice_names = self._topic_slices.get(query_id, ["default"])
            
            # Count this query's metrics in EACH of its slices
            for slice_name in slice_names:
                if slice_name not in slice_sums:
                    slice_sums[slice_name] = {}
                    slice_counts[slice_name] = {}
                    slice_query_counts[slice_name] = 0
                
                slice_query_counts[slice_name] += 1

                for metric_name, value in metrics.items():
                    if metric_name not in slice_sums[slice_name]:
                        slice_sums[slice_name][metric_name] = 0.0
                        slice_counts[slice_name][metric_name] = 0
                    slice_sums[slice_name][metric_name] += value
                    slice_counts[slice_name][metric_name] += 1

        # Average and include query_count
        per_slice: dict[str, dict[str, Any]] = {}
        for slice_name, sums in slice_sums.items():
            per_slice[slice_name] = {
                metric: sums[metric] / slice_counts[slice_name][metric]
                for metric in sums
                if slice_counts[slice_name][metric] > 0
            }
            # Plan 113 M3: Add query_count for slice membership visibility
            per_slice[slice_name]["query_count"] = slice_query_counts[slice_name]

        return per_slice

    def _compute_label_shape_stats(self) -> LabelShapeStats:
        """
        Compute positives-per-query distribution statistics (Plan 113 M2).
        
        Returns stats on label shape to prevent misleading benchmarks.
        """
        import statistics
        
        # Count positives per query from qrels
        qrels_by_query = self.dataset.qrels_by_query()
        
        # Include all topics, even those with 0 qrels
        positives_per_query = []
        for topic in self.dataset.topics:
            qrels_for_query = qrels_by_query.get(topic.query_id, [])
            positives_per_query.append(len(qrels_for_query))
        
        if not positives_per_query:
            # Empty dataset edge case
            return LabelShapeStats(
                min=0, max=0, mean=0.0, median=0.0, p95=0.0,
                pct_zero_positives=0.0, pct_one_positive=0.0, 
                pct_two_plus_positives=0.0, total_queries=0
            )
        
        sorted_counts = sorted(positives_per_query)
        n = len(sorted_counts)
        
        # Distribution percentages
        zero_count = sum(1 for c in positives_per_query if c == 0)
        one_count = sum(1 for c in positives_per_query if c == 1)
        two_plus_count = sum(1 for c in positives_per_query if c >= 2)
        
        # P95 calculation
        p95_idx = int(0.95 * (n - 1))
        p95 = float(sorted_counts[p95_idx])
        
        return LabelShapeStats(
            min=sorted_counts[0],
            max=sorted_counts[-1],
            mean=statistics.mean(positives_per_query),
            median=float(statistics.median(positives_per_query)),
            p95=p95,
            pct_zero_positives=(zero_count / n) * 100,
            pct_one_positive=(one_count / n) * 100,
            pct_two_plus_positives=(two_plus_count / n) * 100,
            total_queries=n,
        )

    def generate_run_summary(
        self,
        run: Run,
        result: ScoreResult,
        git_sha: str | None = None,
        selection_split: str | None = None,
        evaluation_split: str | None = None,
    ) -> RunSummary:
        """
        Generate a RunSummary with provenance and metrics.

        Args:
            run: The scored run
            result: The scoring result
            git_sha: Optional git commit SHA for provenance
            selection_split: Split used for tuning/selection (Plan 113 M4)
            evaluation_split: Split used for evaluation (Plan 113 M4)

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
            selection_split=selection_split,
            evaluation_split=evaluation_split,
        )


def format_results_markdown(result: ScoreResult) -> str:
    """
    Format scoring results as human-readable Markdown.

    Plan 113 additions:
    - Explicit filtered/multi-positive semantics note
    - Label shape statistics section
    - Both aggregate and macro metrics sections

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
        f"**Relevance semantics**: {result.relevance_semantics} (multi-positive: any labeled positive counts as relevant)",
        "",
    ]
    
    # Plan 113 M2: Label Shape Statistics
    if result.label_shape_stats:
        stats = result.label_shape_stats
        lines.extend([
            "## Label Shape Statistics",
            "",
            "Distribution of positives-per-query (helps assess dataset quality):",
            "",
            "| Statistic | Value |",
            "|-----------|-------|",
            f"| Min positives | {stats.min} |",
            f"| Median positives | {stats.median:.1f} |",
            f"| Mean positives | {stats.mean:.2f} |",
            f"| P95 positives | {stats.p95:.1f} |",
            f"| Max positives | {stats.max} |",
            f"| Queries with 0 positives | {stats.pct_zero_positives:.1f}% |",
            f"| Queries with 1 positive | {stats.pct_one_positive:.1f}% |",
            f"| Queries with 2+ positives | {stats.pct_two_plus_positives:.1f}% |",
            "",
        ])
    
    # Aggregate Metrics
    lines.extend([
        "## Aggregate Metrics",
        "",
        "| Metric | Value |",
        "|--------|-------|",
    ])

    # Sort metrics for consistent output
    for metric, value in sorted(result.aggregate_metrics.items()):
        display_name = metric.replace("@", "@").title()
        lines.append(f"| {display_name} | {value:.4f} |")

    # Plan 113 M3: Macro Metrics (explicit section)
    if result.macro_metrics:
        lines.extend([
            "",
            "## Macro-Averaged Metrics",
            "",
            "*Per-query equal weighting to mitigate hub dominance*",
            "",
            "| Metric | Value |",
            "|--------|-------|",
        ])
        for metric, value in sorted(result.macro_metrics.items()):
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

        # Collect all metric names (excluding query_count for the metrics table)
        all_metrics = set()
        for slice_metrics in result.per_slice_metrics.values():
            all_metrics.update(k for k in slice_metrics.keys() if k != "query_count")
        sorted_metrics = sorted(all_metrics)

        # Plan 113 M3: Include query_count column
        header = "| Slice | Query Count | " + " | ".join(m.title() for m in sorted_metrics) + " |"
        separator = "|" + "|".join(["-------"] * (len(sorted_metrics) + 2)) + "|"
        lines.extend([header, separator])

        # Rows (sorted for diffability)
        for slice_name in sorted(result.per_slice_metrics.keys()):
            slice_metrics = result.per_slice_metrics[slice_name]
            query_count = slice_metrics.get("query_count", "N/A")
            values = [
                f"{slice_metrics.get(m, 0.0):.4f}" if isinstance(slice_metrics.get(m, 0.0), float) else str(slice_metrics.get(m, 0.0))
                for m in sorted_metrics
            ]
            lines.append(f"| {slice_name} | {query_count} | " + " | ".join(values) + " |")

    return "\n".join(lines)
