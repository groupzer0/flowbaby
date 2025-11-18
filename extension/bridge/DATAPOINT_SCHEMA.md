# DataPoint Schema for Conversation Summaries (Plan 014)

This document defines the **structured DataPoint schema** for storing conversation summaries in Cognee with embedded metadata fields.

## Purpose

- Provide a stable, queryable schema for chat summaries that supports future ranking, compaction, and status-aware retrieval (Plan 015).
- Enable metadata-driven operations without relying on regex parsing of text content.
- Maintain backward compatibility with legacy raw-text memories while establishing a migration path.

## Schema Version

**Schema Version**: 1.0.0  
**Template Version**: 1.0 (embedded in markdown as `<!-- Template: v1.0 -->`)
**Effective Date**: 2025-11-18  
**Cognee SDK**: 0.3.4  
**Architecture Reference**: `system-architecture.md` §4.4.1 (Enriched Text Metadata Fallback)

## Implementation Note: Enriched Text Fallback (§4.4.1)

**Cognee 0.3.4** does not expose a `DataPoint` class in the public API. Per architecture decision §4.4.1, this plan implements an **enriched text fallback** where metadata is embedded directly in structured markdown.

### Key Requirements:

1. **Template Versioning**: All generated summaries MUST include `<!-- Template: v1.0 -->` as the first line to enable future format migrations.

2. **Deterministic Section Headings**: The markdown template uses fixed section headings (`## Context`, `## Key Decisions`, etc.) that MUST match exactly across:
   - `extension/src/summaryTemplate.ts` (generation)
   - `extension/bridge/ingest.py` (validation)
   - `extension/bridge/retrieve.py` (regex parsing)

3. **Synchronized Updates**: Any changes to section headings or metadata format require synchronized updates across all three layers. Document changes in this file.

4. **Regex Parsing**: `retrieve.py` uses regex patterns (documented below) to extract metadata. Malformed summaries MUST fail with actionable error codes.

5. **Mixed-Mode Support**: Retrieval must handle both enriched summaries (full metadata) and legacy raw-text memories (null metadata).

Future Cognee versions may expose explicit DataPoint APIs with separate metadata fields. This schema document establishes the contract for such a migration.

## DataPoint Structure

### Overview

A `ConversationSummary` DataPoint represents a structured summary of a chat conversation segment, stored in Cognee's knowledge graph with both content and metadata embedded in the text.

### Python Representation (Illustrative)

```python
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class ConversationSummary(BaseModel):
    """
    Structured conversation summary for Cognee ingestion.
    
    This model defines the schema for Plan 014 summaries with metadata
    fields that support ranking, compaction, and status-aware retrieval.
    """
    
    # === CONTENT FIELDS (semantic core) ===
    
    topic: str = Field(
        ...,
        description="Short title capturing the main focus of the conversation"
    )
    
    context: str = Field(
        ...,
        description="1-3 sentence summary of what was being worked on and why"
    )
    
    decisions: list[str] = Field(
        default_factory=list,
        description="Key decisions or conclusions reached"
    )
    
    rationale: list[str] = Field(
        default_factory=list,
        description="Explanations for why key decisions were made"
    )
    
    open_questions: list[str] = Field(
        default_factory=list,
        description="Unresolved questions, risks, or follow-ups"
    )
    
    next_steps: list[str] = Field(
        default_factory=list,
        description="Concrete next actions or tasks"
    )
    
    references: list[str] = Field(
        default_factory=list,
        description="File paths, plan IDs, branches, issues, or other references"
    )
    
    time_scope: str = Field(
        default="",
        description="Human-readable time range (e.g., 'Nov 17 14:00-16:30')"
    )
    
    # === METADATA FIELDS (for ranking, filtering, compaction) ===
    
    topic_id: str = Field(
        ...,
        description="Stable identifier for this topic (UUID or slug, e.g., 'plan-014-summaries')"
    )
    
    session_id: Optional[str] = Field(
        default=None,
        description="Identifier for the originating chat session (UUID or date-based)"
    )
    
    plan_id: Optional[str] = Field(
        default=None,
        description="Associated plan number (e.g., '014' or 'plan-014')"
    )
    
    status: str = Field(
        default="Active",
        description="Summary lifecycle status: 'Active', 'Superseded', 'Draft'"
    )
    
    created_at: datetime = Field(
        ...,
        description="Timestamp when summary was created (ISO 8601)"
    )
    
    updated_at: datetime = Field(
        ...,
        description="Timestamp when summary was last updated (ISO 8601)"
    )


## Cognee Ingestion Contract

### DataPoint Creation

When ingesting a conversation summary into Cognee:

1. **Create a DataPoint-like structure** with:
   - `text`: Full formatted summary text (markdown template for human readability)
   - `metadata`: Dictionary containing all metadata fields listed above
   - `index_fields`: List of fields to be indexed for semantic search

2. **Indexed Fields** (included in vector embeddings):
   - `topic` (primary semantic anchor)
   - `topic_id` (enables topic-scoped queries)
   - `plan_id` (enables plan-scoped queries)
   - `status` (enables status filtering)
   - `created_at` (enables recency-aware ranking)
   - `decisions` (key content for retrieval)

3. **Non-Indexed Fields** (stored as node properties):
   - `session_id` (used for grouping/compaction)
   - `updated_at` (audit trail)
   - `context`, `rationale`, `open_questions`, `next_steps`, `references`, `time_scope` (available in full results)

### Example DataPoint Structure

```python
{
    "text": formatted_summary_text,  # Full markdown template
    "metadata": {
        "type": "conversation_summary",
        "topic": "Plan 014 - Structured Summaries",
        "topic_id": "3e3e4f26-7c02-4b3c-8b9d-8f1f9b3e2a10",
        "session_id": "f1b9b8b0-9f1a-4b8f-8c2b-1c2b3d4e5f6a",
        "plan_id": "014",
        "status": "Active",
        "created_at": "2025-11-17T16:30:00Z",
        "updated_at": "2025-11-17T16:31:00Z",
        "context": "Implementing structured conversation summaries...",
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
        "time_scope": "Nov 17 14:00-16:30"
    },
    "index_fields": ["topic", "topic_id", "plan_id", "status", "created_at"]
}
```

### Enriched Text Template (v1.0)

The enriched text MUST use this exact markdown format for regex parsing:

```markdown
<!-- Template: v1.0 -->
# Conversation Summary: {topic}

**Metadata:**
- Topic ID: {topic_id}
- Session ID: {session_id}
- Plan ID: {plan_id}
- Status: {status}
- Created: {created_at}
- Updated: {updated_at}

## Context
{context}

## Key Decisions
- {decision 1}
- {decision 2}

## Rationale
- {rationale 1}

## Open Questions
- {question 1}

## Next Steps
- {step 1}

## References
- {reference 1}

## Time Scope
- Start: {start_timestamp}
- End: {end_timestamp}
- Turn Count: {turn_count}
```

### Regex Patterns for Metadata Extraction

`retrieve.py` uses these patterns to parse enriched summaries. **CRITICAL**: Any template changes require updating these patterns.

```python
# Template version
TEMPLATE_VERSION_PATTERN = r'<!-- Template: v([\d.]+) -->'

# Metadata block detection
METADATA_BLOCK_PATTERN = r'\*\*Metadata:\*\*'

# Metadata fields (within Metadata block)
TOPIC_ID_PATTERN = r'- Topic ID: ([a-f0-9\-]+)'
SESSION_ID_PATTERN = r'- Session ID: ([a-f0-9\-]+|N/A)'
PLAN_ID_PATTERN = r'- Plan ID: ([\w\-]+|N/A)'
STATUS_PATTERN = r'- Status: (Active|Superseded|Draft)'
CREATED_AT_PATTERN = r'- Created: ([\d\-T:Z]+)'
UPDATED_AT_PATTERN = r'- Updated: ([\d\-T:Z]+)'

# Content sections (headings)
CONTEXT_SECTION_PATTERN = r'## Context\n(.+?)(?=\n##|$)'
DECISIONS_SECTION_PATTERN = r'## Key Decisions\n(.+?)(?=\n##|$)'
RATIONALE_SECTION_PATTERN = r'## Rationale\n(.+?)(?=\n##|$)'
OPEN_QUESTIONS_SECTION_PATTERN = r'## Open Questions\n(.+?)(?=\n##|$)'
NEXT_STEPS_SECTION_PATTERN = r'## Next Steps\n(.+?)(?=\n##|$)'
REFERENCES_SECTION_PATTERN = r'## References\n(.+?)(?=\n##|$)'
```

**Validation Rules**:
- If `**Metadata:**` block is missing, treat as legacy memory (all metadata fields = null).
- If metadata block exists but regex groups fail, log error with malformed text snippet and return error payload.
- All section headings are optional; missing sections return empty arrays/strings.

## Backward Compatibility

### Legacy Raw-Text Memories

Existing memories from Plans 001-011 that were ingested as plain text:

- **DO NOT** have the structured metadata fields defined in this schema
- **MUST** still be retrievable and displayable
- **SHOULD** be identified by the absence of `metadata.type = "conversation_summary"`
- **MAY** be migrated to this schema via a future migration script

### Migration Strategy

When retrieving memories, `retrieve.py` must handle both:

1. **New structured summaries** (this schema): Extract and return all metadata fields
2. **Legacy raw text**: Return with `null` or default values for missing metadata fields

## Validation and Testing

### Required Validations

1. **Schema validation**: Pydantic model validates all field types and required fields
2. **Timestamp format**: ISO 8601 format (e.g., `2025-11-17T16:30:00Z`)
3. **Status enum**: Must be one of `["Active", "Superseded", "Draft"]`
4. **Topic ID format**: UUID or stable slug (validated by bridge, not Pydantic)

### Test Coverage Requirements

See `test_datapoint_contract.py` for the test skeleton. Implementers must verify:

- DataPoint creation includes all required metadata fields
- `index_fields` configuration is correct
- Legacy memories are handled gracefully (null metadata)
- Timestamps are preserved through add → cognify → search cycle

## Future Extensions (Post-Plan 014)

- **DecisionRecord DataPoint** (Plan 015): Compacted version of multiple summaries
- **Status transitions**: Workflow for marking summaries as Superseded
- **Cross-reference fields**: Linking summaries to specific commits, PRs, issues
- **Confidence scores**: LLM confidence in summary accuracy

## References

- Plan 014: Chat Summary Creation and Retrieval
- Analysis: 014-chat-conversation-summaries-and-agent-instructions-analysis.md
- Analysis: 014-bridge-focused-addendum-analysis.md
- System Architecture: agent-output/architecture/system-architecture.md (§4.4, §9)
