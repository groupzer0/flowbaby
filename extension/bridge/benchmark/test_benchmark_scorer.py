"""
TDD tests for benchmark_scorer.py (Step 2: Scoring Harness)

Tests for scoring harness using ir_measures + pytrec_eval.
Metrics: Recall@K, Precision@K, MRR, MAP@K, nDCG@K
"""

import json
import tempfile
import unittest
from pathlib import Path
from typing import Dict, List, Any

# TDD Red Phase: Import the module we're about to create
from benchmark.benchmark_scorer import (
    BenchmarkScorer,
    ScorerConfig,
    ScoreResult,
    compute_metrics,
    format_results_markdown,
    DEFAULT_K_VALUES,
)
from benchmark.benchmark_contract import (
    Topic,
    Qrel,
    Run,
    RunEntry,
    BenchmarkDataset,
    RunSummary,
)


class TestScorerConfig(unittest.TestCase):
    """Tests for scorer configuration."""

    def test_default_config_has_expected_k_values(self):
        """Default K values should match UX surfaces (K=5 primary)."""
        config = ScorerConfig()
        self.assertIn(5, config.k_values)
        self.assertEqual(config.k_values[0], 5)  # K=5 is primary

    def test_default_config_includes_all_required_metrics(self):
        """Config should include Recall@K, Precision@K, MRR, MAP@K, nDCG@K."""
        config = ScorerConfig()
        self.assertIn("recall", config.metrics)
        self.assertIn("precision", config.metrics)
        self.assertIn("mrr", config.metrics)
        self.assertIn("map", config.metrics)
        self.assertIn("ndcg", config.metrics)

    def test_config_can_customize_k_values(self):
        """K values should be customizable."""
        config = ScorerConfig(k_values=[3, 10, 20])
        self.assertEqual(config.k_values, [3, 10, 20])

    def test_config_includes_relevance_mode(self):
        """Config should support binary and graded relevance."""
        config_binary = ScorerConfig(relevance_mode="binary")
        self.assertEqual(config_binary.relevance_mode, "binary")

        config_graded = ScorerConfig(relevance_mode="graded")
        self.assertEqual(config_graded.relevance_mode, "graded")


class TestScoreResult(unittest.TestCase):
    """Tests for score result structure."""

    def test_score_result_contains_aggregate_metrics(self):
        """ScoreResult should contain aggregate metrics dict."""
        result = ScoreResult(
            aggregate_metrics={"recall@5": 0.8, "precision@5": 0.6},
            per_query_metrics={},
            per_slice_metrics={},
            query_count=10,
            config=ScorerConfig(),
        )
        self.assertEqual(result.aggregate_metrics["recall@5"], 0.8)

    def test_score_result_contains_per_query_metrics(self):
        """ScoreResult should contain per-query breakdown."""
        result = ScoreResult(
            aggregate_metrics={},
            per_query_metrics={"q1": {"recall@5": 1.0}, "q2": {"recall@5": 0.5}},
            per_slice_metrics={},
            query_count=2,
            config=ScorerConfig(),
        )
        self.assertEqual(result.per_query_metrics["q1"]["recall@5"], 1.0)

    def test_score_result_contains_per_slice_metrics(self):
        """ScoreResult should contain per-slice aggregates."""
        result = ScoreResult(
            aggregate_metrics={},
            per_query_metrics={},
            per_slice_metrics={
                "template-heavy": {"recall@5": 0.7},
                "edge-sparse": {"recall@5": 0.5},
            },
            query_count=10,
            config=ScorerConfig(),
        )
        self.assertEqual(result.per_slice_metrics["template-heavy"]["recall@5"], 0.7)


class TestBenchmarkScorer(unittest.TestCase):
    """Tests for the main BenchmarkScorer class."""

    def setUp(self):
        """Create a minimal test dataset."""
        self.topics = [
            Topic(query_id="q1", query_text="First query", slice_ids=["general"]),
            Topic(query_id="q2", query_text="Second query", slice_ids=["technical"]),
            Topic(query_id="q3", query_text="Third query", slice_ids=["general"]),
        ]
        self.qrels = [
            Qrel(query_id="q1", canonical_item_id="doc1", relevance=1),
            Qrel(query_id="q1", canonical_item_id="doc2", relevance=1),  # multi-positive
            Qrel(query_id="q2", canonical_item_id="doc3", relevance=2),  # graded
            Qrel(query_id="q2", canonical_item_id="doc4", relevance=1),
            Qrel(query_id="q3", canonical_item_id="doc5", relevance=1),
        ]
        self.dataset = BenchmarkDataset(
            dataset_id="test-dataset",
            version="1.0",
            topics=self.topics,
            qrels=self.qrels,
            slice_definitions={"general": "General queries", "technical": "Technical queries"},
        )
        self.run = Run(
            run_id="test-run",
            entries=[
                RunEntry(query_id="q1", canonical_item_id="doc1", rank=1, score=0.9),
                RunEntry(query_id="q1", canonical_item_id="doc99", rank=2, score=0.8),  # irrelevant
                RunEntry(query_id="q1", canonical_item_id="doc2", rank=3, score=0.7),  # relevant
                RunEntry(query_id="q2", canonical_item_id="doc3", rank=1, score=0.95),
                RunEntry(query_id="q2", canonical_item_id="doc4", rank=2, score=0.85),
                RunEntry(query_id="q3", canonical_item_id="doc5", rank=1, score=0.99),
            ],
        )

    def test_scorer_initialization(self):
        """Scorer should initialize with dataset and config."""
        scorer = BenchmarkScorer(self.dataset, ScorerConfig())
        self.assertEqual(scorer.dataset.dataset_id, "test-dataset")

    def test_scorer_score_run_returns_score_result(self):
        """score_run should return a ScoreResult object."""
        scorer = BenchmarkScorer(self.dataset, ScorerConfig())
        result = scorer.score_run(self.run)
        self.assertIsInstance(result, ScoreResult)

    def test_scorer_computes_recall_at_k(self):
        """Scorer should compute Recall@K correctly."""
        scorer = BenchmarkScorer(self.dataset, ScorerConfig(k_values=[5]))
        result = scorer.score_run(self.run)
        # q1: found 2/2 relevant, q2: found 2/2, q3: found 1/1
        # All queries have perfect recall
        self.assertIn("recall@5", result.aggregate_metrics)
        self.assertGreater(result.aggregate_metrics["recall@5"], 0)

    def test_scorer_computes_precision_at_k(self):
        """Scorer should compute Precision@K correctly."""
        scorer = BenchmarkScorer(self.dataset, ScorerConfig(k_values=[5]))
        result = scorer.score_run(self.run)
        self.assertIn("precision@5", result.aggregate_metrics)

    def test_scorer_computes_mrr(self):
        """Scorer should compute MRR (Mean Reciprocal Rank)."""
        scorer = BenchmarkScorer(self.dataset, ScorerConfig())
        result = scorer.score_run(self.run)
        self.assertIn("mrr", result.aggregate_metrics)
        # First relevant at rank 1 for all queries
        self.assertGreater(result.aggregate_metrics["mrr"], 0)

    def test_scorer_computes_map_at_k(self):
        """Scorer should compute MAP@K (Mean Average Precision)."""
        scorer = BenchmarkScorer(self.dataset, ScorerConfig(k_values=[5]))
        result = scorer.score_run(self.run)
        self.assertIn("map@5", result.aggregate_metrics)

    def test_scorer_computes_ndcg_at_k(self):
        """Scorer should compute nDCG@K."""
        scorer = BenchmarkScorer(self.dataset, ScorerConfig(k_values=[5]))
        result = scorer.score_run(self.run)
        self.assertIn("ndcg@5", result.aggregate_metrics)

    def test_scorer_handles_empty_run(self):
        """Scorer should handle runs with no entries gracefully."""
        empty_run = Run(run_id="empty", entries=[])
        scorer = BenchmarkScorer(self.dataset, ScorerConfig())
        result = scorer.score_run(empty_run)
        # Should return zeros, not crash
        self.assertEqual(result.query_count, 0)

    def test_scorer_handles_missing_queries(self):
        """Scorer should handle queries in qrels but not in run."""
        partial_run = Run(
            run_id="partial",
            entries=[
                RunEntry(query_id="q1", canonical_item_id="doc1", rank=1, score=0.9),
                # q2 and q3 missing
            ],
        )
        scorer = BenchmarkScorer(self.dataset, ScorerConfig())
        result = scorer.score_run(partial_run)
        # Should still compute metrics (missing queries get 0)
        self.assertIn("recall@5", result.aggregate_metrics)

    def test_scorer_per_slice_metrics(self):
        """Scorer should compute per-slice aggregate metrics."""
        scorer = BenchmarkScorer(self.dataset, ScorerConfig(k_values=[5]))
        result = scorer.score_run(self.run)
        # Should have metrics for both slices
        self.assertIn("general", result.per_slice_metrics)
        self.assertIn("technical", result.per_slice_metrics)

    def test_scorer_multi_positive_handling(self):
        """Any labeled positive should count as relevant (filtered-style)."""
        # q1 has two relevant docs (doc1, doc2). Both are returned.
        scorer = BenchmarkScorer(self.dataset, ScorerConfig(k_values=[5]))
        result = scorer.score_run(self.run)
        # q1 should have recall@5 = 1.0 (both positives found)
        self.assertEqual(result.per_query_metrics["q1"]["recall@5"], 1.0)


class TestComputeMetrics(unittest.TestCase):
    """Tests for the compute_metrics helper function."""

    def test_compute_metrics_with_ir_measures(self):
        """compute_metrics should use ir_measures for computation."""
        qrels = {"q1": {"doc1": 1, "doc2": 1}}
        run = {"q1": {"doc1": 0.9, "doc2": 0.8, "doc99": 0.7}}
        metrics = compute_metrics(qrels, run, k_values=[5])
        self.assertIn("recall@5", metrics)

    def test_compute_metrics_requires_offline_only(self):
        """compute_metrics should work fully offline (no network)."""
        # This test verifies the contract - implementation should not
        # make any network calls
        qrels = {"q1": {"doc1": 1}}
        run = {"q1": {"doc1": 0.9}}
        # Should not raise network errors
        metrics = compute_metrics(qrels, run, k_values=[5])
        self.assertIsInstance(metrics, dict)


class TestFormatResultsMarkdown(unittest.TestCase):
    """Tests for markdown output formatting."""

    def test_format_results_markdown_produces_valid_markdown(self):
        """format_results_markdown should produce human-readable markdown."""
        result = ScoreResult(
            aggregate_metrics={"recall@5": 0.8, "precision@5": 0.6, "mrr": 0.9},
            per_query_metrics={"q1": {"recall@5": 1.0}},
            per_slice_metrics={"general": {"recall@5": 0.85}},
            query_count=10,
            config=ScorerConfig(),
        )
        md = format_results_markdown(result)
        self.assertIn("# Benchmark Results", md)
        self.assertIn("Recall@5", md)
        self.assertIn("0.8", md)

    def test_format_results_includes_per_slice_table(self):
        """Markdown output should include per-slice breakdown table."""
        result = ScoreResult(
            aggregate_metrics={"recall@5": 0.8},
            per_query_metrics={},
            per_slice_metrics={
                "general": {"recall@5": 0.85},
                "technical": {"recall@5": 0.75},
            },
            query_count=10,
            config=ScorerConfig(),
        )
        md = format_results_markdown(result)
        self.assertIn("Per-Slice", md)
        self.assertIn("general", md)
        self.assertIn("technical", md)


class TestDefaultKValues(unittest.TestCase):
    """Tests for default K value configuration."""

    def test_default_k_values_tied_to_ux(self):
        """DEFAULT_K_VALUES should be tied to Flowbaby UX surfaces."""
        # K=5 is primary because chat/command shows top-5
        self.assertEqual(DEFAULT_K_VALUES[0], 5)
        # Should also include K=10 for broader coverage
        self.assertIn(10, DEFAULT_K_VALUES)


class TestPlan113MultiPositiveSemantics(unittest.TestCase):
    """
    Plan 113 Milestone 1: Explicit multi-positive/filtered-style semantics.
    
    Tests that reports clearly label metrics as using filtered/multi-positive
    semantics where any labeled positive counts as relevant.
    """

    def setUp(self):
        """Create dataset with multi-positive qrels."""
        self.topics = [
            Topic(query_id="q1", query_text="Query with 3 positives", slice_ids=["multi"]),
            Topic(query_id="q2", query_text="Query with 1 positive", slice_ids=["single"]),
            Topic(query_id="q3", query_text="Query with 0 positives", slice_ids=["no-context"]),
        ]
        self.qrels = [
            Qrel(query_id="q1", canonical_item_id="doc1", relevance=2),
            Qrel(query_id="q1", canonical_item_id="doc2", relevance=1),
            Qrel(query_id="q1", canonical_item_id="doc3", relevance=1),  # 3 positives
            Qrel(query_id="q2", canonical_item_id="doc4", relevance=1),  # 1 positive
            # q3 has no qrels (0 positives)
        ]
        self.dataset = BenchmarkDataset(
            dataset_id="test-multipos",
            version="1.0",
            topics=self.topics,
            qrels=self.qrels,
            slice_definitions={"multi": "Multi-positive", "single": "Single", "no-context": "No context"},
        )

    def test_score_result_indicates_multi_positive_mode(self):
        """ScoreResult must indicate that filtered/multi-positive semantics are used."""
        from benchmark.benchmark_scorer import BenchmarkScorer, ScorerConfig
        scorer = BenchmarkScorer(self.dataset, ScorerConfig())
        run = Run(run_id="test", entries=[
            RunEntry(query_id="q1", canonical_item_id="doc1", rank=1, score=0.9),
        ])
        result = scorer.score_run(run)
        # ScoreResult should have a relevance_semantics field
        self.assertEqual(result.relevance_semantics, "filtered")

    def test_markdown_output_labels_filtered_semantics(self):
        """Markdown report must clearly state filtered/multi-positive semantics."""
        from benchmark.benchmark_scorer import BenchmarkScorer, ScorerConfig, format_results_markdown
        scorer = BenchmarkScorer(self.dataset, ScorerConfig())
        run = Run(run_id="test", entries=[
            RunEntry(query_id="q1", canonical_item_id="doc1", rank=1, score=0.9),
        ])
        result = scorer.score_run(run)
        md = format_results_markdown(result)
        # Report must mention multi-positive/filtered semantics
        self.assertIn("filtered", md.lower())


class TestPlan113LabelShapeStatistics(unittest.TestCase):
    """
    Plan 113 Milestone 2: Positives-per-query distribution telemetry.
    
    Tests that benchmark reports include label-shape statistics:
    - min/median/p95 positives per query
    - percentage of queries with 0/1/2+ positives
    """

    def setUp(self):
        """Create dataset with varied positives-per-query distribution."""
        self.topics = [
            Topic(query_id="q1", query_text="Query 1", slice_ids=["test"]),
            Topic(query_id="q2", query_text="Query 2", slice_ids=["test"]),
            Topic(query_id="q3", query_text="Query 3", slice_ids=["test"]),
            Topic(query_id="q4", query_text="Query 4", slice_ids=["test"]),
            Topic(query_id="q5", query_text="Query 5", slice_ids=["test"]),
        ]
        # q1: 4 positives, q2: 2 positives, q3: 1 positive, q4: 0 positives, q5: 1 positive
        self.qrels = [
            Qrel(query_id="q1", canonical_item_id="d1", relevance=1),
            Qrel(query_id="q1", canonical_item_id="d2", relevance=1),
            Qrel(query_id="q1", canonical_item_id="d3", relevance=1),
            Qrel(query_id="q1", canonical_item_id="d4", relevance=1),  # 4
            Qrel(query_id="q2", canonical_item_id="d5", relevance=1),
            Qrel(query_id="q2", canonical_item_id="d6", relevance=1),  # 2
            Qrel(query_id="q3", canonical_item_id="d7", relevance=1),  # 1
            # q4 has no qrels (0 positives)
            Qrel(query_id="q5", canonical_item_id="d8", relevance=1),  # 1
        ]
        self.dataset = BenchmarkDataset(
            dataset_id="test-labelshape",
            version="1.0",
            topics=self.topics,
            qrels=self.qrels,
            slice_definitions={"test": "Test slice"},
        )

    def test_score_result_includes_label_shape_stats(self):
        """ScoreResult must include positives-per-query distribution statistics."""
        from benchmark.benchmark_scorer import BenchmarkScorer, ScorerConfig
        scorer = BenchmarkScorer(self.dataset, ScorerConfig())
        run = Run(run_id="test", entries=[])
        result = scorer.score_run(run)
        # Must have label_shape_stats field
        self.assertIsNotNone(result.label_shape_stats)
        # Must include min/median/p95 as attributes
        self.assertTrue(hasattr(result.label_shape_stats, "min"))
        self.assertTrue(hasattr(result.label_shape_stats, "median"))
        self.assertTrue(hasattr(result.label_shape_stats, "p95"))
        # Expected: [0, 1, 1, 2, 4] sorted → min=0, median=1, p95=4
        self.assertEqual(result.label_shape_stats.min, 0)
        self.assertEqual(result.label_shape_stats.median, 1)

    def test_score_result_includes_positives_distribution_percentages(self):
        """ScoreResult must include percentage of 0/1/2+ positive queries."""
        from benchmark.benchmark_scorer import BenchmarkScorer, ScorerConfig
        scorer = BenchmarkScorer(self.dataset, ScorerConfig())
        run = Run(run_id="test", entries=[])
        result = scorer.score_run(run)
        # Must have distribution percentages as attributes
        self.assertTrue(hasattr(result.label_shape_stats, "pct_zero_positives"))
        self.assertTrue(hasattr(result.label_shape_stats, "pct_one_positive"))
        self.assertTrue(hasattr(result.label_shape_stats, "pct_two_plus_positives"))
        # 5 queries: 1 with 0, 2 with 1, 1 with 2, 1 with 4
        # pct_zero = 20%, pct_one = 40%, pct_two_plus = 40%
        self.assertAlmostEqual(result.label_shape_stats.pct_zero_positives, 20.0)
        self.assertAlmostEqual(result.label_shape_stats.pct_one_positive, 40.0)
        self.assertAlmostEqual(result.label_shape_stats.pct_two_plus_positives, 40.0)

    def test_markdown_output_includes_label_shape_section(self):
        """Markdown report must include label-shape statistics section."""
        from benchmark.benchmark_scorer import BenchmarkScorer, ScorerConfig, format_results_markdown
        scorer = BenchmarkScorer(self.dataset, ScorerConfig())
        run = Run(run_id="test", entries=[])
        result = scorer.score_run(run)
        md = format_results_markdown(result)
        # Must have a label shape section with stable field names
        self.assertIn("Label Shape", md)
        self.assertIn("min", md.lower())
        self.assertIn("median", md.lower())

    def test_label_shape_stats_use_stable_field_names(self):
        """Label shape stats must use stable field names for diffability."""
        from benchmark.benchmark_scorer import BenchmarkScorer, ScorerConfig, LabelShapeStats
        scorer = BenchmarkScorer(self.dataset, ScorerConfig())
        run = Run(run_id="test", entries=[])
        result = scorer.score_run(run)
        # Verify it's a LabelShapeStats dataclass with expected attributes
        self.assertIsInstance(result.label_shape_stats, LabelShapeStats)
        # Stable field names (snake_case, predictable) should exist as attributes
        expected_fields = {
            "min", "median", "p95", "mean",
            "pct_zero_positives", "pct_one_positive", "pct_two_plus_positives"
        }
        for field_name in expected_fields:
            self.assertTrue(hasattr(result.label_shape_stats, field_name), f"Missing field: {field_name}")


class TestPlan113MacroAveraging(unittest.TestCase):
    """
    Plan 113 Milestone 3: Hub dominance mitigation via macro + slice reporting.
    
    Tests that reports include macro-averaged metrics (per-query equal weighting)
    in addition to aggregate metrics, and slice membership counts.
    """

    def setUp(self):
        """Create dataset with varied slice membership and qrel counts."""
        self.topics = [
            Topic(query_id="q1", query_text="Easy query", slice_ids=["easy"]),
            Topic(query_id="q2", query_text="Easy query 2", slice_ids=["easy"]),
            Topic(query_id="q3", query_text="Easy query 3", slice_ids=["easy"]),
            Topic(query_id="q4", query_text="Hard query", slice_ids=["hard"]),
        ]
        # q1-q3 each have 1 qrel, q4 has 5 qrels (hub-like)
        self.qrels = [
            Qrel(query_id="q1", canonical_item_id="d1", relevance=1),
            Qrel(query_id="q2", canonical_item_id="d2", relevance=1),
            Qrel(query_id="q3", canonical_item_id="d3", relevance=1),
            Qrel(query_id="q4", canonical_item_id="d4", relevance=1),
            Qrel(query_id="q4", canonical_item_id="d5", relevance=1),
            Qrel(query_id="q4", canonical_item_id="d6", relevance=1),
            Qrel(query_id="q4", canonical_item_id="d7", relevance=1),
            Qrel(query_id="q4", canonical_item_id="d8", relevance=1),  # 5 positives total
        ]
        self.dataset = BenchmarkDataset(
            dataset_id="test-macro",
            version="1.0",
            topics=self.topics,
            qrels=self.qrels,
            slice_definitions={"easy": "Easy queries", "hard": "Hard queries"},
        )

    def test_score_result_includes_macro_metrics(self):
        """ScoreResult must include macro-averaged metrics separately from aggregate."""
        from benchmark.benchmark_scorer import BenchmarkScorer, ScorerConfig
        scorer = BenchmarkScorer(self.dataset, ScorerConfig(k_values=[5]))
        run = Run(run_id="test", entries=[
            RunEntry(query_id="q1", canonical_item_id="d1", rank=1, score=0.9),
            RunEntry(query_id="q2", canonical_item_id="d2", rank=1, score=0.9),
            RunEntry(query_id="q3", canonical_item_id="d3", rank=1, score=0.9),
            RunEntry(query_id="q4", canonical_item_id="d4", rank=1, score=0.9),  # only 1 of 5
        ])
        result = scorer.score_run(run)
        # Must have both aggregate and macro metrics
        self.assertIsNotNone(result.macro_metrics)
        self.assertIn("recall@5", result.macro_metrics)
        # Macro should weight each query equally
        # q1,q2,q3: recall=1.0, q4: recall=0.2 → macro = (1+1+1+0.2)/4 = 0.8
        self.assertAlmostEqual(result.macro_metrics["recall@5"], 0.8, places=2)

    def test_aggregate_and_macro_differ_with_hub_query(self):
        """
        Code review finding [MEDIUM]: Aggregate and macro must differ for hub dominance detection.
        
        With qrel-weighted aggregate, hub query (q4 with 5 qrels) will dominate.
        With macro (per-query equal weight), each query counts the same.
        """
        from benchmark.benchmark_scorer import BenchmarkScorer, ScorerConfig
        scorer = BenchmarkScorer(self.dataset, ScorerConfig(k_values=[5]))
        # Retrieve 1 of 5 for hub query q4, perfect for others
        run = Run(run_id="test", entries=[
            RunEntry(query_id="q1", canonical_item_id="d1", rank=1, score=0.9),
            RunEntry(query_id="q2", canonical_item_id="d2", rank=1, score=0.9),
            RunEntry(query_id="q3", canonical_item_id="d3", rank=1, score=0.9),
            RunEntry(query_id="q4", canonical_item_id="d4", rank=1, score=0.9),  # 1 of 5
        ])
        result = scorer.score_run(run)
        
        # Aggregate (qrel-weighted): 
        #   Total qrels = 8, retrieved relevant = 4 (1+1+1+1)
        #   Pool of per-query: weight each query by its qrel count
        #   q1: 1 qrel, recall=1.0  → contribution = 1*1.0 = 1.0
        #   q2: 1 qrel, recall=1.0  → contribution = 1*1.0 = 1.0
        #   q3: 1 qrel, recall=1.0  → contribution = 1*1.0 = 1.0
        #   q4: 5 qrels, recall=0.2 → contribution = 5*0.2 = 1.0
        #   aggregate = (1+1+1+1) / 8 = 4/8 = 0.5
        # Macro (per-query equal):
        #   (1.0 + 1.0 + 1.0 + 0.2) / 4 = 0.8
        
        # The key test: aggregate and macro MUST differ
        self.assertNotEqual(
            result.aggregate_metrics["recall@5"],
            result.macro_metrics["recall@5"],
            "Aggregate and macro metrics should differ to detect hub dominance"
        )
        # Macro should be higher (small queries helped more)
        self.assertGreater(
            result.macro_metrics["recall@5"],
            result.aggregate_metrics["recall@5"],
        )

    def test_per_slice_includes_query_counts(self):
        """Per-slice metrics must include query count for each slice."""
        from benchmark.benchmark_scorer import BenchmarkScorer, ScorerConfig
        scorer = BenchmarkScorer(self.dataset, ScorerConfig(k_values=[5]))
        run = Run(run_id="test", entries=[
            RunEntry(query_id="q1", canonical_item_id="d1", rank=1, score=0.9),
            RunEntry(query_id="q2", canonical_item_id="d2", rank=1, score=0.9),
            RunEntry(query_id="q3", canonical_item_id="d3", rank=1, score=0.9),
            RunEntry(query_id="q4", canonical_item_id="d4", rank=1, score=0.9),
        ])
        result = scorer.score_run(run)
        # Per-slice should have query_count
        self.assertIn("query_count", result.per_slice_metrics["easy"])
        self.assertEqual(result.per_slice_metrics["easy"]["query_count"], 3)
        self.assertEqual(result.per_slice_metrics["hard"]["query_count"], 1)

    def test_markdown_includes_both_aggregate_and_macro(self):
        """Markdown report must include both aggregate and macro-averaged sections."""
        from benchmark.benchmark_scorer import BenchmarkScorer, ScorerConfig, format_results_markdown
        scorer = BenchmarkScorer(self.dataset, ScorerConfig(k_values=[5]))
        run = Run(run_id="test", entries=[
            RunEntry(query_id="q1", canonical_item_id="d1", rank=1, score=0.9),
        ])
        result = scorer.score_run(run)
        md = format_results_markdown(result)
        # Must have both sections clearly labeled
        self.assertIn("Aggregate", md)
        self.assertIn("Macro", md)

    def test_slice_metrics_use_stable_ordering(self):
        """Slice metrics must use stable field ordering for diffability."""
        from benchmark.benchmark_scorer import BenchmarkScorer, ScorerConfig
        scorer = BenchmarkScorer(self.dataset, ScorerConfig(k_values=[5]))
        run = Run(run_id="test", entries=[])
        result = scorer.score_run(run)
        # JSON output should have sorted keys
        json_output = result.to_json()
        parsed = json.loads(json_output)
        # Slices should be sorted alphabetically
        slice_keys = list(parsed.get("per_slice_metrics", {}).keys())
        self.assertEqual(slice_keys, sorted(slice_keys))


class TestScorerOutputArtifacts(unittest.TestCase):
    """Tests for output artifact generation."""

    def setUp(self):
        """Create minimal test data."""
        self.topics = [
            Topic(query_id="q1", query_text="Query one", slice_ids=["general"]),
        ]
        self.qrels = [Qrel(query_id="q1", canonical_item_id="doc1", relevance=1)]
        self.dataset = BenchmarkDataset(
            dataset_id="test",
            version="1.0",
            topics=self.topics,
            qrels=self.qrels,
            slice_definitions={"general": "General queries"},
        )
        self.run = Run(
            run_id="test-run",
            entries=[RunEntry(query_id="q1", canonical_item_id="doc1", rank=1, score=0.9)],
        )

    def test_scorer_can_emit_json_results(self):
        """Scorer should emit machine-readable JSON results."""
        scorer = BenchmarkScorer(self.dataset, ScorerConfig())
        result = scorer.score_run(self.run)
        json_output = result.to_json()
        parsed = json.loads(json_output)
        self.assertIn("aggregate_metrics", parsed)
        self.assertIn("per_slice_metrics", parsed)

    def test_scorer_can_emit_run_summary(self):
        """Scorer should generate a RunSummary with required provenance."""
        scorer = BenchmarkScorer(self.dataset, ScorerConfig())
        result = scorer.score_run(self.run)
        summary = scorer.generate_run_summary(self.run, result)
        self.assertIsInstance(summary, RunSummary)
        self.assertEqual(summary.run_id, "test-run")
        self.assertEqual(summary.dataset_id, "test")


class TestPlan113MultiSliceQueries(unittest.TestCase):
    """
    Code review finding [MEDIUM]: Multi-slice queries should count toward all slices.
    
    Tests that queries with multiple slice_ids contribute to metrics for each slice,
    not just the first slice.
    """

    def setUp(self):
        """Create dataset with multi-slice queries."""
        self.topics = [
            Topic(query_id="q1", query_text="Query in one slice", slice_ids=["slice-a"]),
            Topic(query_id="q2", query_text="Query in two slices", slice_ids=["slice-a", "slice-b"]),
            Topic(query_id="q3", query_text="Query in slice B only", slice_ids=["slice-b"]),
        ]
        self.qrels = [
            Qrel(query_id="q1", canonical_item_id="d1", relevance=1),
            Qrel(query_id="q2", canonical_item_id="d2", relevance=1),
            Qrel(query_id="q3", canonical_item_id="d3", relevance=1),
        ]
        self.dataset = BenchmarkDataset(
            dataset_id="test-multislice",
            version="1.0",
            topics=self.topics,
            qrels=self.qrels,
            slice_definitions={"slice-a": "Slice A", "slice-b": "Slice B"},
        )

    def test_multi_slice_query_counts_toward_all_slices(self):
        """Query with multiple slice_ids should count in each slice's metrics."""
        scorer = BenchmarkScorer(self.dataset, ScorerConfig(k_values=[5]))
        run = Run(run_id="test", entries=[
            RunEntry(query_id="q1", canonical_item_id="d1", rank=1, score=0.9),
            RunEntry(query_id="q2", canonical_item_id="d2", rank=1, score=0.9),
            RunEntry(query_id="q3", canonical_item_id="d3", rank=1, score=0.9),
        ])
        result = scorer.score_run(run)
        
        # q2 should count in BOTH slice-a AND slice-b
        # slice-a: q1, q2 → 2 queries
        # slice-b: q2, q3 → 2 queries
        self.assertEqual(result.per_slice_metrics["slice-a"]["query_count"], 2)
        self.assertEqual(result.per_slice_metrics["slice-b"]["query_count"], 2)

    def test_multi_slice_query_metrics_included_in_each_slice(self):
        """Multi-slice query's metrics should be included in each slice's aggregate."""
        scorer = BenchmarkScorer(self.dataset, ScorerConfig(k_values=[5]))
        # q2 gets perfect recall, q3 gets zero recall
        run = Run(run_id="test", entries=[
            RunEntry(query_id="q1", canonical_item_id="d1", rank=1, score=0.9),  # recall=1
            RunEntry(query_id="q2", canonical_item_id="d2", rank=1, score=0.9),  # recall=1
            # q3 has no results → recall=0
        ])
        result = scorer.score_run(run)
        
        # slice-a: q1 (recall=1), q2 (recall=1) → avg = 1.0
        # slice-b: q2 (recall=1), q3 (recall=0) → avg = 0.5
        self.assertAlmostEqual(result.per_slice_metrics["slice-a"]["recall@5"], 1.0, places=2)
        self.assertAlmostEqual(result.per_slice_metrics["slice-b"]["recall@5"], 0.5, places=2)


if __name__ == "__main__":
    unittest.main()
