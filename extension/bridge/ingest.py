#!/usr/bin/env python3
"""
Cognee Conversation Ingestion Script for VS Code Extension

Usage: python ingest.py <workspace_path> <user_message> <assistant_message> [importance]

Ingests a conversation pair into Cognee with workspace-specific dataset isolation:
1. Loads API key from workspace .env
2. Generates unique dataset name for workspace
3. Creates conversation with timestamp and importance
4. Adds to workspace-specific dataset with dataset_name parameter
5. Runs cognify() with ontology scoped to workspace dataset

Returns JSON to stdout:
  Success: {"success": true, "ingested_chars": 357, "timestamp": "2025-11-09T14:32:21.234Z"}
  Failure: {"success": false, "error": "error message"}
"""

import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from workspace_utils import generate_dataset_name


async def ingest_conversation(
    workspace_path: str,
    user_message: str,
    assistant_message: str,
    importance: float = 0.0
) -> dict:
    """
    Ingest a user/assistant conversation pair into Cognee with dataset isolation.
    
    Args:
        workspace_path: Absolute path to VS Code workspace root
        user_message: User's question or prompt
        assistant_message: Assistant's response
        importance: Importance score 0-1 (default 0.0)
        
    Returns:
        Dictionary with success status, ingested_chars, timestamp, or error
    """
    try:
        # Load workspace .env file
        workspace_dir = Path(workspace_path)
        env_file = workspace_dir / '.env'
        
        if env_file.exists():
            from dotenv import load_dotenv
            load_dotenv(env_file)
        
        # Check for API key
        api_key = os.getenv('LLM_API_KEY')
        if not api_key:
            return {
                'success': False,
                'error': 'LLM_API_KEY not found in environment or .env file. Set LLM_API_KEY="sk-..." in your workspace .env'
            }
        
        # Import cognee
        import cognee
        
        # Configure Cognee with API key
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
        
        # 1. Generate same unique dataset name as init.py (using canonical path)
        dataset_name, workspace_path_str = generate_dataset_name(workspace_path)
        
        # 2. Load ontology file path (OWL/Turtle format)
        ontology_path = Path(__file__).parent / 'ontology.ttl'
        
        # Validate ontology exists and is parseable
        ontology_valid = False
        if ontology_path.exists():
            try:
                # Validate RDFLib can parse the ontology
                from rdflib import Graph
                g = Graph()
                g.parse(str(ontology_path), format='turtle')
                ontology_valid = True
                # Log success for debugging
                print(f"Ontology loaded successfully: {ontology_path}", file=sys.stderr)
            except Exception as e:
                # Log warning but continue without ontology (graceful degradation)
                print(f"Warning: Ontology parse failed, proceeding without ontology grounding: {e}", file=sys.stderr)
                ontology_valid = False
        else:
            print(f"Warning: Ontology file not found at {ontology_path}, proceeding without ontology grounding", file=sys.stderr)
        
        # Generate timestamp
        timestamp = datetime.now().isoformat()
        
        # Format conversation with simplified conversational prose format
        # Analysis Finding 3: Natural language format works best for Cognee's LLM extraction
        # Avoid bracketed metadata like [Timestamp: ...] which dilutes extraction signals
        conversation = f"""User asked: {user_message}

Assistant answered: {assistant_message}

Metadata: timestamp={timestamp}, importance={importance}"""
        
        # 3. Add data to this workspace's dataset (Task 3: using correct parameter names)
        await cognee.add(
            data=[conversation],
            dataset_name=dataset_name
        )
        
        # 4. Cognify with datasets parameter (Task 3: correct parameter, no ontology_file_path kwarg)
        # Note: Ontology configuration should be set via .env (ontology_file_path=/path/to/file.ttl)
        await cognee.cognify(datasets=[dataset_name])
        
        # Note: This ensures the chat ontology is only applied to this workspace's data.
        # Tutorial data (with different dataset_name) remains separate and can use its own ontology.
        
        # Calculate total characters
        ingested_chars = len(conversation)
        
        return {
            'success': True,
            'ingested_chars': ingested_chars,
            'timestamp': timestamp
        }
        
    except ImportError as e:
        return {
            'success': False,
            'error': f'Failed to import required module: {str(e)}'
        }
    except Exception as e:
        # Task 5: Structured error logging with exception metadata
        error_details = {
            'exception_type': type(e).__name__,
            'exception_message': str(e),
            'dataset_name': dataset_name if 'dataset_name' in locals() else 'unknown',
            'conversation_length': len(conversation) if 'conversation' in locals() else 0,
            'ontology_validated': ontology_valid if 'ontology_valid' in locals() else False
        }
        print(f"Ingestion error details: {json.dumps(error_details, indent=2)}", file=sys.stderr)
        return {
            'success': False,
            'error': f'Ingestion failed ({type(e).__name__}): {str(e)}'
        }


def main():
    """Main entry point for the script."""
    # Check command-line arguments (minimum 3 required)
    if len(sys.argv) < 4:
        result = {
            'success': False,
            'error': 'Missing required arguments: workspace_path, user_message, assistant_message'
        }
        print(json.dumps(result))
        sys.exit(1)
    
    workspace_path = sys.argv[1]
    user_message = sys.argv[2]
    assistant_message = sys.argv[3]
    
    # Optional importance parameter (default 0.0)
    importance = 0.0
    if len(sys.argv) >= 5:
        try:
            importance = float(sys.argv[4])
            # Clamp to 0-1 range
            importance = max(0.0, min(1.0, importance))
        except ValueError:
            result = {
                'success': False,
                'error': f'Invalid importance value: {sys.argv[4]} (must be float 0-1)'
            }
            print(json.dumps(result))
            sys.exit(1)
    
    # Validate workspace path
    if not Path(workspace_path).is_dir():
        result = {
            'success': False,
            'error': f'Workspace path does not exist: {workspace_path}'
        }
        print(json.dumps(result))
        sys.exit(1)
    
    # Run ingestion
    result = asyncio.run(ingest_conversation(
        workspace_path,
        user_message,
        assistant_message,
        importance
    ))
    
    # Output JSON result
    print(json.dumps(result))
    
    # Exit with appropriate code
    sys.exit(0 if result['success'] else 1)


if __name__ == '__main__':
    main()
