#!/usr/bin/env python3
"""
Cognee Probe Bypass Module - Plan 088

Provides runtime bypass for Cognee's internal LLM/embedding probes to prevent
add-only ingest failures caused by Bedrock structured-output instability.

Analysis 089 validated that setting `_first_run_done = True` on the
`setup_and_check_environment` module prevents `test_llm_connection()` from
running, which is the source of InstructorRetryException failures.

This bypass is applied BEFORE any Cognee import to ensure the internal probes
are never invoked. The bridge-side Bedrock health check (bedrock_health.py)
serves as the authoritative connectivity validation instead.

Usage:
    from cognee_probe_bypass import apply_cognee_probe_bypass
    apply_cognee_probe_bypass()  # Call before importing cognee
    import cognee
    await cognee.add(...)
"""

import logging

logger = logging.getLogger(__name__)


def apply_cognee_probe_bypass() -> bool:
    """
    Apply runtime bypass to skip Cognee's internal LLM/embedding probes.
    
    Sets `_first_run_done = True` on the Cognee setup module to prevent
    `test_llm_connection()` and `test_embedding_connection()` from running
    during `setup_and_check_environment()`.
    
    This function is idempotent - calling it multiple times is safe.
    
    Returns:
        True if bypass was applied successfully, False otherwise.
        
    Note:
        This bypass also skips the embedding probe. The decision in Plan 088
        Section 5.1 is to DEFER embedding validation to first-use with clear
        error handling, rather than implementing a replacement pre-flight check.
    """
    try:
        # Import the setup module to patch
        import cognee.modules.pipelines.layers.setup_and_check_environment as setup_mod
        
        # Check current state
        was_already_set = getattr(setup_mod, '_first_run_done', False)
        
        # Apply bypass by setting the flag
        setup_mod._first_run_done = True
        
        if was_already_set:
            logger.debug("Cognee probe bypass: already applied (idempotent)")
        else:
            logger.info("Cognee probe bypass: applied (_first_run_done = True)")
        
        return True
        
    except ImportError as e:
        # Cognee not installed or module structure changed
        logger.warning(f"Cognee probe bypass: could not import setup module: {e}")
        return False
    except AttributeError as e:
        # Module structure changed in newer Cognee version
        logger.warning(f"Cognee probe bypass: module structure unexpected: {e}")
        return False
    except Exception as e:
        # Unexpected error - log but don't crash
        logger.error(f"Cognee probe bypass: unexpected error: {e}")
        return False


def is_bypass_active() -> bool:
    """
    Check if the Cognee probe bypass is currently active.
    
    Returns:
        True if _first_run_done is True, False otherwise.
    """
    try:
        import cognee.modules.pipelines.layers.setup_and_check_environment as setup_mod
        return getattr(setup_mod, '_first_run_done', False)
    except ImportError:
        return False


def reset_bypass() -> bool:
    """
    Reset the bypass (for testing purposes only).
    
    WARNING: This will cause Cognee's internal probes to run on the next
    setup_and_check_environment() call, which may fail with Bedrock.
    
    Returns:
        True if reset was successful, False otherwise.
    """
    try:
        import cognee.modules.pipelines.layers.setup_and_check_environment as setup_mod
        setup_mod._first_run_done = False
        logger.debug("Cognee probe bypass: reset (_first_run_done = False)")
        return True
    except Exception as e:
        logger.error(f"Cognee probe bypass reset failed: {e}")
        return False
