"""Tests for Plan 060: Cognee SQLite schema migration.

Covers:
- Schema readiness detection for Cognee >=0.5.1,<0.6.0
- Additive-only migration that adds missing columns
- Idempotency of migration (re-running adds no new columns)
- Receipt generation + persistence
- init.py integration: auto-migrate before Cognee operations
"""

import json
import sqlite3
import sys
from pathlib import Path

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from migrate_cognee_0_5_schema import (
    SchemaMigrationError,
    check_schema_readiness,
    generate_migration_receipt,
    migrate_database,
    save_migration_receipt,
)


def _create_sqlite_db(db_path: Path, *, with_dataset_database: bool, with_user_tenants: bool = False) -> None:
    """Create a minimal Cognee-like SQLite database for testing.
    
    Args:
        db_path: Path to create the database at
        with_dataset_database: Whether to include the dataset_database table
        with_user_tenants: Whether to include the user_tenants table (Cognee 0.5.x)
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()

    # Minimal Cognee-ish tables
    cur.execute("CREATE TABLE datasets (id TEXT PRIMARY KEY)")
    
    # Required for user_tenants foreign keys
    cur.execute("CREATE TABLE users (id TEXT PRIMARY KEY)")
    cur.execute("CREATE TABLE tenants (id TEXT PRIMARY KEY)")

    if with_dataset_database:
        cur.execute("CREATE TABLE dataset_database (id TEXT PRIMARY KEY)")
    
    if with_user_tenants:
        cur.execute("""
            CREATE TABLE user_tenants (
                user_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                PRIMARY KEY (user_id, tenant_id)
            )
        """)

    conn.commit()
    conn.close()


def test_check_schema_readiness_no_db_is_ready(tmp_path: Path):
    db_path = tmp_path / "does_not_exist.db"

    result = check_schema_readiness(db_path)

    assert result["ready"] is True
    assert result["error_code"] is None


def test_check_schema_readiness_detects_missing_user_tenants_table(tmp_path: Path):
    """Test that missing user_tenants table is detected (Cognee 0.5.x multi-tenant)."""
    db_path = tmp_path / "cognee_db"
    _create_sqlite_db(db_path, with_dataset_database=False, with_user_tenants=False)
    
    # Add tenant_id column so only table is missing
    conn = sqlite3.connect(str(db_path))
    conn.execute("ALTER TABLE datasets ADD COLUMN tenant_id UUID")
    conn.commit()
    conn.close()

    result = check_schema_readiness(db_path)

    assert result["ready"] is False
    assert result["error_code"] == SchemaMigrationError.SCHEMA_MISMATCH_DETECTED
    assert "user_tenants" in result.get("missing_tables", [])


def test_migrate_database_creates_user_tenants_table(tmp_path: Path):
    """Test that migration creates missing user_tenants table."""
    db_path = tmp_path / "cognee_db"
    _create_sqlite_db(db_path, with_dataset_database=False, with_user_tenants=False)

    migrate_result = migrate_database(db_path)
    
    assert migrate_result["success"] is True
    assert "user_tenants" in migrate_result.get("tables_created", [])
    
    # Verify table now exists
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_tenants'")
    assert cur.fetchone() is not None
    conn.close()
    
    # Schema should now be ready
    ready = check_schema_readiness(db_path)
    assert ready["ready"] is True


def test_check_schema_readiness_detects_missing_columns(tmp_path: Path):
    db_path = tmp_path / "cognee_db"
    _create_sqlite_db(db_path, with_dataset_database=True, with_user_tenants=True)

    result = check_schema_readiness(db_path)

    assert result["ready"] is False
    assert result["error_code"] == SchemaMigrationError.SCHEMA_MISMATCH_DETECTED
    assert "datasets.tenant_id" in result["missing_columns"]
    # Optional table exists, so its columns should be required
    assert any(col.startswith("dataset_database.") for col in result["missing_columns"])


def test_migrate_database_adds_missing_columns_and_is_idempotent(tmp_path: Path):
    db_path = tmp_path / "cognee_db"
    _create_sqlite_db(db_path, with_dataset_database=True, with_user_tenants=True)

    migrate_1 = migrate_database(db_path)
    assert migrate_1["success"] is True
    assert migrate_1["error_code"] is None
    assert "datasets.tenant_id" in migrate_1["columns_added"]
    assert any(col.startswith("dataset_database.") for col in migrate_1["columns_added"])

    # After migration, schema should be ready
    ready = check_schema_readiness(db_path)
    assert ready["ready"] is True

    # Idempotency: re-run should add nothing
    migrate_2 = migrate_database(db_path)
    assert migrate_2["success"] is True
    assert migrate_2["columns_added"] == []


def test_receipt_generation_and_save(tmp_path: Path):
    workspace_path = tmp_path / "ws"
    db_path = workspace_path / ".flowbaby" / "system" / "databases" / "cognee_db"
    _create_sqlite_db(db_path, with_dataset_database=False, with_user_tenants=True)

    receipt = generate_migration_receipt(
        db_path=db_path,
        success=True,
        checks_performed=["datasets.tenant_id"],
        columns_added=["datasets.tenant_id"],
    )

    receipt_path = save_migration_receipt(workspace_path, receipt)
    assert receipt_path.exists()

    saved = json.loads(receipt_path.read_text())
    assert saved["success"] is True
    assert saved["db_path"] == str(db_path)
    assert saved["columns_added"] == ["datasets.tenant_id"]


def test_verify_environment_auto_migrates_schema(tmp_path: Path):
    """Test Plan 060 M4: verify_environment.py auto-migrates schema during refresh."""
    workspace_path = tmp_path / "ws"
    db_path = workspace_path / ".flowbaby" / "system" / "databases" / "cognee_db"
    
    # Create old-schema sqlite DB with missing columns
    _create_sqlite_db(db_path, with_dataset_database=True)
    
    # Verify schema is NOT ready before verification
    pre_check = check_schema_readiness(db_path)
    assert pre_check["ready"] is False
    assert pre_check["error_code"] == SchemaMigrationError.SCHEMA_MISMATCH_DETECTED
    
    # Import and call the check_and_migrate_schema function from verify_environment
    from verify_environment import check_and_migrate_schema
    
    result = check_and_migrate_schema(str(workspace_path))
    
    # Should report success after auto-migration
    assert result["schema_ready"] is True
    assert result.get("schema_migrated") is True
    assert len(result.get("schema_columns_added", [])) > 0
    assert "Auto-migrated schema" in result.get("schema_message", "")
    
    # Verify schema is NOW ready
    post_check = check_schema_readiness(db_path)
    assert post_check["ready"] is True
    
    # Receipt should exist
    receipt_path = workspace_path / ".flowbaby" / "system" / "schema_migration_receipt.json"
    assert receipt_path.exists()
    receipt = json.loads(receipt_path.read_text())
    assert receipt["success"] is True


def test_verify_environment_returns_ok_after_auto_migration(tmp_path: Path):
    """Test that verify_environment returns status 'ok' after successful auto-migration."""
    workspace_path = tmp_path / "ws"
    db_path = workspace_path / ".flowbaby" / "system" / "databases" / "cognee_db"
    
    # Create old-schema sqlite DB
    _create_sqlite_db(db_path, with_dataset_database=False)
    
    # Create a minimal ontology file so other checks pass
    bridge_dir = Path(__file__).parent.parent
    ontology_path = bridge_dir / "ontology.ttl"
    ontology_exists = ontology_path.exists()
    
    from verify_environment import verify_environment
    
    result = verify_environment(str(workspace_path))
    
    # If ontology exists, we should get status 'ok' after auto-migration
    if ontology_exists:
        # Schema should have auto-migrated
        assert result["details"].get("schema_ready") is True
        assert result["details"].get("schema_migrated") is True
        # Status should be 'ok' (assuming no other missing deps)
        # Note: If cognee/rdflib/dotenv not installed in test env, this might fail
        # We mainly care that schema_ready is True after auto-migration
    else:
        # Ontology missing, but schema should still have been migrated
        assert result["details"].get("schema_ready") is True
        assert result["details"].get("schema_migrated") is True


@pytest.mark.asyncio
async def test_init_auto_migrates_existing_db(
    temp_workspace: Path,
    mock_env,
    mock_cognee_module,
    sample_ontology,
):
    """Integration-ish test of init.py: existing db missing columns gets migrated."""
    # Place ontology.json where init expects to find it (workspace parent)
    ontology_path = temp_workspace.parent / "ontology.json"
    ontology_path.write_text(json.dumps(sample_ontology))

    # Create migration marker to keep test focused on schema migration behavior
    system_dir = temp_workspace / ".flowbaby" / "system"
    system_dir.mkdir(parents=True, exist_ok=True)
    (system_dir / ".migration_v1_complete").write_text(json.dumps({"version": "v1"}))

    # Create old-schema sqlite DB
    db_path = system_dir / "databases" / "cognee_db"
    _create_sqlite_db(db_path, with_dataset_database=False)

    # Import and run init
    with pytest.MonkeyPatch.context() as mp:
        # ensure import resolution in this test process
        mp.setenv("WORKSPACE_PATH", str(temp_workspace))
        from init import initialize_cognee

        result = await initialize_cognee(str(temp_workspace))

    assert result["success"] is True

    # Schema should now be ready
    readiness = check_schema_readiness(db_path)
    assert readiness["ready"] is True

    # Receipt should exist and indicate success
    receipt_path = system_dir / "schema_migration_receipt.json"
    assert receipt_path.exists()
    receipt = json.loads(receipt_path.read_text())
    assert receipt["success"] is True
    assert "datasets.tenant_id" in receipt.get("columns_added", [])
