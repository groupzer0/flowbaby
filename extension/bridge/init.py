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
            "migration_performed": false, "global_marker_location": "/path/to/marker",
            "data_dir_size_before": 12345, "data_dir_size_after": 6789}
  Failure: {"success": false, "error": "error message"}
"""

import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from workspace_utils import generate_dataset_name


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
        api_key = os.getenv('LLM_API_KEY')
        if not api_key:
            return {
                'success': False,
                'error': 'LLM_API_KEY not found in environment or .env file. Set LLM_API_KEY="sk-..." in your workspace .env'
            }
        
        # Import cognee
        import cognee
        
        # Configure Cognee with API key
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
        
        # Configure workspace-local storage directories (Task 1)
        cognee.config.system_root_directory(str(workspace_dir / '.cognee_system'))
        cognee.config.data_root_directory(str(workspace_dir / '.cognee_data'))
        
        # 1. Generate unique dataset name for this workspace using canonical path
        dataset_name, workspace_path_str = generate_dataset_name(workspace_path)
        
        # 2. Create .cognee directory for local marker files (not database storage)
        cognee_dir = Path(workspace_path) / '.cognee'
        cognee_dir.mkdir(parents=True, exist_ok=True)
        
        # 3. Determine global data directory for atomic marker coordination
        try:
            from cognee.infrastructure.databases.relational import get_relational_config
            relational_config = get_relational_config()
            global_data_dir = Path(relational_config.db_path).parent  # .cognee_system directory
        except (AttributeError, ImportError, Exception):
            # Fallback to environment variable if API unavailable
            env_data_dir = os.getenv('COGNEE_DATA_DIR')
            if not env_data_dir:
                return {
                    'success': False,
                    'error': 'Cannot determine Cognee data directory: unable to get relational config and COGNEE_DATA_DIR not set'
                }
            global_data_dir = Path(env_data_dir)
        
        global_data_dir.mkdir(parents=True, exist_ok=True)
        global_marker_path = global_data_dir / '.migration_v1_complete'
        local_marker_path = cognee_dir / '.dataset_migration_complete'
        
        # 4. Hybrid marker strategy: global atomic coordination + local acknowledgement
        migration_performed = False
        global_marker_location = str(global_marker_path.absolute())
        data_dir_size_before = 0
        data_dir_size_after = 0
        
        # Check if global migration already completed
        if not global_marker_path.exists():
            # Attempt to atomically create global marker (OS-level exclusivity)
            try:
                # O_CREAT | O_EXCL ensures only one process can create the file
                fd = os.open(str(global_marker_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
                
                # This process won the race - perform global prune
                try:
                    # Calculate data directory size before pruning
                    data_dir_size_before = sum(
                        f.stat().st_size for f in global_data_dir.rglob('*') if f.is_file()
                    )
                    
                    # Perform global prune (removes only untagged legacy data)
                    await cognee.prune.prune_system()
                    migration_performed = True
                    
                    # Calculate data directory size after pruning
                    data_dir_size_after = sum(
                        f.stat().st_size for f in global_data_dir.rglob('*') if f.is_file()
                    )
                    
                    # Write structured metadata to global marker
                    marker_metadata = {
                        'migrated_at': datetime.now().isoformat(),
                        'workspace_id': dataset_name,
                        'workspace_path': workspace_path_str,
                        'data_dir_size_before': data_dir_size_before,
                        'data_dir_size_after': data_dir_size_after,
                        'version': 'v1',
                        'note': 'Global prune of untagged data performed by this process'
                    }
                    
                    # Write to the already-opened file descriptor
                    os.write(fd, json.dumps(marker_metadata, indent=2).encode())
                    
                finally:
                    os.close(fd)
                    
            except FileExistsError:
                # Another process created the marker - migration already performed
                migration_performed = False
                
                # Read existing marker metadata if available
                try:
                    if global_marker_path.exists():
                        marker_content = global_marker_path.read_text()
                        marker_data = json.loads(marker_content)
                        data_dir_size_before = marker_data.get('data_dir_size_before', 0)
                        data_dir_size_after = marker_data.get('data_dir_size_after', 0)
                except Exception:
                    pass  # Non-critical - just for metadata reporting
                    
            except (OSError, PermissionError) as e:
                return {
                    'success': False,
                    'error': f'Failed to create global migration marker (permission denied or filesystem error): {e}'
                }
        else:
            # Global marker already exists - read metadata
            try:
                marker_content = global_marker_path.read_text()
                marker_data = json.loads(marker_content)
                data_dir_size_before = marker_data.get('data_dir_size_before', 0)
                data_dir_size_after = marker_data.get('data_dir_size_after', 0)
            except Exception:
                pass  # Non-critical
        
        # 5. Create/update local acknowledgement marker (all processes do this)
        local_marker_path.write_text(json.dumps({
            'acknowledged_at': datetime.now().isoformat(),
            'dataset_name': dataset_name,
            'workspace_path': workspace_path_str,
            'migration_performed_by_this_process': migration_performed,
            'global_marker_location': global_marker_location
        }, indent=2))
        
        # 6. Load ontology configuration (will be applied during cognify in ingest.py)
        ontology_path = Path(__file__).parent / 'ontology.json'
        if not ontology_path.exists():
            return {
                'success': False,
                'error': f'Ontology file not found: {ontology_path}'
            }
        
        with open(ontology_path) as f:
            ontology = json.load(f)
        
        # 7. Return extended success JSON with migration metadata
        return {
            'success': True,
            'dataset_name': dataset_name,
            'workspace_path': workspace_path_str,
            'cognee_dir': str(cognee_dir.absolute()),
            'ontology_loaded': True,
            'ontology_entities': len(ontology.get('entities', [])),
            'ontology_relationships': len(ontology.get('relationships', [])),
            'migration_performed': migration_performed,
            'global_marker_location': global_marker_location,
            'data_dir_size_before': data_dir_size_before,
            'data_dir_size_after': data_dir_size_after
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
