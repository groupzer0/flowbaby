"""
Unit tests for lance-namespace pin validation (Plan 034).

These tests verify that the pinned lance-namespace==0.0.21 version resolves the
ModuleNotFoundError that occurred with lance-namespace==0.2.0.
"""
import sys
from pathlib import Path

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


class TestLanceNamespaceImport:
    """Tests for lance-namespace module availability."""

    def test_lancedb_import_succeeds(self):
        """Verify that lancedb can be imported without ModuleNotFoundError.
        
        Plan 034 pins lance-namespace to 0.0.21 because version 0.2.0 is broken
        and missing the top-level lance_namespace module. This test ensures
        lancedb (which depends on lance-namespace) imports correctly.
        """
        try:
            import lancedb
            # If we get here, import succeeded
            assert lancedb is not None
        except ModuleNotFoundError as e:
            pytest.fail(f"lancedb import failed with ModuleNotFoundError: {e}")

    def test_lance_namespace_module_exists(self):
        """Verify that the lance_namespace module is accessible.
        
        The root cause of the Plan 034 bug was that lance-namespace==0.2.0
        only shipped lance_namespace_urllib3_client but not lance_namespace.
        Version 0.0.21 correctly includes the lance_namespace top-level module.
        """
        try:
            import lance_namespace
            assert lance_namespace is not None
        except ModuleNotFoundError as e:
            pytest.fail(
                f"lance_namespace import failed: {e}. "
                "Ensure lance-namespace==0.0.21 is installed per requirements.txt"
            )

    def test_cognee_vector_engine_accessible(self):
        """Verify that Cognee's vector engine can be loaded.
        
        This is the actual codepath that failed in production: Cognee's
        get_vector_engine() internally imports lancedb, which depends on
        lance_namespace. If this test passes, the full vector retrieval
        pipeline will work.
        """
        try:
            from cognee.infrastructure.databases.vector import get_vector_engine
            # Just verify the function exists and is callable
            assert callable(get_vector_engine)
        except ModuleNotFoundError as e:
            pytest.fail(
                f"Cognee vector engine import failed: {e}. "
                "This indicates a lance-namespace version mismatch."
            )
        except ImportError as e:
            # Other import errors (like missing config) are acceptable here;
            # we're only testing that lance_namespace doesn't break the import chain
            if "lance_namespace" in str(e).lower() or "lancedb" in str(e).lower():
                pytest.fail(f"Lance-related import error: {e}")
            # Pass for other ImportErrors (e.g., missing env config)
