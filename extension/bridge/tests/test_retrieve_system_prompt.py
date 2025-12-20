"""
Unit tests for retrieve.py system prompt injection.
"""
import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

@pytest.mark.asyncio
async def test_retrieve_passes_strict_system_prompt(temp_workspace, mock_env):
    """Test that retrieval passes the strict system prompt to cognee.search."""
    with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
      # Mock cognee package + required submodules
      mock_cognee = types.ModuleType('cognee')
      mock_cognee.__path__ = []
      mock_cognee.config = MagicMock()
      mock_cognee.search = AsyncMock(return_value=[])
      mock_cognee.prune = MagicMock()
      mock_cognee.prune.prune_data = AsyncMock()

      mock_context_globals = types.ModuleType('cognee.context_global_variables')
      mock_context_globals.set_session_user_context_variable = AsyncMock(return_value=None)

      mock_search_types = types.ModuleType('cognee.modules.search.types')
      mock_search_types.SearchType = MagicMock()
      mock_search_types.SearchType.GRAPH_COMPLETION = 'GRAPH_COMPLETION'

      mock_users_methods = types.ModuleType('cognee.modules.users.methods')
      mock_users_methods.get_default_user = AsyncMock(return_value=MagicMock(id='test-user'))

      with patch.dict('sys.modules', {
         'cognee': mock_cognee,
         'cognee.context_global_variables': mock_context_globals,
         'cognee.modules': types.ModuleType('cognee.modules'),
         'cognee.modules.search': types.ModuleType('cognee.modules.search'),
         'cognee.modules.search.types': mock_search_types,
         'cognee.modules.users': types.ModuleType('cognee.modules.users'),
         'cognee.modules.users.methods': mock_users_methods,
      }):
            from retrieve import retrieve_context

            await retrieve_context(str(temp_workspace), "test query")

            # Verify cognee.search was called
            assert mock_cognee.search.called

            # Get the kwargs passed to search
            call_kwargs = mock_cognee.search.call_args.kwargs

            # Verify system_prompt is present and correct
            assert 'system_prompt' in call_kwargs
            expected_prompt = """You are a MEMORY RETRIEVAL ASSISTANT for an autonomous coding agent.

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
            assert call_kwargs['system_prompt'] == expected_prompt
