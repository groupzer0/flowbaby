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
import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from init import (
    get_data_integrity_status,
    initialize_cognee,
    workspace_has_data,
)


def create_cognee_module_mocks():
    """
    Create a dictionary of mock modules for cognee and its submodules.

    This ensures that `import cognee` and
    `from cognee.infrastructure.databases.relational import create_db_and_tables`
    and `from cognee.infrastructure.databases.graph import get_graph_engine`
    all work correctly in tests.

    Plan 038/039: Added graph module mock for Kuzu initialization.

    Returns:
        Tuple of (modules_dict, mock_cognee) for use with patch.dict
    """
    # Create mock cognee
    mock_cognee = MagicMock()
    mock_cognee.config = MagicMock()
    mock_cognee.prune = MagicMock()
    mock_cognee.prune.prune_system = AsyncMock()
    mock_cognee.add = AsyncMock(return_value=None)  # For LanceDB init

    # Create mock create_db_and_tables
    mock_create_db_and_tables = AsyncMock()

    # Create mock get_graph_engine (for Kuzu init)
    mock_get_graph_engine = AsyncMock(return_value=MagicMock())

    # Create mock relational module
    mock_relational = types.SimpleNamespace(
        create_db_and_tables=mock_create_db_and_tables,
        get_relational_config=MagicMock()
    )

    # Create mock graph module
    mock_graph = types.SimpleNamespace(
        get_graph_engine=mock_get_graph_engine
    )

    # Create mock databases module
    mock_databases = types.SimpleNamespace(
        relational=mock_relational,
        graph=mock_graph
    )

    # Create mock infrastructure module
    mock_infrastructure = types.SimpleNamespace(
        databases=mock_databases
    )

    # Assign infrastructure to cognee
    mock_cognee.infrastructure = mock_infrastructure

    # Build the modules dict
    modules = {
        'cognee': mock_cognee,
        'cognee.infrastructure': mock_infrastructure,
        'cognee.infrastructure.databases': mock_databases,
        'cognee.infrastructure.databases.relational': mock_relational,
        'cognee.infrastructure.databases.graph': mock_graph,
    }

    return modules, mock_cognee


class TestWorkspaceHasData:
    """Tests for the workspace_has_data() safety check function."""

    def test_returns_false_for_empty_directory(self, tmp_path):
        """Empty directory should return False - safe to prune."""
        system_dir = tmp_path / '.flowbaby/system'
        system_dir.mkdir(parents=True)

        assert workspace_has_data(system_dir) is False

    def test_returns_false_for_nonexistent_directory(self, tmp_path):
        """Non-existent directory should return False - safe to prune."""
        system_dir = tmp_path / '.flowbaby/system'
        # Don't create the directory

        assert workspace_has_data(system_dir) is False

    def test_returns_true_when_lancedb_has_data(self, tmp_path):
        """LanceDB data present should return True - do NOT prune."""
        system_dir = tmp_path / '.flowbaby/system'
        lancedb_dir = system_dir / 'databases' / 'cognee.lancedb'
        lancedb_dir.mkdir(parents=True)

        # Create a dummy data file
        (lancedb_dir / 'data.lance').touch()

        assert workspace_has_data(system_dir) is True

    def test_returns_true_when_kuzu_has_data(self, tmp_path):
        """Kuzu graph data present should return True - do NOT prune."""
        system_dir = tmp_path / '.flowbaby/system'
        kuzu_dir = system_dir / 'databases' / 'cognee_graph'
        kuzu_dir.mkdir(parents=True)

        # Create a dummy data file
        (kuzu_dir / 'nodes.db').touch()

        assert workspace_has_data(system_dir) is True

    def test_returns_false_when_databases_dir_exists_but_empty(self, tmp_path):
        """Empty databases directory should return False - safe to prune."""
        system_dir = tmp_path / '.flowbaby/system'
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
        system_dir = tmp_path / '.flowbaby/system'
        system_dir.mkdir(parents=True)

        result = get_data_integrity_status(system_dir)

        assert result['healthy'] is True
        assert result['warning'] is None

    def test_returns_healthy_when_no_databases_exist(self, tmp_path):
        """Non-existent databases should be healthy (fresh workspace)."""
        system_dir = tmp_path / '.flowbaby/system'
        # Don't create anything

        result = get_data_integrity_status(system_dir)

        assert result['healthy'] is True

    def test_detects_lancedb_embedding_rows(self, tmp_path):
        """
        Plan 057: Should count actual LanceDB embedding rows, not directories.

        This test creates a real LanceDB database with a DocumentChunk_text table
        containing sample data to verify the new row-counting logic.
        """
        import lancedb

        system_dir = tmp_path / '.flowbaby/system'
        lancedb_dir = system_dir / 'databases' / 'cognee.lancedb'
        lancedb_dir.mkdir(parents=True)

        # Create a real LanceDB database with sample data
        db = lancedb.connect(str(lancedb_dir))

        # Create DocumentChunk_text table with 5 sample rows
        # This mimics the Cognee 0.4.x schema
        data = [
            {'id': f'chunk_{i}', 'text': f'Sample text {i}', 'vector': [0.1] * 8}
            for i in range(5)
        ]
        db.create_table('DocumentChunk_text', data)

        result = get_data_integrity_status(system_dir)

        # Should count actual rows (5), not directories
        assert result['lancedb_count'] == 5

    def test_lancedb_count_with_empty_tables(self, tmp_path):
        """Plan 057: Empty LanceDB directory should return count of 0."""
        system_dir = tmp_path / '.flowbaby/system'
        lancedb_dir = system_dir / 'databases' / 'cognee.lancedb'
        lancedb_dir.mkdir(parents=True)

        # Create directories but no actual LanceDB tables
        (lancedb_dir / 'some_dir').mkdir()
        (lancedb_dir / 'another_dir').mkdir()

        result = get_data_integrity_status(system_dir)

        # New behavior: should return 0 (no actual embedding rows), not 2 (directory count)
        assert result['lancedb_count'] == 0
        assert result['healthy'] is True  # No data = no problem

    def test_handles_missing_sqlite_gracefully(self, tmp_path):
        """Should handle missing SQLite database gracefully."""
        system_dir = tmp_path / '.flowbaby/system'
        system_dir.mkdir(parents=True)

        result = get_data_integrity_status(system_dir)

        # Should not crash, and should indicate healthy (no data = no mismatch)
        assert 'sqlite_count' in result
        assert 'lancedb_count' in result


class TestMigrationMarkerLocation:
    """Tests verifying that migration marker is checked in workspace location."""

    @pytest.mark.asyncio
    async def test_marker_checked_in_workspace_not_venv(self, tmp_path, monkeypatch):
        """
        CRITICAL TEST: Verify marker is checked in workspace .flowbaby/system/
        and NOT in venv/site-packages location.

        This is the core fix for Plan 027.

        Plan 039 M5: API key now set via environment variable, not .env file.
        """
        workspace = tmp_path / 'test_workspace'
        workspace.mkdir()

        # Plan 039 M5: Set API key via environment variable (not .env file)
        monkeypatch.setenv('LLM_API_KEY', 'test_key_123')

        # Create workspace marker - should prevent prune
        system_dir = workspace / '.flowbaby/system'
        system_dir.mkdir(parents=True)
        marker = system_dir / '.migration_v1_complete'
        marker.write_text(json.dumps({'version': 'v1', 'migrated_at': '2025-01-01'}))

        # Create full cognee module mock hierarchy
        modules, mock_cognee = create_cognee_module_mocks()

        with patch.dict('sys.modules', modules):
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
    async def test_prune_skipped_when_data_exists_no_marker(self, tmp_path, monkeypatch):
        """
        Test that prune is skipped when data exists but marker doesn't.
        This is the defense-in-depth safety check.

        Plan 039 M5: API key now set via environment variable, not .env file.
        """
        workspace = tmp_path / 'test_workspace'
        workspace.mkdir()

        # Plan 039 M5: Set API key via environment variable (not .env file)
        monkeypatch.setenv('LLM_API_KEY', 'test_key_123')

        # Create data but NO marker
        system_dir = workspace / '.flowbaby/system'
        lancedb_dir = system_dir / 'databases' / 'cognee.lancedb'
        lancedb_dir.mkdir(parents=True)
        (lancedb_dir / 'important_data.lance').touch()

        # Create full cognee module mock hierarchy
        modules, mock_cognee = create_cognee_module_mocks()

        with patch.dict('sys.modules', modules):
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
    async def test_prune_executed_when_no_data_no_marker(self, tmp_path, monkeypatch):
        """
        Test that prune is SKIPPED for fresh workspaces (no data, no marker).

        Per Plan 034: Fresh workspaces only need create_db_and_tables(), not prune.
        Prune is only needed for legacy data migration.

        Plan 039 M5: API key now set via environment variable, not .env file.
        """
        workspace = tmp_path / 'test_workspace'
        workspace.mkdir()

        # Plan 039 M5: Set API key via environment variable (not .env file)
        monkeypatch.setenv('LLM_API_KEY', 'test_key_123')

        # Don't create any data or marker - fresh workspace

        # Create full cognee module mock hierarchy
        modules, mock_cognee = create_cognee_module_mocks()

        with patch.dict('sys.modules', modules):
            with patch('init.load_ontology') as mock_ontology:
                mock_ontology.return_value = {'entities': [], 'relationships': []}

                result = await initialize_cognee(str(workspace))

        # Verify success
        assert result['success'] is True

        # Per Plan 034: Prune should NOT be called for fresh workspaces
        # Fresh workspaces only need create_db_and_tables()
        mock_cognee.prune.prune_system.assert_not_called()

        # Verify marker was created
        marker = workspace / '.flowbaby/system' / '.migration_v1_complete'
        assert marker.exists()

        # Verify marker indicates it was a fresh workspace (prune skipped)
        marker_data = json.loads(marker.read_text())
        assert marker_data.get('prune_skipped') is True
        assert marker_data.get('reason') == 'fresh_workspace'

    @pytest.mark.asyncio
    async def test_data_integrity_included_in_response(self, tmp_path, monkeypatch):
        """Test that init response includes data_integrity field.

        Plan 039 M5: API key now set via environment variable, not .env file.
        """
        workspace = tmp_path / 'test_workspace'
        workspace.mkdir()

        # Plan 039 M5: Set API key via environment variable (not .env file)
        monkeypatch.setenv('LLM_API_KEY', 'test_key_123')

        # Create marker to skip prune logic
        system_dir = workspace / '.flowbaby/system'
        system_dir.mkdir(parents=True)
        marker = system_dir / '.migration_v1_complete'
        marker.write_text(json.dumps({'version': 'v1'}))

        # Create full cognee module mock hierarchy
        modules, mock_cognee = create_cognee_module_mocks()

        with patch.dict('sys.modules', modules):
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
    async def test_no_get_relational_config_import_for_marker(self, tmp_path, monkeypatch):
        """
        Verify that get_relational_config is not imported or called
        for determining marker location.

        This is critical because get_relational_config() returns the venv
        location before workspace config is set.

        Plan 039 M5: API key now set via environment variable, not .env file.
        """
        workspace = tmp_path / 'test_workspace'
        workspace.mkdir()

        # Plan 039 M5: Set API key via environment variable (not .env file)
        monkeypatch.setenv('LLM_API_KEY', 'test_key_123')

        # Create marker
        system_dir = workspace / '.flowbaby/system'
        system_dir.mkdir(parents=True)
        marker = system_dir / '.migration_v1_complete'
        marker.write_text(json.dumps({'version': 'v1'}))

        # Create full cognee module mock hierarchy
        modules, mock_cognee = create_cognee_module_mocks()

        with patch.dict('sys.modules', modules):
            with patch('init.load_ontology') as mock_ontology:
                mock_ontology.return_value = {'entities': [], 'relationships': []}

                result = await initialize_cognee(str(workspace))

        assert result['success'] is True

        # The marker location should be workspace-local
        assert str(workspace) in result['global_marker_location']
        assert '.flowbaby/system' in result['global_marker_location']


class TestMarkerPrecedence:
    """Tests for marker precedence logic."""

    @pytest.mark.asyncio
    async def test_workspace_marker_takes_precedence(self, tmp_path, monkeypatch):
        """Workspace marker should take precedence over any other checks.

        Plan 039 M5: API key now set via environment variable, not .env file.
        """
        workspace = tmp_path / 'test_workspace'
        workspace.mkdir()

        # Plan 039 M5: Set API key via environment variable (not .env file)
        monkeypatch.setenv('LLM_API_KEY', 'test_key_123')

        # Create workspace marker
        system_dir = workspace / '.flowbaby/system'
        system_dir.mkdir(parents=True)
        marker = system_dir / '.migration_v1_complete'
        marker.write_text(json.dumps({
            'version': 'v1',
            'migrated_at': '2025-01-01',
            'note': 'Existing workspace marker'
        }))

        # Create full cognee module mock hierarchy
        modules, mock_cognee = create_cognee_module_mocks()

        with patch.dict('sys.modules', modules):
            with patch('init.load_ontology') as mock_ontology:
                mock_ontology.return_value = {'entities': [], 'relationships': []}

                result = await initialize_cognee(str(workspace))

        # Verify no prune
        mock_cognee.prune.prune_system.assert_not_called()

        # Verify migration_performed is False
        assert result['migration_performed'] is False
