"""
Shared utility functions for workspace path canonicalization and dataset name generation.

This module ensures consistent dataset ID generation across all bridge scripts
(init.py, ingest.py, retrieve.py) by providing a single source of truth for
path normalization and hashing logic.
"""

import hashlib
from pathlib import Path
from typing import Tuple


def canonicalize_workspace_path(workspace_path: str) -> Path:
    """
    Convert workspace path to canonical absolute path with symlink resolution.
    
    This function ensures that:
    - Relative paths are converted to absolute paths
    - Symlinks are resolved to their real canonical paths
    - The same logical workspace always produces the same path representation
    
    Args:
        workspace_path: Path to workspace (can be relative, absolute, or symlinked)
        
    Returns:
        Canonical absolute Path object with all symlinks resolved
        
    Raises:
        FileNotFoundError: If workspace path does not exist
        PermissionError: If path cannot be accessed due to permissions
        OSError: If path resolution fails (broken symlink, etc.)
    """
    workspace_dir = Path(workspace_path)
    
    # Validate path exists before attempting resolution
    if not workspace_dir.exists():
        raise FileNotFoundError(f"Workspace path does not exist: {workspace_path}")
    
    # Resolve to canonical absolute path (resolves symlinks, makes absolute)
    # This ensures symlinked paths and their real paths produce identical results
    try:
        canonical_path = workspace_dir.resolve(strict=True)
    except (OSError, RuntimeError) as e:
        raise OSError(f"Failed to resolve workspace path '{workspace_path}': {e}")
    
    return canonical_path


def generate_dataset_name(workspace_path: str) -> Tuple[str, str]:
    """
    Generate a deterministic, unique dataset name for a workspace.
    
    Uses SHA1 hash of the canonical workspace path to ensure:
    - Same workspace always generates same dataset name
    - Symlinked paths produce same dataset name as real paths
    - Different workspaces always produce different dataset names
    
    Args:
        workspace_path: Path to workspace (will be canonicalized)
        
    Returns:
        Tuple of (dataset_name, canonical_path_str)
        - dataset_name: Unique identifier like "ws_a3f5e7d912c4b8f0"
        - canonical_path_str: String representation of canonical path used for hashing
        
    Raises:
        FileNotFoundError: If workspace path does not exist
        PermissionError: If path cannot be accessed
        OSError: If path resolution fails
    """
    # Canonicalize path (resolve symlinks, make absolute)
    canonical_path = canonicalize_workspace_path(workspace_path)
    
    # Convert to string for hashing
    # Note: Path objects preserve exact case on case-sensitive filesystems (POSIX)
    canonical_path_str = str(canonical_path)
    
    # Generate deterministic hash
    dataset_hash = hashlib.sha1(canonical_path_str.encode()).hexdigest()[:16]
    dataset_name = f"ws_{dataset_hash}"
    
    return dataset_name, canonical_path_str
