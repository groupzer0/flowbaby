#!/usr/bin/env python3
"""
Unit tests for data_integrity_utils module.

Plan 057: Tests for the shared data integrity helper functions used by init.py
and recover_data.py to count SQLite documents and LanceDB embeddings.
"""

import sqlite3

import lancedb

from data_integrity_utils import (
    evaluate_data_health,
    get_lancedb_embedding_count,
    get_sqlite_and_lancedb_counts,
    get_sqlite_document_count,
)


class TestGetSqliteDocumentCount:
    """Tests for SQLite document counting."""

    def test_returns_zero_when_db_not_exists(self, tmp_path):
        """Non-existent database should return 0."""
        system_dir = tmp_path / '.flowbaby/system'
        assert get_sqlite_document_count(system_dir) == 0

    def test_counts_data_table_rows(self, tmp_path):
        """Should count rows in the 'data' table."""
        system_dir = tmp_path / '.flowbaby/system'
        db_dir = system_dir / 'databases'
        db_dir.mkdir(parents=True)

        # Create SQLite database with data table
        conn = sqlite3.connect(str(db_dir / 'cognee_db'))
        conn.execute('CREATE TABLE data (id TEXT, content TEXT)')
        conn.executemany('INSERT INTO data VALUES (?, ?)', [
            ('doc1', 'content1'),
            ('doc2', 'content2'),
            ('doc3', 'content3'),
        ])
        conn.commit()
        conn.close()

        assert get_sqlite_document_count(system_dir) == 3

    def test_fallback_to_alternate_tables(self, tmp_path):
        """Should try alternate table names if 'data' doesn't exist."""
        system_dir = tmp_path / '.flowbaby/system'
        db_dir = system_dir / 'databases'
        db_dir.mkdir(parents=True)

        # Create database with 'data_entry' table instead of 'data'
        conn = sqlite3.connect(str(db_dir / 'cognee_db'))
        conn.execute('CREATE TABLE data_entry (id TEXT, content TEXT)')
        conn.executemany('INSERT INTO data_entry VALUES (?, ?)', [
            ('doc1', 'content1'),
            ('doc2', 'content2'),
        ])
        conn.commit()
        conn.close()

        assert get_sqlite_document_count(system_dir) == 2

    def test_returns_zero_when_no_recognized_table(self, tmp_path):
        """Should return 0 if no recognized table exists."""
        system_dir = tmp_path / '.flowbaby/system'
        db_dir = system_dir / 'databases'
        db_dir.mkdir(parents=True)

        # Create database with unrecognized table name
        conn = sqlite3.connect(str(db_dir / 'cognee_db'))
        conn.execute('CREATE TABLE other_table (id TEXT)')
        conn.commit()
        conn.close()

        assert get_sqlite_document_count(system_dir) == 0


class TestGetLancedbEmbeddingCount:
    """Tests for LanceDB embedding counting."""

    def test_returns_zero_when_dir_not_exists(self, tmp_path):
        """Non-existent directory should return 0."""
        system_dir = tmp_path / '.flowbaby/system'
        assert get_lancedb_embedding_count(system_dir) == 0

    def test_returns_zero_for_empty_lancedb(self, tmp_path):
        """Empty LanceDB directory should return 0."""
        system_dir = tmp_path / '.flowbaby/system'
        lancedb_dir = system_dir / 'databases' / 'cognee.lancedb'
        lancedb_dir.mkdir(parents=True)

        # Just create empty directories (no actual tables)
        (lancedb_dir / 'some_dir').mkdir()

        assert get_lancedb_embedding_count(system_dir) == 0

    def test_counts_document_chunk_table_rows(self, tmp_path):
        """Should count rows from DocumentChunk_text table."""
        system_dir = tmp_path / '.flowbaby/system'
        lancedb_dir = system_dir / 'databases' / 'cognee.lancedb'
        lancedb_dir.mkdir(parents=True)

        # Create LanceDB with DocumentChunk_text table
        db = lancedb.connect(str(lancedb_dir))
        data = [
            {'id': f'chunk_{i}', 'text': f'text {i}', 'vector': [0.1] * 8}
            for i in range(7)
        ]
        db.create_table('DocumentChunk_text', data)

        assert get_lancedb_embedding_count(system_dir) == 7

    def test_fallback_to_text_document_table(self, tmp_path):
        """Should fall back to TextDocument_name if DocumentChunk_text missing."""
        system_dir = tmp_path / '.flowbaby/system'
        lancedb_dir = system_dir / 'databases' / 'cognee.lancedb'
        lancedb_dir.mkdir(parents=True)

        # Create LanceDB with only TextDocument_name table
        db = lancedb.connect(str(lancedb_dir))
        data = [
            {'id': f'doc_{i}', 'name': f'doc {i}', 'vector': [0.1] * 8}
            for i in range(4)
        ]
        db.create_table('TextDocument_name', data)

        assert get_lancedb_embedding_count(system_dir) == 4

    def test_sum_all_tables_as_last_resort(self, tmp_path):
        """Should sum all table rows if primary tables not found."""
        system_dir = tmp_path / '.flowbaby/system'
        lancedb_dir = system_dir / 'databases' / 'cognee.lancedb'
        lancedb_dir.mkdir(parents=True)

        # Create LanceDB with non-standard table names
        db = lancedb.connect(str(lancedb_dir))
        db.create_table('custom_table1', [{'id': '1', 'vector': [0.1] * 8}])
        db.create_table('custom_table2', [
            {'id': '2', 'vector': [0.1] * 8},
            {'id': '3', 'vector': [0.1] * 8},
        ])

        # Should sum: 1 + 2 = 3
        assert get_lancedb_embedding_count(system_dir) == 3


class TestEvaluateDataHealth:
    """Tests for health evaluation logic."""

    def test_both_empty_is_healthy(self):
        """Empty workspace is healthy."""
        healthy, warning = evaluate_data_health(0, 0)
        assert healthy is True
        assert warning is None

    def test_both_negative_is_healthy(self):
        """Unreadable databases treated as empty/healthy."""
        healthy, warning = evaluate_data_health(-1, -1)
        assert healthy is True
        assert warning is None

    def test_sqlite_only_is_unhealthy(self):
        """SQLite has data but LanceDB empty is unhealthy."""
        healthy, warning = evaluate_data_health(10, 0)
        assert healthy is False
        assert 'no vector embeddings' in warning

    def test_counts_match_is_healthy(self):
        """Matching counts is healthy."""
        healthy, warning = evaluate_data_health(100, 100)
        assert healthy is True
        assert warning is None

    def test_ninety_percent_match_is_healthy(self):
        """LanceDB >= 90% of SQLite is healthy."""
        healthy, warning = evaluate_data_health(100, 90)
        assert healthy is True
        assert warning is None

    def test_significant_mismatch_is_unhealthy(self):
        """LanceDB < 90% of SQLite (when SQLite > 5) is unhealthy."""
        healthy, warning = evaluate_data_health(100, 50)
        assert healthy is False
        assert 'only 50 vector embeddings' in warning

    def test_small_workspace_mismatch_is_healthy(self):
        """Minor mismatch in small workspace is tolerated."""
        # SQLite has 5, LanceDB has 3 (60%) - but small, so healthy
        healthy, warning = evaluate_data_health(5, 3)
        assert healthy is True
        assert warning is None


class TestGetSqliteAndLancedbCounts:
    """Integration tests for the combined counting function."""

    def test_returns_both_counts(self, tmp_path):
        """Should return tuple of (sqlite_count, lancedb_count)."""
        system_dir = tmp_path / '.flowbaby/system'
        db_dir = system_dir / 'databases'
        db_dir.mkdir(parents=True)

        # Create SQLite with 5 rows
        conn = sqlite3.connect(str(db_dir / 'cognee_db'))
        conn.execute('CREATE TABLE data (id TEXT)')
        for i in range(5):
            conn.execute('INSERT INTO data VALUES (?)', (f'doc{i}',))
        conn.commit()
        conn.close()

        # Create LanceDB with 5 rows
        lancedb_dir = db_dir / 'cognee.lancedb'
        lancedb_dir.mkdir()
        db = lancedb.connect(str(lancedb_dir))
        data = [{'id': f'chunk_{i}', 'text': f't{i}', 'vector': [0.1] * 8} for i in range(5)]
        db.create_table('DocumentChunk_text', data)

        sqlite_count, lancedb_count = get_sqlite_and_lancedb_counts(system_dir)
        assert sqlite_count == 5
        assert lancedb_count == 5

    def test_handles_missing_databases(self, tmp_path):
        """Should return zeros for missing databases."""
        system_dir = tmp_path / 'nonexistent'
        sqlite_count, lancedb_count = get_sqlite_and_lancedb_counts(system_dir)
        assert sqlite_count == 0
        assert lancedb_count == 0
