"""
Run Exporter for Flowbaby Benchmark (Step 3)

Exports Flowbaby retrieval results into benchmark Run format.
Separates "produce a run" from "score a run" for deterministic CI.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from benchmark.benchmark_contract import (
    Run,
    RunEntry,
    canonicalize_id,
)


@runtime_checkable
class RetrievalResultLike(Protocol):
    """Protocol for objects that look like RetrievalResult."""

    topic_id: Optional[str]
    topic: Optional[str]
    summary_text: Optional[str]
    score: float


class RetrievalResultAdapter:
    """
    Adapter for extracting benchmark-relevant fields from retrieval results.

    Handles both object and dict representations (e.g., API responses).
    Follows Step 0 ID rules: topic_id → uuid5(topic) → None (never summary_text).
    """

    def __init__(self, result: Any):
        """
        Initialize adapter with a retrieval result.

        Args:
            result: Either a RetrievalResult-like object or a dict
        """
        self._result = result
        self._is_dict = isinstance(result, dict)

    def _get_field(self, name: str, default: Any = None) -> Any:
        """Get a field from the result, handling both object and dict."""
        if self._is_dict:
            return self._result.get(name, default)
        return getattr(self._result, name, default)

    def get_canonical_id(self) -> Optional[str]:
        """
        Get canonical item ID following Step 0 rules.

        Returns:
            Canonical ID or None if non-canonical
        """
        topic_id = self._get_field("topic_id")
        topic = self._get_field("topic")
        summary_text = self._get_field("summary_text")  # Intentionally ignored

        return canonicalize_id(topic_id, topic, summary_text)

    def get_score(self) -> float:
        """Get retrieval score."""
        return float(self._get_field("score", 0.0))

    def get_metadata(self) -> Optional[Dict[str, Any]]:
        """Get result metadata."""
        return self._get_field("metadata")


def filter_benchmark_mode_results(results: List[Any]) -> List[Any]:
    """
    Filter results to exclude LLM-generated content for benchmark mode.

    Per plan: "The exporter explicitly avoids retrieval modes that embed
    LLM completions when operating in 'benchmark mode'."

    Args:
        results: List of retrieval results

    Returns:
        Filtered list with LLM-augmented results removed
    """
    filtered = []
    for result in results:
        adapter = RetrievalResultAdapter(result)
        metadata = adapter.get_metadata()

        # Check for LLM completion markers in metadata
        if metadata:
            source = metadata.get("source", "")
            if "llm" in source.lower() or "completion" in source.lower():
                continue

        filtered.append(result)

    return filtered


def export_retrieval_results_to_run(
    results: Dict[str, List[Any]],
    run_id: str,
    filter_llm: bool = True,
) -> Run:
    """
    Export retrieval results to benchmark Run format.

    Args:
        results: Dict mapping query_id -> list of retrieval results
        run_id: Unique identifier for this run
        filter_llm: Whether to filter out LLM-augmented results

    Returns:
        Run object with ranked entries for each query
    """
    entries: List[RunEntry] = []

    for query_id, query_results in results.items():
        if not query_results:
            continue

        # Optionally filter LLM content
        if filter_llm:
            query_results = filter_benchmark_mode_results(query_results)

        # Convert to adapters and extract canonical IDs
        adapted = []
        for result in query_results:
            adapter = RetrievalResultAdapter(result)
            canonical_id = adapter.get_canonical_id()
            if canonical_id is not None:
                adapted.append((canonical_id, adapter.get_score()))

        # Sort by score descending
        adapted.sort(key=lambda x: x[1], reverse=True)

        # Create ranked entries
        for rank, (canonical_id, score) in enumerate(adapted, start=1):
            entries.append(
                RunEntry(
                    query_id=query_id,
                    canonical_item_id=canonical_id,
                    rank=rank,
                    score=score,
                )
            )

    return Run(run_id=run_id, entries=entries)
