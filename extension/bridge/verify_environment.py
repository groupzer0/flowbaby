#!/usr/bin/env python3
"""
Flowbaby Environment Verification Script

Usage: python verify_environment.py <workspace_path>

Checks if the Python environment has all necessary dependencies installed,
if the bridge assets (ontology) are present, and if the database schema
is compatible with the current Cognee version.

Returns JSON to stdout:
    Success: {"status": "ok", "details": {...}}
    Failure: {"status": "error", "details": {...}, "missing": [...]}
    
Plan 060: Includes schema readiness check for Cognee 0.5.x compatibility.
Plan 060 M4: Now auto-migrates schema during verification when mismatch is
detected. This ensures dependency refresh doesn't fail due to schema issues
when migration can automatically resolve them.
"""

import importlib.util
import json
import sys
from pathlib import Path


def check_import(module_name):
    try:
        return importlib.util.find_spec(module_name) is not None
    except ImportError:
        return False


def check_and_migrate_schema(workspace_path):
    """
    Check schema readiness and auto-migrate if needed (Plan 060 Milestone 4).
    
    This function is called during dependency refresh verification to ensure
    schema migration happens BEFORE returning verification status. This prevents
    the scenario where verification fails due to schema mismatch but migration
    never gets a chance to run (since init.py won't be called if verification fails).
    
    Returns dict with schema status information after any migration attempt.
    """
    try:
        # Import from the same directory
        from migrate_cognee_0_5_schema import (
            check_schema_readiness,
            migrate_database,
            generate_migration_receipt,
            save_migration_receipt,
            COGNEE_VERSION_RANGE,
            SchemaMigrationError,
        )
        
        workspace = Path(workspace_path)
        db_path = workspace / '.flowbaby' / 'system' / 'databases' / 'cognee_db'
        
        if not db_path.exists():
            return {
                "schema_ready": True,
                "schema_message": "No database yet - will be created with correct schema",
                "cognee_version_range": COGNEE_VERSION_RANGE,
            }
        
        # First check readiness
        readiness = check_schema_readiness(db_path)
        
        if readiness["ready"]:
            return {
                "schema_ready": True,
                "schema_message": readiness["message"],
                "cognee_version_range": COGNEE_VERSION_RANGE,
            }
        
        # Schema not ready - attempt migration if it's a mismatch (Plan 060 M4)
        error_code = readiness.get("error_code")
        
        if error_code == SchemaMigrationError.SCHEMA_MISMATCH_DETECTED:
            # Missing columns/tables - attempt automatic migration
            migration_result = migrate_database(db_path)
            
            if migration_result["success"]:
                # Migration succeeded - save receipt and return success
                columns_added = migration_result.get("columns_added", [])
                tables_created = migration_result.get("tables_created", [])
                
                receipt = generate_migration_receipt(
                    db_path=db_path,
                    success=True,
                    checks_performed=migration_result.get("checks_performed", []),
                    columns_added=columns_added,
                    tables_created=tables_created,
                )
                save_migration_receipt(workspace, receipt)
                
                # Build descriptive message
                changes = []
                if tables_created:
                    changes.append(f"{len(tables_created)} table(s)")
                if columns_added:
                    changes.append(f"{len(columns_added)} column(s)")
                change_desc = " and ".join(changes) if changes else "schema"
                
                return {
                    "schema_ready": True,
                    "schema_message": f"Auto-migrated schema: added {change_desc}",
                    "schema_migrated": True,
                    "schema_columns_added": columns_added,
                    "schema_tables_created": tables_created,
                    "cognee_version_range": COGNEE_VERSION_RANGE,
                }
            else:
                # Migration failed - save failure receipt and return error
                receipt = generate_migration_receipt(
                    db_path=db_path,
                    success=False,
                    checks_performed=migration_result.get("checks_performed", []),
                    columns_added=migration_result.get("columns_added", []),
                    tables_created=migration_result.get("tables_created", []),
                    error_code=migration_result.get("error_code"),
                    error_message=migration_result.get("message"),
                )
                save_migration_receipt(workspace, receipt)
                
                return {
                    "schema_ready": False,
                    "schema_message": f"Migration failed: {migration_result.get('message')}",
                    "schema_error_code": migration_result.get("error_code", "SCHEMA_MIGRATION_FAILED"),
                    "schema_missing_columns": readiness.get("missing_columns", []),
                    "schema_missing_tables": readiness.get("missing_tables", []),
                    "cognee_version_range": COGNEE_VERSION_RANGE,
                }
        
        # Unsupported state or other error - cannot auto-migrate
        return {
            "schema_ready": False,
            "schema_message": readiness["message"],
            "schema_error_code": readiness.get("error_code"),
            "schema_missing_columns": readiness.get("missing_columns", []),
            "schema_missing_tables": readiness.get("missing_tables", []),
            "cognee_version_range": COGNEE_VERSION_RANGE,
        }
        
    except ImportError as e:
        return {
            "schema_ready": None,
            "schema_message": f"Could not import schema migration module: {e}",
            "schema_error": str(e),
        }
    except Exception as e:
        return {
            "schema_ready": None,
            "schema_message": f"Error checking schema: {e}",
            "schema_error": str(e),
        }


def verify_environment(workspace_path):
    # Core dependencies required by the bridge
    required_modules = {
        "cognee": "cognee",
        "rdflib": "rdflib",
        "dotenv": "python-dotenv" # import name is dotenv
    }

    details = {}
    missing = []

    # 1. Check Python Modules
    for import_name, package_name in required_modules.items():
        is_installed = check_import(import_name)
        details[import_name] = is_installed
        if not is_installed:
            missing.append(package_name)

    # 2. Check Ontology File
    # In the extension structure, ontology.ttl is in the same directory as this script
    script_dir = Path(__file__).parent
    ontology_file = script_dir / 'ontology.ttl'
    ontology_exists = ontology_file.exists()
    details["ontology_file"] = ontology_exists

    if not ontology_exists:
        missing.append("ontology.ttl")

    # 3. Check Schema Readiness and Auto-Migrate if Needed (Plan 060 M4)
    # This runs migration during verification so that dependency refresh
    # doesn't fail due to schema mismatch without attempting migration.
    schema_status = check_and_migrate_schema(workspace_path)
    details["schema_ready"] = schema_status.get("schema_ready")
    details["schema_message"] = schema_status.get("schema_message")
    
    # Include migration info if migration was performed
    if schema_status.get("schema_migrated"):
        details["schema_migrated"] = True
        details["schema_columns_added"] = schema_status.get("schema_columns_added", [])
    
    if schema_status.get("schema_ready") is False:
        # Schema incompatible even after migration attempt
        missing.append(f"schema_migration:{schema_status.get('schema_error_code', 'UNKNOWN')}")
        details["schema_error_code"] = schema_status.get("schema_error_code")
        details["schema_missing_columns"] = schema_status.get("schema_missing_columns", [])
    
    details["cognee_version_range"] = schema_status.get("cognee_version_range")

    status = "ok" if not missing else "error"

    return {
        "status": status,
        "details": details,
        "missing": missing,
        "python_version": sys.version
    }

def main():
    if len(sys.argv) < 2:
        # Fallback to current dir if not provided (though extension should provide it)
        workspace_path = "."
    else:
        workspace_path = sys.argv[1]

    try:
        result = verify_environment(workspace_path)
        print(json.dumps(result))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({
            "status": "error",
            "error": str(e),
            "details": {}
        }))
        sys.exit(1)

if __name__ == '__main__':
    main()
