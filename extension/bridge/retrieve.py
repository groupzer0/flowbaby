#!/usr/bin/env python3
"""
Cognee Context Retrieval Script for VS Code Extension

Usage: python retrieve.py <workspace_path> <query> [max_results] [max_tokens] [recency_weight] [importance_weight]

Retrieves relevant context from Cognee using hybrid graph-vector search with workspace isolation:
1. Loads API key from workspace .env
2. Generates unique dataset name for workspace
3. Executes GRAPH_COMPLETION search filtered to workspace dataset
4. Calculates weighted scores combining base relevance, recency, and importance
5. Returns top results respecting max_results AND max_tokens limits

Returns JSON to stdout:
  Success: {"success": true, "results": [...], "result_count": 2, "total_tokens": 487}
  Failure: {"success": false, "error": "error message"}
"""

import asyncio
import hashlib
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path


def calculate_recency_score(timestamp_str: str) -> float:
    """
    Calculate recency score based on age of conversation.
    Linear decay over 30 days: max(0, 1 - (age_days / 30))
    
    Args:
        timestamp_str: ISO 8601 timestamp string
        
    Returns:
        Recency score 0-1 (1 = very recent, 0 = old)
    """
    try:
        timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
        age = datetime.now() - timestamp.replace(tzinfo=None)
        age_days = age.total_seconds() / 86400  # Convert to days
        
        # Linear decay over 30 days
        recency_score = max(0.0, 1.0 - (age_days / 30.0))
        return recency_score
    except Exception:
        # If timestamp parsing fails, return middle value
        return 0.5


def estimate_tokens(text: str) -> int:
    """
    Estimate token count using rough word-based approximation.
    
    Args:
        text: Text to estimate tokens for
        
    Returns:
        Estimated token count
    """
    # Simple word-based estimate (actual tokenization varies by model)
    return len(text.split())


async def retrieve_context(
    workspace_path: str,
    query: str,
    max_results: int = 3,
    max_tokens: int = 2000,
    recency_weight: float = 0.3,
    importance_weight: float = 0.2
) -> dict:
    """
    Retrieve relevant context from Cognee with hybrid search, dataset isolation, and custom scoring.
    
    Args:
        workspace_path: Absolute path to VS Code workspace root
        query: User's search query
        max_results: Maximum number of results (default 3)
        max_tokens: Token budget limit (default 2000)
        recency_weight: Weight for recency scoring 0-1 (default 0.3)
        importance_weight: Weight for importance scoring 0-1 (default 0.2)
        
    Returns:
        Dictionary with success status, results array, result_count, total_tokens, or error
    """
    try:
        # Load workspace .env file
        workspace_dir = Path(workspace_path)
        env_file = workspace_dir / '.env'
        
        if env_file.exists():
            from dotenv import load_dotenv
            load_dotenv(env_file)
        
        # Check for API key
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            return {
                'success': False,
                'error': 'OPENAI_API_KEY not found in environment or .env file'
            }
        
        # Import cognee
        import cognee
        from cognee.modules.search.types import SearchType
        
        # Configure Cognee with API key
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
        
        # 1. Generate same unique dataset name as init.py and ingest.py
        workspace_path_str = str(workspace_dir.absolute())
        dataset_hash = hashlib.sha1(workspace_path_str.encode()).hexdigest()[:16]
        dataset_name = f"ws_{dataset_hash}"
        
        # 2. Search within this workspace's dataset only
        search_results = await cognee.search(
            query_type=SearchType.GRAPH_COMPLETION,
            query_text=query,
            datasets=[dataset_name],  # Filter to this workspace only
            top_k=max_results
        )
        
        # This ensures search results only contain data from this workspace,
        # not from other workspaces or tutorial data.
        
        # If no results, return empty
        if not search_results:
            return {
                'success': True,
                'results': [],
                'result_count': 0,
                'total_tokens': 0
            }
        
        # Process results - convert SearchResult objects to dicts
        processed_results = []
        total_tokens = 0
        
        for idx, result in enumerate(search_results):
            # Stop at max_results
            if idx >= max_results:
                break
            
            # Extract text from SearchResult (result is tuple of (text, metadata))
            if isinstance(result, tuple):
                text = str(result[0]) if len(result) > 0 else ""
            else:
                # Fallback: try to access as object
                text = str(getattr(result, 'text', str(result)))
            
            # Extract timestamp and importance from embedded metadata in text
            timestamp_match = re.search(r'\[Timestamp: ([^\]]+)\]', text)
            importance_match = re.search(r'\[Importance: ([^\]]+)\]', text)
            
            timestamp = timestamp_match.group(1) if timestamp_match else None
            importance = float(importance_match.group(1)) if importance_match else 0.0
            
            # Calculate scores
            recency_score = calculate_recency_score(timestamp) if timestamp else 0.5
            base_score = 0.7  # Default base score since Cognee already ranked these
            
            # Calculate weighted final score
            base_weight = 1.0 - recency_weight - importance_weight
            final_score = (
                base_score * base_weight +
                recency_score * recency_weight +
                importance * importance_weight
            )
            
            # Estimate tokens
            result_tokens = estimate_tokens(text)
            
            # Check token limit
            if total_tokens + result_tokens > max_tokens and len(processed_results) > 0:
                break
            
            processed_results.append({
                'text': text,
                'score': round(final_score, 3),
                'recency_score': round(recency_score, 3),
                'importance_score': round(importance, 3),
                'tokens': result_tokens
            })
            
            total_tokens += result_tokens
        
        return {
            'success': True,
            'results': processed_results,
            'result_count': len(processed_results),
            'total_tokens': total_tokens
        }
        
    except ImportError as e:
        return {
            'success': False,
            'error': f'Failed to import required module: {str(e)}'
        }
    except Exception as e:
        return {
            'success': False,
            'error': f'Retrieval failed: {str(e)}'
        }


def main():
    """Main entry point for the script."""
    # Check command-line arguments (minimum 2 required)
    if len(sys.argv) < 3:
        result = {
            'success': False,
            'error': 'Missing required arguments: workspace_path, query'
        }
        print(json.dumps(result))
        sys.exit(1)
    
    workspace_path = sys.argv[1]
    query = sys.argv[2]
    
    # Optional parameters with defaults
    max_results = 3
    max_tokens = 2000
    recency_weight = 0.3
    importance_weight = 0.2
    
    # Parse optional arguments
    if len(sys.argv) >= 4:
        try:
            max_results = int(sys.argv[3])
        except ValueError:
            result = {
                'success': False,
                'error': f'Invalid max_results: {sys.argv[3]} (must be integer)'
            }
            print(json.dumps(result))
            sys.exit(1)
    
    if len(sys.argv) >= 5:
        try:
            max_tokens = int(sys.argv[4])
        except ValueError:
            result = {
                'success': False,
                'error': f'Invalid max_tokens: {sys.argv[4]} (must be integer)'
            }
            print(json.dumps(result))
            sys.exit(1)
    
    if len(sys.argv) >= 6:
        try:
            recency_weight = float(sys.argv[5])
            recency_weight = max(0.0, min(1.0, recency_weight))
        except ValueError:
            result = {
                'success': False,
                'error': f'Invalid recency_weight: {sys.argv[5]} (must be float 0-1)'
            }
            print(json.dumps(result))
            sys.exit(1)
    
    if len(sys.argv) >= 7:
        try:
            importance_weight = float(sys.argv[6])
            importance_weight = max(0.0, min(1.0, importance_weight))
        except ValueError:
            result = {
                'success': False,
                'error': f'Invalid importance_weight: {sys.argv[6]} (must be float 0-1)'
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
    
    # Run retrieval
    result = asyncio.run(retrieve_context(
        workspace_path,
        query,
        max_results,
        max_tokens,
        recency_weight,
        importance_weight
    ))
    
    # Output JSON result
    print(json.dumps(result))
    
    # Exit with appropriate code
    sys.exit(0 if result['success'] else 1)


if __name__ == '__main__':
    main()
