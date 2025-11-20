"""
Unit tests for retrieve.py bridge script.

Tests LLM_API_KEY validation, workspace path validation, and structured error messages.
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock, AsyncMock

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
        assert 'LLM_API_KEY=your_key_here' in result['remediation']
        assert 'error' in result
        assert 'LLM_API_KEY' in result['error']


@pytest.mark.asyncio
async def test_retrieve_success_with_llm_api_key(temp_workspace, mock_env):
    """Test successful retrieval with valid LLM_API_KEY and workspace-local storage."""
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        # Mock cognee module
        mock_cognee = MagicMock()
        mock_cognee.config = MagicMock()
        mock_cognee.search = AsyncMock(return_value=[])
        mock_cognee.prune.prune_data = AsyncMock()
        
        with patch.dict('sys.modules', {'cognee': mock_cognee, 'cognee.modules.search.types': MagicMock()}):
            from retrieve import retrieve_context
            
            result = await retrieve_context(str(temp_workspace), "test query")
            
            assert result['success'] is True
            assert 'results' in result
            assert 'result_count' in result
            assert 'total_tokens' in result
            # Verify API key was set (using key from mock_env fixture)
            mock_cognee.config.set_llm_api_key.assert_called_once_with('sk-test-mock-key-12345')
            # Verify workspace-local storage directories configured
            expected_system_dir = str(temp_workspace / '.cognee_system')
            expected_data_dir = str(temp_workspace / '.cognee_data')
            mock_cognee.config.system_root_directory.assert_called_once_with(expected_system_dir)
            mock_cognee.config.data_root_directory.assert_called_once_with(expected_data_dir)


@pytest.mark.asyncio
async def test_retrieve_with_search_results(temp_workspace, mock_env):
    """Test retrieval with mock search results including scoring."""
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        # Mock cognee module with sample search results
        mock_cognee = MagicMock()
        mock_cognee.config = MagicMock()
        mock_search_result = (
            "[Timestamp: 2025-11-15T10:00:00Z] [Importance: 0.8] This is a test result about Python.",
            {"metadata": "test"}
        )
        mock_cognee.search = AsyncMock(return_value=[mock_search_result])
        mock_cognee.prune.prune_data = AsyncMock()
        
        with patch.dict('sys.modules', {'cognee': mock_cognee, 'cognee.modules.search.types': MagicMock()}):
            from retrieve import retrieve_context
            
            result = await retrieve_context(str(temp_workspace), "Python", max_results=5)
            
            assert result['success'] is True
            assert result['result_count'] == 1
            assert len(result['results']) == 1
            
            # Verify result structure
            first_result = result['results'][0]
            assert 'text' in first_result
            assert 'score' in first_result
            assert 'recency_score' in first_result
            assert 'importance_score' in first_result
            assert 'tokens' in first_result
            
            # Verify scoring calculations
            assert 0 <= first_result['score'] <= 1
            assert 0 <= first_result['recency_score'] <= 1
            assert first_result['importance_score'] == 0.8


@pytest.mark.asyncio
async def test_retrieve_token_limit_enforcement(temp_workspace, mock_env):
    """Test that retrieval respects max_tokens limit."""
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        # Mock cognee module with multiple results
        mock_cognee = MagicMock()
        mock_cognee.config = MagicMock()
        
        # Create results that would exceed token limit
        large_text = "word " * 500  # ~500 tokens
        mock_results = [
            (f"[Timestamp: 2025-11-15T10:00:00Z] [Importance: 0.8] {large_text}", {}),
            (f"[Timestamp: 2025-11-15T09:00:00Z] [Importance: 0.7] {large_text}", {}),
            (f"[Timestamp: 2025-11-15T08:00:00Z] [Importance: 0.6] {large_text}", {})
        ]
        mock_cognee.search = AsyncMock(return_value=mock_results)
        mock_cognee.prune.prune_data = AsyncMock()
        
        with patch.dict('sys.modules', {'cognee': mock_cognee, 'cognee.modules.search.types': MagicMock()}):
            from retrieve import retrieve_context
            
            # Set low token limit
            result = await retrieve_context(str(temp_workspace), "test", max_tokens=600)
            
            assert result['success'] is True
            # Should only include first result due to token limit
            assert result['result_count'] <= 2
            assert result['total_tokens'] <= 600


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


def test_recency_score_calculation():
    """Test recency score calculation for various timestamps."""
    from retrieve import calculate_recency_score
    from datetime import datetime, timedelta
    
    # Recent timestamp (1 day ago) should have high score
    recent = (datetime.now() - timedelta(days=1)).isoformat()
    recent_score = calculate_recency_score(recent)
    assert 0.9 <= recent_score <= 1.0
    
    # Old timestamp (30+ days ago) should have score near 0
    old = (datetime.now() - timedelta(days=35)).isoformat()
    old_score = calculate_recency_score(old)
    assert 0.0 <= old_score <= 0.2
    
    # Mid-range timestamp (15 days ago) should have mid score
    mid = (datetime.now() - timedelta(days=15)).isoformat()
    mid_score = calculate_recency_score(mid)
    assert 0.4 <= mid_score <= 0.6
    
    # Invalid timestamp should return default
    invalid_score = calculate_recency_score("invalid-timestamp")
    assert invalid_score == 0.5


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
