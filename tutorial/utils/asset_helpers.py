"""Asset helper functions for downloading and managing sample data files."""

import json
from pathlib import Path
from typing import Dict
import requests


def create_notebook_artifacts_directory() -> Path:
    """
    Creates artifacts/ directory if it doesn't exist.
    
    Returns:
        Path object pointing to the artifacts directory
    """
    # Get tutorial directory (parent of utils/)
    tutorial_dir = Path(__file__).parent.parent
    artifacts_dir = tutorial_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    return artifacts_dir


def download_remote_assets(force_download: bool = False) -> Dict[str, Path]:
    """
    Creates sample data files for the Cognee walkthrough.
    
    Creates:
    - human_agent_conversations.json - Sample conversation data
    - python_zen_principles.md - Python Zen principles
    - ontology.json - Custom ontology for knowledge graph
    
    Args:
        force_download: If True, recreates files even if they exist locally
        
    Returns:
        Dictionary mapping asset names to file paths
    """
    # Get tutorial directory (parent of utils/)
    tutorial_dir = Path(__file__).parent.parent
    
    assets = {
        "conversations": tutorial_dir / "data/sample/human_agent_conversations.json",
        "principles": tutorial_dir / "data/sample/python_zen_principles.md",
        "ontology": tutorial_dir / "data/sample/ontology.json"
    }
    
    
    created_paths = {}
    
    # Ensure directory exists
    assets["conversations"].parent.mkdir(parents=True, exist_ok=True)
    
    # Create conversations file
    conversations_path = assets["conversations"]
    if not conversations_path.exists() or force_download:
        conversations_data = [
            {
                "role": "user",
                "content": "Can you explain how to use FastAPI for building production APIs?"
            },
            {
                "role": "assistant",
                "content": "FastAPI is a modern Python web framework that's great for building production APIs. It uses type hints for automatic validation and documentation."
            },
            {
                "role": "user",
                "content": "What about async/await patterns? How should I structure async code?"
            },
            {
                "role": "assistant",
                "content": "For async code, use async/await consistently. Avoid mixing sync and async code. Use aiohttp for HTTP clients and ensure all I/O operations are async."
            },
            {
                "role": "user",
                "content": "What testing frameworks work best with async code?"
            },
            {
                "role": "assistant",
                "content": "pytest-asyncio is the standard for testing async Python code. It allows you to write async test functions and properly handles event loops."
            }
        ]
        conversations_path.write_text(json.dumps(conversations_data, indent=2), encoding='utf-8')
        print(f"✓ Created {conversations_path}")
    else:
        print(f"✓ {conversations_path} already exists")
    created_paths["conversations"] = conversations_path
    
    # Create principles file
    principles_path = assets["principles"]
    if not principles_path.exists() or force_download:
        principles_content = """# The Zen of Python (PEP 20)

**Licensed under the Python Software Foundation License**

Beautiful is better than ugly.
Explicit is better than implicit.
Simple is better than complex.
Complex is better than complicated.
Flat is better than nested.
Sparse is better than dense.
Readability counts.
Special cases aren't special enough to break the rules.
Although practicality beats purity.
Errors should never pass silently.
Unless explicitly silenced.
In the face of ambiguity, refuse the temptation to guess.
There should be one-- and preferably only one --obvious way to do it.
Although that way may not be obvious at first unless you're Dutch.
Now is better than never.
Although never is often better than *right* now.
If the implementation is hard to explain, it's a bad idea.
If the implementation is easy to explain, it may be a good idea.
Namespaces are one honking great idea -- let's do more of those!
"""
        principles_path.write_text(principles_content, encoding='utf-8')
        print(f"✓ Created {principles_path}")
    else:
        print(f"✓ {principles_path} already exists")
    created_paths["principles"] = principles_path
    
    # Create ontology file
    ontology_path = assets["ontology"]
    if not ontology_path.exists() or force_download:
        ontology_data = {
            "entities": [
                {"name": "Developer", "type": "Person"},
                {"name": "API", "type": "Technology"},
                {"name": "Framework", "type": "Technology"},
                {"name": "Principle", "type": "Concept"},
                {"name": "Pattern", "type": "Concept"},
                {"name": "Tool", "type": "Technology"}
            ],
            "relationships": [
                {"source": "Developer", "target": "API", "type": "builds"},
                {"source": "Developer", "target": "Framework", "type": "uses"},
                {"source": "Developer", "target": "Principle", "type": "follows"},
                {"source": "API", "target": "Framework", "type": "builtWith"},
                {"source": "Framework", "target": "Pattern", "type": "implements"},
                {"source": "Principle", "target": "Pattern", "type": "guides"},
                {"source": "Developer", "target": "Tool", "type": "uses"},
                {"source": "Tool", "target": "API", "type": "tests"}
            ]
        }
        ontology_path.write_text(json.dumps(ontology_data, indent=2), encoding='utf-8')
        print(f"✓ Created {ontology_path}")
    else:
        print(f"✓ {ontology_path} already exists")
    created_paths["ontology"] = ontology_path
    
    return created_paths
def preview_downloaded_assets(asset_paths: Dict[str, Path]) -> None:
    """
    Prints structure and size information for downloaded files.
    
    Args:
        asset_paths: Dictionary mapping asset names to file paths
    """
    print("\n" + "=" * 60)
    print("DOWNLOADED ASSETS PREVIEW")
    print("=" * 60)
    
    for asset_name, file_path in asset_paths.items():
        if not file_path.exists():
            print(f"\n{asset_name}: FILE NOT FOUND")
            continue
        
        file_size = file_path.stat().st_size
        content = file_path.read_text(encoding='utf-8')
        preview = content[:200].replace('\n', ' ')
        
        print(f"\n{asset_name}:")
        print(f"  Path: {file_path}")
        print(f"  Size: {file_size:,} bytes")
        print(f"  Preview: {preview}...")
        
        # Show structure for JSON files
        if file_path.suffix == '.json':
            try:
                data = json.loads(content)
                if isinstance(data, list):
                    print(f"  Structure: Array with {len(data)} items")
                elif isinstance(data, dict):
                    print(f"  Structure: Object with keys: {', '.join(data.keys())}")
            except json.JSONDecodeError:
                print("  Structure: Invalid JSON")
    
    print("\n" + "=" * 60)
