"""
TDD tests for benchmark_cli.py (Step 4: CLI Interface)

Tests for CLI to run benchmarks: load dataset, score runs, save results.
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# TDD Red Phase: Import the module we're about to create
from benchmark.benchmark_cli import (
    BenchmarkCLI,
    load_dataset_from_dir,
    score_run_file,
    main,
)
from benchmark.benchmark_contract import (
    Topic,
    Qrel,
    Run,
    RunEntry,
    BenchmarkDataset,
    save_run,
    save_topics,
    save_qrels,
)


class TestLoadDatasetFromDir(unittest.TestCase):
    """Tests for loading dataset from directory structure."""

    def test_load_dataset_reads_topics_and_qrels(self):
        """load_dataset_from_dir should read topics.json and qrels.json."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)

            # Create minimal dataset files
            topics = [
                Topic(query_id="q1", query_text="Test query", slice_ids=["general"])
            ]
            qrels = [Qrel(query_id="q1", canonical_item_id="doc1", relevance=1)]

            save_topics(topics, tmppath / "topics.json")
            save_qrels(qrels, tmppath / "qrels.json")

            # Create metadata file
            metadata = {
                "dataset_id": "test-dataset",
                "version": "1.0",
                "slice_definitions": {"general": "General queries"},
            }
            with open(tmppath / "metadata.json", "w") as f:
                json.dump(metadata, f)

            # Load and verify
            dataset = load_dataset_from_dir(tmppath)
            self.assertEqual(dataset.dataset_id, "test-dataset")
            self.assertEqual(len(dataset.topics), 1)
            self.assertEqual(len(dataset.qrels), 1)

    def test_load_dataset_raises_on_missing_topics(self):
        """load_dataset_from_dir should raise if topics.json missing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)
            # Create qrels but not topics
            qrels = [Qrel(query_id="q1", canonical_item_id="doc1", relevance=1)]
            save_qrels(qrels, tmppath / "qrels.json")

            with self.assertRaises(FileNotFoundError):
                load_dataset_from_dir(tmppath)

    def test_load_dataset_raises_on_missing_qrels(self):
        """load_dataset_from_dir should raise if qrels.json missing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)
            # Create topics but not qrels
            topics = [
                Topic(query_id="q1", query_text="Test", slice_ids=["general"])
            ]
            save_topics(topics, tmppath / "topics.json")

            with self.assertRaises(FileNotFoundError):
                load_dataset_from_dir(tmppath)


class TestScoreRunFile(unittest.TestCase):
    """Tests for scoring a run from file."""

    def test_score_run_file_loads_and_scores(self):
        """score_run_file should load run and return scored results."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)

            # Create dataset
            topics = [
                Topic(query_id="q1", query_text="Test", slice_ids=["general"])
            ]
            qrels = [Qrel(query_id="q1", canonical_item_id="doc1", relevance=1)]
            dataset = BenchmarkDataset(
                dataset_id="test",
                version="1.0",
                topics=topics,
                qrels=qrels,
                slice_definitions={"general": "General"},
            )

            # Create run file
            run = Run(
                run_id="test-run",
                entries=[
                    RunEntry(
                        query_id="q1",
                        canonical_item_id="doc1",
                        rank=1,
                        score=0.9,
                    )
                ],
            )
            run_path = tmppath / "run.json"
            save_run(run, run_path)

            # Score
            result = score_run_file(run_path, dataset)
            self.assertIn("recall@5", result.aggregate_metrics)


class TestBenchmarkCLI(unittest.TestCase):
    """Tests for the BenchmarkCLI class."""

    def test_cli_initializes_with_dataset_path(self):
        """CLI should initialize with a dataset path."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)
            self._create_minimal_dataset(tmppath)

            cli = BenchmarkCLI(dataset_path=tmppath)
            self.assertEqual(cli.dataset.dataset_id, "test-dataset")

    def test_cli_score_command_outputs_results(self):
        """CLI score command should output results to specified path."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)
            self._create_minimal_dataset(tmppath)

            # Create a run file
            run = Run(
                run_id="test-run",
                entries=[
                    RunEntry(
                        query_id="q1",
                        canonical_item_id="doc1",
                        rank=1,
                        score=0.9,
                    )
                ],
            )
            run_path = tmppath / "run.json"
            save_run(run, run_path)

            # Run CLI
            cli = BenchmarkCLI(dataset_path=tmppath)
            output_path = tmppath / "results.json"
            cli.score(run_path, output_path)

            # Verify output file created
            self.assertTrue(output_path.exists())
            with open(output_path) as f:
                results = json.load(f)
            self.assertIn("aggregate_metrics", results)

    def test_cli_score_outputs_markdown(self):
        """CLI should generate markdown summary."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)
            self._create_minimal_dataset(tmppath)

            run = Run(
                run_id="test-run",
                entries=[
                    RunEntry(
                        query_id="q1",
                        canonical_item_id="doc1",
                        rank=1,
                        score=0.9,
                    )
                ],
            )
            run_path = tmppath / "run.json"
            save_run(run, run_path)

            cli = BenchmarkCLI(dataset_path=tmppath)
            md_path = tmppath / "results.md"
            cli.score(run_path, output_path=tmppath / "results.json", markdown_path=md_path)

            self.assertTrue(md_path.exists())
            content = md_path.read_text()
            self.assertIn("# Benchmark Results", content)

    def test_cli_score_saves_run_summary(self):
        """CLI should save run summary with provenance."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)
            self._create_minimal_dataset(tmppath)

            run = Run(
                run_id="test-run",
                entries=[
                    RunEntry(
                        query_id="q1",
                        canonical_item_id="doc1",
                        rank=1,
                        score=0.9,
                    )
                ],
            )
            run_path = tmppath / "run.json"
            save_run(run, run_path)

            cli = BenchmarkCLI(dataset_path=tmppath)
            summary_path = tmppath / "summary.json"
            cli.score(run_path, output_path=tmppath / "results.json", summary_path=summary_path)

            self.assertTrue(summary_path.exists())
            with open(summary_path) as f:
                summary = json.load(f)
            self.assertEqual(summary["run_id"], "test-run")
            self.assertEqual(summary["dataset_id"], "test-dataset")

    def _create_minimal_dataset(self, path: Path):
        """Helper to create a minimal dataset directory."""
        topics = [Topic(query_id="q1", query_text="Test", slice_ids=["general"])]
        qrels = [Qrel(query_id="q1", canonical_item_id="doc1", relevance=1)]

        save_topics(topics, path / "topics.json")
        save_qrels(qrels, path / "qrels.json")

        metadata = {
            "dataset_id": "test-dataset",
            "version": "1.0",
            "slice_definitions": {"general": "General queries"},
        }
        with open(path / "metadata.json", "w") as f:
            json.dump(metadata, f)


class TestMainEntrypoint(unittest.TestCase):
    """Tests for the main() CLI entrypoint."""

    def test_main_with_score_subcommand(self):
        """main() should handle score subcommand."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)

            # Create dataset
            topics = [Topic(query_id="q1", query_text="Test", slice_ids=["general"])]
            qrels = [Qrel(query_id="q1", canonical_item_id="doc1", relevance=1)]
            save_topics(topics, tmppath / "topics.json")
            save_qrels(qrels, tmppath / "qrels.json")
            metadata = {
                "dataset_id": "test",
                "version": "1.0",
                "slice_definitions": {"general": "General"},
            }
            with open(tmppath / "metadata.json", "w") as f:
                json.dump(metadata, f)

            # Create run
            run = Run(
                run_id="test",
                entries=[
                    RunEntry(query_id="q1", canonical_item_id="doc1", rank=1, score=0.9)
                ],
            )
            run_path = tmppath / "run.json"
            save_run(run, run_path)

            output_path = tmppath / "output.json"

            # Call main with args
            exit_code = main([
                "score",
                "--dataset", str(tmppath),
                "--run", str(run_path),
                "--output", str(output_path),
            ])

            self.assertEqual(exit_code, 0)
            self.assertTrue(output_path.exists())


# ============================================================================
# Plan 113 Code Review Fix: CLI Split Discipline Enforcement
# ============================================================================

class TestCLISplitDiscipline(unittest.TestCase):
    """
    Code review finding [HIGH]: CLI must enforce split discipline.
    
    Tests that:
    - CLI accepts --selection-split and --evaluation-split params
    - CLI calls validate_split_discipline() before scoring
    - CLI records split provenance in run summary
    """

    def _create_dataset_with_splits(self, path: Path):
        """Helper to create dataset with split assignments."""
        topics = [
            Topic(query_id="q1", query_text="Train query", slice_ids=["general"], split="train"),
            Topic(query_id="q2", query_text="Val query", slice_ids=["general"], split="validation"),
            Topic(query_id="q3", query_text="Test query", slice_ids=["general"], split="test"),
        ]
        qrels = [
            Qrel(query_id="q1", canonical_item_id="doc1", relevance=1),
            Qrel(query_id="q2", canonical_item_id="doc2", relevance=1),
            Qrel(query_id="q3", canonical_item_id="doc3", relevance=1),
        ]
        save_topics(topics, path / "topics.json")
        save_qrels(qrels, path / "qrels.json")
        metadata = {
            "dataset_id": "test-splits",
            "version": "1.0",
            "slice_definitions": {"general": "General"},
        }
        with open(path / "metadata.json", "w") as f:
            json.dump(metadata, f)

    def test_cli_accepts_evaluation_split_param(self):
        """CLI score command should accept --evaluation-split parameter."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)
            self._create_dataset_with_splits(tmppath)

            run = Run(
                run_id="test",
                entries=[RunEntry(query_id="q3", canonical_item_id="doc3", rank=1, score=0.9)],
            )
            save_run(run, tmppath / "run.json")

            # Should not raise with valid split
            exit_code = main([
                "score",
                "--dataset", str(tmppath),
                "--run", str(tmppath / "run.json"),
                "--output", str(tmppath / "output.json"),
                "--evaluation-split", "test",
            ])
            self.assertEqual(exit_code, 0)

    def test_cli_accepts_selection_split_param(self):
        """CLI score command should accept --selection-split parameter."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)
            self._create_dataset_with_splits(tmppath)

            run = Run(
                run_id="test",
                entries=[RunEntry(query_id="q3", canonical_item_id="doc3", rank=1, score=0.9)],
            )
            save_run(run, tmppath / "run.json")

            # Should not raise with valid workflow
            exit_code = main([
                "score",
                "--dataset", str(tmppath),
                "--run", str(tmppath / "run.json"),
                "--output", str(tmppath / "output.json"),
                "--selection-split", "validation",
                "--evaluation-split", "test",
            ])
            self.assertEqual(exit_code, 0)

    def test_cli_rejects_test_split_for_selection(self):
        """CLI must reject using test split for selection (leakage prevention)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)
            self._create_dataset_with_splits(tmppath)

            run = Run(
                run_id="test",
                entries=[RunEntry(query_id="q3", canonical_item_id="doc3", rank=1, score=0.9)],
            )
            save_run(run, tmppath / "run.json")

            # argparse should reject 'test' as a choice for --selection-split
            # This will raise SystemExit(2) from argparse
            with self.assertRaises(SystemExit) as ctx:
                main([
                    "score",
                    "--dataset", str(tmppath),
                    "--run", str(tmppath / "run.json"),
                    "--output", str(tmppath / "output.json"),
                    "--selection-split", "test",  # Invalid - not in choices
                    "--evaluation-split", "test",
                ])
            # argparse exits with code 2 for invalid arguments
            self.assertEqual(ctx.exception.code, 2)

    def test_cli_records_split_provenance_in_summary(self):
        """CLI should record split provenance in run summary."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)
            self._create_dataset_with_splits(tmppath)

            run = Run(
                run_id="test",
                entries=[RunEntry(query_id="q3", canonical_item_id="doc3", rank=1, score=0.9)],
            )
            save_run(run, tmppath / "run.json")
            summary_path = tmppath / "summary.json"

            exit_code = main([
                "score",
                "--dataset", str(tmppath),
                "--run", str(tmppath / "run.json"),
                "--output", str(tmppath / "output.json"),
                "--summary", str(summary_path),
                "--selection-split", "validation",
                "--evaluation-split", "test",
            ])
            self.assertEqual(exit_code, 0)

            # Verify provenance was recorded
            with open(summary_path) as f:
                summary = json.load(f)
            self.assertEqual(summary.get("selection_split"), "validation")
            self.assertEqual(summary.get("evaluation_split"), "test")

    def test_cli_filters_to_evaluation_split(self):
        """CLI should only score queries from the evaluation split."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)
            self._create_dataset_with_splits(tmppath)

            # Run covers all queries
            run = Run(
                run_id="test",
                entries=[
                    RunEntry(query_id="q1", canonical_item_id="doc1", rank=1, score=0.9),
                    RunEntry(query_id="q2", canonical_item_id="doc2", rank=1, score=0.9),
                    RunEntry(query_id="q3", canonical_item_id="doc3", rank=1, score=0.9),
                ],
            )
            save_run(run, tmppath / "run.json")

            exit_code = main([
                "score",
                "--dataset", str(tmppath),
                "--run", str(tmppath / "run.json"),
                "--output", str(tmppath / "output.json"),
                "--evaluation-split", "test",
            ])
            self.assertEqual(exit_code, 0)

            # Verify only test split query was scored
            with open(tmppath / "output.json") as f:
                result = json.load(f)
            self.assertEqual(result.get("query_count"), 1)  # Only q3


if __name__ == "__main__":
    unittest.main()
