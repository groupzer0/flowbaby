"""
Unit tests for sentinel scoring logic in retrieve.py.
"""
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

@pytest.mark.asyncio
async def test_sentinel_scoring_synthesized_answer(tmp_path, monkeypatch):
    """
    Test that a result with score 0.0 (sentinel) is promoted to
    final_score 1.0 and gets confidenceLabel='synthesized_high'.
    """
    # Setup environment
    monkeypatch.setenv('LLM_API_KEY', 'test-key')
    (tmp_path / '.env').write_text("LLM_API_KEY=test-key")

    with patch('sys.path', [str(tmp_path.parent)] + sys.path):
        # Mock cognee module
        mock_cognee = MagicMock()
        mock_cognee.config = MagicMock()

        # Mock search result with 0.0 score (sentinel)
        # Result tuple: (text, metadata)
        mock_search_result = (
            "This is a synthesized answer from the graph.",
            {"score": 0.0, "metadata": {"score": 0.0}}
        )

        mock_cognee.search = AsyncMock(return_value=[mock_search_result])
        mock_cognee.prune = MagicMock()
        mock_cognee.prune.prune_data = AsyncMock()

        with patch.dict('sys.modules', {'cognee': mock_cognee, 'cognee.modules.search.types': MagicMock()}):
            from retrieve import retrieve_context

            result = await retrieve_context(str(tmp_path), "test query")

            assert result['success'] is True
            assert len(result['results']) == 1

            item = result['results'][0]

            # Verify sentinel handling
            assert item['semantic_score'] == 0.0
            assert item['final_score'] == 1.0
            assert item['confidenceLabel'] == "synthesized_high"

@pytest.mark.asyncio
async def test_normal_scoring_non_sentinel(tmp_path, monkeypatch):
    """
    Test that a result with a normal score (e.g. 0.8) retains its score
    and gets confidenceLabel='normal'.
    """
    # Setup environment
    monkeypatch.setenv('LLM_API_KEY', 'test-key')
    (tmp_path / '.env').write_text("LLM_API_KEY=test-key")

    with patch('sys.path', [str(tmp_path.parent)] + sys.path):
        # Mock cognee module
        mock_cognee = MagicMock()
        mock_cognee.config = MagicMock()

        # Mock search result with normal score
        mock_search_result = (
            "This is a normal vector search result.",
            {"score": 0.8, "metadata": {"score": 0.8}}
        )

        mock_cognee.search = AsyncMock(return_value=[mock_search_result])
        mock_cognee.prune = MagicMock()
        mock_cognee.prune.prune_data = AsyncMock()

        with patch.dict('sys.modules', {'cognee': mock_cognee, 'cognee.modules.search.types': MagicMock()}):
            from retrieve import retrieve_context

            result = await retrieve_context(str(tmp_path), "test query")

            assert result['success'] is True
            assert len(result['results']) == 1

            item = result['results'][0]

            # Verify normal handling
            assert item['semantic_score'] == 0.8
            # final_score might be slightly different due to recency/status multipliers,
            # but should be close to 0.8 if timestamp is missing (default multiplier 1.0)
            assert item['final_score'] == 0.8
            assert item['confidenceLabel'] == "normal"
