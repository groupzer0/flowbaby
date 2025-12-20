"""
Tests for daemon.py - Plan 061 coverage improvement.

Covers:
- setup_daemon_logging
- setup_cognee_environment (extended)
- initialize_cognee
- JSON-RPC helpers and error classes
- Handler functions (health, retrieve, ingest, shutdown)
- process_request routing
- write_response
- Signal handling and graceful shutdown
"""

import asyncio
import json
import logging
import os
import sys
from io import StringIO
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture
def logger() -> logging.Logger:
    """Create a test logger."""
    log = logging.getLogger("flowbaby.daemon.test")
    log.handlers.clear()
    log.addHandler(logging.NullHandler())
    log.setLevel(logging.DEBUG)
    return log


@pytest.fixture
def workspace(tmp_path) -> Path:
    """Create a test workspace directory."""
    ws = tmp_path / "test_workspace"
    ws.mkdir()
    return ws


@pytest.fixture
def reset_daemon_state():
    """Reset daemon module state between tests."""
    import daemon
    original_cognee = daemon.cognee
    original_initialized = daemon.cognee_initialized
    original_shutdown = daemon.shutdown_requested
    original_start_time = daemon.DAEMON_START_TIME
    
    yield
    
    daemon.cognee = original_cognee
    daemon.cognee_initialized = original_initialized
    daemon.shutdown_requested = original_shutdown
    daemon.DAEMON_START_TIME = original_start_time


# ============================================================================
# setup_daemon_logging tests
# ============================================================================

class TestSetupDaemonLogging:
    """Tests for setup_daemon_logging function."""

    def test_creates_log_directory(self, workspace):
        """Verify log directory is created."""
        from daemon import setup_daemon_logging
        
        log_dir = workspace / '.flowbaby' / 'logs'
        assert not log_dir.exists()
        
        logger = setup_daemon_logging(str(workspace))
        
        assert log_dir.exists()
        assert logger.name == 'flowbaby.daemon'

    def test_creates_log_file(self, workspace):
        """Verify daemon.log file is set up."""
        from daemon import setup_daemon_logging
        
        logger = setup_daemon_logging(str(workspace))
        
        log_file = workspace / '.flowbaby' / 'logs' / 'daemon.log'
        # File handler is set up but file may not exist until first write
        file_handlers = [h for h in logger.handlers if isinstance(h, logging.FileHandler)]
        assert len(file_handlers) == 1
        assert file_handlers[0].baseFilename == str(log_file)

    def test_debug_logging_enabled(self, workspace, monkeypatch):
        """Verify debug logging is enabled with env var."""
        from daemon import setup_daemon_logging
        
        monkeypatch.setenv('FLOWBABY_DEBUG_LOGGING', 'true')
        logger = setup_daemon_logging(str(workspace))
        
        assert logger.level == logging.DEBUG

    def test_debug_logging_disabled_by_default(self, workspace, monkeypatch):
        """Verify INFO level when debug not enabled."""
        from daemon import setup_daemon_logging
        
        monkeypatch.delenv('FLOWBABY_DEBUG_LOGGING', raising=False)
        logger = setup_daemon_logging(str(workspace))
        
        assert logger.level == logging.INFO

    def test_debug_logging_accepts_various_values(self, workspace, monkeypatch):
        """Verify various truthy values enable debug."""
        from daemon import setup_daemon_logging
        
        for value in ['1', 'True', 'YES', 'on']:
            monkeypatch.setenv('FLOWBABY_DEBUG_LOGGING', value)
            logger = setup_daemon_logging(str(workspace))
            assert logger.level == logging.DEBUG, f"Failed for value: {value}"


# ============================================================================
# setup_cognee_environment tests (extended)
# ============================================================================

class TestSetupCogneeEnvironmentExtended:
    """Extended tests for setup_cognee_environment."""

    def test_creates_required_directories(self, workspace, monkeypatch, logger):
        """Verify all Cognee directories are created."""
        from daemon import setup_cognee_environment
        
        monkeypatch.setenv('LLM_API_KEY', 'test-key')
        monkeypatch.delenv('CACHING', raising=False)
        monkeypatch.delenv('CACHE_BACKEND', raising=False)
        
        setup_cognee_environment(str(workspace), logger)
        
        assert (workspace / '.flowbaby' / 'system').exists()
        assert (workspace / '.flowbaby' / 'data').exists()
        assert (workspace / '.flowbaby' / 'cache').exists()

    def test_returns_dataset_name_and_api_key_status(self, workspace, monkeypatch, logger):
        """Verify return values."""
        from daemon import setup_cognee_environment
        
        monkeypatch.setenv('LLM_API_KEY', 'test-key')
        
        dataset_name, api_key_present = setup_cognee_environment(str(workspace), logger)
        
        assert dataset_name is not None
        assert api_key_present is True

    def test_api_key_not_present(self, workspace, monkeypatch, logger):
        """Verify handling when API key is missing."""
        from daemon import setup_cognee_environment
        
        monkeypatch.delenv('LLM_API_KEY', raising=False)
        
        dataset_name, api_key_present = setup_cognee_environment(str(workspace), logger)
        
        assert api_key_present is False

    def test_sets_environment_variables(self, workspace, monkeypatch, logger):
        """Verify Cognee env vars are set."""
        from daemon import setup_cognee_environment
        
        monkeypatch.setenv('LLM_API_KEY', 'test-key')
        
        setup_cognee_environment(str(workspace), logger)
        
        assert os.environ.get('SYSTEM_ROOT_DIRECTORY') == str(workspace / '.flowbaby' / 'system')
        assert os.environ.get('DATA_ROOT_DIRECTORY') == str(workspace / '.flowbaby' / 'data')
        assert os.environ.get('CACHE_ROOT_DIRECTORY') == str(workspace / '.flowbaby' / 'cache')


# ============================================================================
# JSON-RPC helpers tests
# ============================================================================

class TestJsonRpcHelpers:
    """Tests for JSON-RPC helper functions and classes."""

    def test_json_rpc_error_class(self):
        """Test JsonRpcError exception class."""
        from daemon import JsonRpcError
        
        error = JsonRpcError(code=-32600, message="Invalid Request", data={"field": "method"})
        
        assert error.code == -32600
        assert error.message == "Invalid Request"
        assert error.data == {"field": "method"}
        assert str(error) == "Invalid Request"

    def test_json_rpc_error_without_data(self):
        """Test JsonRpcError without optional data."""
        from daemon import JsonRpcError
        
        error = JsonRpcError(code=-32601, message="Method not found")
        
        assert error.data is None

    def test_create_success_response(self):
        """Test success response creation."""
        from daemon import create_success_response
        
        response = create_success_response("req-123", {"status": "ok"})
        
        assert response == {
            'jsonrpc': '2.0',
            'id': 'req-123',
            'result': {'status': 'ok'}
        }

    def test_create_error_response(self):
        """Test error response creation."""
        from daemon import create_error_response
        
        response = create_error_response("req-456", -32600, "Invalid Request")
        
        assert response == {
            'jsonrpc': '2.0',
            'id': 'req-456',
            'error': {'code': -32600, 'message': 'Invalid Request'}
        }

    def test_create_error_response_with_data(self):
        """Test error response with additional data."""
        from daemon import create_error_response
        
        response = create_error_response("req-789", -32603, "Internal error", {"trace": "stack"})
        
        assert response['error']['data'] == {"trace": "stack"}

    def test_create_error_response_null_id(self):
        """Test error response with null ID (parse errors)."""
        from daemon import create_error_response
        
        response = create_error_response(None, -32700, "Parse error")
        
        assert response['id'] is None


# ============================================================================
# get_cognee_version tests
# ============================================================================

class TestGetCogneeVersion:
    """Tests for get_cognee_version function."""

    def test_returns_version_when_loaded(self, reset_daemon_state):
        """Test version retrieval when cognee is loaded."""
        import daemon
        
        mock_cognee = MagicMock()
        mock_cognee.__version__ = '1.2.3'
        daemon.cognee = mock_cognee
        
        version = daemon.get_cognee_version()
        assert version == '1.2.3'

    def test_returns_unknown_when_no_version_attr(self, reset_daemon_state):
        """Test fallback when __version__ is missing."""
        import daemon
        
        mock_cognee = MagicMock(spec=[])  # No __version__
        daemon.cognee = mock_cognee
        
        version = daemon.get_cognee_version()
        assert version == 'unknown'

    def test_returns_not_loaded_when_cognee_is_none(self, reset_daemon_state):
        """Test when cognee module not loaded."""
        import daemon
        daemon.cognee = None
        
        version = daemon.get_cognee_version()
        assert version == 'not_loaded'

    def test_returns_error_on_exception(self, reset_daemon_state):
        """Test graceful handling of exceptions."""
        import daemon
        
        # Create a mock that raises when __version__ is accessed
        mock_cognee = MagicMock()
        type(mock_cognee).__version__ = property(lambda self: (_ for _ in ()).throw(RuntimeError("boom")))
        daemon.cognee = mock_cognee
        
        # Access causes exception - should return 'error'
        version = daemon.get_cognee_version()
        assert version == 'error'


# ============================================================================
# Handler tests
# ============================================================================

class TestHandleHealth:
    """Tests for handle_health handler."""

    @pytest.mark.asyncio
    async def test_returns_health_status(self, logger, reset_daemon_state):
        """Test health check response."""
        import daemon
        daemon.cognee_initialized = True
        daemon.DAEMON_START_TIME = 1000.0
        
        with patch('daemon.time.time', return_value=1005.0):
            with patch.object(daemon, 'get_cognee_version', return_value='0.5.0'):
                result = await daemon.handle_health({}, logger)
        
        assert result['status'] == 'ok'
        assert result['cognee_version'] == '0.5.0'
        assert result['uptime_ms'] == 5000
        assert result['cognee_initialized'] is True


class TestHandleShutdown:
    """Tests for handle_shutdown handler."""

    @pytest.mark.asyncio
    async def test_sets_shutdown_flag(self, logger, reset_daemon_state):
        """Test shutdown request sets graceful shutdown flag."""
        import daemon
        daemon.shutdown_requested = False
        
        result = await daemon.handle_shutdown({}, logger)
        
        assert result == {'status': 'shutting_down'}
        assert daemon.shutdown_requested is True


class TestHandleRetrieve:
    """Tests for handle_retrieve handler."""

    @pytest.mark.asyncio
    async def test_raises_when_cognee_not_initialized(self, workspace, logger, reset_daemon_state):
        """Test error when Cognee not initialized."""
        import daemon
        daemon.cognee_initialized = False
        
        with pytest.raises(daemon.JsonRpcError) as exc_info:
            await daemon.handle_retrieve({'query': 'test'}, str(workspace), 'dataset', logger)
        
        assert exc_info.value.code == daemon.COGNEE_NOT_INITIALIZED

    @pytest.mark.asyncio
    async def test_raises_when_api_key_missing(self, workspace, logger, monkeypatch, reset_daemon_state):
        """Test error when API key is missing."""
        import daemon
        daemon.cognee_initialized = True
        monkeypatch.delenv('LLM_API_KEY', raising=False)
        
        with pytest.raises(daemon.JsonRpcError) as exc_info:
            await daemon.handle_retrieve({'query': 'test'}, str(workspace), 'dataset', logger)
        
        assert exc_info.value.code == daemon.INVALID_PARAMS
        assert 'LLM_API_KEY' in exc_info.value.message

    @pytest.mark.asyncio
    async def test_raises_when_query_missing(self, workspace, logger, monkeypatch, reset_daemon_state):
        """Test error when query parameter is missing."""
        import daemon
        daemon.cognee_initialized = True
        monkeypatch.setenv('LLM_API_KEY', 'test-key')
        
        with pytest.raises(daemon.JsonRpcError) as exc_info:
            await daemon.handle_retrieve({}, str(workspace), 'dataset', logger)
        
        assert exc_info.value.code == daemon.INVALID_PARAMS
        assert 'query' in exc_info.value.message

    @pytest.mark.asyncio
    async def test_calls_retrieve_context(self, workspace, logger, monkeypatch, reset_daemon_state):
        """Test successful retrieve call."""
        import daemon
        daemon.cognee_initialized = True
        monkeypatch.setenv('LLM_API_KEY', 'test-key')
        
        mock_result = {'memories': [], 'total': 0}
        with patch('retrieve.retrieve_context', new_callable=AsyncMock, return_value=mock_result):
            result = await daemon.handle_retrieve(
                {'query': 'test query', 'max_results': 5},
                str(workspace),
                'dataset',
                logger
            )
        
        assert result == mock_result


class TestHandleIngest:
    """Tests for handle_ingest handler."""

    @pytest.mark.asyncio
    async def test_raises_when_cognee_not_initialized(self, workspace, logger, reset_daemon_state):
        """Test error when Cognee not initialized."""
        import daemon
        daemon.cognee_initialized = False
        
        with pytest.raises(daemon.JsonRpcError) as exc_info:
            await daemon.handle_ingest({'mode': 'add-only'}, str(workspace), 'dataset', logger)
        
        assert exc_info.value.code == daemon.COGNEE_NOT_INITIALIZED

    @pytest.mark.asyncio
    async def test_raises_when_api_key_missing(self, workspace, logger, monkeypatch, reset_daemon_state):
        """Test error when API key is missing."""
        import daemon
        daemon.cognee_initialized = True
        monkeypatch.delenv('LLM_API_KEY', raising=False)
        
        with pytest.raises(daemon.JsonRpcError) as exc_info:
            await daemon.handle_ingest({'mode': 'add-only'}, str(workspace), 'dataset', logger)
        
        assert exc_info.value.code == daemon.INVALID_PARAMS

    @pytest.mark.asyncio
    async def test_raises_on_invalid_mode(self, workspace, logger, monkeypatch, reset_daemon_state):
        """Test error on invalid mode parameter."""
        import daemon
        daemon.cognee_initialized = True
        monkeypatch.setenv('LLM_API_KEY', 'test-key')
        
        with pytest.raises(daemon.JsonRpcError) as exc_info:
            await daemon.handle_ingest({'mode': 'invalid'}, str(workspace), 'dataset', logger)
        
        assert exc_info.value.code == daemon.INVALID_PARAMS
        assert 'invalid' in exc_info.value.message.lower()

    @pytest.mark.asyncio
    async def test_add_only_mode(self, workspace, logger, monkeypatch, reset_daemon_state):
        """Test add-only mode routing."""
        import daemon
        daemon.cognee_initialized = True
        monkeypatch.setenv('LLM_API_KEY', 'test-key')
        
        mock_result = {'success': True}
        with patch('ingest.run_add_only', new_callable=AsyncMock, return_value=mock_result) as mock_add:
            result = await daemon.handle_ingest(
                {'mode': 'add-only', 'summary_json': '{}'},
                str(workspace),
                'dataset',
                logger
            )
        
        assert result == mock_result
        mock_add.assert_called_once()

    @pytest.mark.asyncio
    async def test_sync_mode(self, workspace, logger, monkeypatch, reset_daemon_state):
        """Test sync mode routing."""
        import daemon
        daemon.cognee_initialized = True
        monkeypatch.setenv('LLM_API_KEY', 'test-key')
        
        mock_result = {'success': True}
        with patch('ingest.run_sync', new_callable=AsyncMock, return_value=mock_result) as mock_sync:
            result = await daemon.handle_ingest(
                {'mode': 'sync', 'summary_json': '{}'},
                str(workspace),
                'dataset',
                logger
            )
        
        assert result == mock_result
        mock_sync.assert_called_once()

    @pytest.mark.asyncio
    async def test_parses_summary_json_string(self, workspace, logger, monkeypatch, reset_daemon_state):
        """Plan 062: Test JSON string parsing for summary_json from TypeScript."""
        import daemon
        daemon.cognee_initialized = True
        monkeypatch.setenv('LLM_API_KEY', 'test-key')
        
        # TypeScript sends summary_json as a JSON string (via JSON.stringify)
        summary_payload = {'topic': 'Test', 'context': 'Test context', 'workspace_path': str(workspace)}
        summary_json_string = json.dumps(summary_payload)
        
        mock_result = {'success': True, 'staged': True}
        with patch('ingest.run_add_only', new_callable=AsyncMock, return_value=mock_result) as mock_add:
            result = await daemon.handle_ingest(
                {'mode': 'add-only', 'summary_json': summary_json_string},
                str(workspace),
                'dataset',
                logger
            )
        
        assert result == mock_result
        # Verify the parsed dict was passed, not the string
        call_kwargs = mock_add.call_args.kwargs
        assert isinstance(call_kwargs['summary_json'], dict)
        assert call_kwargs['summary_json']['topic'] == 'Test'

    @pytest.mark.asyncio
    async def test_accepts_summary_json_dict_directly(self, workspace, logger, monkeypatch, reset_daemon_state):
        """Plan 062: Test dict is passed through directly without parsing."""
        import daemon
        daemon.cognee_initialized = True
        monkeypatch.setenv('LLM_API_KEY', 'test-key')
        
        # If params already contain a dict (e.g., direct JSON-RPC), pass through
        summary_payload = {'topic': 'Test', 'context': 'Test context', 'workspace_path': str(workspace)}
        
        mock_result = {'success': True, 'staged': True}
        with patch('ingest.run_add_only', new_callable=AsyncMock, return_value=mock_result) as mock_add:
            result = await daemon.handle_ingest(
                {'mode': 'add-only', 'summary_json': summary_payload},
                str(workspace),
                'dataset',
                logger
            )
        
        assert result == mock_result
        call_kwargs = mock_add.call_args.kwargs
        assert call_kwargs['summary_json'] == summary_payload

    @pytest.mark.asyncio
    async def test_raises_on_invalid_summary_json_string(self, workspace, logger, monkeypatch, reset_daemon_state):
        """Plan 062: Test error on malformed JSON string."""
        import daemon
        daemon.cognee_initialized = True
        monkeypatch.setenv('LLM_API_KEY', 'test-key')
        
        with pytest.raises(daemon.JsonRpcError) as exc_info:
            await daemon.handle_ingest(
                {'mode': 'add-only', 'summary_json': 'not valid json'},
                str(workspace),
                'dataset',
                logger
            )
        
        assert exc_info.value.code == daemon.INVALID_PARAMS
        assert 'Invalid summary_json' in exc_info.value.message


# ============================================================================
# process_request tests
# ============================================================================

class TestProcessRequest:
    """Tests for process_request routing function."""

    @pytest.mark.asyncio
    async def test_routes_health_request(self, workspace, logger, reset_daemon_state):
        """Test health method routing."""
        import daemon
        daemon.cognee_initialized = True
        
        with patch.object(daemon, 'handle_health', new_callable=AsyncMock, return_value={'status': 'ok'}):
            response = await daemon.process_request(
                {'id': '1', 'method': 'health', 'params': {}},
                str(workspace),
                'dataset',
                logger
            )
        
        assert response['result']['status'] == 'ok'

    @pytest.mark.asyncio
    async def test_routes_shutdown_request(self, workspace, logger, reset_daemon_state):
        """Test shutdown method routing."""
        import daemon
        daemon.shutdown_requested = False
        
        response = await daemon.process_request(
            {'id': '2', 'method': 'shutdown', 'params': {}},
            str(workspace),
            'dataset',
            logger
        )
        
        assert response['result']['status'] == 'shutting_down'

    @pytest.mark.asyncio
    async def test_returns_error_on_missing_method(self, workspace, logger):
        """Test error when method is missing."""
        import daemon
        
        response = await daemon.process_request(
            {'id': '3', 'params': {}},
            str(workspace),
            'dataset',
            logger
        )
        
        assert 'error' in response
        assert response['error']['code'] == daemon.INVALID_REQUEST

    @pytest.mark.asyncio
    async def test_returns_error_on_unknown_method(self, workspace, logger):
        """Test error for unknown method."""
        import daemon
        
        response = await daemon.process_request(
            {'id': '4', 'method': 'unknown_method', 'params': {}},
            str(workspace),
            'dataset',
            logger
        )
        
        assert 'error' in response
        assert response['error']['code'] == daemon.METHOD_NOT_FOUND

    @pytest.mark.asyncio
    async def test_handles_json_rpc_error(self, workspace, logger, reset_daemon_state):
        """Test JsonRpcError handling."""
        import daemon
        daemon.cognee_initialized = False
        
        response = await daemon.process_request(
            {'id': '5', 'method': 'retrieve', 'params': {'query': 'test'}},
            str(workspace),
            'dataset',
            logger
        )
        
        assert 'error' in response
        assert response['error']['code'] == daemon.COGNEE_NOT_INITIALIZED

    @pytest.mark.asyncio
    async def test_handles_internal_exception(self, workspace, logger, reset_daemon_state):
        """Test internal exception handling."""
        import daemon
        
        with patch.object(daemon, 'handle_health', new_callable=AsyncMock, side_effect=RuntimeError("boom")):
            response = await daemon.process_request(
                {'id': '6', 'method': 'health', 'params': {}},
                str(workspace),
                'dataset',
                logger
            )
        
        assert 'error' in response
        assert response['error']['code'] == daemon.INTERNAL_ERROR
        assert 'boom' in response['error']['message']
        assert response['error']['data']['type'] == 'RuntimeError'


# ============================================================================
# write_response tests
# ============================================================================

class TestWriteResponse:
    """Tests for write_response function."""

    def test_writes_json_to_stdout(self, capsys):
        """Test JSON output to stdout."""
        from daemon import write_response
        
        response = {'jsonrpc': '2.0', 'id': '1', 'result': {'status': 'ok'}}
        write_response(response)
        
        captured = capsys.readouterr()
        assert captured.out.strip() == '{"jsonrpc":"2.0","id":"1","result":{"status":"ok"}}'

    def test_uses_compact_json_format(self, capsys):
        """Test compact JSON (no spaces)."""
        from daemon import write_response
        
        response = {'jsonrpc': '2.0', 'id': '1', 'result': {'a': 1, 'b': 2}}
        write_response(response)
        
        captured = capsys.readouterr()
        # No spaces after colons or commas
        assert ': ' not in captured.out
        assert ', ' not in captured.out


# ============================================================================
# Signal handling tests
# ============================================================================

class TestSignalHandling:
    """Tests for signal handling and graceful shutdown."""

    def test_signal_handler_sets_shutdown_flag(self, reset_daemon_state, workspace, monkeypatch):
        """Test that signal handler sets the shutdown flag."""
        import daemon
        import signal as sig
        
        # Capture the signal handler
        handler = None
        original_signal = sig.signal
        
        def capture_signal(signum, handler_func):
            nonlocal handler
            if signum == sig.SIGTERM:
                handler = handler_func
            return original_signal(signum, sig.SIG_DFL)
        
        daemon.shutdown_requested = False
        monkeypatch.setenv('FLOWBABY_WORKSPACE_PATH', str(workspace))
        monkeypatch.setenv('LLM_API_KEY', 'test-key')
        
        with patch.object(sig, 'signal', side_effect=capture_signal):
            with patch.object(daemon, 'setup_daemon_logging', return_value=MagicMock()):
                with patch.object(daemon, 'setup_cognee_environment', return_value=('dataset', True)):
                    with patch.object(daemon, 'initialize_cognee'):
                        with patch.object(daemon, 'asyncio') as mock_asyncio:
                            mock_asyncio.run = MagicMock()
                            try:
                                daemon.main()
                            except:
                                pass
        
        # Invoke the captured handler
        if handler:
            handler(sig.SIGTERM, None)
            assert daemon.shutdown_requested is True


# ============================================================================
# main() tests
# ============================================================================

class TestMain:
    """Tests for main entry point."""

    def test_returns_error_without_workspace_path(self, capsys, monkeypatch):
        """Test error when FLOWBABY_WORKSPACE_PATH not set."""
        import daemon
        
        monkeypatch.delenv('FLOWBABY_WORKSPACE_PATH', raising=False)
        
        result = daemon.main()
        
        assert result == 1
        captured = capsys.readouterr()
        output = json.loads(captured.out.strip())
        assert output['error']['code'] == daemon.INVALID_PARAMS
        assert 'FLOWBABY_WORKSPACE_PATH' in output['error']['message']

    def test_successful_startup_and_run(self, workspace, monkeypatch, reset_daemon_state):
        """Test successful daemon startup."""
        import daemon
        
        monkeypatch.setenv('FLOWBABY_WORKSPACE_PATH', str(workspace))
        monkeypatch.setenv('LLM_API_KEY', 'test-key')
        
        with patch.object(daemon, 'setup_daemon_logging', return_value=MagicMock()):
            with patch.object(daemon, 'setup_cognee_environment', return_value=('dataset', True)):
                with patch.object(daemon, 'initialize_cognee'):
                    with patch('daemon.asyncio.run') as mock_run:
                        result = daemon.main()
        
        assert result == 0
        mock_run.assert_called_once()


# ============================================================================
# Error code constants tests
# ============================================================================

class TestErrorCodes:
    """Tests for error code constants."""

    def test_standard_json_rpc_codes(self):
        """Verify standard JSON-RPC error codes."""
        from daemon import PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR
        
        assert PARSE_ERROR == -32700
        assert INVALID_REQUEST == -32600
        assert METHOD_NOT_FOUND == -32601
        assert INVALID_PARAMS == -32602
        assert INTERNAL_ERROR == -32603

    def test_custom_error_codes(self):
        """Verify custom error codes."""
        from daemon import COGNEE_NOT_INITIALIZED, MISSING_API_KEY, OPERATION_FAILED
        
        assert COGNEE_NOT_INITIALIZED == -32000
        assert MISSING_API_KEY == -32001
        assert OPERATION_FAILED == -32002
