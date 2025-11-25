"""
Unit tests for workspace_utils.py path canonicalization.
"""
import os
import sys
from pathlib import Path
import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from workspace_utils import canonicalize_workspace_path

def test_canonicalize_absolute_path(tmp_path):
    """Test that an absolute path is returned unchanged (if already canonical)."""
    path = canonicalize_workspace_path(str(tmp_path))
    assert path == tmp_path
    assert path.is_absolute()

def test_canonicalize_relative_path(tmp_path):
    """Test that a relative path is resolved to an absolute path."""
    # Change working directory to tmp_path
    cwd = os.getcwd()
    os.chdir(tmp_path)
    try:
        # Create a subdirectory
        subdir = tmp_path / "subdir"
        subdir.mkdir()
        
        # Test with relative path "."
        path_dot = canonicalize_workspace_path(".")
        assert path_dot == tmp_path
        assert path_dot.is_absolute()
        
        # Test with relative path "subdir"
        path_subdir = canonicalize_workspace_path("subdir")
        assert path_subdir == subdir
        assert path_subdir.is_absolute()
    finally:
        os.chdir(cwd)

def test_canonicalize_symlink(tmp_path):
    """Test that symlinks are resolved to their real paths."""
    real_dir = tmp_path / "real_dir"
    real_dir.mkdir()
    
    link_dir = tmp_path / "link_dir"
    try:
        os.symlink(real_dir, link_dir)
        
        # Test resolving the symlink
        resolved_path = canonicalize_workspace_path(str(link_dir))
        
        # Should resolve to the real directory
        assert resolved_path == real_dir.resolve()
        assert resolved_path != link_dir # It should be the target, not the link
    except OSError:
        # Symlinks might not be supported on all platforms/permissions
        pytest.skip("Symlinks not supported or permission denied")

def test_canonicalize_nonexistent_path():
    """Test that FileNotFoundError is raised for nonexistent paths."""
    with pytest.raises(FileNotFoundError):
        canonicalize_workspace_path("/path/that/does/not/exist/at/all")
