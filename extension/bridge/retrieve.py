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
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from workspace_utils import generate_dataset_name


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


def parse_enriched_summary(text: str) -> dict:
    """
    Parse enriched text summary per §4.4.1 to extract structured metadata and content.
    
    Detects if text contains enriched summary format (<!-- Template: v1.0 --> + **Metadata:** block).
    Returns structured dict with metadata fields and content sections, or None for legacy raw text.
    
    Args:
        text: Raw text that may be enriched summary or legacy memory
        
    Returns:
        Dict with structured fields if enriched summary, None if legacy raw text
    """
    # Detect enriched text format per §4.4.1
    if '**Metadata:**' not in text:
        return None  # Legacy raw-text memory
    
    # Extract metadata fields using regex patterns from DATAPOINT_SCHEMA.md
    topic_match = re.search(r'^# Conversation Summary:\s*(.+)$', text, re.MULTILINE)
    topic_id_match = re.search(r'- Topic ID:\s*(N/A|[a-zA-Z0-9\-]+)', text)
    session_id_match = re.search(r'- Session ID:\s*(N/A|[a-zA-Z0-9\-]+)', text)
    plan_id_match = re.search(r'- Plan ID:\s*(N/A|[\w\-]+)', text)
    status_match = re.search(r'- Status:\s*(N/A|Active|Superseded|Draft)', text, re.IGNORECASE)
    created_at_match = re.search(r'- Created:\s*(N/A|[\d\-T:Z.]+)', text, re.IGNORECASE)
    updated_at_match = re.search(r'- Updated:\s*(N/A|[\d\-T:Z.]+)', text, re.IGNORECASE)
    
    # Extract content sections using deterministic headings per §4.4.1
    context_match = re.search(r'## Context\n([\s\S]+?)(?=\n##|$)', text)
    decisions_match = re.search(r'## Key Decisions\n([\s\S]+?)(?=\n##|$)', text)
    rationale_match = re.search(r'## Rationale\n([\s\S]+?)(?=\n##|$)', text)
    questions_match = re.search(r'## Open Questions\n([\s\S]+?)(?=\n##|$)', text)
    next_steps_match = re.search(r'## Next Steps\n([\s\S]+?)(?=\n##|$)', text)
    references_match = re.search(r'## References\n([\s\S]+?)(?=\n##|$)', text)
    time_scope_match = re.search(r'## Time Scope\n([\s\S]+?)(?=\n##|$)', text)
    
    def parse_list_section(content: str) -> list:
        """Parse list section with '- item' format, handle (none) marker."""
        if not content or content.strip() == '(none)':
            return []
        lines = [line.strip()[2:].strip() for line in content.strip().split('\n') if line.strip().startswith('- ')]
        return lines
    
    # Build structured result per RETRIEVE_CONTRACT.md
    # Use camelCase to match TypeScript RetrievalResult interface
    return {
        'summary_text': text,
        'topic': topic_match.group(1).strip() if topic_match else None,
        'topicId': topic_id_match.group(1) if topic_id_match and topic_id_match.group(1) != 'N/A' else None,
        'sessionId': session_id_match.group(1) if session_id_match and session_id_match.group(1) != 'N/A' else None,
        'planId': plan_id_match.group(1) if plan_id_match and plan_id_match.group(1) != 'N/A' else None,
        'status': status_match.group(1) if status_match and status_match.group(1) != 'N/A' else None,
        'createdAt': created_at_match.group(1) if created_at_match and created_at_match.group(1) != 'N/A' else None,
        'updatedAt': updated_at_match.group(1) if updated_at_match and updated_at_match.group(1) != 'N/A' else None,
        'context': context_match.group(1).strip() if context_match else None,
        'decisions': parse_list_section(decisions_match.group(1)) if decisions_match else [],
        'rationale': parse_list_section(rationale_match.group(1)) if rationale_match else [],
        'open_questions': parse_list_section(questions_match.group(1)) if questions_match else [],
        'next_steps': parse_list_section(next_steps_match.group(1)) if next_steps_match else [],
        'references': parse_list_section(references_match.group(1)) if references_match else [],
        'time_scope': time_scope_match.group(1).strip() if time_scope_match else None
    }


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
        print(f"[PROGRESS] Starting retrieval: query='{query[:50]}...', max_results={max_results}", file=sys.stderr, flush=True)
        
        # Load workspace .env file
        print("[PROGRESS] Loading .env file", file=sys.stderr, flush=True)
        workspace_dir = Path(workspace_path)
        env_file = workspace_dir / '.env'
        
        if env_file.exists():
            from dotenv import load_dotenv
            load_dotenv(env_file)
        
        # Check for API key
        api_key = os.getenv('LLM_API_KEY')
        if not api_key:
            error_payload = {
                'success': False,
                'error_code': 'LLM_API_ERROR',
                'error_type': 'MISSING_API_KEY',
                'message': 'LLM_API_KEY not found in .env file',
                'user_message': 'LLM_API_KEY not found. Please add it to your workspace .env file.',
                'remediation': 'Create .env in workspace root with: LLM_API_KEY=your_key_here',
                'error': 'LLM_API_KEY environment variable is required but not set'
            }
            print(f"[ERROR] {json.dumps(error_payload)}", file=sys.stderr)
            return error_payload
        
        # Import cognee
        print("[PROGRESS] Importing cognee SDK", file=sys.stderr, flush=True)
        import cognee
        from cognee.modules.search.types import SearchType
        
        # Configure workspace-local storage directories BEFORE any other cognee operations
        print("[PROGRESS] Configuring workspace storage directories", file=sys.stderr, flush=True)
        cognee.config.system_root_directory(str(workspace_dir / '.cognee_system'))
        cognee.config.data_root_directory(str(workspace_dir / '.cognee_data'))
        
        # Configure Cognee with API key
        print("[PROGRESS] Configuring LLM provider (OpenAI)", file=sys.stderr, flush=True)
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
        
        # 1. Generate same unique dataset name as init.py and ingest.py (using canonical path)
        dataset_name, workspace_path_str = generate_dataset_name(workspace_path)
        
        # 2. Search within this workspace's dataset only
        # Note: If no data has been ingested yet, search will return empty results
        print(f"[PROGRESS] Executing Cognee search: dataset={dataset_name}, top_k={max_results}", file=sys.stderr, flush=True)
        try:
            search_results = await cognee.search(
                query_type=SearchType.GRAPH_COMPLETION,
                query_text=query,
                datasets=[dataset_name],  # Filter to this workspace only
                top_k=max_results
            )
            print(f"[PROGRESS] Search completed: {len(search_results) if search_results else 0} results", file=sys.stderr, flush=True)
        except Exception as search_error:
            # If database doesn't exist yet (no data ingested), return empty results
            error_msg = str(search_error)
            print(f"[WARNING] Search error: {error_msg}", file=sys.stderr)
            if 'DatabaseNotCreatedError' in error_msg or 'database' in error_msg.lower():
                return {
                    'success': True,
                    'results': [],
                    'result_count': 0,
                    'message': 'No data has been ingested yet. Start chatting to build memory.'
                }
            # Re-raise other errors with structured payload
            error_payload = {
                'error_code': 'COGNEE_SDK_ERROR',
                'error_type': type(search_error).__name__,
                'message': str(search_error),
                'traceback': str(search_error)
            }
            print(f"[ERROR] {json.dumps(error_payload)}", file=sys.stderr)
            raise
        
        # This ensures search results only contain data from this workspace,
        # not from other workspaces or tutorial data.
        
        # DEBUG: Log search results structure to understand what Cognee returns
        print(f"DEBUG: search_results type: {type(search_results)}", file=sys.stderr)
        print(f"DEBUG: search_results length: {len(search_results) if search_results else 0}", file=sys.stderr)
        if search_results:
            print(f"DEBUG: first result type: {type(search_results[0])}", file=sys.stderr)
            print(f"DEBUG: first result: {search_results[0]}", file=sys.stderr)
            if hasattr(search_results[0], '__dict__'):
                print(f"DEBUG: first result attributes: {search_results[0].__dict__}", file=sys.stderr)
        
        # If no results, return empty
        if not search_results:
            print("[PROGRESS] No results found, returning empty", file=sys.stderr, flush=True)
            return {
                'success': True,
                'results': [],
                'result_count': 0,
                'total_tokens': 0
            }
        
        # Process results - convert SearchResult objects to dicts with structured parsing per §4.4.1
        print(f"[PROGRESS] Processing {len(search_results)} results", file=sys.stderr, flush=True)
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
            
            # Try to parse as enriched summary per §4.4.1
            parsed = parse_enriched_summary(text)
            
            if parsed:
                # Enriched summary with structured metadata
                result_dict = parsed
                result_dict['score'] = 0.7  # Cognee base score
                
                # Calculate recency score from created_at if available
                if parsed.get('created_at'):
                    recency_score = calculate_recency_score(parsed['created_at'])
                    # Apply recency weighting
                    base_weight = 1.0 - recency_weight
                    result_dict['score'] = round(
                        0.7 * base_weight + recency_score * recency_weight,
                        3
                    )
            else:
                # Legacy raw-text memory - extract timestamp/importance if present
                timestamp_match = re.search(r'\[Timestamp: ([^\]]+)\]', text)
                importance_match = re.search(r'\[Importance: ([^\]]+)\]', text)
                
                timestamp = timestamp_match.group(1) if timestamp_match else None
                importance = float(importance_match.group(1)) if importance_match else 0.0
                
                # Calculate scores
                recency_score = calculate_recency_score(timestamp) if timestamp else 0.5
                base_score = 0.7
                
                # Calculate weighted final score
                base_weight = 1.0 - recency_weight - importance_weight
                final_score = (
                    base_score * base_weight +
                    recency_score * recency_weight +
                    importance * importance_weight
                )
                
                # Legacy format per §4.4.1 mixed-mode requirement
                # Use camelCase to match TypeScript RetrievalResult interface
                result_dict = {
                    'summary_text': text,
                    'text': text,  # Backward compatibility
                    'topic': None,
                    'topicId': None,
                    'sessionId': None,
                    'planId': None,
                    'status': None,
                    'createdAt': timestamp,
                    'score': round(final_score, 3),
                    'recency_score': round(recency_score, 3),
                    'importance_score': round(importance, 3),
                    'decisions': [],
                    'rationale': [],
                    'open_questions': [],
                    'next_steps': [],
                    'references': []
                }
            
            # Estimate tokens
            result_tokens = estimate_tokens(result_dict.get('summary_text', result_dict.get('text', '')))
            result_dict['tokens'] = result_tokens
            
            # Check token limit
            if total_tokens + result_tokens > max_tokens and len(processed_results) > 0:
                break
            
            processed_results.append(result_dict)
            total_tokens += result_tokens
        
        return {
            'success': True,
            'results': processed_results,
            'result_count': len(processed_results),
            'total_tokens': total_tokens
        }
        
    except ImportError as e:
        error_payload = {
            'success': False,
            'error_code': 'PYTHON_ENV_ERROR',
            'error_type': 'ImportError',
            'message': f'Failed to import required module: {str(e)}',
            'traceback': str(e),
            'error': f'Failed to import required module: {str(e)}'
        }
        print(f"[ERROR] {json.dumps(error_payload)}", file=sys.stderr)
        return error_payload
    except Exception as e:
        import traceback
        error_payload = {
            'success': False,
            'error_code': 'COGNEE_SDK_ERROR',
            'error_type': type(e).__name__,
            'message': str(e),
            'traceback': traceback.format_exc(),
            'error': f'Retrieval failed: {str(e)}'
        }
        print(f"[ERROR] {json.dumps(error_payload)}", file=sys.stderr)
        return error_payload


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
