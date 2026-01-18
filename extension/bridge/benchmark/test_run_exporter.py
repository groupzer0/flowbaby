"""
TDD tests for run_exporter.py (Step 3: Export Adapter)

Tests for exporting Flowbaby retrieval results into benchmark Run format.
"""

import unittest
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

# TDD Red Phase: Import the module we're about to create
from benchmark.run_exporter import (
    RetrievalResultAdapter,
    export_retrieval_results_to_run,
    filter_benchmark_mode_results,
)
from benchmark.benchmark_contract import (
    Run,
    RunEntry,
    canonicalize_id,
)


# Mock Flowbaby retrieval result structure for testing
@dataclass
class MockRetrievalResult:
    """Mock of Flowbaby RetrievalResult for testing."""
    topic_id: Optional[str] = None
    topic: Optional[str] = None
    summary_text: Optional[str] = None
    score: float = 0.0
    metadata: Optional[Dict[str, Any]] = None


class TestRetrievalResultAdapter(unittest.TestCase):
    """Tests for adapting Flowbaby retrieval results."""

    def test_adapter_extracts_canonical_id_from_topic_id(self):
        """Adapter should extract canonical ID from topic_id field."""
        result = MockRetrievalResult(topic_id="test-uuid-123", score=0.9)
        adapter = RetrievalResultAdapter(result)
        self.assertEqual(adapter.get_canonical_id(), "test-uuid-123")

    def test_adapter_falls_back_to_topic_uuid5_when_no_topic_id(self):
        """Adapter should generate uuid5 from topic when topic_id missing."""
        result = MockRetrievalResult(topic="Test query", score=0.8)
        adapter = RetrievalResultAdapter(result)
        canonical_id = adapter.get_canonical_id()
        # Should be a uuid5 of normalized topic
        self.assertIsNotNone(canonical_id)
        self.assertNotEqual(canonical_id, "Test query")  # Not the raw topic

    def test_adapter_never_uses_summary_text_for_id(self):
        """Adapter must NOT use summary_text for ID generation (Analysis 111)."""
        result = MockRetrievalResult(
            topic_id=None,
            topic=None,
            summary_text="Some summary content",
            score=0.7,
        )
        adapter = RetrievalResultAdapter(result)
        canonical_id = adapter.get_canonical_id()
        # Should be None, not derived from summary_text
        self.assertIsNone(canonical_id)

    def test_adapter_extracts_score(self):
        """Adapter should extract retrieval score."""
        result = MockRetrievalResult(topic_id="test-id", score=0.95)
        adapter = RetrievalResultAdapter(result)
        self.assertEqual(adapter.get_score(), 0.95)

    def test_adapter_handles_dict_input(self):
        """Adapter should work with dict representations (API responses)."""
        result_dict = {
            "topic_id": "dict-uuid",
            "topic": "Query from dict",
            "score": 0.85,
        }
        adapter = RetrievalResultAdapter(result_dict)
        self.assertEqual(adapter.get_canonical_id(), "dict-uuid")
        self.assertEqual(adapter.get_score(), 0.85)


class TestExportRetrievalResultsToRun(unittest.TestCase):
    """Tests for exporting retrieval results to Run format."""

    def test_export_creates_run_with_correct_id(self):
        """Export should create Run with specified run_id."""
        results = {"q1": [MockRetrievalResult(topic_id="doc1", score=0.9)]}
        run = export_retrieval_results_to_run(results, run_id="test-run-001")
        self.assertEqual(run.run_id, "test-run-001")

    def test_export_creates_run_entries_for_each_result(self):
        """Export should create RunEntry for each retrieval result."""
        results = {
            "q1": [
                MockRetrievalResult(topic_id="doc1", score=0.9),
                MockRetrievalResult(topic_id="doc2", score=0.8),
            ],
            "q2": [
                MockRetrievalResult(topic_id="doc3", score=0.95),
            ],
        }
        run = export_retrieval_results_to_run(results, run_id="test")
        self.assertEqual(len(run.entries), 3)

    def test_export_assigns_ranks_by_score(self):
        """Export should assign ranks in descending score order."""
        results = {
            "q1": [
                MockRetrievalResult(topic_id="low", score=0.5),
                MockRetrievalResult(topic_id="high", score=0.9),
                MockRetrievalResult(topic_id="mid", score=0.7),
            ],
        }
        run = export_retrieval_results_to_run(results, run_id="test")
        entries_q1 = [e for e in run.entries if e.query_id == "q1"]
        # Should be sorted by score descending
        self.assertEqual(entries_q1[0].canonical_item_id, "high")
        self.assertEqual(entries_q1[0].rank, 1)
        self.assertEqual(entries_q1[1].canonical_item_id, "mid")
        self.assertEqual(entries_q1[1].rank, 2)
        self.assertEqual(entries_q1[2].canonical_item_id, "low")
        self.assertEqual(entries_q1[2].rank, 3)

    def test_export_skips_non_canonical_results(self):
        """Export should skip results without canonical IDs."""
        results = {
            "q1": [
                MockRetrievalResult(topic_id="valid-id", score=0.9),
                MockRetrievalResult(topic_id=None, topic=None, score=0.8),  # No ID
            ],
        }
        run = export_retrieval_results_to_run(results, run_id="test")
        # Should only have 1 entry (the one with valid ID)
        self.assertEqual(len(run.entries), 1)
        self.assertEqual(run.entries[0].canonical_item_id, "valid-id")

    def test_export_handles_empty_results(self):
        """Export should handle empty result sets gracefully."""
        results: Dict[str, List[Any]] = {}
        run = export_retrieval_results_to_run(results, run_id="empty-run")
        self.assertEqual(run.run_id, "empty-run")
        self.assertEqual(len(run.entries), 0)

    def test_export_handles_queries_with_no_results(self):
        """Export should handle queries that return no results."""
        results = {
            "q1": [],  # No results for this query
            "q2": [MockRetrievalResult(topic_id="doc1", score=0.9)],
        }
        run = export_retrieval_results_to_run(results, run_id="test")
        # Should only have entries for q2
        self.assertEqual(len(run.entries), 1)
        self.assertEqual(run.entries[0].query_id, "q2")


class TestFilterBenchmarkModeResults(unittest.TestCase):
    """Tests for filtering results to benchmark mode (no LLM completions)."""

    def test_filter_excludes_llm_generated_content(self):
        """Filter should exclude results with LLM-generated content markers."""
        results = [
            MockRetrievalResult(
                topic_id="raw-retrieval",
                score=0.9,
                metadata={"source": "retrieval"},
            ),
            MockRetrievalResult(
                topic_id="llm-augmented",
                score=0.95,
                metadata={"source": "llm_completion"},  # Should be excluded
            ),
        ]
        filtered = filter_benchmark_mode_results(results)
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0].topic_id, "raw-retrieval")

    def test_filter_keeps_all_results_without_llm_markers(self):
        """Filter should keep results without LLM markers."""
        results = [
            MockRetrievalResult(topic_id="doc1", score=0.9),
            MockRetrievalResult(topic_id="doc2", score=0.8),
        ]
        filtered = filter_benchmark_mode_results(results)
        self.assertEqual(len(filtered), 2)

    def test_filter_handles_empty_list(self):
        """Filter should handle empty result list."""
        results: List[MockRetrievalResult] = []
        filtered = filter_benchmark_mode_results(results)
        self.assertEqual(len(filtered), 0)

    def test_filter_handles_results_without_metadata(self):
        """Filter should handle results without metadata field."""
        results = [
            MockRetrievalResult(topic_id="no-metadata", score=0.9, metadata=None),
        ]
        filtered = filter_benchmark_mode_results(results)
        self.assertEqual(len(filtered), 1)


class TestExportRoundTrip(unittest.TestCase):
    """Integration tests for export + scoring workflow."""

    def test_exported_run_can_be_scored(self):
        """Exported run should be compatible with BenchmarkScorer."""
        from benchmark.benchmark_scorer import BenchmarkScorer, ScorerConfig
        from benchmark.benchmark_contract import Topic, Qrel, BenchmarkDataset

        # Create a minimal dataset
        dataset = BenchmarkDataset(
            dataset_id="test",
            version="1.0",
            topics=[Topic(query_id="q1", query_text="Test", slice_ids=["general"])],
            qrels=[Qrel(query_id="q1", canonical_item_id="doc1", relevance=1)],
            slice_definitions={"general": "General queries"},
        )

        # Export mock retrieval results
        results = {
            "q1": [MockRetrievalResult(topic_id="doc1", score=0.9)],
        }
        run = export_retrieval_results_to_run(results, run_id="integration-test")

        # Score should work without errors
        scorer = BenchmarkScorer(dataset, ScorerConfig(k_values=[5]))
        score_result = scorer.score_run(run)
        self.assertIn("recall@5", score_result.aggregate_metrics)


if __name__ == "__main__":
    unittest.main()
