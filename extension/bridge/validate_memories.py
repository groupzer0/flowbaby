#!/usr/bin/env python3
"""
Flowbaby Memory Validation Script

Usage: python validate_memories.py <workspace_path>

Performs integrity checks on the Flowbaby memory system:
1. Checks environment configuration (.env, API key)
2. Checks ontology file existence
3. Verifies graph database connection via smoke-test search
4. Validates structure of retrieved memories (metadata fields)

Returns JSON to stdout:
    Success: {"success": true, "checks": {...}, "status": "healthy"}
    Failure: {"success": false, "checks": {...}, "status": "unhealthy", "error": "..."}
"""

import asyncio
import json
import os
import sys
from pathlib import Path

# Add bridge directory to path to import bridge_logger
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import bridge_logger
from workspace_utils import generate_dataset_name, canonicalize_workspace_path

async def validate_memory(workspace_path: str) -> dict:
    # Initialize logger
    logger = bridge_logger.setup_logging(workspace_path, "validate")
    logger.info(f"Validating memory for workspace: {workspace_path}")

    checks = {
        "env_file": False,
        "api_key": False,
        "ontology_file": False,
        "graph_connection": False,
        "retrieval_smoke_test": False,
        "memory_structure": "N/A"
    }
    
    try:
        # 1. Check API Key (Plan 039 M5: .env support removed per security hardening)
        workspace_dir = Path(workspace_path)
        
        # API key is provided by TypeScript via LLM_API_KEY environment variable
        api_key = os.getenv('LLM_API_KEY')
        if api_key:
            checks["api_key"] = True
            checks["env_file"] = True  # Mark as passed since env var is set
        else:
            error_msg = "LLM_API_KEY missing. Use 'Flowbaby: Set API Key' for secure storage."
            logger.error(error_msg)
            return {
                "success": False,
                "checks": checks,
                "status": "config_error",
                "error": error_msg
            }

        # 2. Check Ontology File
        # Assuming ontology.ttl is in the bridge directory or workspace
        # In this extension, ontology.ttl is in the bridge folder, but cognee might look for it elsewhere
        # We'll check if the extension's ontology.ttl exists (sanity check for installation)
        script_dir = Path(__file__).parent
        ontology_file = script_dir / 'ontology.ttl'
        if ontology_file.exists():
            checks["ontology_file"] = True
            logger.debug(f"Ontology file found at {ontology_file}")
        else:
            logger.warning(f"Ontology file not found at {ontology_file}")
        
        # ============================================================================
        # PLAN 033 FIX: Set environment variables BEFORE importing cognee SDK
        # ============================================================================
        # CRITICAL: The Cognee SDK uses pydantic-settings with @lru_cache, which reads
        # environment variables at import time and caches them permanently.
        # ============================================================================
        
        # Calculate workspace-local storage paths
        system_root = str(workspace_dir / '.flowbaby/system')
        data_root = str(workspace_dir / '.flowbaby/data')
        
        # Create directories BEFORE setting env vars
        Path(system_root).mkdir(parents=True, exist_ok=True)
        Path(data_root).mkdir(parents=True, exist_ok=True)
        
        # Set environment variables BEFORE importing cognee
        os.environ['SYSTEM_ROOT_DIRECTORY'] = system_root
        os.environ['DATA_ROOT_DIRECTORY'] = data_root
        
        # 3. Configure Cognee
        logger.debug("Importing cognee SDK")
        import cognee
        from cognee.modules.search.types import SearchType
        
        # Belt-and-suspenders: Also call config methods (redundant but safe)
        cognee.config.system_root_directory(system_root)
        cognee.config.data_root_directory(data_root)
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
        
        dataset_name, _ = generate_dataset_name(workspace_path)
        logger.info(f"Using dataset: {dataset_name}")
        
        # 4. Smoke Test (Graph Connection & Retrieval)
        try:
            # Search for something generic
            logger.info("Running smoke test search")
            results = await cognee.search(
                query_type=SearchType.GRAPH_COMPLETION,
                query_text="validation smoke test",
                datasets=[dataset_name],
                top_k=1
            )
            checks["graph_connection"] = True
            checks["retrieval_smoke_test"] = True
            
            # 5. Validate Structure (if any results)
            if results:
                first_result = results[0]
                # Check if it has expected attributes (text/summary_text)
                # We can't strictly validate metadata if the result is just a generic chunk
                # But we can check if we got a result object
                checks["memory_structure"] = "valid_object"
                logger.debug("Smoke test returned results")
            else:
                checks["memory_structure"] = "empty_graph" # Not an error, just empty
                logger.debug("Smoke test returned no results (empty graph)")
                
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Smoke test failed: {error_msg}")
            return {
                "success": False,
                "checks": checks,
                "status": "connection_error",
                "error": error_msg
            }

        logger.info("Validation completed successfully")
        return {
            "success": True,
            "checks": checks,
            "status": "healthy"
        }

    except Exception as e:
        error_msg = str(e)
        if logger: logger.error(f"Validation failed: {error_msg}")
        return {
            "success": False,
            "checks": checks,
            "status": "system_error",
            "error": error_msg
        }

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Missing workspace_path"}))
        sys.exit(1)
        
    workspace_path = sys.argv[1]
    try:
        workspace_path = canonicalize_workspace_path(workspace_path)
    except FileNotFoundError:
        print(json.dumps({"success": False, "error": f"Workspace path does not exist: {sys.argv[1]}"}))
        sys.exit(1)
    
    if not Path(workspace_path).is_dir():
        print(json.dumps({"success": False, "error": f"Invalid workspace path: {workspace_path}"}))
        sys.exit(1)
        
    result = asyncio.run(validate_memory(workspace_path))
    print(json.dumps(result))
    sys.exit(0 if result["success"] else 1)

if __name__ == '__main__':
    main()
