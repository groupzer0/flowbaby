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
    
    # Patch sys.modules so local imports get the mock
    # We need to patch submodules too for 'from cognee.modules...' to work
    modules = {
        'cognee': mock_cognee,
        'cognee.modules': MagicMock(),
        'cognee.modules.search': MagicMock(),
        'cognee.modules.search.types': MagicMock(SearchType=mock_search_type)
    }
    
    with patch.dict('sys.modules', modules):
        yield mock_cognee, mock_cognee

@pytest.mark.asyncio
async def test_ingest_passes_session_id(mock_cognee_session, mock_env):
    """Test that ingest passes session_id to cognee.add."""
    mock_ingest, _ = mock_cognee_session
    
    session_id = "test-session-123"
    
    await run_add_only(
        workspace_path="test_dataset",
        user_message="User message",
        assistant_message="Assistant message",
        session_id=session_id
    )
    
    # Verify add was called with session_id
    mock_ingest.add.assert_called_once()
    call_kwargs = mock_ingest.add.call_args.kwargs
    assert call_kwargs.get('session_id') == session_id

@pytest.mark.asyncio
async def test_ingest_fallback_without_session_id(mock_cognee_session, mock_env):
    """Test that ingest falls back if session_id is not supported."""
    mock_ingest, _ = mock_cognee_session
    
    # Make add raise TypeError when session_id is passed
    async def side_effect(*args, **kwargs):
        if 'session_id' in kwargs:
            raise TypeError("unexpected keyword argument 'session_id'")
        return None
        
    mock_ingest.add.side_effect = side_effect
    
    session_id = "test-session-123"
    
    # Should not raise exception
    await run_add_only(
        workspace_path="test_dataset",
        user_message="User message",
        assistant_message="Assistant message",
        session_id=session_id
    )
    
    # Verify add was called twice: once with session_id (failed), once without
    assert mock_ingest.add.call_count == 2
    
    # First call had session_id
    first_call_kwargs = mock_ingest.add.call_args_list[0].kwargs
    assert first_call_kwargs.get('session_id') == session_id
    
    # Second call did not have session_id
    second_call_kwargs = mock_ingest.add.call_args_list[1].kwargs
    assert 'session_id' not in second_call_kwargs

@pytest.mark.asyncio
async def test_retrieve_passes_session_id(mock_cognee_session, mock_env):
    """Test that retrieve passes session_id to cognee.search."""
    _, mock_retrieve = mock_cognee_session
    
    session_id = "test-session-456"
    
    # Mock search result
    mock_retrieve.search.return_value = [
        MagicMock(text="Result 1", id="1"),
        MagicMock(text="Result 2", id="2")
    ]
    
    await retrieve_context(
        "test_workspace",
        "test query",
        session_id=session_id
    )
    
    # Verify search was called with session_id
    mock_retrieve.search.assert_called_once()
    call_kwargs = mock_retrieve.search.call_args.kwargs
    assert call_kwargs.get('session_id') == session_id

@pytest.mark.asyncio
async def test_retrieve_fallback_without_session_id(mock_cognee_session, mock_env):
    """Test that retrieve falls back if session_id is not supported."""
    _, mock_retrieve = mock_cognee_session
    
    # Mock search result for successful call
    mock_retrieve.search.return_value = [MagicMock(text="Result 1")]
    
    # Make search raise TypeError when session_id is passed
    original_search = mock_retrieve.search
    
    async def side_effect(*args, **kwargs):
        if 'session_id' in kwargs:
            raise TypeError("unexpected keyword argument 'session_id'")
        return [MagicMock(text="Result 1")]
    
    mock_retrieve.search.side_effect = side_effect
    
    session_id = "test-session-456"
    
    # Should not raise exception
    await retrieve_context(
        "test_workspace",
        "test query",
        session_id=session_id
    )    # Verify search was called twice
    assert mock_retrieve.search.call_count == 2
    
    # First call had session_id
    first_call_kwargs = mock_retrieve.search.call_args_list[0].kwargs
    assert first_call_kwargs.get('session_id') == session_id
    
    # Second call did not have session_id
    second_call_kwargs = mock_retrieve.search.call_args_list[1].kwargs
    assert 'session_id' not in second_call_kwargs

def test_ingest_main_extracts_session_id(capsys, mock_cognee_session, mock_env):
    """Test that ingest.main extracts session_id from JSON and passes it to run_add_only."""
    mock_ingest, _ = mock_cognee_session
    
    workspace_path = "/tmp/test_workspace"
    session_id = "test-session-789"
    
    json_payload = json.dumps({
        "workspace_path": workspace_path,
        "user_message": "User msg",
        "assistant_message": "Asst msg",
        "__user_session_id": session_id
    })
    
    with patch('sys.argv', ['ingest.py', '--mode', 'add-only', '--conversation-json', json_payload]), \
         patch('ingest.canonicalize_workspace_path', return_value=workspace_path), \
         patch('ingest.run_add_only', new_callable=AsyncMock) as mock_run_add_only:
        
        from ingest import main
        
        # Run main
        try:
            main()
        except SystemExit:
            pass
            
        # Verify run_add_only was called with session_id
        mock_run_add_only.assert_called_once()
        call_kwargs = mock_run_add_only.call_args.kwargs
        assert call_kwargs.get('session_id') == session_id

def test_retrieve_main_extracts_session_id(capsys, mock_cognee_session, mock_env):
    """Test that retrieve.main extracts session_id from JSON and passes it to retrieve_context."""
    _, mock_retrieve = mock_cognee_session
    
    workspace_path = "/tmp/test_workspace"
    session_id = "test-session-abc"
    
    json_payload = json.dumps({
        "workspace_path": workspace_path,
        "query": "test query",
        "__user_session_id": session_id
    })
    
    with patch('sys.argv', ['retrieve.py', '--json', json_payload]), \
         patch('retrieve.Path') as mock_path, \
         patch('retrieve.retrieve_context', new_callable=AsyncMock) as mock_retrieve_context:
        
        # Mock Path(workspace_path).is_dir() to return True
        mock_path.return_value.is_dir.return_value = True
        
        # Mock retrieve_context return value
        mock_retrieve_context.return_value = {'success': True, 'results': []}
        
        from retrieve import main
        
        # Run main
        try:
            main()
        except SystemExit:
            pass
            
        # Verify retrieve_context was called with session_id
        mock_retrieve_context.assert_called_once()
        
        # retrieve_context is called with positional args in main()
        # retrieve_context(workspace_path, query, max_results, max_tokens, half_life_days, include_superseded, top_k, session_id)
        call_args = mock_retrieve_context.call_args
        assert call_args.args[7] == session_id
