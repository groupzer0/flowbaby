#!/usr/bin/env python3
"""
Flowbaby Workspace Rebuild Tool - Plan 074 Milestone 5, Updated for Plan 076

Usage:
  python rebuild_workspace.py --mode reindex-only <workspace_path>
  python rebuild_workspace.py --mode reset-and-rebuild --force <workspace_path>
  python rebuild_workspace.py --mode reset-and-rebuild --force --dry-run <workspace_path>
  python rebuild_workspace.py --mode reset-and-rebuild --force --resume <workspace_path>

This is an ADVANCED tool for developers and testers only. It is NOT executed
automatically during upgrade and is NOT exposed as a user-facing VS Code command.

Modes:
  reindex-only       Re-run cognee.add() + cognee.cognify() on existing workspace data.
                     Non-destructive: preserves existing graph/vector stores.
                     Source: .flowbaby/data/**/*.txt (Plan 076)

  reset-and-rebuild  Reset graph/vector/cache stores, then rebuild from persisted inputs.
                     DESTRUCTIVE: Clears existing embeddings and graph relationships.
                     Requires --force flag for explicit confirmation.
                     Source: .flowbaby/data/**/*.txt (Plan 076)

Safety Features (Plan 076):
  - File-based rebuild from .flowbaby/data/**/*.txt (excludes .cognee_fs_cache/**)
  - Fail-closed on enumeration/IO/encoding errors for destructive operations
  - Batched ingestion with progress logging
  - Checkpoint-based resumability with input-set fingerprinting
  - Configurable file size limits (default 10MB)
  - Acquires maintenance lock to prevent concurrent operations
  - Requires --force for destructive operations
  - Logs all actions to .flowbaby/maintenance/rebuild.log
  - Coordinates with daemon mode (no concurrent writes)

Exit Codes:
  0 - Success
  1 - Error (invalid arguments, missing workspace, operation failed)
  2 - Lock acquisition failed (another operation in progress)
  3 - User cancelled (no --force for destructive operation)
  4 - Concurrent writers detected (daemon active)
  5 - Checkpoint mismatch (inputs changed, use --restart)

@see agent-output/planning/074-activate-ontology-mapping.md (Milestone 5)
@see agent-output/planning/076-rebuild-tool-batch-processing-and-resilience.md
"""

import argparse
import asyncio
import hashlib
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

# Add bridge directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# CRITICAL: Import bridge_env BEFORE any cognee import (Plan 074)
from bridge_env import OntologyConfigError, apply_workspace_env, get_env_config_snapshot

# =============================================================================
# Plan 076: Constants and Configuration
# =============================================================================

# Default max file size: 10MB (Plan 076)
DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

# Default batch size (files per batch)
DEFAULT_BATCH_SIZE = 50

# Default delay between batches (seconds)
DEFAULT_BATCH_DELAY_SECONDS = 0.5

# Checkpoint file name
CHECKPOINT_FILE = "rebuild_checkpoint.json"

# Directories to exclude from enumeration
EXCLUDED_DIRS = {".cognee_fs_cache"}


# =============================================================================
# Plan 076: Custom Exceptions
# =============================================================================

class EnumerationError(Exception):
    """Raised when file enumeration fails (permission, IO errors)."""
    pass


class DestructiveResetError(Exception):
    """Raised when destructive reset preconditions are not met."""
    pass


class CheckpointMismatchError(Exception):
    """Raised when resume checkpoint fingerprint doesn't match current inputs."""
    pass


class ConcurrentWriterError(Exception):
    """Raised when concurrent writers (daemon) are detected."""
    pass


# =============================================================================
# Plan 076: Data Classes
# =============================================================================

@dataclass
class RebuildInputFile:
    """Represents a single file to be ingested during rebuild."""
    path: Path  # Absolute path
    relative_path: Path  # Relative to .flowbaby/data/
    size_bytes: int
    mtime: float = 0.0


@dataclass
class SkippedFile:
    """Represents a file that was skipped during enumeration."""
    path: Path
    relative_path: Path
    reason: str


@dataclass
class EnumerationResult:
    """Result of enumerating rebuild inputs."""
    files: List[RebuildInputFile] = field(default_factory=list)
    skipped: List[SkippedFile] = field(default_factory=list)
    total_bytes: int = 0
    error: Optional[str] = None


@dataclass
class PreflightSummary:
    """Summary for dry-run/preflight check."""
    file_count: int
    total_bytes: int
    sample_paths: List[str]
    skipped_count: int
    skip_reasons: List[str]
    mode: str
    is_destructive: bool


@dataclass
class RebuildConfig:
    """Configuration for rebuild operation."""
    batch_size: int = DEFAULT_BATCH_SIZE
    batch_delay_seconds: float = DEFAULT_BATCH_DELAY_SECONDS
    max_file_size_bytes: int = DEFAULT_MAX_FILE_SIZE_BYTES
    max_files: Optional[int] = None
    allow_oversized: bool = False
    allow_empty: bool = False
    cognify_per_batch: bool = False


@dataclass
class RebuildResult:
    """Result of rebuild operation."""
    success: bool = False
    files_discovered: int = 0
    files_processed: int = 0
    files_skipped: int = 0
    skip_reasons: Dict[str, int] = field(default_factory=dict)
    total_runtime_seconds: float = 0.0
    retry_events: int = 0
    error: Optional[str] = None


@dataclass
class ResumeState:
    """State loaded from checkpoint for resume."""
    last_completed_batch: int
    mode: str
    fingerprint: str


# =============================================================================
# Plan 076: File Enumeration Functions
# =============================================================================

def enumerate_rebuild_inputs(
    workspace_path: Path,
    max_file_size_bytes: int = DEFAULT_MAX_FILE_SIZE_BYTES,
    allow_oversized: bool = False,
    validate_encoding: bool = False,
    fail_on_encoding_error: bool = False,
) -> EnumerationResult:
    """
    Enumerate all eligible .txt files under .flowbaby/data/ for rebuild.

    Plan 076 Requirements:
    - Only enumerate .txt files
    - Exclude .cognee_fs_cache/** directory
    - Return files in deterministic order (lexicographic by relative path)
    - Use relative paths to prevent workspace path leakage

    Args:
        workspace_path: Absolute path to workspace root
        max_file_size_bytes: Skip files larger than this (default 10MB)
        allow_oversized: If True, include oversized files
        validate_encoding: If True, validate UTF-8 encoding
        fail_on_encoding_error: If True, raise EnumerationError on encoding errors

    Returns:
        EnumerationResult with files and skipped lists

    Raises:
        EnumerationError: On permission errors or if fail_on_encoding_error=True and encoding fails
    """
    workspace_path = Path(workspace_path)
    data_dir = workspace_path / ".flowbaby" / "data"

    result = EnumerationResult()

    if not data_dir.exists():
        return result

    # Explicit permission check before os.walk (os.walk silently skips unreadable dirs)
    try:
        list(data_dir.iterdir())
    except PermissionError as e:
        raise EnumerationError(f"Permission error accessing data directory: {e}") from e

    try:
        # Collect all .txt files, excluding .cognee_fs_cache
        txt_files: List[Tuple[Path, Path]] = []  # (absolute_path, relative_path)

        for root, dirs, files in os.walk(data_dir):
            root_path = Path(root)

            # Exclude directories in EXCLUDED_DIRS
            dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]

            for filename in files:
                if filename.endswith(".txt"):
                    abs_path = root_path / filename
                    rel_path = abs_path.relative_to(data_dir)
                    txt_files.append((abs_path, rel_path))

        # Sort by relative path for deterministic order
        txt_files.sort(key=lambda x: str(x[1]))

        for abs_path, rel_path in txt_files:
            try:
                stat = abs_path.stat()
                size_bytes = stat.st_size
                mtime = stat.st_mtime

                # Check file size
                if not allow_oversized and size_bytes > max_file_size_bytes:
                    result.skipped.append(SkippedFile(
                        path=abs_path,
                        relative_path=rel_path,
                        reason=f"Oversized: {size_bytes} bytes > {max_file_size_bytes} limit"
                    ))
                    continue

                # Optionally validate encoding
                if validate_encoding:
                    try:
                        abs_path.read_text(encoding="utf-8")
                    except UnicodeDecodeError as e:
                        if fail_on_encoding_error:
                            raise EnumerationError(
                                f"Encoding error in {rel_path}: {e}"
                            ) from e
                        result.skipped.append(SkippedFile(
                            path=abs_path,
                            relative_path=rel_path,
                            reason=f"Encoding error: {e}"
                        ))
                        continue

                result.files.append(RebuildInputFile(
                    path=abs_path,
                    relative_path=rel_path,
                    size_bytes=size_bytes,
                    mtime=mtime
                ))
                result.total_bytes += size_bytes

            except PermissionError as e:
                raise EnumerationError(f"Permission error reading {rel_path}: {e}") from e
            except OSError as e:
                raise EnumerationError(f"IO error reading {rel_path}: {e}") from e

    except PermissionError as e:
        raise EnumerationError(f"Permission error accessing data directory: {e}") from e
    except OSError as e:
        raise EnumerationError(f"IO error accessing data directory: {e}") from e

    return result


def validate_destructive_preconditions(
    workspace_path: Path,
    allow_empty: bool = False,
) -> EnumerationResult:
    """
    Validate that destructive reset preconditions are met.

    Plan 076 Fail-Closed Semantics:
    - Abort if no eligible files found (unless allow_empty=True)
    - Abort on enumeration errors

    Args:
        workspace_path: Absolute path to workspace root
        allow_empty: If True, allow proceeding with zero files

    Returns:
        EnumerationResult if preconditions met

    Raises:
        DestructiveResetError: If preconditions not met
    """
    try:
        result = enumerate_rebuild_inputs(
            workspace_path,
            validate_encoding=True,
            fail_on_encoding_error=True
        )
    except EnumerationError as e:
        raise DestructiveResetError(f"Enumeration failed: {e}") from e

    if not allow_empty and len(result.files) == 0:
        raise DestructiveResetError(
            "No eligible .txt files found in .flowbaby/data/. "
            "Use --allow-empty to proceed with empty rebuild."
        )

    # Add file_count attribute for convenience
    result.file_count = len(result.files)

    return result


def get_preflight_summary(
    workspace_path: Path,
    mode: str = "reindex-only",
    max_file_size_bytes: int = DEFAULT_MAX_FILE_SIZE_BYTES,
) -> PreflightSummary:
    """
    Generate a preflight summary for dry-run display.

    Args:
        workspace_path: Absolute path to workspace root
        mode: Operation mode (reindex-only or reset-and-rebuild)
        max_file_size_bytes: File size limit

    Returns:
        PreflightSummary with counts, sizes, and sample paths
    """
    result = enumerate_rebuild_inputs(
        workspace_path,
        max_file_size_bytes=max_file_size_bytes,
        validate_encoding=True,
        fail_on_encoding_error=False
    )

    # Get sample paths (first 5)
    sample_paths = [str(f.relative_path) for f in result.files[:5]]

    # Collect skip reasons
    skip_reasons = [s.reason for s in result.skipped]

    return PreflightSummary(
        file_count=len(result.files),
        total_bytes=result.total_bytes,
        sample_paths=sample_paths,
        skipped_count=len(result.skipped),
        skip_reasons=skip_reasons,
        mode=mode,
        is_destructive=(mode == "reset-and-rebuild")
    )


# =============================================================================
# Plan 076: Batching Functions
# =============================================================================

def create_batches(
    files: List[RebuildInputFile],
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> Iterator[List[RebuildInputFile]]:
    """
    Create batches of files for processing.

    Args:
        files: List of files to batch
        batch_size: Number of files per batch

    Yields:
        Lists of RebuildInputFile, each up to batch_size
    """
    for i in range(0, len(files), batch_size):
        yield files[i:i + batch_size]


# =============================================================================
# Plan 076: Checkpointing Functions
# =============================================================================

def compute_input_fingerprint(files: List[RebuildInputFile]) -> str:
    """
    Compute a SHA-256 fingerprint of the input file set.

    The fingerprint is based on:
    - Relative path (string)
    - File size (bytes)
    - Modification time

    This allows detecting if inputs changed between runs.

    Args:
        files: List of input files (must be in deterministic order)

    Returns:
        64-character hex string (SHA-256)
    """
    hasher = hashlib.sha256()

    for f in files:
        # Include relative path, size, and mtime in fingerprint
        entry = f"{f.relative_path}|{f.size_bytes}|{f.mtime}"
        hasher.update(entry.encode("utf-8"))

    return hasher.hexdigest()


def save_checkpoint(
    workspace_path: Path,
    mode: str,
    file_list: List[Tuple[str, int, float]],  # (relative_path, size, mtime)
    batch_size: int,
    last_completed_batch: int,
    fingerprint: str,
) -> None:
    """
    Save checkpoint to JSON file.

    Args:
        workspace_path: Workspace root path
        mode: Operation mode
        file_list: List of (relative_path, size, mtime) tuples
        batch_size: Batch size used
        last_completed_batch: Index of last successfully completed batch
        fingerprint: Input set fingerprint
    """
    checkpoint_path = workspace_path / ".flowbaby" / "maintenance" / CHECKPOINT_FILE
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)

    checkpoint = {
        "mode": mode,
        "file_list": file_list,
        "batch_size": batch_size,
        "last_completed_batch": last_completed_batch,
        "fingerprint": fingerprint,
        "saved_at": datetime.now().isoformat(),
    }

    checkpoint_path.write_text(json.dumps(checkpoint, indent=2))


def load_checkpoint(workspace_path: Path) -> Optional[dict]:
    """
    Load checkpoint from JSON file if it exists.

    Args:
        workspace_path: Workspace root path

    Returns:
        Checkpoint dict or None if not found
    """
    checkpoint_path = workspace_path / ".flowbaby" / "maintenance" / CHECKPOINT_FILE

    if not checkpoint_path.exists():
        return None

    return json.loads(checkpoint_path.read_text())


def validate_resume(
    checkpoint: dict,
    current_fingerprint: str,
) -> ResumeState:
    """
    Validate that resume can proceed with current inputs.

    Args:
        checkpoint: Loaded checkpoint dict
        current_fingerprint: Fingerprint of current input set

    Returns:
        ResumeState if valid

    Raises:
        CheckpointMismatchError: If fingerprints don't match
    """
    if checkpoint["fingerprint"] != current_fingerprint:
        raise CheckpointMismatchError(
            f"Input set has changed since checkpoint was saved. "
            f"Expected fingerprint: {checkpoint['fingerprint']}, "
            f"Current: {current_fingerprint}. "
            f"Use --restart to start fresh."
        )

    return ResumeState(
        last_completed_batch=checkpoint["last_completed_batch"],
        mode=checkpoint["mode"],
        fingerprint=checkpoint["fingerprint"]
    )


def clear_checkpoint(workspace_path: Path) -> None:
    """Remove checkpoint file if it exists."""
    checkpoint_path = workspace_path / ".flowbaby" / "maintenance" / CHECKPOINT_FILE
    if checkpoint_path.exists():
        checkpoint_path.unlink()


# =============================================================================
# Plan 076: Concurrent Writer Detection
# =============================================================================

def check_concurrent_writers(workspace_path: Path) -> None:
    """
    Check for concurrent writers (daemon mode) and refuse if detected.

    Args:
        workspace_path: Workspace root path

    Raises:
        ConcurrentWriterError: If daemon or other writer is active
    """
    # Check for daemon PID file
    daemon_pid_file = workspace_path / ".flowbaby" / "daemon" / "daemon.pid"

    if daemon_pid_file.exists():
        try:
            pid = int(daemon_pid_file.read_text().strip())
            # Check if process is actually running
            os.kill(pid, 0)  # Raises OSError if not running
            raise ConcurrentWriterError(
                f"Daemon process (PID {pid}) is active. "
                f"Stop the daemon before running rebuild: "
                f"kill {pid} or use VS Code command 'Flowbaby: Stop Daemon'"
            )
        except (ValueError, OSError):
            # PID file exists but process not running - stale file, OK to proceed
            pass

    # Check for background operation markers
    bg_ops_dir = workspace_path / ".flowbaby" / "background_ops"
    if bg_ops_dir.exists():
        for marker in bg_ops_dir.glob("*.running"):
            # Check if the marker is recent (within last 5 minutes)
            try:
                mtime = marker.stat().st_mtime
                if time.time() - mtime < 300:  # 5 minutes
                    raise ConcurrentWriterError(
                        f"Background operation in progress: {marker.name}. "
                        f"Wait for it to complete or remove the marker file."
                    )
            except OSError:
                pass


# Constants
MAINTENANCE_LOCK_FILE = '.flowbaby/maintenance.lock'
REBUILD_LOG_FILE = '.flowbaby/maintenance/rebuild.log'
BACKGROUND_OPS_DIR = '.flowbaby/background_ops'


def log_rebuild(workspace_dir: Path, message: str, level: str = "INFO"):
    """Append message to rebuild log and print to stderr."""
    log_path = workspace_dir / REBUILD_LOG_FILE
    log_path.parent.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().isoformat()
    log_line = f"[{timestamp}] [{level}] {message}"

    with open(log_path, 'a') as f:
        f.write(log_line + "\n")

    print(f"[REBUILD] {log_line}", file=sys.stderr)


def acquire_lock(workspace_dir: Path) -> bool:
    """
    Create maintenance lock file to pause background operations.

    Uses atomic file creation to ensure only one process can acquire the lock.

    Returns:
        True if lock acquired, False if lock already held
    """
    lock_path = workspace_dir / MAINTENANCE_LOCK_FILE
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        # O_CREAT | O_EXCL ensures atomicity - only one process can create
        fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        lock_info = {
            'acquired_at': datetime.now().isoformat(),
            'pid': os.getpid(),
            'operation': 'rebuild_workspace',
        }
        os.write(fd, json.dumps(lock_info, indent=2).encode())
        os.close(fd)
        return True
    except FileExistsError:
        return False
    except (OSError, PermissionError) as e:
        log_rebuild(workspace_dir, f"Failed to create lock file: {e}", "ERROR")
        return False


def release_lock(workspace_dir: Path):
    """Remove maintenance lock file."""
    lock_path = workspace_dir / MAINTENANCE_LOCK_FILE
    try:
        if lock_path.exists():
            lock_path.unlink()
    except Exception as e:
        log_rebuild(workspace_dir, f"Warning: Failed to release lock: {e}", "WARN")


def get_workspace_summary(workspace_dir: Path) -> dict:
    """
    Get a summary of the workspace's current state for logging.

    Returns dict with counts of various data artifacts.
    """
    summary = {
        'data_files': 0,
        'system_db_exists': False,
        'lancedb_tables': 0,
        'cache_size_bytes': 0,
    }

    data_dir = workspace_dir / '.flowbaby' / 'data'
    system_dir = workspace_dir / '.flowbaby' / 'system'
    cache_dir = workspace_dir / '.flowbaby' / 'cache'

    # Count data files
    if data_dir.exists():
        summary['data_files'] = sum(1 for _ in data_dir.rglob('*') if _.is_file())

    # Check system database
    cognee_db = system_dir / 'databases' / 'cognee_db'
    summary['system_db_exists'] = cognee_db.exists()

    # Count LanceDB tables
    lancedb_dir = system_dir / 'databases' / 'lancedb'
    if lancedb_dir.exists():
        summary['lancedb_tables'] = sum(1 for d in lancedb_dir.iterdir() if d.is_dir())

    # Cache size
    if cache_dir.exists():
        summary['cache_size_bytes'] = sum(f.stat().st_size for f in cache_dir.rglob('*') if f.is_file())

    return summary


async def do_reindex_only(workspace_path: str, dataset_name: str) -> dict:
    """
    Reindex-only mode: Re-run add+cognify on existing data.

    This mode does NOT reset stores. Due to Cognee's pipeline caching,
    already-processed data may be skipped. For guaranteed fresh processing,
    use reset-and-rebuild mode.

    Returns:
        dict with operation results
    """
    workspace_dir = Path(workspace_path)
    log_rebuild(workspace_dir, "Starting reindex-only operation")

    # Import cognee after env wiring
    import cognee

    # Configure cognee
    env_config = get_env_config_snapshot()
    cognee.config.system_root_directory(env_config['SYSTEM_ROOT_DIRECTORY'])
    cognee.config.data_root_directory(env_config['DATA_ROOT_DIRECTORY'])
    # Plan 083 M5: Cloud-only - Cognee uses AWS Bedrock via AWS_* env vars

    log_rebuild(workspace_dir, f"Dataset: {dataset_name}")
    log_rebuild(workspace_dir, f"Ontology: {env_config['ONTOLOGY_FILE_PATH']}")

    # Search for existing summaries to re-add
    # We use the same pattern as migrate_summaries.py
    from cognee.modules.search.types import SearchType

    log_rebuild(workspace_dir, "Searching for existing summaries to reindex...")

    try:
        search_results = await cognee.search(
            query_type=SearchType.GRAPH_COMPLETION,
            query_text="Conversation Summary",
            datasets=[dataset_name],
            top_k=500  # Higher limit for reindex
        )

        summaries_found = []
        for result in search_results:
            text = str(getattr(result, 'text', result))
            if "# Conversation Summary:" in text:
                summaries_found.append(text)

        log_rebuild(workspace_dir, f"Found {len(summaries_found)} summaries")

        if summaries_found:
            log_rebuild(workspace_dir, "Re-adding summaries...")
            await cognee.add(
                data=summaries_found,
                dataset_name=dataset_name
            )

            log_rebuild(workspace_dir, "Running cognify...")
            await cognee.cognify(datasets=[dataset_name])

            log_rebuild(workspace_dir, f"Reindex complete: processed {len(summaries_found)} summaries")
        else:
            log_rebuild(workspace_dir, "No summaries found to reindex")

        return {
            'success': True,
            'mode': 'reindex-only',
            'summaries_processed': len(summaries_found),
        }

    except Exception as e:
        log_rebuild(workspace_dir, f"Reindex failed: {e}", "ERROR")
        return {
            'success': False,
            'mode': 'reindex-only',
            'error': str(e),
        }


async def do_reset_and_rebuild(workspace_path: str, dataset_name: str) -> dict:
    """
    Reset-and-rebuild mode: Clear stores, then rebuild from scratch.

    This mode:
    1. Calls cognee.prune.prune_system() to clear graph/vector/cache
    2. Searches for existing summaries (from backed-up search before prune)
    3. Re-adds and re-cognifies everything

    Returns:
        dict with operation results
    """
    workspace_dir = Path(workspace_path)
    log_rebuild(workspace_dir, "Starting reset-and-rebuild operation")
    log_rebuild(workspace_dir, "WARNING: This will delete existing embeddings and graph relationships")

    # Import cognee after env wiring
    import cognee
    from cognee.modules.search.types import SearchType

    # Configure cognee
    env_config = get_env_config_snapshot()
    cognee.config.system_root_directory(env_config['SYSTEM_ROOT_DIRECTORY'])
    cognee.config.data_root_directory(env_config['DATA_ROOT_DIRECTORY'])
    # Plan 083 M5: Cloud-only - Cognee uses AWS Bedrock via AWS_* env vars

    log_rebuild(workspace_dir, f"Dataset: {dataset_name}")
    log_rebuild(workspace_dir, f"Ontology: {env_config['ONTOLOGY_FILE_PATH']}")

    # STEP 1: Extract existing summaries BEFORE pruning
    log_rebuild(workspace_dir, "Step 1: Extracting existing summaries before reset...")

    summaries_to_rebuild = []
    try:
        search_results = await cognee.search(
            query_type=SearchType.GRAPH_COMPLETION,
            query_text="Conversation Summary",
            datasets=[dataset_name],
            top_k=500
        )

        for result in search_results:
            text = str(getattr(result, 'text', result))
            if "# Conversation Summary:" in text:
                summaries_to_rebuild.append(text)

        log_rebuild(workspace_dir, f"Extracted {len(summaries_to_rebuild)} summaries")
    except Exception as e:
        log_rebuild(workspace_dir, f"Warning: Could not extract existing summaries: {e}", "WARN")
        log_rebuild(workspace_dir, "Proceeding with reset (no data to rebuild)")

    # STEP 2: Reset all stores
    log_rebuild(workspace_dir, "Step 2: Resetting graph, vector, and cache stores...")

    summary_before = get_workspace_summary(workspace_dir)
    log_rebuild(workspace_dir, f"Before reset: {json.dumps(summary_before)}")

    try:
        await cognee.prune.prune_system(graph=True, vector=True, metadata=True, cache=True)
        log_rebuild(workspace_dir, "prune_system() completed")
    except Exception as e:
        log_rebuild(workspace_dir, f"prune_system() failed: {e}", "ERROR")
        return {
            'success': False,
            'mode': 'reset-and-rebuild',
            'error': f"Failed to reset stores: {e}",
        }

    summary_after_reset = get_workspace_summary(workspace_dir)
    log_rebuild(workspace_dir, f"After reset: {json.dumps(summary_after_reset)}")

    # STEP 3: Rebuild from extracted summaries
    if summaries_to_rebuild:
        log_rebuild(workspace_dir, f"Step 3: Rebuilding {len(summaries_to_rebuild)} summaries...")

        try:
            # Re-add all summaries
            await cognee.add(
                data=summaries_to_rebuild,
                dataset_name=dataset_name
            )
            log_rebuild(workspace_dir, "add() completed")

            # Run cognify
            await cognee.cognify(datasets=[dataset_name])
            log_rebuild(workspace_dir, "cognify() completed")

            summary_after_rebuild = get_workspace_summary(workspace_dir)
            log_rebuild(workspace_dir, f"After rebuild: {json.dumps(summary_after_rebuild)}")

        except Exception as e:
            log_rebuild(workspace_dir, f"Rebuild failed: {e}", "ERROR")
            return {
                'success': False,
                'mode': 'reset-and-rebuild',
                'error': f"Failed during rebuild: {e}",
                'summaries_extracted': len(summaries_to_rebuild),
                'note': 'Stores were reset but rebuild failed. Data loss may have occurred.',
            }
    else:
        log_rebuild(workspace_dir, "Step 3: No summaries to rebuild (workspace was empty)")

    log_rebuild(workspace_dir, "Reset-and-rebuild completed successfully")

    return {
        'success': True,
        'mode': 'reset-and-rebuild',
        'summaries_rebuilt': len(summaries_to_rebuild),
        'workspace_summary_before': summary_before,
        'workspace_summary_after': get_workspace_summary(workspace_dir),
    }


# =============================================================================
# Plan 076: Filesystem-based Rebuild Functions
# =============================================================================

async def do_reindex_only_v2(
    workspace_path: str,
    dataset_name: str,
    config: RebuildConfig,
    start_batch: int = 0,
) -> RebuildResult:
    """
    Plan 076: Reindex-only mode using filesystem source.

    Reads files from .flowbaby/data/**/*.txt and re-ingests them.
    Non-destructive: encoding errors skip the file and continue.

    Args:
        workspace_path: Absolute path to workspace
        dataset_name: Cognee dataset name
        config: Rebuild configuration
        start_batch: Batch index to start from (for resume)

    Returns:
        RebuildResult with operation details
    """
    workspace_dir = Path(workspace_path)
    start_time = time.time()
    result = RebuildResult()

    log_rebuild(workspace_dir, "Plan 076: Starting filesystem-based reindex-only operation")

    # Import cognee after env wiring
    import cognee

    # Configure cognee
    env_config = get_env_config_snapshot()
    cognee.config.system_root_directory(env_config['SYSTEM_ROOT_DIRECTORY'])
    cognee.config.data_root_directory(env_config['DATA_ROOT_DIRECTORY'])
    # Plan 083 M5: Cloud-only - Cognee uses AWS Bedrock via AWS_* env vars

    log_rebuild(workspace_dir, f"Dataset: {dataset_name}")
    log_rebuild(workspace_dir, f"Ontology: {env_config['ONTOLOGY_FILE_PATH']}")

    # Enumerate files (non-destructive: skip encoding errors)
    try:
        enum_result = enumerate_rebuild_inputs(
            workspace_dir,
            max_file_size_bytes=config.max_file_size_bytes,
            allow_oversized=config.allow_oversized,
            validate_encoding=True,
            fail_on_encoding_error=False  # Non-destructive: skip on error
        )
    except EnumerationError as e:
        log_rebuild(workspace_dir, f"Enumeration failed: {e}", "ERROR")
        result.error = str(e)
        return result

    result.files_discovered = len(enum_result.files) + len(enum_result.skipped)
    result.files_skipped = len(enum_result.skipped)

    # Track skip reasons
    for skipped in enum_result.skipped:
        reason_key = skipped.reason.split(":")[0].strip()
        result.skip_reasons[reason_key] = result.skip_reasons.get(reason_key, 0) + 1

    if not enum_result.files:
        log_rebuild(workspace_dir, "No eligible files found to reindex")
        result.success = True
        result.total_runtime_seconds = time.time() - start_time
        return result

    log_rebuild(workspace_dir, f"Found {len(enum_result.files)} eligible files ({enum_result.total_bytes} bytes)")

    # Apply max_files limit if set
    files_to_process = enum_result.files
    if config.max_files and len(files_to_process) > config.max_files:
        log_rebuild(workspace_dir, f"Limiting to {config.max_files} files (--max-files)")
        files_to_process = files_to_process[:config.max_files]

    # Compute fingerprint for checkpointing
    fingerprint = compute_input_fingerprint(files_to_process)
    log_rebuild(workspace_dir, f"Input fingerprint: {fingerprint[:16]}...")

    # Create batches
    batches = list(create_batches(files_to_process, config.batch_size))
    total_batches = len(batches)
    log_rebuild(workspace_dir, f"Processing in {total_batches} batches of {config.batch_size} files")

    # Process batches
    files_processed = 0
    for batch_idx, batch in enumerate(batches):
        if batch_idx < start_batch:
            log_rebuild(workspace_dir, f"Skipping batch {batch_idx + 1}/{total_batches} (already completed)")
            files_processed += len(batch)
            continue

        batch_start = time.time()
        log_rebuild(workspace_dir, f"Processing batch {batch_idx + 1}/{total_batches} ({len(batch)} files)")

        try:
            # Read file contents (relative paths only in logs, not in content)
            batch_contents = []
            for f in batch:
                try:
                    content = f.path.read_text(encoding="utf-8")
                    batch_contents.append(content)
                    files_processed += 1
                except Exception as e:
                    log_rebuild(workspace_dir, f"Error reading {f.relative_path}: {e}", "WARN")
                    result.files_skipped += 1

            if batch_contents:
                # Add to cognee
                await cognee.add(
                    data=batch_contents,
                    dataset_name=dataset_name
                )

            batch_elapsed = time.time() - batch_start
            log_rebuild(workspace_dir, f"Batch {batch_idx + 1} complete: {len(batch_contents)} files in {batch_elapsed:.2f}s")

            # Save checkpoint after successful batch
            save_checkpoint(
                workspace_dir,
                mode="reindex-only",
                file_list=[(str(f.relative_path), f.size_bytes, f.mtime) for f in files_to_process],
                batch_size=config.batch_size,
                last_completed_batch=batch_idx,
                fingerprint=fingerprint
            )

            # Rate limiting delay
            if config.batch_delay_seconds > 0 and batch_idx < total_batches - 1:
                await asyncio.sleep(config.batch_delay_seconds)

        except Exception as e:
            log_rebuild(workspace_dir, f"Batch {batch_idx + 1} failed: {e}", "ERROR")
            result.error = f"Batch {batch_idx + 1} failed: {e}"
            result.files_processed = files_processed
            result.total_runtime_seconds = time.time() - start_time
            return result

    # Run final cognify (unless per-batch cognify was enabled)
    if not config.cognify_per_batch:
        log_rebuild(workspace_dir, "Running final cognify()...")
        try:
            await cognee.cognify(datasets=[dataset_name])
            log_rebuild(workspace_dir, "cognify() completed")
        except Exception as e:
            log_rebuild(workspace_dir, f"cognify() failed: {e}", "ERROR")
            result.error = f"cognify() failed: {e}"
            result.files_processed = files_processed
            result.total_runtime_seconds = time.time() - start_time
            return result

    # Clear checkpoint on success
    clear_checkpoint(workspace_dir)

    result.success = True
    result.files_processed = files_processed
    result.total_runtime_seconds = time.time() - start_time

    log_rebuild(workspace_dir, f"Reindex complete: {files_processed} files in {result.total_runtime_seconds:.2f}s")

    return result


async def do_reset_and_rebuild_v2(
    workspace_path: str,
    dataset_name: str,
    config: RebuildConfig,
    start_batch: int = 0,
) -> RebuildResult:
    """
    Plan 076: Reset-and-rebuild mode using filesystem source.

    Validates inputs with fail-closed semantics, resets stores, then
    rebuilds from .flowbaby/data/**/*.txt files.

    Args:
        workspace_path: Absolute path to workspace
        dataset_name: Cognee dataset name
        config: Rebuild configuration
        start_batch: Batch index to start from (for resume, post-reset only)

    Returns:
        RebuildResult with operation details
    """
    workspace_dir = Path(workspace_path)
    start_time = time.time()
    result = RebuildResult()

    log_rebuild(workspace_dir, "Plan 076: Starting filesystem-based reset-and-rebuild operation")
    log_rebuild(workspace_dir, "WARNING: This will delete existing embeddings and graph relationships")

    # Import cognee after env wiring
    import cognee

    # Configure cognee
    env_config = get_env_config_snapshot()
    cognee.config.system_root_directory(env_config['SYSTEM_ROOT_DIRECTORY'])
    cognee.config.data_root_directory(env_config['DATA_ROOT_DIRECTORY'])
    # Plan 083 M5: Cloud-only - Cognee uses AWS Bedrock via AWS_* env vars

    log_rebuild(workspace_dir, f"Dataset: {dataset_name}")
    log_rebuild(workspace_dir, f"Ontology: {env_config['ONTOLOGY_FILE_PATH']}")

    # STEP 1: Validate inputs with fail-closed semantics
    log_rebuild(workspace_dir, "Step 1: Validating rebuild inputs (fail-closed)...")

    try:
        # For destructive: fail on encoding errors
        enum_result = enumerate_rebuild_inputs(
            workspace_dir,
            max_file_size_bytes=config.max_file_size_bytes,
            allow_oversized=config.allow_oversized,
            validate_encoding=True,
            fail_on_encoding_error=True  # Destructive: fail-closed
        )
    except EnumerationError as e:
        log_rebuild(workspace_dir, f"FAIL-CLOSED: Enumeration failed: {e}", "ERROR")
        result.error = f"Fail-closed: {e}"
        return result

    result.files_discovered = len(enum_result.files)

    if not enum_result.files and not config.allow_empty:
        log_rebuild(workspace_dir, "FAIL-CLOSED: No eligible files found", "ERROR")
        result.error = "No eligible .txt files found. Use --allow-empty to proceed with empty rebuild."
        return result

    log_rebuild(workspace_dir, f"Validated {len(enum_result.files)} eligible files ({enum_result.total_bytes} bytes)")

    # Apply max_files limit
    files_to_process = enum_result.files
    if config.max_files and len(files_to_process) > config.max_files:
        log_rebuild(workspace_dir, f"Limiting to {config.max_files} files (--max-files)")
        files_to_process = files_to_process[:config.max_files]

    # Compute fingerprint
    fingerprint = compute_input_fingerprint(files_to_process)
    log_rebuild(workspace_dir, f"Input fingerprint: {fingerprint[:16]}...")

    # STEP 2: Reset stores (only if not resuming from post-reset state)
    if start_batch == 0:
        log_rebuild(workspace_dir, "Step 2: Resetting graph, vector, and cache stores...")

        summary_before = get_workspace_summary(workspace_dir)
        log_rebuild(workspace_dir, f"Before reset: {json.dumps(summary_before)}")

        try:
            await cognee.prune.prune_system(graph=True, vector=True, metadata=True, cache=True)
            log_rebuild(workspace_dir, "prune_system() completed")
        except Exception as e:
            log_rebuild(workspace_dir, f"prune_system() failed: {e}", "ERROR")
            result.error = f"Failed to reset stores: {e}"
            return result

        summary_after_reset = get_workspace_summary(workspace_dir)
        log_rebuild(workspace_dir, f"After reset: {json.dumps(summary_after_reset)}")
    else:
        log_rebuild(workspace_dir, "Step 2: Skipped (resuming from checkpoint)")

    # STEP 3: Rebuild from filesystem
    log_rebuild(workspace_dir, f"Step 3: Rebuilding from {len(files_to_process)} files...")

    batches = list(create_batches(files_to_process, config.batch_size))
    total_batches = len(batches)
    log_rebuild(workspace_dir, f"Processing in {total_batches} batches of {config.batch_size} files")

    files_processed = 0
    for batch_idx, batch in enumerate(batches):
        if batch_idx < start_batch:
            log_rebuild(workspace_dir, f"Skipping batch {batch_idx + 1}/{total_batches} (already completed)")
            files_processed += len(batch)
            continue

        batch_start = time.time()
        log_rebuild(workspace_dir, f"Processing batch {batch_idx + 1}/{total_batches} ({len(batch)} files)")

        try:
            # Read file contents
            batch_contents = []
            for f in batch:
                content = f.path.read_text(encoding="utf-8")
                batch_contents.append(content)
                files_processed += 1

            if batch_contents:
                await cognee.add(
                    data=batch_contents,
                    dataset_name=dataset_name
                )

            batch_elapsed = time.time() - batch_start
            log_rebuild(workspace_dir, f"Batch {batch_idx + 1} complete: {len(batch_contents)} files in {batch_elapsed:.2f}s")

            # Save checkpoint
            save_checkpoint(
                workspace_dir,
                mode="reset-and-rebuild",
                file_list=[(str(f.relative_path), f.size_bytes, f.mtime) for f in files_to_process],
                batch_size=config.batch_size,
                last_completed_batch=batch_idx,
                fingerprint=fingerprint
            )

            # Rate limiting delay
            if config.batch_delay_seconds > 0 and batch_idx < total_batches - 1:
                await asyncio.sleep(config.batch_delay_seconds)

        except Exception as e:
            log_rebuild(workspace_dir, f"Batch {batch_idx + 1} failed: {e}", "ERROR")
            result.error = f"Batch {batch_idx + 1} failed: {e}. Stores were reset. Use --resume to continue."
            result.files_processed = files_processed
            result.total_runtime_seconds = time.time() - start_time
            return result

    # Run final cognify
    if not config.cognify_per_batch:
        log_rebuild(workspace_dir, "Running final cognify()...")
        try:
            await cognee.cognify(datasets=[dataset_name])
            log_rebuild(workspace_dir, "cognify() completed")
        except Exception as e:
            log_rebuild(workspace_dir, f"cognify() failed: {e}", "ERROR")
            result.error = f"cognify() failed: {e}"
            result.files_processed = files_processed
            result.total_runtime_seconds = time.time() - start_time
            return result

    # Clear checkpoint on success
    clear_checkpoint(workspace_dir)

    result.success = True
    result.files_processed = files_processed
    result.total_runtime_seconds = time.time() - start_time

    log_rebuild(workspace_dir, f"Reset-and-rebuild complete: {files_processed} files in {result.total_runtime_seconds:.2f}s")

    return result


async def main_async(args: argparse.Namespace) -> int:
    """Async main function with Plan 076 enhancements."""
    workspace_path = args.workspace_path
    workspace_dir = Path(workspace_path)

    # Validate workspace
    if not workspace_dir.is_dir():
        print(f"Error: Workspace path does not exist: {workspace_path}", file=sys.stderr)
        return 1

    if not workspace_dir.is_absolute():
        print(f"Error: Workspace path must be absolute: {workspace_path}", file=sys.stderr)
        return 1

    # Check for .flowbaby directory
    flowbaby_dir = workspace_dir / '.flowbaby'
    if not flowbaby_dir.exists():
        print("Error: No .flowbaby directory found in workspace. Nothing to rebuild.", file=sys.stderr)
        return 1

    # Plan 076: Check for concurrent writers (before API key check for fast failure)
    try:
        check_concurrent_writers(workspace_dir)
    except ConcurrentWriterError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 4

    # Handle --dry-run (Plan 076)
    if getattr(args, 'dry_run', False):
        summary = get_preflight_summary(
            workspace_dir,
            mode=args.mode,
            max_file_size_bytes=getattr(args, 'max_file_size', DEFAULT_MAX_FILE_SIZE_BYTES)
        )
        print("=" * 60)
        print("DRY RUN - Preflight Summary")
        print("=" * 60)
        print(f"Mode: {summary.mode}")
        print(f"Destructive: {summary.is_destructive}")
        print(f"Files to process: {summary.file_count}")
        print(f"Total size: {summary.total_bytes:,} bytes")
        print(f"Skipped files: {summary.skipped_count}")
        if summary.sample_paths:
            print("Sample files:")
            for path in summary.sample_paths[:5]:
                print(f"  - {path}")
        if summary.skip_reasons:
            print("Skip reasons:")
            for reason in summary.skip_reasons[:5]:
                print(f"  - {reason}")
        print("=" * 60)
        return 0

    # Plan 083 M5: v0.7.0 is Cloud-only - check for AWS credentials
    aws_access_key = os.getenv('AWS_ACCESS_KEY_ID')
    if not aws_access_key:
        print("Error: Cloud credentials not found.", file=sys.stderr)
        print("Please login to Flowbaby Cloud: use 'Flowbaby Cloud: Login with GitHub' command", file=sys.stderr)
        return 1

    # Validate mode-specific requirements
    if args.mode == 'reset-and-rebuild' and not args.force:
        print("=" * 60, file=sys.stderr)
        print("ERROR: reset-and-rebuild mode requires --force flag", file=sys.stderr)
        print("", file=sys.stderr)
        print("This operation will:", file=sys.stderr)
        print("  - DELETE all graph relationships", file=sys.stderr)
        print("  - DELETE all vector embeddings", file=sys.stderr)
        print("  - DELETE all cached data", file=sys.stderr)
        print("  - Rebuild from .flowbaby/data/**/*.txt files", file=sys.stderr)
        print("", file=sys.stderr)
        print("To proceed, add --force flag:", file=sys.stderr)
        print(f"  python rebuild_workspace.py --mode reset-and-rebuild --force {workspace_path}", file=sys.stderr)
        print("", file=sys.stderr)
        print("Use --dry-run first to see what would be processed.", file=sys.stderr)
        print("=" * 60, file=sys.stderr)
        return 3

    # Apply environment wiring BEFORE importing cognee
    log_rebuild(workspace_dir, f"Applying environment wiring for workspace: {workspace_path}")
    try:
        env_config = apply_workspace_env(workspace_path, fail_on_missing_ontology=True)
        log_rebuild(workspace_dir, f"Environment configured: {env_config.to_log_string()}")
    except OntologyConfigError as e:
        print(f"Error: Ontology configuration failed: {e}", file=sys.stderr)
        return 1

    # Generate dataset name
    from workspace_utils import generate_dataset_name
    dataset_name, _ = generate_dataset_name(workspace_path)

    # Build configuration (Plan 076)
    config = RebuildConfig(
        batch_size=getattr(args, 'batch_size', DEFAULT_BATCH_SIZE),
        batch_delay_seconds=getattr(args, 'batch_delay', DEFAULT_BATCH_DELAY_SECONDS),
        max_file_size_bytes=getattr(args, 'max_file_size', DEFAULT_MAX_FILE_SIZE_BYTES),
        max_files=getattr(args, 'max_files', None),
        allow_oversized=getattr(args, 'allow_oversized', False),
        allow_empty=getattr(args, 'allow_empty', False),
        cognify_per_batch=getattr(args, 'cognify_per_batch', False),
    )

    # Handle --resume and --restart (Plan 076)
    start_batch = 0
    resume_mode = getattr(args, 'resume', False)
    restart_mode = getattr(args, 'restart', False)

    if resume_mode:
        checkpoint = load_checkpoint(workspace_dir)
        if not checkpoint:
            print("Error: No checkpoint found. Cannot resume.", file=sys.stderr)
            return 1

        # Enumerate files and compute current fingerprint
        try:
            enum_result = enumerate_rebuild_inputs(
                workspace_dir,
                max_file_size_bytes=config.max_file_size_bytes,
                allow_oversized=config.allow_oversized,
            )
            current_fingerprint = compute_input_fingerprint(enum_result.files)
        except EnumerationError as e:
            print(f"Error: Cannot resume - enumeration failed: {e}", file=sys.stderr)
            return 1

        try:
            resume_state = validate_resume(checkpoint, current_fingerprint)
            start_batch = resume_state.last_completed_batch + 1
            log_rebuild(workspace_dir, f"Resuming from batch {start_batch}")
        except CheckpointMismatchError as e:
            print(f"Error: {e}", file=sys.stderr)
            return 5

    if restart_mode:
        log_rebuild(workspace_dir, "Clearing checkpoint for fresh start (--restart)")
        clear_checkpoint(workspace_dir)

    # Acquire maintenance lock
    log_rebuild(workspace_dir, "Acquiring maintenance lock...")
    if not acquire_lock(workspace_dir):
        print(f"Error: Could not acquire maintenance lock at {workspace_dir / MAINTENANCE_LOCK_FILE}", file=sys.stderr)
        print("Another maintenance operation may be in progress.", file=sys.stderr)
        print("If you're sure no other operation is running, delete the lock file manually.", file=sys.stderr)
        return 2

    log_rebuild(workspace_dir, "Maintenance lock acquired")

    try:
        # Execute the requested operation using Plan 076 filesystem-based functions
        if args.mode == 'reindex-only':
            result = await do_reindex_only_v2(workspace_path, dataset_name, config, start_batch)
        elif args.mode == 'reset-and-rebuild':
            result = await do_reset_and_rebuild_v2(workspace_path, dataset_name, config, start_batch)
        else:
            print(f"Error: Unknown mode: {args.mode}", file=sys.stderr)
            return 1

        # Output result
        output = {
            'success': result.success,
            'mode': args.mode,
            'files_discovered': result.files_discovered,
            'files_processed': result.files_processed,
            'files_skipped': result.files_skipped,
            'skip_reasons': result.skip_reasons,
            'total_runtime_seconds': result.total_runtime_seconds,
        }
        if result.error:
            output['error'] = result.error

        print(json.dumps(output, indent=2))

        if result.success:
            log_rebuild(workspace_dir, f"Operation completed successfully: {args.mode}")
            return 0
        else:
            log_rebuild(workspace_dir, f"Operation failed: {result.error or 'Unknown error'}", "ERROR")
            return 1

    except Exception as e:
        import traceback
        log_rebuild(workspace_dir, f"Unhandled exception: {e}", "ERROR")
        log_rebuild(workspace_dir, traceback.format_exc(), "ERROR")
        print(json.dumps({'success': False, 'error': str(e)}))
        return 1

    finally:
        release_lock(workspace_dir)
        log_rebuild(workspace_dir, "Maintenance lock released")


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description='Flowbaby Workspace Rebuild Tool (Plan 074 M5 + Plan 076)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Preview what would be processed (no changes)
  python rebuild_workspace.py --mode reindex-only --dry-run /path/to/workspace

  # Non-destructive reindex from filesystem
  python rebuild_workspace.py --mode reindex-only /path/to/workspace

  # Full reset and rebuild (requires --force)
  python rebuild_workspace.py --mode reset-and-rebuild --force /path/to/workspace

  # Resume an interrupted rebuild
  python rebuild_workspace.py --mode reset-and-rebuild --force --resume /path/to/workspace

  # Start fresh (clear checkpoint)
  python rebuild_workspace.py --mode reset-and-rebuild --force --restart /path/to/workspace

  # Limit to 100 files with custom batch size
  python rebuild_workspace.py --mode reindex-only --max-files 100 --batch-size 25 /path/to/workspace

Environment Variables:
  AWS_ACCESS_KEY_ID      Required. Cloud credentials from Flowbaby Cloud login.
  AWS_SECRET_ACCESS_KEY  Required. Cloud credentials from Flowbaby Cloud login.
  AWS_SESSION_TOKEN      Required. Cloud credentials from Flowbaby Cloud login.

Exit Codes:
  0 - Success
  1 - Error (invalid arguments, missing workspace, operation failed)
  2 - Lock acquisition failed (another operation in progress)
  3 - User cancelled (no --force for destructive operation)
  4 - Concurrent writers detected (daemon active)
  5 - Checkpoint mismatch (inputs changed, use --restart)

Notes:
  - This tool is for DEVELOPERS and TESTERS only
  - It is NOT executed automatically during upgrades
  - Source: .flowbaby/data/**/*.txt (excludes .cognee_fs_cache/**)
  - Acquires maintenance lock to prevent concurrent operations
  - Logs all actions to .flowbaby/maintenance/rebuild.log
"""
    )

    parser.add_argument(
        '--mode',
        required=True,
        choices=['reindex-only', 'reset-and-rebuild'],
        help='Operation mode: reindex-only (non-destructive) or reset-and-rebuild (destructive)'
    )

    parser.add_argument(
        '--force',
        action='store_true',
        help='Required for reset-and-rebuild mode. Confirms destructive operation.'
    )

    # Plan 076: New arguments
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show preflight summary without making changes.'
    )

    parser.add_argument(
        '--resume',
        action='store_true',
        help='Resume from last checkpoint. Fails if inputs changed.'
    )

    parser.add_argument(
        '--restart',
        action='store_true',
        help='Clear checkpoint and start fresh.'
    )

    parser.add_argument(
        '--batch-size',
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f'Number of files per batch (default: {DEFAULT_BATCH_SIZE})'
    )

    parser.add_argument(
        '--batch-delay',
        type=float,
        default=DEFAULT_BATCH_DELAY_SECONDS,
        help=f'Delay between batches in seconds (default: {DEFAULT_BATCH_DELAY_SECONDS})'
    )

    parser.add_argument(
        '--max-files',
        type=int,
        default=None,
        help='Maximum number of files to process.'
    )

    parser.add_argument(
        '--max-file-size',
        type=int,
        default=DEFAULT_MAX_FILE_SIZE_BYTES,
        help=f'Skip files larger than this (bytes, default: {DEFAULT_MAX_FILE_SIZE_BYTES})'
    )

    parser.add_argument(
        '--allow-oversized',
        action='store_true',
        help='Include files exceeding --max-file-size.'
    )

    parser.add_argument(
        '--allow-empty',
        action='store_true',
        help='Allow reset-and-rebuild to proceed with no eligible files.'
    )

    parser.add_argument(
        '--cognify-per-batch',
        action='store_true',
        help='Run cognify() after each batch instead of once at the end.'
    )

    parser.add_argument(
        'workspace_path',
        help='Absolute path to the workspace directory'
    )

    args = parser.parse_args()

    # Run async main
    exit_code = asyncio.run(main_async(args))
    sys.exit(exit_code)


if __name__ == '__main__':
    main()
