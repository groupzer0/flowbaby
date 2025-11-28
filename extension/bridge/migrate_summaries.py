#!/usr/bin/env python3
"""
Cognee Summary Migration Script (Plan 018)

Usage: python migrate_summaries.py <workspace_path>

Migrates existing Plan 014 summaries to the new v1.1 metadata schema:
1. Acquires maintenance lock to pause background ingestion.
2. Searches for existing summaries.
3. Parses them and adds missing metadata (topic_id, status, source_created_at).
4. Re-ingests them synchronously.
5. Releases lock.
"""

import asyncio
import os
import re
import sys
import uuid
from datetime import datetime
from pathlib import Path

# Import helper functions from sibling scripts
# We need to add the current directory to sys.path to import from siblings if run directly
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from ingest import create_summary_text, setup_environment
    from retrieve import parse_enriched_summary
except ImportError:
    # Fallback if running from different CWD
    sys.path.append(str(Path(__file__).parent))
    from ingest import create_summary_text, setup_environment
    from retrieve import parse_enriched_summary


MAINTENANCE_LOCK_FILE = '.flowbaby/maintenance.lock'
MIGRATION_LOG_FILE = '.flowbaby/maintenance/migration.log'


def acquire_lock(workspace_dir: Path) -> bool:
    """Create lock file to pause background operations."""
    lock_path = workspace_dir / MAINTENANCE_LOCK_FILE
    if lock_path.exists():
        return False

    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, 'w') as f:
        f.write(datetime.now().isoformat())
    return True


def release_lock(workspace_dir: Path):
    """Remove lock file."""
    lock_path = workspace_dir / MAINTENANCE_LOCK_FILE
    if lock_path.exists():
        lock_path.unlink()


def log_migration(workspace_dir: Path, message: str):
    """Append message to migration log."""
    log_path = workspace_dir / MIGRATION_LOG_FILE
    log_path.parent.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().isoformat()
    with open(log_path, 'a') as f:
        f.write(f"[{timestamp}] {message}\n")
    print(f"[MIGRATION] {message}", file=sys.stderr)


async def migrate_summaries(workspace_path: str):
    workspace_dir = Path(workspace_path)

    if not acquire_lock(workspace_dir):
        print(f"[ERROR] Could not acquire maintenance lock at {workspace_dir / MAINTENANCE_LOCK_FILE}. Is another operation running?", file=sys.stderr)
        sys.exit(1)

    try:
        log_migration(workspace_dir, "Starting migration of summaries to v1.1 schema")

        # Setup environment
        dataset_name, api_key, cognee_config = setup_environment(workspace_path)

        # Import cognee
        import cognee
        from cognee.modules.search.types import SearchType

        cognee.config.system_root_directory(cognee_config['system_root'])
        cognee.config.data_root_directory(cognee_config['data_root'])
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')

        # Search for existing summaries
        # We look for "Conversation Summary" which is in the header of v1.0 and v1.1 templates
        log_migration(workspace_dir, "Searching for existing summaries...")

        search_results = await cognee.search(
            query_type=SearchType.GRAPH_COMPLETION,
            query_text="Conversation Summary",
            datasets=[dataset_name],
            top_k=100  # Reasonable limit for now
        )

        summaries_to_migrate = []

        for result in search_results:
            text = str(getattr(result, 'text', result))

            # Check if it's a summary
            if "# Conversation Summary:" not in text:
                continue

            # Check if already v1.1 (has Metadata block with Source Created)
            if "**Metadata:**" in text and "- Source Created:" in text:
                continue

            # Parse existing content
            parsed = parse_enriched_summary(text)
            if not parsed:
                # Try to parse legacy v1.0 format if parse_enriched_summary fails (it expects Metadata block)
                # If parse_enriched_summary returns None, it means no metadata block.
                # We need to extract content manually if it's a legacy summary.
                # Assuming legacy summary has similar sections but no metadata block.

                # Simple extraction for legacy
                topic_match = re.search(r'# Conversation Summary:\s*(.+)$', text, re.MULTILINE)
                topic = topic_match.group(1).strip() if topic_match else "Untitled Summary"

                # We can reuse parse_enriched_summary logic for sections if we mock the metadata block check?
                # No, parse_enriched_summary returns None immediately if no metadata block.
                # Let's just use regexes directly here for legacy.

                def _section(pattern, text_content=text):
                    match = re.search(pattern, text_content)
                    return match.group(1).strip() if match else ""

                context = _section(r'## Context\n([\s\S]+?)(?=\n##|$)')

                # Helper to parse lists
                def _list(pattern):
                    content = _section(pattern)
                    if not content:
                        return []
                    return [line.strip('- ').strip() for line in content.split('\n') if line.strip() and line.strip() != '(none)']

                decisions = _list(r'## Key Decisions\n([\s\S]+?)(?=\n##|$)')
                rationale = _list(r'## Rationale\n([\s\S]+?)(?=\n##|$)')
                open_questions = _list(r'## Open Questions\n([\s\S]+?)(?=\n##|$)')
                next_steps = _list(r'## Next Steps\n([\s\S]+?)(?=\n##|$)')
                references = _list(r'## References\n([\s\S]+?)(?=\n##|$)')
                time_scope = _section(r'## Time Scope\n([\s\S]+?)(?=\n##|$)')

                parsed = {
                    'topic': topic,
                    'context': context,
                    'decisions': decisions,
                    'rationale': rationale,
                    'openQuestions': open_questions,
                    'nextSteps': next_steps,
                    'references': references,
                    'timeScope': time_scope,
                    'createdAt': datetime.now().isoformat(), # Fallback
                    'updatedAt': datetime.now().isoformat()
                }
            else:
                # It has metadata but maybe missing new fields?
                # Map parsed keys to create_summary_text keys (camelCase)
                parsed['openQuestions'] = parsed.pop('open_questions', [])
                parsed['nextSteps'] = parsed.pop('next_steps', [])
                parsed['timeScope'] = parsed.pop('time_scope', '')
                parsed['topicId'] = parsed.pop('topic_id', None)
                parsed['sessionId'] = parsed.pop('session_id', None)
                parsed['planId'] = parsed.pop('plan_id', None)
                parsed['createdAt'] = parsed.pop('created_at', datetime.now().isoformat())
                parsed['updatedAt'] = datetime.now().isoformat() # Update modification time

            # Enrich with new metadata
            if not parsed.get('topicId'):
                parsed['topicId'] = str(uuid.uuid5(uuid.NAMESPACE_DNS, parsed['topic']))

            if not parsed.get('status'):
                parsed['status'] = 'Active'

            if not parsed.get('sourceCreatedAt'):
                # Try to find timestamp in text if legacy
                # Legacy might have "Time Scope: ... Nov 17 ..."
                # Or we just use createdAt if available, or current time.
                # For migration, we set sourceCreatedAt = createdAt (best effort)
                parsed['sourceCreatedAt'] = parsed.get('createdAt')

            summaries_to_migrate.append(parsed)

        log_migration(workspace_dir, f"Found {len(summaries_to_migrate)} summaries to migrate.")

        if not summaries_to_migrate:
            log_migration(workspace_dir, "No summaries need migration.")
            return

        # Re-ingest
        new_texts = []
        for summary in summaries_to_migrate:
            text, _ = create_summary_text(summary)
            new_texts.append(text)

        log_migration(workspace_dir, f"Ingesting {len(new_texts)} migrated summaries...")

        await cognee.add(
            data=new_texts,
            dataset_name=dataset_name
        )

        log_migration(workspace_dir, "Running cognify...")
        await cognee.cognify(datasets=[dataset_name])

        log_migration(workspace_dir, "Migration completed successfully.")

    except Exception as e:
        import traceback
        log_migration(workspace_dir, f"Migration failed: {str(e)}")
        log_migration(workspace_dir, traceback.format_exc())
        sys.exit(1)
    finally:
        release_lock(workspace_dir)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python migrate_summaries.py <workspace_path>")
        sys.exit(1)

    workspace_path = sys.argv[1]
    if not Path(workspace_path).is_dir():
        print(f"Error: Workspace path does not exist: {workspace_path}")
        sys.exit(1)

    asyncio.run(migrate_summaries(workspace_path))
