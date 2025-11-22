# Retrieval Contract for Cognee Chat Memory (Plan 014)

This document describes the **structured JSON contract** returned by `extension/bridge/retrieve.py` for use by the VS Code extension and agents.

## Purpose

- Define a stable, typed interface between the Python bridge and TypeScript consumers
- Enable transparent display of metadata (topic, status, timestamps) in the UI
- Support future ranking algorithms (Plan 015) without breaking consumers
- Maintain backward compatibility with legacy raw-text memories

## Contract Version

**Version**: 1.1.0  
**Effective Date**: 2025-11-21  
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
- **`result_count`** (integer, optional): Number of results returned in this response. Maintained for backward compatibility with Plan 014 consumers.
- **`total_results`** (integer, required): Count of all hits considered (may exceed `results.length` if token budgets trimmed the list)
- **`total_tokens`** (integer, required): Approximate token count of all returned results (for budget tracking)
- **`half_life_days`** (number, optional): Half-life (in days) used for recency decay in this response.
- **`include_superseded`** (boolean, optional): Whether the query allowed Superseded summaries in this response.

### Query Parameters

`retrieve.py` accepts the following CLI arguments (in order) from the extension:

1. `workspace_path` – required, absolute workspace directory
2. `query` – required, natural-language search string
3. `max_results` – optional integer (default: VS Code setting `cogneeMemory.maxContextResults`)
4. `max_tokens` – optional integer (default: VS Code setting `cogneeMemory.maxContextTokens`)
5. `half_life_days` – optional float (default: VS Code setting `cogneeMemory.ranking.halfLifeDays`, fallback 7)
6. `include_superseded` – optional boolean (`true`/`false`, default: `false`)

Bridge scripts MUST document defaults and clamp invalid values (e.g., `half_life_days < 0.5` → fallback to 0.5). These parameters propagate from the TypeScript `CogneeContextRequest` interface.

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
  score: number;                  // Final relevance score (semantic * recency)
  final_score?: number;           // Alias of score (preserved for analytics)
  relevance_score?: number;       // Exposed for compatibility with Plan 014 docs
  semantic_score?: number;        // Raw semantic similarity component
  recency_multiplier?: number;    // Exponential decay multiplier (0-1)
  status_multiplier?: number;     // Status weighting applied to entry
  tokens?: number;                // Rough token count for this entry
  
  // === OPTIONAL METADATA FIELDS ===
  
  topic?: string | null;          // Short title/topic
  topic_id?: string | null;       // UUID or stable identifier
  plan_id?: string | null;        // Associated plan (e.g., "014")
  session_id?: string | null;     // Originating session identifier
  status?: "Active" | "Superseded" | "DecisionRecord" | null; // Summary lifecycle status
  source_created_at?: string | null; // Original source timestamp (ISO 8601)
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
  - `"DecisionRecord"`: Compacted/authoritative record (Plan 019)
  - `null`: Status unknown (legacy memory)
- **`source_created_at`**: Best-effort timestamp for the original artifact (file edit, commit, meeting). Used for recency ranking; may be `null` or `"N/A"` if unknown.
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

## Status Filtering & Prioritization

- CLI/query flag `include_superseded` controls whether Superseded summaries are returned. Default: `false` (exclude)
- When flag is `true`, retrieval includes every status but MUST stable-sort ties so `DecisionRecord` > `Active` > `Superseded`
- Responses MUST always include `status` so TS/UI layers can render badges (e.g., `[Decision]`, `[Superseded]`)

## Scoring Transparency

### Score Composition

The `score` (and `final_score`) field represents the final ranking output computed by `retrieve.py`. It combines:

1. **`semantic_score`** – Cognee's similarity value (0-1).
2. **`recency_multiplier`** – Exponential decay computed via `exp(-alpha * days_since_source_created)` where `alpha = ln(2) / half_life_days`.
3. **`status_multiplier`** – Boost/penalty applied per status (`DecisionRecord` > `Active` > `Superseded`).

`score = semantic_score * recency_multiplier * status_multiplier`

`relevance_score` mirrors `final_score` for compatibility with prior documentation.

### Implementation Notes

- Plan 014: Score is primarily semantic similarity from Cognee; recency awareness is minimal
- Plan 018: Introduces configurable recency-aware scoring via `half_life_days` parameter and `source_created_at` timestamps
- Implementers MAY document scoring formula in retrieve.py comments for transparency

### Configuration: Half-Life Parameter

- VS Code setting `cogneeMemory.ranking.halfLifeDays` controls the recency decay half-life (default: 7 days, min: 0.5, max: 90)
- TypeScript passes this value to `retrieve.py`; the bridge computes `decay_alpha = ln(2) / half_life_days`
- API consumers MAY override per-request by setting `halfLifeDays` in `CogneeContextRequest`
- Shorter half-life → stronger recency bias; longer half-life → more weight on semantic similarity
- Responses now echo the `half_life_days` used for each invocation.

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
