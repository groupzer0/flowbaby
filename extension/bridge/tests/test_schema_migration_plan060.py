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


def _create_sqlite_db(db_path: Path, *, with_dataset_database: bool) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()

    # Minimal Cognee-ish tables
    cur.execute("CREATE TABLE datasets (id TEXT PRIMARY KEY)")

    if with_dataset_database:
        cur.execute("CREATE TABLE dataset_database (id TEXT PRIMARY KEY)")

    conn.commit()
    conn.close()


def test_check_schema_readiness_no_db_is_ready(tmp_path: Path):
    db_path = tmp_path / "does_not_exist.db"

    result = check_schema_readiness(db_path)

    assert result["ready"] is True
    assert result["error_code"] is None


def test_check_schema_readiness_detects_missing_columns(tmp_path: Path):
    db_path = tmp_path / "cognee_db"
    _create_sqlite_db(db_path, with_dataset_database=True)

    result = check_schema_readiness(db_path)

    assert result["ready"] is False
    assert result["error_code"] == SchemaMigrationError.SCHEMA_MISMATCH_DETECTED
    assert "datasets.tenant_id" in result["missing_columns"]
    # Optional table exists, so its columns should be required
    assert any(col.startswith("dataset_database.") for col in result["missing_columns"])


def test_migrate_database_adds_missing_columns_and_is_idempotent(tmp_path: Path):
    db_path = tmp_path / "cognee_db"
    _create_sqlite_db(db_path, with_dataset_database=True)

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
    _create_sqlite_db(db_path, with_dataset_database=False)

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
