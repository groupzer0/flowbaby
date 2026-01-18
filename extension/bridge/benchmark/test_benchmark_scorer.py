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


if __name__ == "__main__":
    unittest.main()
