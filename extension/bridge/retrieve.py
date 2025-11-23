#!/usr/bin/env python3
"""
Cognee Context Retrieval Script for VS Code Extension

Usage: python retrieve.py <workspace_path> <query> [max_results] [max_tokens] [half_life_days] [include_superseded]

Retrieves relevant context from Cognee using hybrid graph-vector search with workspace isolation:
1. Loads API key from workspace .env
2. Generates unique dataset name for workspace
3. Executes GRAPH_COMPLETION search filtered to workspace dataset
4. Calculates recency-aware, status-aware scores using exponential decay
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
from datetime import datetime, timezone
from math import exp, log
from pathlib import Path

# Add bridge directory to path to import bridge_logger
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import bridge_logger
from workspace_utils import generate_dataset_name


SYSTEM_PROMPT = """You are a MEMORY RETRIEVAL ASSISTANT for an autonomous coding agent.

Your only job is to answer questions USING THE PROVIDED CONTEXT TEXT.
You must behave as if you know NOTHING except what appears in that context.

DEFINITIONS
- "Context" = the text block labeled CONTEXT below.
- "Outside knowledge" = anything not literally present or directly implied in the context.

ALLOWED BEHAVIOR
- You may QUOTE, PARAPHRASE, and SUMMARIZE statements from the context.
- You may COMBINE related pieces of information from different parts of the context.
- You may resolve simple references (e.g. “we”, “the system”, “this service”) as long as the referent is defined in the context.

FORBIDDEN BEHAVIOR
- Do NOT introduce new APIs, tools, classes, file names, or configurations that are not in the context.
- Do NOT fill in missing steps, rationale, or design details using your own knowledge.
- Do NOT “guess” or “assume” anything that is not clearly supported by the context.
- Do NOT use general programming knowledge, frameworks, or best practices unless they are explicitly mentioned in the context.

WHEN ANSWERING
1. If there is enough information in the context to answer:
   - Provide a concise answer using only information from the context.
   - It is OK to summarize and compress, but do not add new facts.

2. If the context is only partially relevant:
   - Answer ONLY the parts that are supported by the context.
   - Explicitly say what is UNKNOWN or NOT SPECIFIED in the context.

3. If the context does not contain relevant information:
   - Respond exactly with: `NO_RELEVANT_CONTEXT`
   - Do not explain, apologize, or add any extra words.

STYLE
- Answer clearly and directly.
- Prefer short, factual sentences.
- Do NOT speculate."""


def calculate_recency_multiplier(timestamp_str: str | None, half_life_days: float) -> float:
    """Compute exponential decay multiplier using half-life days setting."""
    if not timestamp_str or timestamp_str == 'N/A':
        return 1.0
    try:
        timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
        age = datetime.now(timezone.utc) - timestamp.replace(tzinfo=timezone.utc)
        age_days = max(age.total_seconds() / 86400, 0)
        half_life = max(half_life_days, 0.5)
        decay_alpha = log(2) / half_life
        return float(exp(-decay_alpha * age_days))
    except Exception:
        return 1.0


STATUS_MULTIPLIERS = {
    'DecisionRecord': 1.1,
    'Active': 1.0,
    'Superseded': 0.4
}

STATUS_SORT_ORDER = {
    'DecisionRecord': 0,
    'Active': 1,
    None: 1,
    'Superseded': 2
}


def get_status_multiplier(status: str | None) -> float:
    return STATUS_MULTIPLIERS.get(status, 1.0)


def get_status_rank(status: str | None) -> int:
    return STATUS_SORT_ORDER.get(status, 1)


def clamp_half_life_days(value: float | int | None) -> float:
    try:
        numeric_value = float(value) if value is not None else 7.0
    except (TypeError, ValueError):
        numeric_value = 7.0
    return max(0.5, min(90.0, numeric_value))


def parse_bool_arg(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'y'}


def normalize_status(status: str | None) -> str | None:
    if not status or status == 'N/A':
        return None
    normalized = status.strip().lower()
    if normalized in {'decision', 'decisionrecord', 'decision_record'}:
        return 'DecisionRecord'
    if normalized in {'superseded'}:
        return 'Superseded'
    if normalized in {'active'}:
        return 'Active'
    return status.strip()


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


def parse_enriched_summary(text: str) -> dict | None:
    """Parse enriched text summary per §4.4.1 to extract structured metadata and content."""

    if '**Metadata:**' not in text:
        return None

    def _match(pattern: str) -> str | None:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if not match:
            return None
        value = match.group(1).strip()
        if value in {'N/A', '(none)', ''}:
            return None
        return value

    def _parse_list_section(content: str | None) -> list[str]:
        if not content:
            return []
        cleaned = []
        for line in content.strip().split('\n'):
            stripped = line.strip()
            if not stripped or stripped.lower() == '(none)':
                continue
            if stripped.startswith('- '):
                cleaned.append(stripped[2:].strip())
            else:
                cleaned.append(stripped)
        return cleaned

    def _section(pattern: str) -> str | None:
        match = re.search(pattern, text)
        return match.group(1).strip() if match else None

    topic = _match(r'^# Conversation Summary:\s*(.+)$')
    topic_id = _match(r'-\s*Topic ID:\s*([\w\-]+|N/A)')
    session_id = _match(r'-\s*Session ID:\s*([\w\-]+|N/A)')
    plan_id = _match(r'-\s*Plan ID:\s*([\w\-]+|N/A)')
    status = normalize_status(_match(r'-\s*Status:\s*(Active|Superseded|DecisionRecord|Draft|N/A)'))
    created_at = _match(r'-\s*Created:\s*([\dT:\-.+Z]+|N/A)')
    source_created_at = _match(r'-\s*Source Created:\s*([\dT:\-.+Z]+|N/A)')
    updated_at = _match(r'-\s*Updated:\s*([\dT:\-.+Z]+|N/A)')

    context_section = _section(r'## Context\n([\s\S]+?)(?=\n##|$)')
    decisions_section = _section(r'## Key Decisions\n([\s\S]+?)(?=\n##|$)')
    rationale_section = _section(r'## Rationale\n([\s\S]+?)(?=\n##|$)')
    questions_section = _section(r'## Open Questions\n([\s\S]+?)(?=\n##|$)')
    next_steps_section = _section(r'## Next Steps\n([\s\S]+?)(?=\n##|$)')
    references_section = _section(r'## References\n([\s\S]+?)(?=\n##|$)')
    time_scope_section = _section(r'## Time Scope\n([\s\S]+?)(?=\n##|$)')

    return {
        'summary_text': text,
        'text': text,
        'topic': topic,
        'topic_id': topic_id,
        'session_id': session_id,
        'plan_id': plan_id,
        'status': status,
        'created_at': created_at,
        'source_created_at': source_created_at,
        'updated_at': updated_at,
        'context': context_section.strip() if context_section else None,
        'decisions': _parse_list_section(decisions_section),
        'rationale': _parse_list_section(rationale_section),
        'open_questions': _parse_list_section(questions_section),
        'next_steps': _parse_list_section(next_steps_section),
        'references': _parse_list_section(references_section),
        'time_scope': time_scope_section.strip() if time_scope_section else None
    }


async def retrieve_context(
    workspace_path: str,
    query: str,
    max_results: int = 3,
    max_tokens: int = 2000,
    half_life_days: float = 7.0,
    include_superseded: bool = False
) -> dict:
    """Retrieve relevant context with recency-aware, status-aware scoring."""
    
    # Initialize logger
    logger = bridge_logger.setup_logging(workspace_path, "retrieve")
    
    try:
        max_results = max(1, min(50, int(max_results)))
        max_tokens = max(100, int(max_tokens))
        half_life_days = clamp_half_life_days(half_life_days)

        logger.info(f"Starting retrieval", extra={'data': {
            'query_preview': f"{query[:50]}...",
            'max_results': max_results,
            'max_tokens': max_tokens,
            'half_life_days': half_life_days,
            'include_superseded': include_superseded
        }})
        
        # Load workspace .env file
        logger.debug("Loading .env file")
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
            logger.error("Missing API key", extra={'data': error_payload})
            return error_payload
        
        # Import cognee
        logger.debug("Importing cognee SDK")
        import cognee
        from cognee.modules.search.types import SearchType
        
        # Configure workspace-local storage directories BEFORE any other cognee operations
        logger.debug("Configuring workspace storage directories")
        cognee.config.system_root_directory(str(workspace_dir / '.cognee_system'))
        cognee.config.data_root_directory(str(workspace_dir / '.cognee_data'))
        
        # Configure Cognee with API key
        logger.debug("Configuring LLM provider (OpenAI)")
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
        
        # 1. Generate same unique dataset name as init.py and ingest.py (using canonical path)
        dataset_name, _ = generate_dataset_name(workspace_path)
        
        # 2. Search within this workspace's dataset only
        # Note: If no data has been ingested yet, search will return empty results
        search_top_k = max(max_results * 3, max_results)
        logger.info(f"Executing Cognee search", extra={'data': {
            'dataset': dataset_name,
            'top_k': search_top_k
        }})
        
        try:
            search_results = await cognee.search(
                query_type=SearchType.GRAPH_COMPLETION,
                query_text=query,
                datasets=[dataset_name],  # Filter to this workspace only
                top_k=search_top_k,
                system_prompt=SYSTEM_PROMPT
            )
            logger.info(f"Search completed", extra={'data': {
                'result_count': len(search_results) if search_results else 0
            }})
        except Exception as search_error:
            # If database doesn't exist yet (no data ingested), return empty results
            error_msg = str(search_error)
            logger.warning(f"Search error: {error_msg}")
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
            logger.error("Search exception", extra={'data': error_payload})
            raise
        
        # DEBUG: Log search results structure to understand what Cognee returns
        logger.debug(f"Search results type: {type(search_results)}")
        if search_results:
            logger.debug(f"First result type: {type(search_results[0])}")
            # Log first result details for debugging (truncated)
            first_res = str(search_results[0])
            logger.debug(f"First result preview: {first_res[:200]}...")
        
        # If no results, return empty
        if not search_results:
            logger.info("No results found, returning empty")
            return {
                'success': True,
                'results': [],
                'result_count': 0,
                'total_results': 0,
                'total_tokens': 0,
                'half_life_days': half_life_days,
                'include_superseded': include_superseded
            }
        
        # Process and score results
        logger.info(f"Processing {len(search_results)} results")

        def extract_text_and_semantic_score(result_obj) -> tuple[str, float]:
            text_value = ''
            semantic_score = None

            metadata = None
            if isinstance(result_obj, tuple):
                text_value = str(result_obj[0]) if result_obj else ''
                if len(result_obj) > 1 and isinstance(result_obj[1], dict):
                    metadata = result_obj[1]
            else:
                text_value = str(getattr(result_obj, 'text', result_obj))
                metadata = getattr(result_obj, 'metadata', None)

            if metadata and isinstance(metadata, dict):
                candidate = metadata.get('score') or metadata.get('similarity')
                if candidate is not None:
                    try:
                        semantic_score = float(candidate)
                    except (TypeError, ValueError):
                        semantic_score = None

            if semantic_score is None and hasattr(result_obj, 'score'):
                try:
                    semantic_score = float(getattr(result_obj, 'score'))
                except (TypeError, ValueError):
                    semantic_score = None

            if semantic_score is None:
                semantic_score = 0.0

            return text_value, float(semantic_score)

        scored_results: list[dict] = []
        filtered_count = 0
        filtered_reasons = []

        for i, result in enumerate(search_results):
            text, semantic_score = extract_text_and_semantic_score(result)
            parsed = parse_enriched_summary(text)

            if parsed:
                status = parsed.get('status')
                recency_timestamp = parsed.get('source_created_at') or parsed.get('created_at')
                result_dict = parsed.copy()
            else:
                timestamp_match = re.search(r'\[Timestamp: ([^\]]+)\]', text)
                timestamp = timestamp_match.group(1) if timestamp_match else None
                status = None
                recency_timestamp = timestamp
                result_dict = {
                    'summary_text': text,
                    'text': text,
                    'topic': None,
                    'topic_id': None,
                    'session_id': None,
                    'plan_id': None,
                    'status': None,
                    'created_at': timestamp,
                    'source_created_at': timestamp,
                    'updated_at': None,
                    'decisions': [],
                    'rationale': [],
                    'open_questions': [],
                    'next_steps': [],
                    'references': [],
                    'time_scope': None
                }

            status = normalize_status(status)
            if not include_superseded and status == 'Superseded':
                filtered_count += 1
                filtered_reasons.append(f"Superseded status (id={i})")
                continue

            recency_multiplier = calculate_recency_multiplier(recency_timestamp, half_life_days)
            status_multiplier = get_status_multiplier(status)
            final_score = float(semantic_score) * recency_multiplier * status_multiplier

            # Log detailed scoring for each candidate (DEBUG level)
            logger.debug(f"Scoring candidate {i}", extra={'data': {
                'semantic_score': semantic_score,
                'recency_multiplier': recency_multiplier,
                'status_multiplier': status_multiplier,
                'final_score': final_score,
                'status': status,
                'timestamp': recency_timestamp
            }})

            # Filter out low confidence results to prevent hallucinations
            # Plan 021 Milestone 2: Strict filtering
            # Plan 023 Hotfix: Bypass strict filter for synthesized graph answers (which have default score 0.0)
            is_synthesized_answer = (semantic_score == 0.0)

            if final_score <= 0.01:
                if is_synthesized_answer:
                    logger.debug(f"Bypassing strict filter for synthesized answer", extra={'data': {
                        'final_score': final_score
                    }})
                else:
                    filtered_count += 1
                    filtered_reasons.append(f"Low score {final_score:.4f} <= 0.01 (id={i})")
                    logger.debug(f"Filtering result with low score", extra={'data': {
                        'final_score': final_score,
                        'semantic_score': semantic_score
                    }})
                    continue

            result_text = result_dict.get('summary_text') or result_dict.get('text') or ''
            
            # Filter out explicit NO_RELEVANT_CONTEXT responses (case-insensitive)
            if 'no_relevant_context' in result_text.strip().lower():
                filtered_count += 1
                filtered_reasons.append(f"NO_RELEVANT_CONTEXT content (id={i})")
                logger.debug(f"Filtering NO_RELEVANT_CONTEXT response")
                continue

            tokens = estimate_tokens(result_text)

            result_dict.update({
                'status': status,
                'score': round(final_score, 4),
                'final_score': round(final_score, 4),
                'relevance_score': round(final_score, 4),
                'semantic_score': round(semantic_score, 4),
                'recency_multiplier': round(recency_multiplier, 4),
                'status_multiplier': round(status_multiplier, 4),
                'tokens': tokens,
                '_status_rank': get_status_rank(status)
            })

            scored_results.append(result_dict)

        if filtered_count > 0:
            logger.info(f"Filtered {filtered_count} results", extra={'data': {
                'reasons': filtered_reasons[:10] # Log first 10 reasons
            }})

        if not scored_results:
            return {
                'success': True,
                'results': [],
                'result_count': 0,
                'total_results': 0,
                'total_tokens': 0
            }

        scored_results.sort(key=lambda item: (-item['final_score'], item.get('_status_rank', 1)))

        selected_results = []
        total_tokens = 0

        for result_dict in scored_results:
            tokens = result_dict.get('tokens', 0)
            if total_tokens + tokens > max_tokens and selected_results:
                logger.debug(f"Skipping result due to token limit", extra={'data': {
                    'current_tokens': total_tokens,
                    'item_tokens': tokens,
                    'max_tokens': max_tokens
                }})
                continue

            payload = {k: v for k, v in result_dict.items() if not k.startswith('_')}
            selected_results.append(payload)
            total_tokens += tokens

            if len(selected_results) >= max_results:
                break

        logger.info(f"Returning {len(selected_results)} results", extra={'data': {
            'total_tokens': total_tokens,
            'top_score': selected_results[0]['final_score'] if selected_results else 0
        }})

        return {
            'success': True,
            'results': selected_results,
            'result_count': len(selected_results),
            'total_results': len(scored_results),
            'total_tokens': total_tokens,
            'half_life_days': half_life_days,
            'include_superseded': include_superseded
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
        # We can't use logger here if import failed before logger setup, but we try
        try:
            logger.error("Import error", extra={'data': error_payload})
        except:
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
        try:
            logger.error("Unhandled exception", extra={'data': error_payload})
        except:
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
    half_life_days = 7.0
    include_superseded = False
    
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
            half_life_days = clamp_half_life_days(float(sys.argv[5]))
        except ValueError:
            result = {
                'success': False,
                'error': f'Invalid half_life_days: {sys.argv[5]} (must be float)'
            }
            print(json.dumps(result))
            sys.exit(1)
    
    if len(sys.argv) >= 7:
        include_superseded = parse_bool_arg(sys.argv[6], default=False)
    
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
        half_life_days,
        include_superseded
    ))
    
    # Output JSON result
    print(json.dumps(result))
    
    # Exit with appropriate code
    sys.exit(0 if result['success'] else 1)


if __name__ == '__main__':
    main()
