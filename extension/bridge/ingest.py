#!/usr/bin/env python3
"""
Cognee Conversation Ingestion Script for VS Code Extension - Plan 017

Usage Modes:
  Sync (diagnostic):     python ingest.py --mode sync --summary --summary-json '<json>'
                         OR: python ingest.py --mode sync <workspace_path> <user_msg> <asst_msg> [importance]
  Add-only (production): python ingest.py --mode add-only --summary --summary-json '<json>'
  Cognify-only (background): python ingest.py --mode cognify-only --operation-id <uuid> <workspace_path>

Returns JSON to stdout:
  Success: {"success": true, "ingested_chars": 357, "timestamp": "2025-11-09T14:32:21.234Z", "staged": true/false}
  Failure: {"success": false, "error": "error message", "error_code": "ERROR_CODE"}
"""

import asyncio
import json
import os
import sys
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from time import perf_counter

from workspace_utils import generate_dataset_name


def setup_environment(workspace_path: str):
    """
    Shared environment setup for all ingestion modes.
    
    Returns:
        tuple: (dataset_name, api_key, cognee_config_dict) or raises exception
    """
    from dotenv import load_dotenv
    
    workspace_dir = Path(workspace_path)
    env_file = workspace_dir / '.env'
    
    if env_file.exists():
        load_dotenv(env_file)
    
    # Check for API key
    api_key = os.getenv('LLM_API_KEY')
    if not api_key:
        raise ValueError('LLM_API_KEY not found in environment or .env file')
    
    # Generate dataset name
    dataset_name, _ = generate_dataset_name(workspace_path)
    
    # Return config
    return dataset_name, api_key, {
        'system_root': str(workspace_dir / '.cognee_system'),
        'data_root': str(workspace_dir / '.cognee_data'),
        'workspace_dir': workspace_dir
    }


def write_status_stub(operation_id: str, workspace_dir: Path, success: bool, 
                       error_code: str = None, error_message: str = None, 
                       remediation: str = None, elapsed_ms: int = 0, entity_count: int = None):
    """
    Write status stub atomically to .cognee/background_ops/<operation_id>.json
    
    Uses atomic temp file + rename pattern to prevent corruption.
    """
    stub_dir = workspace_dir / '.cognee' / 'background_ops'
    stub_dir.mkdir(parents=True, exist_ok=True)
    
    stub_data = {
        'operation_id': operation_id,
        'success': success,
        'error_code': error_code,
        'error_message': error_message,
        'remediation': remediation,
        'elapsed_ms': elapsed_ms,
        'entity_count': entity_count,
        'timestamp': datetime.now().isoformat()
    }
    
    # Atomic write: temp file + rename
    stub_path = stub_dir / f'{operation_id}.json'
    with tempfile.NamedTemporaryFile(mode='w', dir=stub_dir, delete=False, suffix='.tmp') as f:
        json.dump(stub_data, f, indent=2)
        temp_path = f.name
    
    # Atomic rename (POSIX guarantee)
    os.replace(temp_path, stub_path)


def create_summary_text(summary_json: dict) -> str:
    """Create enriched summary text with embedded metadata per §4.4.1"""
    TEMPLATE_VERSION = "1.1"
    
    # Validate required timestamp fields (camelCase from TypeScript)
    created_ts = summary_json.get('createdAt')
    updated_ts = summary_json.get('updatedAt')
    source_created_ts = summary_json.get('sourceCreatedAt') or 'N/A'
    
    if not created_ts:
        raise ValueError('Summary missing required "createdAt" field (ISO 8601 timestamp)')
    if not updated_ts:
        raise ValueError('Summary missing required "updatedAt" field (ISO 8601 timestamp)')
    
    # Format lists with (none) marker for empty sections
    def format_list(items):
        if not items or len(items) == 0:
            return '(none)'
        return '\n'.join(f'- {item}' for item in items)
    
    # Format summary with metadata embedded (Cognee 0.3.4 enriched-text fallback per §4.4.1)
    topic_id = summary_json.get('topicId') or 'N/A'
    session_id = summary_json.get('sessionId') or 'N/A'
    plan_id = summary_json.get('planId') or 'N/A'
    status = summary_json.get('status', 'Active') or 'Active'

    summary_text = f"""<!-- Template: v{TEMPLATE_VERSION} -->
# Conversation Summary: {summary_json['topic']}

**Metadata:**
- Topic ID: {topic_id}
- Session ID: {session_id}
- Plan ID: {plan_id}
- Status: {status}
- Created: {created_ts}
- Source Created: {source_created_ts}
- Updated: {updated_ts}

## Context
{summary_json['context']}

## Key Decisions
{format_list(summary_json.get('decisions', []))}

## Rationale
{format_list(summary_json.get('rationale', []))}

## Open Questions
{format_list(summary_json.get('openQuestions', []))}

## Next Steps
{format_list(summary_json.get('nextSteps', []))}

## References
{format_list(summary_json.get('references', []))}

## Time Scope
{summary_json.get('timeScope', '(not specified)')}
"""
    
    return summary_text, created_ts


async def run_add_only(
    summary_json: dict | None = None,
    workspace_path: str | None = None,
    user_message: str | None = None,
    assistant_message: str | None = None,
    importance: float = 0.0
) -> dict:
    """Stage data for ingestion without cognify(). Supports summary and conversation payloads."""
    try:
        payload_type = 'summary' if summary_json else 'conversation'
        if summary_json:
            workspace_path = summary_json.get('workspace_path')
        
        if not workspace_path:
            return {
                'success': False,
                'error_code': 'MISSING_WORKSPACE_PATH',
                'error': 'Add-only mode requires workspace_path'
            }
        
        if payload_type == 'conversation' and (not user_message or not assistant_message):
            return {
                'success': False,
                'error_code': 'INVALID_CONVERSATION_PAYLOAD',
                'error': 'Conversation ingestion requires user and assistant messages'
            }
        
        print(
            f"[PROGRESS] Add-only mode ({payload_type}): workspace={workspace_path}",
            file=sys.stderr,
            flush=True
        )
        metrics = {}
        overall_start = perf_counter()
        
        # Step 1: Setup environment
        print("[PROGRESS] Setting up environment", file=sys.stderr, flush=True)
        step_start = perf_counter()
        dataset_name, api_key, cognee_config = setup_environment(workspace_path)
        metrics['setup_env_sec'] = perf_counter() - step_start
        
        # Step 2: Import and configure cognee
        print("[PROGRESS] Importing cognee SDK", file=sys.stderr, flush=True)
        step_start = perf_counter()
        
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            import cognee
        finally:
            sys.stdout = old_stdout
        
        cognee.config.system_root_directory(cognee_config['system_root'])
        cognee.config.data_root_directory(cognee_config['data_root'])
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
        metrics['init_cognee_sec'] = perf_counter() - step_start
        
        # Step 3: Create enriched summary text
        step_start = perf_counter()
        if payload_type == 'summary':
            summary_text, created_ts = create_summary_text(summary_json)
        else:
            created_ts = datetime.now().isoformat()
            summary_text = f"""<!-- Conversation Capture: async add-only -->\n# Captured Conversation\n\n**Metadata:**\n- Created: {created_ts}\n- Importance: {importance}\n\n## User Message\n{user_message}\n\n## Assistant Response\n{assistant_message}\n"""
        metrics['create_summary_text_sec'] = perf_counter() - step_start
        
        # Step 4: Add enriched summary text to dataset (NO cognify)
        print(f"[PROGRESS] Add completed: {len(summary_text)} chars staged", file=sys.stderr, flush=True)
        step_start = perf_counter()
        
        await cognee.add(
            data=[summary_text],
            dataset_name=dataset_name
        )
        
        metrics['add_sec'] = perf_counter() - step_start
        metrics['total_add_sec'] = perf_counter() - overall_start
        
        print(f"Add-only duration: {metrics['total_add_sec']:.3f} seconds", file=sys.stderr)
        print(f"[PROGRESS] Add completed", file=sys.stderr, flush=True)
        
        # Return success with staged=True
        return {
            'success': True,
            'ingested_chars': len(summary_text),
            'timestamp': created_ts,
            'staged': True,
            'payload_type': payload_type,
            'ingestion_duration_sec': metrics['total_add_sec'],
            'ingestion_metrics': metrics
        }
        
    except ValueError as e:
        error_payload = {
            'success': False,
            'error_code': 'MISSING_API_KEY',
            'error': str(e)
        }
        print(f"[ERROR] {json.dumps(error_payload)}", file=sys.stderr)
        return error_payload
    except ImportError as e:
        error_payload = {
            'success': False,
            'error_code': 'PYTHON_ENV_ERROR',
            'error_type': 'ImportError',
            'message': f'Failed to import required module: {str(e)}',
            'error': f'Failed to import required module: {str(e)}'
        }
        print(f"[ERROR] {json.dumps(error_payload)}", file=sys.stderr)
        return error_payload
    except Exception as e:
        import traceback
        error_payload = {
            'success': False,
            'error_code': 'COGNEE_SDK_ERROR',
            'error_type': type(e).__name__,
            'message': str(e),
            'traceback': traceback.format_exc(),
            'error': f'Add-only failed ({type(e).__name__}): {str(e)}'
        }
        print(f"[ERROR] {json.dumps(error_payload)}", file=sys.stderr)
        return error_payload


async def run_cognify_only(workspace_path: str, operation_id: str) -> dict:
    """
    Cognify-only mode: Run cognify() on previously staged data.
    
    Args:
        workspace_path: Absolute path to VS Code workspace root
        operation_id: UUID identifying this background operation
    
    Returns:
        Dictionary with success status, elapsed_ms, entity_count or error
    """
    workspace_dir = Path(workspace_path)
    
    try:
        print(f"[PROGRESS] Cognify-only mode: operation_id={operation_id}", file=sys.stderr, flush=True)
        overall_start = perf_counter()
        
        # Step 1: Setup environment
        print("[PROGRESS] Setting up environment", file=sys.stderr, flush=True)
        dataset_name, api_key, cognee_config = setup_environment(workspace_path)
        
        # Step 2: Import and configure cognee
        print("[PROGRESS] Importing cognee SDK", file=sys.stderr, flush=True)
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            import cognee
        finally:
            sys.stdout = old_stdout
        
        cognee.config.system_root_directory(cognee_config['system_root'])
        cognee.config.data_root_directory(cognee_config['data_root'])
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
        
        # Step 3: Run cognify on dataset
        print(f"[PROGRESS] Cognify started (this may take 30-90s)", file=sys.stderr, flush=True)
        start_time = perf_counter()
        
        await cognee.cognify(datasets=[dataset_name])
        
        elapsed_ms = int((perf_counter() - start_time) * 1000)
        
        print(f"[PROGRESS] Cognify completed in {elapsed_ms}ms", file=sys.stderr, flush=True)
        
        # Write success stub
        write_status_stub(
            operation_id=operation_id,
            workspace_dir=workspace_dir,
            success=True,
            elapsed_ms=elapsed_ms,
            entity_count=None  # Cognee SDK doesn't provide this reliably
        )
        
        return {
            'success': True,
            'operation_id': operation_id,
            'elapsed_ms': elapsed_ms,
            'entity_count': None
        }
        
    except ValueError as e:
        elapsed_ms = int((perf_counter() - overall_start) * 1000)
        error_code = 'MISSING_API_KEY'
        error_message = str(e)
        remediation = 'Add LLM_API_KEY=sk-... to workspace .env file'
        
        write_status_stub(
            operation_id=operation_id,
            workspace_dir=workspace_dir,
            success=False,
            error_code=error_code,
            error_message=error_message,
            remediation=remediation,
            elapsed_ms=elapsed_ms
        )
        
        error_payload = {
            'success': False,
            'error_code': error_code,
            'error': error_message
        }
        print(f"[ERROR] {json.dumps(error_payload)}", file=sys.stderr)
        return error_payload
        
    except ImportError as e:
        elapsed_ms = int((perf_counter() - overall_start) * 1000)
        error_code = 'PYTHON_ENV_ERROR'
        error_message = f'Failed to import required module: {str(e)}'
        remediation = 'Run: pip install -r extension/bridge/requirements.txt'
        
        write_status_stub(
            operation_id=operation_id,
            workspace_dir=workspace_dir,
            success=False,
            error_code=error_code,
            error_message=error_message,
            remediation=remediation,
            elapsed_ms=elapsed_ms
        )
        
        error_payload = {
            'success': False,
            'error_code': error_code,
            'error': error_message
        }
        print(f"[ERROR] {json.dumps(error_payload)}", file=sys.stderr)
        return error_payload
        
    except Exception as e:
        import traceback
        elapsed_ms = int((perf_counter() - overall_start) * 1000)
        error_code = 'COGNEE_SDK_ERROR'
        error_message = str(e)
        remediation = 'Check API key validity and network connectivity. View logs for details.'
        
        write_status_stub(
            operation_id=operation_id,
            workspace_dir=workspace_dir,
            success=False,
            error_code=error_code,
            error_message=error_message,
            remediation=remediation,
            elapsed_ms=elapsed_ms
        )
        
        error_payload = {
            'success': False,
            'error_code': error_code,
            'error_type': type(e).__name__,
            'message': error_message,
            'traceback': traceback.format_exc(),
            'error': f'Cognify failed ({type(e).__name__}): {error_message}'
        }
        print(f"[ERROR] {json.dumps(error_payload)}", file=sys.stderr)
        return error_payload


async def run_sync(summary_json: dict = None, workspace_path: str = None, 
                   user_message: str = None, assistant_message: str = None,
                   importance: float = 0.0) -> dict:
    """
    Sync mode: Complete add() + cognify() in single subprocess (diagnostic/test only).
    
    Supports both summary and conversation modes.
    """
    try:
        # Determine mode from arguments
        if summary_json:
            workspace_path = summary_json.get('workspace_path')
            if not workspace_path:
                return {
                    'success': False,
                    'error_code': 'MISSING_WORKSPACE_PATH',
                    'error': 'Summary JSON must include workspace_path field'
                }
            
            print(f"[PROGRESS] Sync mode (summary): topic={summary_json.get('topic', 'unknown')[:50]}", file=sys.stderr, flush=True)
        else:
            print(f"[PROGRESS] Sync mode (conversation): user_msg={user_message[:50]}...", file=sys.stderr, flush=True)
        
        metrics = {}
        overall_start = perf_counter()
        
        # Step 1: Setup environment
        print("[PROGRESS] Setting up environment", file=sys.stderr, flush=True)
        step_start = perf_counter()
        dataset_name, api_key, cognee_config = setup_environment(workspace_path)
        metrics['setup_env_sec'] = perf_counter() - step_start
        
        # Step 2: Import and configure cognee
        print("[PROGRESS] Importing cognee SDK", file=sys.stderr, flush=True)
        step_start = perf_counter()
        
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            import cognee
        finally:
            sys.stdout = old_stdout
        
        cognee.config.system_root_directory(cognee_config['system_root'])
        cognee.config.data_root_directory(cognee_config['data_root'])
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
        metrics['init_cognee_sec'] = perf_counter() - step_start
        
        # Step 3: Create text content
        step_start = perf_counter()
        if summary_json:
            text_content, timestamp = create_summary_text(summary_json)
        else:
            timestamp = datetime.now().isoformat()
            text_content = f"""User asked: {user_message}

Assistant answered: {assistant_message}

Metadata: timestamp={timestamp}, importance={importance}"""
        
        metrics['create_text_sec'] = perf_counter() - step_start
        
        # Step 4: Add to dataset
        print(f"[PROGRESS] Adding to dataset: {len(text_content)} chars", file=sys.stderr, flush=True)
        step_start = perf_counter()
        
        await cognee.add(
            data=[text_content],
            dataset_name=dataset_name
        )
        
        metrics['add_sec'] = perf_counter() - step_start
        
        # Step 5: Cognify
        print(f"[PROGRESS] Running cognify (this may take 30-90s)", file=sys.stderr, flush=True)
        step_start = perf_counter()
        
        await cognee.cognify(datasets=[dataset_name])
        
        metrics['cognify_sec'] = perf_counter() - step_start
        metrics['total_sync_sec'] = perf_counter() - overall_start
        
        print(f"Sync ingestion duration: {metrics['total_sync_sec']:.3f} seconds", file=sys.stderr)
        print(f"Sync ingestion metrics: {json.dumps(metrics)}", file=sys.stderr)
        
        return {
            'success': True,
            'ingested_chars': len(text_content),
            'timestamp': timestamp,
            'staged': False,  # sync mode completes cognify immediately
            'ingestion_duration_sec': metrics['total_sync_sec'],
            'ingestion_metrics': metrics
        }
        
    except ValueError as e:
        error_payload = {
            'success': False,
            'error_code': 'MISSING_API_KEY',
            'error': str(e)
        }
        print(f"[ERROR] {json.dumps(error_payload)}", file=sys.stderr)
        return error_payload
    except ImportError as e:
        error_payload = {
            'success': False,
            'error_code': 'PYTHON_ENV_ERROR',
            'error_type': 'ImportError',
            'message': f'Failed to import required module: {str(e)}',
            'error': f'Failed to import required module: {str(e)}'
        }
        print(f"[ERROR] {json.dumps(error_payload)}", file=sys.stderr)
        return error_payload
    except Exception as e:
        import traceback
        error_payload = {
            'success': False,
            'error_code': 'COGNEE_SDK_ERROR',
            'error_type': type(e).__name__,
            'message': str(e),
            'traceback': traceback.format_exc(),
            'error': f'Sync ingestion failed ({type(e).__name__}): {str(e)}'
        }
        print(f"[ERROR] {json.dumps(error_payload)}", file=sys.stderr)
        return error_payload


def main():
    """Main entry point for the script."""
    try:
        # Parse --mode flag
        mode = 'sync'  # default for backward compatibility
        if '--mode' in sys.argv:
            mode_idx = sys.argv.index('--mode')
            if mode_idx + 1 >= len(sys.argv):
                result = {'success': False, 'error': '--mode requires argument: sync|add-only|cognify-only'}
                print(json.dumps(result))
                sys.exit(1)
            mode = sys.argv[mode_idx + 1]
            if mode not in ['sync', 'add-only', 'cognify-only']:
                result = {'success': False, 'error': f'Invalid mode: {mode}. Must be sync|add-only|cognify-only'}
                print(json.dumps(result))
                sys.exit(1)
        
        # Dispatch based on mode
        if mode == 'cognify-only':
            # Cognify-only requires --operation-id and workspace_path
            if '--operation-id' not in sys.argv:
                result = {'success': False, 'error': 'cognify-only mode requires --operation-id <uuid>'}
                print(json.dumps(result))
                sys.exit(1)
            
            op_id_idx = sys.argv.index('--operation-id')
            if op_id_idx + 1 >= len(sys.argv):
                result = {'success': False, 'error': '--operation-id requires UUID argument'}
                print(json.dumps(result))
                sys.exit(1)
            
            operation_id = sys.argv[op_id_idx + 1]
            
            # Validate UUID format
            try:
                uuid.UUID(operation_id)
            except ValueError:
                result = {'success': False, 'error': f'Invalid UUID format for operation_id: {operation_id}'}
                print(json.dumps(result))
                sys.exit(1)
            
            # Get workspace path (first positional arg after all flags)
            positional_args = [arg for arg in sys.argv[1:] if not arg.startswith('--') and arg != operation_id and arg != mode]
            if len(positional_args) < 1:
                result = {'success': False, 'error': 'cognify-only mode requires workspace_path as positional argument'}
                print(json.dumps(result))
                sys.exit(1)
            
            workspace_path = positional_args[0]
            if not Path(workspace_path).is_dir():
                result = {'success': False, 'error': f'Workspace path does not exist: {workspace_path}'}
                print(json.dumps(result))
                sys.exit(1)
            
            result = asyncio.run(run_cognify_only(workspace_path, operation_id))
            
        elif '--summary' in sys.argv:
            # Summary mode (add-only or sync)
            if '--summary-json' not in sys.argv:
                result = {'success': False, 'error': '--summary requires --summary-json <json>'}
                print(json.dumps(result))
                sys.exit(1)
            
            summary_json_idx = sys.argv.index('--summary-json')
            if summary_json_idx + 1 >= len(sys.argv):
                result = {'success': False, 'error': '--summary-json requires JSON string argument'}
                print(json.dumps(result))
                sys.exit(1)
            
            summary_json_str = sys.argv[summary_json_idx + 1]
            summary_json = json.loads(summary_json_str)
            
            if mode == 'add-only':
                result = asyncio.run(run_add_only(summary_json=summary_json))
            else:  # sync
                result = asyncio.run(run_sync(summary_json=summary_json))
                
        else:
            # Conversation mode (supports add-only + sync)
            # Get positional args (excluding --mode and mode value)
            positional_args = [arg for arg in sys.argv[1:] if not arg.startswith('--') and arg != mode]
            
            if len(positional_args) < 3:
                result = {
                    'success': False,
                    'error': 'Missing required arguments: workspace_path, user_message, assistant_message'
                }
                print(json.dumps(result))
                sys.exit(1)
            
            workspace_path = positional_args[0]
            user_message = positional_args[1]
            assistant_message = positional_args[2]
            
            importance = 0.0
            if len(positional_args) >= 4:
                try:
                    importance = float(positional_args[3])
                    importance = max(0.0, min(1.0, importance))
                except ValueError:
                    result = {'success': False, 'error': f'Invalid importance value: {positional_args[3]}'}
                    print(json.dumps(result))
                    sys.exit(1)
            
            if not Path(workspace_path).is_dir():
                result = {'success': False, 'error': f'Workspace path does not exist: {workspace_path}'}
                print(json.dumps(result))
                sys.exit(1)
            
            if mode == 'add-only':
                result = asyncio.run(run_add_only(
                    workspace_path=workspace_path,
                    user_message=user_message,
                    assistant_message=assistant_message,
                    importance=importance
                ))
            else:
                result = asyncio.run(run_sync(
                    workspace_path=workspace_path,
                    user_message=user_message,
                    assistant_message=assistant_message,
                    importance=importance
                ))
        
        # Output JSON result
        print(json.dumps(result))
        sys.exit(0 if result['success'] else 1)
        
    except json.JSONDecodeError as e:
        result = {'success': False, 'error': f'Invalid JSON: {str(e)}'}
        print(json.dumps(result))
        sys.exit(1)
    except Exception as e:
        import traceback
        result = {
            'success': False,
            'error': f'Unexpected error: {str(e)}',
            'traceback': traceback.format_exc()
        }
        print(json.dumps(result))
        sys.exit(1)


if __name__ == '__main__':
    main()
