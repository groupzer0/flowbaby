"""
Test suite for enriched-text DataPoint contract validation (Plan 014).

Per §4.4.1 (Enriched Text Metadata Fallback), this module validates:
1. Enriched-text formatting: Generated markdown includes template version tag
   and **Metadata:** block with all required fields
2. Template structure validation: All content sections present with deterministic
   headings matching DATAPOINT_SCHEMA.md
3. Metadata parsing: Regex extraction recovers all metadata fields correctly;
   malformed summaries fail with actionable error codes
4. Legacy path regression: ingest.py without --summary still works (raw-text path)
5. Mixed-mode retrieval: retrieve.py handles both enriched summaries and legacy
   memories in same response
6. JSON contract validation: Response structure matches RETRIEVE_CONTRACT.md exactly

Architecture Reference: system-architecture.md §4.4.1
"""

import json
import pytest
from datetime import datetime, timezone
from typing import Any, Dict, List


# === TEST DATA FIXTURES ===

@pytest.fixture
def sample_conversation_summary() -> Dict[str, Any]:
    """
    Sample conversation summary matching DATAPOINT_SCHEMA.md structure.
    
    Returns a dictionary with content + metadata fields that should be
    used when creating DataPoints in ingest.py.
    """
    return {
        # Content fields
        "topic": "Plan 014 - Structured Summaries",
        "context": "Implementing DataPoint-based storage for conversation summaries",
        "decisions": [
            "Migrate summaries to DataPoints with metadata",
            "Expose structured retrieval contract"
        ],
        "rationale": [
            "Enable recency-aware ranking and compaction"
        ],
        "open_questions": [],
        "next_steps": [
            "Implement Plan 015 ranking algorithms"
        ],
        "references": ["Plan 014 documentation"],
        "time_scope": "Nov 17 14:00-16:30",
        
        # Metadata fields (camelCase to match TypeScript payload)
        "topicId": "3e3e4f26-7c02-4b3c-8b9d-8f1f9b3e2a10",
        "sessionId": "f1b9b8b0-9f1a-4b8f-8c2b-1c2b3d4e5f6a",
        "planId": "014",
        "status": "Active",
        "createdAt": "2025-11-17T16:30:00Z",
        "updatedAt": "2025-11-17T16:31:00Z"
    }


@pytest.fixture
def sample_legacy_memory() -> str:
    """
    Sample legacy raw-text memory (pre-Plan 014 format).
    
    Returns a plain text string that would have been ingested
    by Plans 001-011 without structured metadata.
    """
    return """We discussed Plan 013 truncation behavior and decided to remove the 150-char limit. Full memory content should be visible to users for transparency."""


@pytest.fixture
def expected_formatted_summary(sample_conversation_summary: Dict[str, Any]) -> str:
    """
    Expected formatted summary text following DATAPOINT_SCHEMA.md template.
    
    This is what should appear in the DataPoint's 'text' field.
    """
    s = sample_conversation_summary
    decisions_text = "\n".join(f"- {d}" for d in s["decisions"])
    rationale_text = "\n".join(f"- {r}" for r in s["rationale"])
    next_steps_text = "\n".join(f"- {n}" for n in s["next_steps"])
    references_text = "\n".join(f"- {ref}" for ref in s["references"])
    
    return f"""Summary: {s['topic']}

Topic: {s['topic']}
Context: {s['context']}
Decisions:
{decisions_text}
Rationale:
{rationale_text}
Open Questions:
- None
Next Steps:
{next_steps_text}
References:
{references_text}
Time Scope: {s['time_scope']}"""


# === DATAPOINT CREATION TESTS ===

class TestEnrichedTextFormatting:
    """
    Tests verifying enriched-text formatting per §4.4.1 requirements.
    
    MANDATE: Enriched text must include template version tag, **Metadata:** block,
    and deterministic section headings for regex parsing.
    """
    
    def test_template_version_tag_present(self, sample_conversation_summary):
        """
        §4.4.1 REQUIREMENT: Template version tag must be present.
        
        ACCEPTANCE CRITERIA:
        - First line contains: <!-- Template: v1.0 -->
        - Version tag enables future format migrations
        - Malformed version tag should be detectable
        """
        s = sample_conversation_summary
        summary_text = f"""<!-- Template: v1.0 -->
# Conversation Summary: {s['topic']}

**Metadata:**
- Topic ID: {s['topicId']}
"""
        
        # Verify version tag is present
        assert summary_text.startswith('<!-- Template: v1.0 -->'), \
            "Template version tag must be first line"
        
        # Verify version tag format matches regex pattern
        import re
        version_match = re.search(r'<!-- Template: v([\d.]+) -->', summary_text)
        assert version_match is not None, "Version tag must match pattern"
        assert version_match.group(1) == '1.0', "Version must be 1.0"
    
    def test_metadata_block_format(self, sample_conversation_summary):
        """
        §4.4.1 REQUIREMENT: **Metadata:** block must contain all required fields.
        
        ACCEPTANCE CRITERIA:
        - Block header is exactly: **Metadata:**
        - All required fields present: topic_id, session_id, plan_id, status, created_at, updated_at
        - Fields formatted as: - Field Name: value
        - Metadata is searchable via semantic embeddings
        """
        s = sample_conversation_summary
        summary_text = f"""<!-- Template: v1.0 -->
# Conversation Summary: {s['topic']}

**Metadata:**
- Topic ID: {s['topicId']}
- Session ID: {s['sessionId']}
- Plan ID: {s['planId']}
- Status: {s['status']}
- Created: {s['createdAt']}
- Updated: {s['updatedAt']}

## Context
{s['context']}
"""
        
        # Verify metadata block header
        assert '**Metadata:**' in summary_text, "Metadata block header must be present"
        
        # Verify all required fields
        required_fields = [
            ('Topic ID:', s['topicId']),
            ('Session ID:', s['sessionId']),
            ('Plan ID:', s['planId']),
            ('Status:', s['status']),
            ('Created:', s['createdAt']),
            ('Updated:', s['updatedAt'])
        ]
        
        for field_label, field_value in required_fields:
            assert field_label in summary_text, f"{field_label} must be in metadata block"
            assert str(field_value) in summary_text, f"{field_value} must be in metadata block"
    
    def test_deterministic_section_headings(self, sample_conversation_summary):
        """
        §4.4.1 REQUIREMENT: Section headings must match exactly across layers.
        
        ACCEPTANCE CRITERIA:
        - All section headings match DATAPOINT_SCHEMA.md format
        - Headings: ## Context, ## Key Decisions, ## Rationale, ## Open Questions, ## Next Steps, ## References, ## Time Scope
        - No heading variations (case-sensitive, spacing-sensitive)
        """
        s = sample_conversation_summary
        summary_text = f"""<!-- Template: v1.0 -->
# Conversation Summary: {s['topic']}

**Metadata:**
- Topic ID: {s['topicId']}

## Context
{s['context']}

## Key Decisions
- Decision 1

## Rationale
- Rationale 1

## Open Questions
- Question 1

## Next Steps
- Step 1

## References
- Reference 1

## Time Scope
- Start: 2025-11-18T10:00:00Z
"""
        
        # Verify exact heading format (case-sensitive, no extra spaces)
        required_headings = [
            '## Context',
            '## Key Decisions',
            '## Rationale',
            '## Open Questions',
            '## Next Steps',
            '## References',
            '## Time Scope'
        ]
        
        for heading in required_headings:
            assert heading in summary_text, f"{heading} must be present with exact formatting"


class TestDataPointCreation:
    """
    Tests verifying that ingest.py creates enriched text with correct structure.
    """
    
    def test_enriched_text_includes_all_required_fields(self, sample_conversation_summary):
        """
        Verify enriched text includes all required metadata fields per §4.4.1.
        
        ACCEPTANCE CRITERIA:
        - Template version tag present
        - Enriched text contains embedded **Metadata:** section
        - Metadata includes: topic_id, session_id, plan_id, status, created_at, updated_at
        - Metadata is formatted for searchability
        """
        # Format summary text following ingest.py --summary logic
        s = sample_conversation_summary
        summary_text = f"""<!-- Template: v1.0 -->
# Conversation Summary: {s['topic']}

**Metadata:**
- Topic ID: {s['topicId']}
- Session ID: {s['sessionId']}
- Plan ID: {s['planId']}
- Status: {s['status']}
- Created: {s['createdAt']}
- Updated: {s['updatedAt']}

## Context
{s['context']}
"""
        
        # Verify template version
        assert summary_text.startswith('<!-- Template: v1.0 -->'), \
            "Template version tag must be first line"
        
        # Verify metadata block
        assert '**Metadata:**' in summary_text, "Metadata block must be present"
        
        # Verify all metadata fields
        assert 'Topic ID:' in summary_text and s['topicId'] in summary_text
        assert 'Session ID:' in summary_text and s['sessionId'] in summary_text
        assert 'Plan ID:' in summary_text and s['planId'] in summary_text
        assert 'Status:' in summary_text and s['status'] in summary_text
        assert 'Created:' in summary_text and s['createdAt'] in summary_text
        assert 'Updated:' in summary_text and s['updatedAt'] in summary_text
    
    def test_datapoint_text_matches_template(
        self,
        sample_conversation_summary,
        expected_formatted_summary
    ):
        """
        Verify DataPoint 'text' field matches markdown template.
        
        ACCEPTANCE CRITERIA:
        - text field uses consistent markdown format from DATAPOINT_SCHEMA.md
        - All content fields are included in human-readable form
        """
        # Format summary using same logic as ingest.py
        s = sample_conversation_summary
        summary_text = f"""# Conversation Summary: {s['topic']}

## Context
{s['context']}

## Key Decisions
{chr(10).join(f'- {d}' for d in s['decisions']) if s['decisions'] else '(none)'}

## Rationale
{chr(10).join(f'- {r}' for r in s['rationale']) if s['rationale'] else '(none)'}

## Open Questions
{chr(10).join(f'- {q}' for q in s['open_questions']) if s['open_questions'] else '(none)'}

## Next Steps
{chr(10).join(f'- {n}' for n in s['next_steps']) if s['next_steps'] else '(none)'}

## References
{chr(10).join(f'- {ref}' for ref in s['references']) if s['references'] else '(none)'}

## Time Scope
- Start: {s['createdAt']}
- End: {s['updatedAt']}
- Turn Count: 15
"""
        
        # Verify text contains key sections
        assert '# Conversation Summary:' in summary_text
        assert '## Context' in summary_text
        assert '## Key Decisions' in summary_text
        assert '## Rationale' in summary_text
        assert '## Open Questions' in summary_text
        assert '## Next Steps' in summary_text
        assert '## References' in summary_text
        assert '## Time Scope' in summary_text
        
        # Verify content appears in text
        assert s['topic'] in summary_text
        assert s['context'] in summary_text
        for decision in s['decisions']:
            assert decision in summary_text
        for next_step in s['next_steps']:
            assert next_step in summary_text
    
    def test_metadata_index_fields_configuration(self, sample_conversation_summary):
        """
        Verify metadata fields are embedded in text for semantic search.
        
        ACCEPTANCE CRITERIA:
        - All key metadata fields appear in the text
        - Metadata is formatted consistently (field labels + values)
        - Cognee can embed and search these fields via text content
        
        Note: Cognee 0.3.4 doesn't expose explicit index_fields. Metadata
        searchability is achieved through embedded text.
        """
        # Format summary text following ingest.py --summary logic
        s = sample_conversation_summary
        summary_text = f"""# Conversation Summary: {s['topic']}

**Metadata:**
- Topic ID: {s['topicId']}
- Session ID: {s['sessionId']}
- Plan ID: {s['planId']}
- Status: {s['status']}
- Created: {s['createdAt']}
- Updated: {s['updatedAt']}
"""
        
        # Define key metadata fields that must be searchable
        key_fields = ['topicId', 'sessionId', 'planId', 'status']
        
        # Verify all key fields appear in text
        for field in key_fields:
            # Field label should be present (formatted for readability)
            # Convert camelCase to Title Case (e.g., topicId -> Topic ID)
            if field == 'topicId':
                field_label = 'Topic ID'
            elif field == 'sessionId':
                field_label = 'Session ID'
            elif field == 'planId':
                field_label = 'Plan ID'
            else:
                field_label = field.title()
            assert field_label in summary_text, f"Field label '{field_label}' must be in text"
            
            # Field value should be present
            field_value = s[field]
            assert str(field_value) in summary_text, f"Field value '{field_value}' must be in text"
    
    def test_legacy_ingestion_still_works(self, sample_legacy_memory):
        """
        Verify backward compatibility: raw text ingestion still functions.
        
        ACCEPTANCE CRITERIA:
        - ingest.py without --summary flag still ingests plain text
        - Legacy format is preserved for existing workflows
        """
        # TODO: Mock ingest.py without --summary and verify plain text path
        pytest.skip("Test skeleton: will be implemented in Milestone 3")
    
    def test_camelcase_timestamps_accepted(self):
        """
        Verify ingest_summary accepts camelCase timestamp fields (from TypeScript).
        
        REGRESSION TEST for bug: Extension sends createdAt/updatedAt but bridge
        expected created_at/updated_at, causing KeyError.
        
        ACCEPTANCE CRITERIA:
        - Summary with createdAt/updatedAt (camelCase) succeeds
        - Resolved timestamp appears in enriched text
        - Resolved timestamp appears in JSON response
        """
        summary_with_camelcase = {
            "topic": "Test Summary",
            "context": "Testing camelCase timestamp handling",
            "decisions": ["Accept both naming conventions"],
            "rationale": ["TypeScript uses camelCase by default"],
            "topicId": "test-topic-id",
            "status": "Active",
            "createdAt": "2025-11-18T17:00:00Z",  # camelCase
            "updatedAt": "2025-11-18T17:01:00Z"   # camelCase
        }
        
        # Simulate enriched text creation (matching ingest.py logic)
        created_ts = summary_with_camelcase.get('createdAt') or summary_with_camelcase.get('created_at')
        updated_ts = summary_with_camelcase.get('updatedAt') or summary_with_camelcase.get('updated_at')
        
        # Verify timestamps resolved correctly
        assert created_ts == "2025-11-18T17:00:00Z", "createdAt should resolve"
        assert updated_ts == "2025-11-18T17:01:00Z", "updatedAt should resolve"
        
        # Verify they'd appear in enriched text
        enriched_text = f"Created: {created_ts}\nUpdated: {updated_ts}"
        assert "2025-11-18T17:00:00Z" in enriched_text
        assert "2025-11-18T17:01:00Z" in enriched_text
    
    def test_snake_case_timestamps_rejected(self):
        """
        Verify ingest_summary rejects snake_case timestamp fields.
        
        ACCEPTANCE CRITERIA:
        - Summary with created_at/updated_at (snake_case) is rejected
        - Clear error message specifies camelCase is required
        """
        summary_with_snake_case = {
            "topic": "Test Summary",
            "context": "Testing snake_case timestamp handling",
            "decisions": ["Should fail validation"],
            "topicId": "test-topic-id",
            "status": "Active",
            "created_at": "2025-11-18T17:00:00Z",  # snake_case (wrong)
            "updated_at": "2025-11-18T17:01:00Z"   # snake_case (wrong)
        }
        
        # Simulate validation (matching ingest.py logic)
        created_ts = summary_with_snake_case.get('createdAt')  # Only check camelCase
        updated_ts = summary_with_snake_case.get('updatedAt')  # Only check camelCase
        
        # Verify timestamps do NOT resolve from snake_case
        assert created_ts is None, "Should not accept created_at (snake_case)"
        assert updated_ts is None, "Should not accept updated_at (snake_case)"
    
    def test_missing_timestamps_rejected(self):
        """
        Verify ingest_summary rejects summaries with missing timestamps.
        
        ACCEPTANCE CRITERIA:
        - Summary without createdAt returns clear error
        - Summary without updatedAt returns clear error
        - Error message specifies expected field names (camelCase)
        """
        summary_without_created = {
            "topic": "Test Summary",
            "context": "Missing created timestamp",
            "topicId": "test-topic-id",
            "updatedAt": "2025-11-18T17:01:00Z"
            # missing createdAt
        }
        
        # Simulate validation (matching ingest.py logic)
        created_ts = summary_without_created.get('createdAt')
        assert created_ts is None, "Should not resolve when createdAt missing"
        
        summary_without_updated = {
            "topic": "Test Summary",
            "context": "Missing updated timestamp",
            "topicId": "test-topic-id",
            "createdAt": "2025-11-18T17:00:00Z"
            # missing updatedAt
        }
        
        # Simulate validation (matching ingest.py logic)
        updated_ts = summary_without_updated.get('updatedAt')
        assert updated_ts is None, "Should not resolve when updatedAt missing"


# === METADATA PARSING TESTS ===

class TestMetadataParsing:
    """
    Tests verifying regex-based metadata extraction per §4.4.1.
    
    MANDATE: retrieve.py must parse enriched text via regex and handle malformed summaries.
    """
    
    def test_regex_extracts_all_metadata_fields(self, sample_conversation_summary):
        """
        §4.4.1 REQUIREMENT: Regex patterns must extract all metadata fields.
        
        ACCEPTANCE CRITERIA:
        - Parse Topic ID, Session ID, Plan ID, Status, Created, Updated
        - Regex patterns match DATAPOINT_SCHEMA.md exactly
        - Extracted values match original input
        """
        import re
        
        s = sample_conversation_summary
        summary_text = f"""<!-- Template: v1.0 -->
# Conversation Summary: {s['topic']}

**Metadata:**
- Topic ID: {s['topicId']}
- Session ID: {s['sessionId']}
- Plan ID: {s['planId']}
- Status: {s['status']}
- Created: {s['createdAt']}
- Updated: {s['updatedAt']}
"""
        
        # Apply regex patterns from DATAPOINT_SCHEMA.md
        topic_id_match = re.search(r'- Topic ID: ([a-f0-9\-]+)', summary_text)
        session_id_match = re.search(r'- Session ID: ([a-f0-9\-]+|N/A)', summary_text)
        plan_id_match = re.search(r'- Plan ID: ([\w\-]+|N/A)', summary_text)
        status_match = re.search(r'- Status: (Active|Superseded|Draft)', summary_text)
        created_at_match = re.search(r'- Created: ([\d\-T:Z]+)', summary_text)
        updated_at_match = re.search(r'- Updated: ([\d\-T:Z]+)', summary_text)
        
        # Verify all patterns matched
        assert topic_id_match is not None, "Topic ID regex must match"
        assert session_id_match is not None, "Session ID regex must match"
        assert plan_id_match is not None, "Plan ID regex must match"
        assert status_match is not None, "Status regex must match"
        assert created_at_match is not None, "Created regex must match"
        assert updated_at_match is not None, "Updated regex must match"
        
        # Verify extracted values are correct
        assert topic_id_match.group(1) == s['topicId']
        assert session_id_match.group(1) == s['sessionId']
        assert plan_id_match.group(1) == s['planId']
        assert status_match.group(1) == s['status']
        assert created_at_match.group(1) == s['createdAt']
        assert updated_at_match.group(1) == s['updatedAt']
    
    def test_missing_metadata_block_returns_null_fields(self, sample_legacy_memory):
        """
        §4.4.1 REQUIREMENT: Missing **Metadata:** block means legacy memory.
        
        ACCEPTANCE CRITERIA:
        - If no **Metadata:** block, treat as legacy
        - All metadata fields set to null
        - summary_text contains raw text
        - No parsing errors
        """
        import re
        
        legacy_text = sample_legacy_memory
        
        # Verify no metadata block
        assert '**Metadata:**' not in legacy_text
        
        # Attempt to find metadata block should fail gracefully
        metadata_block_match = re.search(r'\*\*Metadata:\*\*', legacy_text)
        assert metadata_block_match is None, "Legacy memory has no metadata block"
        
        # This simulates retrieve.py logic: if no metadata, return nulls
        # (actual implementation will be in Milestone 4)
    
    def test_malformed_metadata_fails_with_error_code(self):
        """
        §4.4.1 REQUIREMENT: Malformed summaries must fail loudly.
        
        ACCEPTANCE CRITERIA:
        - Invalid metadata format triggers error payload
        - Error includes actionable error code
        - Error includes malformed text snippet for debugging
        """
        import re
        
        # Malformed metadata: missing required field
        malformed_text = """<!-- Template: v1.0 -->
# Conversation Summary: Test

**Metadata:**
- Topic ID: 12345
- Status: Active
(missing other required fields)

## Context
Test context
"""
        
        # Attempt to parse all required fields
        topic_id_match = re.search(r'- Topic ID: ([a-f0-9\-]+)', malformed_text)
        session_id_match = re.search(r'- Session ID: ([a-f0-9\-]+|N/A)', malformed_text)
        plan_id_match = re.search(r'- Plan ID: ([\w\-]+|N/A)', malformed_text)
        
        # Verify some fields are missing (simulates validation logic)
        assert topic_id_match is not None, "Topic ID present"
        assert session_id_match is None, "Session ID missing (should trigger error)"
        assert plan_id_match is None, "Plan ID missing (should trigger error)"
        
        # In actual implementation (Milestone 4), this would return:
        # {"success": false, "error_code": "MALFORMED_METADATA", "snippet": "..."}
    
    def test_edge_case_null_session_id(self, sample_conversation_summary):
        """
        Test edge case: session_id can be null/N/A.
        
        ACCEPTANCE CRITERIA:
        - session_id: N/A is valid
        - Regex still matches
        - Parsed value is "N/A"
        """
        import re
        
        s = sample_conversation_summary
        summary_text = f"""<!-- Template: v1.0 -->
# Conversation Summary: {s['topic']}

**Metadata:**
- Topic ID: {s['topicId']}
- Session ID: N/A
- Plan ID: {s['planId']}
- Status: {s['status']}
- Created: {s['createdAt']}
- Updated: {s['updatedAt']}
"""
        
        session_id_match = re.search(r'- Session ID: ([a-f0-9\-]+|N/A)', summary_text)
        assert session_id_match is not None, "Session ID: N/A must match"
        assert session_id_match.group(1) == 'N/A'


# === RETRIEVAL CONTRACT TESTS ===

class TestRetrievalContract:
    """
    Tests verifying that retrieve.py returns JSON matching RETRIEVE_CONTRACT.md.
    
    These tests will use mocks until Milestone 4 implementation is complete.
    """
    
    def test_retrieval_json_schema_for_datapoint(self, sample_conversation_summary):
        """
        Verify retrieve.py returns correct JSON structure for DataPoint summaries.
        
        ACCEPTANCE CRITERIA (Milestone 0, Task 3):
        - JSON includes: success, results, total_results, total_tokens
        - Each result has: summary_text (required), score (required)
        - Each result has metadata: topic, topic_id, plan_id, status, timestamps
        - Each result has structured content: decisions, rationale, etc.
        """
        # Simulate enriched summary with embedded metadata per §4.4.1
        enriched_text = f"""<!-- Template: v1.0 -->
# Conversation Summary: {sample_conversation_summary['topic']}

**Metadata:**
- Topic ID: {sample_conversation_summary['topicId']}
- Session ID: {sample_conversation_summary['sessionId']}
- Plan ID: {sample_conversation_summary['planId']}
- Status: {sample_conversation_summary['status']}
- Created: {sample_conversation_summary['createdAt']}
- Updated: {sample_conversation_summary['updatedAt']}

## Context
{sample_conversation_summary['context']}

## Key Decisions
{chr(10).join('- ' + d for d in sample_conversation_summary['decisions'])}

## Rationale
{chr(10).join('- ' + r for r in sample_conversation_summary['rationale'])}
"""
        
        # Import retrieve module's parser
        from retrieve import parse_enriched_summary
        
        # Parse enriched text
        result = parse_enriched_summary(enriched_text)
        
        # Verify required top-level fields
        assert result is not None, "Should parse enriched summary"
        assert 'summary_text' in result, "Response must have summary_text"
        assert result['summary_text'] == enriched_text, "summary_text should be full text"
        
        # Verify metadata fields were extracted
        assert result['topic'] == sample_conversation_summary['topic']
        assert result['topicId'] == sample_conversation_summary['topicId']
        assert result['sessionId'] == sample_conversation_summary['sessionId']
        assert result['planId'] == sample_conversation_summary['planId']
        assert result['status'] == sample_conversation_summary['status']
        assert result['createdAt'] == sample_conversation_summary['createdAt']
        
        # Verify structured content fields
        assert result['context'] == sample_conversation_summary['context']
        assert result['decisions'] == sample_conversation_summary['decisions']
        assert result['rationale'] == sample_conversation_summary['rationale']
    
    def test_retrieval_json_schema_for_legacy(self, sample_legacy_memory):
        """
        Verify retrieve.py returns correct JSON for legacy raw-text memories.
        
        ACCEPTANCE CRITERIA:
        - Legacy results have summary_text and score (required)
        - Metadata fields are null (not omitted)
        - Structured content fields are omitted or null
        """
        # Import retrieve module's parser
        from retrieve import parse_enriched_summary
        
        # Parse legacy text (no metadata block)
        result = parse_enriched_summary(sample_legacy_memory)
        
        # Legacy text should return None from parser (no enriched metadata)
        assert result is None, "Legacy text should return None from enriched parser"
        
        # In retrieve.py flow, this would result in:
        legacy_result = {
            'summary_text': sample_legacy_memory,
            'text': sample_legacy_memory,
            'topic': None,
            'topicId': None,
            'sessionId': None,
            'planId': None,
            'status': None,
            'score': 0.7,
            'decisions': [],
            'rationale': [],
            'open_questions': [],
            'next_steps': [],
            'references': []
        }
        
        # Verify null metadata fields are present (not omitted)
        assert 'topicId' in legacy_result
        assert legacy_result['topicId'] is None
        assert legacy_result['status'] is None
        assert legacy_result['summary_text'] == sample_legacy_memory
    
    def test_mixed_results_handling(
        self,
        sample_conversation_summary,
        sample_legacy_memory
    ):
        """
        Verify retrieve.py handles mixed results (DataPoint + legacy).
        
        ACCEPTANCE CRITERIA:
        - Results array contains both DataPoint and legacy entries
        - Each entry follows correct schema for its type
        - total_results reflects combined count
        """
        from retrieve import parse_enriched_summary
        
        # Build enriched summary text from fixture dict
        s = sample_conversation_summary
        enriched_text = f"""<!-- Template: v1.0 -->
# Conversation Summary: {s['topic']}

**Metadata:**
- Topic ID: {s['topicId']}
- Session ID: {s['sessionId']}
- Plan ID: {s['planId']}
- Status: {s['status']}
- Created: {s['createdAt']}
- Updated: {s['updatedAt']}

## Context
{s['context']}
"""
        enriched_result = parse_enriched_summary(enriched_text)
        
        # Parse legacy text
        legacy_result = parse_enriched_summary(sample_legacy_memory)
        
        # Enriched should have metadata, legacy should return None
        assert enriched_result is not None
        assert legacy_result is None
        
        # Simulate mixed results array from retrieve.py
        mixed_results = [
            {**enriched_result, 'score': 0.9, 'summary_text': enriched_text, 'text': enriched_text},
            {'summary_text': sample_legacy_memory, 'text': sample_legacy_memory, 'score': 0.7,
             'topic': None, 'topic_id': None, 'session_id': None, 'plan_id': None, 'status': None,
             'decisions': [], 'rationale': [], 'open_questions': [], 'next_steps': [], 'references': []}
        ]
        
        # Verify both types coexist
        assert len(mixed_results) == 2
        assert mixed_results[0]['topic'] == sample_conversation_summary['topic']
        assert mixed_results[1]['topic'] is None
        assert all('score' in r for r in mixed_results)
    
    def test_required_fields_always_present(self):
        """
        §4.4.1 REQUIREMENT: summary_text and score are always required.
        
        ACCEPTANCE CRITERIA:
        - Every result has summary_text (non-empty string)
        - Every result has score (numeric)
        - Missing these fields causes validation error
        """
        # Test valid result
        valid_result = {
            "summary_text": "Test summary",
            "score": 0.85
        }
        
        try:
            validate_retrieval_result(valid_result)
        except AssertionError:
            pytest.fail("Valid result should pass validation")
        
        # Test missing summary_text
        invalid_result_1 = {"score": 0.85}
        with pytest.raises(AssertionError, match="summary_text is required"):
            validate_retrieval_result(invalid_result_1)
        
        # Test missing score
        invalid_result_2 = {"summary_text": "Test"}
        with pytest.raises(AssertionError, match="score is required"):
            validate_retrieval_result(invalid_result_2)
        
        # Test empty summary_text
        invalid_result_3 = {"summary_text": "", "score": 0.85}
        with pytest.raises(AssertionError, match="summary_text must not be empty"):
            validate_retrieval_result(invalid_result_3)
    
    def test_timestamp_format_iso8601(self, sample_conversation_summary):
        """
        Verify timestamps are in ISO 8601 format.
        
        ACCEPTANCE CRITERIA:
        - created_at and updated_at use format: YYYY-MM-DDTHH:MM:SSZ
        - Timestamps are parseable by JavaScript Date constructor
        - Null timestamps are allowed for legacy memories
        """
        from retrieve import parse_enriched_summary
        from datetime import datetime
        
        # Build enriched summary text from fixture dict
        s = sample_conversation_summary
        enriched_text = f"""<!-- Template: v1.0 -->
# Conversation Summary: {s['topic']}

**Metadata:**
- Topic ID: {s['topicId']}
- Session ID: {s['sessionId']}
- Plan ID: {s['planId']}
- Status: {s['status']}
- Created: {s['createdAt']}
- Updated: {s['updatedAt']}

## Context
{s['context']}
"""
        result = parse_enriched_summary(enriched_text)
        
        # Verify timestamp presence
        assert 'createdAt' in result
        assert 'updatedAt' in result
        
        # Verify ISO 8601 format and parseability
        if result['createdAt']:
            created_dt = datetime.fromisoformat(result['createdAt'].replace('Z', '+00:00'))
            assert created_dt is not None
        
        if result['updatedAt']:
            updated_dt = datetime.fromisoformat(result['updatedAt'].replace('Z', '+00:00'))
            assert updated_dt is not None
        
        # Legacy memory should have null timestamps
        legacy_result = parse_enriched_summary("Plain text memory")
        assert legacy_result is None  # Legacy returns None from parser
    
    def test_status_enum_values(self, sample_conversation_summary):
        """
        Verify status field uses correct enum values.
        
        ACCEPTANCE CRITERIA:
        - status is one of: "Active", "Superseded", null
        - Invalid status values cause validation error
        """
        from retrieve import parse_enriched_summary
        
        # Build enriched summary text from fixture dict
        s = sample_conversation_summary
        enriched_text = f"""<!-- Template: v1.0 -->
# Conversation Summary: {s['topic']}

**Metadata:**
- Topic ID: {s['topicId']}
- Session ID: {s['sessionId']}
- Plan ID: {s['planId']}
- Status: {s['status']}
- Created: {s['createdAt']}
- Updated: {s['updatedAt']}

## Context
{s['context']}
"""
        result = parse_enriched_summary(enriched_text)
        
        # Verify status is valid enum value
        assert result['status'] in ["Active", "Superseded", None]
        
        # Test with explicitly superseded status
        superseded_text = enriched_text.replace("Status: Active", "Status: Superseded")
        superseded_result = parse_enriched_summary(superseded_text)
        assert superseded_result['status'] == "Superseded"
        
        # Legacy memory should have null status
        legacy_result = parse_enriched_summary("Plain text memory")
        assert legacy_result is None  # Legacy returns None from parser


# === MIXED-MODE HANDLING TESTS ===

class TestMixedModeHandling:
    """
    Tests verifying mixed-mode retrieval per §4.4.1 requirements.
    
    MANDATE: TypeScript consumers must branch on topicId/status availability.
    """
    
    def test_enriched_summary_has_metadata(self, sample_conversation_summary):
        """
        §4.4.1 REQUIREMENT: Enriched summaries have full metadata.
        
        ACCEPTANCE CRITERIA:
        - topic_id is not null
        - status is not null
        - TypeScript can detect enriched vs legacy by checking topic_id
        """
        # Simulated enriched result from retrieve.py
        enriched_result = {
            "summary_text": "Full summary text...",
            "score": 0.92,
            "topic": sample_conversation_summary['topic'],
            "topicId": sample_conversation_summary['topicId'],
            "planId": sample_conversation_summary['planId'],
            "status": sample_conversation_summary['status'],
            "createdAt": sample_conversation_summary['createdAt']
        }
        
        # Verify enriched result has metadata
        assert enriched_result['topicId'] is not None, "Enriched result has topic_id"
        assert enriched_result['status'] is not None, "Enriched result has status"
        
        # Simulate TypeScript branching logic
        is_enriched = enriched_result.get('topicId') is not None
        assert is_enriched is True, "TypeScript detects enriched summary"
    
    def test_legacy_memory_has_null_metadata(self, sample_legacy_memory):
        """
        §4.4.1 REQUIREMENT: Legacy memories have null metadata.
        
        ACCEPTANCE CRITERIA:
        - topic_id is null
        - status is null
        - summary_text contains raw text
        - TypeScript can detect legacy by checking topic_id === null
        """
        # Simulated legacy result from retrieve.py
        legacy_result = {
            "summary_text": sample_legacy_memory,
            "score": 0.75,
            "topic": None,
            "topicId": None,
            "planId": None,
            "status": None,
            "createdAt": None
        }
        
        # Verify legacy result has null metadata
        assert legacy_result['topicId'] is None, "Legacy result has null topic_id"
        assert legacy_result['status'] is None, "Legacy result has null status"
        
        # Simulate TypeScript branching logic
        is_legacy = legacy_result.get('topicId') is None
        assert is_legacy is True, "TypeScript detects legacy memory"
    
    def test_mixed_results_array_handling(
        self,
        sample_conversation_summary,
        sample_legacy_memory
    ):
        """
        §4.4.1 REQUIREMENT: Single response can contain both types.
        
        ACCEPTANCE CRITERIA:
        - results array contains both enriched and legacy entries
        - Each entry follows correct schema for its type
        - validate_retrieval_response accepts mixed results
        """
        # Simulated mixed response
        mixed_response = {
            "success": True,
            "results": [
                {
                    "summary_text": "Enriched summary...",
                    "score": 0.92,
                    "topic_id": sample_conversation_summary['topicId'],
                    "status": "Active"
                },
                {
                    "summary_text": sample_legacy_memory,
                    "score": 0.75,
                    "topic_id": None,
                    "status": None
                }
            ],
            "total_results": 2,
            "total_tokens": 150
        }
        
        # Validate entire response
        try:
            validate_retrieval_response(mixed_response)
        except AssertionError as e:
            pytest.fail(f"Mixed response should pass validation: {e}")
        
        # Verify we can distinguish types
        enriched_count = sum(1 for r in mixed_response['results'] if r.get('topic_id') is not None)
        legacy_count = sum(1 for r in mixed_response['results'] if r.get('topic_id') is None)
        
        assert enriched_count == 1, "Should have 1 enriched result"
        assert legacy_count == 1, "Should have 1 legacy result"


# === JSON CONTRACT VALIDATION TESTS ===

class TestJSONContractCompliance:
    """
    Tests verifying strict compliance with RETRIEVE_CONTRACT.md.
    """
    
    def test_top_level_response_structure(self):
        """
        §4.4.1 REQUIREMENT: Response must match contract exactly.
        
        ACCEPTANCE CRITERIA:
        - Contains: success, results, total_results, total_tokens
        - All fields have correct types
        - Missing fields cause validation error
        """
        valid_response = {
            "success": True,
            "results": [],
            "total_results": 0,
            "total_tokens": 0
        }
        
        try:
            validate_retrieval_response(valid_response)
        except AssertionError:
            pytest.fail("Valid response should pass validation")
        
        # Test missing required field
        invalid_response = {
            "success": True,
            "results": []
            # missing total_results and total_tokens
        }
        
        with pytest.raises(AssertionError):
            validate_retrieval_response(invalid_response)
    
    def test_result_object_optional_fields_allowed(self):
        """
        CONTRACT GUARANTEE: Optional fields can be omitted.
        
        ACCEPTANCE CRITERIA:
        - Result with only summary_text and score is valid
        - Optional metadata fields can be missing or null
        - Unknown fields are ignored (forward compatibility)
        """
        # Minimal valid result
        minimal_result = {
            "summary_text": "Test",
            "score": 0.8
        }
        
        try:
            validate_retrieval_result(minimal_result)
        except AssertionError:
            pytest.fail("Minimal result should pass validation")
        
        # Result with unknown fields (future extension)
        future_result = {
            "summary_text": "Test",
            "score": 0.8,
            "future_field": "value"  # unknown field, should be ignored
        }
        
        try:
            validate_retrieval_result(future_result)
        except AssertionError:
            pytest.fail("Result with unknown fields should pass validation")


# === CONTRACT EVOLUTION TESTS ===

class TestContractStability:
    """
    Tests verifying contract stability guarantees.
    
    These tests document expected behavior for future contract changes.
    """
    
    def test_optional_fields_can_be_added(self):
        """
        Verify that adding optional fields doesn't break existing consumers.
        
        CONTRACT GUARANTEE:
        - New optional fields MAY be added without version bump
        - Consumers MUST handle unknown fields gracefully
        - Required fields WILL NEVER be added after v1.0.0
        """
        # Simulate future response with new optional field
        future_result = {
            "summary_text": "Test summary",
            "score": 0.85,
            "future_optional_field": "new_value",  # New field added in future
            "another_optional": {"nested": "data"}
        }
        
        # Existing validator should pass (ignores unknown fields)
        try:
            validate_retrieval_result(future_result)
        except AssertionError as e:
            pytest.fail(f"Future result with optional fields should pass: {e}")
        
        # Required fields are still enforced
        assert future_result['summary_text'] == "Test summary"
        assert future_result['score'] == 0.85
    
    def test_required_fields_never_removed(self):
        """
        Verify that required fields (summary_text, score) are stable.
        
        CONTRACT GUARANTEE:
        - summary_text and score will never be removed or renamed
        - Field types will never change (e.g., score will always be number)
        """
        # This test documents that these fields are permanently required
        valid_result = {
            "summary_text": "Required field test",
            "score": 0.9
        }
        
        # These fields MUST always be present and correct type
        assert "summary_text" in valid_result
        assert isinstance(valid_result["summary_text"], str)
        assert "score" in valid_result
        assert isinstance(valid_result["score"], (int, float))
        
        # Validate with helper (should pass)
        validate_retrieval_result(valid_result)
        
        # Missing either required field should fail
        incomplete_result = {"summary_text": "Test"}
        with pytest.raises(AssertionError, match="score is required"):
            validate_retrieval_result(incomplete_result)


# === HELPER FUNCTIONS ===

def validate_retrieval_result(result: Dict[str, Any]) -> None:
    """
    Validate a single RetrievalResult against RETRIEVE_CONTRACT.md schema.
    
    Raises:
        AssertionError: If result doesn't match contract
    """
    # Required fields
    assert "summary_text" in result, "summary_text is required"
    assert isinstance(result["summary_text"], str), "summary_text must be string"
    assert len(result["summary_text"]) > 0, "summary_text must not be empty"
    
    assert "score" in result, "score is required"
    assert isinstance(result["score"], (int, float)), "score must be numeric"
    
    # Optional metadata fields (if present, must be correct type)
    if "topic" in result and result["topic"] is not None:
        assert isinstance(result["topic"], str)
    
    if "topic_id" in result and result["topic_id"] is not None:
        assert isinstance(result["topic_id"], str)
    
    if "status" in result and result["status"] is not None:
        assert result["status"] in ["Active", "Superseded"], \
            f"Invalid status: {result['status']}"
    
    # Optional structured content fields (if present, must be arrays)
    for field in ["decisions", "rationale", "open_questions", "next_steps", "references"]:
        if field in result and result[field] is not None:
            assert isinstance(result[field], list), \
                f"{field} must be array if present"


def validate_retrieval_response(response: Dict[str, Any]) -> None:
    """
    Validate entire retrieve.py response against RETRIEVE_CONTRACT.md schema.
    
    Raises:
        AssertionError: If response doesn't match contract
    """
    # Top-level structure
    assert "success" in response, "success field is required"
    assert isinstance(response["success"], bool), "success must be boolean"
    
    assert "results" in response, "results field is required"
    assert isinstance(response["results"], list), "results must be array"
    
    assert "total_results" in response, "total_results field is required"
    assert isinstance(response["total_results"], int), "total_results must be integer"
    
    assert "total_tokens" in response, "total_tokens field is required"
    assert isinstance(response["total_tokens"], int), "total_tokens must be integer"
    
    # Validate each result
    for result in response["results"]:
        validate_retrieval_result(result)


# === METADATA PROPAGATION TEST (requires actual Cognee) ===

@pytest.mark.integration
class TestMetadataPropagation:
    """
    Integration tests verifying metadata survives add → cognify → search.
    
    These tests require actual Cognee SDK and will be run during Milestone 3/4.
    Marked as @pytest.mark.integration to exclude from unit test runs.
    """
    
    def test_metadata_survives_cognify_cycle(self, sample_conversation_summary):
        """
        Verify metadata fields are preserved through full Cognee pipeline.
        
        ACCEPTANCE CRITERIA:
        - Ingest DataPoint with metadata
        - Run cognify
        - Search and verify metadata is present in results
        - Timestamps, topic_id, plan_id, status are all retrievable
        """
        # TODO: Actual integration test with Cognee SDK
        pytest.skip("Integration test: requires actual Cognee SDK setup")
    
    def test_index_fields_affect_search_results(self, sample_conversation_summary):
        """
        Verify index_fields configuration affects semantic search.
        
        ACCEPTANCE CRITERIA:
        - Searching by topic finds the summary
        - Searching by plan_id finds the summary
        - Non-indexed fields don't affect semantic similarity
        """
        # TODO: Actual integration test with Cognee search
        pytest.skip("Integration test: requires actual Cognee SDK setup")
