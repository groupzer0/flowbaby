"""
Unit tests for session ID mapping in bridge scripts.

Tests that __user_session_id is correctly extracted and passed to cognee SDK methods.
"""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch, AsyncMock

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

# Import modules to test
# Note: We import inside tests or fixtures to ensure mocks are applied if needed,
# but here we can import functions directly if we patch cognee where it's used.
from ingest import run_add_only, run_sync
from retrieve import retrieve_context

@pytest.fixture
def mock_env(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")

@pytest.fixture
def mock_cognee_session():
    """Mock cognee module with session support."""
    mock_cognee = MagicMock()
    mock_cognee.add = AsyncMock()
    mock_cognee.cognify = AsyncMock()
    mock_cognee.search = AsyncMock()
    
    # Mock SearchType
    mock_search_type = MagicMock()
    
    # Mock session utils
    mock_users = MagicMock()
    mock_users.methods = MagicMock()
    mock_users.methods.get_default_user = AsyncMock()
    
    mock_context_vars = MagicMock()
    mock_context_vars.set_session_user_context_variable = AsyncMock()
    
    # Patch sys.modules so local imports get the mock
    # We need to patch submodules too for 'from cognee.modules...' to work
    modules = {
        'cognee': mock_cognee,
        'cognee.modules': MagicMock(),
        'cognee.modules.search': MagicMock(),
        'cognee.modules.search.types': MagicMock(SearchType=mock_search_type),
        'cognee.modules.users': mock_users,
        'cognee.modules.users.methods': mock_users.methods,
        'cognee.context_global_variables': mock_context_vars
    }
    
    with patch.dict('sys.modules', modules):
        yield mock_cognee, mock_cognee, mock_users.methods.get_default_user, mock_context_vars.set_session_user_context_variable

@pytest.mark.asyncio
async def test_ingest_does_not_pass_session_id(mock_cognee_session, mock_env):
    """Test that ingest does NOT pass session_id to cognee.add (as it is not supported in 0.4.1)."""
    mock_ingest, _, _, _ = mock_cognee_session
    
    session_id = "test-session-123"
    
    await run_add_only(
        workspace_path="test_dataset",
        user_message="User message",
        assistant_message="Assistant message",
        session_id=session_id
    )
    
    # Verify add was called WITHOUT session_id
    mock_ingest.add.assert_called_once()
    call_kwargs = mock_ingest.add.call_args.kwargs
    assert 'session_id' not in call_kwargs

@pytest.mark.asyncio
async def test_retrieve_passes_session_id(mock_cognee_session, mock_env):
    """Test that retrieve passes session_id to cognee.search."""
    _, mock_retrieve, mock_get_default_user, mock_set_session_user = mock_cognee_session
    
    session_id = "test-session-456"
    
    # Mock search result
    mock_retrieve.search.return_value = [
        MagicMock(text="Result 1", id="1"),
        MagicMock(text="Result 2", id="2")
    ]
    
    # Mock user return
    mock_get_default_user.return_value = MagicMock(id="user-123")
    
    await retrieve_context(
        "test_workspace",
        "test query",
        session_id=session_id
    )
    
    # Verify session context was initialized
    mock_get_default_user.assert_called_once()
    mock_set_session_user.assert_called_once()
    
    # Verify search was called with session_id
    mock_retrieve.search.assert_called_once()
    call_kwargs = mock_retrieve.search.call_args.kwargs
    assert call_kwargs.get('session_id') == session_id
