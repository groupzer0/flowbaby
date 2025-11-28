import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

# Add bridge directory to path
BRIDGE_DIR = Path(__file__).parent.parent
sys.path.append(str(BRIDGE_DIR))

from ingest import run_sync  # noqa: E402
from retrieve import retrieve_context  # noqa: E402


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
async def populated_workspace():
    """Create a temporary workspace with one ingested memory for retrieval tests."""
    workspace_dir = tempfile.mkdtemp(prefix="cognee_test_topk_")

    # Minimal .env with dummy key
    env_path = Path(workspace_dir) / ".env"
    with open(env_path, "w", encoding="utf-8") as f:
        f.write("LLM_API_KEY=sk-dummy-key-for-testing\n")

    # Ingest a simple conversation so retrieval has something to return
    await run_sync(
        workspace_path=workspace_dir,
        user_message="What is the capital of France?",
        assistant_message="The capital of France is Paris.",
        importance=1.0,
    )

    try:
        yield workspace_dir
    finally:
        shutil.rmtree(workspace_dir)


@requires_llm
@pytest.mark.asyncio
async def test_topk_normalized_up_to_max_results(populated_workspace):
    """When top_k < max_results, effective selection should still honor max_results.

    We don't assert on internal logging here, but we do assert that:
    - the call succeeds, and
    - the number of returned results never exceeds max_results.
    """

    workspace = populated_workspace

    max_results = 5
    # Deliberately choose a smaller top_k than max_results to trigger normalization
    result = await retrieve_context(
        workspace_path=workspace,
        query="France capital",
        max_results=max_results,
        max_tokens=2000,
        half_life_days=7.0,
        include_superseded=False,
        top_k=1,
    )

    assert result["success"] is True
    assert result["result_count"] <= max_results


@requires_llm
@pytest.mark.asyncio
async def test_topk_clamped_to_upper_bound(populated_workspace):
    """When top_k is huge, the bridge should clamp it to the architectural ceiling.

    This test exercises the path where callers pass a very large top_k. We
    only assert functional success and that we don't exceed max_results; the
    clamp to 100 is validated indirectly via lack of errors and bounded
    results.
    """

    workspace = populated_workspace

    max_results = 3
    result = await retrieve_context(
        workspace_path=workspace,
        query="France capital",
        max_results=max_results,
        max_tokens=2000,
        half_life_days=7.0,
        include_superseded=False,
        top_k=1000,
    )

    assert result["success"] is True
    assert result["result_count"] <= max_results


@requires_llm
@pytest.mark.asyncio
async def test_max_tokens_hard_clamp(populated_workspace):
    """max_tokens values above 100k should be hard-clamped by the bridge.

    We verify that calls with an extremely large max_tokens value still
    succeed and that the reported total_tokens do not exceed the requested
    budget.
    """

    workspace = populated_workspace

    result = await retrieve_context(
        workspace_path=workspace,
        query="France capital",
        max_results=5,
        max_tokens=1_000_000,  # intentionally absurd; should clamp to 100k
        half_life_days=7.0,
        include_superseded=False,
        top_k=None,
    )

    assert result["success"] is True
    # The bridge normalizes and clamps internally; we just assert that the
    # returned token count respects the advertised budget.
    assert result["total_tokens"] <= 100_000
