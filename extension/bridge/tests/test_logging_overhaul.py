import os
import sys
import json
import shutil
import tempfile
import pytest
import logging
from pathlib import Path

# Add bridge directory to path
BRIDGE_DIR = Path(__file__).parent.parent
sys.path.append(str(BRIDGE_DIR))

import bridge_logger
from retrieve import retrieve_context
from ingest import run_sync
from init import initialize_cognee


def has_real_api_key():
    """Check if a real (non-dummy) API key is available."""
    key = os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY")
    if not key:
        return False
    # Skip dummy keys
    return not key.startswith("sk-dummy") and not key.startswith("test_key")


requires_llm = pytest.mark.skipif(
    not has_real_api_key(),
    reason="Requires real LLM API key (OPENAI_API_KEY or LLM_API_KEY)"
)

@pytest.fixture
def test_workspace():
    """Create a temporary workspace for testing."""
    workspace_dir = tempfile.mkdtemp(prefix="cognee_test_logging_")
    
    # Create .env file with dummy key (or real one if available in env)
    env_path = Path(workspace_dir) / ".env"
    api_key = os.getenv("OPENAI_API_KEY", "sk-dummy-key-for-testing")
    with open(env_path, "w") as f:
        f.write(f"LLM_API_KEY={api_key}\n")
        
    yield workspace_dir
    
    # Cleanup
    shutil.rmtree(workspace_dir)

def test_logging_setup(test_workspace):
    """Verify log file creation and format."""
    logger = bridge_logger.setup_logging(test_workspace, "test_script")
    logger.info("Test message", extra={'data': {'key': 'value'}})
    
    log_dir = Path(test_workspace) / ".flowbaby" / "logs"
    log_file = log_dir / "flowbaby.log"
    
    assert log_file.exists()
    
    with open(log_file, "r") as f:
        lines = f.readlines()
        assert len(lines) > 0
        last_line = lines[-1]
        log_entry = json.loads(last_line)
        
        assert log_entry["message"] == "Test message"
        assert log_entry["level"] == "INFO"
        assert log_entry["logger"] == "flowbaby.test_script"
        assert log_entry["data"]["key"] == "value"


@requires_llm
@pytest.mark.asyncio
async def test_ingestion_logging(test_workspace):
    """Verify ingestion logs metrics."""
    # Run ingestion
    result = await run_sync(
        workspace_path=test_workspace,
        user_message="Hello",
        assistant_message="Hi there",
        importance=0.5
    )
    
    assert result["success"] is True
    
    log_file = Path(test_workspace) / ".flowbaby" / "logs" / "flowbaby.log"
    assert log_file.exists()
    
    found_metrics = False
    with open(log_file, "r") as f:
        for line in f:
            try:
                entry = json.loads(line)
                if "Sync ingestion duration" in entry["message"]:
                    found_metrics = True
                    break
            except json.JSONDecodeError:
                continue
                
    assert found_metrics, "Ingestion metrics log not found"


@requires_llm
@pytest.mark.asyncio
async def test_retrieval_logging(test_workspace):
    """Verify retrieval logs contain scoring details."""
    # First ingest something so we have data (otherwise retrieval might be empty/skipped)
    await run_sync(
        workspace_path=test_workspace,
        user_message="What is the capital of France?",
        assistant_message="The capital of France is Paris.",
        importance=1.0
    )
    
    # Run retrieval
    result = await retrieve_context(
        workspace_path=test_workspace,
        query="France capital",
        max_results=1
    )
    
    assert result["success"] is True
    
    log_file = Path(test_workspace) / ".flowbaby" / "logs" / "flowbaby.log"
    assert log_file.exists()
    
    found_scoring = False
    found_start = False
    
    with open(log_file, "r") as f:
        for line in f:
            try:
                entry = json.loads(line)
                if "Starting retrieval" in entry["message"]:
                    found_start = True
                if "Scoring candidate" in entry["message"]:
                    found_scoring = True
                    # Verify scoring details are present
                    data = entry.get("data", {})
                    assert "semantic_score" in data
                    assert "final_score" in data
            except json.JSONDecodeError:
                continue
                
    assert found_start, "Retrieval start log not found"
    # Note: Scoring might not happen if search returns no results, but we ingested data.
    # However, if the graph is empty or search fails, it might be skipped.
    # We'll assert found_scoring only if result_count > 0
    if result.get("result_count", 0) > 0:
        assert found_scoring, "Scoring logs not found for results"

def test_stderr_output_format(test_workspace, capsys):
    """Verify stderr output is JSON-lines."""
    logger = bridge_logger.setup_logging(test_workspace, "test_stderr")
    logger.info("Stderr test", extra={'data': {'foo': 'bar'}})
    
    captured = capsys.readouterr()
    stderr_output = captured.err
    
    # Parse last line of stderr
    lines = stderr_output.strip().split('\n')
    assert len(lines) > 0
    
    last_line = lines[-1]
    try:
        entry = json.loads(last_line)
        assert entry["message"] == "Stderr test"
        assert entry["data"]["foo"] == "bar"
    except json.JSONDecodeError:
        pytest.fail(f"Stderr output is not valid JSON: {last_line}")

if __name__ == "__main__":
    # Allow running directly
    sys.exit(pytest.main([__file__]))
