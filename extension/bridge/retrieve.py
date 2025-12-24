#!/usr/bin/env python3
"""
Cognee Context Retrieval Script for VS Code Extension

Usage: python retrieve.py <workspace_path> <query> [max_results] [max_tokens] [half_life_days] [include_superseded] [top_k]

Retrieves relevant context from Cognee using hybrid graph-vector search with workspace isolation:
1. Loads API key from workspace .env
2. Generates unique dataset name for workspace
3. Executes GRAPH_COMPLETION search with only_context=True (Plan 073: eliminates LLM bottleneck)
4. Returns raw graph context for TypeScript-side synthesis via Copilot LM API
5. Calculates recency-aware, status-aware scores using exponential decay

Plan 073: Architecture Overhaul
- Uses only_context=True to skip Cognee's internal LLM call (~17-32s savings)
- Returns contractVersion for additive contract evolution
- TypeScript layer performs synthesis via VS Code Copilot LM API

Returns JSON to stdout:
    Success: {"success": true, "contractVersion": "2.0.0", "graphContext": "...", "results": [...]}
    Failure: {"success": false, "error": "error message"}
"""

import asyncio
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from math import exp, log
from pathlib import Path

# Add bridge directory to path to import bridge_logger and bridge_env
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# CRITICAL: Import bridge_env BEFORE any cognee import (Plan 074)
# This must happen at module level to ensure env vars are available
# when cognee is imported later in the async functions
from bridge_env import apply_workspace_env, OntologyConfigError
import bridge_logger
from workspace_utils import canonicalize_workspace_path, generate_dataset_name

# Plan 073: Contract version for retrieval response evolution
# v2.0.0: Switch to only_context=True, adds graphContext field for TS synthesis
RETRIEVE_CONTRACT_VERSION = "2.0.0"

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
- Provide comprehensive, nuance-preserving answers that fully address the question.
- When multiple pieces of context are relevant, synthesize them into a coherent response.
- Preserve important details, decisions, rationale, and constraints from the context.
- If context is thin or tangential, be concise rather than padding with filler.
- Do NOT speculate or invent details not present in the context.

SESSION AWARENESS
- If the query appears to be a follow-up to prior context (e.g., "what about...", "and the...", "why did we..."), explicitly connect your answer to related information from retrieved memories.
- Acknowledge conversational continuity where the context supports it.
- Do NOT imply hidden memory or state beyond: (a) the retrieved memories returned in this call, and (b) any explicit chat context provided by the caller."""


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
    include_superseded: bool = False,
    top_k: int | None = None,
    session_id: str | None = None,
    wide_search_top_k: int = 150,  # Plan 063: Advanced graph search setting
    triplet_distance_penalty: float = 3.0  # Plan 063: Advanced graph search setting
) -> dict:
    """Retrieve relevant context with recency-aware, status-aware scoring."""

    # Initialize logger
    logger = bridge_logger.setup_logging(workspace_path, "retrieve")

    # Plan 050: Gate graph retriever debug output behind extension debugLogging setting
    debug_enabled = os.getenv('FLOWBABY_DEBUG_LOGGING', '').lower() in {'1', 'true', 'yes', 'on'}
    logger.setLevel(logging.DEBUG if debug_enabled else logging.INFO)

    try:
        max_results = max(1, min(50, int(max_results)))
        # Clamp max_tokens into architectural window [100, 100000]
        max_tokens = max(100, min(100_000, int(max_tokens)))
        half_life_days = clamp_half_life_days(half_life_days)

        # Normalize and clamp top_k: never below max_results, capped at 100
        user_top_k = int(top_k) if top_k is not None else max_results * 3
        normalized_top_k = max(user_top_k, max_results)
        final_top_k = min(normalized_top_k, 100)

        logger.info("Starting retrieval", extra={'data': {
            'query_preview': f"{query[:50]}...",
            'max_results': max_results,
            'max_tokens': max_tokens,
            'half_life_days': half_life_days,
            'include_superseded': include_superseded,
            'user_top_k': user_top_k,
            'normalized_top_k': normalized_top_k,
            'final_top_k': final_top_k
        }})

        # Plan 039 M5: Workspace .env loading removed per Plan 037 F2 security finding
        # API key is now resolved by TypeScript and passed via LLM_API_KEY environment variable
        workspace_dir = Path(workspace_path)

        # Check for API key (provided by TypeScript via LLM_API_KEY environment variable)
        api_key = os.getenv('LLM_API_KEY')
        if not api_key:
            error_payload = {
                'success': False,
                'error_code': 'LLM_API_ERROR',
                'error_type': 'MISSING_API_KEY',
                'message': 'LLM_API_KEY not found in environment',
                'user_message': 'LLM_API_KEY not found. Use "Flowbaby: Set API Key" for secure storage.',
                'remediation': 'Run "Flowbaby: Set API Key" from Command Palette to configure your API key securely.',
                'error': 'LLM_API_KEY environment variable is required but not set'
            }
            logger.error("Missing API key", extra={'data': error_payload})
            return error_payload

        # Plan 074: Use shared bridge_env module for all environment wiring
        # This sets storage directories, caching config, AND ontology activation
        # CRITICAL: This must happen BEFORE importing cognee (pydantic-settings reads env vars at import)
        env_config = apply_workspace_env(workspace_path, logger=logger, fail_on_missing_ontology=True)
        system_root = env_config.system_root
        data_root = env_config.data_root

        # Plan 074: Log ontology configuration for observability
        logger.debug(f"Ontology config: path={env_config.ontology_file_path}, resolver={env_config.ontology_resolver}, strategy={env_config.matching_strategy}")

        # Import cognee AFTER setting environment variables
        logger.debug("Importing cognee SDK")
        import cognee
        from cognee.context_global_variables import set_session_user_context_variable
        from cognee.modules.search.types import SearchType
        from cognee.modules.users.methods import get_default_user
        # Plan 049: Import session management utilities

        # Configure workspace-local storage directories (redundant but explicit for clarity)
        logger.debug("Configuring workspace storage directories")
        cognee.config.system_root_directory(system_root)
        cognee.config.data_root_directory(data_root)

        # Configure Cognee with API key
        logger.debug("Configuring LLM provider (OpenAI)")
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')

        # 1. Generate same unique dataset name as init.py and ingest.py (using canonical path)
        dataset_name, _ = generate_dataset_name(workspace_path)

        # 2. Search within this workspace's dataset only
        # Note: If no data has been ingested yet, search will return empty results
        if user_top_k != final_top_k:
            logger.warning("Adjusted top_k to satisfy normalization/clamping rules", extra={'data': {
                'requested_top_k': user_top_k,
                'normalized_top_k': normalized_top_k,
                'final_top_k': final_top_k,
                'max_results': max_results
            }})

        logger.info("Executing Cognee search", extra={'data': {
            'dataset': dataset_name,
            'top_k': final_top_k
        }})

        try:
            # Plan 049: Initialize user context if session ID is present
            if session_id:
                try:
                    default_user = await get_default_user()
                    await set_session_user_context_variable(default_user)
                    logger.debug(f"Initialized session context for user {default_user.id}", extra={'data': {'session_id': session_id}})
                except Exception as session_error:
                    logger.warning(f"Failed to initialize session context: {session_error}", extra={'data': {'session_id': session_id}})

            # Plan 073: Use only_context=True to skip LLM completion call (17-32s savings)
            # This returns raw graph context for TypeScript-side synthesis via Copilot
            # Verified: cognee.search (v0.4.1+) supports session_id.
            # Plan 063: wide_search_top_k and triplet_distance_penalty now configurable via settings.
            # These parameters are applied only if supported by Cognee; unsupported params fail loudly.
            search_kwargs = {
                'query_type': SearchType.GRAPH_COMPLETION,
                'query_text': query,
                'datasets': [dataset_name],  # Filter to this workspace only
                'top_k': final_top_k,
                'only_context': True,  # Plan 073: Skip LLM call, return raw graph context
                'wide_search_top_k': wide_search_top_k,  # Plan 063: Configurable via extension settings
                'triplet_distance_penalty': triplet_distance_penalty  # Plan 063: Configurable via extension settings
            }
            # Note: system_prompt removed - not needed when only_context=True (no LLM call)

            logger.debug("Search kwargs configured", extra={'data': {
                'only_context': True,
                'wide_search_top_k': wide_search_top_k,
                'triplet_distance_penalty': triplet_distance_penalty
            }})

            if session_id:
                search_kwargs['session_id'] = session_id

            # Plan 063: Validate kwargs are supported; fail closed with actionable message if not
            search_start = datetime.now(timezone.utc)
            try:
                search_results = await cognee.search(**search_kwargs)
            except TypeError as kwarg_error:
                # If Cognee doesn't support the new kwargs, fail loudly with remediation guidance
                if 'unexpected keyword argument' in str(kwarg_error):
                    unsupported_param = str(kwarg_error).split("'")[1] if "'" in str(kwarg_error) else 'unknown'
                    raise RuntimeError(
                        f"Cognee search does not support parameter '{unsupported_param}'. "
                        f"This may indicate a version mismatch. Expected Cognee >= 0.5.1 with only_context support. "
                        f"Please upgrade Cognee or contact support. Original error: {kwarg_error}"
                    ) from kwarg_error
                raise
            search_duration_ms = int((datetime.now(timezone.utc) - search_start).total_seconds() * 1000)

            logger.info("Search completed", extra={'data': {
                'result_count': len(search_results) if search_results else 0,
                'duration_ms': search_duration_ms,
                'only_context': True
            }})
        except Exception as search_error:
            # If database/dataset doesn't exist yet (no data ingested), return empty results gracefully
            error_msg = str(search_error)
            error_type = type(search_error).__name__
            logger.warning(f"Search error: {error_msg}")

            # Plan 073: Improve error classification - lock contention should not appear as "fresh workspace"
            # Check for lock contention first (more specific)
            if 'Could not set lock' in error_msg or 'lock' in error_msg.lower():
                logger.error("Database lock contention - daemon may be holding lock", extra={'data': {
                    'error_type': error_type,
                    'error_msg': error_msg
                }})
                return {
                    'success': False,
                    'contractVersion': RETRIEVE_CONTRACT_VERSION,
                    'error_code': 'LOCK_CONTENTION',
                    'error': 'Database is locked. Another operation may be in progress. Please try again.',
                    'results': [],
                    'graphContext': None
                }

            # v0.5.8: Handle DatasetNotFoundError (fresh workspace with no data)
            # This is a normal condition when the user has initialized but not yet stored any memories
            if ('DatabaseNotCreatedError' in error_msg or
                'DatasetNotFoundError' in error_type or
                'No datasets found' in error_msg):
                logger.info("Fresh workspace detected - no data ingested yet")
                return {
                    'success': True,
                    'contractVersion': RETRIEVE_CONTRACT_VERSION,
                    'results': [],
                    'graphContext': None,
                    'result_count': 0,
                    'message': 'No data has been ingested yet. Start chatting to build memory.'
                }
            # Re-raise other errors with structured payload
            error_payload = {
                'success': False,
                'contractVersion': RETRIEVE_CONTRACT_VERSION,
                'error_code': 'COGNEE_SDK_ERROR',
                'error_type': error_type,
                'message': str(search_error),
                'traceback': str(search_error)
            }
            logger.error("Search exception", extra={'data': error_payload})
            raise

        # Plan 073: Extract graph context from only_context=True return format
        # Expected format: [{
        #   "search_result": [{"ws_xxx": "Nodes:\nNode: ... [triplets as text]"}],
        #   "dataset_id": "...",
        #   "dataset_name": "ws_xxx"
        # }]
        graph_context = None
        context_char_count = 0
        
        def extract_graph_context(search_results) -> str | None:
            """Extract graph context string from only_context=True return format."""
            if not search_results:
                return None
            
            try:
                # search_results is list[dict]
                if isinstance(search_results, list) and len(search_results) > 0:
                    first_result = search_results[0]
                    if isinstance(first_result, dict) and 'search_result' in first_result:
                        search_result_inner = first_result['search_result']
                        # search_result is [{dataset_name: "context_string"}]
                        if isinstance(search_result_inner, list) and len(search_result_inner) > 0:
                            first_inner = search_result_inner[0]
                            if isinstance(first_inner, dict):
                                # Get the first value (the context string)
                                for key, value in first_inner.items():
                                    if isinstance(value, str):
                                        return value
                            elif isinstance(first_inner, str):
                                return first_inner
            except Exception as e:
                logger.warning(f"Failed to extract graph context: {e}")
            return None
        
        graph_context = extract_graph_context(search_results)
        if graph_context:
            context_char_count = len(graph_context)
            logger.info(f"Extracted graph context", extra={'data': {
                'char_count': context_char_count,
                'preview': graph_context[:200] + '...' if len(graph_context) > 200 else graph_context
            }})
        else:
            logger.warning("Could not extract graph context from search results")
        
        # DEBUG: Log search results structure to understand what Cognee returns
        logger.debug(f"Search results type: {type(search_results)}")
        if search_results:
            logger.debug(f"First result type: {type(search_results[0])}")
            # Log first result details for debugging (truncated)
            first_res = str(search_results[0])
            logger.debug(f"First result preview: {first_res[:200]}...")

        # If no results or no context, return empty
        if not search_results or not graph_context:
            logger.info("No results/context found, returning empty")
            return {
                'success': True,
                'contractVersion': RETRIEVE_CONTRACT_VERSION,
                'results': [],
                'graphContext': None,
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
            elif isinstance(result_obj, dict):
                # Handle Cognee graph_completion results which return {'search_result': [...], ...}
                if 'search_result' in result_obj:
                    search_result = result_obj['search_result']
                    if isinstance(search_result, list) and search_result:
                        text_value = str(search_result[0])
                    elif search_result:
                        text_value = str(search_result)
                elif 'text' in result_obj:
                    text_value = str(result_obj['text'])
                else:
                    # Fallback: stringify the whole dict (but this shouldn't happen)
                    text_value = str(result_obj)
                # Extract metadata from the dict if present
                metadata = result_obj.get('metadata')
                # Also check for score in the dict itself
                if 'score' in result_obj:
                    try:
                        semantic_score = float(result_obj['score'])
                    except (TypeError, ValueError):
                        pass
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
                    semantic_score = float(result_obj.score)
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

            # Handle synthesized graph answers: 0.00 sentinel → high confidence
            # This occurs when cognee's GRAPH_COMPLETION synthesizes an answer
            # rather than returning a raw vector similarity score
            confidence_label = "normal"
            if semantic_score == 0.0:
                final_score = 1.0  # High score for ranking
                confidence_label = "synthesized_high"
                logger.debug("Handled synthesized answer: score 0.00 → final_score 1.0, confidenceLabel=synthesized_high", extra={'data': {'original_score': semantic_score}})
            else:
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
            # Plan 026: Trust final_score (which is 1.0 for synthesized answers)
            if final_score <= 0.01:
                filtered_count += 1
                filtered_reasons.append(f"Low score {final_score:.4f} <= 0.01 (id={i})")
                logger.debug("Filtering result with low score", extra={'data': {
                    'final_score': final_score,
                    'semantic_score': semantic_score
                }})
                continue

            result_text = result_dict.get('summary_text') or result_dict.get('text') or ''

            # Filter out explicit NO_RELEVANT_CONTEXT responses (case-insensitive)
            # Plan 022: Use exact match to avoid filtering valid results that mention the phrase
            if result_text.strip().lower() == 'no_relevant_context':
                filtered_count += 1
                filtered_reasons.append(f"NO_RELEVANT_CONTEXT sentinel (id={i})")
                logger.debug("Filtering NO_RELEVANT_CONTEXT sentinel")
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
                'confidenceLabel': confidence_label,
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
                'contractVersion': RETRIEVE_CONTRACT_VERSION,
                'graphContext': graph_context,
                'graphContextCharCount': context_char_count,
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
                logger.debug("Skipping result due to token limit", extra={'data': {
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
            'contractVersion': RETRIEVE_CONTRACT_VERSION,
            'graphContext': graph_context,
            'graphContextCharCount': context_char_count,
            'results': selected_results,
            'result_count': len(selected_results),
            'total_results': len(scored_results),
            'filtered_count': filtered_count,
            'total_tokens': total_tokens,
            'half_life_days': half_life_days,
            'include_superseded': include_superseded
        }

    except ImportError as e:
        error_payload = {
            'success': False,
            'contractVersion': RETRIEVE_CONTRACT_VERSION,
            'error_code': 'PYTHON_ENV_ERROR',
            'error_type': 'ImportError',
            'message': f'Failed to import required module: {str(e)}',
            'traceback': str(e),
            'error': f'Failed to import required module: {str(e)}'
        }
        # We can't use logger here if import failed before logger setup, but we try
        try:
            logger.error("Import error", extra={'data': error_payload})
        except Exception:
            print(f"[ERROR] {json.dumps(error_payload)}", file=sys.stderr)
        return error_payload
    except Exception as e:
        import traceback
        error_payload = {
            'success': False,
            'contractVersion': RETRIEVE_CONTRACT_VERSION,
            'error_code': 'COGNEE_SDK_ERROR',
            'error_type': type(e).__name__,
            'message': str(e),
            'traceback': traceback.format_exc(),
            'error': f'Retrieval failed: {str(e)}'
        }
        try:
            logger.error("Unhandled exception", extra={'data': error_payload})
        except Exception:
            print(f"[ERROR] {json.dumps(error_payload)}", file=sys.stderr)
        return error_payload


def main():
    """Main entry point for the script."""

    # Plan 048: Support JSON payload via --json flag
    if len(sys.argv) >= 3 and sys.argv[1] == '--json':
        try:
            payload = json.loads(sys.argv[2])

            workspace_path = payload.get('workspace_path')
            query = payload.get('query')

            if not workspace_path or not query:
                result = {
                    'success': False,
                    'error': 'JSON payload must include workspace_path and query'
                }
                print(json.dumps(result))
                sys.exit(1)

            try:
                workspace_path = canonicalize_workspace_path(workspace_path)
            except FileNotFoundError:
                result = {
                    'success': False,
                    'error': f'Workspace path does not exist: {workspace_path}'
                }
                print(json.dumps(result))
                sys.exit(1)

            max_results = int(payload.get('max_results', 3))
            max_tokens = int(payload.get('max_tokens', 2000))
            half_life_days = clamp_half_life_days(float(payload.get('half_life_days', 7.0)))
            include_superseded = bool(payload.get('include_superseded', False))
            top_k = int(payload.get('search_top_k')) if payload.get('search_top_k') else None
            session_id = payload.get('__user_session_id')
            # Plan 063: Read advanced search settings from payload
            wide_search_top_k = int(payload.get('wide_search_top_k', 150))
            triplet_distance_penalty = float(payload.get('triplet_distance_penalty', 3.0))

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
                include_superseded,
                top_k,
                session_id,
                wide_search_top_k,
                triplet_distance_penalty
            ))

            # Output JSON result
            print(json.dumps(result))
            sys.exit(0 if result['success'] else 1)

        except json.JSONDecodeError as e:
            result = {'success': False, 'error': f'Invalid JSON: {str(e)}'}
            print(json.dumps(result))
            sys.exit(1)
        except Exception as e:
            import traceback
            result = {
                'success': False,
                'error': f'Unexpected error: {str(e)}',
                'traceback': traceback.format_exc()
            }
            print(json.dumps(result))
            sys.exit(1)

    # Check command-line arguments (minimum 2 required)
    if len(sys.argv) < 3:
        result = {
            'success': False,
            'error': 'Missing required arguments: workspace_path, query'
        }
        print(json.dumps(result))
        sys.exit(1)

    workspace_path = sys.argv[1]
    try:
        workspace_path = canonicalize_workspace_path(workspace_path)
    except FileNotFoundError:
        result = {
            'success': False,
            'error': f'Workspace path does not exist: {sys.argv[1]}'
        }
        print(json.dumps(result))
        sys.exit(1)

    query = sys.argv[2]

    # Optional parameters with defaults
    max_results = 3
    max_tokens = 2000
    half_life_days = 7.0
    include_superseded = False
    top_k = None

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

    if len(sys.argv) >= 8:
        try:
            top_k = int(sys.argv[7])
        except ValueError:
            result = {
                'success': False,
                'error': f'Invalid top_k: {sys.argv[7]} (must be integer)'
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
        half_life_days,
        include_superseded,
        top_k
    ))

    # Output JSON result
    print(json.dumps(result))

    # Exit with appropriate code
    sys.exit(0 if result['success'] else 1)


if __name__ == '__main__':
    main()
