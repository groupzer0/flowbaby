"""
Unit tests for retrieve.py bridge script.

Tests LLM_API_KEY validation, workspace path validation, and structured error messages.
"""
import json
import os
import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.mark.asyncio
async def test_retrieve_missing_llm_api_key(temp_workspace, monkeypatch):
    """Test that retrieval fails with clear structured error when LLM_API_KEY is missing."""
    # Remove LLM_API_KEY from environment
    monkeypatch.delenv('LLM_API_KEY', raising=False)

    # Remove .env file if it exists
    env_file = temp_workspace / '.env'
    if env_file.exists():
        env_file.unlink()

    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        from retrieve import retrieve_context

        result = await retrieve_context(str(temp_workspace), "test query")

        assert result['success'] is False
        # Check for structured error format with new taxonomy
        assert 'error_code' in result
        assert result['error_code'] == 'LLM_API_ERROR'
        assert 'error_type' in result
        assert result['error_type'] == 'MISSING_API_KEY'
        assert 'user_message' in result
        assert 'LLM_API_KEY' in result['user_message']
        assert 'remediation' in result
        # Plan 039 M5: Remediation now points to secure storage command, not .env file
        assert 'Flowbaby: Set API Key' in result['remediation']
        assert 'error' in result
        assert 'LLM_API_KEY' in result['error']


@pytest.mark.asyncio
async def test_retrieve_success_with_llm_api_key(temp_workspace, mock_env):
    """Test successful retrieval with valid LLM_API_KEY and workspace-local storage."""
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
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

            result = await retrieve_context(str(temp_workspace), "test query")

            assert result['success'] is True
            assert 'results' in result
            assert 'result_count' in result
            assert 'total_tokens' in result
            assert 'total_results' in result
            assert result['half_life_days'] > 0
            assert result['include_superseded'] is False
            # Verify API key was set (using key from mock_env fixture)
            mock_cognee.config.set_llm_api_key.assert_called_once_with('sk-test-mock-key-12345')
            # Verify workspace-local storage directories configured
            expected_system_dir = str(temp_workspace / '.flowbaby/system')
            expected_data_dir = str(temp_workspace / '.flowbaby/data')
            mock_cognee.config.system_root_directory.assert_called_once_with(expected_system_dir)
            mock_cognee.config.data_root_directory.assert_called_once_with(expected_data_dir)

            # Plan 059: cache env defaults + root directory
            expected_cache_dir = str(temp_workspace / '.flowbaby/cache')
            assert os.environ.get('CACHE_ROOT_DIRECTORY') == expected_cache_dir
            assert os.environ.get('CACHING') == 'true'
            assert os.environ.get('CACHE_BACKEND') == 'fs'
            assert (temp_workspace / '.flowbaby/cache').exists()


@pytest.mark.asyncio
async def test_retrieve_with_search_results(temp_workspace, mock_env):
    """Test retrieval with mock search results including scoring.
    
    Plan 073: Tests now use the only_context=True return format (list[dict]).
    """
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        # Mock cognee package + required submodules
        mock_cognee = types.ModuleType('cognee')
        mock_cognee.__path__ = []
        mock_cognee.config = MagicMock()
        
        # Plan 073: Mock the only_context=True return format
        # This is list[dict] with search_result containing the graph context
        dataset_name = 'ws_test_dataset'
        graph_context = """Nodes:
Node: [Timestamp: 2025-11-15T10:00:00Z] This is a test result about Python.
__node_content_start__
<!-- Template: v1.1 -->
# Conversation Summary: Test Memory

**Metadata:**
- Topic ID: abc123
- Session ID: N/A
- Plan ID: N/A
- Status: Active
- Created: 2025-11-15T10:00:00Z
- Source Created: 2025-11-15T10:00:00Z
- Updated: 2025-11-15T10:00:00Z

## Context
This is a test result about Python development.

## Key Decisions
- Test decision 1

## Rationale
- Test rationale

## Open Questions
(none)

## Next Steps
(none)

## References
(none)

## Time Scope

__node_content_end__

Connections:
"""
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

            result = await retrieve_context(str(temp_workspace), "Python", max_results=5)

            assert result['success'] is True
            # Plan 073: Now returns graphContext instead of processed results
            assert 'contractVersion' in result
            assert result['contractVersion'] == '2.0.0'
            assert 'graphContext' in result
            assert result['graphContext'] is not None
            assert 'Python' in result['graphContext']  # Context should contain our test data


@pytest.mark.asyncio
async def test_retrieve_default_score(temp_workspace, mock_env):
    """Test retrieval returns graphContext with only_context=True format.
    
    Plan 073: With only_context=True, scoring/confidence is no longer computed
    in the bridge - that's now handled by the TypeScript synthesis layer.
    This test validates the new response structure.
    """
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        # Mock cognee package + required submodules
        mock_cognee = types.ModuleType('cognee')
        mock_cognee.__path__ = []
        mock_cognee.config = MagicMock()
        
        # Plan 073: Mock the only_context=True return format
        dataset_name = 'ws_test_default'
        graph_context = """Nodes:
Node: This is a test result without explicit scoring.
__node_content_start__
Test content here.
__node_content_end__

Connections:
"""
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

            result = await retrieve_context(str(temp_workspace), "test")

            assert result['success'] is True
            # Plan 073: Validate new contract version and graphContext
            assert result['contractVersion'] == '2.0.0'
            assert 'graphContext' in result
            assert result['graphContext'] is not None
            assert 'test result' in result['graphContext'].lower()


@pytest.mark.asyncio
async def test_retrieve_graph_completion_dict_format(temp_workspace, mock_env):
    """Test that retrieval correctly extracts graphContext from Cognee only_context=True format.
    
    Plan 073: With only_context=True, Cognee returns list[dict] where each dict has
    'search_result' containing the graph context string keyed by dataset name.
    """
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        mock_cognee = types.ModuleType('cognee')
        mock_cognee.__path__ = []
        mock_cognee.config = MagicMock()
        
        # Plan 073: Mock result in only_context=True format
        dataset_name = 'ws_test123'
        graph_context = """Nodes:
Node: [Plan 060] Schema migration implementation details.
__node_content_start__
For Plan 060, the following actions were taken: implemented schema migration.
__node_content_end__

Connections:
"""
        mock_search_result = [{
            'search_result': [{dataset_name: graph_context}],
            'dataset_id': 'test-uuid',
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

            result = await retrieve_context(str(temp_workspace), "plan 060")

            assert result['success'] is True
            assert result['contractVersion'] == '2.0.0'
            assert 'graphContext' in result
            
            # Verify the graphContext was correctly extracted
            assert result['graphContext'] is not None
            assert 'Plan 060' in result['graphContext']
            assert 'schema migration' in result['graphContext']


@pytest.mark.asyncio
async def test_retrieve_token_limit_enforcement(temp_workspace, mock_env):
    """Test that retrieval returns graphContext with character count info.
    
    Plan 073: With only_context=True, token limits are now handled by the TypeScript
    synthesis layer (60,000 char limit). The bridge returns graphContextCharCount
    for observability.
    """
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        # Mock cognee package + required submodules
        mock_cognee = types.ModuleType('cognee')
        mock_cognee.__path__ = []
        mock_cognee.config = MagicMock()

        # Create a large context
        large_text = "word " * 500  # ~2500 characters
        dataset_name = 'ws_test_large'
        graph_context = f"""Nodes:
Node: [Timestamp: 2025-11-15T10:00:00Z] Large content test.
__node_content_start__
{large_text}
__node_content_end__

Connections:
"""
        mock_search_result = [{
            'search_result': [{dataset_name: graph_context}],
            'dataset_id': 'test-uuid',
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

            # max_tokens parameter is deprecated in v2.0 but still accepted for compatibility
            result = await retrieve_context(str(temp_workspace), "test", max_tokens=600)

            assert result['success'] is True
            assert result['contractVersion'] == '2.0.0'
            assert 'graphContext' in result
            assert result['graphContext'] is not None
            # Plan 073: graphContextCharCount provides observability for truncation decisions
            assert 'graphContextCharCount' in result
            assert result['graphContextCharCount'] > 0


def test_main_missing_arguments(capsys):
    """Test main() exits with error when required arguments are missing."""
    with patch('sys.argv', ['retrieve.py']):
        with patch('sys.exit') as mock_exit:
            from retrieve import main

            try:
                main()
            except Exception:
                # Expected: execution continues after sys.exit(1) is patched
                pass

            mock_exit.assert_any_call(1)

            captured = capsys.readouterr()
            output = json.loads(captured.out.strip().split('\n')[0])

            assert output['success'] is False
            assert 'Missing required arguments' in output['error']


def test_main_invalid_workspace_path(capsys):
    """Test main() exits with error when workspace_path does not exist."""
    with patch('sys.argv', ['retrieve.py', '/nonexistent/path', 'query']):
        with patch('sys.exit') as mock_exit:
            from retrieve import main

            try:
                main()
            except Exception:
                # Expected: execution continues after sys.exit(1) is patched
                pass

            mock_exit.assert_any_call(1)

            captured = capsys.readouterr()
            output = json.loads(captured.out.strip().split('\n')[0])

            assert output['success'] is False
            assert 'Workspace path does not exist' in output['error']


def test_main_invalid_max_results(capsys):
    """Test main() exits with error when max_results is not an integer."""
    with patch('sys.argv', ['retrieve.py', '/tmp', 'query', 'not-a-number']):
        with patch('sys.exit') as mock_exit:
            from retrieve import main

            try:
                main()
            except Exception:
                # Expected: execution continues after sys.exit(1) is patched
                pass

            mock_exit.assert_any_call(1)

            captured = capsys.readouterr()
            output = json.loads(captured.out.strip().split('\n')[0])

            assert output['success'] is False
            assert 'Invalid max_results' in output['error']


def test_recency_multiplier_calculation():
    """Test recency multiplier calculation for various timestamps."""
    from datetime import datetime, timedelta, timezone

    from retrieve import calculate_recency_multiplier

    half_life_days = 7.0

    recent = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    # Ensure Z suffix if isoformat doesn't include it (it usually includes +00:00 for aware)
    # But the function handles +00:00 via fromisoformat.
    # However, the test previously added 'Z'. Let's keep it consistent or rely on isoformat.
    # datetime.now(timezone.utc).isoformat() produces "2023-10-27T10:00:00+00:00"
    # The retrieve function does: timestamp_str.replace('Z', '+00:00')
    # So if we pass "+00:00", it's fine.

    recent_multiplier = calculate_recency_multiplier(recent, half_life_days)
    assert 0.85 <= recent_multiplier <= 1.0

    old = (datetime.now(timezone.utc) - timedelta(days=35)).isoformat()
    old_multiplier = calculate_recency_multiplier(old, half_life_days)
    assert 0.0 <= old_multiplier <= 0.2

    mid = (datetime.now(timezone.utc) - timedelta(days=15)).isoformat()
    mid_multiplier = calculate_recency_multiplier(mid, half_life_days)
    assert 0.2 <= mid_multiplier <= 0.6

    invalid_multiplier = calculate_recency_multiplier("invalid-timestamp", half_life_days)
    assert invalid_multiplier == 1.0


def test_estimate_tokens():
    """Test token estimation for various text lengths."""
    from retrieve import estimate_tokens

    # Short text
    assert estimate_tokens("hello world") == 2

    # Empty text
    assert estimate_tokens("") == 0

    # Longer text
    text = "This is a longer piece of text with many words to test the token estimation function."
    tokens = estimate_tokens(text)
    assert tokens == len(text.split())
