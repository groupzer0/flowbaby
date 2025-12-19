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
import signal
import sys
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from time import perf_counter

# Add bridge directory to path to import bridge_logger
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import bridge_logger
from workspace_utils import canonicalize_workspace_path, generate_dataset_name


def setup_environment(workspace_path: str):
    """
    Shared environment setup for all ingestion modes.

    Plan 032 M2 (hotfix): Sets SYSTEM_ROOT_DIRECTORY and DATA_ROOT_DIRECTORY
    environment variables BEFORE any import of cognee SDK, to ensure the SDK
    uses workspace-local paths instead of defaulting to ~/.cognee_data.

    CRITICAL: The Cognee SDK uses pydantic-settings which reads environment
    variables matching the field names (DATA_ROOT_DIRECTORY, SYSTEM_ROOT_DIRECTORY)
    NOT prefixed with COGNEE_. The original Plan 032 incorrectly used COGNEE_ prefix.

    Plan 039 M5: Workspace .env loading removed per Plan 037 F2 security finding.
    API key is now resolved by TypeScript and passed via LLM_API_KEY environment variable.

    Plan 059: Added filesystem cache backend configuration (CACHE_BACKEND=fs).
    Cognee 0.5.1+ supports filesystem session caching via diskcache, removing
    the implicit Redis dependency that caused connection failures in managed environments.

    Returns:
        tuple: (dataset_name, api_key, cognee_config_dict) or raises exception
    """
    workspace_dir = Path(workspace_path)

    # Check for API key (provided by TypeScript via LLM_API_KEY environment variable)
    api_key = os.getenv('LLM_API_KEY')
    if not api_key:
        raise ValueError('LLM_API_KEY not found in environment. Use "Flowbaby: Set API Key" for secure storage.')

    # Plan 032 M2 (hotfix): Set Cognee environment variables BEFORE SDK import
    # CRITICAL: Use DATA_ROOT_DIRECTORY and SYSTEM_ROOT_DIRECTORY (no COGNEE_ prefix!)
    # The Cognee SDK's BaseConfig uses pydantic-settings which reads these env vars
    system_root = str(workspace_dir / '.flowbaby/system')
    data_root = str(workspace_dir / '.flowbaby/data')
    cache_root = str(workspace_dir / '.flowbaby/cache')

    os.environ['SYSTEM_ROOT_DIRECTORY'] = system_root
    os.environ['DATA_ROOT_DIRECTORY'] = data_root
    os.environ['CACHE_ROOT_DIRECTORY'] = cache_root

    # Plan 059: Configure caching with filesystem backend
    # Respect explicit user configuration (precedence rule 1)
    if os.environ.get('CACHING') is None:
        os.environ['CACHING'] = 'true'
    if os.environ.get('CACHE_BACKEND') is None:
        os.environ['CACHE_BACKEND'] = 'fs'

    # Also ensure the directories exist
    Path(system_root).mkdir(parents=True, exist_ok=True)
    Path(data_root).mkdir(parents=True, exist_ok=True)
    Path(cache_root).mkdir(parents=True, exist_ok=True)

    # Generate dataset name
    dataset_name, _ = generate_dataset_name(workspace_path)

    # Return config
    return dataset_name, api_key, {
        'system_root': system_root,
        'data_root': data_root,
        'cache_root': cache_root,
        'caching': os.environ.get('CACHING'),
        'cache_backend': os.environ.get('CACHE_BACKEND'),
        'workspace_dir': workspace_dir
    }



def write_status_stub(operation_id: str, workspace_dir: Path, success: bool,
                       error_code: str = None, error_message: str = None,
                       remediation: str = None, elapsed_ms: int = 0, entity_count: int = None):
    """
    Write status stub atomically to .flowbaby/background_ops/<operation_id>.json

    Uses atomic temp file + rename pattern to prevent corruption.
    """
    stub_dir = workspace_dir / '.flowbaby' / 'background_ops'
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
    importance: float = 0.0,
    session_id: str | None = None
) -> dict:
    """Stage data for ingestion without cognify(). Supports summary and conversation payloads."""

    # Initialize logger (will be configured with workspace path once known)
    logger = None

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

        # Setup logging now that we have workspace_path
        logger = bridge_logger.setup_logging(workspace_path, "ingest")

        if payload_type == 'conversation' and (not user_message or not assistant_message):
            return {
                'success': False,
                'error_code': 'INVALID_CONVERSATION_PAYLOAD',
                'error': 'Conversation ingestion requires user and assistant messages'
            }

        # Redact session_id for privacy
        safe_session_id = f"{session_id[:4]}..." if session_id and len(session_id) > 4 else "N/A"
        logger.info(f"Add-only mode ({payload_type})", extra={'data': {'workspace': workspace_path, 'session_id': safe_session_id}})
        metrics = {}
        overall_start = perf_counter()

        # Step 1: Setup environment
        logger.debug("Setting up environment")
        step_start = perf_counter()
        dataset_name, api_key, cognee_config = setup_environment(workspace_path)
        metrics['setup_env_sec'] = perf_counter() - step_start

        # Step 2: Import and configure cognee
        logger.debug("Importing cognee SDK")
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
        logger.info(f"Add completed: {len(summary_text)} chars staged")
        step_start = perf_counter()

        # Plan 048: Pass session_id if present (requires cognee support, fallback if not)
        # Verified: cognee.add (v0.3.4) does NOT support session_id.
        # We will proceed without passing it to avoid TypeErrors and log warnings.
        add_kwargs = {'data': [summary_text], 'dataset_name': dataset_name}

        await cognee.add(**add_kwargs)

        metrics['add_sec'] = perf_counter() - step_start
        metrics['total_add_sec'] = perf_counter() - overall_start

        logger.info(f"Add-only duration: {metrics['total_add_sec']:.3f} seconds")

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
        if logger:
            logger.error("Missing API key", extra={'data': error_payload})
        else:
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
        if logger:
            logger.error("Import error", extra={'data': error_payload})
        else:
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
        if logger:
            logger.error("Add-only failed", extra={'data': error_payload})
        else:
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

    # Initialize logger
    logger = bridge_logger.setup_logging(workspace_path, "ingest_bg")

    # Register signal handlers to capture termination
    def signal_handler(signum, frame):
        logger.error(f"Process terminated by signal {signum}")
        write_status_stub(
            operation_id=operation_id,
            workspace_dir=workspace_dir,
            success=False,
            error_code='PROCESS_TERMINATED',
            error_message=f'Process terminated by signal {signum}',
            remediation='Retry the operation.'
        )
        sys.exit(1)

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    try:
        logger.info(f"Cognify-only mode: operation_id={operation_id}")
        overall_start = perf_counter()

        # Step 1: Setup environment
        logger.debug("Setting up environment")
        dataset_name, api_key, cognee_config = setup_environment(workspace_path)

        # Step 2: Import and configure cognee
        logger.debug("Importing cognee SDK")
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
        logger.info("Cognify started (this may take 30-90s)")
        start_time = perf_counter()

        await cognee.cognify(datasets=[dataset_name])

        elapsed_ms = int((perf_counter() - start_time) * 1000)

        logger.info(f"Cognify completed in {elapsed_ms}ms")

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
        logger.error("Missing API key", extra={'data': error_payload})
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
        logger.error("Import error", extra={'data': error_payload})
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
        logger.error("Cognify failed", extra={'data': error_payload})
        return error_payload


async def run_sync(summary_json: dict = None, workspace_path: str = None,
                   user_message: str = None, assistant_message: str = None,
                   importance: float = 0.0, session_id: str | None = None) -> dict:
    """
    Sync mode: Complete add() + cognify() in single subprocess (diagnostic/test only).

    Supports both summary and conversation modes.
    """
    # Initialize logger (will be configured with workspace path once known)
    logger = None

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

            # Setup logging now that we have workspace_path
            logger = bridge_logger.setup_logging(workspace_path, "ingest")
            logger.info(f"Sync mode (summary): topic={summary_json.get('topic', 'unknown')[:50]}, session_id={session_id}")
        else:
            # Setup logging now that we have workspace_path
            if workspace_path:
                logger = bridge_logger.setup_logging(workspace_path, "ingest")

            if logger:
                logger.info(f"Sync mode (conversation): user_msg={user_message[:50]}..., session_id={session_id}")

        metrics = {}
        overall_start = perf_counter()

        # Step 1: Setup environment
        if logger: logger.debug("Setting up environment")
        step_start = perf_counter()
        dataset_name, api_key, cognee_config = setup_environment(workspace_path)
        metrics['setup_env_sec'] = perf_counter() - step_start

        # Step 2: Import and configure cognee
        if logger: logger.debug("Importing cognee SDK")
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
        if logger: logger.info(f"Adding to dataset: {len(text_content)} chars")
        step_start = perf_counter()

        # Plan 048: Pass session_id if present (with fallback)
        add_kwargs = {'data': [text_content], 'dataset_name': dataset_name}
        try:
            if session_id:
                await cognee.add(**add_kwargs, session_id=session_id)
            else:
                await cognee.add(**add_kwargs)
        except TypeError as e:
            if "unexpected keyword argument 'session_id'" in str(e):
                if logger: logger.warning("cognee.add does not support session_id, falling back to legacy call")
                await cognee.add(**add_kwargs)
            else:
                raise e

        metrics['add_sec'] = perf_counter() - step_start

        # Step 5: Cognify
        if logger: logger.info("Running cognify (this may take 30-90s)")
        step_start = perf_counter()

        await cognee.cognify(datasets=[dataset_name])

        metrics['cognify_sec'] = perf_counter() - step_start
        metrics['total_sync_sec'] = perf_counter() - overall_start

        if logger:
            logger.info(f"Sync ingestion duration: {metrics['total_sync_sec']:.3f} seconds")
            logger.debug(f"Sync ingestion metrics: {json.dumps(metrics)}")

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
        if logger:
            logger.error("Missing API key", extra={'data': error_payload})
        else:
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
        if logger:
            logger.error("Import error", extra={'data': error_payload})
        else:
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
        if logger:
            logger.error("Sync ingestion failed", extra={'data': error_payload})
        else:
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
        # Redirect stdout to stderr during execution to prevent library output from polluting JSON result
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            if mode == 'cognify-only':
                # Cognify-only requires --operation-id and workspace_path
                if '--operation-id' not in sys.argv:
                    result = {'success': False, 'error': 'cognify-only mode requires --operation-id <uuid>'}
                    sys.stdout = old_stdout # Restore for print
                    print(json.dumps(result))
                    sys.exit(1)

                op_id_idx = sys.argv.index('--operation-id')
                if op_id_idx + 1 >= len(sys.argv):
                    result = {'success': False, 'error': '--operation-id requires UUID argument'}
                    sys.stdout = old_stdout
                    print(json.dumps(result))
                    sys.exit(1)

                operation_id = sys.argv[op_id_idx + 1]

                # Validate UUID format
                try:
                    uuid.UUID(operation_id)
                except ValueError:
                    result = {'success': False, 'error': f'Invalid UUID format for operation_id: {operation_id}'}
                    sys.stdout = old_stdout
                    print(json.dumps(result))
                    sys.exit(1)

                # Get workspace path (first positional arg after all flags)
                positional_args = [arg for arg in sys.argv[1:] if not arg.startswith('--') and arg != operation_id and arg != mode]
                if len(positional_args) < 1:
                    result = {'success': False, 'error': 'cognify-only mode requires workspace_path as positional argument'}
                    sys.stdout = old_stdout
                    print(json.dumps(result))
                    sys.exit(1)

                workspace_path = positional_args[0]
                try:
                    workspace_path = canonicalize_workspace_path(workspace_path)
                except FileNotFoundError:
                    result = {'success': False, 'error': f'Workspace path does not exist: {positional_args[0]}'}
                    sys.stdout = old_stdout
                    print(json.dumps(result))
                    sys.exit(1)

                result = asyncio.run(run_cognify_only(workspace_path, operation_id))

            elif '--summary' in sys.argv:
                # Summary mode (add-only or sync)
                if '--summary-json' not in sys.argv:
                    result = {'success': False, 'error': '--summary requires --summary-json <json>'}
                    sys.stdout = old_stdout
                    print(json.dumps(result))
                    sys.exit(1)

                summary_json_idx = sys.argv.index('--summary-json')
                if summary_json_idx + 1 >= len(sys.argv):
                    result = {'success': False, 'error': '--summary-json requires JSON string argument'}
                    sys.stdout = old_stdout
                    print(json.dumps(result))
                    sys.exit(1)

                summary_json_str = sys.argv[summary_json_idx + 1]
                summary_json = json.loads(summary_json_str)

                # Plan 048: Extract session ID from hidden field
                session_id = summary_json.get('__user_session_id')

                if mode == 'add-only':
                    result = asyncio.run(run_add_only(summary_json=summary_json, session_id=session_id))
                else:  # sync
                    result = asyncio.run(run_sync(summary_json=summary_json, session_id=session_id))

            elif '--conversation-json' in sys.argv:
                # Plan 048: Conversation mode via JSON (supports session ID)
                json_idx = sys.argv.index('--conversation-json')
                if json_idx + 1 >= len(sys.argv):
                    result = {'success': False, 'error': '--conversation-json requires JSON string argument'}
                    sys.stdout = old_stdout
                    print(json.dumps(result))
                    sys.exit(1)

                conv_json_str = sys.argv[json_idx + 1]
                conv_json = json.loads(conv_json_str)

                workspace_path = conv_json.get('workspace_path')
                user_message = conv_json.get('user_message')
                assistant_message = conv_json.get('assistant_message')
                importance = float(conv_json.get('importance', 0.0))
                session_id = conv_json.get('__user_session_id')

                if not workspace_path or not user_message or not assistant_message:
                    result = {'success': False, 'error': 'Missing required fields in conversation JSON'}
                    sys.stdout = old_stdout
                    print(json.dumps(result))
                    sys.exit(1)

                try:
                    workspace_path = canonicalize_workspace_path(workspace_path)
                except FileNotFoundError:
                    result = {'success': False, 'error': f'Workspace path does not exist: {workspace_path}'}
                    sys.stdout = old_stdout
                    print(json.dumps(result))
                    sys.exit(1)

                if mode == 'add-only':
                    result = asyncio.run(run_add_only(
                        workspace_path=workspace_path,
                        user_message=user_message,
                        assistant_message=assistant_message,
                        importance=importance,
                        session_id=session_id
                    ))
                else:
                    result = asyncio.run(run_sync(
                        workspace_path=workspace_path,
                        user_message=user_message,
                        assistant_message=assistant_message,
                        importance=importance,
                        session_id=session_id
                    ))

            else:
                # Conversation mode (supports add-only + sync)
                # Get positional args (excluding --mode and mode value)
                positional_args = [arg for arg in sys.argv[1:] if not arg.startswith('--') and arg != mode]

                if len(positional_args) < 3:
                    result = {
                        'success': False,
                        'error': 'Missing required arguments: workspace_path, user_message, assistant_message'
                    }
                    sys.stdout = old_stdout
                    print(json.dumps(result))
                    sys.exit(1)

                workspace_path = positional_args[0]
                try:
                    workspace_path = canonicalize_workspace_path(workspace_path)
                except FileNotFoundError:
                    result = {'success': False, 'error': f'Workspace path does not exist: {positional_args[0]}'}
                    sys.stdout = old_stdout
                    print(json.dumps(result))
                    sys.exit(1)

                user_message = positional_args[1]
                assistant_message = positional_args[2]

                importance = 0.0
                if len(positional_args) >= 4:
                    try:
                        importance = float(positional_args[3])
                        importance = max(0.0, min(1.0, importance))
                    except ValueError:
                        result = {'success': False, 'error': f'Invalid importance value: {positional_args[3]}'}
                        sys.stdout = old_stdout
                        print(json.dumps(result))
                        sys.exit(1)

                if not Path(workspace_path).is_dir():
                    result = {'success': False, 'error': f'Workspace path does not exist: {workspace_path}'}
                    sys.stdout = old_stdout
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
        finally:
            sys.stdout = old_stdout

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
