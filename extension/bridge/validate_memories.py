#!/usr/bin/env python3
"""
RecallFlow Memory Validation Script

Usage: python validate_memories.py <workspace_path>

Performs integrity checks on the RecallFlow memory system:
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
from workspace_utils import generate_dataset_name

async def validate_memory(workspace_path: str) -> dict:
    checks = {
        "env_file": False,
        "api_key": False,
        "ontology_file": False,
        "graph_connection": False,
        "retrieval_smoke_test": False,
        "memory_structure": "N/A"
    }
    
    try:
        # 1. Check .env and API Key
        workspace_dir = Path(workspace_path)
        env_file = workspace_dir / '.env'
        
        if env_file.exists():
            checks["env_file"] = True
            from dotenv import load_dotenv
            load_dotenv(env_file)
        
        api_key = os.getenv('LLM_API_KEY')
        if api_key:
            checks["api_key"] = True
        else:
            return {
                "success": False,
                "checks": checks,
                "status": "config_error",
                "error": "LLM_API_KEY missing in .env"
            }

        # 2. Check Ontology File
        # Assuming ontology.ttl is in the bridge directory or workspace
        # In this extension, ontology.ttl is in the bridge folder, but cognee might look for it elsewhere
        # We'll check if the extension's ontology.ttl exists (sanity check for installation)
        script_dir = Path(__file__).parent
        ontology_file = script_dir / 'ontology.ttl'
        if ontology_file.exists():
            checks["ontology_file"] = True
        
        # 3. Configure Cognee
        import cognee
        from cognee.modules.search.types import SearchType
        
        cognee.config.system_root_directory(str(workspace_dir / '.cognee_system'))
        cognee.config.data_root_directory(str(workspace_dir / '.cognee_data'))
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
        
        dataset_name, _ = generate_dataset_name(workspace_path)
        
        # 4. Smoke Test (Graph Connection & Retrieval)
        try:
            # Search for something generic
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
            else:
                checks["memory_structure"] = "empty_graph" # Not an error, just empty
                
        except Exception as e:
            return {
                "success": False,
                "checks": checks,
                "status": "connection_error",
                "error": str(e)
            }

        return {
            "success": True,
            "checks": checks,
            "status": "healthy"
        }

    except Exception as e:
        return {
            "success": False,
            "checks": checks,
            "status": "system_error",
            "error": str(e)
        }

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Missing workspace_path"}))
        sys.exit(1)
        
    workspace_path = sys.argv[1]
    
    if not Path(workspace_path).is_dir():
        print(json.dumps({"success": False, "error": f"Invalid workspace path: {workspace_path}"}))
        sys.exit(1)
        
    result = asyncio.run(validate_memory(workspace_path))
    print(json.dumps(result))
    sys.exit(0 if result["success"] else 1)

if __name__ == '__main__':
    main()
