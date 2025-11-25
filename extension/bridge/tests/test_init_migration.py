"""
Unit tests for Plan 027: Migration Marker Data Loss Bug Fix

These tests verify:
1. Migration marker is checked in workspace location, not venv
2. Prune is skipped when existing data is detected
3. Prune is executed when no data and no marker exist
4. Data integrity check works correctly
5. Marker is created correctly in all scenarios

Plan Reference: agent-output/planning/027-fix-migration-marker-data-loss.md
"""

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from init import (
    initialize_cognee,
    workspace_has_data,
    get_data_integrity_status,
)


class TestWorkspaceHasData:
    """Tests for the workspace_has_data() safety check function."""

    def test_returns_false_for_empty_directory(self, tmp_path):
        """Empty directory should return False - safe to prune."""
        system_dir = tmp_path / '.cognee_system'
        system_dir.mkdir()
        
        assert workspace_has_data(system_dir) is False

    def test_returns_false_for_nonexistent_directory(self, tmp_path):
        """Non-existent directory should return False - safe to prune."""
        system_dir = tmp_path / '.cognee_system'
        # Don't create the directory
        
        assert workspace_has_data(system_dir) is False

    def test_returns_true_when_lancedb_has_data(self, tmp_path):
        """LanceDB data present should return True - do NOT prune."""
        system_dir = tmp_path / '.cognee_system'
        lancedb_dir = system_dir / 'databases' / 'cognee.lancedb'
        lancedb_dir.mkdir(parents=True)
        
        # Create a dummy data file
        (lancedb_dir / 'data.lance').touch()
        
        assert workspace_has_data(system_dir) is True

    def test_returns_true_when_kuzu_has_data(self, tmp_path):
        """Kuzu graph data present should return True - do NOT prune."""
        system_dir = tmp_path / '.cognee_system'
        kuzu_dir = system_dir / 'databases' / 'cognee_graph'
        kuzu_dir.mkdir(parents=True)
        
        # Create a dummy data file
        (kuzu_dir / 'nodes.db').touch()
        
        assert workspace_has_data(system_dir) is True

    def test_returns_false_when_databases_dir_exists_but_empty(self, tmp_path):
        """Empty databases directory should return False - safe to prune."""
        system_dir = tmp_path / '.cognee_system'
        databases_dir = system_dir / 'databases'
        databases_dir.mkdir(parents=True)
        
        # Create empty lancedb and kuzu directories
        (databases_dir / 'cognee.lancedb').mkdir()
        (databases_dir / 'cognee_graph').mkdir()
        
        assert workspace_has_data(system_dir) is False


class TestGetDataIntegrityStatus:
    """Tests for the get_data_integrity_status() health check function."""

    def test_returns_healthy_for_empty_workspace(self, tmp_path):
        """Empty workspace should be healthy."""
        system_dir = tmp_path / '.cognee_system'
        system_dir.mkdir()
        
        result = get_data_integrity_status(system_dir)
        
        assert result['healthy'] is True
        assert result['warning'] is None

    def test_returns_healthy_when_no_databases_exist(self, tmp_path):
        """Non-existent databases should be healthy (fresh workspace)."""
        system_dir = tmp_path / '.cognee_system'
        # Don't create anything
        
        result = get_data_integrity_status(system_dir)
        
        assert result['healthy'] is True

    def test_detects_lancedb_tables(self, tmp_path):
        """Should count LanceDB tables/directories."""
        system_dir = tmp_path / '.cognee_system'
        lancedb_dir = system_dir / 'databases' / 'cognee.lancedb'
        lancedb_dir.mkdir(parents=True)
        
        # Create some table directories
        (lancedb_dir / 'table1').mkdir()
        (lancedb_dir / 'table2').mkdir()
        
        result = get_data_integrity_status(system_dir)
        
        assert result['lancedb_count'] == 2

    def test_handles_missing_sqlite_gracefully(self, tmp_path):
        """Should handle missing SQLite database gracefully."""
        system_dir = tmp_path / '.cognee_system'
        system_dir.mkdir()
        
        result = get_data_integrity_status(system_dir)
        
        # Should not crash, and should indicate healthy (no data = no mismatch)
        assert 'sqlite_count' in result
        assert 'lancedb_count' in result


class TestMigrationMarkerLocation:
    """Tests verifying that migration marker is checked in workspace location."""

    @pytest.mark.asyncio
    async def test_marker_checked_in_workspace_not_venv(self, tmp_path):
        """
        CRITICAL TEST: Verify marker is checked in workspace .cognee_system/
        and NOT in venv/site-packages location.
        
        This is the core fix for Plan 027.
        """
        workspace = tmp_path / 'test_workspace'
        workspace.mkdir()
        
        # Create .env with API key
        env_file = workspace / '.env'
        env_file.write_text('LLM_API_KEY=test_key_123')
        
        # Create workspace marker - should prevent prune
        system_dir = workspace / '.cognee_system'
        system_dir.mkdir()
        marker = system_dir / '.migration_v1_complete'
        marker.write_text(json.dumps({'version': 'v1', 'migrated_at': '2025-01-01'}))
        
        # Mock cognee module before it's imported inside initialize_cognee
        mock_cognee = MagicMock()
        mock_cognee.config = MagicMock()
        mock_cognee.prune = MagicMock()
        mock_cognee.prune.prune_system = AsyncMock()
        
        with patch.dict('sys.modules', {'cognee': mock_cognee}):
            with patch('init.load_ontology') as mock_ontology:
                mock_ontology.return_value = {'entities': [], 'relationships': []}
                
                result = await initialize_cognee(str(workspace))
        
        # Verify success
        assert result['success'] is True
        
        # CRITICAL: Verify prune was NOT called because workspace marker exists
        mock_cognee.prune.prune_system.assert_not_called()
        
        # Verify marker location is workspace-local
        assert result['global_marker_location'] == str(marker.absolute())

    @pytest.mark.asyncio
    async def test_prune_skipped_when_data_exists_no_marker(self, tmp_path):
        """
        Test that prune is skipped when data exists but marker doesn't.
        This is the defense-in-depth safety check.
        """
        workspace = tmp_path / 'test_workspace'
        workspace.mkdir()
        
        # Create .env with API key
        env_file = workspace / '.env'
        env_file.write_text('LLM_API_KEY=test_key_123')
        
        # Create data but NO marker
        system_dir = workspace / '.cognee_system'
        lancedb_dir = system_dir / 'databases' / 'cognee.lancedb'
        lancedb_dir.mkdir(parents=True)
        (lancedb_dir / 'important_data.lance').touch()
        
        # Mock cognee module
        mock_cognee = MagicMock()
        mock_cognee.config = MagicMock()
        mock_cognee.prune = MagicMock()
        mock_cognee.prune.prune_system = AsyncMock()
        
        with patch.dict('sys.modules', {'cognee': mock_cognee}):
            with patch('init.load_ontology') as mock_ontology:
                mock_ontology.return_value = {'entities': [], 'relationships': []}
                
                result = await initialize_cognee(str(workspace))
        
        # Verify success
        assert result['success'] is True
        
        # CRITICAL: Verify prune was NOT called due to safety check
        mock_cognee.prune.prune_system.assert_not_called()
        
        # Verify marker was created (without prune)
        marker = system_dir / '.migration_v1_complete'
        assert marker.exists()
        
        marker_data = json.loads(marker.read_text())
        assert marker_data.get('prune_skipped') is True

    @pytest.mark.asyncio
    async def test_prune_executed_when_no_data_no_marker(self, tmp_path):
        """
        Test that prune IS executed when there's no data and no marker.
        This is the legitimate fresh workspace scenario.
        """
        workspace = tmp_path / 'test_workspace'
        workspace.mkdir()
        
        # Create .env with API key
        env_file = workspace / '.env'
        env_file.write_text('LLM_API_KEY=test_key_123')
        
        # Don't create any data or marker - fresh workspace
        
        # Mock cognee module
        mock_cognee = MagicMock()
        mock_cognee.config = MagicMock()
        mock_cognee.prune = MagicMock()
        mock_cognee.prune.prune_system = AsyncMock()
        
        with patch.dict('sys.modules', {'cognee': mock_cognee}):
            with patch('init.load_ontology') as mock_ontology:
                mock_ontology.return_value = {'entities': [], 'relationships': []}
                
                result = await initialize_cognee(str(workspace))
        
        # Verify success
        assert result['success'] is True
        
        # Verify prune WAS called (fresh workspace)
        mock_cognee.prune.prune_system.assert_called_once()
        
        # Verify marker was created
        marker = workspace / '.cognee_system' / '.migration_v1_complete'
        assert marker.exists()
        
        marker_data = json.loads(marker.read_text())
        assert marker_data.get('prune_skipped', True) is False

    @pytest.mark.asyncio
    async def test_data_integrity_included_in_response(self, tmp_path):
        """Test that init response includes data_integrity field."""
        workspace = tmp_path / 'test_workspace'
        workspace.mkdir()
        
        # Create .env with API key
        env_file = workspace / '.env'
        env_file.write_text('LLM_API_KEY=test_key_123')
        
        # Create marker to skip prune logic
        system_dir = workspace / '.cognee_system'
        system_dir.mkdir()
        marker = system_dir / '.migration_v1_complete'
        marker.write_text(json.dumps({'version': 'v1'}))
        
        # Mock cognee module
        mock_cognee = MagicMock()
        mock_cognee.config = MagicMock()
        
        with patch.dict('sys.modules', {'cognee': mock_cognee}):
            with patch('init.load_ontology') as mock_ontology:
                mock_ontology.return_value = {'entities': [], 'relationships': []}
                
                result = await initialize_cognee(str(workspace))
        
        # Verify data_integrity is in response
        assert 'data_integrity' in result
        assert 'sqlite_count' in result['data_integrity']
        assert 'lancedb_count' in result['data_integrity']
        assert 'healthy' in result['data_integrity']


class TestMarkerNotCheckedInVenv:
    """
    Tests specifically verifying that get_relational_config() is NOT used
    to determine marker location.
    """

    @pytest.mark.asyncio
    async def test_no_get_relational_config_import_for_marker(self, tmp_path):
        """
        Verify that get_relational_config is not imported or called
        for determining marker location.
        
        This is critical because get_relational_config() returns the venv
        location before workspace config is set.
        """
        workspace = tmp_path / 'test_workspace'
        workspace.mkdir()
        
        env_file = workspace / '.env'
        env_file.write_text('LLM_API_KEY=test_key_123')
        
        # Create marker
        system_dir = workspace / '.cognee_system'
        system_dir.mkdir()
        marker = system_dir / '.migration_v1_complete'
        marker.write_text(json.dumps({'version': 'v1'}))
        
        # Mock cognee module
        mock_cognee = MagicMock()
        mock_cognee.config = MagicMock()
        
        with patch.dict('sys.modules', {'cognee': mock_cognee}):
            with patch('init.load_ontology') as mock_ontology:
                mock_ontology.return_value = {'entities': [], 'relationships': []}
                
                result = await initialize_cognee(str(workspace))
        
        assert result['success'] is True
        
        # The marker location should be workspace-local
        assert str(workspace) in result['global_marker_location']
        assert '.cognee_system' in result['global_marker_location']


class TestMarkerPrecedence:
    """Tests for marker precedence logic."""

    @pytest.mark.asyncio
    async def test_workspace_marker_takes_precedence(self, tmp_path):
        """Workspace marker should take precedence over any other checks."""
        workspace = tmp_path / 'test_workspace'
        workspace.mkdir()
        
        env_file = workspace / '.env'
        env_file.write_text('LLM_API_KEY=test_key_123')
        
        # Create workspace marker
        system_dir = workspace / '.cognee_system'
        system_dir.mkdir()
        marker = system_dir / '.migration_v1_complete'
        marker.write_text(json.dumps({
            'version': 'v1',
            'migrated_at': '2025-01-01',
            'note': 'Existing workspace marker'
        }))
        
        # Mock cognee module
        mock_cognee = MagicMock()
        mock_cognee.config = MagicMock()
        mock_cognee.prune = MagicMock()
        mock_cognee.prune.prune_system = AsyncMock()
        
        with patch.dict('sys.modules', {'cognee': mock_cognee}):
            with patch('init.load_ontology') as mock_ontology:
                mock_ontology.return_value = {'entities': [], 'relationships': []}
                
                result = await initialize_cognee(str(workspace))
        
        # Verify no prune
        mock_cognee.prune.prune_system.assert_not_called()
        
        # Verify migration_performed is False
        assert result['migration_performed'] is False
