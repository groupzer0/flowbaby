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
    
Plan 060: Now includes schema readiness check for Cognee 0.5.x compatibility.
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


def check_schema_status(workspace_path):
    """
    Check schema readiness for Cognee 0.5.x (Plan 060).
    
    Returns dict with schema status information.
    """
    try:
        # Import from the same directory
        from migrate_cognee_0_5_schema import check_schema_readiness, COGNEE_VERSION_RANGE
        
        workspace = Path(workspace_path)
        db_path = workspace / '.flowbaby' / 'system' / 'databases' / 'cognee_db'
        
        if not db_path.exists():
            return {
                "schema_ready": True,
                "schema_message": "No database yet - will be created with correct schema",
                "cognee_version_range": COGNEE_VERSION_RANGE,
            }
        
        readiness = check_schema_readiness(db_path)
        return {
            "schema_ready": readiness["ready"],
            "schema_message": readiness["message"],
            "schema_error_code": readiness.get("error_code"),
            "schema_missing_columns": readiness.get("missing_columns", []),
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

    # 3. Check Schema Readiness (Plan 060)
    schema_status = check_schema_status(workspace_path)
    details["schema_ready"] = schema_status.get("schema_ready")
    details["schema_message"] = schema_status.get("schema_message")
    
    if schema_status.get("schema_ready") is False:
        # Schema incompatible - add to missing
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
