#!/usr/bin/env python3
"""
Batch data recovery script for flowbaby.

This script recovers lost vector embeddings by re-processing the raw text files
that are still intact in .flowbaby/data/. It reads each text file and passes it
through cognee.add() + cognee.cognify() to regenerate LanceDB embeddings.

Usage:
    cd extension/bridge
    source .venv/bin/activate
    python recover_data.py --workspace /path/to/workspace [--dry-run]
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path
from typing import List, Tuple


def configure_workspace(workspace_path: Path) -> None:
    """Configure cognee to use workspace-local storage directories."""
    import cognee
    
    system_dir = workspace_path / '.flowbaby/system'
    data_dir = workspace_path / '.flowbaby/data'
    
    print(f"Configuring workspace directories:")
    print(f"  System dir: {system_dir}")
    print(f"  Data dir: {data_dir}")
    
    cognee.config.system_root_directory(str(system_dir))
    cognee.config.data_root_directory(str(data_dir))


def find_text_files(data_dir: Path) -> List[Path]:
    """Find all text files in the .flowbaby/data directory."""
    if not data_dir.exists():
        return []
    
    txt_files = sorted(data_dir.glob('*.txt'))
    return txt_files


def get_current_counts(workspace_path: Path) -> Tuple[int, int]:
    """Get current SQLite and LanceDB entry counts."""
    import sqlite3
    import lancedb
    
    db_path = workspace_path / '.flowbaby/system' / 'databases'
    
    # SQLite count
    sqlite_path = db_path / 'cognee_db'
    sqlite_count = 0
    if sqlite_path.exists():
        try:
            conn = sqlite3.connect(str(sqlite_path))
            cursor = conn.execute("SELECT COUNT(*) FROM data")
            sqlite_count = cursor.fetchone()[0]
            conn.close()
        except Exception as e:
            print(f"  Warning: Could not read SQLite: {e}")
    
    # LanceDB count
    lance_path = db_path / 'lancedb'
    lance_count = 0
    if lance_path.exists():
        try:
            db = lancedb.connect(str(lance_path))
            tables = db.table_names()
            data_tables = [t for t in tables if t.startswith('data_point_')]
            for table_name in data_tables:
                table = db.open_table(table_name)
                lance_count += len(table.to_pandas())
        except Exception as e:
            print(f"  Warning: Could not read LanceDB: {e}")
    
    return sqlite_count, lance_count


async def add_file_content(content: str, filename: str) -> None:
    """Add a single file's content to cognee."""
    import cognee
    await cognee.add(content, dataset_name='main_dataset')


async def batch_cognify() -> None:
    """Run cognify on all added data."""
    import cognee
    await cognee.cognify()


def main():
    parser = argparse.ArgumentParser(description='Recover lost vector embeddings')
    parser.add_argument('--workspace', type=str, required=True,
                        help='Path to the workspace directory')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show what would be done without making changes')
    parser.add_argument('--batch-size', type=int, default=10,
                        help='Number of files to add before running cognify (default: 10)')
    
    args = parser.parse_args()
    workspace_path = Path(args.workspace).resolve()
    
    if not workspace_path.exists():
        print(f"Error: Workspace path does not exist: {workspace_path}")
        sys.exit(1)
    
    data_dir = workspace_path / '.flowbaby/data'
    if not data_dir.exists():
        print(f"Error: No .flowbaby/data directory found at: {data_dir}")
        sys.exit(1)
    
    # Configure workspace FIRST (this is critical!)
    configure_workspace(workspace_path)
    
    # Find text files
    txt_files = find_text_files(data_dir)
    print(f"\nFound {len(txt_files)} text files in {data_dir}")
    
    if not txt_files:
        print("No files to recover.")
        sys.exit(0)
    
    # Get current counts
    print("\nCurrent database status:")
    sqlite_count, lance_count = get_current_counts(workspace_path)
    print(f"  SQLite entries: {sqlite_count}")
    print(f"  LanceDB embeddings: {lance_count}")
    
    if args.dry_run:
        print(f"\n[DRY RUN] Would process {len(txt_files)} text files")
        print("\nFirst 10 files:")
        for f in txt_files[:10]:
            print(f"  {f.name}")
        if len(txt_files) > 10:
            print(f"  ... and {len(txt_files) - 10} more")
        sys.exit(0)
    
    # Confirm before proceeding
    print(f"\nThis will re-process {len(txt_files)} text files to regenerate vector embeddings.")
    response = input("Continue? [y/N]: ")
    if response.lower() != 'y':
        print("Aborted.")
        sys.exit(0)
    
    # Process files in batches
    async def process_all():
        total = len(txt_files)
        processed = 0
        errors = []
        
        for i, txt_file in enumerate(txt_files, 1):
            try:
                content = txt_file.read_text(encoding='utf-8')
                print(f"[{i}/{total}] Adding {txt_file.name}...")
                await add_file_content(content, txt_file.name)
                processed += 1
                
                # Run cognify after each batch
                if i % args.batch_size == 0 or i == total:
                    print(f"  Running cognify on batch...")
                    await batch_cognify()
                    
            except Exception as e:
                errors.append((txt_file.name, str(e)))
                print(f"  ERROR: {e}")
        
        return processed, errors
    
    print("\nStarting recovery...")
    processed, errors = asyncio.run(process_all())
    
    # Final status
    print(f"\n{'='*60}")
    print("Recovery complete!")
    print(f"  Files processed: {processed}/{len(txt_files)}")
    if errors:
        print(f"  Errors: {len(errors)}")
        for name, err in errors[:5]:
            print(f"    - {name}: {err}")
    
    # Get updated counts
    print("\nUpdated database status:")
    sqlite_count_new, lance_count_new = get_current_counts(workspace_path)
    print(f"  SQLite entries: {sqlite_count_new} (was {sqlite_count})")
    print(f"  LanceDB embeddings: {lance_count_new} (was {lance_count})")
    
    if lance_count_new > lance_count:
        print(f"\n✅ Successfully recovered {lance_count_new - lance_count} vector embeddings!")
    else:
        print("\n⚠️  No new embeddings were created. The files may already be indexed.")


if __name__ == '__main__':
    main()
