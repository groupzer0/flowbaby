#!/usr/bin/env python3
"""
Manual E2E test harness for Cognee bridge scripts.

Usage:
    python manual_test.py --action init --workspace /path/to/test-workspace
    python manual_test.py --action ingest --workspace /path/to/test-workspace
    python manual_test.py --action retrieve --workspace /path/to/test-workspace
    python manual_test.py --action clear --workspace /path/to/test-workspace

Requires:
- .env or .env.test file in workspace with LLM_API_KEY
- ontology.ttl file in parent directory (for init/ingest actions)
"""
import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Dict, Any

# Add current directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))


def load_env_file(workspace_path: Path) -> Dict[str, str]:
    """Load environment variables from .env.test or .env file."""
    env_vars = {}
    
    for env_file_name in ['.env.test', '.env']:
        env_file = workspace_path / env_file_name
        if env_file.exists():
            print(f"Loading environment from: {env_file}")
            with open(env_file, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        env_vars[key.strip()] = value.strip()
            break
    else:
        print("Warning: No .env.test or .env file found in workspace")
    
    return env_vars


async def test_init(workspace_path: Path) -> Dict[str, Any]:
    """Test initialization action."""
    print(f"\n=== Testing INIT action ===")
    print(f"Workspace: {workspace_path}")
    
    start_time = time.time()
    
    try:
        from init import initialize_cognee
        
        result = await initialize_cognee(str(workspace_path))
        
        elapsed = time.time() - start_time
        print(f"✓ Init completed in {elapsed:.2f}s")
        print(f"Result: {json.dumps(result, indent=2)}")
        
        # Check storage directories were created
        system_dir = workspace_path / '.cognee_system'
        data_dir = workspace_path / '.cognee_data'
        
        if system_dir.exists():
            print(f"✓ System directory created: {system_dir}")
        else:
            print(f"✗ System directory NOT found: {system_dir}")
        
        if data_dir.exists():
            print(f"✓ Data directory created: {data_dir}")
        else:
            print(f"✗ Data directory NOT found: {data_dir}")
        
        return {'success': True, 'elapsed': elapsed, 'result': result}
        
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"✗ Init failed after {elapsed:.2f}s")
        print(f"Error: {type(e).__name__}: {str(e)}")
        return {'success': False, 'elapsed': elapsed, 'error': str(e)}


async def test_ingest(workspace_path: Path) -> Dict[str, Any]:
    """Test ingestion action."""
    print(f"\n=== Testing INGEST action ===")
    print(f"Workspace: {workspace_path}")
    
    start_time = time.time()
    
    # Sample conversation
    user_message = "How do I use Python's functools.lru_cache decorator?"
    assistant_message = (
        "The functools.lru_cache decorator provides automatic memoization. "
        "Use @lru_cache(maxsize=128) above your function. It caches the last "
        "N function calls. For unlimited cache, use maxsize=None. Example:\n\n"
        "@lru_cache(maxsize=128)\n"
        "def fibonacci(n):\n"
        "    if n < 2:\n"
        "        return n\n"
        "    return fibonacci(n-1) + fibonacci(n-2)"
    )
    importance = 0.8
    
    print(f"User message: {user_message[:50]}...")
    print(f"Assistant message length: {len(assistant_message)} chars")
    print(f"Importance: {importance}")
    
    try:
        from ingest import ingest_conversation
        
        result = await ingest_conversation(
            str(workspace_path),
            user_message,
            assistant_message,
            importance
        )
        
        elapsed = time.time() - start_time
        print(f"✓ Ingest completed in {elapsed:.2f}s")
        print(f"Result: {json.dumps(result, indent=2)}")
        
        # Check data directory has content
        data_dir = workspace_path / '.cognee_data'
        if data_dir.exists():
            file_count = len(list(data_dir.rglob('*')))
            print(f"✓ Data directory contains {file_count} files/folders")
        else:
            print(f"✗ Data directory NOT found: {data_dir}")
        
        return {'success': True, 'elapsed': elapsed, 'result': result}
        
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"✗ Ingest failed after {elapsed:.2f}s")
        print(f"Error: {type(e).__name__}: {str(e)}")
        return {'success': False, 'elapsed': elapsed, 'error': str(e)}


async def test_retrieve(workspace_path: Path) -> Dict[str, Any]:
    """Test retrieval action."""
    print(f"\n=== Testing RETRIEVE action ===")
    print(f"Workspace: {workspace_path}")
    
    start_time = time.time()
    
    # Sample query
    query = "How do I cache function results in Python?"
    
    print(f"Query: {query}")
    
    try:
        from retrieve import retrieve_context
        
        result = await retrieve_context(str(workspace_path), query)
        
        elapsed = time.time() - start_time
        print(f"✓ Retrieve completed in {elapsed:.2f}s")
        print(f"Result: {json.dumps(result, indent=2)}")
        
        if result.get('success') and result.get('results'):
            print(f"✓ Retrieved {len(result['results'])} results")
        else:
            print(f"✗ No results retrieved")
        
        return {'success': True, 'elapsed': elapsed, 'result': result}
        
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"✗ Retrieve failed after {elapsed:.2f}s")
        print(f"Error: {type(e).__name__}: {str(e)}")
        return {'success': False, 'elapsed': elapsed, 'error': str(e)}


async def test_clear(workspace_path: Path) -> Dict[str, Any]:
    """Test clear action."""
    print(f"\n=== Testing CLEAR action ===")
    print(f"Workspace: {workspace_path}")
    
    start_time = time.time()
    
    try:
        import cognee
        from dotenv import load_dotenv
        
        # Load environment
        env_file = workspace_path / '.env'
        if env_file.exists():
            load_dotenv(env_file)
        
        # Configure Cognee for this workspace
        system_dir = workspace_path / '.cognee_system'
        data_dir = workspace_path / '.cognee_data'
        
        cognee.config.system_root_directory(str(system_dir))
        cognee.config.data_root_directory(str(data_dir))
        
        # Clear data
        await cognee.prune.prune_system()
        
        elapsed = time.time() - start_time
        print(f"✓ Clear completed in {elapsed:.2f}s")
        
        # Check directories were cleared
        if system_dir.exists():
            file_count = len(list(system_dir.rglob('*')))
            print(f"System directory: {file_count} files/folders remaining")
        
        if data_dir.exists():
            file_count = len(list(data_dir.rglob('*')))
            print(f"Data directory: {file_count} files/folders remaining")
        
        return {'success': True, 'elapsed': elapsed}
        
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"✗ Clear failed after {elapsed:.2f}s")
        print(f"Error: {type(e).__name__}: {str(e)}")
        return {'success': False, 'elapsed': elapsed, 'error': str(e)}


async def main():
    """Main entry point for manual test harness."""
    parser = argparse.ArgumentParser(
        description='Manual E2E test harness for Cognee bridge scripts',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python manual_test.py --action init --workspace /path/to/test-workspace
  python manual_test.py --action ingest --workspace /path/to/test-workspace
  python manual_test.py --action retrieve --workspace /path/to/test-workspace
  python manual_test.py --action clear --workspace /path/to/test-workspace
  
  Run all actions in sequence:
  python manual_test.py --action all --workspace /path/to/test-workspace
        """
    )
    
    parser.add_argument(
        '--action',
        required=True,
        choices=['init', 'ingest', 'retrieve', 'clear', 'all'],
        help='Action to test'
    )
    
    parser.add_argument(
        '--workspace',
        required=True,
        type=str,
        help='Path to test workspace directory'
    )
    
    args = parser.parse_args()
    
    # Validate workspace path
    workspace_path = Path(args.workspace)
    if not workspace_path.exists():
        print(f"Error: Workspace path does not exist: {workspace_path}")
        sys.exit(1)
    
    if not workspace_path.is_dir():
        print(f"Error: Workspace path is not a directory: {workspace_path}")
        sys.exit(1)
    
    # Load environment variables
    env_vars = load_env_file(workspace_path)
    if env_vars:
        import os
        for key, value in env_vars.items():
            os.environ[key] = value
    
    # Check for LLM_API_KEY
    import os
    if 'LLM_API_KEY' not in os.environ:
        print("Warning: LLM_API_KEY not found in environment or .env file")
        print("Some operations may fail")
    
    # Run requested action(s)
    results = {}
    
    if args.action == 'all':
        print("\n" + "="*60)
        print("Running ALL actions in sequence")
        print("="*60)
        
        results['init'] = await test_init(workspace_path)
        results['ingest'] = await test_ingest(workspace_path)
        results['retrieve'] = await test_retrieve(workspace_path)
        results['clear'] = await test_clear(workspace_path)
        
    else:
        if args.action == 'init':
            results['init'] = await test_init(workspace_path)
        elif args.action == 'ingest':
            results['ingest'] = await test_ingest(workspace_path)
        elif args.action == 'retrieve':
            results['retrieve'] = await test_retrieve(workspace_path)
        elif args.action == 'clear':
            results['clear'] = await test_clear(workspace_path)
    
    # Print summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    
    total_time = sum(r.get('elapsed', 0) for r in results.values())
    success_count = sum(1 for r in results.values() if r.get('success'))
    
    for action, result in results.items():
        status = "✓ PASS" if result.get('success') else "✗ FAIL"
        elapsed = result.get('elapsed', 0)
        print(f"{action.upper():10s} {status:10s} ({elapsed:.2f}s)")
    
    print(f"\nTotal: {success_count}/{len(results)} passed in {total_time:.2f}s")
    
    # Exit with appropriate code
    if success_count == len(results):
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())
