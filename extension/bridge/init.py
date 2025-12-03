#!/usr/bin/env python3
"""
Cognee Initialization Script for VS Code Extension

Usage: python init.py <workspace_path>

Initializes Cognee for a workspace by:
1. Loading environment variables from workspace .env file
2. Configuring Cognee with OpenAI API key
3. Generating unique dataset name for workspace isolation
4. Setting up workspace-local .flowbaby/ directory for marker files
5. Performing one-time global data prune if needed (with safety checks)

Returns JSON to stdout:
  Success: {"success": true, "dataset_name": "ws_abc123...", "flowbaby_dir": "/path/to/.flowbaby",
            "ontology_loaded": true, "ontology_entities": 8, "ontology_relationships": 12,
            "migration_performed": false, "global_marker_location": "/path/to/marker",
            "data_dir_size_before": 12345, "data_dir_size_after": 6789,
            "data_integrity": {"sqlite_count": 100, "lancedb_count": 100, "healthy": true}}
  Failure: {"success": false, "error": "error message"}

Plan 027 Fix: Migration marker is now checked in workspace-local .flowbaby/system/ directory
instead of volatile venv package location. This prevents data loss on package reinstalls.
"""

import asyncio
import io
import json
import os
import sys
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

# Add bridge directory to path to import bridge_logger
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import bridge_logger
from ontology_provider import OntologyLoadError, load_ontology
from workspace_utils import canonicalize_workspace_path, generate_dataset_name


@contextmanager
def suppress_stdout(logger=None):
    """
    Context manager to suppress stdout/stderr during operations that may print unwanted output.

    Plan 040 Milestone 1: The cognee SDK prints "User X has registered" and other messages
    to stdout during database initialization, which corrupts our JSON output. This context
    manager captures all stdout/stderr and redirects it to the logger.

    STDOUT CONTRACT: init.py must emit exactly one JSON line to stdout and nothing else.
    All human-readable diagnostics must go through the file logger or stderr.

    Args:
        logger: Optional logger instance to log captured output

    Yields:
        Captured output object with .stdout and .stderr properties
    """
    class CapturedOutput:
        def __init__(self):
            self.stdout = ""
            self.stderr = ""

    captured = CapturedOutput()
    old_stdout = sys.stdout
    old_stderr = sys.stderr

    # Create StringIO buffers to capture output
    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()

    try:
        sys.stdout = stdout_buffer
        sys.stderr = stderr_buffer
        yield captured
    finally:
        # Restore original stdout/stderr BEFORE accessing buffers
        sys.stdout = old_stdout
        sys.stderr = old_stderr

        # Get captured content
        captured.stdout = stdout_buffer.getvalue()
        captured.stderr = stderr_buffer.getvalue()

        # Log captured output if logger is provided and there's content
        if logger:
            if captured.stdout.strip():
                logger.debug(f"Suppressed stdout: {captured.stdout.strip()}")
            if captured.stderr.strip():
                logger.debug(f"Suppressed stderr: {captured.stderr.strip()}")

        # Clean up buffers
        stdout_buffer.close()
        stderr_buffer.close()


def workspace_has_data(system_dir: Path) -> bool:
    """
    Check if workspace has existing vector data that would be lost by prune.

    This is a defense-in-depth safety check. Even if marker logic has bugs,
    we should NEVER destroy data that exists.

    Args:
        system_dir: Path to .flowbaby/system directory

    Returns:
        True if existing data is detected, False otherwise
    """
    try:
        # Check for LanceDB data
        lancedb_path = system_dir / 'databases' / 'cognee.lancedb'
        if lancedb_path.exists() and lancedb_path.is_dir():
            try:
                if any(lancedb_path.iterdir()):
                    return True
            except (PermissionError, OSError):
                pass  # Can't read dir, assume no data

        # Check for Kuzu graph data
        kuzu_path = system_dir / 'databases' / 'cognee_graph'
        if kuzu_path.exists() and kuzu_path.is_dir():
            try:
                if any(kuzu_path.iterdir()):
                    return True
            except (PermissionError, OSError):
                pass  # Can't read dir, assume no data

        return False
    except Exception:
        # On any error, assume no data (fail-open for fresh workspaces)
        return False


def get_data_integrity_status(system_dir: Path) -> dict:
    """
    Check data integrity by comparing SQLite vs LanceDB counts.

    This helps detect data loss situations where SQLite has more entries
    than LanceDB (indicating vector embeddings were lost).

    Args:
        system_dir: Path to .flowbaby/system directory

    Returns:
        Dictionary with sqlite_count, lancedb_count, healthy boolean, and optional warning
    """
    try:
        sqlite_count = 0
        lancedb_count = 0

        # Count SQLite entries
        sqlite_db_path = system_dir / 'databases' / 'cognee_db'
        if sqlite_db_path.exists():
            try:
                import sqlite3
                conn = sqlite3.connect(str(sqlite_db_path))
                cursor = conn.cursor()
                # Try to count data entries - table name may vary
                for table_name in ['data', 'data_entry', 'entries', 'documents']:
                    try:
                        cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
                        sqlite_count = cursor.fetchone()[0]
                        break
                    except sqlite3.OperationalError:
                        continue
                conn.close()
            except Exception:
                sqlite_count = -1  # Could not query

        # Count LanceDB entries
        lancedb_path = system_dir / 'databases' / 'cognee.lancedb'
        if lancedb_path.exists() and lancedb_path.is_dir():
            try:
                # Count .lance files or subdirectories as proxy for data
                lance_items = list(lancedb_path.glob('*'))
                lancedb_count = len([f for f in lance_items if f.is_dir() or f.suffix == '.lance'])
            except Exception:
                lancedb_count = -1  # Could not query

        # Determine health - healthy if counts match or LanceDB >= 90% of SQLite
        if sqlite_count <= 0 and lancedb_count <= 0:
            healthy = True  # No data, no problem
            warning = None
        elif sqlite_count > 0 and lancedb_count <= 0:
            healthy = False
            warning = f'Data mismatch: {sqlite_count} SQLite entries but no vector embeddings detected'
        elif lancedb_count >= sqlite_count * 0.9:
            healthy = True
            warning = None
        else:
            healthy = False
            warning = f'Data mismatch: {sqlite_count} SQLite entries but only {lancedb_count} vector tables'

        return {
            'sqlite_count': sqlite_count,
            'lancedb_count': lancedb_count,
            'healthy': healthy,
            'warning': warning
        }
    except Exception as e:
        return {
            'sqlite_count': -1,
            'lancedb_count': -1,
            'healthy': True,  # Don't block on check failure
            'warning': f'Could not check data integrity: {e}'
        }


async def initialize_cognee(workspace_path: str) -> dict:
    """
    Initialize Cognee for the given workspace with dataset-based isolation.

    Args:
        workspace_path: Absolute path to VS Code workspace root

    Returns:
        Dictionary with success status, dataset_name, flowbaby_dir, ontology info, and migration status
    """
    # Initialize logger
    logger = bridge_logger.setup_logging(workspace_path, "init")
    logger.info(f"Initializing cognee for workspace: {workspace_path}")

    try:
        workspace_dir = Path(workspace_path)

        # Plan 039 M5: API key is now resolved by TypeScript and passed via environment
        # Workspace .env loading removed per Plan 037 F2 security finding
        # (plaintext API keys in .env files are a credential exposure risk)

        # Plan 045: Check for API key but don't fail if missing
        # Per Architectural Decision 1: Initialization no longer implies LLM readiness
        # The TypeScript layer will handle prompting users to configure the API key
        api_key = os.getenv('LLM_API_KEY')
        api_key_configured = bool(api_key)
        
        if not api_key:
            logger.warning('LLM_API_KEY not found in environment - initialization will continue without LLM configuration')
            logger.info('User will be prompted to set API key after initialization completes')

        # ============================================================================
        # PLAN 033 FIX: Set environment variables BEFORE importing cognee SDK
        # ============================================================================
        # CRITICAL: The Cognee SDK uses pydantic-settings with @lru_cache, which reads
        # environment variables at import time and caches them permanently. Setting
        # cognee.config.system_root_directory() after import is ineffective.
        #
        # This is the same pattern used in ingest.py and retrieve.py (Plan 032).
        # ============================================================================

        # Calculate workspace-local storage paths
        system_root = str(workspace_dir / '.flowbaby/system')
        data_root = str(workspace_dir / '.flowbaby/data')

        # Create directories BEFORE setting env vars (ensures paths exist)
        Path(system_root).mkdir(parents=True, exist_ok=True)
        Path(data_root).mkdir(parents=True, exist_ok=True)
        logger.debug(f"Created storage directories: {system_root}, {data_root}")

        # Set environment variables BEFORE importing cognee
        # CRITICAL: Use DATA_ROOT_DIRECTORY and SYSTEM_ROOT_DIRECTORY (no COGNEE_ prefix!)
        os.environ['SYSTEM_ROOT_DIRECTORY'] = system_root
        os.environ['DATA_ROOT_DIRECTORY'] = data_root
        logger.debug(f"Set environment variables: SYSTEM_ROOT_DIRECTORY={system_root}, DATA_ROOT_DIRECTORY={data_root}")

        # NOW import cognee - it will read the env vars we just set
        # Plan 040 M1: Wrap import in stdout suppression as SDK may print during module init
        logger.debug("Importing cognee SDK")
        try:
            with suppress_stdout(logger):
                # Plan 040 Hotfix: Pre-check kuzu import to catch DLL errors early
                import kuzu
                import cognee
                from cognee.infrastructure.databases.relational import create_db_and_tables
        except ImportError as e:
            # Plan 040 Hotfix: Catch Kuzu DLL load failure on Windows
            if "DLL load failed" in str(e) and "_kuzu" in str(e):
                logger.error("Kuzu DLL load failed - missing Visual C++ Redistributable")
                raise ImportError(
                    "Flowbaby requires the Microsoft Visual C++ Redistributable on Windows. "
                    "Please install it from https://aka.ms/vs/17/release/vc_redist.x64.exe "
                    "and reload the window."
                ) from e
            raise

        # ============================================================================
        # Belt-and-suspenders: Also call cognee.config methods after import
        # These are redundant since env vars are set before import, but kept for safety
        # ============================================================================

        # Plan 028 M6: Read LLM configuration from environment with workspace .env fallback
        # Priority: Environment variable (from TypeScript) > workspace .env > default
        llm_api_key = os.environ.get('LLM_API_KEY') or api_key  # api_key loaded from .env earlier
        llm_provider = os.environ.get('LLM_PROVIDER') or os.getenv('LLM_PROVIDER') or 'openai'
        llm_model = os.environ.get('LLM_MODEL') or os.getenv('LLM_MODEL') or 'gpt-4o-mini'
        llm_endpoint = os.environ.get('LLM_ENDPOINT') or os.getenv('LLM_ENDPOINT') or ''

        logger.debug(f"LLM configuration: provider={llm_provider}, model={llm_model}, endpoint={'<set>' if llm_endpoint else '<default>'}")

        # Configure Cognee with LLM settings in the correct order (per architecture review §2.6)
        # 1. Set API key first
        cognee.config.set_llm_api_key(llm_api_key)
        # 2. Set provider
        cognee.config.set_llm_provider(llm_provider)
        # 3. Set model
        cognee.config.set_llm_model(llm_model)
        # 4. Set endpoint only if non-empty
        if llm_endpoint:
            cognee.config.set_llm_endpoint(llm_endpoint)
            logger.debug(f"Custom LLM endpoint configured: {llm_endpoint}")

        # Belt-and-suspenders: Also call config methods (redundant but safe)
        # Plan 033: Env vars are set before import, so these are now confirmatory
        cognee.config.system_root_directory(system_root)
        cognee.config.data_root_directory(data_root)
        logger.debug(f"Confirmed workspace-local storage via config API: {system_root}")

        # PLAN 027: Derive global_data_dir directly from workspace path
        # NEVER query get_relational_config() for marker location - it may return stale/wrong path
        global_data_dir = workspace_dir / '.flowbaby/system'
        global_data_dir.mkdir(parents=True, exist_ok=True)
        global_marker_path = global_data_dir / '.migration_v1_complete'
        logger.debug(f"Migration marker location (workspace-local): {global_marker_path}")

        # 1. Generate unique dataset name for this workspace using canonical path
        dataset_name, workspace_path_str = generate_dataset_name(workspace_path)
        logger.info(f"Generated dataset name: {dataset_name}")

        # 2. Create .flowbaby directory for local marker files (not database storage)
        # Note: The data/system storage directories are already created earlier
        flowbaby_dir = Path(workspace_path) / '.flowbaby'
        flowbaby_dir.mkdir(parents=True, exist_ok=True)

        local_marker_path = flowbaby_dir / '.dataset_migration_complete'

        # 3. Migration marker strategy with safety checks
        migration_performed = False
        global_marker_location = str(global_marker_path.absolute())
        data_dir_size_before = 0
        data_dir_size_after = 0

        # Check if workspace migration marker already exists (authoritative)
        if global_marker_path.exists():
            logger.debug("Workspace migration marker found - migration already complete")
            # Read existing marker metadata
            try:
                marker_content = global_marker_path.read_text()
                marker_data = json.loads(marker_content)
                data_dir_size_before = marker_data.get('data_dir_size_before', 0)
                data_dir_size_after = marker_data.get('data_dir_size_after', 0)
            except Exception as e:
                logger.warning(f"Failed to read marker metadata: {e}")
        else:
            logger.info("Workspace migration marker not found, checking safety conditions")

            # PLAN 027 SAFETY CHECK: Never prune if existing data is detected
            if workspace_has_data(global_data_dir):
                logger.warning("=" * 60)
                logger.warning("⚠️ SAFETY: Existing data detected in workspace")
                logger.warning("   Skipping prune to prevent data loss")
                logger.warning("   Creating marker without pruning")
                logger.warning("=" * 60)

                # Create marker WITHOUT pruning
                marker_metadata = {
                    'migrated_at': datetime.now().isoformat(),
                    'workspace_id': dataset_name,
                    'workspace_path': workspace_path_str,
                    'data_dir_size_before': 0,
                    'data_dir_size_after': 0,
                    'version': 'v1',
                    'note': 'Marker created without prune - existing data detected (Plan 027 safety)',
                    'prune_skipped': True,
                    'reason': 'workspace_has_data() returned True'
                }
                global_marker_path.write_text(json.dumps(marker_metadata, indent=2))
                logger.info("Migration marker created (prune skipped due to existing data)")
                migration_performed = False

            # Check for fresh workspace (empty databases directory)
            # If the workspace is fresh, we don't need to prune anything
            elif not (global_data_dir / 'databases').exists() or not any((global_data_dir / 'databases').iterdir()):
                logger.info("Fresh workspace detected - skipping prune")

                # Ensure databases directory exists
                (global_data_dir / 'databases').mkdir(parents=True, exist_ok=True)

                # Initialize relational database tables (SQLite)
                # This is required for user registration and basic system function
                # Plan 040 M1: Wrap in stdout suppression - create_db_and_tables() prints
                # "User X has registered" which corrupts JSON output
                logger.info("Initializing relational database tables...")
                with suppress_stdout(logger):
                    await create_db_and_tables()
                logger.info("Relational database tables created")

                # Initialize Graph DB (Kuzu)
                # Plan 040 M1: Wrap in stdout suppression as Kuzu may print diagnostics
                logger.info("Initializing graph database (Kuzu)...")
                with suppress_stdout(logger):
                    from cognee.infrastructure.databases.graph import get_graph_engine
                    await get_graph_engine()

                # Initialize Vector DB (LanceDB) via dummy ingestion
                # Plan 040 M1: Wrap in stdout suppression as LanceDB may print during setup
                # Plan 045: Only perform LLM-dependent operations if API key is configured
                if api_key_configured:
                    logger.info("Initializing vector database (LanceDB) via setup marker...")
                    with suppress_stdout(logger):
                        await cognee.add(
                            data=["Flowbaby environment setup completed"],
                            dataset_name=dataset_name
                        )
                    logger.info("Vector database initialized")
                else:
                    logger.info("Skipping vector database initialization - API key not configured")
                    logger.info("Vector database will be initialized when API key is provided")

                marker_metadata = {
                    'migrated_at': datetime.now().isoformat(),
                    'workspace_id': dataset_name,
                    'workspace_path': workspace_path_str,
                    'data_dir_size_before': 0,
                    'data_dir_size_after': 0,
                    'version': 'v1',
                    'note': 'Marker created without prune - fresh workspace',
                    'prune_skipped': True,
                    'reason': 'fresh_workspace'
                }
                global_marker_path.write_text(json.dumps(marker_metadata, indent=2))
                logger.info("Migration marker created (fresh workspace)")
                migration_performed = False

            else:
                # No existing data detected but directory is not empty - proceed with migration prune
                logger.info("Legacy data structure detected - proceeding with migration")

                # Attempt to atomically create marker (OS-level exclusivity)
                try:
                    # O_CREAT | O_EXCL ensures only one process can create the file
                    fd = os.open(str(global_marker_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)

                    # This process won the race - perform global prune
                    try:
                        # Calculate data directory size before pruning
                        data_dir_size_before = sum(
                            f.stat().st_size for f in global_data_dir.rglob('*') if f.is_file()
                        )

                        # PLAN 027: Prominent warning before prune
                        logger.warning("=" * 60)
                        logger.warning("⚠️ PERFORMING DATA PRUNE - This will clear vector embeddings")
                        logger.warning("   This is a one-time migration for legacy untagged data.")
                        logger.warning(f"   Marker will be created at: {global_marker_path}")
                        logger.warning("=" * 60)

                        # Perform global prune (removes only untagged legacy data)
                        # Plan 040 M1: Wrap in stdout suppression
                        with suppress_stdout(logger):
                            await cognee.prune.prune_system()
                        migration_performed = True

                        # Calculate data directory size after pruning
                        data_dir_size_after = sum(
                            f.stat().st_size for f in global_data_dir.rglob('*') if f.is_file()
                        )

                        logger.info(f"Data prune complete. Size before: {data_dir_size_before} bytes, after: {data_dir_size_after} bytes")

                        # Write structured metadata to global marker
                        marker_metadata = {
                            'migrated_at': datetime.now().isoformat(),
                            'workspace_id': dataset_name,
                            'workspace_path': workspace_path_str,
                            'data_dir_size_before': data_dir_size_before,
                            'data_dir_size_after': data_dir_size_after,
                            'version': 'v1',
                            'note': 'Global prune of untagged data performed by this process',
                            'prune_skipped': False
                        }

                        # Write to the already-opened file descriptor
                        os.write(fd, json.dumps(marker_metadata, indent=2).encode())
                        logger.info("Global migration completed and marker created")

                    finally:
                        os.close(fd)

                except FileExistsError:
                    # Another process created the marker - migration already performed
                    logger.info("Migration marker created by another process")
                    migration_performed = False

                    # Read existing marker metadata if available
                    try:
                        if global_marker_path.exists():
                            marker_content = global_marker_path.read_text()
                            marker_data = json.loads(marker_content)
                            data_dir_size_before = marker_data.get('data_dir_size_before', 0)
                            data_dir_size_after = marker_data.get('data_dir_size_after', 0)
                    except Exception as e:
                        logger.warning(f"Failed to read marker metadata: {e}")

                except (OSError, PermissionError) as e:
                    error_msg = f'Failed to create migration marker (permission denied or filesystem error): {e}'
                    logger.error(error_msg)
                    return {
                        'success': False,
                        'error': error_msg
                    }

        # 4. Create/update local acknowledgement marker (all processes do this)
        local_marker_path.write_text(json.dumps({
            'acknowledged_at': datetime.now().isoformat(),
            'dataset_name': dataset_name,
            'workspace_path': workspace_path_str,
            'migration_performed_by_this_process': migration_performed,
            'global_marker_location': global_marker_location
        }, indent=2))

        # 5. Load ontology configuration using OntologyProvider
        try:
            logger.debug("Loading ontology")
            ontology = load_ontology()
        except OntologyLoadError as e:
            error_msg = str(e)
            logger.error(f"Ontology load failed: {error_msg}")
            return {
                'success': False,
                'error_code': 'ONTOLOGY_LOAD_FAILED',
                'user_message': 'Failed to load ontology configuration',
                'remediation': 'Ensure ontology.ttl exists in extension/bridge/ directory and is valid Turtle RDF format',
                'error': error_msg
            }
        except Exception as e:
            error_msg = f'Ontology loading error: {str(e)}'
            logger.error(error_msg)
            return {
                'success': False,
                'error_code': 'ONTOLOGY_LOAD_FAILED',
                'user_message': 'Unexpected error loading ontology',
                'remediation': 'Check extension logs for details. File an issue if problem persists.',
                'error': error_msg
            }

        # 6. PLAN 027: Get data integrity status for health reporting
        data_integrity = get_data_integrity_status(global_data_dir)
        if data_integrity.get('warning'):
            logger.warning(f"Data integrity warning: {data_integrity['warning']}")

        logger.info("Initialization completed successfully")

        # 7. Return extended success JSON with migration metadata and data integrity
        # Plan 045: Add api_key_configured and llm_ready fields
        return {
            'success': True,
            'api_key_configured': api_key_configured,
            'llm_ready': api_key_configured,
            'dataset_name': dataset_name,
            'workspace_path': workspace_path_str,
            'flowbaby_dir': str(flowbaby_dir.absolute()),
            'ontology_loaded': True,
            'ontology_entities': len(ontology.get('entities', [])),
            'ontology_relationships': len(ontology.get('relationships', [])),
            'migration_performed': migration_performed,
            'global_marker_location': global_marker_location,
            'data_dir_size_before': data_dir_size_before,
            'data_dir_size_after': data_dir_size_after,
            'data_integrity': data_integrity
        }

    except ImportError as e:
        error_msg = f'Failed to import required module: {str(e)}'
        if logger: logger.error(error_msg)
        return {
            'success': False,
            'error': error_msg
        }
    except Exception as e:
        error_msg = f'Initialization failed: {str(e)}'
        if logger: logger.error(error_msg)
        return {
            'success': False,
            'error': error_msg
        }


def main():
    """Main entry point for the script."""
    # Check command-line arguments
    if len(sys.argv) < 2:
        result = {
            'success': False,
            'error': 'Missing required argument: workspace_path'
        }
        print(json.dumps(result))
        sys.exit(1)

    workspace_path = sys.argv[1]
    try:
        workspace_path = canonicalize_workspace_path(workspace_path)
    except FileNotFoundError:
        result = {
            'success': False,
            'error': f'Workspace path does not exist: {sys.argv[1]}'
        }
        print(json.dumps(result))
        sys.exit(1)

    # Validate workspace path exists
    if not Path(workspace_path).is_dir():
        result = {
            'success': False,
            'error': f'Workspace path does not exist: {workspace_path}'
        }
        print(json.dumps(result))
        sys.exit(1)

    # Run initialization
    result = asyncio.run(initialize_cognee(workspace_path))

    # Output JSON result
    print(json.dumps(result))

    # Exit with appropriate code
    sys.exit(0 if result['success'] else 1)


if __name__ == '__main__':
    main()
