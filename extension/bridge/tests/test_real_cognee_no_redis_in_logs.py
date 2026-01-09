"""Integration test: real Cognee import with FS cache defaults.

Plan 059 quantitative validation: In managed defaults (CACHING=true, CACHE_BACKEND=fs),
retrieval should produce zero Redis-related warnings/errors in bridge logs.

This test imports the real Cognee package but stubs the expensive `cognee.search`
call at import-time to keep the test fast and offline.
"""

from __future__ import annotations

import importlib.abc
import os
import re
import sys
from importlib.machinery import PathFinder
from pathlib import Path
from typing import Any

import pytest


def _purge_modules(prefix: str) -> None:
    for name in list(sys.modules.keys()):
        if name == prefix or name.startswith(prefix + "."):
            sys.modules.pop(name, None)


class _CogneePatchLoader(importlib.abc.Loader):
    def __init__(self, wrapped_loader: importlib.abc.Loader):
        self._wrapped_loader = wrapped_loader

    def create_module(self, spec):  # type: ignore[override]
        create = getattr(self._wrapped_loader, "create_module", None)
        if callable(create):
            return create(spec)
        return None

    def exec_module(self, module) -> None:  # type: ignore[override]
        self._wrapped_loader.exec_module(module)

        async def _search_stub(*args: Any, **kwargs: Any):
            return []

        module.search = _search_stub


class _CogneePatchFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname: str, path, target=None):  # type: ignore[override]
        if fullname != "cognee":
            return None

        spec = PathFinder.find_spec(fullname, path)
        if spec is None or spec.loader is None:
            return spec

        spec.loader = _CogneePatchLoader(spec.loader)
        return spec


@pytest.mark.asyncio
async def test_retrieve_real_cognee_produces_no_redis_failures_in_logs(tmp_path: Path, monkeypatch, capfd):
    from unittest.mock import AsyncMock, MagicMock, patch

    workspace = tmp_path / "ws"
    workspace.mkdir(parents=True)

    # Plan 083 M5: Use AWS credentials (Cloud-only mode)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")

    for key in [
        "SYSTEM_ROOT_DIRECTORY",
        "DATA_ROOT_DIRECTORY",
        "CACHE_ROOT_DIRECTORY",
        "CACHING",
        "CACHE_BACKEND",
    ]:
        monkeypatch.delenv(key, raising=False)

    _purge_modules("cognee")

    finder = _CogneePatchFinder()
    sys.meta_path.insert(0, finder)
    try:
        # Plan 093: Mock user context helper since we don't have a real DB in this test
        mock_user_ctx_result = MagicMock(success=True, user_id='test-user')
        with patch('retrieve.ensure_user_context', new_callable=AsyncMock, return_value=mock_user_ctx_result):
            from retrieve import retrieve_context

            result = await retrieve_context(str(workspace), "hello", max_results=3)
            assert result.get("success") is True

            assert os.environ.get("CACHING") == "true"
            assert os.environ.get("CACHE_BACKEND") == "fs"

            log_file = workspace / ".flowbaby/logs/flowbaby.log"
            assert log_file.exists(), "Expected bridge log file to be created"

            log_text = log_file.read_text(encoding="utf-8", errors="replace")
            captured = capfd.readouterr()
            combined_text = log_text + "\n" + (captured.err or "")

            bad_patterns = [
                r"ModuleNotFoundError:.*redis",
                r"No module named ['\"]redis['\"]",
                r"redis.*(ECONNREFUSED|Connection refused|ConnectionError|TimeoutError|timed out)",
                r"(ECONNREFUSED|Connection refused|ConnectionError|TimeoutError|timed out).*redis",
            ]

            for pattern in bad_patterns:
                assert re.search(pattern, combined_text, flags=re.IGNORECASE) is None, (
                    f"Found Redis-related failure pattern in logs/stderr: {pattern}"
                )
    finally:
        if sys.meta_path and sys.meta_path[0] is finder:
            sys.meta_path.pop(0)
        else:
            try:
                sys.meta_path.remove(finder)
            except ValueError:
                pass
        _purge_modules("cognee")
