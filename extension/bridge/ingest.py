#!/usr/bin/env python3
"""
Cognee Conversation Ingestion Script for VS Code Extension

Usage (conversation mode): python ingest.py <workspace_path> <user_message> <assistant_message> [importance]
Usage (summary mode):      python ingest.py --summary --summary-json '<json_string>'

Conversation Mode:
Ingests a conversation pair into Cognee with workspace-specific dataset isolation:
1. Loads API key from workspace .env
2. Generates unique dataset name for workspace
3. Creates conversation with timestamp and importance
4. Adds to workspace-specific dataset with dataset_name parameter
5. Runs cognify() with ontology scoped to workspace dataset

Summary Mode (Milestone 3):
Ingests a structured ConversationSummary as a DataPoint:
1. Parses JSON from --summary-json argument
2. Creates DataPoint with text template and metadata
3. Ingests DataPoint with workspace-specific dataset
4. Returns success with metadata confirmation

Returns JSON to stdout:
  Success: {"success": true, "ingested_chars": 357, "timestamp": "2025-11-09T14:32:21.234Z"}
  Failure: {"success": false, "error": "error message"}
"""

import asyncio
import io
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from time import perf_counter

from workspace_utils import generate_dataset_name


async def ingest_summary(
    workspace_path: str,
    summary_json: dict
) -> dict:
    """
    Ingest a structured ConversationSummary as a DataPoint.
    
    Implements Milestone 3: DataPoint-based summary ingestion with metadata.
    Creates DataPoint following DATAPOINT_SCHEMA.md specification.
    
    Args:
        workspace_path: Absolute path to VS Code workspace root
        summary_json: ConversationSummary object from TypeScript (already validated)
                     Expected structure:
                     {
                       "topic": str,
                       "context": str,
                       "decisions": [str],
                       "rationale": {key: str},
                       "open_questions": [str],
                       "next_steps": [str],
                       "references": [str],
                       "time_scope": {
                         "start": ISO8601 timestamp,
                         "end": ISO8601 timestamp,
                         "turn_count": int
                       },
                       "topic_id": str,
                       "session_id": str,
                       "plan_id": str or null,
                       "status": "active" | "completed" | "archived",
                       "created_at": ISO8601 timestamp,
                       "updated_at": ISO8601 timestamp
                     }
    
    Returns:
        Dictionary with success status, ingested_chars, timestamp, metadata
    """
    try:
        metrics = {}
        overall_start = perf_counter()
        
        # Step 1: Load workspace .env file
        step_start = perf_counter()
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
        
        metrics['load_env_sec'] = perf_counter() - step_start
        
        # Step 2: Import cognee and configure directories
        step_start = perf_counter()
        
        # Redirect stdout to suppress Cognee's print statements
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        
        try:
            import cognee
        finally:
            sys.stdout = old_stdout
        
        # Configure workspace-local storage directories
        cognee.config.system_root_directory(str(workspace_dir / '.cognee_system'))
        cognee.config.data_root_directory(str(workspace_dir / '.cognee_data'))
        
        metrics['init_cognee_sec'] = perf_counter() - step_start
        
        # Step 3: Configure LLM provider and API key
        step_start = perf_counter()
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
        metrics['config_llm_sec'] = perf_counter() - step_start
        
        # Step 4: Generate dataset name
        step_start = perf_counter()
        dataset_name, workspace_path_str = generate_dataset_name(workspace_path)
        metrics['dataset_sec'] = perf_counter() - step_start
        
        # Step 5: Create enriched summary text with embedded metadata per §4.4.1
        step_start = perf_counter()
        
        # CRITICAL per §4.4.1: Include template version tag for future migration support
        # Section headings must match summaryTemplate.ts and retrieve.py regex patterns exactly
        TEMPLATE_VERSION = "1.0"
        
        # Validate required timestamp fields (camelCase from TypeScript)
        created_ts = summary_json.get('createdAt')
        updated_ts = summary_json.get('updatedAt')
        
        if not created_ts:
            return {
                'success': False,
                'error': 'Summary missing required "createdAt" field (ISO 8601 timestamp)'
            }
        if not updated_ts:
            return {
                'success': False,
                'error': 'Summary missing required "updatedAt" field (ISO 8601 timestamp)'
            }
        
        # Format lists with (none) marker for empty sections
        def format_list(items):
            if not items or len(items) == 0:
                return '(none)'
            return '\n'.join(f'- {item}' for item in items)
        
        # Format summary with metadata embedded (Cognee 0.3.4 enriched-text fallback per §4.4.1)
        summary_text = f"""<!-- Template: v{TEMPLATE_VERSION} -->
# Conversation Summary: {summary_json['topic']}

**Metadata:**
- Topic ID: {summary_json['topicId']}
- Session ID: {summary_json.get('sessionId') or 'N/A'}
- Plan ID: {summary_json.get('planId') or 'N/A'}
- Status: {summary_json.get('status', 'Active')}
- Created: {created_ts}
- Updated: {updated_ts}

## Context
{summary_json['context']}

## Key Decisions
{format_list(summary_json.get('decisions', []))}

## Rationale
{format_list(summary_json.get('rationale', []))}

## Open Questions
{format_list(summary_json.get('openQuestions', []))}

## Next Steps
{format_list(summary_json.get('nextSteps', []))}

## References
{format_list(summary_json.get('references', []))}

## Time Scope
{summary_json.get('timeScope', '(not specified)')}
"""
        
        # Store metadata dictionary for response (camelCase from TypeScript)
        metadata = {
            'topic_id': summary_json.get('topicId'),
            'session_id': summary_json.get('sessionId'),
            'plan_id': summary_json.get('planId'),
            'status': summary_json.get('status', 'Active'),
            'created_at': created_ts,
            'updated_at': updated_ts
        }
        
        metrics['create_summary_text_sec'] = perf_counter() - step_start
        
        # Step 6: Add enriched summary text to dataset
        step_start = perf_counter()
        
        await cognee.add(
            data=[summary_text],
            dataset_name=dataset_name
        )
        
        metrics['add_sec'] = perf_counter() - step_start
        
        # Step 7: Cognify with dataset
        step_start = perf_counter()
        
        await cognee.cognify(datasets=[dataset_name])
        
        metrics['cognify_sec'] = perf_counter() - step_start
        metrics['total_ingest_sec'] = perf_counter() - overall_start
        
        # Calculate total characters
        ingested_chars = len(summary_text)
        
        # Log metrics
        print(f"Summary ingestion duration: {metrics['total_ingest_sec']:.3f} seconds", file=sys.stderr)
        print(f"Summary ingestion metrics: {json.dumps(metrics)}", file=sys.stderr)
        
        # Return success with metadata confirmation (use resolved created_ts)
        return {
            'success': True,
            'ingested_chars': ingested_chars,
            'timestamp': created_ts,
            'metadata': metadata,
            'ingestion_duration_sec': metrics['total_ingest_sec'],
            'ingestion_metrics': metrics
        }
        
    except ImportError as e:
        return {
            'success': False,
            'error': f'Failed to import required module: {str(e)}'
        }
    except KeyError as e:
        return {
            'success': False,
            'error': f'Invalid summary JSON structure: missing field {str(e)}'
        }
    except Exception as e:
        error_details = {
            'exception_type': type(e).__name__,
            'exception_message': str(e),
            'dataset_name': dataset_name if 'dataset_name' in locals() else 'unknown',
            'has_metadata': 'metadata' in locals()
        }
        print(f"Summary ingestion error details: {json.dumps(error_details, indent=2)}", file=sys.stderr)
        return {
            'success': False,
            'error': f'Summary ingestion failed ({type(e).__name__}): {str(e)}'
        }


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
        # Milestone 3 & 4: Initialize metrics dictionary and start overall timing
        metrics = {}
        overall_start = perf_counter()
        
        # Step 1: Load workspace .env file
        step_start = perf_counter()
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
        
        metrics['load_env_sec'] = perf_counter() - step_start
        
        # Step 2: Import cognee and configure directories
        step_start = perf_counter()
        
        # Redirect stdout to suppress Cognee's print statements
        # (e.g., "User X has registered") that break JSON parsing
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        
        try:
            # Import cognee (may print registration messages)
            import cognee
        finally:
            # Restore stdout for our JSON response
            sys.stdout = old_stdout
        
        # Configure workspace-local storage directories BEFORE any other cognee operations
        cognee.config.system_root_directory(str(workspace_dir / '.cognee_system'))
        cognee.config.data_root_directory(str(workspace_dir / '.cognee_data'))
        
        metrics['init_cognee_sec'] = perf_counter() - step_start
        
        # Step 3: Configure LLM provider and API key
        step_start = perf_counter()
        
        # Configure Cognee with API key
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
        
        metrics['config_llm_sec'] = perf_counter() - step_start
        
        # Step 4: Generate dataset name and resolve ontology
        step_start = perf_counter()
        
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
        
        metrics['dataset_ontology_sec'] = perf_counter() - step_start
        
        # Format conversation with simplified conversational prose format
        # Analysis Finding 3: Natural language format works best for Cognee's LLM extraction
        # Avoid bracketed metadata like [Timestamp: ...] which dilutes extraction signals
        conversation = f"""User asked: {user_message}

Assistant answered: {assistant_message}

Metadata: timestamp={timestamp}, importance={importance}"""
        
        # Step 5: Add data to this workspace's dataset
        step_start = perf_counter()
        
        # 3. Add data to this workspace's dataset (Task 3: using correct parameter names)
        await cognee.add(
            data=[conversation],
            dataset_name=dataset_name
        )
        
        metrics['add_sec'] = perf_counter() - step_start
        
        # Step 6: Cognify with datasets parameter
        step_start = perf_counter()
        
        # 4. Cognify with datasets parameter (Task 3: correct parameter, no ontology_file_path kwarg)
        # Note: Ontology configuration should be set via .env (ontology_file_path=/path/to/file.ttl)
        await cognee.cognify(datasets=[dataset_name])
        
        metrics['cognify_sec'] = perf_counter() - step_start
        metrics['total_ingest_sec'] = perf_counter() - overall_start
        
        # Note: This ensures the chat ontology is only applied to this workspace's data.
        # Tutorial data (with different dataset_name) remains separate and can use its own ontology.
        
        # Calculate total characters
        ingested_chars = len(conversation)
        
        # Milestone 3 & 4: Log metrics to stderr for debugging
        print(f"Ingestion duration: {metrics['total_ingest_sec']:.3f} seconds", file=sys.stderr)
        print(f"Ingestion metrics: {json.dumps(metrics)}", file=sys.stderr)
        
        # Milestone 3 & 4: Return success with duration and step-level metrics
        return {
            'success': True,
            'ingested_chars': ingested_chars,
            'timestamp': timestamp,
            'ingestion_duration_sec': metrics['total_ingest_sec'],
            'ingestion_metrics': metrics
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
    # Check for summary mode
    if '--summary' in sys.argv:
        # Summary mode: python ingest.py --summary --summary-json '<json_string>'
        try:
            summary_json_idx = sys.argv.index('--summary-json')
            if summary_json_idx + 1 >= len(sys.argv):
                result = {
                    'success': False,
                    'error': '--summary-json requires JSON string argument'
                }
                print(json.dumps(result))
                sys.exit(1)
            
            summary_json_str = sys.argv[summary_json_idx + 1]
            summary_json = json.loads(summary_json_str)
            
            # Extract workspace_path from JSON (required field)
            if 'workspace_path' not in summary_json:
                result = {
                    'success': False,
                    'error': 'Summary JSON must include workspace_path field'
                }
                print(json.dumps(result))
                sys.exit(1)
            
            workspace_path = summary_json['workspace_path']
            
            # Validate workspace path
            if not Path(workspace_path).is_dir():
                result = {
                    'success': False,
                    'error': f'Workspace path does not exist: {workspace_path}'
                }
                print(json.dumps(result))
                sys.exit(1)
            
            # Run summary ingestion
            result = asyncio.run(ingest_summary(workspace_path, summary_json))
            
        except ValueError as e:
            result = {
                'success': False,
                'error': f'Invalid JSON in --summary-json: {str(e)}'
            }
            print(json.dumps(result))
            sys.exit(1)
        except Exception as e:
            result = {
                'success': False,
                'error': f'Summary mode failed: {str(e)}'
            }
            print(json.dumps(result))
            sys.exit(1)
    
    else:
        # Conversation mode: python ingest.py <workspace_path> <user_message> <assistant_message> [importance]
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
        
        # Run conversation ingestion
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
