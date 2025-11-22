"""
Unit tests for retrieve.py system prompt injection.
"""
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock, AsyncMock
import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

@pytest.mark.asyncio
async def test_retrieve_passes_strict_system_prompt(temp_workspace, mock_env):
    """Test that retrieval passes the strict system prompt to cognee.search."""
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        # Mock cognee module
        mock_cognee = MagicMock()
        mock_cognee.config = MagicMock()
        mock_cognee.search = AsyncMock(return_value=[])
        mock_cognee.prune.prune_data = AsyncMock()
        
        with patch.dict('sys.modules', {'cognee': mock_cognee, 'cognee.modules.search.types': MagicMock()}):
            from retrieve import retrieve_context
            
            await retrieve_context(str(temp_workspace), "test query")
            
            # Verify cognee.search was called
            assert mock_cognee.search.called
            
            # Get the kwargs passed to search
            call_kwargs = mock_cognee.search.call_args.kwargs
            
            # Verify system_prompt is present and correct
            assert 'system_prompt' in call_kwargs
            expected_prompt = "You are a helpful assistant. Answer the question strictly using ONLY the provided context. If the answer is not contained in the context, state 'I don't know' or 'The information is not available in the provided context'. Do not use outside knowledge or fabricate information."
            assert call_kwargs['system_prompt'] == expected_prompt
