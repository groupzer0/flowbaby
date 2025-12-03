"""
Unit tests for Kuzu DLL load error handling in init.py.
"""
import sys
import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

@pytest.mark.asyncio
async def test_initialize_kuzu_dll_load_failed(temp_workspace, mock_env):
    """
    Test that ImportError with 'DLL load failed' and '_kuzu' returns a specific error message.
    """
    # Mock logger setup to avoid file locking issues on Windows
    with patch('bridge_logger.setup_logging') as mock_setup_logging:
        mock_logger = MagicMock()
        mock_setup_logging.return_value = mock_logger

        # Ensure kuzu is not in sys.modules so the import is attempted
        if 'kuzu' in sys.modules:
            del sys.modules['kuzu']

        original_import = __import__

        def side_effect(name, *args, **kwargs):
            if name == 'kuzu':
                raise ImportError("DLL load failed while importing _kuzu")
            return original_import(name, *args, **kwargs)

        with patch('builtins.__import__', side_effect=side_effect):
            from init import initialize_cognee
            
            # The function catches the exception and returns a dict
            result = await initialize_cognee(str(temp_workspace))
            
            assert result['success'] is False
            assert "Flowbaby requires the Microsoft Visual C++ Redistributable on Windows" in result['error']
            assert "https://aka.ms/vs/17/release/vc_redist.x64.exe" in result['error']

@pytest.mark.asyncio
async def test_initialize_other_import_error(temp_workspace, mock_env):
    """
    Test that other ImportErrors are returned as is.
    """
    # Mock logger setup to avoid file locking issues on Windows
    with patch('bridge_logger.setup_logging') as mock_setup_logging:
        mock_logger = MagicMock()
        mock_setup_logging.return_value = mock_logger

        if 'kuzu' in sys.modules:
            del sys.modules['kuzu']

        original_import = __import__

        def side_effect(name, *args, **kwargs):
            if name == 'kuzu':
                raise ImportError("Some other import error")
            return original_import(name, *args, **kwargs)

        with patch('builtins.__import__', side_effect=side_effect):
            from init import initialize_cognee
            
            result = await initialize_cognee(str(temp_workspace))
            
            assert result['success'] is False
            # Should NOT contain the VC++ message
            assert "Flowbaby requires the Microsoft Visual C++ Redistributable" not in result['error']
            # The error message format might be "Failed to import required module: ..." or similar
            # init.py catches generic Exception and returns it
            assert "Some other import error" in result['error']
