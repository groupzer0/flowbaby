"""
Unit tests for Cognee user context helper - Plan 093

Tests the shared ensure_user_context() helper that provides consistent
multi-user context wiring across all bridge entrypoints.

TDD: These tests are written BEFORE the implementation.
"""
import sys
import logging
import builtins
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


class TestUserContextHelperImports:
    """Test that the user_context module can be imported."""

    def test_module_imports(self):
        """TDD: Module should be importable."""
        from user_context import ensure_user_context, UserContextError, UserContextResult
        assert ensure_user_context is not None
        assert UserContextError is not None
        assert UserContextResult is not None


class TestEnsureUserContextBasic:
    """Test basic ensure_user_context() behavior."""

    @pytest.fixture
    def mock_cognee_user_apis(self):
        """Mock Cognee user-related APIs."""
        # Clear cache before each test
        from user_context import clear_user_cache
        clear_user_cache()

        mock_user = MagicMock()
        mock_user.id = "test-user-123"
        mock_user.email = "test@example.com"

        mock_get_default_user = AsyncMock(return_value=mock_user)
        mock_set_session_user = AsyncMock()

        with patch.dict('sys.modules', {
            'cognee': MagicMock(),
            'cognee.modules': MagicMock(),
            'cognee.modules.users': MagicMock(),
            'cognee.modules.users.methods': MagicMock(get_default_user=mock_get_default_user),
            'cognee.context_global_variables': MagicMock(set_session_user_context_variable=mock_set_session_user),
        }):
            yield {
                'user': mock_user,
                'get_default_user': mock_get_default_user,
                'set_session_user': mock_set_session_user,
            }

    @pytest.mark.asyncio
    async def test_ensure_user_context_returns_result(self, mock_cognee_user_apis):
        """TDD: ensure_user_context should return a UserContextResult."""
        from user_context import ensure_user_context, UserContextResult

        result = await ensure_user_context()

        assert isinstance(result, UserContextResult)
        assert result.success is True
        assert result.user_id == "test-user-123"

    @pytest.mark.asyncio
    async def test_ensure_user_context_calls_get_default_user(self, mock_cognee_user_apis):
        """TDD: ensure_user_context should call get_default_user()."""
        from user_context import ensure_user_context

        await ensure_user_context()

        mock_cognee_user_apis['get_default_user'].assert_called_once()

    @pytest.mark.asyncio
    async def test_ensure_user_context_sets_session_context_var(self, mock_cognee_user_apis):
        """TDD: ensure_user_context should call set_session_user_context_variable()."""
        from user_context import ensure_user_context

        await ensure_user_context()

        mock_cognee_user_apis['set_session_user'].assert_called_once_with(
            mock_cognee_user_apis['user']
        )


class TestUserContextCaching:
    """Test that default user is cached (≤1 DB hit per process)."""

    @pytest.fixture
    def mock_cognee_for_caching(self):
        """Mock Cognee APIs for caching tests."""
        mock_user = MagicMock()
        mock_user.id = "cached-user-456"

        mock_get_default_user = AsyncMock(return_value=mock_user)
        mock_set_session_user = AsyncMock()

        with patch.dict('sys.modules', {
            'cognee': MagicMock(),
            'cognee.modules': MagicMock(),
            'cognee.modules.users': MagicMock(),
            'cognee.modules.users.methods': MagicMock(get_default_user=mock_get_default_user),
            'cognee.context_global_variables': MagicMock(set_session_user_context_variable=mock_set_session_user),
        }):
            yield {
                'get_default_user': mock_get_default_user,
                'set_session_user': mock_set_session_user,
            }

    @pytest.mark.asyncio
    async def test_default_user_cached_across_calls(self, mock_cognee_for_caching):
        """TDD: get_default_user should only be called once across multiple ensure_user_context calls."""
        from user_context import ensure_user_context, clear_user_cache

        # Clear any existing cache
        clear_user_cache()

        # Call ensure_user_context multiple times
        await ensure_user_context()
        await ensure_user_context()
        await ensure_user_context()

        # get_default_user should only be called ONCE (DB hit only first time)
        assert mock_cognee_for_caching['get_default_user'].call_count == 1

    @pytest.mark.asyncio
    async def test_session_context_var_set_every_call(self, mock_cognee_for_caching):
        """TDD: set_session_user_context_variable should be called every time (ContextVar per-op)."""
        from user_context import ensure_user_context, clear_user_cache

        # Clear cache
        clear_user_cache()

        # Call ensure_user_context multiple times
        await ensure_user_context()
        await ensure_user_context()
        await ensure_user_context()

        # set_session_user should be called 3 times (once per operation)
        assert mock_cognee_for_caching['set_session_user'].call_count == 3

    @pytest.mark.asyncio
    async def test_clear_cache_allows_fresh_lookup(self, mock_cognee_for_caching):
        """TDD: clear_user_cache should allow a fresh DB lookup."""
        from user_context import ensure_user_context, clear_user_cache

        clear_user_cache()
        await ensure_user_context()

        clear_user_cache()
        await ensure_user_context()

        # get_default_user should be called twice (once per cache clear)
        assert mock_cognee_for_caching['get_default_user'].call_count == 2


class TestUserContextErrorHandling:
    """Test error handling with structured error envelopes (Plan 093 Error Contract)."""

    @pytest.mark.asyncio
    async def test_db_not_created_error(self):
        """TDD: DatabaseNotCreatedError should return COGNEE_RELATIONAL_DB_NOT_CREATED."""
        from user_context import ensure_user_context, UserContextError, clear_user_cache

        # Create a mock that raises the specific exception
        class DatabaseNotCreatedError(Exception):
            pass

        mock_get_default_user = AsyncMock(side_effect=DatabaseNotCreatedError("DB not initialized"))

        with patch.dict('sys.modules', {
            'cognee': MagicMock(),
            'cognee.modules': MagicMock(),
            'cognee.modules.users': MagicMock(),
            'cognee.modules.users.methods': MagicMock(get_default_user=mock_get_default_user),
            'cognee.context_global_variables': MagicMock(),
            'cognee.infrastructure.databases.exceptions': MagicMock(DatabaseNotCreatedError=DatabaseNotCreatedError),
        }):
            clear_user_cache()

            with pytest.raises(UserContextError) as exc_info:
                await ensure_user_context()

            error = exc_info.value
            assert error.error_code == "COGNEE_RELATIONAL_DB_NOT_CREATED"
            assert "user_message" in dir(error) or hasattr(error, 'user_message')
            assert "remediation" in dir(error) or hasattr(error, 'remediation')

    @pytest.mark.asyncio
    async def test_db_not_created_error_by_name_fallback(self):
        """If DatabaseNotCreatedError import is unavailable, fallback checks exception name."""
        from user_context import ensure_user_context, UserContextError, clear_user_cache

        class DatabaseNotCreatedError(Exception):
            pass

        mock_get_default_user = AsyncMock(side_effect=DatabaseNotCreatedError("DB not initialized"))

        with patch.dict(
            "sys.modules",
            {
                "cognee": MagicMock(),
                "cognee.modules": MagicMock(),
                "cognee.modules.users": MagicMock(),
                "cognee.modules.users.methods": MagicMock(get_default_user=mock_get_default_user),
                "cognee.context_global_variables": MagicMock(),
                # Intentionally omit cognee.infrastructure.databases.exceptions so import fails
            },
        ):
            clear_user_cache()

            with pytest.raises(UserContextError) as exc_info:
                await ensure_user_context()

            assert exc_info.value.error_code == "COGNEE_RELATIONAL_DB_NOT_CREATED"

    @pytest.mark.asyncio
    async def test_generic_user_lookup_error(self):
        """TDD: Generic exception should return COGNEE_DEFAULT_USER_LOOKUP_FAILED."""
        from user_context import ensure_user_context, UserContextError, clear_user_cache

        mock_get_default_user = AsyncMock(side_effect=RuntimeError("Connection failed"))

        with patch.dict('sys.modules', {
            'cognee': MagicMock(),
            'cognee.modules': MagicMock(),
            'cognee.modules.users': MagicMock(),
            'cognee.modules.users.methods': MagicMock(get_default_user=mock_get_default_user),
            'cognee.context_global_variables': MagicMock(),
        }):
            clear_user_cache()

            with pytest.raises(UserContextError) as exc_info:
                await ensure_user_context()

            error = exc_info.value
            assert error.error_code == "COGNEE_DEFAULT_USER_LOOKUP_FAILED"

    @pytest.mark.asyncio
    async def test_session_context_set_error(self):
        """TDD: Error setting ContextVar should return COGNEE_SESSION_USER_CONTEXT_SET_FAILED."""
        from user_context import ensure_user_context, UserContextError, clear_user_cache

        mock_user = MagicMock()
        mock_user.id = "user-123"
        mock_get_default_user = AsyncMock(return_value=mock_user)
        mock_set_session_user = AsyncMock(side_effect=RuntimeError("ContextVar error"))

        with patch.dict('sys.modules', {
            'cognee': MagicMock(),
            'cognee.modules': MagicMock(),
            'cognee.modules.users': MagicMock(),
            'cognee.modules.users.methods': MagicMock(get_default_user=mock_get_default_user),
            'cognee.context_global_variables': MagicMock(set_session_user_context_variable=mock_set_session_user),
        }):
            clear_user_cache()

            with pytest.raises(UserContextError) as exc_info:
                await ensure_user_context()

            error = exc_info.value
            assert error.error_code == "COGNEE_SESSION_USER_CONTEXT_SET_FAILED"


class TestUserContextErrorEnvelope:
    """Test that UserContextError produces a valid structured error envelope."""

    def test_error_envelope_structure(self):
        """TDD: UserContextError.to_envelope() should return the required structure."""
        from user_context import UserContextError

        error = UserContextError(
            error_code="COGNEE_RELATIONAL_DB_NOT_CREATED",
            user_message="Database not initialized",
            remediation="Run cognify to initialize the database",
            details={"exception_type": "DatabaseNotCreatedError"}
        )

        envelope = error.to_envelope()

        assert envelope["success"] is False
        assert envelope["error_code"] == "COGNEE_RELATIONAL_DB_NOT_CREATED"
        assert envelope["user_message"] == "Database not initialized"
        assert envelope["remediation"] == "Run cognify to initialize the database"
        assert "details" in envelope
        assert envelope["details"]["exception_type"] == "DatabaseNotCreatedError"

    def test_envelope_no_secrets(self):
        """TDD: Error envelope should not expose secrets in user_message."""
        from user_context import UserContextError

        # Even if we accidentally include sensitive info in details,
        # user_message should be sanitized
        error = UserContextError(
            error_code="COGNEE_DEFAULT_USER_LOOKUP_FAILED",
            user_message="Failed to lookup default user",
            remediation="Check database connection",
            details={"stack_trace": "at line 123..."}  # details can have diagnostic info
        )

        envelope = error.to_envelope()

        # user_message should not contain stack traces
        assert "line 123" not in envelope["user_message"]


class TestUserContextResultStructure:
    """Test UserContextResult dataclass structure."""

    def test_result_success_structure(self):
        """TDD: UserContextResult should have success=True, user_id, and no error fields on success."""
        from user_context import UserContextResult

        result = UserContextResult(
            success=True,
            user_id="test-user-789",
            error_code=None,
            user_message=None,
            remediation=None
        )

        assert result.success is True
        assert result.user_id == "test-user-789"
        assert result.error_code is None

    def test_result_to_dict(self):
        """TDD: UserContextResult.to_dict() should return a serializable dict."""
        from user_context import UserContextResult

        result = UserContextResult(
            success=True,
            user_id="test-user-789",
            error_code=None,
            user_message=None,
            remediation=None
        )

        d = result.to_dict()

        assert d["success"] is True
        assert d["user_id"] == "test-user-789"


class TestUserContextLoggingAndImportErrors:
    """Fill coverage gaps for logger branches and ImportError handling."""

    @pytest.mark.asyncio
    async def test_logger_debug_paths_execute(self):
        """Passing a logger should exercise debug branches (cache + set-context)."""
        from user_context import ensure_user_context, clear_user_cache

        clear_user_cache()

        mock_user = MagicMock()
        mock_user.id = "log-user-999"

        mock_get_default_user = AsyncMock(return_value=mock_user)
        mock_set_session_user = AsyncMock()

        logger = logging.getLogger("test_user_context_logger")
        logger.setLevel(logging.DEBUG)

        with patch.dict(
            "sys.modules",
            {
                "cognee": MagicMock(),
                "cognee.modules": MagicMock(),
                "cognee.modules.users": MagicMock(),
                "cognee.modules.users.methods": MagicMock(get_default_user=mock_get_default_user),
                "cognee.context_global_variables": MagicMock(
                    set_session_user_context_variable=mock_set_session_user
                ),
            },
        ):
            # First call: exercises "Fetching default user" + "Cached default user" debug lines
            await ensure_user_context(logger=logger)
            # Second call: exercises "Using cached default user" debug line
            await ensure_user_context(logger=logger)

        assert mock_get_default_user.call_count == 1
        assert mock_set_session_user.call_count == 2

    @pytest.mark.asyncio
    async def test_import_error_for_user_module_raises_structured_error(self, monkeypatch):
        """ImportError during get_default_user import should map to COGNEE_DEFAULT_USER_LOOKUP_FAILED."""
        from user_context import ensure_user_context, UserContextError, clear_user_cache

        clear_user_cache()

        original_import = builtins.__import__

        def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
            if name == "cognee.modules.users.methods":
                raise ImportError("forced import failure")
            return original_import(name, globals, locals, fromlist, level)

        monkeypatch.setattr(builtins, "__import__", fake_import)

        with pytest.raises(UserContextError) as exc_info:
            await ensure_user_context()

        assert exc_info.value.error_code == "COGNEE_DEFAULT_USER_LOOKUP_FAILED"

    @pytest.mark.asyncio
    async def test_import_error_for_context_module_raises_structured_error(self, monkeypatch):
        """ImportError during set_session_user_context_variable import should map to COGNEE_SESSION_USER_CONTEXT_SET_FAILED."""
        from user_context import ensure_user_context, UserContextError, clear_user_cache

        clear_user_cache()

        mock_user = MagicMock()
        mock_user.id = "ctx-import-user-1"

        mock_get_default_user = AsyncMock(return_value=mock_user)

        original_import = builtins.__import__

        def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
            if name == "cognee.context_global_variables":
                raise ImportError("forced context import failure")
            return original_import(name, globals, locals, fromlist, level)

        monkeypatch.setattr(builtins, "__import__", fake_import)

        with patch.dict(
            "sys.modules",
            {
                "cognee": MagicMock(),
                "cognee.modules": MagicMock(),
                "cognee.modules.users": MagicMock(),
                "cognee.modules.users.methods": MagicMock(get_default_user=mock_get_default_user),
            },
        ):
            with pytest.raises(UserContextError) as exc_info:
                await ensure_user_context()

        assert exc_info.value.error_code == "COGNEE_SESSION_USER_CONTEXT_SET_FAILED"
