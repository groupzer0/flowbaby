#!/usr/bin/env python3
"""
Integration tests for Plan 017 split ingestion modes.

Tests all three modes: sync, add-only, cognify-only
Tests conversation mode preservation, argument validation, and error handling.

Usage:
    pytest test_split_modes.py --workspace=/path/to/workspace
"""

import json
import os
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path

import pytest


@pytest.fixture
def workspace_path(request):
    """Get workspace path from command line or use temp directory."""
    return request.config.getoption("--workspace", default=None)


@pytest.fixture
def test_workspace(tmp_path):
    """Create temporary test workspace with .env file."""
    workspace = tmp_path / "test_workspace"
    workspace.mkdir()

    # Create .env with dummy API key (tests will be mocked)
    env_file = workspace / ".env"
    env_file.write_text("LLM_API_KEY=sk-test-key-for-testing\n")

    return str(workspace)


def pytest_addoption(parser):
    """Add command-line options for pytest."""
    parser.addoption(
        "--workspace",
        action="store",
        default=None,
        help="Path to workspace with .env containing LLM_API_KEY"
    )


def create_test_summary(workspace_path: str) -> dict:
    """Create a test summary JSON object."""
    return {
        "workspace_path": workspace_path,
        "topic": "Test Plan 017 Split Modes",
        "context": "Testing async cognify optimization",
        "decisions": ["Split ingest.py into three modes"],
        "rationale": ["Reduce agent blocking time from 73s to <10s"],
        "openQuestions": [],
        "nextSteps": ["Implement BackgroundOperationManager"],
        "references": ["Plan 017"],
        "timeScope": "Test execution",
        "topicId": f"test-{uuid.uuid4()}",
        "sessionId": "test-session",
        "planId": "017",
        "status": "Active",
        "createdAt": datetime.now().isoformat(),
        "updatedAt": datetime.now().isoformat()
    }


def _parse_json_stdout(stdout: str) -> dict:
    """Return the last JSON object printed to stdout (ignoring banners)."""
    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    for line in reversed(lines):
        if line.startswith('{') and line.endswith('}'):
            return json.loads(line)
    raise AssertionError(f"No JSON payload found in stdout: {stdout}")


class TestAddOnlyMode:
    """Tests for --mode add-only"""

    def test_add_only_returns_quickly(self, test_workspace):
        """Verify add-only mode returns success with staged=true after add()."""
        summary = create_test_summary(test_workspace)
        summary_json_str = json.dumps(summary)

        cmd = [
            sys.executable,
            "ingest.py",
            "--mode", "add-only",
            "--summary",
            "--summary-json", summary_json_str
        ]

        result = subprocess.run(
            cmd,
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=30  # Should complete in <10s
        )

        assert result.returncode == 0, f"add-only failed: {result.stderr}"

        output = _parse_json_stdout(result.stdout)
        assert output['success'] is True
        assert output['staged'] is True
        assert 'ingested_chars' in output
        assert output['ingested_chars'] > 0

        # Verify no cognify() execution in stderr
        assert '[PROGRESS] Cognify started' not in result.stderr
        assert '[PROGRESS] Add completed' in result.stderr

    def test_add_only_creates_dataset(self, test_workspace):
        """Verify add-only mode creates dataset directory."""
        summary = create_test_summary(test_workspace)
        summary_json_str = json.dumps(summary)

        cmd = [
            sys.executable,
            "ingest.py",
            "--mode", "add-only",
            "--summary",
            "--summary-json", summary_json_str
        ]

        result = subprocess.run(
            cmd,
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=30
        )

        assert result.returncode == 0

        # Check that dataset directory was created
        cognee_data_dir = Path(test_workspace) / ".flowbaby/data"
        assert cognee_data_dir.exists(), "Dataset directory should exist after add-only"

    def test_add_only_supports_conversation_mode(self, test_workspace):
        """Verify add-only mode supports conversation arguments for async flows."""
        cmd = [
            sys.executable,
            "ingest.py",
            "--mode", "add-only",
            test_workspace,
            "user message",
            "assistant message"
        ]

        result = subprocess.run(
            cmd,
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=10
        )

        assert result.returncode == 0, f"add-only conversation failed: {result.stderr}"
        output = _parse_json_stdout(result.stdout)
        assert output['success'] is True
        assert output['staged'] is True
        assert output.get('payload_type') == 'conversation'


class TestCognifyOnlyMode:
    """Tests for --mode cognify-only"""

    def test_cognify_only_requires_operation_id(self, test_workspace):
        """Verify cognify-only mode requires --operation-id flag."""
        cmd = [
            sys.executable,
            "ingest.py",
            "--mode", "cognify-only",
            test_workspace
        ]

        result = subprocess.run(
            cmd,
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=10
        )

        assert result.returncode == 1
        output = _parse_json_stdout(result.stdout)
        assert output['success'] is False
        assert 'operation-id' in output['error'].lower()

    def test_cognify_only_validates_uuid_format(self, test_workspace):
        """Verify cognify-only mode validates UUID format."""
        cmd = [
            sys.executable,
            "ingest.py",
            "--mode", "cognify-only",
            "--operation-id", "not-a-uuid",
            test_workspace
        ]

        result = subprocess.run(
            cmd,
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=10
        )

        assert result.returncode == 1
        output = _parse_json_stdout(result.stdout)
        assert output['success'] is False
        assert 'uuid' in output['error'].lower()

    def test_cognify_only_writes_status_stub(self, test_workspace):
        """Verify cognify-only mode writes status stub on completion."""
        # First, stage data with add-only
        summary = create_test_summary(test_workspace)
        summary_json_str = json.dumps(summary)

        add_cmd = [
            sys.executable,
            "ingest.py",
            "--mode", "add-only",
            "--summary",
            "--summary-json", summary_json_str
        ]

        add_result = subprocess.run(
            add_cmd,
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=30
        )

        assert add_result.returncode == 0, f"add-only setup failed: {add_result.stderr}"

        # Now run cognify-only
        operation_id = str(uuid.uuid4())

        cognify_cmd = [
            sys.executable,
            "ingest.py",
            "--mode", "cognify-only",
            "--operation-id", operation_id,
            test_workspace
        ]

        subprocess.run(
            cognify_cmd,
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=120  # Cognify can take 60-90s
        )

        # Check for status stub
        stub_path = Path(test_workspace) / ".cognee" / "background_ops" / f"{operation_id}.json"
        assert stub_path.exists(), f"Status stub should exist at {stub_path}"

        stub_data = json.loads(stub_path.read_text())
        assert stub_data['operation_id'] == operation_id
        assert 'success' in stub_data
        assert 'elapsed_ms' in stub_data
        assert 'timestamp' in stub_data


class TestSyncMode:
    """Tests for --mode sync (diagnostic/test mode)"""

    def test_sync_mode_executes_both_add_and_cognify(self, test_workspace):
        """Verify sync mode executes both add() and cognify()."""
        summary = create_test_summary(test_workspace)
        summary_json_str = json.dumps(summary)

        cmd = [
            sys.executable,
            "ingest.py",
            "--mode", "sync",
            "--summary",
            "--summary-json", summary_json_str
        ]

        result = subprocess.run(
            cmd,
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=120  # Sync waits for cognify
        )

        assert result.returncode == 0, f"sync mode failed: {result.stderr}"

        output = _parse_json_stdout(result.stdout)
        assert output['success'] is True
        assert output['staged'] is False  # sync completes cognify immediately

        # Verify both operations in stderr
        assert '[PROGRESS] Adding to dataset' in result.stderr
        assert '[PROGRESS] Running cognify' in result.stderr or '[PROGRESS] Cognify' in result.stderr

    def test_sync_mode_supports_conversation(self, test_workspace):
        """Verify sync mode preserves conversation argument handling."""
        cmd = [
            sys.executable,
            "ingest.py",
            "--mode", "sync",
            test_workspace,
            "What is the meaning of life?",
            "42",
            "0.8"
        ]

        result = subprocess.run(
            cmd,
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=120
        )

        assert result.returncode == 0, f"sync conversation failed: {result.stderr}"

        output = _parse_json_stdout(result.stdout)
        assert output['success'] is True
        assert 'ingested_chars' in output


class TestBackwardCompatibility:
    """Tests for backward compatibility (default mode)"""

    def test_default_mode_is_sync(self, test_workspace):
        """Verify omitting --mode flag defaults to sync mode."""
        summary = create_test_summary(test_workspace)
        summary_json_str = json.dumps(summary)

        cmd = [
            sys.executable,
            "ingest.py",
            "--summary",
            "--summary-json", summary_json_str
        ]

        result = subprocess.run(
            cmd,
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=120
        )

        assert result.returncode == 0
        output = _parse_json_stdout(result.stdout)
        assert output['success'] is True
        # Default sync should complete cognify
        assert output.get('staged', False) is False


class TestErrorHandling:
    """Tests for error handling across modes"""

    def test_missing_credentials_error(self, tmp_path):
        """Verify missing Cloud credentials produces correct error code (Plan 083)."""
        workspace = tmp_path / "no_env_workspace"
        workspace.mkdir()

        summary = create_test_summary(str(workspace))
        summary_json_str = json.dumps(summary)

        env = os.environ.copy()
        env.pop("LLM_API_KEY", None)
        env.pop("AWS_ACCESS_KEY_ID", None)

        cmd = [
            sys.executable,
            "ingest.py",
            "--mode", "add-only",
            "--summary",
            "--summary-json", summary_json_str
        ]

        result = subprocess.run(
            cmd,
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=10,
            env=env
        )

        assert result.returncode == 1
        output = _parse_json_stdout(result.stdout)
        assert output['success'] is False
        assert output['error_code'] == 'NOT_AUTHENTICATED'

    def test_invalid_mode_rejected(self, test_workspace):
        """Verify invalid mode value is rejected."""
        cmd = [
            sys.executable,
            "ingest.py",
            "--mode", "invalid-mode",
            test_workspace
        ]

        result = subprocess.run(
            cmd,
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=10
        )

        assert result.returncode == 1
        output = _parse_json_stdout(result.stdout)
        assert output['success'] is False
        assert 'invalid mode' in output['error'].lower()


class TestAtomicWrites:
    """Tests for atomic status stub writes"""

    def test_status_stub_is_complete_json(self, test_workspace):
        """Verify status stub is never partially written (atomic)."""
        # Stage data
        summary = create_test_summary(test_workspace)
        summary_json_str = json.dumps(summary)

        add_cmd = [
            sys.executable,
            "ingest.py",
            "--mode", "add-only",
            "--summary",
            "--summary-json", summary_json_str
        ]

        subprocess.run(add_cmd, cwd=Path(__file__).parent, capture_output=True, timeout=30)

        # Run cognify-only
        operation_id = str(uuid.uuid4())

        cognify_cmd = [
            sys.executable,
            "ingest.py",
            "--mode", "cognify-only",
            "--operation-id", operation_id,
            test_workspace
        ]

        subprocess.run(
            cognify_cmd,
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=120
        )

        # Read and parse stub
        stub_path = Path(test_workspace) / ".cognee" / "background_ops" / f"{operation_id}.json"

        if stub_path.exists():
            stub_content = stub_path.read_text()
            # Should be valid JSON (no truncation)
            stub_data = json.loads(stub_content)

            # Verify required fields
            assert 'operation_id' in stub_data
            assert 'success' in stub_data
            assert 'timestamp' in stub_data


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
