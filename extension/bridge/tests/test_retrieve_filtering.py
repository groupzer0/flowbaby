"""
Unit tests for retrieve.py filtering logic.

Tests sentinel filtering, score filtering, and status filtering.
"""
import sys
import json
from pathlib import Path
from unittest.mock import patch, MagicMock, AsyncMock
import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

@pytest.fixture
def mock_cognee_module():
    with patch.dict('sys.modules', {'cognee': MagicMock()}):
        import cognee
        cognee.search = AsyncMock()
        cognee.config = MagicMock()
        yield cognee

@pytest.mark.asyncio
async def test_retrieve_sentinel_filtering(temp_workspace, mock_cognee_module):
    """Test that NO_RELEVANT_CONTEXT is filtered only when it is the exact text."""
    
    # Mock search results
    # 1. Exact match (should be filtered)
    # 2. Partial match (should be kept)
    # 3. Case insensitive exact match (should be filtered)
    
    mock_result1 = MagicMock()
    mock_result1.text = "NO_RELEVANT_CONTEXT"
    mock_result1.score = 0.9
    
    mock_result2 = MagicMock()
    mock_result2.text = "I found NO_RELEVANT_CONTEXT in the logs."
    mock_result2.score = 0.8
    
    mock_result3 = MagicMock()
    mock_result3.text = "no_relevant_context"
    mock_result3.score = 0.7
    
    mock_cognee_module.search.return_value = [mock_result1, mock_result2, mock_result3]
    
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        from retrieve import retrieve_context
        
        result = await retrieve_context(
            workspace_path=str(temp_workspace),
            query="test query"
        )
        
        assert result['success'] is True
        assert result['result_count'] == 1
        assert result['filtered_count'] == 2
        
        # Verify the only result is the partial match
        assert result['results'][0]['text'] == "I found NO_RELEVANT_CONTEXT in the logs."

@pytest.mark.asyncio
async def test_retrieve_score_filtering(temp_workspace, mock_cognee_module):
    """Test that low scores are filtered, but synthesized answers (score 0.0) are kept."""
    
    # 1. High score (keep)
    mock_result1 = MagicMock()
    mock_result1.text = "High score result"
    mock_result1.score = 0.5
    
    # 2. Low score (filter)
    mock_result2 = MagicMock()
    mock_result2.text = "Low score result"
    mock_result2.score = 0.001
    
    # 3. Synthesized answer (score 0.0) (keep)
    mock_result3 = MagicMock()
    mock_result3.text = "Synthesized answer"
    mock_result3.score = 0.0
    
    mock_cognee_module.search.return_value = [mock_result1, mock_result2, mock_result3]
    
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        from retrieve import retrieve_context
        
        result = await retrieve_context(
            workspace_path=str(temp_workspace),
            query="test query"
        )
        
        assert result['success'] is True
        # Should keep high score and synthesized
        assert result['result_count'] == 2
        assert result['filtered_count'] == 1
        
        texts = [r['text'] for r in result['results']]
        assert "High score result" in texts
        assert "Synthesized answer" in texts
        assert "Low score result" not in texts

@pytest.mark.asyncio
async def test_retrieve_status_filtering(temp_workspace, mock_cognee_module):
    """Test that Superseded items are filtered by default."""
    
    # 1. Active (keep)
    mock_result1 = MagicMock()
    mock_result1.text = "**Metadata:**\n- Status: Active\n\nActive result"
    mock_result1.metadata = {'status': 'Active', 'score': 0.5}
    
    # 2. Superseded (filter)
    mock_result2 = MagicMock()
    mock_result2.text = "**Metadata:**\n- Status: Superseded\n\nSuperseded result"
    mock_result2.metadata = {'status': 'Superseded', 'score': 0.5}
    
    mock_cognee_module.search.return_value = [mock_result1, mock_result2]
    
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        from retrieve import retrieve_context
        
        # Default: include_superseded=False
        result = await retrieve_context(
            workspace_path=str(temp_workspace),
            query="test query"
        )
        
        assert result['success'] is True
        assert result['result_count'] == 1
        assert result['filtered_count'] == 1
        assert result['results'][0]['text'] == "**Metadata:**\n- Status: Active\n\nActive result"
        
        # With include_superseded=True
        result_with_superseded = await retrieve_context(
            workspace_path=str(temp_workspace),
            query="test query",
            include_superseded=True
        )
        
        assert result_with_superseded['success'] is True
        assert result_with_superseded['result_count'] == 2
        assert result_with_superseded['filtered_count'] == 0
