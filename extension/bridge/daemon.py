#!/usr/bin/env python3
"""
Flowbaby Bridge Daemon - Plan 054

A long-lived Python process that handles bridge requests over stdio JSON-RPC.
Eliminates per-request Python startup overhead by keeping Cognee imported and warm.

Usage: python daemon.py

Environment Variables:
  FLOWBABY_WORKSPACE_PATH: Required. Absolute path to workspace root.
  LLM_API_KEY: Required for ingest/retrieve operations.
  FLOWBABY_DEBUG_LOGGING: Optional. Enable verbose logging.

Communication:
  - Reads JSON-RPC 2.0 requests from stdin (one per line)
  - Writes JSON-RPC 2.0 responses to stdout (one per line)
  - Logs and progress messages go to stderr

@see agent-output/planning/054-python-bridge-daemon-and-request-latency.md
"""

import asyncio
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

# Add bridge directory to path for local imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Track startup time for uptime reporting
DAEMON_START_TIME = time.time()

# Cognee module reference (imported lazily)
cognee = None
cognee_initialized = False

# Plan 061: Graceful shutdown flag (set by shutdown handler or signal)
shutdown_requested = False


def setup_daemon_logging(workspace_path: str) -> logging.Logger:
    """Configure daemon logging to both file and stderr."""
    log_dir = Path(workspace_path) / '.flowbaby' / 'logs'
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / 'daemon.log'

    # Create logger
    logger = logging.getLogger('flowbaby.daemon')
    logger.setLevel(logging.DEBUG if os.getenv('FLOWBABY_DEBUG_LOGGING', '').lower() in {'1', 'true', 'yes', 'on'} else logging.INFO)

    # Clear existing handlers
    logger.handlers.clear()

    # File handler
    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    file_handler.setLevel(logging.DEBUG)
    file_formatter = logging.Formatter(
        '%(asctime)s [%(levelname)s] %(message)s',
        datefmt='%Y-%m-%dT%H:%M:%S'
    )
    file_handler.setFormatter(file_formatter)
    logger.addHandler(file_handler)

    # Stderr handler (for extension to capture)
    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setLevel(logging.INFO)
    stderr_formatter = logging.Formatter('[%(levelname)s] %(message)s')
    stderr_handler.setFormatter(stderr_formatter)
    logger.addHandler(stderr_handler)

    return logger


def setup_cognee_environment(workspace_path: str, logger: logging.Logger) -> tuple[str, str]:
    """
    Configure Cognee environment variables before importing the SDK.

    Plan 059: Added filesystem cache backend configuration (CACHE_BACKEND=fs).
    Cognee 0.5.1+ supports filesystem session caching via diskcache, removing
    the implicit Redis dependency that caused connection failures in managed environments.

    Environment variable precedence (Plan 059 Milestone 2):
    1. Explicit env var already set in process (e.g., shell) - respected, not overwritten
    2. Flowbaby-managed defaults - applied only when value not already set

    Returns:
        tuple: (dataset_name, api_key_present: bool)
    """
    workspace_dir = Path(workspace_path)

    # Check for API key but don't fail - it may arrive later via request env
    api_key = os.getenv('LLM_API_KEY')
    api_key_present = api_key is not None
    
    if not api_key_present:
        logger.warning('LLM_API_KEY not found in startup environment - will check per-request')

    # Set Cognee environment variables BEFORE SDK import
    system_root = str(workspace_dir / '.flowbaby/system')
    data_root = str(workspace_dir / '.flowbaby/data')
    cache_root = str(workspace_dir / '.flowbaby/cache')

    os.environ['SYSTEM_ROOT_DIRECTORY'] = system_root
    os.environ['DATA_ROOT_DIRECTORY'] = data_root
    os.environ['CACHE_ROOT_DIRECTORY'] = cache_root

    # Plan 059: Configure caching with filesystem backend
    # Respect explicit user configuration (precedence rule 1)
    existing_caching = os.environ.get('CACHING')
    existing_cache_backend = os.environ.get('CACHE_BACKEND')

    if existing_caching is None:
        os.environ['CACHING'] = 'true'
        logger.debug("Set CACHING=true (managed default)")
    else:
        logger.debug(f"Respecting existing CACHING={existing_caching}")

    if existing_cache_backend is None:
        os.environ['CACHE_BACKEND'] = 'fs'
        logger.debug("Set CACHE_BACKEND=fs (managed default - filesystem session cache)")
    else:
        logger.debug(f"Respecting existing CACHE_BACKEND={existing_cache_backend}")

    # Ensure directories exist
    Path(system_root).mkdir(parents=True, exist_ok=True)
    Path(data_root).mkdir(parents=True, exist_ok=True)
    Path(cache_root).mkdir(parents=True, exist_ok=True)

    # Plan 059: Log cache configuration for observability
    effective_caching = os.environ.get('CACHING', 'false')
    effective_backend = os.environ.get('CACHE_BACKEND', 'none')
    logger.info(f"Cache configuration: CACHING={effective_caching}, CACHE_BACKEND={effective_backend}, CACHE_ROOT={cache_root}")
    logger.debug(f"Configured Cognee directories: system={system_root}, data={data_root}")

    # Generate dataset name
    from workspace_utils import generate_dataset_name
    dataset_name, _ = generate_dataset_name(workspace_path)

    return dataset_name, api_key_present


def initialize_cognee(workspace_path: str, logger: logging.Logger) -> None:
    """
    Import and configure Cognee SDK.
    This is called once at daemon startup to amortize import cost.
    
    Note: API key is NOT required at import time - it will be validated per-request.
    """
    global cognee, cognee_initialized

    if cognee_initialized:
        logger.debug("Cognee already initialized")
        return

    logger.info("Initializing Cognee SDK...")
    start_time = time.time()

    # Redirect stdout to stderr during import to avoid polluting JSON-RPC channel
    old_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        import cognee as cognee_module
        cognee = cognee_module
    finally:
        sys.stdout = old_stdout

    workspace_dir = Path(workspace_path)
    system_root = str(workspace_dir / '.flowbaby/system')
    data_root = str(workspace_dir / '.flowbaby/data')

    cognee.config.system_root_directory(system_root)
    cognee.config.data_root_directory(data_root)
    
    # Set API key if available (will be validated per-request in handlers)
    api_key = os.getenv('LLM_API_KEY')
    if api_key:
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
    else:
        logger.debug("LLM_API_KEY not set during initialization - will check per-request")

    cognee_initialized = True
    elapsed = time.time() - start_time
    logger.info(f"Cognee SDK initialized in {elapsed:.2f}s")


def get_cognee_version() -> str:
    """Get the version of the cognee package."""
    try:
        if cognee:
            return getattr(cognee, '__version__', 'unknown')
        return 'not_loaded'
    except Exception:
        return 'error'


class JsonRpcError(Exception):
    """JSON-RPC error with code and message."""

    def __init__(self, code: int, message: str, data: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


# JSON-RPC error codes
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

# Custom error codes
COGNEE_NOT_INITIALIZED = -32000
MISSING_API_KEY = -32001
OPERATION_FAILED = -32002


def create_success_response(request_id: str, result: dict) -> dict:
    """Create a JSON-RPC success response."""
    return {
        'jsonrpc': '2.0',
        'id': request_id,
        'result': result
    }


def create_error_response(request_id: str | None, code: int, message: str, data: dict | None = None) -> dict:
    """Create a JSON-RPC error response."""
    error = {'code': code, 'message': message}
    if data:
        error['data'] = data
    return {
        'jsonrpc': '2.0',
        'id': request_id,
        'error': error
    }


async def handle_health(params: dict, logger: logging.Logger) -> dict:
    """Handle health check request."""
    uptime_ms = int((time.time() - DAEMON_START_TIME) * 1000)
    return {
        'status': 'ok',
        'cognee_version': get_cognee_version(),
        'uptime_ms': uptime_ms,
        'cognee_initialized': cognee_initialized
    }


async def handle_retrieve(params: dict, workspace_path: str, dataset_name: str, logger: logging.Logger) -> dict:
    """
    Handle retrieve request.

    Uses the same logic as retrieve.py but without process startup overhead.
    """
    if not cognee_initialized:
        raise JsonRpcError(COGNEE_NOT_INITIALIZED, 'Cognee SDK not initialized')

    # Validate API key is present before processing request
    if not os.getenv('LLM_API_KEY'):
        raise JsonRpcError(INVALID_PARAMS, 'LLM_API_KEY not found in environment - required for retrieval operations')

    query = params.get('query')
    if not query:
        raise JsonRpcError(INVALID_PARAMS, 'Missing required parameter: query')

    max_results = params.get('max_results', 3)
    max_tokens = params.get('max_tokens', 2000)
    half_life_days = params.get('half_life_days', 7.0)
    include_superseded = params.get('include_superseded', False)
    top_k = params.get('top_k', max_results * 3)
    session_id = params.get('session_id')

    logger.info(f"Retrieve: query='{query[:50]}...', max_results={max_results}, top_k={top_k}")

    # Import retrieve function from existing module
    from retrieve import retrieve_context

    result = await retrieve_context(
        workspace_path=workspace_path,
        query=query,
        max_results=max_results,
        max_tokens=max_tokens,
        half_life_days=half_life_days,
        include_superseded=include_superseded,
        top_k=top_k,
        session_id=session_id
    )

    return result


async def handle_ingest(params: dict, workspace_path: str, dataset_name: str, logger: logging.Logger) -> dict:
    """
    Handle ingest request.

    Uses the same logic as ingest.py but without process startup overhead.
    """
    if not cognee_initialized:
        raise JsonRpcError(COGNEE_NOT_INITIALIZED, 'Cognee SDK not initialized')

    # Validate API key is present before processing request
    if not os.getenv('LLM_API_KEY'):
        raise JsonRpcError(INVALID_PARAMS, 'LLM_API_KEY not found in environment - required for ingest operations')

    mode = params.get('mode', 'add-only')
    summary_json = params.get('summary_json')
    user_message = params.get('user_message')
    assistant_message = params.get('assistant_message')
    importance = params.get('importance', 0.0)
    session_id = params.get('session_id')

    logger.info(f"Ingest: mode={mode}")

    # Import ingest functions from existing module
    from ingest import run_add_only, run_sync

    if mode == 'add-only':
        result = await run_add_only(
            summary_json=summary_json,
            workspace_path=workspace_path,
            user_message=user_message,
            assistant_message=assistant_message,
            importance=importance,
            session_id=session_id
        )
    elif mode == 'sync':
        result = await run_sync(
            summary_json=summary_json,
            workspace_path=workspace_path,
            user_message=user_message,
            assistant_message=assistant_message,
            importance=importance,
            session_id=session_id
        )
    else:
        raise JsonRpcError(INVALID_PARAMS, f'Invalid mode: {mode}. Must be "add-only" or "sync".')

    return result


async def handle_shutdown(params: dict, logger: logging.Logger) -> dict:
    """
    Handle shutdown request (Plan 061: Cleanup-friendly shutdown).
    
    Sets a flag to gracefully terminate the main loop instead of using os._exit().
    The response is flushed before the loop terminates, allowing cleanup.
    """
    global shutdown_requested
    logger.info("Shutdown requested - setting graceful termination flag")
    shutdown_requested = True
    return {'status': 'shutting_down'}


async def process_request(request: dict, workspace_path: str, dataset_name: str, logger: logging.Logger) -> dict:
    """
    Process a single JSON-RPC request and return the response.
    """
    request_id = request.get('id')
    method = request.get('method')
    params = request.get('params', {})

    if not method:
        return create_error_response(request_id, INVALID_REQUEST, 'Missing method')

    start_time = time.time()
    logger.debug(f"Processing request: {method} (id={request_id})")

    try:
        if method == 'health':
            result = await handle_health(params, logger)
        elif method == 'retrieve':
            result = await handle_retrieve(params, workspace_path, dataset_name, logger)
        elif method == 'ingest':
            result = await handle_ingest(params, workspace_path, dataset_name, logger)
        elif method == 'shutdown':
            result = await handle_shutdown(params, logger)
            # Plan 061: Don't use os._exit(0) here - return result and let main loop exit gracefully
        else:
            return create_error_response(request_id, METHOD_NOT_FOUND, f'Unknown method: {method}')

        elapsed_ms = int((time.time() - start_time) * 1000)
        logger.debug(f"Request completed: {method} in {elapsed_ms}ms")

        return create_success_response(request_id, result)

    except JsonRpcError as e:
        logger.error(f"JSON-RPC error: {e.message}")
        return create_error_response(request_id, e.code, e.message, e.data)
    except Exception as e:
        logger.exception(f"Internal error processing {method}")
        return create_error_response(request_id, INTERNAL_ERROR, str(e), {
            'type': type(e).__name__
        })


async def read_stdin_lines() -> Any:
    """Async generator that yields lines from stdin."""
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)

    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    while True:
        try:
            line = await reader.readline()
            if not line:
                break
            yield line.decode('utf-8').strip()
        except Exception:
            break


def write_response(response: dict) -> None:
    """Write a JSON-RPC response to stdout."""
    line = json.dumps(response, separators=(',', ':'))
    sys.stdout.write(line + '\n')
    sys.stdout.flush()


async def main_loop(workspace_path: str, dataset_name: str, logger: logging.Logger) -> None:
    """
    Main request processing loop (Plan 061: Graceful shutdown support).
    
    Checks shutdown_requested flag after each request to allow cleanup.
    """
    global shutdown_requested
    logger.info("Daemon ready, waiting for requests...")

    async for line in read_stdin_lines():
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse request: {e}")
            write_response(create_error_response(None, PARSE_ERROR, f'Parse error: {e}'))
            continue

        response = await process_request(request, workspace_path, dataset_name, logger)
        write_response(response)
        
        # Plan 061: Check for graceful shutdown after sending response
        if shutdown_requested:
            logger.info("Shutdown flag set - exiting main loop gracefully")
            break

    logger.info("Main loop exited - daemon shutting down")


def main() -> int:
    """Main entry point."""
    # Get workspace path from environment
    workspace_path = os.getenv('FLOWBABY_WORKSPACE_PATH')
    if not workspace_path:
        print(json.dumps({
            'jsonrpc': '2.0',
            'id': None,
            'error': {
                'code': INVALID_PARAMS,
                'message': 'FLOWBABY_WORKSPACE_PATH environment variable not set'
            }
        }))
        sys.stdout.flush()
        return 1

    # Setup logging
    logger = setup_daemon_logging(workspace_path)
    logger.info(f"Daemon starting for workspace: {workspace_path}")

    # Plan 061: Handle signals gracefully by setting shutdown flag
    def signal_handler(signum, frame):
        global shutdown_requested
        sig_name = signal.Signals(signum).name if hasattr(signal, 'Signals') else str(signum)
        logger.info(f"Received signal {sig_name}, requesting graceful shutdown")
        shutdown_requested = True
        # Don't call sys.exit() here - let the main loop exit cleanly

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    try:
        # Setup Cognee environment
        dataset_name, api_key_present = setup_cognee_environment(workspace_path, logger)

        # Initialize Cognee (one-time import cost)
        initialize_cognee(workspace_path, logger)

        # Run main loop
        asyncio.run(main_loop(workspace_path, dataset_name, logger))

        return 0

    except ValueError as e:
        logger.error(f"Configuration error: {e}")
        print(json.dumps({
            'jsonrpc': '2.0',
            'id': None,
            'error': {
                'code': MISSING_API_KEY,
                'message': str(e)
            }
        }))
        sys.stdout.flush()
        return 1

    except Exception as e:
        logger.exception("Fatal error in daemon")
        print(json.dumps({
            'jsonrpc': '2.0',
            'id': None,
            'error': {
                'code': INTERNAL_ERROR,
                'message': f'Daemon startup failed: {e}'
            }
        }))
        sys.stdout.flush()
        return 1


if __name__ == '__main__':
    sys.exit(main())
