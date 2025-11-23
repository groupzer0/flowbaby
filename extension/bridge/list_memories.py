#!/usr/bin/env python3
"""
RecallFlow Memory Listing Script

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
import sys
import re
from pathlib import Path
from workspace_utils import generate_dataset_name

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
    try:
        workspace_dir = Path(workspace_path)
        env_file = workspace_dir / '.env'
        
        if env_file.exists():
            from dotenv import load_dotenv
            load_dotenv(env_file)
        
        api_key = os.getenv('LLM_API_KEY')
        if not api_key:
            return {"success": False, "error": "LLM_API_KEY missing"}

        import cognee
        from cognee.modules.search.types import SearchType
        
        cognee.config.system_root_directory(str(workspace_dir / '.cognee_system'))
        cognee.config.data_root_directory(str(workspace_dir / '.cognee_data'))
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
        
        dataset_name, _ = generate_dataset_name(workspace_path)
        
        # Broad query to get recent items
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
        
        return {
            "success": True,
            "memories": memories,
            "count": len(memories)
        }

    except Exception as e:
        return {"success": False, "error": str(e)}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Missing workspace_path"}))
        sys.exit(1)
        
    workspace_path = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    
    if not Path(workspace_path).is_dir():
        print(json.dumps({"success": False, "error": "Invalid workspace path"}))
        sys.exit(1)
        
    result = asyncio.run(list_memories(workspace_path, limit))
    print(json.dumps(result))
    sys.exit(0 if result["success"] else 1)

if __name__ == '__main__':
    main()
