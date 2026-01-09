"""
Pytest fixtures for Cognee bridge testing.

Provides mocked Cognee client, temporary workspaces, and test environment variables.
"""
import sys
import tempfile
import types
from pathlib import Path
from typing import Generator
from unittest.mock import AsyncMock, MagicMock

import pytest


def pytest_configure(config):
    """
    Early hook to check for required test dependencies.

    Fails fast with actionable error message if rdflib is not installed,
    preventing confusing downstream failures in ontology-related tests.
    """
    try:
        import rdflib  # noqa: F401 - import used to check availability
    except ImportError as e:
        raise pytest.UsageError(
            "\n\n"
            "=" * 70 + "\n"
            "MISSING DEPENDENCY: rdflib\n"
            "=" * 70 + "\n\n"
            "The rdflib library is required for running Flowbaby bridge tests.\n\n"
            "To fix this, run one of the following commands:\n\n"
            "  # Using pip (in your test environment):\n"
            "  pip install rdflib\n\n"
            "  # Using the bridge requirements:\n"
            "  pip install -r extension/bridge/requirements.txt\n\n"
            "  # Or install into the bridge venv:\n"
            "  extension/bridge/.venv/bin/pip install rdflib\n\n"
            "=" * 70 + "\n"
        ) from e


@pytest.fixture
def temp_workspace() -> Generator[Path, None, None]:
    """
    Create a temporary workspace directory for testing.

    Yields:
        Path to temporary workspace directory
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        workspace_path = Path(tmpdir)
        yield workspace_path


@pytest.fixture
def mock_env(temp_workspace: Path, monkeypatch) -> dict:
    """
    Set up test environment variables.

    Args:
        temp_workspace: Temporary workspace path
        monkeypatch: Pytest monkeypatch fixture

    Returns:
        Dictionary of environment variables set
    """
    # Plan 083 M5: v0.7.0 is Cloud-only - use AWS_* credentials for tests
    env_vars = {
        'AWS_ACCESS_KEY_ID': 'AKIAIOSFODNN7EXAMPLE',
        'AWS_SECRET_ACCESS_KEY': 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        'AWS_SESSION_TOKEN': 'test-session-token',
        'AWS_REGION': 'us-east-1',
        'WORKSPACE_PATH': str(temp_workspace)
    }

    for key, value in env_vars.items():
        monkeypatch.setenv(key, value)

    # Remove any legacy LLM_API_KEY that might be in the environment
    monkeypatch.delenv('LLM_API_KEY', raising=False)

    return env_vars


@pytest.fixture
def mock_cognee():
    """
    Provide a mocked Cognee client with common methods.

    Returns:
        MagicMock configured with Cognee-like interface
    """
    mock = MagicMock()

    # Mock config methods
    mock.config = MagicMock()
    mock.config.set_llm_api_key = MagicMock()
    mock.config.set_llm_provider = MagicMock()
    mock.config.system_root_directory = MagicMock()
    mock.config.data_root_directory = MagicMock()

    # Mock async methods
    mock.add = AsyncMock(return_value=None)
    mock.cognify = AsyncMock(return_value=None)
    mock.search = AsyncMock(return_value=[{
        'text': 'Test memory content',
        'score': 0.95
    }])
    mock.prune = MagicMock()
    mock.prune.prune_system = AsyncMock(return_value=None)

    return mock


@pytest.fixture
def mock_cognee_config(mock_cognee):
    """
    Provide mocked Cognee configuration methods.

    Returns:
        Mocked config object
    """
    return mock_cognee.config


@pytest.fixture
def sample_conversation() -> dict:
    """
    Provide sample conversation data for testing.

    Returns:
        Dictionary with user_message and assistant_message
    """
    return {
        'user_message': 'How do I implement caching in Python?',
        'assistant_message': 'You can use functools.lru_cache decorator for simple function memoization...',
        'importance': 0.5
    }


@pytest.fixture
def mock_cognee_module(mock_cognee, temp_workspace):
    """
    Install mock Cognee module into sys.modules for test, clean up after.

    This fixture enables tests to mock function-scoped `import cognee` statements
    by pre-populating sys.modules['cognee'] with a mock module, including
    infrastructure modules for get_relational_config.

    Args:
        mock_cognee: The mocked Cognee client fixture
        temp_workspace: Temporary workspace path for generating mock db_path

    Yields:
        The mock_cognee fixture for assertions
    """
    # Create mock relational config
    mock_relational_config = types.SimpleNamespace(
        db_path=str(temp_workspace / '.flowbaby/system' / 'cognee.db')
    )

    # Create mock get_relational_config function
    mock_get_relational_config = MagicMock(return_value=mock_relational_config)

    # Create mock create_db_and_tables function (async)
    mock_create_db_and_tables = AsyncMock(return_value=None)

    # Create mock infrastructure.databases.relational module
    mock_relational_module = types.SimpleNamespace(
        get_relational_config=mock_get_relational_config,
        create_db_and_tables=mock_create_db_and_tables
    )

    # Create mock get_graph_engine function (async) - Plan 038/039
    mock_get_graph_engine = AsyncMock(return_value=MagicMock())

    # Create mock infrastructure.databases.graph module
    mock_graph_module = types.SimpleNamespace(
        get_graph_engine=mock_get_graph_engine
    )

    # Create mock infrastructure.databases module
    mock_databases_module = types.SimpleNamespace(
        relational=mock_relational_module,
        graph=mock_graph_module
    )

    # Create mock infrastructure module
    mock_infrastructure_module = types.SimpleNamespace(
        databases=mock_databases_module
    )

    # Create main cognee module
    mock_module = types.SimpleNamespace(
        config=mock_cognee.config,
        add=mock_cognee.add,
        cognify=mock_cognee.cognify,
        prune=mock_cognee.prune,  # This includes prune.prune_system as AsyncMock
        infrastructure=mock_infrastructure_module,
    )

    # Install into sys.modules
    sys.modules['cognee'] = mock_module
    sys.modules['cognee.infrastructure'] = mock_infrastructure_module
    sys.modules['cognee.infrastructure.databases'] = mock_databases_module
    sys.modules['cognee.infrastructure.databases.relational'] = mock_relational_module
    sys.modules['cognee.infrastructure.databases.graph'] = mock_graph_module

    yield mock_cognee  # Return original fixture for assertions

    # Cleanup
    for module_name in [
        'cognee.infrastructure.databases.graph',
        'cognee.infrastructure.databases.relational',
        'cognee.infrastructure.databases',
        'cognee.infrastructure',
        'cognee'
    ]:
        if module_name in sys.modules:
            del sys.modules[module_name]


@pytest.fixture
def mock_rdflib_graph():
    """
    Install mock RDFLib Graph into sys.modules for ingest tests.

    Enables mocking of function-scoped `from rdflib import Graph` statements.

    Yields:
        Mock Graph class
    """
    mock_graph_class = MagicMock()
    mock_graph_instance = MagicMock()
    mock_graph_instance.parse = MagicMock()
    mock_graph_class.return_value = mock_graph_instance

    # Create mock rdflib module if it doesn't exist
    if 'rdflib' not in sys.modules:
        mock_rdflib = types.SimpleNamespace(Graph=mock_graph_class)
        sys.modules['rdflib'] = mock_rdflib
        created_rdflib = True
    else:
        # Store original Graph for restoration
        original_graph = getattr(sys.modules['rdflib'], 'Graph', None)
        sys.modules['rdflib'].Graph = mock_graph_class
        created_rdflib = False

    yield mock_graph_class

    # Cleanup
    if created_rdflib and 'rdflib' in sys.modules:
        del sys.modules['rdflib']
    elif not created_rdflib and original_graph is not None:
        sys.modules['rdflib'].Graph = original_graph


@pytest.fixture
def sample_ontology() -> dict:
    """
    Provide sample ontology data for testing.

    Returns:
        Dictionary with ontology structure
    """
    return {
        'entities': [
            {'name': 'User', 'properties': []},
            {'name': 'Question', 'properties': []},
            {'name': 'Answer', 'properties': []},
            {'name': 'Topic', 'properties': []},
            {'name': 'Concept', 'properties': []},
            {'name': 'Problem', 'properties': []},
            {'name': 'Solution', 'properties': []},
            {'name': 'Decision', 'properties': []}
        ],
        'relationships': [
            {'source': 'User', 'target': 'Question', 'type': 'asks'},
            {'source': 'Question', 'target': 'Answer', 'type': 'hasAnswer'}
        ]
    }


@pytest.fixture
def mock_user_context():
    """
    Mock the ensure_user_context helper (Plan 093) for tests that don't need real DB.

    This fixture mocks the user context helper to return a successful result
    without actually hitting the database. Use this for tests that focus on
    other functionality and just need user context to not fail.

    Yields:
        The mock function for assertions
    """
    from unittest.mock import patch
    from user_context import UserContextResult

    mock_result = UserContextResult(
        success=True,
        user_id='test-user-id',
        is_cached=False,
        error=None
    )

    with patch('ingest.ensure_user_context', new_callable=AsyncMock, return_value=mock_result) as mock_ingest:
        with patch('retrieve.ensure_user_context', new_callable=AsyncMock, return_value=mock_result) as mock_retrieve:
            with patch('visualize.ensure_user_context', new_callable=AsyncMock, return_value=mock_result) as mock_visualize:
                yield {
                    'ingest': mock_ingest,
                    'retrieve': mock_retrieve,
                    'visualize': mock_visualize,
                    'result': mock_result
                }
