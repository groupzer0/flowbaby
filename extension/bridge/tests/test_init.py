"""
Unit tests for init.py bridge script.

Tests LLM_API_KEY validation, workspace storage configuration, and ontology loading.
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock, AsyncMock, mock_open

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.mark.asyncio
async def test_initialize_missing_llm_api_key(temp_workspace, monkeypatch):
    """Test that initialization fails with clear error when LLM_API_KEY is missing."""
    # Remove LLM_API_KEY from environment
    monkeypatch.delenv('LLM_API_KEY', raising=False)
    
    # Remove .env file if it exists
    env_file = temp_workspace / '.env'
    if env_file.exists():
        env_file.unlink()
    
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        from init import initialize_cognee
        
        result = await initialize_cognee(str(temp_workspace))
        
        assert result['success'] is False
        assert 'LLM_API_KEY not found' in result['error']
        assert 'Set LLM_API_KEY=' in result['error']


@pytest.mark.asyncio
async def test_initialize_workspace_storage_directories(temp_workspace, mock_env, mock_cognee_module, sample_ontology):
    """Test that workspace-local storage directories are configured correctly."""
    # Create ontology.json file
    ontology_path = temp_workspace.parent / 'ontology.json'
    ontology_path.write_text(json.dumps(sample_ontology))
    
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        from init import initialize_cognee
        
        result = await initialize_cognee(str(temp_workspace))
        
        # Verify config methods were called with workspace paths
        expected_system_dir = str(temp_workspace / '.cognee_system')
        expected_data_dir = str(temp_workspace / '.cognee_data')
        
        mock_cognee_module.config.system_root_directory.assert_called_once_with(expected_system_dir)
        mock_cognee_module.config.data_root_directory.assert_called_once_with(expected_data_dir)


@pytest.mark.asyncio
async def test_initialize_success_with_llm_api_key(temp_workspace, mock_env, mock_cognee_module, sample_ontology):
    """Test successful initialization with valid LLM_API_KEY."""
    # Create ontology.json file in the bridge directory (where init.py expects it)
    bridge_dir = Path(__file__).parent.parent  # tests/ -> bridge/
    ontology_path = bridge_dir / 'ontology.json'
    ontology_path.write_text(json.dumps(sample_ontology))
    
    try:
        with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
            from init import initialize_cognee
            
            result = await initialize_cognee(str(temp_workspace))
            
            assert result['success'] is True
            assert 'dataset_name' in result
            assert result['ontology_loaded'] is True
            assert result['ontology_entities'] == 8
            assert result['ontology_relationships'] == 2
    finally:
        # Clean up ontology file
        if ontology_path.exists():
            ontology_path.unlink()


@pytest.mark.asyncio
async def test_initialize_ontology_validation(temp_workspace, mock_env, mock_cognee_module):
    """Test that initialization validates ontology file exists."""
    # Ensure ontology.json does NOT exist in bridge directory
    bridge_dir = Path(__file__).parent.parent  # tests/ -> bridge/
    ontology_path = bridge_dir / 'ontology.json'
    
    # Back up existing ontology.json if it exists
    backup_path = None
    if ontology_path.exists():
        backup_path = bridge_dir / 'ontology.json.test_backup'
        ontology_path.rename(backup_path)
    
    try:
        with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
            from init import initialize_cognee
            
            result = await initialize_cognee(str(temp_workspace))
            
            assert result['success'] is False
            assert 'Ontology file not found' in result['error']
    finally:
        # Restore ontology.json if it was backed up
        if backup_path and backup_path.exists():
            backup_path.rename(ontology_path)


def test_main_missing_workspace_argument(capsys):
    """Test main() exits with error when workspace_path argument is missing."""
    with patch('sys.argv', ['init.py']):
        with patch('sys.exit') as mock_exit:
            from init import main
            
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
            assert 'Missing required argument' in output['error']


def test_main_invalid_workspace_path(capsys):
    """Test main() exits with error when workspace_path does not exist."""
    with patch('sys.argv', ['init.py', '/nonexistent/path']):
        with patch('sys.exit') as mock_exit:
            from init import main
            
            try:
                main()
            except Exception:
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
            assert 'Workspace path does not exist' in output['error']
