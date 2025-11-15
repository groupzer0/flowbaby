"""
Pytest fixtures for Cognee bridge testing.

Provides mocked Cognee client, temporary workspaces, and test environment variables.
"""
import json
import os
import sys
import tempfile
import types
from pathlib import Path
from typing import Generator
from unittest.mock import MagicMock, AsyncMock, patch

import pytest


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
    env_vars = {
        'LLM_API_KEY': 'sk-test-mock-key-12345',
        'WORKSPACE_PATH': str(temp_workspace)
    }
    
    for key, value in env_vars.items():
        monkeypatch.setenv(key, value)
    
    # Create .env file in workspace
    env_file = temp_workspace / '.env'
    env_file.write_text('LLM_API_KEY=sk-test-mock-key-12345\n')
    
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
    return mock.cognee.config


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
        db_path=str(temp_workspace / '.cognee_system' / 'cognee.db')
    )
    
    # Create mock get_relational_config function
    mock_get_relational_config = MagicMock(return_value=mock_relational_config)
    
    # Create mock infrastructure.databases.relational module
    mock_relational_module = types.SimpleNamespace(
        get_relational_config=mock_get_relational_config
    )
    
    # Create mock infrastructure.databases module
    mock_databases_module = types.SimpleNamespace(
        relational=mock_relational_module
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
    
    yield mock_cognee  # Return original fixture for assertions
    
    # Cleanup
    for module_name in [
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
