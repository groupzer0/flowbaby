#!/usr/bin/env python3
"""
Flowbaby Memory Listing Script

Usage: python list_memories.py <workspace_path> [limit]

Retrieves a list of recent memories (summaries, decisions) for display.
Uses a broad search query to fetch relevant nodes.

Returns JSON to stdout:
    Success: {"success": true, "memories": [{"id": "...", "topic": "...", "date": "...", "status": "..."}, ...]}
    Failure: {"success": false, "error": "..."}
"""

import asyncio
import json
import os
import re
import sys
from pathlib import Path

# Add bridge directory to path to import bridge_logger
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import bridge_logger
from workspace_utils import canonicalize_workspace_path, generate_dataset_name


# Reuse parsing logic from retrieve.py (simplified)
def parse_metadata(text):
    topic = re.search(r'^# Conversation Summary:\s*(.+)$', text, re.MULTILINE)
    status = re.search(r'-\s*Status:\s*(Active|Superseded|DecisionRecord|Draft|N/A)', text)
    created = re.search(r'-\s*Created:\s*([\dT:\-.+Z]+|N/A)', text)

    return {
        "topic": topic.group(1).strip() if topic else "Untitled Memory",
        "status": status.group(1).strip() if status else "N/A",
        "date": created.group(1).strip() if created else "N/A"
    }

async def list_memories(workspace_path: str, limit: int = 10) -> dict:
    # Initialize logger
    logger = bridge_logger.setup_logging(workspace_path, "list_memories")
    logger.info(f"Listing memories for workspace: {workspace_path}, limit={limit}")

    try:
        workspace_dir = Path(workspace_path)

        # Plan 083 M5: v0.7.0 is Cloud-only. Only AWS credentials are supported.
        aws_access_key = os.getenv('AWS_ACCESS_KEY_ID')
        if not aws_access_key:
            error_msg = "Cloud credentials not found. Please login to Flowbaby Cloud using the 'Flowbaby Cloud: Login' command."
            logger.error(error_msg)
            return {"success": False, "error_code": "NOT_AUTHENTICATED", "error": error_msg}

        # ============================================================================
        # PLAN 033 FIX: Set environment variables BEFORE importing cognee SDK
        # ============================================================================
        # CRITICAL: The Cognee SDK uses pydantic-settings with @lru_cache, which reads
        # environment variables at import time and caches them permanently.
        # ============================================================================

        # Calculate workspace-local storage paths
        system_root = str(workspace_dir / '.flowbaby/system')
        data_root = str(workspace_dir / '.flowbaby/data')

        # Create directories BEFORE setting env vars
        Path(system_root).mkdir(parents=True, exist_ok=True)
        Path(data_root).mkdir(parents=True, exist_ok=True)

        # Set environment variables BEFORE importing cognee
        os.environ['SYSTEM_ROOT_DIRECTORY'] = system_root
        os.environ['DATA_ROOT_DIRECTORY'] = data_root

        # NOW import cognee
        logger.debug("Importing cognee SDK")
        import cognee
        from cognee.modules.search.types import SearchType

        # Belt-and-suspenders: Also call config methods (redundant but safe)
        cognee.config.system_root_directory(system_root)
        cognee.config.data_root_directory(data_root)
        # Plan 083 M5: Cloud-only mode uses AWS credentials via Bedrock, no LLM API key needed

        dataset_name, _ = generate_dataset_name(workspace_path)
        logger.info(f"Using dataset: {dataset_name}")

        # Broad query to get recent items
        logger.info("Searching for recent memories")
        results = await cognee.search(
            query_type=SearchType.GRAPH_COMPLETION,
            query_text="list recent summaries and decisions",
            datasets=[dataset_name],
            top_k=limit
        )

        memories = []
        for i, res in enumerate(results):
            text = str(getattr(res, 'text', res))
            meta = parse_metadata(text)

            # Only include items that look like structured memories (have a topic)
            if meta["topic"] != "Untitled Memory":
                memories.append({
                    "id": str(i), # Placeholder ID since we don't have UUIDs easily
                    "topic": meta["topic"],
                    "status": meta["status"],
                    "date": meta["date"],
                    "preview": text[:100] + "..."
                })

        logger.info(f"Found {len(memories)} structured memories")

        return {
            "success": True,
            "memories": memories,
            "count": len(memories)
        }

    except Exception as e:
        error_msg = str(e)
        if logger: logger.error(f"List memories failed: {error_msg}")
        return {"success": False, "error": error_msg}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Missing workspace_path"}))
        sys.exit(1)

    workspace_path = sys.argv[1]
    try:
        workspace_path = canonicalize_workspace_path(workspace_path)
    except FileNotFoundError:
        print(json.dumps({"success": False, "error": f"Workspace path does not exist: {sys.argv[1]}"}))
        sys.exit(1)

    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10

    if not Path(workspace_path).is_dir():
        print(json.dumps({"success": False, "error": "Invalid workspace path"}))
        sys.exit(1)

    result = asyncio.run(list_memories(workspace_path, limit))
    print(json.dumps(result))
    sys.exit(0 if result["success"] else 1)

if __name__ == '__main__':
    main()
