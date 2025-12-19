"""Tests for Plan 059 cache configuration in daemon environment setup."""

import logging
import os

import pytest


@pytest.fixture
def logger() -> logging.Logger:
    log = logging.getLogger("flowbaby.daemon.test")
    log.handlers.clear()
    log.addHandler(logging.NullHandler())
    log.setLevel(logging.DEBUG)
    return log


def test_daemon_sets_cache_defaults_when_unset(tmp_path, monkeypatch, logger):
    from daemon import setup_cognee_environment

    workspace = tmp_path / "ws"
    workspace.mkdir()

    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.delenv("CACHING", raising=False)
    monkeypatch.delenv("CACHE_BACKEND", raising=False)

    setup_cognee_environment(str(workspace), logger)

    assert os.environ.get("CACHING") == "true"
    assert os.environ.get("CACHE_BACKEND") == "fs"
    assert os.environ.get("CACHE_ROOT_DIRECTORY") == str(workspace / ".flowbaby/cache")
    assert (workspace / ".flowbaby/cache").exists()


def test_daemon_respects_existing_cache_env_vars(tmp_path, monkeypatch, logger):
    from daemon import setup_cognee_environment

    workspace = tmp_path / "ws"
    workspace.mkdir()

    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("CACHING", "false")
    monkeypatch.setenv("CACHE_BACKEND", "redis")

    setup_cognee_environment(str(workspace), logger)

    assert os.environ.get("CACHING") == "false"
    assert os.environ.get("CACHE_BACKEND") == "redis"
    assert os.environ.get("CACHE_ROOT_DIRECTORY") == str(workspace / ".flowbaby/cache")
