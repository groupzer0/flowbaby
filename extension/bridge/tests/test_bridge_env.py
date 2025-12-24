"""
Tests for bridge_env.py - Plan 074 Ontology Environment Wiring

This test module validates the shared bridge environment configuration module
that provides the single source of truth for all Cognee environment variables.

Key invariants tested:
1. Environment variables are set correctly for workspace isolation
2. Ontology configuration is activated (ONTOLOGY_FILE_PATH, ONTOLOGY_RESOLVER, MATCHING_STRATEGY)
3. Missing ontology file raises OntologyConfigError (fail-closed)
4. Config snapshot is returned for observability
5. Daemon-mode equivalent behavior
"""

import logging
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


class TestBridgeEnvApplyWorkspaceEnv:
    """Tests for apply_workspace_env() function."""

    @pytest.fixture
    def temp_workspace(self, tmp_path):
        """Create a temporary workspace directory."""
        workspace = tmp_path / "test_workspace"
        workspace.mkdir()
        return workspace

    @pytest.fixture
    def clean_env(self, monkeypatch):
        """Clear all Cognee-related environment variables before test."""
        env_vars = [
            'SYSTEM_ROOT_DIRECTORY',
            'DATA_ROOT_DIRECTORY',
            'CACHE_ROOT_DIRECTORY',
            'CACHING',
            'CACHE_BACKEND',
            'ONTOLOGY_FILE_PATH',
            'ONTOLOGY_RESOLVER',
            'MATCHING_STRATEGY',
        ]
        for var in env_vars:
            monkeypatch.delenv(var, raising=False)

    def test_sets_storage_directories(self, temp_workspace, clean_env):
        """Verify storage directories are set to workspace-local paths."""
        from bridge_env import apply_workspace_env

        config = apply_workspace_env(str(temp_workspace))

        # Verify env vars are set
        assert os.environ['SYSTEM_ROOT_DIRECTORY'] == str(temp_workspace / '.flowbaby' / 'system')
        assert os.environ['DATA_ROOT_DIRECTORY'] == str(temp_workspace / '.flowbaby' / 'data')
        assert os.environ['CACHE_ROOT_DIRECTORY'] == str(temp_workspace / '.flowbaby' / 'cache')

        # Verify directories were created
        assert (temp_workspace / '.flowbaby' / 'system').is_dir()
        assert (temp_workspace / '.flowbaby' / 'data').is_dir()
        assert (temp_workspace / '.flowbaby' / 'cache').is_dir()

        # Verify config snapshot matches
        assert config.system_root == str(temp_workspace / '.flowbaby' / 'system')
        assert config.data_root == str(temp_workspace / '.flowbaby' / 'data')
        assert config.cache_root == str(temp_workspace / '.flowbaby' / 'cache')

    def test_sets_caching_defaults(self, temp_workspace, clean_env):
        """Verify caching is enabled with filesystem backend by default."""
        from bridge_env import apply_workspace_env

        config = apply_workspace_env(str(temp_workspace))

        assert os.environ['CACHING'] == 'true'
        assert os.environ['CACHE_BACKEND'] == 'fs'
        assert config.caching == 'true'
        assert config.cache_backend == 'fs'

    def test_respects_existing_cache_settings(self, temp_workspace, clean_env, monkeypatch):
        """Verify existing cache settings are not overwritten."""
        from bridge_env import apply_workspace_env

        # Pre-set cache settings
        monkeypatch.setenv('CACHING', 'false')
        monkeypatch.setenv('CACHE_BACKEND', 'redis')

        config = apply_workspace_env(str(temp_workspace))

        # Should preserve existing values
        assert os.environ['CACHING'] == 'false'
        assert os.environ['CACHE_BACKEND'] == 'redis'

    def test_sets_ontology_env_vars(self, temp_workspace, clean_env):
        """Verify ontology environment variables are set correctly."""
        from bridge_env import apply_workspace_env, get_ontology_path

        config = apply_workspace_env(str(temp_workspace))

        # Verify env vars are set
        assert os.environ['ONTOLOGY_FILE_PATH'] == str(get_ontology_path())
        assert os.environ['ONTOLOGY_RESOLVER'] == 'rdflib'
        assert os.environ['MATCHING_STRATEGY'] == 'fuzzy'

        # Verify config snapshot
        assert config.ontology_resolver == 'rdflib'
        assert config.matching_strategy == 'fuzzy'
        assert config.ontology_file_exists is True  # Real ontology.ttl should exist

    def test_raises_on_missing_ontology(self, temp_workspace, clean_env):
        """Verify OntologyConfigError is raised when ontology.ttl is missing."""
        from bridge_env import apply_workspace_env, OntologyConfigError

        # Mock get_ontology_path to return a non-existent path
        with patch('bridge_env.get_ontology_path') as mock_path:
            mock_path.return_value = Path('/nonexistent/ontology.ttl')

            with pytest.raises(OntologyConfigError) as exc_info:
                apply_workspace_env(str(temp_workspace))

            assert 'Ontology file not found' in str(exc_info.value)
            assert 'packaging regression' in str(exc_info.value)

    def test_allows_missing_ontology_when_disabled(self, temp_workspace, clean_env):
        """Verify missing ontology doesn't raise when fail_on_missing_ontology=False."""
        from bridge_env import apply_workspace_env

        # Mock get_ontology_path to return a non-existent path
        with patch('bridge_env.get_ontology_path') as mock_path:
            mock_path.return_value = Path('/nonexistent/ontology.ttl')

            # Should not raise
            config = apply_workspace_env(
                str(temp_workspace),
                fail_on_missing_ontology=False
            )

            assert config.ontology_file_exists is False

    def test_logs_warning_when_ontology_missing_and_fail_closed_disabled(self, temp_workspace, clean_env):
        """Verify missing ontology triggers a warning log in degraded mode."""
        from bridge_env import apply_workspace_env

        mock_logger = MagicMock(spec=logging.Logger)

        with patch('bridge_env.get_ontology_path') as mock_path:
            mock_path.return_value = Path('/nonexistent/ontology.ttl')

            config = apply_workspace_env(
                str(temp_workspace),
                logger=mock_logger,
                fail_on_missing_ontology=False,
            )

            assert config.ontology_file_exists is False
            mock_logger.warning.assert_called()

    def test_returns_config_snapshot(self, temp_workspace, clean_env):
        """Verify BridgeEnvConfig is returned with all fields populated."""
        from bridge_env import apply_workspace_env, BridgeEnvConfig

        config = apply_workspace_env(str(temp_workspace))

        assert isinstance(config, BridgeEnvConfig)
        assert config.workspace_path == str(temp_workspace)
        assert config.system_root is not None
        assert config.data_root is not None
        assert config.cache_root is not None
        assert config.caching is not None
        assert config.cache_backend is not None
        assert config.ontology_file_path is not None
        assert config.ontology_resolver is not None
        assert config.matching_strategy is not None
        assert isinstance(config.ontology_file_exists, bool)

    def test_config_to_dict(self, temp_workspace, clean_env):
        """Verify BridgeEnvConfig.to_dict() returns valid JSON-serializable dict."""
        from bridge_env import apply_workspace_env

        config = apply_workspace_env(str(temp_workspace))
        config_dict = config.to_dict()

        assert isinstance(config_dict, dict)
        assert 'workspace_path' in config_dict
        assert 'ontology_file_path' in config_dict
        assert 'ontology_resolver' in config_dict
        assert 'matching_strategy' in config_dict
        assert 'ontology_file_exists' in config_dict

    def test_config_to_log_string(self, temp_workspace, clean_env):
        """Verify BridgeEnvConfig.to_log_string() returns formatted string."""
        from bridge_env import apply_workspace_env

        config = apply_workspace_env(str(temp_workspace))
        log_string = config.to_log_string()

        assert isinstance(log_string, str)
        assert 'workspace=' in log_string
        assert 'ontology=' in log_string
        assert 'resolver=' in log_string
        assert 'strategy=' in log_string

    def test_raises_on_empty_workspace_path(self, clean_env):
        """Verify ValueError is raised when workspace_path is empty."""
        from bridge_env import apply_workspace_env

        with pytest.raises(ValueError) as exc_info:
            apply_workspace_env('')

        assert 'required' in str(exc_info.value).lower()

    def test_raises_on_relative_workspace_path(self, clean_env):
        """Verify ValueError is raised when workspace_path is relative."""
        from bridge_env import apply_workspace_env

        with pytest.raises(ValueError) as exc_info:
            apply_workspace_env('relative/path')

        assert 'absolute' in str(exc_info.value).lower()


class TestBridgeEnvHelpers:
    """Tests for helper functions in bridge_env.py."""

    def test_get_bridge_assets_dir(self):
        """Verify get_bridge_assets_dir returns the bridge module directory."""
        from bridge_env import get_bridge_assets_dir

        assets_dir = get_bridge_assets_dir()

        assert isinstance(assets_dir, Path)
        assert assets_dir.is_dir()
        assert (assets_dir / 'bridge_env.py').exists()

    def test_get_ontology_path(self):
        """Verify get_ontology_path returns correct path to ontology.ttl."""
        from bridge_env import get_ontology_path

        ontology_path = get_ontology_path()

        assert isinstance(ontology_path, Path)
        assert ontology_path.name == 'ontology.ttl'
        # The real ontology.ttl should exist in the bridge directory
        assert ontology_path.exists(), f"Expected ontology.ttl at {ontology_path}"

    def test_validate_ontology_env_when_set(self, monkeypatch):
        """Verify validate_ontology_env() returns correct state when env is set."""
        from bridge_env import validate_ontology_env, get_ontology_path

        # Set the env vars
        monkeypatch.setenv('ONTOLOGY_FILE_PATH', str(get_ontology_path()))
        monkeypatch.setenv('ONTOLOGY_RESOLVER', 'rdflib')
        monkeypatch.setenv('MATCHING_STRATEGY', 'fuzzy')

        result = validate_ontology_env()

        assert result['ontology_env_configured'] is True
        assert result['ontology_file_path'] == str(get_ontology_path())
        assert result['ontology_resolver'] == 'rdflib'
        assert result['matching_strategy'] == 'fuzzy'
        assert result['ontology_file_exists'] is True

    def test_validate_ontology_env_when_not_set(self, monkeypatch):
        """Verify validate_ontology_env() returns correct state when env is not set."""
        from bridge_env import validate_ontology_env

        # Clear the env vars
        monkeypatch.delenv('ONTOLOGY_FILE_PATH', raising=False)
        monkeypatch.delenv('ONTOLOGY_RESOLVER', raising=False)
        monkeypatch.delenv('MATCHING_STRATEGY', raising=False)

        result = validate_ontology_env()

        assert result['ontology_env_configured'] is False

    def test_validate_ontology_env_when_file_missing(self, monkeypatch):
        """Verify validate_ontology_env() reports configured-but-missing ontology file."""
        from bridge_env import validate_ontology_env

        monkeypatch.setenv('ONTOLOGY_FILE_PATH', '/nonexistent/ontology.ttl')
        monkeypatch.setenv('ONTOLOGY_RESOLVER', 'rdflib')
        monkeypatch.setenv('MATCHING_STRATEGY', 'fuzzy')

        result = validate_ontology_env()

        assert result['ontology_env_configured'] is True
        assert result['ontology_file_exists'] is False
        assert result['valid'] is False
        assert 'not found' in result['message'].lower()

    def test_get_env_config_snapshot_returns_expected_keys(self, monkeypatch):
        """Verify get_env_config_snapshot() returns a stable, complete snapshot."""
        from bridge_env import get_env_config_snapshot

        monkeypatch.setenv('SYSTEM_ROOT_DIRECTORY', '/tmp/system')
        monkeypatch.setenv('DATA_ROOT_DIRECTORY', '/tmp/data')
        monkeypatch.setenv('CACHE_ROOT_DIRECTORY', '/tmp/cache')
        monkeypatch.setenv('CACHING', 'true')
        monkeypatch.setenv('CACHE_BACKEND', 'fs')
        monkeypatch.setenv('ONTOLOGY_FILE_PATH', '/tmp/ontology.ttl')
        monkeypatch.setenv('ONTOLOGY_RESOLVER', 'rdflib')
        monkeypatch.setenv('MATCHING_STRATEGY', 'fuzzy')

        snapshot = get_env_config_snapshot()

        assert snapshot['SYSTEM_ROOT_DIRECTORY'] == '/tmp/system'
        assert snapshot['DATA_ROOT_DIRECTORY'] == '/tmp/data'
        assert snapshot['CACHE_ROOT_DIRECTORY'] == '/tmp/cache'
        assert snapshot['CACHING'] == 'true'
        assert snapshot['CACHE_BACKEND'] == 'fs'
        assert snapshot['ONTOLOGY_FILE_PATH'] == '/tmp/ontology.ttl'
        assert snapshot['ONTOLOGY_RESOLVER'] == 'rdflib'
        assert snapshot['MATCHING_STRATEGY'] == 'fuzzy'


class TestOntologyConfigError:
    """Tests for OntologyConfigError exception class."""

    def test_exception_message(self):
        """Verify OntologyConfigError can be raised with a message."""
        from bridge_env import OntologyConfigError

        with pytest.raises(OntologyConfigError) as exc_info:
            raise OntologyConfigError("Test error message")

        assert "Test error message" in str(exc_info.value)

    def test_exception_is_base_exception(self):
        """Verify OntologyConfigError inherits from Exception."""
        from bridge_env import OntologyConfigError

        assert issubclass(OntologyConfigError, Exception)
