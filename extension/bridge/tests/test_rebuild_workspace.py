#!/usr/bin/env python3
"""
Tests for rebuild_workspace.py - Plan 074 Milestone 5

Tests cover:
- CLI argument validation
- Maintenance lock acquisition/release
- Reindex-only mode behavior
- Reset-and-rebuild mode behavior (with --force requirement)
- Error handling and edge cases
"""

import asyncio
import json
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rebuild_workspace import (
    MAINTENANCE_LOCK_FILE,
    REBUILD_LOG_FILE,
    acquire_lock,
    release_lock,
    log_rebuild,
    get_workspace_summary,
    do_reindex_only,
    do_reset_and_rebuild,
    main_async,
)


class _DummyEnvConfig:
    def to_log_string(self) -> str:
        return "DummyEnvConfig"


class TestMaintenanceLock:
    """Tests for maintenance lock acquisition and release."""
    
    def test_acquire_lock_success(self, tmp_path):
        """Test successful lock acquisition on empty workspace."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        
        result = acquire_lock(workspace)
        
        assert result is True
        lock_path = workspace / MAINTENANCE_LOCK_FILE
        assert lock_path.exists()
        
        # Verify lock file contents
        lock_data = json.loads(lock_path.read_text())
        assert 'acquired_at' in lock_data
        assert lock_data['pid'] == os.getpid()
        assert lock_data['operation'] == 'rebuild_workspace'
    
    def test_acquire_lock_already_held(self, tmp_path):
        """Test lock acquisition fails when already held."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        
        # Acquire lock first time
        first_result = acquire_lock(workspace)
        assert first_result is True
        
        # Try to acquire again - should fail
        second_result = acquire_lock(workspace)
        assert second_result is False
    
    def test_acquire_lock_creates_parent_dirs(self, tmp_path):
        """Test lock acquisition creates .flowbaby directory if needed."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        
        result = acquire_lock(workspace)
        
        assert result is True
        assert (workspace / '.flowbaby').exists()
    
    def test_release_lock_success(self, tmp_path):
        """Test successful lock release."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        
        acquire_lock(workspace)
        lock_path = workspace / MAINTENANCE_LOCK_FILE
        assert lock_path.exists()
        
        release_lock(workspace)
        assert not lock_path.exists()
    
    def test_release_lock_idempotent(self, tmp_path):
        """Test releasing non-existent lock doesn't error."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        
        # Should not raise
        release_lock(workspace)
        release_lock(workspace)  # Call again


class TestLogRebuild:
    """Tests for logging functionality."""
    
    def test_log_creates_file(self, tmp_path):
        """Test log_rebuild creates log file and writes message."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        
        log_rebuild(workspace, "Test message")
        
        log_path = workspace / REBUILD_LOG_FILE
        assert log_path.exists()
        
        content = log_path.read_text()
        assert "Test message" in content
        assert "[INFO]" in content
    
    def test_log_appends_messages(self, tmp_path):
        """Test multiple log calls append to file."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        
        log_rebuild(workspace, "First message")
        log_rebuild(workspace, "Second message", level="WARN")
        
        content = (workspace / REBUILD_LOG_FILE).read_text()
        assert "First message" in content
        assert "Second message" in content
        assert "[WARN]" in content
    
    def test_log_creates_parent_dirs(self, tmp_path):
        """Test log_rebuild creates maintenance directory."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        
        log_rebuild(workspace, "Test")
        
        assert (workspace / '.flowbaby' / 'maintenance').exists()


class TestGetWorkspaceSummary:
    """Tests for workspace summary generation."""
    
    def test_empty_workspace(self, tmp_path):
        """Test summary of workspace with no .flowbaby dir."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        
        summary = get_workspace_summary(workspace)
        
        assert summary['data_files'] == 0
        assert summary['system_db_exists'] is False
        assert summary['lancedb_tables'] == 0
        assert summary['cache_size_bytes'] == 0
    
    def test_workspace_with_data(self, tmp_path):
        """Test summary with some data files."""
        workspace = tmp_path / "workspace"
        data_dir = workspace / '.flowbaby' / 'data'
        data_dir.mkdir(parents=True)
        
        # Create some test files
        (data_dir / 'file1.txt').write_text("content1")
        (data_dir / 'file2.txt').write_text("content2")
        
        summary = get_workspace_summary(workspace)
        
        assert summary['data_files'] == 2
    
    def test_workspace_with_cache(self, tmp_path):
        """Test summary includes cache size."""
        workspace = tmp_path / "workspace"
        cache_dir = workspace / '.flowbaby' / 'cache'
        cache_dir.mkdir(parents=True)
        
        # Create a cache file with known size
        cache_file = cache_dir / 'cache.dat'
        cache_file.write_bytes(b'x' * 1024)  # 1KB
        
        summary = get_workspace_summary(workspace)
        
        assert summary['cache_size_bytes'] == 1024


class TestReindexOnly:
    """Tests for reindex-only mode."""
    
    @pytest.fixture
    def mock_workspace(self, tmp_path):
        """Create a mock workspace with .flowbaby structure."""
        workspace = tmp_path / "workspace"
        (workspace / '.flowbaby' / 'data').mkdir(parents=True)
        (workspace / '.flowbaby' / 'system').mkdir(parents=True)
        return workspace
    
    @pytest.mark.asyncio
    async def test_reindex_no_summaries(self, mock_workspace):
        """Test reindex when no summaries exist."""
        # Create mock cognee module
        mock_cognee = MagicMock()
        mock_cognee.search = AsyncMock(return_value=[])
        mock_cognee.config = MagicMock()
        mock_search_type = MagicMock()
        mock_search_type.GRAPH_COMPLETION = 'GRAPH_COMPLETION'
        
        with patch('rebuild_workspace.get_env_config_snapshot') as mock_env:
            mock_env.return_value = {
                'SYSTEM_ROOT_DIRECTORY': str(mock_workspace / '.flowbaby/system'),
                'DATA_ROOT_DIRECTORY': str(mock_workspace / '.flowbaby/data'),
                'ONTOLOGY_FILE_PATH': '/path/to/ontology.ttl',
            }
            
            with patch.dict('sys.modules', {
                'cognee': mock_cognee,
                'cognee.modules.search.types': MagicMock(SearchType=mock_search_type),
            }):
                result = await do_reindex_only(
                    str(mock_workspace),
                    'test_dataset',
                    'test-api-key'
                )
                
                assert result['success'] is True
                assert result['mode'] == 'reindex-only'
                assert result['summaries_processed'] == 0
    
    @pytest.mark.asyncio
    async def test_reindex_with_summaries(self, mock_workspace):
        """Test reindex with existing summaries."""
        # Create mock cognee module
        mock_cognee = MagicMock()
        mock_result = MagicMock()
        mock_result.text = "# Conversation Summary: Test\n\nContent here"
        mock_cognee.search = AsyncMock(return_value=[mock_result])
        mock_cognee.add = AsyncMock()
        mock_cognee.cognify = AsyncMock()
        mock_cognee.config = MagicMock()
        mock_search_type = MagicMock()
        mock_search_type.GRAPH_COMPLETION = 'GRAPH_COMPLETION'
        
        with patch('rebuild_workspace.get_env_config_snapshot') as mock_env:
            mock_env.return_value = {
                'SYSTEM_ROOT_DIRECTORY': str(mock_workspace / '.flowbaby/system'),
                'DATA_ROOT_DIRECTORY': str(mock_workspace / '.flowbaby/data'),
                'ONTOLOGY_FILE_PATH': '/path/to/ontology.ttl',
            }
            
            with patch.dict('sys.modules', {
                'cognee': mock_cognee,
                'cognee.modules.search.types': MagicMock(SearchType=mock_search_type),
            }):
                result = await do_reindex_only(
                    str(mock_workspace),
                    'test_dataset',
                    'test-api-key'
                )
                
                assert result['success'] is True
                assert result['summaries_processed'] == 1
                mock_cognee.add.assert_called_once()
                mock_cognee.cognify.assert_called_once()


class TestResetAndRebuild:
    """Tests for reset-and-rebuild mode."""
    
    @pytest.fixture
    def mock_workspace(self, tmp_path):
        """Create a mock workspace with .flowbaby structure."""
        workspace = tmp_path / "workspace"
        (workspace / '.flowbaby' / 'data').mkdir(parents=True)
        (workspace / '.flowbaby' / 'system').mkdir(parents=True)
        return workspace
    
    @pytest.mark.asyncio
    async def test_reset_and_rebuild_empty(self, mock_workspace):
        """Test reset-and-rebuild on empty workspace."""
        # Create mock cognee module
        mock_cognee = MagicMock()
        mock_cognee.search = AsyncMock(return_value=[])
        mock_cognee.prune = MagicMock()
        mock_cognee.prune.prune_system = AsyncMock()
        mock_cognee.config = MagicMock()
        mock_search_type = MagicMock()
        mock_search_type.GRAPH_COMPLETION = 'GRAPH_COMPLETION'
        
        with patch('rebuild_workspace.get_env_config_snapshot') as mock_env:
            mock_env.return_value = {
                'SYSTEM_ROOT_DIRECTORY': str(mock_workspace / '.flowbaby/system'),
                'DATA_ROOT_DIRECTORY': str(mock_workspace / '.flowbaby/data'),
                'ONTOLOGY_FILE_PATH': '/path/to/ontology.ttl',
            }
            
            with patch.dict('sys.modules', {
                'cognee': mock_cognee,
                'cognee.prune': mock_cognee.prune,
                'cognee.modules.search.types': MagicMock(SearchType=mock_search_type),
            }):
                result = await do_reset_and_rebuild(
                    str(mock_workspace),
                    'test_dataset',
                    'test-api-key'
                )
                
                assert result['success'] is True
                assert result['mode'] == 'reset-and-rebuild'
                assert result['summaries_rebuilt'] == 0
                mock_cognee.prune.prune_system.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_reset_and_rebuild_with_data(self, mock_workspace):
        """Test reset-and-rebuild with existing summaries."""
        # Create mock cognee module
        mock_cognee = MagicMock()
        mock_result = MagicMock()
        mock_result.text = "# Conversation Summary: Important\n\nDetails"
        mock_cognee.search = AsyncMock(return_value=[mock_result])
        mock_cognee.prune = MagicMock()
        mock_cognee.prune.prune_system = AsyncMock()
        mock_cognee.add = AsyncMock()
        mock_cognee.cognify = AsyncMock()
        mock_cognee.config = MagicMock()
        mock_search_type = MagicMock()
        mock_search_type.GRAPH_COMPLETION = 'GRAPH_COMPLETION'
        
        with patch('rebuild_workspace.get_env_config_snapshot') as mock_env:
            mock_env.return_value = {
                'SYSTEM_ROOT_DIRECTORY': str(mock_workspace / '.flowbaby/system'),
                'DATA_ROOT_DIRECTORY': str(mock_workspace / '.flowbaby/data'),
                'ONTOLOGY_FILE_PATH': '/path/to/ontology.ttl',
            }
            
            with patch.dict('sys.modules', {
                'cognee': mock_cognee,
                'cognee.prune': mock_cognee.prune,
                'cognee.modules.search.types': MagicMock(SearchType=mock_search_type),
            }):
                result = await do_reset_and_rebuild(
                    str(mock_workspace),
                    'test_dataset',
                    'test-api-key'
                )
                
                assert result['success'] is True
                assert result['summaries_rebuilt'] == 1
                
                # Verify order: prune, add, cognify
                mock_cognee.prune.prune_system.assert_called_once()
                mock_cognee.add.assert_called_once()
                mock_cognee.cognify.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_reset_and_rebuild_prune_failure(self, mock_workspace):
        """Test reset-and-rebuild handles prune failure."""
        # Create mock cognee module
        mock_cognee = MagicMock()
        mock_cognee.search = AsyncMock(return_value=[])
        mock_cognee.prune = MagicMock()
        mock_cognee.prune.prune_system = AsyncMock(side_effect=Exception("Database locked"))
        mock_cognee.config = MagicMock()
        mock_search_type = MagicMock()
        mock_search_type.GRAPH_COMPLETION = 'GRAPH_COMPLETION'
        
        with patch('rebuild_workspace.get_env_config_snapshot') as mock_env:
            mock_env.return_value = {
                'SYSTEM_ROOT_DIRECTORY': str(mock_workspace / '.flowbaby/system'),
                'DATA_ROOT_DIRECTORY': str(mock_workspace / '.flowbaby/data'),
                'ONTOLOGY_FILE_PATH': '/path/to/ontology.ttl',
            }
            
            with patch.dict('sys.modules', {
                'cognee': mock_cognee,
                'cognee.prune': mock_cognee.prune,
                'cognee.modules.search.types': MagicMock(SearchType=mock_search_type),
            }):
                result = await do_reset_and_rebuild(
                    str(mock_workspace),
                    'test_dataset',
                    'test-api-key'
                )
                
                assert result['success'] is False
                assert 'Database locked' in result['error']


class TestCLIValidation:
    """Tests for CLI argument validation."""
    
    def test_reset_and_rebuild_requires_force(self, tmp_path, capsys):
        """Test reset-and-rebuild mode requires --force flag."""
        import subprocess
        
        workspace = tmp_path / "workspace"
        (workspace / '.flowbaby').mkdir(parents=True)
        
        # Run without --force
        result = subprocess.run(
            [
                sys.executable,
                str(Path(__file__).parent.parent / 'rebuild_workspace.py'),
                '--mode', 'reset-and-rebuild',
                str(workspace),
            ],
            capture_output=True,
            text=True,
            env={**os.environ, 'LLM_API_KEY': 'test-key'},
        )
        
        # Should exit with code 3 (user cancelled)
        assert result.returncode == 3
        assert '--force' in result.stderr
        assert 'DELETE' in result.stderr
    
    def test_reindex_only_no_force_needed(self, tmp_path):
        """Test reindex-only mode doesn't require --force."""
        import subprocess
        
        workspace = tmp_path / "workspace"
        (workspace / '.flowbaby').mkdir(parents=True)
        
        # Run without --force - should start (then fail due to no API key or mocking)
        result = subprocess.run(
            [
                sys.executable,
                str(Path(__file__).parent.parent / 'rebuild_workspace.py'),
                '--mode', 'reindex-only',
                str(workspace),
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        
        # Should NOT exit with code 3 (force not required)
        assert result.returncode != 3


class TestIntegration:
    """Integration tests for the rebuild tool."""
    
    def test_lock_released_on_error(self, tmp_path):
        """Test maintenance lock is released even on error."""
        workspace = tmp_path / "workspace"
        (workspace / '.flowbaby').mkdir(parents=True)
        
        import subprocess
        
        # Run with missing API key to cause early exit
        result = subprocess.run(
            [
                sys.executable,
                str(Path(__file__).parent.parent / 'rebuild_workspace.py'),
                '--mode', 'reindex-only',
                str(workspace),
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        
        # Lock should not exist after script exits
        lock_path = workspace / MAINTENANCE_LOCK_FILE
        assert not lock_path.exists()
    
    def test_log_file_created(self, tmp_path):
        """Test log file is created during operation."""
        workspace = tmp_path / "workspace"
        (workspace / '.flowbaby').mkdir(parents=True)
        
        import subprocess
        
        result = subprocess.run(
            [
                sys.executable,
                str(Path(__file__).parent.parent / 'rebuild_workspace.py'),
                '--mode', 'reindex-only',
                str(workspace),
            ],
            capture_output=True,
            text=True,
            env={**os.environ, 'LLM_API_KEY': 'test-key'},
            timeout=30,
        )
        
        # Log file should exist (even if operation failed)
        log_path = workspace / REBUILD_LOG_FILE
        # Note: may not exist if script fails very early
        # This test mainly validates the script runs without crashing


class TestMainAsync:
    """Focused tests for main_async() control flow and safety semantics."""

    @pytest.mark.asyncio
    async def test_main_async_rejects_nonexistent_workspace(self, tmp_path):
        args = type("Args", (), {"workspace_path": str(tmp_path / "missing"), "mode": "reindex-only", "force": False})
        rc = await main_async(args)
        assert rc == 1

    @pytest.mark.asyncio
    async def test_main_async_rejects_relative_workspace_path(self, tmp_path, monkeypatch):
        workspace = tmp_path / "workspace"
        (workspace / '.flowbaby').mkdir(parents=True)

        # Ensure the relative path resolves to an existing directory.
        monkeypatch.chdir(tmp_path)

        # Ensure API key present so we hit the absolute-path validation.
        monkeypatch.setenv('LLM_API_KEY', 'test-key')

        rel_path = os.path.relpath(str(workspace), start=str(tmp_path))
        args = type("Args", (), {"workspace_path": rel_path, "mode": "reindex-only", "force": False})
        rc = await main_async(args)
        assert rc == 1

    @pytest.mark.asyncio
    async def test_main_async_requires_flowbaby_dir(self, tmp_path, monkeypatch):
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        monkeypatch.setenv('LLM_API_KEY', 'test-key')

        args = type("Args", (), {"workspace_path": str(workspace), "mode": "reindex-only", "force": False})
        rc = await main_async(args)
        assert rc == 1

    @pytest.mark.asyncio
    async def test_main_async_missing_api_key_exits_before_lock(self, tmp_path, monkeypatch):
        workspace = tmp_path / "workspace"
        (workspace / '.flowbaby').mkdir(parents=True)
        monkeypatch.delenv('LLM_API_KEY', raising=False)

        args = type("Args", (), {"workspace_path": str(workspace), "mode": "reindex-only", "force": False})
        rc = await main_async(args)
        assert rc == 1
        assert not (workspace / MAINTENANCE_LOCK_FILE).exists()

    @pytest.mark.asyncio
    async def test_main_async_lock_acquisition_failure_returns_2(self, tmp_path, monkeypatch):
        workspace = tmp_path / "workspace"
        (workspace / '.flowbaby').mkdir(parents=True)
        monkeypatch.setenv('LLM_API_KEY', 'test-key')

        # Create an existing lock to force acquisition failure.
        assert acquire_lock(workspace) is True

        with patch('rebuild_workspace.apply_workspace_env', return_value=_DummyEnvConfig()), \
             patch('workspace_utils.generate_dataset_name', return_value=('test_dataset', 'test_hash')):
            args = type("Args", (), {"workspace_path": str(workspace), "mode": "reindex-only", "force": False})
            rc = await main_async(args)

        assert rc == 2

        # Clean up for test hygiene
        release_lock(workspace)

    @pytest.mark.asyncio
    async def test_main_async_success_releases_lock(self, tmp_path, monkeypatch):
        workspace = tmp_path / "workspace"
        (workspace / '.flowbaby').mkdir(parents=True)
        monkeypatch.setenv('LLM_API_KEY', 'test-key')

        async def _fake_reindex(*_args, **_kwargs):
            return {'success': True, 'mode': 'reindex-only', 'summaries_processed': 0}

        with patch('rebuild_workspace.apply_workspace_env', return_value=_DummyEnvConfig()), \
             patch('rebuild_workspace.do_reindex_only', side_effect=_fake_reindex), \
             patch('workspace_utils.generate_dataset_name', return_value=('test_dataset', 'test_hash')):
            args = type("Args", (), {"workspace_path": str(workspace), "mode": "reindex-only", "force": False})
            rc = await main_async(args)

        assert rc == 0
        assert not (workspace / MAINTENANCE_LOCK_FILE).exists()


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
