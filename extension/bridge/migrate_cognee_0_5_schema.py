#!/usr/bin/env python3
"""
Cognee 0.5.x Schema Migration Script

This script migrates SQLite databases created by Cognee 0.4.x to be compatible
with Cognee 0.5.x multi-tenant schema requirements.

Background:
- Cognee 0.5.0+ introduced multi-tenant support with new schema requirements
- Existing databases created with 0.4.x lack required columns:
  - datasets.tenant_id
  - dataset_database.* (multiple provider/handler columns)
- This script adds the missing columns without data loss

Usage:
    python migrate_cognee_0_5_schema.py /path/to/workspace
    python migrate_cognee_0_5_schema.py /path/to/workspace --dry-run

The script is idempotent - it can be run multiple times safely.

Error Codes (Plan 060 Contract):
- SCHEMA_MISMATCH_DETECTED: Schema is incompatible; migration may be required
- SCHEMA_MIGRATION_FAILED: Migration attempted but did not complete successfully
- SCHEMA_UNSUPPORTED_STATE: Unexpected schema state; migration cannot safely proceed

Schema Readiness Checklist (Cognee >=0.5.1,<0.6.0):
- Table 'datasets' must exist with column 'tenant_id'
- Table 'dataset_database' (if exists) must have all provider/handler columns

Maintenance Contract:
- This checklist is scoped to cognee>=0.5.1,<0.6.0
- Any future Cognee pin change requires reviewing and updating this checklist
"""

import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional


# =============================================================================
# Error Codes (Plan 060 Contract)
# =============================================================================
class SchemaMigrationError:
    """Error codes for schema migration as defined in Plan 060."""
    SCHEMA_MISMATCH_DETECTED = "SCHEMA_MISMATCH_DETECTED"
    SCHEMA_MIGRATION_FAILED = "SCHEMA_MIGRATION_FAILED"
    SCHEMA_UNSUPPORTED_STATE = "SCHEMA_UNSUPPORTED_STATE"


# =============================================================================
# Schema Readiness Checklist (Cognee >=0.5.1,<0.6.0)
# =============================================================================
# Maintenance Contract: Update this when Cognee pin changes
COGNEE_VERSION_RANGE = ">=0.5.1,<0.6.0"

REQUIRED_SCHEMA = {
    "datasets": {
        "required_columns": ["tenant_id"],
        "column_definitions": {
            "tenant_id": "UUID"
        }
    },
    "dataset_database": {
        # This table may not exist in all databases; columns are only required if table exists
        "optional_table": True,
        "required_columns": [
            "vector_database_provider",
            "graph_database_provider",
            "graph_dataset_database_handler",
            "vector_dataset_database_handler",
            "vector_database_url",
            "graph_database_url",
            "vector_database_key",
            "graph_database_key",
            "graph_database_connection_info",
            "vector_database_connection_info",
        ],
        "column_definitions": {
            "vector_database_provider": "VARCHAR",
            "graph_database_provider": "VARCHAR",
            "graph_dataset_database_handler": "VARCHAR",
            "vector_dataset_database_handler": "VARCHAR",
            "vector_database_url": "VARCHAR",
            "graph_database_url": "VARCHAR",
            "vector_database_key": "VARCHAR",
            "graph_database_key": "VARCHAR",
            "graph_database_connection_info": "TEXT",
            "vector_database_connection_info": "TEXT",
        }
    }
}


# =============================================================================
# Migration Receipt (Plan 060 Contract)
# =============================================================================
def generate_migration_receipt(
    db_path: Path,
    success: bool,
    checks_performed: list[str],
    columns_added: list[str],
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
) -> dict:
    """
    Generate a migration receipt as defined in Plan 060.
    
    Receipt contains:
    - timestamp: ISO 8601 timestamp of migration attempt
    - cognee_version_range: Version range this migration targets
    - db_path: Path to the database file
    - checks_performed: List of schema checks performed
    - columns_added: List of columns added during migration
    - success: Whether migration completed successfully
    - error_code: Plan 060 error code if failed
    - error_message: Human-readable error description if failed
    """
    return {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "cognee_version_range": COGNEE_VERSION_RANGE,
        "db_path": str(db_path),
        "checks_performed": checks_performed,
        "columns_added": columns_added,
        "success": success,
        "error_code": error_code,
        "error_message": error_message,
    }


def save_migration_receipt(workspace_path: Path, receipt: dict) -> Path:
    """
    Save migration receipt to workspace system directory.
    
    Returns the path to the saved receipt file.
    """
    system_dir = workspace_path / ".flowbaby" / "system"
    system_dir.mkdir(parents=True, exist_ok=True)
    
    receipt_path = system_dir / "schema_migration_receipt.json"
    with open(receipt_path, "w") as f:
        json.dump(receipt, f, indent=2)
    
    return receipt_path


# =============================================================================
# Schema Readiness Check (for init.py integration)
# =============================================================================
def check_schema_readiness(db_path: Path) -> dict:
    """
    Check if database schema is ready for Cognee 0.5.x operations.
    
    This function is designed to be called by init.py BEFORE any Cognee
    operations (specifically before `await create_db_and_tables()`).
    
    Returns:
        dict with:
        - ready: bool - True if schema is compatible
        - error_code: Optional error code if not ready
        - missing_columns: List of missing columns
        - message: Human-readable status message
    
    Error Codes:
    - SCHEMA_MISMATCH_DETECTED: Missing required columns
    - SCHEMA_UNSUPPORTED_STATE: Table structure is unexpected
    """
    if not db_path.exists():
        # No database yet - Cognee will create with correct schema
        return {
            "ready": True,
            "error_code": None,
            "missing_columns": [],
            "message": "No existing database - fresh install will have correct schema"
        }
    
    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        
        missing_columns = []
        checks_performed = []
        
        for table_name, table_spec in REQUIRED_SCHEMA.items():
            # Check if table exists
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (table_name,)
            )
            table_exists = cursor.fetchone() is not None
            checks_performed.append(f"table_{table_name}_exists")
            
            if not table_exists:
                if table_spec.get("optional_table", False):
                    # Optional table doesn't exist - that's fine
                    continue
                else:
                    # Required table doesn't exist - unsupported state
                    conn.close()
                    return {
                        "ready": False,
                        "error_code": SchemaMigrationError.SCHEMA_UNSUPPORTED_STATE,
                        "missing_columns": [],
                        "message": f"Required table '{table_name}' does not exist"
                    }
            
            # Check for required columns
            columns = get_table_columns(cursor, table_name)
            for col_name in table_spec["required_columns"]:
                checks_performed.append(f"{table_name}.{col_name}")
                if col_name not in columns:
                    missing_columns.append(f"{table_name}.{col_name}")
        
        conn.close()
        
        if missing_columns:
            return {
                "ready": False,
                "error_code": SchemaMigrationError.SCHEMA_MISMATCH_DETECTED,
                "missing_columns": missing_columns,
                "checks_performed": checks_performed,
                "message": f"Missing columns: {', '.join(missing_columns)}"
            }
        
        return {
            "ready": True,
            "error_code": None,
            "missing_columns": [],
            "checks_performed": checks_performed,
            "message": "Schema is compatible with Cognee 0.5.x"
        }
        
    except Exception as e:
        return {
            "ready": False,
            "error_code": SchemaMigrationError.SCHEMA_UNSUPPORTED_STATE,
            "missing_columns": [],
            "message": f"Error checking schema: {str(e)}"
        }


def get_table_columns(cursor, table_name: str) -> list[str]:
    """Get list of column names for a table."""
    cursor.execute(f'PRAGMA table_info({table_name})')
    return [col[1] for col in cursor.fetchall()]


def add_column_if_missing(cursor, table_name: str, col_name: str, col_type: str) -> bool:
    """Add column to table if it doesn't exist. Returns True if added."""
    columns = get_table_columns(cursor, table_name)
    if col_name not in columns:
        cursor.execute(f'ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type}')
        return True
    return False


def migrate_database(db_path: Path) -> dict:
    """
    Migrate a Cognee database to 0.5.x schema.
    
    Returns dict with migration results including Plan 060 contract fields:
    - success: bool
    - error_code: Optional Plan 060 error code
    - checks_performed: List of schema checks performed
    - columns_added: List of columns added during migration
    - message: Human-readable status
    """
    checks_performed = []
    columns_added = []
    
    if not db_path.exists():
        return {
            'success': False,
            'error_code': SchemaMigrationError.SCHEMA_UNSUPPORTED_STATE,
            'checks_performed': checks_performed,
            'columns_added': columns_added,
            'message': f'Database not found: {db_path}'
        }
    
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    try:
        # Check if datasets table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='datasets'")
        checks_performed.append("table_datasets_exists")
        if not cursor.fetchone():
            conn.close()
            return {
                'success': False,
                'error_code': SchemaMigrationError.SCHEMA_UNSUPPORTED_STATE,
                'checks_performed': checks_performed,
                'columns_added': columns_added,
                'message': 'datasets table not found - not a Cognee database'
            }
        
        # Migration 1: Add tenant_id to datasets table (from REQUIRED_SCHEMA)
        for col_name, col_type in REQUIRED_SCHEMA["datasets"]["column_definitions"].items():
            checks_performed.append(f"datasets.{col_name}")
            if add_column_if_missing(cursor, 'datasets', col_name, col_type):
                columns_added.append(f'datasets.{col_name}')
                conn.commit()
        
        # Migration 2: Add missing columns to dataset_database table
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='dataset_database'")
        checks_performed.append("table_dataset_database_exists")
        if cursor.fetchone():
            for col_name, col_type in REQUIRED_SCHEMA["dataset_database"]["column_definitions"].items():
                checks_performed.append(f"dataset_database.{col_name}")
                if add_column_if_missing(cursor, 'dataset_database', col_name, col_type):
                    columns_added.append(f'dataset_database.{col_name}')
                    conn.commit()
        
        conn.close()
        
        return {
            'success': True,
            'error_code': None,
            'checks_performed': checks_performed,
            'columns_added': columns_added,
            'message': f'Applied {len(columns_added)} column additions' if columns_added else 'No migrations needed'
        }
        
    except Exception as e:
        conn.close()
        return {
            'success': False,
            'error_code': SchemaMigrationError.SCHEMA_MIGRATION_FAILED,
            'checks_performed': checks_performed,
            'columns_added': columns_added,
            'message': str(e)
        }


def migrate_workspace(workspace_path: str, save_receipt: bool = True) -> dict:
    """
    Migrate Cognee database in a Flowbaby workspace.
    
    Args:
        workspace_path: Path to the workspace containing .flowbaby directory
        save_receipt: If True, save a migration receipt to the system directory
    
    Returns:
        dict with migration results and receipt information
    """
    workspace = Path(workspace_path)
    db_path = workspace / '.flowbaby' / 'system' / 'databases' / 'cognee_db'
    
    if not db_path.exists():
        result = {
            'success': True,
            'error_code': None,
            'checks_performed': [],
            'columns_added': [],
            'message': 'No existing database - no migration needed'
        }
        if save_receipt:
            receipt = generate_migration_receipt(
                db_path=db_path,
                success=True,
                checks_performed=[],
                columns_added=[],
            )
            receipt_path = save_migration_receipt(workspace, receipt)
            result['receipt_path'] = str(receipt_path)
        return result
    
    result = migrate_database(db_path)
    
    if save_receipt:
        receipt = generate_migration_receipt(
            db_path=db_path,
            success=result['success'],
            checks_performed=result.get('checks_performed', []),
            columns_added=result.get('columns_added', []),
            error_code=result.get('error_code'),
            error_message=result.get('message') if not result['success'] else None,
        )
        receipt_path = save_migration_receipt(workspace, receipt)
        result['receipt_path'] = str(receipt_path)
    
    return result


def main():
    parser = argparse.ArgumentParser(
        description='Migrate Cognee 0.4.x database to 0.5.x schema'
    )
    parser.add_argument(
        'workspace',
        help='Path to VS Code workspace with .flowbaby directory'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Check for needed migrations without applying them'
    )
    parser.add_argument(
        '--json',
        action='store_true',
        help='Output results in JSON format'
    )
    parser.add_argument(
        '--no-receipt',
        action='store_true',
        help='Do not save migration receipt (useful for testing)'
    )
    
    args = parser.parse_args()
    workspace = Path(args.workspace)
    db_path = workspace / '.flowbaby' / 'system' / 'databases' / 'cognee_db'
    
    if args.dry_run:
        # Use check_schema_readiness for dry-run
        result = check_schema_readiness(db_path)
        
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            if result["ready"]:
                print(f"Schema ready: {result['message']}")
            else:
                print(f"Migration needed ({result['error_code']}): {result['message']}")
                if result.get("missing_columns"):
                    for col in result["missing_columns"]:
                        print(f"  NEEDED: {col}")
        
        sys.exit(0 if result["ready"] else 1)
    
    # Perform actual migration
    result = migrate_workspace(args.workspace, save_receipt=not args.no_receipt)
    
    if args.json:
        print(json.dumps(result, indent=2))
        sys.exit(0 if result['success'] else 1)
    
    if result['success']:
        print(f"Migration complete: {result.get('message', 'OK')}")
        if result.get('columns_added'):
            print(f"Columns added: {', '.join(result['columns_added'])}")
        if result.get('receipt_path'):
            print(f"Receipt saved: {result['receipt_path']}")
        sys.exit(0)
    else:
        error_code = result.get('error_code', 'UNKNOWN')
        print(f"Migration failed ({error_code}): {result.get('message', 'Unknown error')}")
        sys.exit(1)


if __name__ == '__main__':
    main()
