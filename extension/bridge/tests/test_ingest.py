"""
Unit tests for ingest.py bridge script.

Tests add() and cognify() parameter usage, LLM_API_KEY validation, and structured error logging.
"""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.mark.asyncio
async def test_ingest_missing_llm_api_key(temp_workspace, monkeypatch):
    """Test that ingestion fails with clear error when LLM_API_KEY is missing."""
    # Remove LLM_API_KEY from environment
    monkeypatch.delenv('LLM_API_KEY', raising=False)

    # Remove .env file if it exists
    env_file = temp_workspace / '.env'
    if env_file.exists():
        env_file.unlink()

    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        from ingest import run_sync

        result = await run_sync(
            workspace_path=str(temp_workspace),
            user_message='Test user message',
            assistant_message='Test assistant message'
        )

        assert result['success'] is False
        assert 'LLM_API_KEY not found' in result['error']
        # assert 'Set LLM_API_KEY=' in result['error']


@pytest.mark.asyncio
async def test_ingest_add_with_correct_parameters(temp_workspace, mock_env, mock_cognee_module, mock_rdflib_graph):
    """Test that add() is called with data= and dataset_name= parameters and storage configured."""
    # Create ontology.ttl file
    ontology_path = temp_workspace.parent / 'ontology.ttl'
    ontology_path.write_text('@prefix : <http://example.org/> .\n:Test a :Class .')

    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        with patch('ingest.Path') as mock_path_class:
            # Mock ontology path
            mock_ontology = MagicMock()
            mock_ontology.exists.return_value = True

            def mock_path_side_effect(path_str):
                if 'ontology.ttl' in str(path_str):
                    return mock_ontology
                return Path(path_str)

            mock_path_class.side_effect = mock_path_side_effect

            from ingest import run_sync

            await run_sync(
                workspace_path=str(temp_workspace),
                user_message='How do I cache?',
                assistant_message='Use functools.lru_cache'
            )

            # Verify add() was called with correct parameters
            assert mock_cognee_module.add.called
            call_kwargs = mock_cognee_module.add.call_args.kwargs

            assert 'data' in call_kwargs
            assert isinstance(call_kwargs['data'], list)
            assert 'dataset_name' in call_kwargs

            # Verify workspace-local storage directories configured
            expected_system_dir = str(temp_workspace / '.flowbaby/system')
            expected_data_dir = str(temp_workspace / '.flowbaby/data')
            mock_cognee_module.config.system_root_directory.assert_called_once_with(expected_system_dir)
            mock_cognee_module.config.data_root_directory.assert_called_once_with(expected_data_dir)


@pytest.mark.asyncio
async def test_ingest_cognify_with_datasets_parameter(temp_workspace, mock_env, mock_cognee_module, mock_rdflib_graph):
    """Test that cognify() is called with datasets= parameter (not ontology_file_path)."""
    # Create ontology.ttl file
    ontology_path = temp_workspace.parent / 'ontology.ttl'
    ontology_path.write_text('@prefix : <http://example.org/> .\n:Test a :Class .')

    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        with patch('ingest.Path') as mock_path_class:
            mock_ontology = MagicMock()
            mock_ontology.exists.return_value = True

            def mock_path_side_effect(path_str):
                if 'ontology.ttl' in str(path_str):
                    return mock_ontology
                return Path(path_str)

            mock_path_class.side_effect = mock_path_side_effect

            from ingest import run_sync

            await run_sync(
                workspace_path=str(temp_workspace),
                user_message='Test question',
                assistant_message='Test answer'
            )

            # Verify cognify() was called with datasets parameter
            assert mock_cognee_module.cognify.called
            call_kwargs = mock_cognee_module.cognify.call_args.kwargs

            assert 'datasets' in call_kwargs
            assert isinstance(call_kwargs['datasets'], list)
            # Should NOT have ontology_file_path kwarg
            assert 'ontology_file_path' not in call_kwargs


@pytest.mark.asyncio
async def test_ingest_structured_error_logging(temp_workspace, mock_env, mock_cognee_module, mock_rdflib_graph, capsys):
    """Test that exceptions include structured error details in stderr."""
    # Create ontology.ttl file
    ontology_path = temp_workspace.parent / 'ontology.ttl'
    ontology_path.write_text('@prefix : <http://example.org/> .\n:Test a :Class .')

    # Make cognee.add raise an exception
    mock_cognee_module.add.side_effect = TypeError('Invalid parameter type')

    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        with patch('ingest.Path') as mock_path_class:
            mock_ontology = MagicMock()
            mock_ontology.exists.return_value = True

            def mock_path_side_effect(path_str):
                if 'ontology.ttl' in str(path_str):
                    return mock_ontology
                return Path(path_str)

            mock_path_class.side_effect = mock_path_side_effect

            from ingest import run_sync

            result = await run_sync(
                workspace_path=str(temp_workspace),
                user_message='Test question',
                assistant_message='Test answer'
            )

            # Check result includes exception type
            assert result['success'] is False
            assert 'TypeError' in result['error']

            # Check stderr output includes structured error JSON
            captured = capsys.readouterr()
            stderr_lines = captured.err.strip().split('\n')

            found_error_log = False
            for line in stderr_lines:
                try:
                    log_entry = json.loads(line)
                    if log_entry.get('level') == 'ERROR' and 'data' in log_entry:
                        error_details = log_entry['data']
                        if error_details.get('error_code') == 'COGNEE_SDK_ERROR':
                            found_error_log = True
                            assert 'error_type' in error_details
                            assert error_details['error_type'] == 'TypeError'
                            assert 'message' in error_details
                            # assert 'dataset_name' in error_details
                            # assert 'conversation_length' in error_details
                            # assert 'ontology_validated' in error_details
                            break
                except json.JSONDecodeError:
                    continue

            assert found_error_log, "Did not find structured error log in stderr"


@pytest.mark.asyncio
async def test_ingest_success_returns_metadata(temp_workspace, mock_env, mock_cognee_module, mock_rdflib_graph):
    """Test successful ingestion returns ingested_chars and timestamp."""
    # Create ontology.ttl file
    ontology_path = temp_workspace.parent / 'ontology.ttl'
    ontology_path.write_text('@prefix : <http://example.org/> .\n:Test a :Class .')

    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        with patch('ingest.Path') as mock_path_class:
            mock_ontology = MagicMock()
            mock_ontology.exists.return_value = True

            def mock_path_side_effect(path_str):
                if 'ontology.ttl' in str(path_str):
                    return mock_ontology
                return Path(path_str)

            mock_path_class.side_effect = mock_path_side_effect

            from ingest import run_sync

            user_msg = 'How do I cache?'
            assistant_msg = 'Use functools.lru_cache'

            result = await run_sync(
                workspace_path=str(temp_workspace),
                user_message=user_msg,
                assistant_message=assistant_msg
            )

            assert result['success'] is True
            assert 'ingested_chars' in result
            assert isinstance(result['ingested_chars'], int)
            assert result['ingested_chars'] > 0
            assert 'timestamp' in result
            assert 'ingestion_duration_sec' in result
            assert isinstance(result['ingestion_duration_sec'], float)
            assert result['ingestion_duration_sec'] >= 0
            assert 'ingestion_metrics' in result
            assert isinstance(result['ingestion_metrics'], dict)


@pytest.mark.asyncio
async def test_ingest_success_includes_step_metrics(temp_workspace, mock_env, mock_cognee_module, mock_rdflib_graph):
    """Test that ingestion success payload includes detailed step metrics."""
    ontology_path = temp_workspace.parent / 'ontology.ttl'
    ontology_path.write_text('@prefix : <http://example.org/> .\n:Test a :Class .')

    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
        with patch('ingest.Path') as mock_path_class:
            mock_ontology = MagicMock()
            mock_ontology.exists.return_value = True

            def mock_path_side_effect(path_str):
                if 'ontology.ttl' in str(path_str):
                    return mock_ontology
                return Path(path_str)

            mock_path_class.side_effect = mock_path_side_effect

            from ingest import run_sync

            user_msg = 'How do I cache?'
            assistant_msg = 'Use functools.lru_cache'

            result = await run_sync(
                workspace_path=str(temp_workspace),
                user_message=user_msg,
                assistant_message=assistant_msg
            )

            assert result['success'] is True
            assert 'ingestion_metrics' in result

            metrics = result['ingestion_metrics']
            expected_keys = {
                'setup_env_sec',
                'init_cognee_sec',
                'create_text_sec',
                'add_sec',
                'cognify_sec',
                'total_sync_sec'
            }

            missing_keys = expected_keys - metrics.keys()
            assert not missing_keys, f"Missing metric keys: {missing_keys}"

            assert isinstance(metrics['total_sync_sec'], float)
            assert metrics['total_sync_sec'] >= 0
            assert pytest.approx(metrics['total_sync_sec'], rel=0.1) == pytest.approx(result['ingestion_duration_sec'], rel=0.1)

            # Step timings should sum to a reasonable bound relative to total duration
            step_sum = sum(metrics[key] for key in expected_keys if key != 'total_sync_sec')
            assert step_sum >= 0
            assert step_sum <= metrics['total_sync_sec'] * 2


def test_main_missing_arguments(capsys):
    """Test main() exits with error when required arguments are missing."""
    with patch('sys.argv', ['ingest.py', '/tmp/workspace']):  # Missing user_message and assistant_message
        with patch('sys.exit') as mock_exit:
            from ingest import main

            try:
                main()
            except IndexError:
                # Expected: execution continues after sys.exit(1) is patched, causing IndexError
                pass

            # When sys.exit is patched, execution may continue triggering multiple exits
            # Assert that sys.exit(1) was called at least once
            mock_exit.assert_any_call(1)

            captured = capsys.readouterr()
            # Parse only the first line of JSON output (first error message)
            first_line = captured.out.strip().split('\n')[0]
            output = json.loads(first_line)

            assert output['success'] is False
            assert 'Missing required arguments' in output['error']


def test_main_invalid_importance_value(capsys):
    """Test main() exits with error when importance parameter is invalid."""
    with patch('sys.argv', ['ingest.py', '/tmp/workspace', 'user msg', 'assistant msg', 'invalid']):
        with patch('sys.exit') as mock_exit:
            with patch('ingest.canonicalize_workspace_path', return_value='/tmp/workspace'):
                from ingest import main

                try:
                    main()
                except (ValueError, IndexError):
                    # Expected: execution continues after sys.exit(1) is patched
                    pass

                # When sys.exit is patched, execution may continue triggering multiple exits
                # Assert that sys.exit(1) was called at least once
                mock_exit.assert_any_call(1)

                captured = capsys.readouterr()
                # Parse only the first line of JSON output (first error message)
                first_line = captured.out.strip().split('\n')[0]
                output = json.loads(first_line)

                assert output['success'] is False
                assert 'Invalid importance value' in output['error']
