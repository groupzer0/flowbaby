#!/usr/bin/env python3
"""
Benchmark Data Contract for Plan 112: Retrieval-First Benchmark Harness

Defines the schema for:
- Topics (queries)
- Qrels (relevance judgments)
- Runs (retrieval results)
- RunSummary (provenance + telemetry)

Per Step 0 decisions:
- Evaluation unit: RetrievalResult (summary-level)
- Stable identifier: topic_id (UUID) when present
- Legacy fallback: uuid5(NAMESPACE, normalize(topic)) - NOT summary_text hashing
- Canonicalization version: v1
"""

from __future__ import annotations
import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional, Any
from uuid import uuid5, NAMESPACE_DNS
from collections import defaultdict


# ============================================================================
# Constants
# ============================================================================

CANONICALIZATION_VERSION = "v1"
"""
Canonicalization version per Step 0 decision.
Bump this when:
- Normalization rules change
- ID composition rules change
- Fallback hierarchy changes
"""

# Plan 113 M4: Valid split values for leakage discipline
VALID_SPLITS = frozenset({"train", "validation", "test"})
"""
Valid values for Topic.split field.
- train: For training/development
- validation: For hyperparameter tuning and model selection
- test: For final evaluation only (NEVER use for selection)
"""


class SplitDisciplineError(ValueError):
    """
    Raised when a workflow violates split discipline (Plan 113 M4).
    
    Example: Using test split for threshold tuning or model selection.
    """
    pass


def validate_split_discipline(
    selection_split: str,
    evaluation_split: str,
) -> None:
    """
    Validate that a workflow doesn't leak test data (Plan 113 M4).
    
    Enforces the rule: test split MUST NOT be used for selection/tuning.
    
    Args:
        selection_split: Split used for tuning/selection (thresholds, K values, etc.)
        evaluation_split: Split used for final evaluation
    
    Raises:
        SplitDisciplineError: If selection_split is "test"
    """
    if selection_split == "test":
        raise SplitDisciplineError(
            f"Split discipline violation: cannot use 'test' split for selection/tuning. "
            f"Use 'train' or 'validation' for selection, then evaluate on 'test'. "
            f"Got selection_split='{selection_split}', evaluation_split='{evaluation_split}'."
        )


# ============================================================================
# Canonicalization
# ============================================================================

def normalize_topic(topic: str) -> str:
    """
    Normalize topic string for deterministic ID generation.
    
    Rules:
    - Lowercase
    - Strip leading/trailing whitespace
    """
    return topic.strip().lower()


def canonicalize_id(
    topic_id: Optional[str],
    topic: Optional[str],
    summary_text: Optional[str]  # Intentionally unused per Analysis 111
) -> Optional[str]:
    """
    Generate canonical item ID per Step 0 decisions.
    
    Hierarchy:
    1. If topic_id present: use topic_id directly
    2. Elif topic present and non-empty: use uuid5(NAMESPACE_DNS, normalize(topic))
    3. Else: return None (non-canonical, exclude from qrels unless mapping provided)
    
    NOTE: summary_text is intentionally NOT used for ID generation.
    This parameter exists only to make the contract explicit that we're
    deliberately ignoring it (per Analysis 111 guidance).
    
    Args:
        topic_id: UUID string from RetrievalResult.topic_id
        topic: Topic string from RetrievalResult.topic
        summary_text: Summary text (IGNORED - do not use for ID generation)
    
    Returns:
        Canonical ID string, or None if item is non-canonical
    """
    # Case 1: topic_id present
    if topic_id is not None and topic_id.strip():
        return topic_id.strip()
    
    # Case 2: topic present and non-empty
    if topic is not None and topic.strip():
        normalized = normalize_topic(topic)
        return str(uuid5(NAMESPACE_DNS, normalized))
    
    # Case 3: Neither present - non-canonical
    return None


# ============================================================================
# Data Classes
# ============================================================================

@dataclass
class Topic:
    """
    A benchmark query/topic.
    
    Attributes:
        query_id: Unique identifier for this query (e.g., "q001")
        query_text: The actual query text
        slice_ids: List of slice identifiers this query belongs to
        notes: Optional notes about the query
        expected_positive_count: Optional expected number of relevant items
        split: Optional split assignment (train/validation/test) for leakage discipline (Plan 113 M4)
    """
    query_id: str
    query_text: str
    slice_ids: List[str]
    notes: Optional[str] = None
    expected_positive_count: Optional[int] = None
    split: Optional[str] = None  # Plan 113 M4: train/validation/test


@dataclass
class Qrel:
    """
    A relevance judgment (query-level relevance for an item).
    
    Attributes:
        query_id: The query this judgment applies to
        canonical_item_id: Canonical ID of the relevant item
        relevance: Relevance grade (0=not relevant, 1=relevant, 2+=highly relevant)
    """
    query_id: str
    canonical_item_id: str
    relevance: int = 1  # Default to binary relevant


@dataclass
class RunEntry:
    """
    A single entry in a benchmark run (one retrieved item for one query).
    
    Attributes:
        query_id: The query this entry is for
        canonical_item_id: Canonical ID of the retrieved item
        rank: Rank position (1-indexed)
        score: Retrieval score
    """
    query_id: str
    canonical_item_id: str
    rank: int
    score: float


@dataclass
class Run:
    """
    A complete benchmark run (all retrieved items for all queries).
    
    Attributes:
        run_id: Unique identifier for this run
        entries: List of all run entries
    """
    run_id: str
    entries: List[RunEntry] = field(default_factory=list)
    
    def entries_by_query(self) -> Dict[str, List[RunEntry]]:
        """Group entries by query ID."""
        result: Dict[str, List[RunEntry]] = defaultdict(list)
        for entry in self.entries:
            result[entry.query_id].append(entry)
        return dict(result)


@dataclass
class RunSummary:
    """
    Run-level provenance and telemetry per Plan 112 requirements.
    
    Required fields (per plan):
    - run_id, timestamp, git_sha
    - dataset_id, dataset_version
    - topics_version, qrels_version (or combined judgments_version)
    - retrieval_contract_version
    - canonicalization_version
    - metrics, k_values
    - query_count, duration_ms
    
    Optional ingestion telemetry (for attribution):
    - zero_edge_ratio, edge_count_summary, ontology_valid_ratio
    
    Optional per-slice metrics:
    - per_slice_metrics
    
    Optional split provenance (Plan 113 M4 code review fix):
    - selection_split, evaluation_split
    """
    # Required provenance
    run_id: str
    timestamp: str  # ISO 8601
    git_sha: str
    dataset_id: str
    dataset_version: str
    topics_version: str
    qrels_version: str
    retrieval_contract_version: str
    canonicalization_version: str
    metrics: Dict[str, float]
    k_values: List[int]
    query_count: int
    duration_ms: int
    
    # Optional ingestion telemetry (for attribution per Analysis 111)
    zero_edge_ratio: Optional[float] = None
    edge_count_summary: Optional[Dict[str, int]] = None  # min, median, max
    ontology_valid_ratio: Optional[float] = None
    template_artifact_counts: Optional[Dict[str, int]] = None
    
    # Optional per-slice metrics
    per_slice_metrics: Optional[Dict[str, Dict[str, Any]]] = None
    
    # Optional extra provenance
    summary_template_version: Optional[str] = None
    ontology_version: Optional[str] = None
    llm_model: Optional[str] = None
    retrieval_mode: Optional[str] = None
    
    # Plan 113 M4 code review fix: Split provenance for leakage discipline
    selection_split: Optional[str] = None  # Split used for tuning/selection
    evaluation_split: Optional[str] = None  # Split used for final evaluation


@dataclass
class BenchmarkDataset:
    """
    A complete benchmark dataset (topics + qrels + metadata).
    
    Attributes:
        dataset_id: Unique identifier for this dataset
        version: Semantic version of this dataset
        topics: List of all topics/queries
        qrels: List of all relevance judgments
        slice_definitions: Description of each slice
    """
    dataset_id: str
    version: str
    topics: List[Topic]
    qrels: List[Qrel]
    slice_definitions: Dict[str, str]
    
    def qrels_by_query(self) -> Dict[str, List[Qrel]]:
        """Group qrels by query ID."""
        result: Dict[str, List[Qrel]] = defaultdict(list)
        for qrel in self.qrels:
            result[qrel.query_id].append(qrel)
        return dict(result)
    
    def topics_by_slice(self) -> Dict[str, List[Topic]]:
        """Group topics by slice ID."""
        result: Dict[str, List[Topic]] = defaultdict(list)
        for topic in self.topics:
            for slice_id in topic.slice_ids:
                result[slice_id].append(topic)
        return dict(result)
    
    def topics_by_split(self, split: str) -> List[Topic]:
        """
        Filter topics by split assignment (Plan 113 M4).
        
        Args:
            split: One of 'train', 'validation', 'test'
        
        Returns:
            List of topics with the specified split assignment
        """
        return [t for t in self.topics if t.split == split]
    
    def split_distribution(self) -> Dict[str, int]:
        """
        Return distribution of topics across splits (Plan 113 M4).
        
        Returns:
            Dict mapping split name to count of topics.
            Includes 'unassigned' for topics without a split.
        """
        distribution: Dict[str, int] = defaultdict(int)
        for topic in self.topics:
            if topic.split:
                distribution[topic.split] += 1
            else:
                distribution["unassigned"] += 1
        return dict(distribution)


# ============================================================================
# File I/O
# ============================================================================

def _dataclass_to_dict(obj: Any) -> Any:
    """Convert dataclass to dict, handling nested dataclasses."""
    if hasattr(obj, '__dataclass_fields__'):
        return {k: _dataclass_to_dict(v) for k, v in asdict(obj).items()}
    elif isinstance(obj, list):
        return [_dataclass_to_dict(item) for item in obj]
    elif isinstance(obj, dict):
        return {k: _dataclass_to_dict(v) for k, v in obj.items()}
    return obj


def load_topics(filepath: Path) -> List[Topic]:
    """Load topics from JSON file."""
    with open(filepath) as f:
        data = json.load(f)
    return [
        Topic(
            query_id=t["query_id"],
            query_text=t["query_text"],
            slice_ids=t["slice_ids"],
            notes=t.get("notes"),
            expected_positive_count=t.get("expected_positive_count"),
            split=t.get("split"),  # Plan 113 M4
        )
        for t in data
    ]


def load_qrels(filepath: Path) -> List[Qrel]:
    """Load qrels from JSON file."""
    with open(filepath) as f:
        data = json.load(f)
    return [
        Qrel(
            query_id=q["query_id"],
            canonical_item_id=q["canonical_item_id"],
            relevance=q.get("relevance", 1),
        )
        for q in data
    ]


def load_run(filepath: Path) -> Run:
    """Load run from JSON file."""
    with open(filepath) as f:
        data = json.load(f)
    return Run(
        run_id=data["run_id"],
        entries=[
            RunEntry(
                query_id=e["query_id"],
                canonical_item_id=e["canonical_item_id"],
                rank=e["rank"],
                score=e["score"],
            )
            for e in data["entries"]
        ]
    )


def save_run(run: Run, filepath: Path) -> None:
    """Save run to JSON file."""
    data = _dataclass_to_dict(run)
    with open(filepath, 'w') as f:
        json.dump(data, f, indent=2)


def save_run_summary(summary: RunSummary, filepath: Path) -> None:
    """Save run summary to JSON file."""
    data = _dataclass_to_dict(summary)
    # Remove None values for cleaner output
    data = {k: v for k, v in data.items() if v is not None}
    with open(filepath, 'w') as f:
        json.dump(data, f, indent=2)


def save_topics(topics: List[Topic], filepath: Path) -> None:
    """Save topics to JSON file."""
    data = [_dataclass_to_dict(t) for t in topics]
    with open(filepath, 'w') as f:
        json.dump(data, f, indent=2)


def save_qrels(qrels: List[Qrel], filepath: Path) -> None:
    """Save qrels to JSON file."""
    data = [_dataclass_to_dict(q) for q in qrels]
    with open(filepath, 'w') as f:
        json.dump(data, f, indent=2)


def save_dataset(dataset: BenchmarkDataset, directory: Path) -> None:
    """Save complete dataset to a directory."""
    directory.mkdir(parents=True, exist_ok=True)
    
    # Save metadata
    metadata = {
        "dataset_id": dataset.dataset_id,
        "version": dataset.version,
        "slice_definitions": dataset.slice_definitions,
        "canonicalization_version": CANONICALIZATION_VERSION,
    }
    with open(directory / "metadata.json", 'w') as f:
        json.dump(metadata, f, indent=2)
    
    # Save topics and qrels
    save_topics(dataset.topics, directory / "topics.json")
    save_qrels(dataset.qrels, directory / "qrels.json")


def load_dataset(directory: Path) -> BenchmarkDataset:
    """Load complete dataset from a directory."""
    with open(directory / "metadata.json") as f:
        metadata = json.load(f)
    
    topics = load_topics(directory / "topics.json")
    qrels = load_qrels(directory / "qrels.json")
    
    return BenchmarkDataset(
        dataset_id=metadata["dataset_id"],
        version=metadata["version"],
        topics=topics,
        qrels=qrels,
        slice_definitions=metadata.get("slice_definitions", {}),
    )
