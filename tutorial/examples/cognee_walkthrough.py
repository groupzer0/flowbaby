#!/usr/bin/env python3
"""
Cognee Walkthrough Example Script

Demonstrates complete Cognee workflow:
1. Environment setup and data preparation
2. Knowledge graph construction with ontology
3. HTML visualization generation
4. Cross-document search and feedback
"""

import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

# Add parent directory to path to import utils
sys.path.insert(0, str(Path(__file__).parent.parent))

from utils.asset_helpers import (
    create_notebook_artifacts_directory,
    download_remote_assets,
    preview_downloaded_assets
)


async def setup_environment() -> tuple[Path, str]:
    """
    Load environment variables, validate API key, create artifacts directory.
    
    Returns:
        Tuple of (artifacts_dir, api_key)
    """
    print("=" * 60)
    print("SETUP ENVIRONMENT")
    print("=" * 60)
    
    # Load .env file
    load_dotenv()
    
    # Validate API key
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key or api_key == "your_openai_api_key_here":
        print("✗ ERROR: OPENAI_API_KEY not configured")
        print("Please set your OpenAI API key in .env file")
        sys.exit(1)
    
    print("✓ Environment variables loaded")
    print("✓ OPENAI_API_KEY validated")
    
    # Configure Cognee with the API key
    import cognee
    cognee.config.set_llm_api_key(api_key)
    cognee.config.set_llm_provider("openai")
    print("✓ Cognee configured with OpenAI")
    
    # Create artifacts directory
    artifacts_dir = create_notebook_artifacts_directory()
    print(f"✓ Artifacts directory ready: {artifacts_dir}")
    
    return artifacts_dir, api_key


def get_timestamp() -> str:
    """
    Generate timestamp string for artifact naming.
    
    Returns:
        Timestamp in format YYYYMMDD_HHMMSS
    """
    return datetime.now().strftime("%Y%m%d_%H%M%S")


async def prepare_data() -> dict:
    """
    Load developer intro text and download remote assets.
    
    Returns:
        Dictionary with paths to all data files
    """
    print("\n" + "=" * 60)
    print("PREPARE DATA")
    print("=" * 60)
    
    # Load developer intro (relative to tutorial directory)
    script_dir = Path(__file__).parent.parent  # tutorial/
    developer_intro_path = script_dir / "data/sample/developer_intro.txt"
    developer_intro = developer_intro_path.read_text()
    print(f"✓ Loaded developer intro from {developer_intro_path}")
    
    # Download remote assets
    print("\nDownloading remote assets...")
    asset_paths = download_remote_assets(force_download=False)
    print("✓ All assets ready")
    
    # Preview downloaded assets
    preview_downloaded_assets(asset_paths)
    
    return {
        "developer_intro": developer_intro,
        "developer_intro_path": developer_intro_path,
        **asset_paths
    }


async def reset_memory():
    """
    Clear Cognee data and system metadata.
    """
    print("\n" + "=" * 60)
    print("RESET MEMORY")
    print("=" * 60)
    
    try:
        import cognee
        await cognee.prune.prune_data()
        await cognee.prune.prune_system()
        print("✓ Cognee memory cleared")
    except Exception as e:
        print(f"⚠ Warning: Failed to reset memory: {e}")
        print("  Continuing with existing state...")


async def ingest_data(data: dict):
    """
    Add data to respective Cognee nodesets.
    
    Args:
        data: Dictionary containing paths to data files and content
    """
    print("\n" + "=" * 60)
    print("INGEST DATA")
    print("=" * 60)
    
    try:
        import cognee
        
        # Ingest developer intro
        print("Ingesting developer intro...")
        await cognee.add(data["developer_intro"], "developer_context")
        print("✓ Developer intro ingested into 'developer_context' nodeset")
        
        # Ingest conversations
        print("Ingesting conversations...")
        conversations_text = data["conversations"].read_text()
        await cognee.add(conversations_text, "conversations_data")
        print("✓ Conversations ingested into 'conversations_data' nodeset")
        
        # Ingest principles
        print("Ingesting principles...")
        principles_text = data["principles"].read_text()
        await cognee.add(principles_text, "principles_data")
        print("✓ Principles ingested into 'principles_data' nodeset")
        
    except Exception as e:
        print(f"✗ ERROR during data ingestion: {e}")
        raise


async def build_knowledge_graph():
    """
    Set ONTOLOGY_FILE_PATH and call cognee.cognify().
    """
    print("\n" + "=" * 60)
    print("BUILD KNOWLEDGE GRAPH")
    print("=" * 60)
    
    try:
        import cognee
        
        # Set ontology path
        ontology_path = os.getenv("ONTOLOGY_FILE_PATH", "data/sample/ontology.json")
        os.environ["ONTOLOGY_FILE_PATH"] = ontology_path
        print(f"✓ Ontology path set: {ontology_path}")
        
        # Build knowledge graph
        print("Running cognee.cognify()...")
        graph = await cognee.cognify()
        
        if not graph or (hasattr(graph, '__len__') and len(graph) == 0):
            print("⚠ Warning: cognify() returned empty or invalid graph")
            print("  Continuing execution for debugging purposes...")
        else:
            print("✓ Knowledge graph built successfully")
        
        return graph
        
    except Exception as e:
        print(f"✗ ERROR building knowledge graph: {e}")
        raise


async def visualize_graph(stage: str, timestamp: str, artifacts_dir: Path):
    """
    Generate timestamped HTML visualization file.
    
    Args:
        stage: Stage name ("initial", "enhanced", or "final")
        timestamp: Timestamp string for filename
        artifacts_dir: Path to artifacts directory
    """
    print(f"\nGenerating {stage} visualization...")
    
    try:
        from cognee.api.v1.visualize import visualize_graph as viz
        
        # Generate filename
        filename = f"graph_{stage}_{timestamp}.html"
        filepath = artifacts_dir / filename
        
        # Generate visualization
        await viz(str(filepath))
        print(f"✓ Visualization saved: {filepath}")
        
    except Exception as e:
        print(f"⚠ Warning: Failed to generate {stage} visualization: {e}")
        print("  Continuing execution...")


async def enhance_memory():
    """
    Call cognee.memify() to add semantic connections.
    """
    print("\n" + "=" * 60)
    print("ENHANCE MEMORY")
    print("=" * 60)
    
    try:
        import cognee
        
        print("Running cognee.memify()...")
        result = await cognee.memify()
        
        if not result or (hasattr(result, '__len__') and len(result) == 0):
            print("⚠ Warning: memify() returned empty or invalid result")
            print("  Continuing execution for debugging purposes...")
        else:
            print("✓ Semantic connections added successfully")
        
        return result
        
    except Exception as e:
        print(f"✗ ERROR enhancing memory: {e}")
        raise


async def search_cross_document():
    """
    Execute cross-document GRAPH_COMPLETION search.
    """
    print("\n" + "=" * 60)
    print("CROSS-DOCUMENT SEARCH")
    print("=" * 60)
    
    try:
        import cognee
        from cognee.modules.search.types import SearchType
        
        query = "What are the key principles for building production APIs?"
        print(f"Query: {query}")
        
        results = await cognee.search(query, query_type=SearchType.GRAPH_COMPLETION)
        
        print(f"\nResults ({len(results)} items):")
        for i, result in enumerate(results[:3], 1):  # Show first 3
            print(f"  {i}. {result}")
        
        if len(results) > 3:
            print(f"  ... and {len(results) - 3} more results")
        
        print("✓ Cross-document search completed")
        return results
        
    except Exception as e:
        print(f"✗ ERROR during search: {e}")
        raise


async def search_filtered():
    """
    Execute NodeSet-filtered search on principles_data.
    """
    print("\n" + "=" * 60)
    print("FILTERED SEARCH")
    print("=" * 60)
    
    try:
        import cognee
        from cognee.modules.search.types import SearchType
        
        query = "What does the Zen of Python say about simplicity?"
        print(f"Query: {query}")
        print(f"Filter: principles_data nodeset")
        
        results = await cognee.search(query, query_type=SearchType.GRAPH_COMPLETION, datasets=["principles_data"])
        
        print(f"\nResults ({len(results)} items):")
        for i, result in enumerate(results[:3], 1):  # Show first 3
            print(f"  {i}. {result}")
        
        if len(results) > 3:
            print(f"  ... and {len(results) - 3} more results")
        
        print("✓ Filtered search completed")
        return results
        
    except Exception as e:
        print(f"✗ ERROR during filtered search: {e}")
        raise


async def provide_feedback():
    """
    Execute search with save_interaction=True, then provide feedback.
    """
    print("\n" + "=" * 60)
    print("PROVIDE FEEDBACK")
    print("=" * 60)
    
    try:
        import cognee
        from cognee.modules.search.types import SearchType
        
        # Search with interaction saving
        query = "How should I structure async/await code?"
        print(f"Query: {query}")
        print("Saving interaction...")
        
        results = await cognee.search(query, query_type=SearchType.GRAPH_COMPLETION, save_interaction=True)
        print(f"✓ Search completed ({len(results)} results)")
        
        # Provide feedback
        feedback_query = "FEEDBACK: This answer helped me understand async patterns"
        print(f"\nFeedback: {feedback_query}")
        
        feedback_result = await cognee.search(feedback_query, query_type=SearchType.FEEDBACK)
        print("✓ Feedback submitted successfully")
        
        return feedback_result
        
    except Exception as e:
        print(f"✗ ERROR during feedback: {e}")
        raise


async def main():
    """
    Main orchestration function.
    """
    start_time = datetime.now()
    
    try:
        # Setup
        stage_start = datetime.now()
        artifacts_dir, api_key = await setup_environment()
        print(f"Stage duration: {(datetime.now() - stage_start).total_seconds():.2f}s")
        
        # Generate single timestamp for all artifacts
        timestamp = get_timestamp()
        print(f"\n✓ Run timestamp: {timestamp}")
        
        # Data preparation
        stage_start = datetime.now()
        data = await prepare_data()
        print(f"Stage duration: {(datetime.now() - stage_start).total_seconds():.2f}s")
        
        # Reset memory
        stage_start = datetime.now()
        await reset_memory()
        print(f"Stage duration: {(datetime.now() - stage_start).total_seconds():.2f}s")
        
        # Ingest data
        stage_start = datetime.now()
        await ingest_data(data)
        print(f"Stage duration: {(datetime.now() - stage_start).total_seconds():.2f}s")
        
        # Build knowledge graph
        stage_start = datetime.now()
        await build_knowledge_graph()
        print(f"Stage duration: {(datetime.now() - stage_start).total_seconds():.2f}s")
        
        # Visualize initial graph
        stage_start = datetime.now()
        await visualize_graph("initial", timestamp, artifacts_dir)
        print(f"Stage duration: {(datetime.now() - stage_start).total_seconds():.2f}s")
        
        # Enhance memory
        stage_start = datetime.now()
        await enhance_memory()
        print(f"Stage duration: {(datetime.now() - stage_start).total_seconds():.2f}s")
        
        # Visualize enhanced graph
        stage_start = datetime.now()
        await visualize_graph("enhanced", timestamp, artifacts_dir)
        print(f"Stage duration: {(datetime.now() - stage_start).total_seconds():.2f}s")
        
        # Cross-document search
        stage_start = datetime.now()
        await search_cross_document()
        print(f"Stage duration: {(datetime.now() - stage_start).total_seconds():.2f}s")
        
        # Filtered search
        stage_start = datetime.now()
        await search_filtered()
        print(f"Stage duration: {(datetime.now() - stage_start).total_seconds():.2f}s")
        
        # Feedback
        stage_start = datetime.now()
        await provide_feedback()
        print(f"Stage duration: {(datetime.now() - stage_start).total_seconds():.2f}s")
        
        # Visualize final graph
        stage_start = datetime.now()
        await visualize_graph("final", timestamp, artifacts_dir)
        print(f"Stage duration: {(datetime.now() - stage_start).total_seconds():.2f}s")
        
        # Summary
        total_duration = (datetime.now() - start_time).total_seconds()
        print("\n" + "=" * 60)
        print("EXECUTION COMPLETE")
        print("=" * 60)
        print(f"\nTotal elapsed time: {total_duration:.2f} seconds ({total_duration/60:.2f} minutes)")
        print(f"\nGenerated artifacts:")
        print(f"  - {artifacts_dir}/graph_initial_{timestamp}.html")
        print(f"  - {artifacts_dir}/graph_enhanced_{timestamp}.html")
        print(f"  - {artifacts_dir}/graph_final_{timestamp}.html")
        print("\n✓ All steps completed successfully!")
        
    except KeyboardInterrupt:
        print("\n\n✗ Execution interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n✗ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
