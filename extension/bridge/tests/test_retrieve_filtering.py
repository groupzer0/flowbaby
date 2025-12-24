"""Unit tests for Plan 073 context-only retrieval contract.

Plan 073 changed bridge retrieval to `only_context=True`, returning raw graph
context for TypeScript-side Copilot synthesis. These tests validate that
`retrieve_context`:

- extracts `graphContext` from the observed Cognee `only_context=True` shape
- returns `contractVersion` and `graphContextCharCount`
- returns an empty payload when no context is available
"""
import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

@pytest.fixture
def mock_cognee_module(monkeypatch):
    """Mock cognee module with LLM_API_KEY set for filtering tests.

    Plan 039 M5: LLM_API_KEY must be set in environment for retrieve to proceed
    past the API key validation guard and reach filtering logic.
    """
    # Plan 039: Set API key so retrieve_context reaches filtering logic
    monkeypatch.setenv('LLM_API_KEY', 'sk-test-filtering-key')

    mock_cognee = types.ModuleType('cognee')
    mock_cognee.__path__ = []
    mock_cognee.search = AsyncMock()
    mock_cognee.config = MagicMock()
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
        yield mock_cognee

@pytest.mark.asyncio
async def test_retrieve_extracts_graph_context_from_dict_value(temp_workspace, mock_cognee_module):
    """Extracts graphContext from the `[{search_result: [{dataset: context}]}]` shape."""

    dataset_name = 'ws_test_dataset'
    graph_context = "Nodes:\nNode: Test\nConnections:\n"
    mock_cognee_module.search.return_value = [
        {
            'search_result': [{dataset_name: graph_context}],
            'dataset_id': 'test-dataset-id',
            'dataset_name': dataset_name,
            'dataset_tenant_id': None,
        }
    ]

    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        from retrieve import retrieve_context

        result = await retrieve_context(workspace_path=str(temp_workspace), query="test query")

        assert result['success'] is True
        assert result['contractVersion'] == '2.0.0'
        assert result['graphContext'] == graph_context
        assert result['graphContextCharCount'] == len(graph_context)
        assert isinstance(result.get('results'), list)


@pytest.mark.asyncio
async def test_retrieve_extracts_graph_context_from_string_inner(temp_workspace, mock_cognee_module):
    """Extracts graphContext when inner `search_result` item is a string."""

    graph_context = "Nodes:\nNode: String inner format\n"
    mock_cognee_module.search.return_value = [
        {
            'search_result': [graph_context],
            'dataset_id': 'test-dataset-id',
            'dataset_name': 'ws_test_dataset',
            'dataset_tenant_id': None,
        }
    ]

    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        from retrieve import retrieve_context

        result = await retrieve_context(workspace_path=str(temp_workspace), query="test query")

        assert result['success'] is True
        assert result['contractVersion'] == '2.0.0'
        assert result['graphContext'] == graph_context
        assert result['graphContextCharCount'] == len(graph_context)


@pytest.mark.asyncio
async def test_retrieve_returns_empty_when_no_context(temp_workspace, mock_cognee_module):
    """Returns empty payload when Cognee returns no results."""

    mock_cognee_module.search.return_value = []

    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        from retrieve import retrieve_context

        result = await retrieve_context(workspace_path=str(temp_workspace), query="test query")

        assert result['success'] is True
        assert result['contractVersion'] == '2.0.0'
        assert result['graphContext'] is None
        assert result['result_count'] == 0


