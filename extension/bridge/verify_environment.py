#!/usr/bin/env python3
"""
Flowbaby Environment Verification Script

Usage: python verify_environment.py <workspace_path>

Checks if the Python environment has all necessary dependencies installed
and if the bridge assets (ontology) are present.

Returns JSON to stdout:
    Success: {"status": "ok", "details": {...}}
    Failure: {"status": "error", "details": {...}, "missing": [...]}
"""

import json
import sys
import importlib.util
from pathlib import Path

def check_import(module_name):
    try:
        return importlib.util.find_spec(module_name) is not None
    except ImportError:
        return False

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
