"""
Unit tests for sentinel scoring logic in retrieve.py.
"""
import sys
import types
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
        # Mock cognee package + required submodules
        mock_cognee = types.ModuleType('cognee')
        mock_cognee.__path__ = []
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

        mock_context_globals = types.ModuleType('cognee.context_global_variables')
        mock_context_globals.set_session_user_context_variable = AsyncMock(return_value=None)

        mock_search_types = types.ModuleType('cognee.modules.search.types')
        mock_search_types.SearchType = MagicMock()
        mock_search_types.SearchType.GRAPH_COMPLETION = 'GRAPH_COMPLETION'

        mock_users_methods = types.ModuleType('cognee.modules.users.methods')
        mock_users_methods.get_default_user = AsyncMock(return_value=MagicMock(id='test-user'))

        with patch.dict('sys.modules', {
            'cognee': mock_cognee,
            'cognee.context_global_variables': mock_context_globals,
            'cognee.modules': types.ModuleType('cognee.modules'),
            'cognee.modules.search': types.ModuleType('cognee.modules.search'),
            'cognee.modules.search.types': mock_search_types,
            'cognee.modules.users': types.ModuleType('cognee.modules.users'),
            'cognee.modules.users.methods': mock_users_methods,
        }):
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
        # Mock cognee package + required submodules
        mock_cognee = types.ModuleType('cognee')
        mock_cognee.__path__ = []
        mock_cognee.config = MagicMock()

        # Mock search result with normal score
        mock_search_result = (
            "This is a normal vector search result.",
            {"score": 0.8, "metadata": {"score": 0.8}}
        )

        mock_cognee.search = AsyncMock(return_value=[mock_search_result])
        mock_cognee.prune = MagicMock()
        mock_cognee.prune.prune_data = AsyncMock()

        mock_context_globals = types.ModuleType('cognee.context_global_variables')
        mock_context_globals.set_session_user_context_variable = AsyncMock(return_value=None)

        mock_search_types = types.ModuleType('cognee.modules.search.types')
        mock_search_types.SearchType = MagicMock()
        mock_search_types.SearchType.GRAPH_COMPLETION = 'GRAPH_COMPLETION'

        mock_users_methods = types.ModuleType('cognee.modules.users.methods')
        mock_users_methods.get_default_user = AsyncMock(return_value=MagicMock(id='test-user'))

        with patch.dict('sys.modules', {
            'cognee': mock_cognee,
            'cognee.context_global_variables': mock_context_globals,
            'cognee.modules': types.ModuleType('cognee.modules'),
            'cognee.modules.search': types.ModuleType('cognee.modules.search'),
            'cognee.modules.search.types': mock_search_types,
            'cognee.modules.users': types.ModuleType('cognee.modules.users'),
            'cognee.modules.users.methods': mock_users_methods,
        }):
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
