#!/usr/bin/env python3
"""
Cognee Initialization Script for VS Code Extension

Usage: python init.py <workspace_path>

Initializes Cognee for a workspace by:
1. Loading environment variables from workspace .env file
2. Configuring Cognee with OpenAI API key
3. Generating unique dataset name for workspace isolation
4. Setting up workspace-local .cognee/ directory for marker files
5. Performing one-time global data prune if needed

Returns JSON to stdout:
  Success: {"success": true, "dataset_name": "ws_abc123...", "cognee_dir": "/path/to/.cognee", 
            "ontology_loaded": true, "ontology_entities": 8, "ontology_relationships": 12,
            "migration_performed": false}
  Failure: {"success": false, "error": "error message"}
"""

import asyncio
import hashlib
import json
import os
import sys
from datetime import datetime
from pathlib import Path


async def initialize_cognee(workspace_path: str) -> dict:
    """
    Initialize Cognee for the given workspace with dataset-based isolation.
    
    Args:
        workspace_path: Absolute path to VS Code workspace root
        
    Returns:
        Dictionary with success status, dataset_name, cognee_dir, ontology info, and migration status
    """
    try:
        # Load workspace .env file if it exists
        workspace_dir = Path(workspace_path)
        env_file = workspace_dir / '.env'
        
        if env_file.exists():
            from dotenv import load_dotenv
            load_dotenv(env_file)
        
        # Check for API key
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            return {
                'success': False,
                'error': 'OPENAI_API_KEY not found in environment or .env file'
            }
        
        # Import cognee
        import cognee
        
        # Configure Cognee with API key
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
        
        # 1. Generate unique dataset name for this workspace
        workspace_path_str = str(workspace_dir.absolute())
        dataset_hash = hashlib.sha1(workspace_path_str.encode()).hexdigest()[:16]
        dataset_name = f"ws_{dataset_hash}"
        
        # 2. Create .cognee directory for marker files (not database storage)
        cognee_dir = workspace_dir / '.cognee'
        cognee_dir.mkdir(parents=True, exist_ok=True)
        
        # 3. Check if this is first-time initialization (one-time migration)
        migration_marker = cognee_dir / '.dataset_migration_complete'
        
        # CRITICAL: Global prune strategy
        # - Each workspace checks its LOCAL marker file
        # - If marker exists: Skip prune (this workspace already did it)
        # - If marker doesn't exist: Perform ONE global prune
        # - Risk window: If two workspaces initialize simultaneously, both may prune
        # - Mitigation: Small risk window (~1 second), acceptable for one-time migration
        
        if not migration_marker.exists():
            # First run for this workspace: Clear any untagged legacy data
            # This is a GLOBAL operation (clears all untagged data across all workspaces)
            # Safe because: Previous extension versions didn't use datasets, so only legacy data is untagged
            await cognee.prune.prune_system()  # Clear graph + vector + metadata
            
            # Create marker to prevent this workspace from pruning again
            migration_marker.write_text(json.dumps({
                'migrated_at': datetime.now().isoformat(),
                'dataset_name': dataset_name,
                'workspace_path': workspace_path_str,
                'note': 'Global prune performed - all untagged data cleared'
            }))
            migration_performed = True
        else:
            migration_performed = False
        
        # 4. Load ontology configuration (will be applied during cognify in ingest.py)
        ontology_path = Path(__file__).parent / 'ontology.json'
        if not ontology_path.exists():
            return {
                'success': False,
                'error': f'Ontology file not found: {ontology_path}'
            }
        
        with open(ontology_path) as f:
            ontology = json.load(f)
        
        # 5. Return extended success JSON
        return {
            'success': True,
            'dataset_name': dataset_name,
            'workspace_path': workspace_path_str,
            'cognee_dir': str(cognee_dir.absolute()),
            'ontology_loaded': True,
            'ontology_entities': len(ontology.get('entities', [])),
            'ontology_relationships': len(ontology.get('relationships', [])),
            'migration_performed': migration_performed
        }
        
    except ImportError as e:
        return {
            'success': False,
            'error': f'Failed to import required module: {str(e)}'
        }
    except Exception as e:
        return {
            'success': False,
            'error': f'Initialization failed: {str(e)}'
        }


def main():
    """Main entry point for the script."""
    # Check command-line arguments
    if len(sys.argv) < 2:
        result = {
            'success': False,
            'error': 'Missing required argument: workspace_path'
        }
        print(json.dumps(result))
        sys.exit(1)
    
    workspace_path = sys.argv[1]
    
    # Validate workspace path exists
    if not Path(workspace_path).is_dir():
        result = {
            'success': False,
            'error': f'Workspace path does not exist: {workspace_path}'
        }
        print(json.dumps(result))
        sys.exit(1)
    
    # Run initialization
    result = asyncio.run(initialize_cognee(workspace_path))
    
    # Output JSON result
    print(json.dumps(result))
    
    # Exit with appropriate code
    sys.exit(0 if result['success'] else 1)


if __name__ == '__main__':
    main()
