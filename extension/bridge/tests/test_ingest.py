"""
Unit tests for ingest.py bridge script.

Tests add() and cognify() parameter usage, LLM_API_KEY validation, and structured error logging.
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock, AsyncMock

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.mark.asyncio
async def test_ingest_missing_llm_api_key(temp_workspace, monkeypatch):
    """Test that ingestion fails with clear error when LLM_API_KEY is missing."""
    # Remove LLM_API_KEY from environment
    monkeypatch.delenv('LLM_API_KEY', raising=False)
    
    # Remove .env file if it exists
    env_file = temp_workspace / '.env'
    if env_file.exists():
        env_file.unlink()
    
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        from ingest import ingest_conversation
        
        result = await ingest_conversation(
            str(temp_workspace),
            'Test user message',
            'Test assistant message'
        )
        
        assert result['success'] is False
        assert 'LLM_API_KEY not found' in result['error']
        assert 'Set LLM_API_KEY=' in result['error']


@pytest.mark.asyncio
async def test_ingest_add_with_correct_parameters(temp_workspace, mock_env, mock_cognee_module, mock_rdflib_graph):
    """Test that add() is called with data= and dataset_name= parameters."""
    # Create ontology.ttl file
    ontology_path = temp_workspace.parent / 'ontology.ttl'
    ontology_path.write_text('@prefix : <http://example.org/> .\n:Test a :Class .')
    
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        with patch('ingest.Path') as mock_path_class:
            # Mock ontology path
            mock_ontology = MagicMock()
            mock_ontology.exists.return_value = True
            
            def mock_path_side_effect(path_str):
                if 'ontology.ttl' in str(path_str):
                    return mock_ontology
                return Path(path_str)
            
            mock_path_class.side_effect = mock_path_side_effect
            
            from ingest import ingest_conversation
            
            result = await ingest_conversation(
                str(temp_workspace),
                'How do I cache?',
                'Use functools.lru_cache'
            )
            
            # Verify add() was called with correct parameters
            assert mock_cognee_module.add.called
            call_kwargs = mock_cognee_module.add.call_args.kwargs
            
            assert 'data' in call_kwargs
            assert isinstance(call_kwargs['data'], list)
            assert 'dataset_name' in call_kwargs


@pytest.mark.asyncio
async def test_ingest_cognify_with_datasets_parameter(temp_workspace, mock_env, mock_cognee_module, mock_rdflib_graph):
    """Test that cognify() is called with datasets= parameter (not ontology_file_path)."""
    # Create ontology.ttl file
    ontology_path = temp_workspace.parent / 'ontology.ttl'
    ontology_path.write_text('@prefix : <http://example.org/> .\n:Test a :Class .')
    
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        with patch('ingest.Path') as mock_path_class:
            mock_ontology = MagicMock()
            mock_ontology.exists.return_value = True
            
            def mock_path_side_effect(path_str):
                if 'ontology.ttl' in str(path_str):
                    return mock_ontology
                return Path(path_str)
            
            mock_path_class.side_effect = mock_path_side_effect
            
            from ingest import ingest_conversation
            
            result = await ingest_conversation(
                str(temp_workspace),
                'Test question',
                'Test answer'
            )
            
            # Verify cognify() was called with datasets parameter
            assert mock_cognee_module.cognify.called
            call_kwargs = mock_cognee_module.cognify.call_args.kwargs
            
            assert 'datasets' in call_kwargs
            assert isinstance(call_kwargs['datasets'], list)
            # Should NOT have ontology_file_path kwarg
            assert 'ontology_file_path' not in call_kwargs


@pytest.mark.asyncio
async def test_ingest_structured_error_logging(temp_workspace, mock_env, mock_cognee_module, mock_rdflib_graph, capsys):
    """Test that exceptions include structured error details in stderr."""
    # Create ontology.ttl file
    ontology_path = temp_workspace.parent / 'ontology.ttl'
    ontology_path.write_text('@prefix : <http://example.org/> .\n:Test a :Class .')
    
    # Make cognee.add raise an exception
    mock_cognee_module.add.side_effect = TypeError('Invalid parameter type')
    
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        with patch('ingest.Path') as mock_path_class:
            mock_ontology = MagicMock()
            mock_ontology.exists.return_value = True
            
            def mock_path_side_effect(path_str):
                if 'ontology.ttl' in str(path_str):
                    return mock_ontology
                return Path(path_str)
            
            mock_path_class.side_effect = mock_path_side_effect
            
            from ingest import ingest_conversation
            
            result = await ingest_conversation(
                str(temp_workspace),
                'Test question',
                'Test answer'
            )
            
            # Check result includes exception type
            assert result['success'] is False
            assert 'TypeError' in result['error']
            
            # Check stderr output includes structured error details
            captured = capsys.readouterr()
            assert 'Ingestion error details' in captured.err
            
            # Parse JSON from stderr (multi-line formatted)
            # Find the start of the JSON block after "Ingestion error details: "
            stderr_text = captured.err
            if 'Ingestion error details: ' in stderr_text:
                json_start_idx = stderr_text.index('Ingestion error details: ') + len('Ingestion error details: ')
                json_text = stderr_text[json_start_idx:].strip()
                
                # Extract the JSON object (everything from { to matching })
                # For indent=2 formatting, we need to handle multi-line JSON
                brace_count = 0
                json_end_idx = 0
                for i, char in enumerate(json_text):
                    if char == '{':
                        brace_count += 1
                    elif char == '}':
                        brace_count -= 1
                        if brace_count == 0:
                            json_end_idx = i + 1
                            break
                
                if json_end_idx > 0:
                    json_str = json_text[:json_end_idx]
                    error_details = json.loads(json_str)
                    
                    assert 'exception_type' in error_details
                    assert error_details['exception_type'] == 'TypeError'
                    assert 'exception_message' in error_details
                    assert 'dataset_name' in error_details
                    assert 'conversation_length' in error_details
                    assert 'ontology_validated' in error_details


@pytest.mark.asyncio
async def test_ingest_success_returns_metadata(temp_workspace, mock_env, mock_cognee_module, mock_rdflib_graph):
    """Test successful ingestion returns ingested_chars and timestamp."""
    # Create ontology.ttl file
    ontology_path = temp_workspace.parent / 'ontology.ttl'
    ontology_path.write_text('@prefix : <http://example.org/> .\n:Test a :Class .')
    
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        with patch('ingest.Path') as mock_path_class:
            mock_ontology = MagicMock()
            mock_ontology.exists.return_value = True
            
            def mock_path_side_effect(path_str):
                if 'ontology.ttl' in str(path_str):
                    return mock_ontology
                return Path(path_str)
            
            mock_path_class.side_effect = mock_path_side_effect
            
            from ingest import ingest_conversation
            
            user_msg = 'How do I cache?'
            assistant_msg = 'Use functools.lru_cache'
            
            result = await ingest_conversation(
                str(temp_workspace),
                user_msg,
                assistant_msg
            )
            
            assert result['success'] is True
            assert 'ingested_chars' in result
            assert isinstance(result['ingested_chars'], int)
            assert result['ingested_chars'] > 0
            assert 'timestamp' in result


def test_main_missing_arguments(capsys):
    """Test main() exits with error when required arguments are missing."""
    with patch('sys.argv', ['ingest.py', '/tmp/workspace']):  # Missing user_message and assistant_message
        with patch('sys.exit') as mock_exit:
            from ingest import main
            
            try:
                main()
            except IndexError:
                # Expected: execution continues after sys.exit(1) is patched, causing IndexError
                pass
            
            # When sys.exit is patched, execution may continue triggering multiple exits
            # Assert that sys.exit(1) was called at least once
            mock_exit.assert_any_call(1)
            
            captured = capsys.readouterr()
            # Parse only the first line of JSON output (first error message)
            first_line = captured.out.strip().split('\n')[0]
            output = json.loads(first_line)
            
            assert output['success'] is False
            assert 'Missing required arguments' in output['error']


def test_main_invalid_importance_value(capsys):
    """Test main() exits with error when importance parameter is invalid."""
    with patch('sys.argv', ['ingest.py', '/tmp/workspace', 'user msg', 'assistant msg', 'invalid']):
        with patch('sys.exit') as mock_exit:
            from ingest import main
            
            try:
                main()
            except (ValueError, IndexError):
                # Expected: execution continues after sys.exit(1) is patched
                pass
            
            # When sys.exit is patched, execution may continue triggering multiple exits
            # Assert that sys.exit(1) was called at least once
            mock_exit.assert_any_call(1)
            
            captured = capsys.readouterr()
            # Parse only the first line of JSON output (first error message)
            first_line = captured.out.strip().split('\n')[0]
            output = json.loads(first_line)
            
            assert output['success'] is False
            assert 'Invalid importance value' in output['error']
