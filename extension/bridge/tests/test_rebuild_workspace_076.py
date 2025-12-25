#!/usr/bin/env python3
"""
Tests for Plan 076: Rebuild Tool Batch Processing & Resilience

TDD tests for:
- File enumeration from .flowbaby/data/**/*.txt
- Exclusion of .cognee_fs_cache/**
- File size policy (skip oversized with log)
- Encoding error handling by mode
- Batching and progress logging
- Checkpointing (JSON format, fingerprint validation)
- Resume semantics (fail-closed on changed inputs)

@see agent-output/planning/076-rebuild-tool-batch-processing-and-resilience.md
"""

import asyncio
import hashlib
import json
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import List, Tuple
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# =============================================================================
# Milestone 1: File Enumeration + Safety Semantics
# =============================================================================

class TestFileEnumeration:
    """Tests for enumerate_rebuild_inputs() function."""

    def test_enumerate_txt_files_only(self, tmp_path):
        """Test that only .txt files are enumerated."""
        from rebuild_workspace import enumerate_rebuild_inputs
        
        data_dir = tmp_path / ".flowbaby" / "data"
        data_dir.mkdir(parents=True)
        
        # Create various file types
        (data_dir / "valid1.txt").write_text("content1")
        (data_dir / "valid2.txt").write_text("content2")
        (data_dir / "invalid.json").write_text("{}")
        (data_dir / "invalid.md").write_text("# Header")
        
        result = enumerate_rebuild_inputs(tmp_path)
        
        assert len(result.files) == 2
        assert all(f.path.suffix == ".txt" for f in result.files)

    def test_enumerate_excludes_cognee_fs_cache(self, tmp_path):
        """Test that .cognee_fs_cache/** is excluded."""
        from rebuild_workspace import enumerate_rebuild_inputs
        
        data_dir = tmp_path / ".flowbaby" / "data"
        data_dir.mkdir(parents=True)
        
        # Create a valid file
        (data_dir / "valid.txt").write_text("content")
        
        # Create files in .cognee_fs_cache (should be excluded)
        cache_dir = data_dir / ".cognee_fs_cache"
        cache_dir.mkdir()
        (cache_dir / "cached.txt").write_text("cached content")
        (cache_dir / "subdir").mkdir()
        (cache_dir / "subdir" / "nested.txt").write_text("nested cached")
        
        result = enumerate_rebuild_inputs(tmp_path)
        
        assert len(result.files) == 1
        assert result.files[0].path.name == "valid.txt"

    def test_enumerate_deterministic_order(self, tmp_path):
        """Test that files are enumerated in lexicographic order by relative path."""
        from rebuild_workspace import enumerate_rebuild_inputs
        
        data_dir = tmp_path / ".flowbaby" / "data"
        data_dir.mkdir(parents=True)
        
        # Create files in non-alphabetical order
        (data_dir / "zebra.txt").write_text("z")
        (data_dir / "alpha.txt").write_text("a")
        (data_dir / "subdir").mkdir()
        (data_dir / "subdir" / "beta.txt").write_text("b")
        
        result = enumerate_rebuild_inputs(tmp_path)
        
        # Should be: alpha.txt, subdir/beta.txt, zebra.txt
        paths = [str(f.relative_path) for f in result.files]
        assert paths == sorted(paths)

    def test_enumerate_returns_relative_paths(self, tmp_path):
        """Test that enumerated files use relative paths (no workspace leakage)."""
        from rebuild_workspace import enumerate_rebuild_inputs
        
        data_dir = tmp_path / ".flowbaby" / "data"
        data_dir.mkdir(parents=True)
        (data_dir / "test.txt").write_text("content")
        
        result = enumerate_rebuild_inputs(tmp_path)
        
        assert len(result.files) == 1
        # relative_path should not contain workspace path
        rel_path = str(result.files[0].relative_path)
        assert str(tmp_path) not in rel_path
        assert rel_path == "test.txt"


class TestFileSizePolicy:
    """Tests for file size handling policy."""

    def test_skip_oversized_files_by_default(self, tmp_path):
        """Test that files exceeding 10MB are skipped by default."""
        from rebuild_workspace import enumerate_rebuild_inputs, DEFAULT_MAX_FILE_SIZE_BYTES
        
        data_dir = tmp_path / ".flowbaby" / "data"
        data_dir.mkdir(parents=True)
        
        # Create a small file
        (data_dir / "small.txt").write_text("small content")
        
        # Create an oversized file (just over threshold)
        oversized = data_dir / "large.txt"
        oversized.write_bytes(b"x" * (DEFAULT_MAX_FILE_SIZE_BYTES + 1))
        
        result = enumerate_rebuild_inputs(tmp_path)
        
        assert len(result.files) == 1
        assert result.files[0].path.name == "small.txt"
        assert len(result.skipped) == 1
        assert "large.txt" in result.skipped[0].path.name
        assert "oversized" in result.skipped[0].reason.lower()

    def test_configurable_size_threshold(self, tmp_path):
        """Test that size threshold is configurable."""
        from rebuild_workspace import enumerate_rebuild_inputs
        
        data_dir = tmp_path / ".flowbaby" / "data"
        data_dir.mkdir(parents=True)
        
        # Create a 1KB file
        (data_dir / "medium.txt").write_bytes(b"x" * 1024)
        
        # With 500 byte limit, file should be skipped
        result = enumerate_rebuild_inputs(tmp_path, max_file_size_bytes=500)
        assert len(result.files) == 0
        assert len(result.skipped) == 1
        
        # With 2KB limit, file should be included
        result = enumerate_rebuild_inputs(tmp_path, max_file_size_bytes=2048)
        assert len(result.files) == 1
        assert len(result.skipped) == 0

    def test_include_oversized_with_override(self, tmp_path):
        """Test operator can include oversized files with explicit override."""
        from rebuild_workspace import enumerate_rebuild_inputs, DEFAULT_MAX_FILE_SIZE_BYTES
        
        data_dir = tmp_path / ".flowbaby" / "data"
        data_dir.mkdir(parents=True)
        
        # Create oversized file
        oversized = data_dir / "large.txt"
        oversized.write_bytes(b"x" * (DEFAULT_MAX_FILE_SIZE_BYTES + 1))
        
        # With allow_oversized=True, should be included
        result = enumerate_rebuild_inputs(tmp_path, allow_oversized=True)
        
        assert len(result.files) == 1
        assert result.files[0].path.name == "large.txt"


class TestEncodingErrorHandling:
    """Tests for encoding error handling by mode."""

    def test_reindex_mode_skips_encoding_errors(self, tmp_path):
        """Test that reindex-only mode skips files with encoding errors."""
        from rebuild_workspace import enumerate_rebuild_inputs
        
        data_dir = tmp_path / ".flowbaby" / "data"
        data_dir.mkdir(parents=True)
        
        # Create a valid UTF-8 file
        (data_dir / "valid.txt").write_text("valid utf-8 content")
        
        # Create a file with invalid UTF-8
        invalid = data_dir / "invalid.txt"
        invalid.write_bytes(b"\xff\xfe invalid utf-8 \x80\x81")
        
        result = enumerate_rebuild_inputs(tmp_path, validate_encoding=True)
        
        assert len(result.files) == 1
        assert result.files[0].path.name == "valid.txt"
        assert len(result.skipped) == 1
        assert "encoding" in result.skipped[0].reason.lower()

    def test_destructive_mode_fails_on_encoding_errors(self, tmp_path):
        """Test that destructive mode fails closed on encoding errors."""
        from rebuild_workspace import enumerate_rebuild_inputs, EnumerationError
        
        data_dir = tmp_path / ".flowbaby" / "data"
        data_dir.mkdir(parents=True)
        
        # Create a file with invalid UTF-8
        invalid = data_dir / "invalid.txt"
        invalid.write_bytes(b"\xff\xfe invalid utf-8 \x80\x81")
        
        # Destructive mode should raise an error
        with pytest.raises(EnumerationError) as exc_info:
            enumerate_rebuild_inputs(
                tmp_path, 
                validate_encoding=True, 
                fail_on_encoding_error=True
            )
        
        assert "encoding" in str(exc_info.value).lower()


class TestFailClosedSemantics:
    """Tests for fail-closed behavior on destructive operations."""

    def test_fail_closed_on_empty_inputs(self, tmp_path):
        """Test that destructive reset fails if no eligible files found."""
        from rebuild_workspace import validate_destructive_preconditions, DestructiveResetError
        
        # Create empty data directory
        data_dir = tmp_path / ".flowbaby" / "data"
        data_dir.mkdir(parents=True)
        
        with pytest.raises(DestructiveResetError) as exc_info:
            validate_destructive_preconditions(tmp_path, allow_empty=False)
        
        assert "no eligible" in str(exc_info.value).lower()

    def test_allow_empty_with_override(self, tmp_path):
        """Test that empty rebuild can proceed with explicit override."""
        from rebuild_workspace import validate_destructive_preconditions
        
        # Create empty data directory
        data_dir = tmp_path / ".flowbaby" / "data"
        data_dir.mkdir(parents=True)
        
        # Should not raise with allow_empty=True
        result = validate_destructive_preconditions(tmp_path, allow_empty=True)
        assert result.file_count == 0

    def test_fail_closed_on_permission_error(self, tmp_path):
        """Test that permission errors trigger fail-closed behavior."""
        from rebuild_workspace import enumerate_rebuild_inputs, EnumerationError
        
        data_dir = tmp_path / ".flowbaby" / "data"
        data_dir.mkdir(parents=True)
        (data_dir / "test.txt").write_text("content")
        
        # Make directory unreadable
        original_mode = data_dir.stat().st_mode
        os.chmod(data_dir, 0o000)
        
        try:
            # Check if we can actually test this (root user bypasses permissions)
            try:
                list(data_dir.iterdir())
                # If we get here, permissions aren't enforced (e.g., running as root)
                pytest.skip("Cannot test permission errors (possibly running as root)")
            except PermissionError:
                pass  # Good, permissions are enforced
            
            with pytest.raises(EnumerationError) as exc_info:
                enumerate_rebuild_inputs(tmp_path)
            assert "permission" in str(exc_info.value).lower()
        finally:
            # Restore permissions for cleanup
            os.chmod(data_dir, original_mode)


class TestPreflightSummary:
    """Tests for preflight/dry-run summary."""

    def test_preflight_returns_summary(self, tmp_path):
        """Test that preflight summary includes file count, total bytes, sample paths."""
        from rebuild_workspace import get_preflight_summary
        
        data_dir = tmp_path / ".flowbaby" / "data"
        data_dir.mkdir(parents=True)
        
        (data_dir / "file1.txt").write_text("content1")
        (data_dir / "file2.txt").write_text("longer content two")
        
        summary = get_preflight_summary(tmp_path)
        
        assert summary.file_count == 2
        assert summary.total_bytes > 0
        assert len(summary.sample_paths) > 0
        assert summary.skipped_count == 0

    def test_preflight_shows_skip_reasons(self, tmp_path):
        """Test that preflight summary shows skip policies."""
        from rebuild_workspace import get_preflight_summary, DEFAULT_MAX_FILE_SIZE_BYTES
        
        data_dir = tmp_path / ".flowbaby" / "data"
        data_dir.mkdir(parents=True)
        
        # Create oversized file to be skipped
        (data_dir / "large.txt").write_bytes(b"x" * (DEFAULT_MAX_FILE_SIZE_BYTES + 1))
        (data_dir / "small.txt").write_text("small")
        
        summary = get_preflight_summary(tmp_path)
        
        assert summary.file_count == 1
        assert summary.skipped_count == 1
        assert "oversized" in summary.skip_reasons[0].lower()


# =============================================================================
# Milestone 2: Batch Ingestion
# =============================================================================

class TestBatchIngestion:
    """Tests for batch ingestion from filesystem."""

    def test_batch_size_respected(self, tmp_path):
        """Test that files are processed in batches of specified size."""
        from rebuild_workspace import create_batches, RebuildInputFile
        
        # Create 10 mock input files
        files = [
            RebuildInputFile(
                path=tmp_path / f"file{i}.txt",
                relative_path=Path(f"file{i}.txt"),
                size_bytes=100
            )
            for i in range(10)
        ]
        
        batches = list(create_batches(files, batch_size=3))
        
        assert len(batches) == 4  # 3, 3, 3, 1
        assert len(batches[0]) == 3
        assert len(batches[1]) == 3
        assert len(batches[2]) == 3
        assert len(batches[3]) == 1

    def test_batch_logging(self, tmp_path, capsys):
        """Test that batch start/end is logged with counts and timing."""
        # This test will verify logging behavior in integration
        pass  # Implementation will fill this in


# =============================================================================
# Milestone 3: Completeness and Rate Limiting  
# =============================================================================

class TestRateLimiting:
    """Tests for rate limiting and backoff."""

    def test_configurable_delay_between_batches(self):
        """Test that delay between batches is configurable."""
        from rebuild_workspace import RebuildConfig
        
        config = RebuildConfig(batch_delay_seconds=2.0)
        assert config.batch_delay_seconds == 2.0

    def test_final_summary_includes_totals(self, tmp_path):
        """Test that final summary includes discovered/processed/skipped totals."""
        from rebuild_workspace import RebuildResult
        
        result = RebuildResult(
            files_discovered=100,
            files_processed=95,
            files_skipped=5,
            skip_reasons={"oversized": 3, "encoding": 2},
            total_runtime_seconds=120.5,
            retry_events=0
        )
        
        assert result.files_discovered == 100
        assert result.files_processed == 95
        assert result.files_skipped == 5


# =============================================================================
# Milestone 4: Checkpointing and Resumability
# =============================================================================

class TestCheckpointing:
    """Tests for checkpoint file format and semantics."""

    def test_checkpoint_is_json_format(self, tmp_path):
        """Test that checkpoint file is JSON format."""
        from rebuild_workspace import save_checkpoint, CHECKPOINT_FILE
        
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        (workspace / ".flowbaby" / "maintenance").mkdir(parents=True)
        
        save_checkpoint(
            workspace,
            mode="reset-and-rebuild",
            file_list=[("file1.txt", 100, 12345.0)],
            batch_size=10,
            last_completed_batch=2,
            fingerprint="abc123"
        )
        
        checkpoint_path = workspace / ".flowbaby" / "maintenance" / CHECKPOINT_FILE
        assert checkpoint_path.exists()
        
        # Should be valid JSON
        data = json.loads(checkpoint_path.read_text())
        assert data["mode"] == "reset-and-rebuild"
        assert data["last_completed_batch"] == 2
        assert data["fingerprint"] == "abc123"

    def test_checkpoint_includes_fingerprint(self, tmp_path):
        """Test that checkpoint includes input-set fingerprint."""
        from rebuild_workspace import compute_input_fingerprint, RebuildInputFile
        
        files = [
            RebuildInputFile(
                path=tmp_path / "file1.txt",
                relative_path=Path("file1.txt"),
                size_bytes=100,
                mtime=12345.0
            ),
            RebuildInputFile(
                path=tmp_path / "file2.txt", 
                relative_path=Path("file2.txt"),
                size_bytes=200,
                mtime=12346.0
            ),
        ]
        
        fingerprint = compute_input_fingerprint(files)
        
        # Fingerprint should be a hash string
        assert isinstance(fingerprint, str)
        assert len(fingerprint) == 64  # SHA-256 hex

    def test_fingerprint_changes_with_file_changes(self, tmp_path):
        """Test that fingerprint changes when files change."""
        from rebuild_workspace import compute_input_fingerprint, RebuildInputFile
        
        files_v1 = [
            RebuildInputFile(
                path=tmp_path / "file1.txt",
                relative_path=Path("file1.txt"),
                size_bytes=100,
                mtime=12345.0
            ),
        ]
        
        files_v2 = [
            RebuildInputFile(
                path=tmp_path / "file1.txt",
                relative_path=Path("file1.txt"),
                size_bytes=100,
                mtime=12346.0  # Different mtime
            ),
        ]
        
        fp1 = compute_input_fingerprint(files_v1)
        fp2 = compute_input_fingerprint(files_v2)
        
        assert fp1 != fp2

    def test_resume_validates_fingerprint(self, tmp_path):
        """Test that --resume validates fingerprint and fails if changed."""
        from rebuild_workspace import validate_resume, CheckpointMismatchError
        
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        
        # Create checkpoint with one fingerprint
        checkpoint = {
            "fingerprint": "original_fingerprint",
            "mode": "reset-and-rebuild",
            "last_completed_batch": 5,
        }
        
        # Validate with different fingerprint should fail
        with pytest.raises(CheckpointMismatchError):
            validate_resume(checkpoint, current_fingerprint="different_fingerprint")

    def test_resume_succeeds_with_matching_fingerprint(self, tmp_path):
        """Test that --resume succeeds when fingerprint matches."""
        from rebuild_workspace import validate_resume
        
        checkpoint = {
            "fingerprint": "same_fingerprint",
            "mode": "reset-and-rebuild", 
            "last_completed_batch": 5,
        }
        
        # Should not raise
        result = validate_resume(checkpoint, current_fingerprint="same_fingerprint")
        assert result.last_completed_batch == 5


# =============================================================================
# Milestone 5.1: Exclusive Writer Coordination
# =============================================================================

class TestExclusiveWriterCoordination:
    """Tests for exclusive writer coordination."""

    def test_refuses_when_daemon_active(self, tmp_path):
        """Test that rebuild refuses when daemon is detected active."""
        from rebuild_workspace import check_concurrent_writers, ConcurrentWriterError
        
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        
        # Simulate active daemon by creating PID file
        pid_dir = workspace / ".flowbaby" / "daemon"
        pid_dir.mkdir(parents=True)
        (pid_dir / "daemon.pid").write_text(str(os.getpid()))
        
        with pytest.raises(ConcurrentWriterError) as exc_info:
            check_concurrent_writers(workspace)
        
        assert "daemon" in str(exc_info.value).lower()

    def test_succeeds_when_no_concurrent_writers(self, tmp_path):
        """Test that rebuild proceeds when no concurrent writers detected."""
        from rebuild_workspace import check_concurrent_writers
        
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        (workspace / ".flowbaby").mkdir()
        
        # Should not raise
        check_concurrent_writers(workspace)


# =============================================================================
# Integration: CLI Arguments
# =============================================================================

class TestCLIArguments:
    """Tests for new CLI arguments."""

    def test_batch_size_argument(self):
        """Test --batch-size CLI argument."""
        from rebuild_workspace import main
        
        # Will be tested via subprocess or argparse validation
        pass

    def test_resume_argument(self):
        """Test --resume CLI argument."""
        pass

    def test_restart_argument(self):
        """Test --restart CLI argument."""
        pass

    def test_dry_run_argument(self):
        """Test --dry-run CLI argument for preflight summary."""
        pass

    def test_max_files_argument(self):
        """Test --max-files CLI argument for limiting processing."""
        pass

    def test_batch_delay_argument(self):
        """Test --batch-delay CLI argument for rate limiting."""
        pass
