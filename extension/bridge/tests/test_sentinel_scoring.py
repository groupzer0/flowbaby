"""Unit tests for Plan 073 context-only retrieval contract.

Legacy sentinel scoring existed to promote Cognee's synthesized answers (score
0.0) when the bridge performed completion. Plan 073 moves synthesis to
TypeScript (Copilot), so these tests now validate that the bridge returns the
new contract fields and extracted graph context.
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
    """Plan 073: returns contract v2.0.0 and graphContext when Cognee returns only_context payload."""

    monkeypatch.setenv('LLM_API_KEY', 'test-key')

    with patch('sys.path', [str(tmp_path.parent)] + sys.path):
        # Mock cognee package + required submodules
        mock_cognee = types.ModuleType('cognee')
        mock_cognee.__path__ = []
        mock_cognee.config = MagicMock()

        dataset_name = 'ws_test_dataset'
        graph_context = "Nodes:\nNode: Test\nConnections:\n"
        mock_search_result = [{
            'search_result': [{dataset_name: graph_context}],
            'dataset_id': 'test-dataset-id',
            'dataset_name': dataset_name,
            'dataset_tenant_id': None
        }]
        mock_cognee.search = AsyncMock(return_value=mock_search_result)
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
            assert result['contractVersion'] == '2.0.0'
            assert result['graphContext'] == graph_context
            assert result['graphContextCharCount'] == len(graph_context)

@pytest.mark.asyncio
async def test_normal_scoring_non_sentinel(tmp_path, monkeypatch):
    """Plan 073: returns empty payload with contractVersion when no results/context exist."""

    monkeypatch.setenv('LLM_API_KEY', 'test-key')

    with patch('sys.path', [str(tmp_path.parent)] + sys.path):
        # Mock cognee package + required submodules
        mock_cognee = types.ModuleType('cognee')
        mock_cognee.__path__ = []
        mock_cognee.config = MagicMock()

        mock_cognee.search = AsyncMock(return_value=[])
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
            assert result['contractVersion'] == '2.0.0'
            assert result['graphContext'] is None
            assert result['result_count'] == 0
