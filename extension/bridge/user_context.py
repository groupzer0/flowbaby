#!/usr/bin/env python3
"""
Cognee User Context Helper - Plan 093

This module provides a shared, idempotent user context helper for all bridge
entrypoints (ingest, retrieve, visualize). It implements a two-layer design:

1. **Load/Cache Layer**: Loads the default user from the relational DB at most
   once per process lifetime (≤1 DB hit per process).

2. **ContextVar Layer**: Sets the request/task-local `session_user` ContextVar
   for each operation that needs it (no DB hit required after initial load).

Architecture Requirements (Plan 093 / Architecture Findings 093):
- DRY: Single helper prevents drift between entrypoints
- Idempotent: Safe to call multiple times without side effects
- Cached: Default user lookup happens once per process
- Structured Errors: All failures return machine-readable error envelopes
- Import Order: This module imports Cognee lazily to support bridge_env ordering

Error Codes:
- COGNEE_RELATIONAL_DB_NOT_CREATED: Default user lookup failed because the
  relational DB is not initialized.
- COGNEE_DEFAULT_USER_LOOKUP_FAILED: Default user lookup failed for reasons
  other than "DB not created".
- COGNEE_SESSION_USER_CONTEXT_SET_FAILED: Failed to set `session_user` ContextVar.

@see agent-output/planning/093-cognee-multiuser-user-context.md
@see agent-output/architecture/093-cognee-multiuser-user-context-architecture-findings.md
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

# Module-level cache for the default user (≤1 DB hit per process)
_cached_default_user: Optional[Any] = None
_cache_initialized: bool = False


@dataclass
class UserContextResult:
    """
    Result of ensure_user_context() operation.

    Attributes:
        success: Whether user context was successfully established.
        user_id: The ID of the user whose context was set (None on failure).
        error_code: Structured error code (None on success).
        user_message: User-safe error message (None on success).
        remediation: Actionable remediation guidance (None on success).
    """
    success: bool
    user_id: Optional[str] = None
    error_code: Optional[str] = None
    user_message: Optional[str] = None
    remediation: Optional[str] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "success": self.success,
            "user_id": self.user_id,
            "error_code": self.error_code,
            "user_message": self.user_message,
            "remediation": self.remediation,
        }


@dataclass
class UserContextError(Exception):
    """
    Exception raised when user context setup fails.

    Implements the Plan 093 Error Contract with structured error envelopes
    suitable for machine-readable parsing by the TypeScript layer.

    Attributes:
        error_code: One of the COGNEE_* error codes defined in Plan 093.
        user_message: User-safe message without secrets or stack traces.
        remediation: Actionable guidance for resolving the error.
        details: Optional diagnostic information (may include exception type, hints).
    """
    error_code: str
    user_message: str
    remediation: str
    details: dict = field(default_factory=dict)

    def __post_init__(self):
        # Set the exception message for standard exception handling
        super().__init__(self.user_message)

    def to_envelope(self) -> dict:
        """
        Convert to structured error envelope per Plan 093 Error Contract.

        Returns:
            Dictionary with success=False and all required error fields.
        """
        return {
            "success": False,
            "error_code": self.error_code,
            "user_message": self.user_message,
            "remediation": self.remediation,
            "details": self.details,
        }


def clear_user_cache() -> None:
    """
    Clear the cached default user.

    This is primarily useful for testing scenarios where you need to
    simulate a fresh process state. In production, the cache persists
    for the lifetime of the process.
    """
    global _cached_default_user, _cache_initialized
    _cached_default_user = None
    _cache_initialized = False


async def _get_cached_default_user(logger: Optional[logging.Logger] = None) -> Any:
    """
    Get the default user, using cache if available.

    This is the "load/cache layer" that ensures at most one DB hit per process.
    On first call, it fetches from Cognee's relational DB. Subsequent calls
    return the cached value.

    Args:
        logger: Optional logger for debug output.

    Returns:
        The default user object from Cognee.

    Raises:
        UserContextError: If the user lookup fails (with appropriate error code).
    """
    global _cached_default_user, _cache_initialized

    # Return cached user if available
    if _cache_initialized and _cached_default_user is not None:
        if logger:
            logger.debug(f"Using cached default user: {_cached_default_user.id}")
        return _cached_default_user

    # Import Cognee APIs lazily to support bridge_env ordering
    try:
        from cognee.modules.users.methods import get_default_user
    except ImportError as e:
        raise UserContextError(
            error_code="COGNEE_DEFAULT_USER_LOOKUP_FAILED",
            user_message="Failed to import Cognee user module",
            remediation="Ensure Cognee is properly installed and bridge_env has been applied",
            details={"exception_type": type(e).__name__, "hint": str(e)},
        )

    # Try to detect DatabaseNotCreatedError for specific error handling
    try:
        from cognee.infrastructure.databases.exceptions import DatabaseNotCreatedError
    except ImportError:
        # Older Cognee versions may not have this exception in this location
        DatabaseNotCreatedError = None

    # Fetch default user from DB (this is the only DB hit)
    try:
        if logger:
            logger.debug("Fetching default user from Cognee (first lookup)")
        user = await get_default_user()
        _cached_default_user = user
        _cache_initialized = True
        if logger:
            logger.debug(f"Cached default user: {user.id}")
        return user

    except Exception as e:
        # Check if this is a "DB not created" error
        if DatabaseNotCreatedError is not None and isinstance(e, DatabaseNotCreatedError):
            raise UserContextError(
                error_code="COGNEE_RELATIONAL_DB_NOT_CREATED",
                user_message="The Cognee database has not been initialized yet",
                remediation="Run an ingest operation (cognify) to initialize the database, then retry",
                details={"exception_type": type(e).__name__},
            )

        # Check by exception name for broader compatibility
        if "DatabaseNotCreatedError" in type(e).__name__:
            raise UserContextError(
                error_code="COGNEE_RELATIONAL_DB_NOT_CREATED",
                user_message="The Cognee database has not been initialized yet",
                remediation="Run an ingest operation (cognify) to initialize the database, then retry",
                details={"exception_type": type(e).__name__},
            )

        # Generic user lookup failure
        raise UserContextError(
            error_code="COGNEE_DEFAULT_USER_LOOKUP_FAILED",
            user_message="Failed to lookup the default user",
            remediation="Check the database connection and ensure Cognee is properly configured",
            details={"exception_type": type(e).__name__, "hint": str(e)[:200]},
        )


async def _set_session_user_context(user: Any, logger: Optional[logging.Logger] = None) -> None:
    """
    Set the session user ContextVar for the current operation.

    This is the "ContextVar layer" that sets the request/task-local context.
    It does NOT hit the database - it only sets the in-memory ContextVar.

    Args:
        user: The user object to set as session user.
        logger: Optional logger for debug output.

    Raises:
        UserContextError: If setting the ContextVar fails.
    """
    try:
        from cognee.context_global_variables import set_session_user_context_variable
    except ImportError as e:
        raise UserContextError(
            error_code="COGNEE_SESSION_USER_CONTEXT_SET_FAILED",
            user_message="Failed to import Cognee context module",
            remediation="Ensure Cognee is properly installed and bridge_env has been applied",
            details={"exception_type": type(e).__name__, "hint": str(e)},
        )

    try:
        if logger:
            logger.debug(f"Setting session user context for user: {user.id}")
        await set_session_user_context_variable(user)
    except Exception as e:
        raise UserContextError(
            error_code="COGNEE_SESSION_USER_CONTEXT_SET_FAILED",
            user_message="Failed to set the session user context",
            remediation="This may indicate an internal Cognee API change. Check Cognee version compatibility.",
            details={"exception_type": type(e).__name__, "hint": str(e)[:200]},
        )


async def ensure_user_context(
    *,
    logger: Optional[logging.Logger] = None,
) -> UserContextResult:
    """
    Ensure Cognee session user context is established for the current operation.

    This is the main entry point for multi-user context wiring. It implements
    a two-layer design:

    1. **Load/Cache**: Gets the default user (cached after first DB hit)
    2. **Set ContextVar**: Sets the session_user ContextVar for this operation

    This function is idempotent and safe to call multiple times. The DB lookup
    happens at most once per process; the ContextVar is set on every call.

    CRITICAL: Call this AFTER apply_workspace_env() and AFTER importing cognee.
    The workspace environment must be configured before user context can be
    established.

    Args:
        logger: Optional logger for debug output.

    Returns:
        UserContextResult indicating success or failure with structured details.

    Raises:
        UserContextError: On failure, with structured error code and remediation.

    Example:
        from bridge_env import apply_workspace_env
        from user_context import ensure_user_context

        # 1. Apply workspace environment first
        config = apply_workspace_env(workspace_path)

        # 2. Import cognee
        import cognee

        # 3. Ensure user context before operations
        result = await ensure_user_context(logger=logger)
        if not result.success:
            # Handle error using result.error_code, result.user_message, etc.
            pass

        # 4. Now safe to call cognee operations
        await cognee.add(...)
    """
    # Step 1: Get cached default user (≤1 DB hit per process)
    user = await _get_cached_default_user(logger=logger)

    # Step 2: Set session user ContextVar (per-operation, no DB hit)
    await _set_session_user_context(user, logger=logger)

    return UserContextResult(
        success=True,
        user_id=str(user.id) if user else None,
    )
