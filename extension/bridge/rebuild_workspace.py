#!/usr/bin/env python3
"""
Flowbaby Workspace Rebuild Tool - Plan 074 Milestone 5

Usage:
  python rebuild_workspace.py --mode reindex-only <workspace_path>
  python rebuild_workspace.py --mode reset-and-rebuild --force <workspace_path>

This is an ADVANCED tool for developers and testers only. It is NOT executed
automatically during upgrade and is NOT exposed as a user-facing VS Code command.

Modes:
  reindex-only       Re-run cognee.add() + cognee.cognify() on existing workspace data.
                     Non-destructive: preserves existing graph/vector stores.
                     Note: Due to Cognee's pipeline caching, already-processed data
                     may be skipped. Use reset-and-rebuild for guaranteed fresh processing.

  reset-and-rebuild  Reset graph/vector/cache stores, then rebuild from persisted inputs.
                     DESTRUCTIVE: Clears existing embeddings and graph relationships.
                     Requires --force flag for explicit confirmation.

Safety Features:
  - Acquires maintenance lock to prevent concurrent operations
  - Requires --force for destructive operations
  - Logs all actions to .flowbaby/maintenance/rebuild.log
  - Coordinates with daemon mode (no concurrent writes)

Exit Codes:
  0 - Success
  1 - Error (invalid arguments, missing workspace, operation failed)
  2 - Lock acquisition failed (another operation in progress)
  3 - User cancelled (no --force for destructive operation)

@see agent-output/planning/074-activate-ontology-mapping.md (Milestone 5)
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

# Add bridge directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# CRITICAL: Import bridge_env BEFORE any cognee import (Plan 074)
from bridge_env import apply_workspace_env, OntologyConfigError, get_env_config_snapshot


# Constants
MAINTENANCE_LOCK_FILE = '.flowbaby/maintenance.lock'
REBUILD_LOG_FILE = '.flowbaby/maintenance/rebuild.log'
BACKGROUND_OPS_DIR = '.flowbaby/background_ops'


def log_rebuild(workspace_dir: Path, message: str, level: str = "INFO"):
    """Append message to rebuild log and print to stderr."""
    log_path = workspace_dir / REBUILD_LOG_FILE
    log_path.parent.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().isoformat()
    log_line = f"[{timestamp}] [{level}] {message}"
    
    with open(log_path, 'a') as f:
        f.write(log_line + "\n")
    
    print(f"[REBUILD] {log_line}", file=sys.stderr)


def acquire_lock(workspace_dir: Path) -> bool:
    """
    Create maintenance lock file to pause background operations.
    
    Uses atomic file creation to ensure only one process can acquire the lock.
    
    Returns:
        True if lock acquired, False if lock already held
    """
    lock_path = workspace_dir / MAINTENANCE_LOCK_FILE
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        # O_CREAT | O_EXCL ensures atomicity - only one process can create
        fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        lock_info = {
            'acquired_at': datetime.now().isoformat(),
            'pid': os.getpid(),
            'operation': 'rebuild_workspace',
        }
        os.write(fd, json.dumps(lock_info, indent=2).encode())
        os.close(fd)
        return True
    except FileExistsError:
        return False
    except (OSError, PermissionError) as e:
        log_rebuild(workspace_dir, f"Failed to create lock file: {e}", "ERROR")
        return False


def release_lock(workspace_dir: Path):
    """Remove maintenance lock file."""
    lock_path = workspace_dir / MAINTENANCE_LOCK_FILE
    try:
        if lock_path.exists():
            lock_path.unlink()
    except Exception as e:
        log_rebuild(workspace_dir, f"Warning: Failed to release lock: {e}", "WARN")


def get_workspace_summary(workspace_dir: Path) -> dict:
    """
    Get a summary of the workspace's current state for logging.
    
    Returns dict with counts of various data artifacts.
    """
    summary = {
        'data_files': 0,
        'system_db_exists': False,
        'lancedb_tables': 0,
        'cache_size_bytes': 0,
    }
    
    data_dir = workspace_dir / '.flowbaby' / 'data'
    system_dir = workspace_dir / '.flowbaby' / 'system'
    cache_dir = workspace_dir / '.flowbaby' / 'cache'
    
    # Count data files
    if data_dir.exists():
        summary['data_files'] = sum(1 for _ in data_dir.rglob('*') if _.is_file())
    
    # Check system database
    cognee_db = system_dir / 'databases' / 'cognee_db'
    summary['system_db_exists'] = cognee_db.exists()
    
    # Count LanceDB tables
    lancedb_dir = system_dir / 'databases' / 'lancedb'
    if lancedb_dir.exists():
        summary['lancedb_tables'] = sum(1 for d in lancedb_dir.iterdir() if d.is_dir())
    
    # Cache size
    if cache_dir.exists():
        summary['cache_size_bytes'] = sum(f.stat().st_size for f in cache_dir.rglob('*') if f.is_file())
    
    return summary


async def do_reindex_only(workspace_path: str, dataset_name: str, api_key: str) -> dict:
    """
    Reindex-only mode: Re-run add+cognify on existing data.
    
    This mode does NOT reset stores. Due to Cognee's pipeline caching,
    already-processed data may be skipped. For guaranteed fresh processing,
    use reset-and-rebuild mode.
    
    Returns:
        dict with operation results
    """
    workspace_dir = Path(workspace_path)
    log_rebuild(workspace_dir, "Starting reindex-only operation")
    
    # Import cognee after env wiring
    import cognee
    
    # Configure cognee
    env_config = get_env_config_snapshot()
    cognee.config.system_root_directory(env_config['SYSTEM_ROOT_DIRECTORY'])
    cognee.config.data_root_directory(env_config['DATA_ROOT_DIRECTORY'])
    cognee.config.set_llm_api_key(api_key)
    cognee.config.set_llm_provider('openai')
    
    log_rebuild(workspace_dir, f"Dataset: {dataset_name}")
    log_rebuild(workspace_dir, f"Ontology: {env_config['ONTOLOGY_FILE_PATH']}")
    
    # Search for existing summaries to re-add
    # We use the same pattern as migrate_summaries.py
    from cognee.modules.search.types import SearchType
    
    log_rebuild(workspace_dir, "Searching for existing summaries to reindex...")
    
    try:
        search_results = await cognee.search(
            query_type=SearchType.GRAPH_COMPLETION,
            query_text="Conversation Summary",
            datasets=[dataset_name],
            top_k=500  # Higher limit for reindex
        )
        
        summaries_found = []
        for result in search_results:
            text = str(getattr(result, 'text', result))
            if "# Conversation Summary:" in text:
                summaries_found.append(text)
        
        log_rebuild(workspace_dir, f"Found {len(summaries_found)} summaries")
        
        if summaries_found:
            log_rebuild(workspace_dir, "Re-adding summaries...")
            await cognee.add(
                data=summaries_found,
                dataset_name=dataset_name
            )
            
            log_rebuild(workspace_dir, "Running cognify...")
            await cognee.cognify(datasets=[dataset_name])
            
            log_rebuild(workspace_dir, f"Reindex complete: processed {len(summaries_found)} summaries")
        else:
            log_rebuild(workspace_dir, "No summaries found to reindex")
        
        return {
            'success': True,
            'mode': 'reindex-only',
            'summaries_processed': len(summaries_found),
        }
        
    except Exception as e:
        log_rebuild(workspace_dir, f"Reindex failed: {e}", "ERROR")
        return {
            'success': False,
            'mode': 'reindex-only',
            'error': str(e),
        }


async def do_reset_and_rebuild(workspace_path: str, dataset_name: str, api_key: str) -> dict:
    """
    Reset-and-rebuild mode: Clear stores, then rebuild from scratch.
    
    This mode:
    1. Calls cognee.prune.prune_system() to clear graph/vector/cache
    2. Searches for existing summaries (from backed-up search before prune)
    3. Re-adds and re-cognifies everything
    
    Returns:
        dict with operation results
    """
    workspace_dir = Path(workspace_path)
    log_rebuild(workspace_dir, "Starting reset-and-rebuild operation")
    log_rebuild(workspace_dir, "WARNING: This will delete existing embeddings and graph relationships")
    
    # Import cognee after env wiring
    import cognee
    from cognee.modules.search.types import SearchType
    
    # Configure cognee
    env_config = get_env_config_snapshot()
    cognee.config.system_root_directory(env_config['SYSTEM_ROOT_DIRECTORY'])
    cognee.config.data_root_directory(env_config['DATA_ROOT_DIRECTORY'])
    cognee.config.set_llm_api_key(api_key)
    cognee.config.set_llm_provider('openai')
    
    log_rebuild(workspace_dir, f"Dataset: {dataset_name}")
    log_rebuild(workspace_dir, f"Ontology: {env_config['ONTOLOGY_FILE_PATH']}")
    
    # STEP 1: Extract existing summaries BEFORE pruning
    log_rebuild(workspace_dir, "Step 1: Extracting existing summaries before reset...")
    
    summaries_to_rebuild = []
    try:
        search_results = await cognee.search(
            query_type=SearchType.GRAPH_COMPLETION,
            query_text="Conversation Summary",
            datasets=[dataset_name],
            top_k=500
        )
        
        for result in search_results:
            text = str(getattr(result, 'text', result))
            if "# Conversation Summary:" in text:
                summaries_to_rebuild.append(text)
        
        log_rebuild(workspace_dir, f"Extracted {len(summaries_to_rebuild)} summaries")
    except Exception as e:
        log_rebuild(workspace_dir, f"Warning: Could not extract existing summaries: {e}", "WARN")
        log_rebuild(workspace_dir, "Proceeding with reset (no data to rebuild)")
    
    # STEP 2: Reset all stores
    log_rebuild(workspace_dir, "Step 2: Resetting graph, vector, and cache stores...")
    
    summary_before = get_workspace_summary(workspace_dir)
    log_rebuild(workspace_dir, f"Before reset: {json.dumps(summary_before)}")
    
    try:
        await cognee.prune.prune_system(graph=True, vector=True, metadata=True, cache=True)
        log_rebuild(workspace_dir, "prune_system() completed")
    except Exception as e:
        log_rebuild(workspace_dir, f"prune_system() failed: {e}", "ERROR")
        return {
            'success': False,
            'mode': 'reset-and-rebuild',
            'error': f"Failed to reset stores: {e}",
        }
    
    summary_after_reset = get_workspace_summary(workspace_dir)
    log_rebuild(workspace_dir, f"After reset: {json.dumps(summary_after_reset)}")
    
    # STEP 3: Rebuild from extracted summaries
    if summaries_to_rebuild:
        log_rebuild(workspace_dir, f"Step 3: Rebuilding {len(summaries_to_rebuild)} summaries...")
        
        try:
            # Re-add all summaries
            await cognee.add(
                data=summaries_to_rebuild,
                dataset_name=dataset_name
            )
            log_rebuild(workspace_dir, "add() completed")
            
            # Run cognify
            await cognee.cognify(datasets=[dataset_name])
            log_rebuild(workspace_dir, "cognify() completed")
            
            summary_after_rebuild = get_workspace_summary(workspace_dir)
            log_rebuild(workspace_dir, f"After rebuild: {json.dumps(summary_after_rebuild)}")
            
        except Exception as e:
            log_rebuild(workspace_dir, f"Rebuild failed: {e}", "ERROR")
            return {
                'success': False,
                'mode': 'reset-and-rebuild',
                'error': f"Failed during rebuild: {e}",
                'summaries_extracted': len(summaries_to_rebuild),
                'note': 'Stores were reset but rebuild failed. Data loss may have occurred.',
            }
    else:
        log_rebuild(workspace_dir, "Step 3: No summaries to rebuild (workspace was empty)")
    
    log_rebuild(workspace_dir, "Reset-and-rebuild completed successfully")
    
    return {
        'success': True,
        'mode': 'reset-and-rebuild',
        'summaries_rebuilt': len(summaries_to_rebuild),
        'workspace_summary_before': summary_before,
        'workspace_summary_after': get_workspace_summary(workspace_dir),
    }


async def main_async(args: argparse.Namespace) -> int:
    """Async main function."""
    workspace_path = args.workspace_path
    workspace_dir = Path(workspace_path)
    
    # Validate workspace
    if not workspace_dir.is_dir():
        print(f"Error: Workspace path does not exist: {workspace_path}", file=sys.stderr)
        return 1
    
    if not workspace_dir.is_absolute():
        print(f"Error: Workspace path must be absolute: {workspace_path}", file=sys.stderr)
        return 1
    
    # Check for .flowbaby directory
    flowbaby_dir = workspace_dir / '.flowbaby'
    if not flowbaby_dir.exists():
        print(f"Error: No .flowbaby directory found in workspace. Nothing to rebuild.", file=sys.stderr)
        return 1
    
    # Check for API key
    api_key = os.getenv('LLM_API_KEY')
    if not api_key:
        print("Error: LLM_API_KEY environment variable not set.", file=sys.stderr)
        print("Set your API key: export LLM_API_KEY='your-key-here'", file=sys.stderr)
        return 1
    
    # Validate mode-specific requirements
    if args.mode == 'reset-and-rebuild' and not args.force:
        print("=" * 60, file=sys.stderr)
        print("ERROR: reset-and-rebuild mode requires --force flag", file=sys.stderr)
        print("", file=sys.stderr)
        print("This operation will:", file=sys.stderr)
        print("  - DELETE all graph relationships", file=sys.stderr)
        print("  - DELETE all vector embeddings", file=sys.stderr)
        print("  - DELETE all cached data", file=sys.stderr)
        print("  - Rebuild everything from extracted summaries", file=sys.stderr)
        print("", file=sys.stderr)
        print("To proceed, add --force flag:", file=sys.stderr)
        print(f"  python rebuild_workspace.py --mode reset-and-rebuild --force {workspace_path}", file=sys.stderr)
        print("=" * 60, file=sys.stderr)
        return 3
    
    # Apply environment wiring BEFORE importing cognee
    log_rebuild(workspace_dir, f"Applying environment wiring for workspace: {workspace_path}")
    try:
        env_config = apply_workspace_env(workspace_path, fail_on_missing_ontology=True)
        log_rebuild(workspace_dir, f"Environment configured: {env_config.to_log_string()}")
    except OntologyConfigError as e:
        print(f"Error: Ontology configuration failed: {e}", file=sys.stderr)
        return 1
    
    # Generate dataset name
    from workspace_utils import generate_dataset_name
    dataset_name, _ = generate_dataset_name(workspace_path)
    
    # Acquire maintenance lock
    log_rebuild(workspace_dir, "Acquiring maintenance lock...")
    if not acquire_lock(workspace_dir):
        print(f"Error: Could not acquire maintenance lock at {workspace_dir / MAINTENANCE_LOCK_FILE}", file=sys.stderr)
        print("Another maintenance operation may be in progress.", file=sys.stderr)
        print("If you're sure no other operation is running, delete the lock file manually.", file=sys.stderr)
        return 2
    
    log_rebuild(workspace_dir, "Maintenance lock acquired")
    
    try:
        # Execute the requested operation
        if args.mode == 'reindex-only':
            result = await do_reindex_only(workspace_path, dataset_name, api_key)
        elif args.mode == 'reset-and-rebuild':
            result = await do_reset_and_rebuild(workspace_path, dataset_name, api_key)
        else:
            print(f"Error: Unknown mode: {args.mode}", file=sys.stderr)
            return 1
        
        # Output result
        print(json.dumps(result, indent=2))
        
        if result.get('success'):
            log_rebuild(workspace_dir, f"Operation completed successfully: {args.mode}")
            return 0
        else:
            log_rebuild(workspace_dir, f"Operation failed: {result.get('error', 'Unknown error')}", "ERROR")
            return 1
            
    except Exception as e:
        import traceback
        log_rebuild(workspace_dir, f"Unhandled exception: {e}", "ERROR")
        log_rebuild(workspace_dir, traceback.format_exc(), "ERROR")
        print(json.dumps({'success': False, 'error': str(e)}))
        return 1
        
    finally:
        release_lock(workspace_dir)
        log_rebuild(workspace_dir, "Maintenance lock released")


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description='Flowbaby Workspace Rebuild Tool (Plan 074 Milestone 5)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Non-destructive reindex (may skip already-processed data)
  python rebuild_workspace.py --mode reindex-only /path/to/workspace

  # Full reset and rebuild (requires --force)
  python rebuild_workspace.py --mode reset-and-rebuild --force /path/to/workspace

Environment Variables:
  LLM_API_KEY    Required. Your OpenAI API key for cognify operations.

Notes:
  - This tool is for DEVELOPERS and TESTERS only
  - It is NOT executed automatically during upgrades
  - Acquires maintenance lock to prevent concurrent operations
  - Logs all actions to .flowbaby/maintenance/rebuild.log
"""
    )
    
    parser.add_argument(
        '--mode',
        required=True,
        choices=['reindex-only', 'reset-and-rebuild'],
        help='Operation mode: reindex-only (non-destructive) or reset-and-rebuild (destructive)'
    )
    
    parser.add_argument(
        '--force',
        action='store_true',
        help='Required for reset-and-rebuild mode. Confirms destructive operation.'
    )
    
    parser.add_argument(
        'workspace_path',
        help='Absolute path to the workspace directory'
    )
    
    args = parser.parse_args()
    
    # Run async main
    exit_code = asyncio.run(main_async(args))
    sys.exit(exit_code)


if __name__ == '__main__':
    main()
