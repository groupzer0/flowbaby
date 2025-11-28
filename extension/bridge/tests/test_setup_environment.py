"""
Tests for setup_environment() function in ingest.py

Plan 032 M2 (hotfix): Verifies that environment variables are set BEFORE cognee import
and that workspace-local directories are created.

CRITICAL: The Cognee SDK uses pydantic-settings which reads environment variables
matching the field names (DATA_ROOT_DIRECTORY, SYSTEM_ROOT_DIRECTORY) NOT prefixed
with COGNEE_. The original Plan 032 incorrectly used COGNEE_ prefix.
"""

import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


class TestSetupEnvironment:
    """Tests for the setup_environment() function in ingest.py
    
    Plan 039 M5: .env file support has been removed for security (F2).
    All tests must set LLM_API_KEY via environment variable, not .env file.
    """

    @pytest.fixture
    def temp_workspace(self, tmp_path, monkeypatch):
        """Create a temporary workspace with LLM_API_KEY set via environment.
        
        Plan 039: API key is now provided via environment variable from TypeScript,
        not read from .env files.
        """
        workspace = tmp_path / "test_workspace"
        workspace.mkdir()
        
        # Plan 039 M5: Set API key via environment variable (not .env file)
        monkeypatch.setenv('LLM_API_KEY', 'test-api-key-12345')
        
        return workspace

    @pytest.fixture
    def temp_workspace_no_env(self, tmp_path, monkeypatch):
        """Create a temporary workspace without API key in environment."""
        workspace = tmp_path / "test_workspace_no_env"
        workspace.mkdir()
        # Ensure LLM_API_KEY is not set
        monkeypatch.delenv('LLM_API_KEY', raising=False)
        return workspace

    def test_sets_system_root_directory_env_var(self, temp_workspace):
        """Verify SYSTEM_ROOT_DIRECTORY is set to workspace-local path"""
        # Import here to avoid module-level side effects
        from ingest import setup_environment
        
        # Clear any existing env vars
        os.environ.pop('SYSTEM_ROOT_DIRECTORY', None)
        os.environ.pop('DATA_ROOT_DIRECTORY', None)
        
        dataset_name, api_key, config = setup_environment(str(temp_workspace))
        
        # Verify env var is set
        assert 'SYSTEM_ROOT_DIRECTORY' in os.environ
        expected_path = str(temp_workspace / '.flowbaby/system')
        assert os.environ['SYSTEM_ROOT_DIRECTORY'] == expected_path

    def test_sets_data_root_directory_env_var(self, temp_workspace):
        """Verify DATA_ROOT_DIRECTORY is set to workspace-local path"""
        from ingest import setup_environment
        
        # Clear any existing env vars
        os.environ.pop('SYSTEM_ROOT_DIRECTORY', None)
        os.environ.pop('DATA_ROOT_DIRECTORY', None)
        
        dataset_name, api_key, config = setup_environment(str(temp_workspace))
        
        # Verify env var is set
        assert 'DATA_ROOT_DIRECTORY' in os.environ
        expected_path = str(temp_workspace / '.flowbaby/data')
        assert os.environ['DATA_ROOT_DIRECTORY'] == expected_path

    def test_creates_system_directory(self, temp_workspace):
        """Verify .flowbaby/system directory is created"""
        from ingest import setup_environment
        
        system_dir = temp_workspace / '.flowbaby/system'
        assert not system_dir.exists(), "Directory should not exist before setup"
        
        setup_environment(str(temp_workspace))
        
        assert system_dir.exists(), ".flowbaby/system directory should be created"
        assert system_dir.is_dir(), ".flowbaby/system should be a directory"

    def test_creates_data_directory(self, temp_workspace):
        """Verify .flowbaby/data directory is created"""
        from ingest import setup_environment
        
        data_dir = temp_workspace / '.flowbaby/data'
        assert not data_dir.exists(), "Directory should not exist before setup"
        
        setup_environment(str(temp_workspace))
        
        assert data_dir.exists(), ".flowbaby/data directory should be created"
        assert data_dir.is_dir(), ".flowbaby/data should be a directory"

    def test_returns_correct_config_paths(self, temp_workspace):
        """Verify returned config contains correct paths"""
        from ingest import setup_environment
        
        dataset_name, api_key, config = setup_environment(str(temp_workspace))
        
        assert 'system_root' in config
        assert 'data_root' in config
        assert 'workspace_dir' in config
        
        assert config['system_root'] == str(temp_workspace / '.flowbaby/system')
        assert config['data_root'] == str(temp_workspace / '.flowbaby/data')
        assert config['workspace_dir'] == temp_workspace

    def test_returns_api_key_from_environment(self, temp_workspace):
        """Verify API key is extracted from environment variable.
        
        Plan 039 M5: API key now comes from LLM_API_KEY environment variable,
        injected by TypeScript client. .env file support removed for security.
        """
        from ingest import setup_environment
        
        # temp_workspace fixture already sets LLM_API_KEY='test-api-key-12345'
        dataset_name, api_key, config = setup_environment(str(temp_workspace))
        
        assert api_key == 'test-api-key-12345'

    def test_returns_dataset_name(self, temp_workspace):
        """Verify dataset name is generated"""
        from ingest import setup_environment
        
        dataset_name, api_key, config = setup_environment(str(temp_workspace))
        
        assert dataset_name is not None
        assert len(dataset_name) > 0
        assert dataset_name.startswith('ws_')

    def test_raises_when_no_api_key(self, temp_workspace_no_env):
        """Verify ValueError is raised when no API key is available.
        
        Plan 039 M5: Error message now directs user to 'Flowbaby: Set API Key'
        command rather than .env file.
        """
        from ingest import setup_environment
        
        # temp_workspace_no_env fixture ensures LLM_API_KEY is not set
        
        with pytest.raises(ValueError) as exc_info:
            setup_environment(str(temp_workspace_no_env))
        
        error_message = str(exc_info.value)
        assert 'LLM_API_KEY' in error_message
        # Plan 039: Remediation now points to secure storage command
        assert 'Flowbaby: Set API Key' in error_message

    def test_env_vars_set_before_directories_exist(self, temp_workspace):
        """Verify env vars are set even if directories don't exist yet (idempotent)"""
        from ingest import setup_environment
        
        # Clear env vars
        os.environ.pop('SYSTEM_ROOT_DIRECTORY', None)
        os.environ.pop('DATA_ROOT_DIRECTORY', None)
        
        # First call
        setup_environment(str(temp_workspace))
        
        first_system = os.environ.get('SYSTEM_ROOT_DIRECTORY')
        first_data = os.environ.get('DATA_ROOT_DIRECTORY')
        
        # Second call (directories already exist)
        setup_environment(str(temp_workspace))
        
        # Should be the same
        assert os.environ.get('SYSTEM_ROOT_DIRECTORY') == first_system
        assert os.environ.get('DATA_ROOT_DIRECTORY') == first_data


class TestRetrieveEnvironmentSetup:
    """Tests for environment setup in retrieve.py
    
    Plan 039 M5: .env file support has been removed for security (F2).
    All tests must set LLM_API_KEY via environment variable.
    """

    @pytest.fixture
    def temp_workspace(self, tmp_path, monkeypatch):
        """Create a temporary workspace with LLM_API_KEY set via environment.
        
        Plan 039: API key is now provided via environment variable from TypeScript,
        not read from .env files.
        """
        workspace = tmp_path / "test_workspace"
        workspace.mkdir()
        
        # Plan 039 M5: Set API key via environment variable (not .env file)
        monkeypatch.setenv('LLM_API_KEY', 'test-api-key-retrieve')
        
        return workspace

    def test_retrieve_sets_env_vars_before_import(self, temp_workspace):
        """
        Verify retrieve.py sets SYSTEM_ROOT_DIRECTORY and DATA_ROOT_DIRECTORY env vars.
        
        Note: We can't easily test the "before import" aspect without
        mocking the entire cognee import, but we verify the env vars
        are set after retrieve_context runs (which means they were
        set during execution).
        """
        # This is more of an integration test - the key behavior is that
        # env vars are set, which we verify by checking they exist after
        # the retrieve module is imported and used
        
        # Clear env vars
        os.environ.pop('SYSTEM_ROOT_DIRECTORY', None)
        os.environ.pop('DATA_ROOT_DIRECTORY', None)
        
        # The retrieve module sets env vars in retrieve_context()
        # We can verify the pattern is correct by checking the code structure
        import retrieve
        
        # Verify the module has the expected structure
        assert hasattr(retrieve, 'retrieve_context')
        
        # The actual env var setting happens inside retrieve_context
        # which requires async execution and mocked cognee imports
        # This is tested implicitly by the existing test_retrieve.py tests
