"""Unit tests for retrieve.py search invocation.

Plan 073 switched bridge retrieval to `only_context=True` and moved synthesis to
TypeScript (Copilot). The bridge must no longer pass a system prompt because it
no longer triggers an embedded LLM completion inside Cognee.
"""
import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

@pytest.mark.asyncio
async def test_retrieve_passes_strict_system_prompt(temp_workspace, mock_env):
   """Plan 073: verify retrieval calls cognee.search with only_context=True (no system prompt)."""
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

            await retrieve_context(str(temp_workspace), "test query")

            # Verify cognee.search was called
            assert mock_cognee.search.called

            # Get the kwargs passed to search
            call_kwargs = mock_cognee.search.call_args.kwargs

            assert call_kwargs.get('only_context') is True
            assert call_kwargs.get('query_text') == 'test query'
            assert call_kwargs.get('query_type') == 'GRAPH_COMPLETION'
            assert 'system_prompt' not in call_kwargs
