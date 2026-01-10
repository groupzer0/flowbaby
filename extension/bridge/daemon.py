#!/usr/bin/env python3
"""
Flowbaby Bridge Daemon - Plan 054

A long-lived Python process that handles bridge requests over stdio JSON-RPC.
Eliminates per-request Python startup overhead by keeping Cognee imported and warm.

Usage: python daemon.py

Environment Variables:
  FLOWBABY_WORKSPACE_PATH: Required. Absolute path to workspace root.
  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN: Cloud credentials (v0.7.0+, primary)
  FLOWBABY_DEBUG_LOGGING: Optional. Enable verbose logging.

Note: v0.7.0 is Cloud-only. Use "Flowbaby Cloud: Login" to authenticate.

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
from pathlib import Path
from typing import Any

# Add bridge directory to path for local imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# CRITICAL (Plan 074): Import bridge_env BEFORE any cognee import
# Daemon mode must apply env wiring at process bootstrap, not per-request
# This ensures daemon-mode equivalence with spawn-mode
from bridge_env import apply_workspace_env, OntologyConfigError, BridgeEnvConfig

# Track startup time for uptime reporting
DAEMON_START_TIME = time.time()

# Cognee module reference (imported lazily)
cognee = None
cognee_initialized = False

# Plan 074: Store env config snapshot for daemon lifetime
_daemon_env_config: BridgeEnvConfig | None = None

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


def setup_cognee_environment(workspace_path: str, logger: logging.Logger) -> tuple[str, bool]:
    """
    Configure Cognee environment variables before importing the SDK.

    Plan 074: Now uses bridge_env.apply_workspace_env() as the single source
    of truth for environment configuration including ontology activation.
    
    Plan 059: Added filesystem cache backend configuration (CACHE_BACKEND=fs).
    Cognee 0.5.1+ supports filesystem session caching via diskcache, removing
    the implicit Redis dependency that caused connection failures in managed environments.

    Environment variable precedence (Plan 059 Milestone 2):
    1. Explicit env var already set in process (e.g., shell) - respected, not overwritten
    2. Flowbaby-managed defaults - applied only when value not already set

    Returns:
        tuple: (dataset_name, has_credentials: bool) - True if AWS_* or LLM_API_KEY present
    """
    global _daemon_env_config
    
    # Plan 083: v0.7.0 is Cloud-only. Check for Cloud credentials (AWS_*)
    aws_access_key = os.getenv('AWS_ACCESS_KEY_ID')
    has_credentials = aws_access_key is not None
    
    if not has_credentials:
        logger.warning('No Cloud credentials found in startup environment (AWS_*) - will check per-request')

    # Plan 074: Use shared bridge_env module for all environment wiring
    # This sets storage directories, caching config, AND ontology activation
    # CRITICAL: This is called at daemon bootstrap, not per-request (daemon-mode equivalence)
    _daemon_env_config = apply_workspace_env(workspace_path, logger=logger, fail_on_missing_ontology=True)

    # Plan 074: Log ontology configuration for observability (daemon startup snapshot)
    logger.info(f"Ontology configuration: path={_daemon_env_config.ontology_file_path}, "
                f"resolver={_daemon_env_config.ontology_resolver}, "
                f"strategy={_daemon_env_config.matching_strategy}, "
                f"exists={_daemon_env_config.ontology_file_exists}")
    logger.info(f"Cache configuration: CACHING={_daemon_env_config.caching}, "
                f"CACHE_BACKEND={_daemon_env_config.cache_backend}")
    logger.debug(f"Configured Cognee directories: system={_daemon_env_config.system_root}, "
                 f"data={_daemon_env_config.data_root}")

    # Generate dataset name
    from workspace_utils import generate_dataset_name
    dataset_name, _ = generate_dataset_name(workspace_path)

    return dataset_name, has_credentials


def initialize_cognee(workspace_path: str, logger: logging.Logger) -> None:
    """
    Import and configure Cognee SDK.
    This is called once at daemon startup to amortize import cost.
    
    Plan 074: Uses _daemon_env_config (set by setup_cognee_environment) for
    consistent directory configuration.
    
    Plan 091 Hotfix: Applies cognee_probe_bypass BEFORE importing cognee to prevent
    LLMAPIKeyNotSetError during cognify. Without this bypass, Cognee's internal
    test_llm_connection() runs and fails with Bedrock (expects LLM_API_KEY).
    
    Note: API key is NOT required at import time - it will be validated per-request.
    """
    global cognee, cognee_initialized

    if cognee_initialized:
        logger.debug("Cognee already initialized")
        return

    logger.info("Initializing Cognee SDK...")
    start_time = time.time()

    # Plan 091 Hotfix: Apply probe bypass BEFORE importing cognee
    # This prevents test_llm_connection() from running during cognify,
    # which fails with Bedrock because Cognee defaults to OpenAI provider.
    try:
        from cognee_probe_bypass import apply_cognee_probe_bypass
        bypass_applied = apply_cognee_probe_bypass()
        if bypass_applied:
            logger.debug("Plan 091: Cognee probe bypass applied")
        else:
            logger.warning("Plan 091: Cognee probe bypass failed - cognify may fail with LLM errors")
    except Exception as e:
        logger.warning(f"Plan 091: Could not apply cognee probe bypass: {e}")

    # Redirect stdout to stderr during import to avoid polluting JSON-RPC channel
    old_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        import cognee as cognee_module
        cognee = cognee_module
    finally:
        sys.stdout = old_stdout

    # Plan 074: Use stored env config for consistent directory paths
    if _daemon_env_config:
        system_root = _daemon_env_config.system_root
        data_root = _daemon_env_config.data_root
    else:
        # Fallback if config not set (shouldn't happen in normal flow)
        workspace_dir = Path(workspace_path)
        system_root = str(workspace_dir / '.flowbaby/system')
        data_root = str(workspace_dir / '.flowbaby/data')
        logger.warning("Using fallback directory paths - _daemon_env_config not set")

    cognee.config.system_root_directory(system_root)
    cognee.config.data_root_directory(data_root)
    
    # Plan 083 M5: v0.7.0 is Cloud-only - AWS credentials are used automatically by Cognee
    # LLM_API_KEY is no longer supported - Bedrock uses AWS_* env vars
    aws_access_key = os.getenv('AWS_ACCESS_KEY_ID')
    if aws_access_key:
        logger.debug("Cloud-only mode: Using AWS Bedrock via Cloud credentials")
    else:
        logger.debug("No Cloud credentials at daemon init - will check per-request")

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
NOT_AUTHENTICATED = -32001
OPERATION_FAILED = -32002


# ============================================================================
# Plan 097: Stdout protection for JSON-RPC integrity
# ============================================================================

from contextlib import contextmanager

@contextmanager
def stdout_to_stderr():
    """
    Context manager that redirects stdout to stderr (Plan 097).
    
    This protects JSON-RPC framing from corruption by third-party code
    that might call print() during handler execution. All such output
    is redirected to stderr, preserving stdout for JSON-RPC responses only.
    
    Usage:
        with stdout_to_stderr():
            # Any print() calls here go to stderr
            some_function_that_might_print()
    
    Safe for nested usage - each context restores its captured stdout.
    """
    old_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        yield
    finally:
        sys.stdout = old_stdout


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

    # Plan 083 M5: v0.7.0 is Cloud-only - AWS credentials required
    has_credentials = os.getenv('AWS_ACCESS_KEY_ID')
    if not has_credentials:
        raise JsonRpcError(NOT_AUTHENTICATED, 'Cloud login required - use "Flowbaby Cloud: Login with GitHub" command')

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

    # Plan 083 M5: v0.7.0 is Cloud-only - AWS credentials required
    has_credentials = os.getenv('AWS_ACCESS_KEY_ID')
    if not has_credentials:
        raise JsonRpcError(NOT_AUTHENTICATED, 'Cloud login required - use "Flowbaby Cloud: Login with GitHub" command')

    mode = params.get('mode', 'add-only')
    summary_json = params.get('summary_json')
    user_message = params.get('user_message')
    assistant_message = params.get('assistant_message')
    importance = params.get('importance', 0.0)
    session_id = params.get('session_id')

    # Plan 062: Parse summary_json if it's a string (from TypeScript JSON.stringify)
    if isinstance(summary_json, str):
        try:
            summary_json = json.loads(summary_json)
        except json.JSONDecodeError as e:
            raise JsonRpcError(INVALID_PARAMS, f'Invalid summary_json: {e}')

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


async def handle_cognify(params: dict, workspace_path: str, dataset_name: str, logger: logging.Logger) -> dict:
    """
    Handle cognify request (Plan 061 hotfix: Route cognify through daemon).
    
    This runs cognify() on previously staged data, avoiding KuzuDB lock contention
    by keeping all graph writes serialized through the daemon process.
    
    Args:
        params: Request parameters containing:
            - operation_id: UUID identifying this background operation (required)
        workspace_path: Absolute path to VS Code workspace root
        dataset_name: Cognee dataset name for this workspace
        logger: Logger instance
    
    Returns:
        Dictionary with success status, elapsed_ms, entity_count or error
    """
    if not cognee_initialized:
        raise JsonRpcError(COGNEE_NOT_INITIALIZED, 'Cognee SDK not initialized')
    
    # Plan 083 M5: v0.7.0 is Cloud-only - AWS credentials required
    has_credentials = os.getenv('AWS_ACCESS_KEY_ID')
    if not has_credentials:
        raise JsonRpcError(NOT_AUTHENTICATED, 'Cloud login required - use "Flowbaby Cloud: Login with GitHub" command')
    
    operation_id = params.get('operation_id')
    if not operation_id:
        raise JsonRpcError(INVALID_PARAMS, 'Missing required parameter: operation_id')
    
    logger.info(f"Cognify: operation_id={operation_id}, dataset={dataset_name}")
    
    try:
        import cognee
        from time import perf_counter
        
        start_time = perf_counter()
        
        # Run cognify on the dataset - this processes any staged data
        await cognee.cognify(datasets=[dataset_name])
        
        elapsed_ms = int((perf_counter() - start_time) * 1000)
        
        logger.info(f"Cognify completed in {elapsed_ms}ms")
        
        return {
            'success': True,
            'operation_id': operation_id,
            'elapsed_ms': elapsed_ms,
            'entity_count': None  # Cognee SDK doesn't provide this reliably
        }
    
    except Exception as e:
        logger.exception(f"Cognify failed: {e}")
        raise JsonRpcError(INTERNAL_ERROR, f'Cognify failed: {str(e)}', {
            'type': type(e).__name__,
            'operation_id': operation_id
        })


async def handle_visualize(params: dict, workspace_path: str, dataset_name: str, logger: logging.Logger) -> dict:
    """
    Handle visualize request (Plan 097: Daemon-only visualization).
    
    Routes graph visualization through the daemon's in-process execution,
    avoiding cross-process Kuzu lock contention on Windows.
    
    Args:
        params: Request parameters containing:
            - output_path: Absolute path where HTML should be written (required)
        workspace_path: Absolute path to VS Code workspace root
        dataset_name: Cognee dataset name for this workspace
        logger: Logger instance
    
    Returns:
        Dictionary matching VisualizeResult contract:
        - success: True/False
        - output_path: Path to generated HTML file
        - node_count: Number of nodes in graph (if available)
        - offline_safe: True if no external scripts
        - error_code, error, user_message: On failure
    """
    if not cognee_initialized:
        raise JsonRpcError(COGNEE_NOT_INITIALIZED, 'Cognee SDK not initialized')
    
    # Plan 083 M5: v0.7.0 is Cloud-only - AWS credentials required
    has_credentials = os.getenv('AWS_ACCESS_KEY_ID')
    if not has_credentials:
        raise JsonRpcError(NOT_AUTHENTICATED, 'Cloud login required - use "Flowbaby Cloud: Login with GitHub" command')
    
    output_path = params.get('output_path')
    if not output_path:
        raise JsonRpcError(INVALID_PARAMS, 'Missing required parameter: output_path')
    
    logger.info(f"Visualize: workspace={workspace_path}, output={output_path}")
    
    # Import the visualization function from visualize.py
    # This reuses the existing implementation but runs in-process
    from visualize import visualize_graph
    
    # Plan 097: Protect JSON-RPC stdout during visualization
    # Third-party code (cognee, networkx, etc.) might print() during execution
    with stdout_to_stderr():
        result = await visualize_graph(workspace_path, output_path)
    
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
        elif method == 'cognify':
            result = await handle_cognify(params, workspace_path, dataset_name, logger)
        elif method == 'visualize':
            # Plan 097: Route visualization through daemon (lock-safe, in-process)
            result = await handle_visualize(params, workspace_path, dataset_name, logger)
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
    """
    Async generator that yields lines from stdin.

    On Windows, asyncio's connect_read_pipe() doesn't work with stdin pipes
    from spawned subprocesses (ProactorEventLoop + IOCP limitation).
    We use a thread-based reader instead, which works cross-platform.
    """
    import queue
    import threading

    line_queue: queue.Queue[str | None] = queue.Queue()

    def stdin_reader():
        """Synchronous stdin reader running in a background thread."""
        try:
            for line in sys.stdin:
                line_queue.put(line.strip())
        except Exception:
            pass
        finally:
            line_queue.put(None)  # Signal EOF

    # Start reader thread
    reader_thread = threading.Thread(target=stdin_reader, daemon=True)
    reader_thread.start()

    loop = asyncio.get_event_loop()

    while True:
        try:
            # Use run_in_executor to avoid blocking the event loop
            line = await loop.run_in_executor(None, line_queue.get)
            if line is None:
                break
            yield line
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
                'code': NOT_AUTHENTICATED,
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
