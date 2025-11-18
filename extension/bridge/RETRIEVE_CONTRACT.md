# Retrieval Contract for Cognee Chat Memory (Plan 014)

This document describes the **structured JSON contract** returned by `extension/bridge/retrieve.py` for use by the VS Code extension and agents.

## Purpose

- Define a stable, typed interface between the Python bridge and TypeScript consumers
- Enable transparent display of metadata (topic, status, timestamps) in the UI
- Support future ranking algorithms (Plan 015) without breaking consumers
- Maintain backward compatibility with legacy raw-text memories

## Contract Version

**Version**: 1.0.0  
**Effective Date**: 2025-11-17  
**Cognee SDK**: 0.3.4  

## Top-Level Response Shape

`retrieve.py` MUST write a single JSON object to stdout with the following shape:

```json
{
  "success": true,
  "results": [
    ...RetrievalResult objects...
  ],
  "total_results": 0,
  "total_tokens": 0
}
```

### Fields

- **`success`** (boolean, required): `true` if retrieval completed, `false` if an error occurred
- **`results`** (array, required): Ordered list of retrieval hits (highest score first)
- **`total_results`** (integer, required): Count of all hits considered (may equal `results.length` or be higher if down-sampled)
- **`total_tokens`** (integer, required): Approximate token count of all returned results (for budget tracking)

### Error Handling

If an error occurs that cannot be recovered:

- `retrieve.py` SHOULD emit a non-zero exit code
- `retrieve.py` MAY emit an error object to stdout: `{"success": false, "error": "message"}`
- TypeScript layer MUST handle both failure modes gracefully

## RetrievalResult Shape

Each entry in `results` MUST conform to the following structure. Fields marked **required** MUST be present (even if empty/null). Optional fields MAY be omitted.

```typescript
interface RetrievalResult {
  // === REQUIRED FIELDS ===
  
  summary_text: string;           // Full formatted summary (markdown template)
  score: number;                  // Final ranking score (0.0 to 1.0+)
  
  // === OPTIONAL METADATA FIELDS ===
  
  topic?: string | null;          // Short title/topic
  topic_id?: string | null;       // UUID or stable identifier
  plan_id?: string | null;        // Associated plan (e.g., "014")
  session_id?: string | null;     // Originating session identifier
  status?: "Active" | "Superseded" | null; // Summary lifecycle status
  created_at?: string | null;     // ISO 8601 timestamp
  updated_at?: string | null;     // ISO 8601 timestamp
  
  // === OPTIONAL STRUCTURED CONTENT FIELDS ===
  
  decisions?: string[];           // Key decisions from summary
  rationale?: string[];           // Rationale for decisions
  open_questions?: string[];      // Unresolved questions
  next_steps?: string[];          // Follow-up actions
  references?: string[];          // File paths, plans, branches, issues
}
```

### Field Descriptions

#### Required Fields

- **`summary_text`** (required):
  - Human-readable representation of the summary
  - For DataPoint-backed summaries: full Plan 014 markdown template
  - For legacy memories: raw text snippet
  - MUST NOT be empty (minimum: single character)

- **`score`** (required):
  - Numeric relevance score, typically in range [0.0, 1.0] but may exceed 1.0 with boosting
  - Higher values = more relevant
  - Combines semantic similarity + recency + status adjustments (implementation-defined)

#### Optional Metadata Fields

- **`topic`**: Short title or topic string when available (from DataPoint metadata)
- **`topic_id`**: Stable identifier (UUID or slug) for the summary's topic
- **`plan_id`**: Plan number associated with this summary (e.g., "014", "plan-014")
- **`session_id`**: Identifier for the originating chat session
- **`status`**: Lifecycle status of the summary
  - `"Active"`: Current, valid summary
  - `"Superseded"`: Replaced by a newer summary or DecisionRecord
  - `null`: Status unknown (legacy memory)
- **`created_at`** / **`updated_at`**: Timestamps in ISO 8601 format (e.g., `"2025-11-17T16:32:10Z"`)
  - MUST be `null` if not available (do not use empty strings)

#### Optional Structured Content Fields

When a result comes from a structured summary DataPoint, `retrieve.py` SHOULD populate:

- **`decisions`**: Array of key decisions captured in the summary
- **`rationale`**: Array of rationales behind key decisions
- **`open_questions`**: Array of unresolved questions
- **`next_steps`**: Array of follow-up tasks or actions
- **`references`**: Array of reference strings (file paths, plan IDs, branches, issues)

For legacy raw-text memories that lack this structure, these fields SHOULD be omitted or `null`.

## Example Responses

### Example 1: Mixed Results (DataPoint + Legacy)

```json
{
  "success": true,
  "results": [
    {
      "summary_text": "Summary: Plan 014 – Structured Summaries\n\nTopic: Plan 014 – Structured Summaries\nContext: Implementing DataPoint-based storage for conversation summaries to enable metadata-driven ranking and compaction.\nDecisions:\n- Migrate summaries to DataPoints with metadata\n- Expose structured retrieval contract via retrieve.py\nRationale:\n- Enable recency-aware ranking and compaction in later plans\nOpen Questions:\n- None\nNext Steps:\n- Implement Plan 015 ranking algorithms\nReferences:\n- Plan 014 documentation\nTime Scope: Nov 17 14:00-16:30",
      "topic": "Plan 014 – Structured Summaries",
      "topic_id": "3e3e4f26-7c02-4b3c-8b9d-8f1f9b3e2a10",
      "plan_id": "014",
      "session_id": "f1b9b8b0-9f1a-4b8f-8c2b-1c2b3d4e5f6a",
      "status": "Active",
      "created_at": "2025-11-17T16:30:00Z",
      "updated_at": "2025-11-17T16:31:00Z",
      "score": 0.92,
      "decisions": [
        "Migrate summaries to DataPoints with metadata",
        "Expose structured retrieval contract via retrieve.py"
      ],
      "rationale": [
        "Enable recency-aware ranking and compaction in later plans"
      ],
      "open_questions": [],
      "next_steps": [
        "Implement Plan 015 ranking algorithms"
      ],
      "references": [
        "Plan 014 documentation"
      ]
    },
    {
      "summary_text": "We discussed Plan 013 truncation behavior and decided to remove the 150-char limit. Full memory content should be visible to users for transparency.",
      "score": 0.75,
      "topic": null,
      "topic_id": null,
      "plan_id": null,
      "session_id": null,
      "status": null,
      "created_at": null,
      "updated_at": null
    }
  ],
  "total_results": 2,
  "total_tokens": 185
}
```

### Example 2: Error Response

```json
{
  "success": false,
  "error": "Cognee search failed: Connection timeout",
  "results": [],
  "total_results": 0,
  "total_tokens": 0
}
```

## Legacy Raw-Text Memories

To preserve backward compatibility with memories created before Plan 014:

### Identification

Legacy results can be identified by:

- `topic_id === null`
- `status === null`
- Absence of structured content fields (`decisions`, `rationale`, etc.)

### Handling Requirements

- `retrieve.py` MUST still return legacy memories as `RetrievalResult` objects
- For legacy results:
  - `summary_text`: Raw text content (snippet) from the memory
  - `score`: Cognee's similarity score (or computed score)
  - All metadata fields: SHOULD be `null` (not omitted)
  - Structured content fields: SHOULD be omitted or `null`

### TypeScript Consumer Contract

Downstream TypeScript code MUST:

- Treat missing/`null` metadata as a signal that this is a legacy unstructured memory
- Display legacy memories without metadata badges
- Not assume presence of structured content fields

## Scoring Transparency

### Score Composition

The `score` field in each result represents a **final ranking score** that MAY combine:

1. **Semantic similarity**: From Cognee's search algorithm (typically 0.0 to 1.0)
2. **Recency adjustment**: Based on `created_at` timestamp (exponential decay or linear)
3. **Status adjustment**: Boost `Active` records, penalize `Superseded` records
4. **Importance/priority**: Optional boost from metadata (future enhancement)

### Implementation Notes

- Plan 014: Score is primarily semantic similarity from Cognee; recency awareness is minimal
- Plan 015: Will add configurable recency-aware scoring with transparent formula
- Implementers MAY document scoring formula in retrieve.py comments for transparency

## Contract Evolution

### Stability Guarantees

- **Required fields** (`summary_text`, `score`) WILL NOT be removed or renamed
- **Optional fields** MAY be added in future versions without breaking consumers
- **Field types** WILL NOT change (e.g., `score` will always be `number`)

### Future Extensions (Post-Plan 014)

Plan 015 and later MAY add:

- `rank_explanation`: String describing why this result was ranked highly
- `compaction_source`: Array of `topic_id`s that were compacted into this result
- `confidence`: LLM confidence score for summary accuracy
- `tags`: Array of custom tags for filtering

All new fields MUST be optional to avoid breaking existing consumers.

## Testing Requirements

See `test_datapoint_contract.py` for the test skeleton. Implementers must verify:

- JSON output matches this schema exactly
- Legacy memories return with `null` metadata (not omitted fields)
- Mixed results (DataPoint + legacy) are handled correctly
- Error responses follow the documented format
- Scoring is consistent and documented

## References

- Plan 014: Chat Summary Creation and Retrieval
- DATAPOINT_SCHEMA.md: Conversation summary storage format
- Analysis: 014-chat-conversation-summaries-and-agent-instructions-analysis.md
- Analysis: 014-bridge-focused-addendum-analysis.md
- System Architecture: agent-output/architecture/system-architecture.md (§4.4, §9)
