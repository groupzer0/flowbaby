#!/usr/bin/env python3
"""
TDD tests for Plan 112: Retrieval-First Benchmark Harness

Tests for the benchmark data contract (topics, qrels, runs, runSummary).
Written FIRST per TDD mandate - these tests should FAIL until implementation exists.
"""

import json
import pytest
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid5, NAMESPACE_DNS

# These imports will fail until we implement the modules (TDD Red phase)
from benchmark.benchmark_contract import (
    Topic,
    Qrel,
    Run,
    RunEntry,
    RunSummary,
    BenchmarkDataset,
    canonicalize_id,
    CANONICALIZATION_VERSION,
    load_topics,
    load_qrels,
    load_run,
    save_run,
    save_run_summary,
)


class TestCanonicalizeId:
    """Test the canonical ID generation per Step 0 decisions."""

    def test_topic_id_present_uses_topic_id(self):
        """When topic_id is present, it becomes the canonical ID."""
        result = canonicalize_id(
            topic_id="3e3e4f26-7c02-4b3c-8b9d-8f1f9b3e2a10",
            topic="Some topic text",
            summary_text="Some summary"
        )
        assert result == "3e3e4f26-7c02-4b3c-8b9d-8f1f9b3e2a10"

    def test_topic_id_missing_uses_uuid5_of_topic(self):
        """When topic_id missing but topic present, use uuid5(normalize(topic))."""
        result = canonicalize_id(
            topic_id=None,
            topic="Plan 014 – Structured Summaries",
            summary_text="Some summary"
        )
        # uuid5 of normalized topic should be deterministic
        expected = str(uuid5(NAMESPACE_DNS, "plan 014 – structured summaries"))
        assert result == expected

    def test_topic_normalization_is_case_insensitive(self):
        """Topic normalization should be case-insensitive."""
        result1 = canonicalize_id(None, "Plan 014", "summary1")
        result2 = canonicalize_id(None, "PLAN 014", "summary2")
        result3 = canonicalize_id(None, "plan 014", "summary3")
        assert result1 == result2 == result3

    def test_topic_normalization_strips_whitespace(self):
        """Topic normalization should strip leading/trailing whitespace."""
        result1 = canonicalize_id(None, "Plan 014", "summary")
        result2 = canonicalize_id(None, "  Plan 014  ", "summary")
        assert result1 == result2

    def test_neither_topic_id_nor_topic_returns_none(self):
        """When both topic_id and topic are missing, return None (non-canonical)."""
        result = canonicalize_id(
            topic_id=None,
            topic=None,
            summary_text="Some raw legacy summary"
        )
        assert result is None

    def test_empty_topic_treated_as_none(self):
        """Empty or whitespace-only topic should be treated as None."""
        result = canonicalize_id(None, "", "summary")
        assert result is None
        result2 = canonicalize_id(None, "   ", "summary")
        assert result2 is None

    def test_summary_text_is_never_used_for_id(self):
        """Per Analysis 111: summary_text MUST NOT be used for canonical ID."""
        # Two items with same topic_id but different summary_text
        result1 = canonicalize_id("id-123", "topic", "summary version 1")
        result2 = canonicalize_id("id-123", "topic", "summary version 2 with changes")
        assert result1 == result2 == "id-123"


class TestTopic:
    """Test Topic dataclass for query/topic representation."""

    def test_topic_creation_with_required_fields(self):
        """Topic must have query_id, query_text, and slice_ids."""
        topic = Topic(
            query_id="q001",
            query_text="What decisions did we make about authentication?",
            slice_ids=["chat-shaped", "relationship-heavy"]
        )
        assert topic.query_id == "q001"
        assert topic.query_text == "What decisions did we make about authentication?"
        assert topic.slice_ids == ["chat-shaped", "relationship-heavy"]

    def test_topic_optional_metadata(self):
        """Topic may have optional metadata fields."""
        topic = Topic(
            query_id="q002",
            query_text="How does the retrieval pipeline work?",
            slice_ids=["technical"],
            notes="Tests technical documentation retrieval",
            expected_positive_count=3
        )
        assert topic.notes == "Tests technical documentation retrieval"
        assert topic.expected_positive_count == 3


class TestQrel:
    """Test Qrel dataclass for relevance judgments."""

    def test_qrel_binary_relevance(self):
        """Qrel with binary relevance (relevant=1, not relevant=0)."""
        qrel = Qrel(
            query_id="q001",
            canonical_item_id="3e3e4f26-7c02-4b3c-8b9d-8f1f9b3e2a10",
            relevance=1
        )
        assert qrel.query_id == "q001"
        assert qrel.canonical_item_id == "3e3e4f26-7c02-4b3c-8b9d-8f1f9b3e2a10"
        assert qrel.relevance == 1

    def test_qrel_graded_relevance(self):
        """Qrel supports graded relevance (0, 1, 2, 3)."""
        qrel = Qrel(
            query_id="q001",
            canonical_item_id="item-abc",
            relevance=2  # Partially relevant
        )
        assert qrel.relevance == 2

    def test_qrel_multi_positive_per_query(self):
        """Multiple qrels can exist for the same query (multi-positive)."""
        qrels = [
            Qrel("q001", "item-a", 1),
            Qrel("q001", "item-b", 1),
            Qrel("q001", "item-c", 2),
        ]
        assert len(qrels) == 3
        assert all(q.query_id == "q001" for q in qrels)


class TestRunEntry:
    """Test RunEntry for a single item in a run."""

    def test_run_entry_creation(self):
        """RunEntry has query_id, canonical_item_id, rank, and score."""
        entry = RunEntry(
            query_id="q001",
            canonical_item_id="item-abc",
            rank=1,
            score=0.95
        )
        assert entry.query_id == "q001"
        assert entry.rank == 1
        assert entry.score == 0.95


class TestRun:
    """Test Run dataclass representing a full benchmark run."""

    def test_run_creation(self):
        """Run contains metadata and entries."""
        run = Run(
            run_id="run-2026-01-18-001",
            entries=[
                RunEntry("q001", "item-a", 1, 0.95),
                RunEntry("q001", "item-b", 2, 0.82),
                RunEntry("q002", "item-c", 1, 0.91),
            ]
        )
        assert run.run_id == "run-2026-01-18-001"
        assert len(run.entries) == 3

    def test_run_entries_by_query(self):
        """Run should provide entries grouped by query."""
        run = Run(
            run_id="test-run",
            entries=[
                RunEntry("q001", "item-a", 1, 0.95),
                RunEntry("q001", "item-b", 2, 0.82),
                RunEntry("q002", "item-c", 1, 0.91),
            ]
        )
        by_query = run.entries_by_query()
        assert len(by_query["q001"]) == 2
        assert len(by_query["q002"]) == 1


class TestRunSummary:
    """Test RunSummary schema for provenance and telemetry."""

    def test_run_summary_required_provenance_fields(self):
        """RunSummary must include all required provenance fields."""
        summary = RunSummary(
            run_id="run-2026-01-18-001",
            timestamp=datetime.now(timezone.utc).isoformat(),
            git_sha="abc123def456",
            dataset_id="flowbaby-benchmark-v1",
            dataset_version="1.0.0",
            topics_version="1.0.0",
            qrels_version="1.0.0",
            retrieval_contract_version="2.0.0",
            canonicalization_version=CANONICALIZATION_VERSION,
            metrics={"Recall@5": 0.8, "MRR": 0.75},
            k_values=[5, 10],
            query_count=15,
            duration_ms=1234
        )
        assert summary.run_id == "run-2026-01-18-001"
        assert summary.canonicalization_version == "v1"
        assert summary.query_count == 15

    def test_run_summary_ingestion_telemetry(self):
        """RunSummary should include ingestion-quality telemetry aggregates."""
        summary = RunSummary(
            run_id="test",
            timestamp=datetime.now(timezone.utc).isoformat(),
            git_sha="abc123",
            dataset_id="test",
            dataset_version="1.0.0",
            topics_version="1.0.0",
            qrels_version="1.0.0",
            retrieval_contract_version="2.0.0",
            canonicalization_version="v1",
            metrics={},
            k_values=[5],
            query_count=10,
            duration_ms=100,
            # Ingestion telemetry (optional but recommended)
            zero_edge_ratio=0.15,
            edge_count_summary={"min": 0, "median": 3, "max": 12},
            ontology_valid_ratio=0.92,
        )
        assert summary.zero_edge_ratio == 0.15
        assert summary.edge_count_summary["median"] == 3

    def test_run_summary_per_slice_metrics(self):
        """RunSummary should support per-slice metric reporting."""
        summary = RunSummary(
            run_id="test",
            timestamp=datetime.now(timezone.utc).isoformat(),
            git_sha="abc123",
            dataset_id="test",
            dataset_version="1.0.0",
            topics_version="1.0.0",
            qrels_version="1.0.0",
            retrieval_contract_version="2.0.0",
            canonicalization_version="v1",
            metrics={"Recall@5": 0.8},
            k_values=[5],
            query_count=10,
            duration_ms=100,
            per_slice_metrics={
                "chat-shaped": {"Recall@5": 0.9, "query_count": 3},
                "technical": {"Recall@5": 0.7, "query_count": 4},
                "edge-sparse": {"Recall@5": 0.6, "query_count": 3},
            }
        )
        assert summary.per_slice_metrics["chat-shaped"]["Recall@5"] == 0.9


class TestBenchmarkDataset:
    """Test BenchmarkDataset container for topics + qrels."""

    def test_dataset_creation(self):
        """BenchmarkDataset bundles topics and qrels with versioning."""
        dataset = BenchmarkDataset(
            dataset_id="flowbaby-benchmark-v1",
            version="1.0.0",
            topics=[
                Topic("q001", "Query 1", ["slice-a"]),
                Topic("q002", "Query 2", ["slice-b"]),
            ],
            qrels=[
                Qrel("q001", "item-a", 1),
                Qrel("q002", "item-b", 1),
            ],
            slice_definitions={
                "slice-a": "Description of slice A",
                "slice-b": "Description of slice B",
            }
        )
        assert dataset.dataset_id == "flowbaby-benchmark-v1"
        assert len(dataset.topics) == 2
        assert len(dataset.qrels) == 2

    def test_dataset_qrels_by_query(self):
        """Dataset provides qrels grouped by query for scoring."""
        dataset = BenchmarkDataset(
            dataset_id="test",
            version="1.0.0",
            topics=[Topic("q001", "Query", ["slice"])],
            qrels=[
                Qrel("q001", "item-a", 1),
                Qrel("q001", "item-b", 2),
            ],
            slice_definitions={}
        )
        by_query = dataset.qrels_by_query()
        assert len(by_query["q001"]) == 2


class TestFileIO:
    """Test loading and saving benchmark artifacts."""

    def test_save_and_load_run(self, tmp_path):
        """Run can be saved to JSON and loaded back."""
        run = Run(
            run_id="test-run",
            entries=[
                RunEntry("q001", "item-a", 1, 0.95),
                RunEntry("q001", "item-b", 2, 0.82),
            ]
        )
        filepath = tmp_path / "run.json"
        save_run(run, filepath)
        
        loaded = load_run(filepath)
        assert loaded.run_id == run.run_id
        assert len(loaded.entries) == 2

    def test_save_run_summary(self, tmp_path):
        """RunSummary can be saved to JSON."""
        summary = RunSummary(
            run_id="test",
            timestamp=datetime.now(timezone.utc).isoformat(),
            git_sha="abc123",
            dataset_id="test",
            dataset_version="1.0.0",
            topics_version="1.0.0",
            qrels_version="1.0.0",
            retrieval_contract_version="2.0.0",
            canonicalization_version="v1",
            metrics={"Recall@5": 0.8},
            k_values=[5],
            query_count=10,
            duration_ms=100,
        )
        filepath = tmp_path / "run_summary.json"
        save_run_summary(summary, filepath)
        
        assert filepath.exists()
        with open(filepath) as f:
            data = json.load(f)
        assert data["run_id"] == "test"
        assert data["canonicalization_version"] == "v1"


class TestCanonalizationVersionConstant:
    """Test that canonicalization version is properly defined."""

    def test_canonicalization_version_is_v1(self):
        """CANONICALIZATION_VERSION should be 'v1' per Step 0 decision."""
        assert CANONICALIZATION_VERSION == "v1"
