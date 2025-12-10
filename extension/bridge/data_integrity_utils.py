#!/usr/bin/env python3
"""
Data Integrity Utilities for Flowbaby

Shared helper functions for checking data integrity between SQLite and LanceDB.
Used by init.py for startup health checks and recover_data.py for recovery operations.

Plan 057: This module addresses false-positive integrity warnings by counting actual
LanceDB row counts instead of the number of table directories. In Cognee 0.4.x,
LanceDB uses a fixed set of tables (e.g., DocumentChunk_text, Entity_name, etc.)
regardless of data volume, so counting directories was producing misleading warnings.

Design Decision:
- We count rows from `DocumentChunk_text` table as the primary embedding count since
  each document chunk produces one embedding vector. This aligns with SQLite's `data`
  table which tracks ingested documents at the chunk level.
- Alternative: Sum all rows across all tables. However, different tables represent
  different concepts (entities, relationships, summaries), so this would not provide
  a meaningful 1:1 comparison with SQLite document counts.
"""

from pathlib import Path
from typing import Tuple


def get_sqlite_document_count(system_dir: Path) -> int:
    """
    Count the number of documents in SQLite's canonical `data` table.

    Args:
        system_dir: Path to .flowbaby/system directory

    Returns:
        Number of rows in the data table, or 0 if not found/empty, or -1 on error
    """
    import sqlite3

    sqlite_db_path = system_dir / 'databases' / 'cognee_db'
    if not sqlite_db_path.exists():
        return 0

    try:
        conn = sqlite3.connect(str(sqlite_db_path))
        cursor = conn.cursor()

        # Try canonical table name first, then fallbacks
        for table_name in ['data', 'data_entry', 'entries', 'documents']:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
                count = cursor.fetchone()[0]
                conn.close()
                return count
            except sqlite3.OperationalError:
                continue

        conn.close()
        return 0  # No recognized table found
    except Exception:
        return -1  # Could not query


def get_lancedb_embedding_count(system_dir: Path) -> int:
    """
    Count the total number of embedding rows in LanceDB.

    In Cognee 0.4.x, each document chunk produces one row in the `DocumentChunk_text`
    table. This is the most appropriate metric to compare against SQLite's document count.

    If `DocumentChunk_text` is not found, falls back to summing rows from all tables
    whose names suggest they contain embeddings (those ending with '_text' or '_name').

    Args:
        system_dir: Path to .flowbaby/system directory

    Returns:
        Number of embedding rows, or 0 if empty/not found, or -1 on error
    """
    lancedb_path = system_dir / 'databases' / 'cognee.lancedb'
    if not lancedb_path.exists() or not lancedb_path.is_dir():
        return 0

    try:
        import lancedb

        db = lancedb.connect(str(lancedb_path))
        table_names = db.table_names()

        if not table_names:
            return 0

        # Primary strategy: count DocumentChunk_text rows (direct 1:1 with documents)
        if 'DocumentChunk_text' in table_names:
            table = db.open_table('DocumentChunk_text')
            return table.count_rows()

        # Fallback: If DocumentChunk_text doesn't exist (schema evolution),
        # count rows from TextDocument_name as secondary indicator
        if 'TextDocument_name' in table_names:
            table = db.open_table('TextDocument_name')
            return table.count_rows()

        # Last resort: Sum all table rows (less precise but non-zero indicator)
        total = 0
        for name in table_names:
            try:
                table = db.open_table(name)
                total += table.count_rows()
            except Exception:
                continue  # Skip tables that can't be opened
        return total

    except ImportError:
        # lancedb not installed - return -1 to indicate error
        return -1
    except Exception:
        return -1  # Could not query


def get_sqlite_and_lancedb_counts(system_dir: Path) -> Tuple[int, int]:
    """
    Get both SQLite document count and LanceDB embedding count.

    This is a convenience wrapper that calls both counting functions.

    Args:
        system_dir: Path to .flowbaby/system directory

    Returns:
        Tuple of (sqlite_count, lancedb_count)
    """
    sqlite_count = get_sqlite_document_count(system_dir)
    lancedb_count = get_lancedb_embedding_count(system_dir)
    return sqlite_count, lancedb_count


def evaluate_data_health(sqlite_count: int, lancedb_count: int) -> Tuple[bool, str | None]:
    """
    Evaluate data health based on SQLite vs LanceDB counts.

    Health semantics:
    - Both counts are 0 or negative: healthy (empty or unreadable workspace)
    - SQLite > 0 but LanceDB == 0: unhealthy (embeddings missing)
    - LanceDB >= 90% of SQLite: healthy (minor discrepancies tolerated)
    - LanceDB < 90% of SQLite: unhealthy only if SQLite > 5 (avoid noise for tiny workspaces)

    Args:
        sqlite_count: Number of rows in SQLite data table
        lancedb_count: Number of embedding rows in LanceDB

    Returns:
        Tuple of (healthy: bool, warning: str | None)
    """
    # Case 1: Both empty or both unreadable
    if sqlite_count <= 0 and lancedb_count <= 0:
        return True, None

    # Case 2: SQLite has data but LanceDB is empty or unreadable
    if sqlite_count > 0 and lancedb_count <= 0:
        return False, f'Data mismatch: {sqlite_count} SQLite entries but no vector embeddings detected'

    # Case 3: LanceDB count is within acceptable range of SQLite
    # (90% threshold allows for minor timing/sync issues)
    if lancedb_count >= sqlite_count * 0.9:
        return True, None

    # Case 4: Significant mismatch - only warn if SQLite count is meaningful
    # (avoid false positives for tiny workspaces where off-by-one matters)
    if sqlite_count > 5:
        return False, f'Data mismatch: {sqlite_count} SQLite entries but only {lancedb_count} vector embeddings'

    # Small workspace with minor discrepancy - treat as healthy
    return True, None
