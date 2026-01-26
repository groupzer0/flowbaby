"""
Benchmark CLI for Flowbaby Retrieval Evaluation (Step 4)

Command-line interface for running benchmarks:
- Load dataset from directory
- Score run files against dataset
- Output JSON and Markdown results

Usage:
    python -m benchmark.benchmark_cli score --dataset ./data --run ./run.json --output ./results.json
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from benchmark.benchmark_contract import (
    BenchmarkDataset,
    Run,
    RunSummary,
    Topic,
    Qrel,
    load_run,
    load_topics,
    load_qrels,
    save_run_summary,
    validate_split_discipline,
    SplitDisciplineError,
)
from benchmark.benchmark_scorer import (
    BenchmarkScorer,
    ScorerConfig,
    ScoreResult,
    format_results_markdown,
)


def load_dataset_from_dir(dataset_path: Path) -> BenchmarkDataset:
    """
    Load a benchmark dataset from a directory.

    Expected directory structure:
        dataset_path/
            topics.json      - List of Topic objects
            qrels.json       - List of Qrel objects
            metadata.json    - Dataset metadata (id, version, slice_definitions)

    Args:
        dataset_path: Path to the dataset directory

    Returns:
        BenchmarkDataset loaded from the directory

    Raises:
        FileNotFoundError: If required files are missing
    """
    topics_path = dataset_path / "topics.json"
    qrels_path = dataset_path / "qrels.json"
    metadata_path = dataset_path / "metadata.json"

    if not topics_path.exists():
        raise FileNotFoundError(f"Topics file not found: {topics_path}")
    if not qrels_path.exists():
        raise FileNotFoundError(f"Qrels file not found: {qrels_path}")

    topics = load_topics(topics_path)
    qrels = load_qrels(qrels_path)

    # Load metadata (optional fields with defaults)
    if metadata_path.exists():
        with open(metadata_path) as f:
            metadata = json.load(f)
    else:
        metadata = {}

    return BenchmarkDataset(
        dataset_id=metadata.get("dataset_id", dataset_path.name),
        version=metadata.get("version", "1.0"),
        topics=topics,
        qrels=qrels,
        slice_definitions=metadata.get("slice_definitions", {}),
    )


def score_run_file(
    run_path: Path,
    dataset: BenchmarkDataset,
    config: Optional[ScorerConfig] = None,
) -> ScoreResult:
    """
    Score a run file against a dataset.

    Args:
        run_path: Path to the run JSON file
        dataset: The benchmark dataset to score against
        config: Optional scorer configuration

    Returns:
        ScoreResult with metrics
    """
    run = load_run(run_path)
    scorer = BenchmarkScorer(dataset, config or ScorerConfig())
    return scorer.score_run(run)


class BenchmarkCLI:
    """
    Command-line interface for running benchmarks.

    Usage:
        cli = BenchmarkCLI(dataset_path=Path("./data"))
        cli.score(run_path, output_path)
    """

    def __init__(
        self,
        dataset_path: Path,
        config: Optional[ScorerConfig] = None,
    ):
        """
        Initialize CLI with a dataset.

        Args:
            dataset_path: Path to the dataset directory
            config: Optional scorer configuration
        """
        self.dataset = load_dataset_from_dir(dataset_path)
        self.config = config or ScorerConfig()
        self.scorer = BenchmarkScorer(self.dataset, self.config)

    def score(
        self,
        run_path: Path,
        output_path: Path,
        markdown_path: Optional[Path] = None,
        summary_path: Optional[Path] = None,
        git_sha: Optional[str] = None,
        selection_split: Optional[str] = None,
        evaluation_split: Optional[str] = None,
    ) -> ScoreResult:
        """
        Score a run file and save results.

        Args:
            run_path: Path to the run JSON file
            output_path: Path to save JSON results
            markdown_path: Optional path to save Markdown summary
            summary_path: Optional path to save RunSummary
            git_sha: Optional git commit SHA for provenance
            selection_split: Split used for tuning/selection (Plan 113 M4)
            evaluation_split: Split to evaluate on (Plan 113 M4)

        Returns:
            ScoreResult with metrics
        """
        # Plan 113 M4: Validate split discipline if selection_split provided
        if selection_split is not None:
            validate_split_discipline(selection_split, evaluation_split or "test")
        
        # Load run
        run = load_run(run_path)
        
        # Filter to evaluation split if specified
        if evaluation_split is not None:
            filtered_dataset = self._filter_dataset_to_split(evaluation_split)
            scorer = BenchmarkScorer(filtered_dataset, self.config)
        else:
            scorer = self.scorer
            filtered_dataset = self.dataset
        
        result = scorer.score_run(run)

        # Save JSON results
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            f.write(result.to_json())

        # Save Markdown summary
        if markdown_path:
            markdown_path.parent.mkdir(parents=True, exist_ok=True)
            markdown_path.write_text(format_results_markdown(result))

        # Save RunSummary with split provenance
        if summary_path:
            summary = scorer.generate_run_summary(
                run, result, git_sha=git_sha,
                selection_split=selection_split,
                evaluation_split=evaluation_split,
            )
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            save_run_summary(summary, summary_path)

        return result

    def _filter_dataset_to_split(self, split: str) -> BenchmarkDataset:
        """
        Create a filtered dataset containing only topics from the specified split.
        
        Args:
            split: The split to filter to (train/validation/test)
            
        Returns:
            New BenchmarkDataset with only topics from the specified split
        """
        filtered_topics = self.dataset.topics_by_split(split)
        filtered_query_ids = {t.query_id for t in filtered_topics}
        filtered_qrels = [q for q in self.dataset.qrels if q.query_id in filtered_query_ids]
        
        return BenchmarkDataset(
            dataset_id=self.dataset.dataset_id,
            version=self.dataset.version,
            topics=filtered_topics,
            qrels=filtered_qrels,
            slice_definitions=self.dataset.slice_definitions,
        )


def main(argv: Optional[List[str]] = None) -> int:
    """
    Main CLI entrypoint.

    Args:
        argv: Command-line arguments (defaults to sys.argv[1:])

    Returns:
        Exit code (0 for success)
    """
    parser = argparse.ArgumentParser(
        prog="benchmark",
        description="Flowbaby Retrieval Benchmark CLI",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Score subcommand
    score_parser = subparsers.add_parser(
        "score",
        help="Score a run against a dataset",
    )
    score_parser.add_argument(
        "--dataset",
        type=Path,
        required=True,
        help="Path to the benchmark dataset directory",
    )
    score_parser.add_argument(
        "--run",
        type=Path,
        required=True,
        help="Path to the run JSON file to score",
    )
    score_parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Path to save JSON results",
    )
    score_parser.add_argument(
        "--markdown",
        type=Path,
        help="Optional path to save Markdown summary",
    )
    score_parser.add_argument(
        "--summary",
        type=Path,
        help="Optional path to save RunSummary",
    )
    score_parser.add_argument(
        "--git-sha",
        type=str,
        help="Git commit SHA for provenance",
    )
    score_parser.add_argument(
        "-k",
        type=int,
        nargs="+",
        default=[5, 10, 20],
        help="K values for @K metrics (default: 5 10 20)",
    )
    # Plan 113 M4: Split discipline parameters
    score_parser.add_argument(
        "--selection-split",
        type=str,
        choices=["train", "validation"],
        help="Split used for tuning/selection (cannot be 'test')",
    )
    score_parser.add_argument(
        "--evaluation-split",
        type=str,
        choices=["train", "validation", "test"],
        help="Split to evaluate on (filters dataset to this split)",
    )

    args = parser.parse_args(argv)

    if args.command == "score":
        try:
            config = ScorerConfig(k_values=args.k)
            cli = BenchmarkCLI(dataset_path=args.dataset, config=config)
            cli.score(
                run_path=args.run,
                output_path=args.output,
                markdown_path=args.markdown,
                summary_path=args.summary,
                git_sha=args.git_sha,
                selection_split=args.selection_split,
                evaluation_split=args.evaluation_split,
            )
            print(f"Results saved to {args.output}")
            return 0
        except FileNotFoundError as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1
        except SplitDisciplineError as e:
            print(f"Split discipline error: {e}", file=sys.stderr)
            return 1
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
