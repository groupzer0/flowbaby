# Plan 014: Chat Summary Creation and Retrieval

**Plan ID**: 014
**Target Release**: v0.3.0 (from Roadmap Epic 0.3.0.2)  
**Created**: 2025-11-16
**Last Updated**: 2025-11-18
**Status**: Draft
**Epic Alignment**: Epic 0.3.0.2 - Structured Conversation Summaries  
**Related Analysis**: `analysis/014-chat-conversation-summaries-and-agent-instructions-analysis.md`, `analysis/014-bridge-focused-addendum-analysis.md`
**Architectural References**: `architecture/system-architecture.md` §4.4, §4.4.1 (Enriched Text Metadata Fallback), §9 (Bridge Migration for Structured Summaries, Enriched Text Metadata Fallback decision)

---

## Value Statement and Business Objective

As a developer using Cognee Chat Memory and GitHub Copilot Chat,
I want my conversations to be periodically summarized and stored in a structured format optimized for retrieval,
So that future chat sessions can automatically rediscover relevant context, decisions, and rationale without me manually re-reading old threads or losing valuable insights.

---

## Objective

Implement the **creation, ingestion, and retrieval** of structured conversation summaries in the Cognee Chat Memory extension with DataPoint-based storage and structured metadata. This plan focuses on:

1. Defining and storing chat summaries using the Plan 014 schema (Topic, Context, Decisions, Rationale, OpenQuestions, NextSteps, References, TimeScope) **with metadata fields** (topic_id, session_id, plan_id, timestamps, status).
2. Updating the `@cognee-memory` chat participant to generate summaries on demand.
3. Migrating `ingest.py` to store summaries as **Cognee DataPoints with indexed metadata fields** so downstream consumers can reason about freshness, provenance, and status.
4. Updating `retrieve.py` to return **structured JSON payloads** including metadata (`topic_id`, `plan_id`, `status`, `created_at`, `summary_text`, `score`) instead of raw text.
5. Documenting and testing the bridge contract (`RETRIEVE_CONTRACT.md`) so Plan 016 and future consumers have a stable schema.
6. Ensuring transparency in the TypeScript layer so users can inspect metadata, status, and timestamps.

**Out of Scope (deferred to Plan 015)**:

- **Recency-aware ranking algorithms** (exponential decay, configurable weights) - Plan 015 will add custom scoring logic on top of the metadata foundation
- **Compaction behavior** (manual or automated triggers, topic grouping, LLM-based summarization of DecisionRecords) - Plan 015 will implement compaction workflows
- **Status-aware retrieval filtering** (`Superseded` down-ranking, DecisionRecord prioritization) - Plan 015 will add status-based ranking adjustments
- **Smart session boundary detection** - automatic detection of conversation segments based on time gaps, topic shifts, or explicit markers; enables semantic scope selection ("summarize segment 2") instead of turn counts

---

## Assumptions

1. **User Workflow**: Users will explicitly invoke summary creation via `@cognee-memory` commands or by asking "summarize this conversation."
2. **Schema Adoption**: The Plan 014 summary schema (Topic/Context/Decisions/etc.) plus metadata fields (topic_id, session_id, plan_id, timestamps, status) are sufficient for capturing conversation essence and supporting future ranking/compaction.
3. **Enriched Text Storage**: Summaries are stored as enriched text with embedded metadata (Cognee 0.3.4 constraint per §4.4.1). Metadata fields are included in the text content as structured markdown with deterministic section headings, making them searchable via semantic embeddings. Template versioning is REQUIRED—any changes to section headers or metadata format must be synchronized across `summaryTemplate.ts`, `ingest.py`, and `retrieve.py` to prevent parsing failures. Future Cognee versions may expose explicit DataPoint APIs with separate metadata dicts.
4. **Backward Compatibility**: Legacy raw-text memories from Plans 001-011 remain accessible; `retrieve.py` must handle both enriched summaries and legacy text gracefully. Mixed-mode support is mandatory per §4.4.1: TypeScript consumers must branch on `topicId`/`status` availability.
5. **Baseline Ranking Only**: This plan relies on Cognee's native similarity-based ranking; Plan 015 will add recency-aware scoring and status filtering on top of the metadata foundation delivered here.
6. **Structured Bridge Contract**: `retrieve.py` will return JSON with structured fields; TypeScript consumers (participant, future `CogneeContextProvider`) will consume this contract instead of parsing text.
7. **TypeScript Transparency**: All summary content AND metadata (topic, status, timestamps) are surfaced to the user via chat participant markdown and Output channel logs.

---

## Plan

### Milestone 0: Define and Validate Bridge Contract (Precondition)

**Objective**: Define the DataPoint schema and structured retrieval contract before any implementation begins, ensuring Plan 016 and future consumers have a stable foundation. Validate that this schema has been smoke tested against actual calls before marking finalized.

**Tasks**:

1. **Define DataPoint Schema for Summaries** (`extension/bridge/DATAPOINT_SCHEMA.md`)
   - Document the enriched-text fallback structure per §4.4.1 (since Cognee 0.3.4 lacks DataPoint API):
     - **Content fields**: `topic`, `context`, `decisions`, `rationale`, `open_questions`, `next_steps`, `references`, `time_scope` (all text/list fields)
     - **Metadata fields**: `topic_id` (UUID), `session_id` (UUID or null), `plan_id` (string or null), `status` (enum: "Active", "Superseded"), `created_at` (ISO timestamp), `updated_at` (ISO timestamp)
   - Define deterministic markdown template with `**Metadata:**` block and section headings that will be parsed via regex.
   - Include template version identifier (e.g., `<!-- Template: v1.0 -->`) in generated markdown to enable future format migrations.
   - Document regex patterns used by `retrieve.py` for metadata extraction and mandate synchronized updates.
   - Include example enriched-text markdown showing structure.
   - **Acceptance**: Schema documented with versioning strategy; architect reviews and approves structure.

2. **Define Retrieval Contract** (`extension/bridge/RETRIEVE_CONTRACT.md`)
   - Document the JSON response structure returned by `retrieve.py`:
     ```json
     {
       "results": [
         {
           "summary_text": "string (full formatted summary)",
           "topic": "string",
           "topic_id": "uuid",
           "plan_id": "string | null",
           "session_id": "uuid | null",
           "status": "Active | Superseded",
           "created_at": "ISO8601 timestamp",
           "score": "float (Cognee similarity score)",
           "decisions": ["string"],
           "rationale": ["string"],
           "open_questions": ["string"],
           "next_steps": ["string"],
           "references": ["string"]
         }
       ],
       "total_results": "int"
     }
     ```
   - Specify handling of legacy raw-text memories (returned with `topic_id: null`, `status: null`).
   - **Acceptance**: Contract documented; Plan 016 planner confirms schema meets `CogneeContextProvider` requirements.

3. **Create Bridge Contract Tests Skeleton** (`extension/bridge/test_datapoint_contract.py`)
   - Write pytest test structure (mocks only) that will verify per §4.4.1 testing mandates:
     - **Enriched-text formatting**: Generated markdown includes `**Metadata:**` block with all required fields (topic_id, session_id, plan_id, status, timestamps).
     - **Template structure validation**: All content sections (Context, Decisions, Rationale, etc.) present with deterministic headings.
     - **Metadata parsing**: Regex extraction recovers all metadata fields correctly; malformed summaries fail with actionable error codes.
     - **Legacy path regression**: `ingest.py` without `--summary` still works (raw-text path unaffected).
     - **Mixed-mode retrieval**: `retrieve.py` returns JSON matching contract schema for both enriched summaries (full metadata) and legacy memories (null metadata).
     - **JSON contract validation**: Response structure matches `RETRIEVE_CONTRACT.md` exactly.
   - Tests will be implemented in Milestone 3 but skeleton ensures contract is testable.
   - **Acceptance**: Test skeleton exists covering all §4.4.1 requirements; contract is testable before implementation.

**Owner**: Implementer + Architect
**Dependencies**: None (defines foundation for all subsequent work)
**Validation**: Schema and contract documents reviewed and approved by architect; Plan 016 confirms compatibility.

---

### Milestone 1: Define and Validate Summary Schema

**Objective**: Establish the summary structure as a reusable text template and validate it with a sample conversation.

**Tasks**:

1. **Create Summary Template Module** (`extension/src/summaryTemplate.ts`)
   - Define TypeScript interface `ConversationSummary` with fields:
     - **Content fields**: `topic`, `context`, `decisions`, `rationale`, `openQuestions`, `nextSteps`, `references`, `timeScope`.
     - **Metadata fields**: `topicId` (string, UUID), `sessionId` (string | null), `planId` (string | null), `status` ("Active" | "Superseded"), `createdAt` (Date), `updatedAt` (Date).
   - Add **template version constant** (e.g., `TEMPLATE_VERSION = "1.0"`) and embed in generated markdown as HTML comment for future migration support.
   - Implement function `formatSummaryAsText(summary: ConversationSummary): string` that produces the enriched-text markdown format per §4.4.1:

     ```markdown
     <!-- Template: v1.0 -->
     # Conversation Summary: {topic}

     **Metadata:**
     - Topic ID: {topicId}
     - Session ID: {sessionId}
     - Plan ID: {planId}
     - Status: {status}
     - Created: {createdAt}
     - Updated: {updatedAt}

     ## Context
     {context}

     ## Key Decisions
     {decisions}

     ## Rationale
     {rationale}

     ## Open Questions
     {openQuestions}

     ## Next Steps
     {nextSteps}

     ## References
     {references}

     ## Time Scope
     {timeScope}
     ```

   - Include validation logic to ensure required fields (`topic`, `context`) are present.
   - **CRITICAL per §4.4.1**: Section headings must match exactly what `retrieve.py` regex patterns expect. Document heading format in `DATAPOINT_SCHEMA.md`.
   - **Acceptance**: Template generates valid enriched markdown with `**Metadata:**` block; unit test confirms formatting and version tag presence.

2. **Create Summary Parser Module** (`extension/src/summaryParser.ts`)
   - Implement function `parseSummaryFromText(text: string): ConversationSummary | null` to extract structured fields from enriched markdown summary.
   - Parse `**Metadata:**` block first using regex to extract metadata fields; fall back to null values if block missing (legacy mode per §4.4.1).
   - Parse content sections using deterministic heading patterns matching `summaryTemplate.ts`.
   - Handle optional fields gracefully (e.g., missing `Open Questions` section).
   - Validate template version tag if present; log warning if version mismatch detected.
   - **Acceptance**: Parser correctly round-trips an enriched summary; handles legacy raw-text gracefully (returns partial object with null metadata); unit tests confirm both modes.

3. **Document Summary Schema in README**
   - Add section to `extension/README.md` explaining the summary schema and when users should create summaries.
   - Include example summary with all sections populated.
   - **Acceptance**: README clearly documents summary format and user workflow.

**Owner**: Implementer
**Dependencies**: None
**Validation**: Unit tests pass; schema documented and visible in README.

---

### Milestone 2: Extend Chat Participant to Generate Summaries

**Objective**: Enable the `@cognee-memory` participant to generate structured summaries from recent chat history.

**Tasks**:

1. **Implement Summary Generation Command** (`extension/src/chatParticipant.ts`)
   - Add detection for user prompts like "summarize this conversation", "remember this session", or "create summary".
   - Extract recent chat turns from `request.history` (default: last 15 turns).
   - Display scope preview to user: "I'll summarize the last 15 turns (from [time ago]). Type a number to adjust (e.g., '30'), or say 'confirm' to proceed."
   - If user provides a number:
     - Adjust turn count to the provided number.
     - Display updated preview: "I'll summarize the last [N] turns (from [updated time ago]). Type a number to adjust (e.g., '20'), or say 'confirm' to proceed."
     - Allow iterative adjustment until user says "confirm".
   - If user confirms, proceed with the current turn count (default or adjusted).
   - Send a prompt to the LLM asking it to generate a summary in the Plan 014 schema format using the selected turn count.
   - Parse the LLM's response using `summaryParser.parseSummaryFromText`.
   - Display the summary to the user via `stream.markdown` and ask: "Should I store this summary in Cognee memory?"
   - **Acceptance**: User can trigger summary generation; sees turn count preview; can iteratively adjust turn count; must explicitly confirm before summary generation; LLM produces valid schema; summary is displayed for confirmation.

2. **Handle User Confirmation** (`extension/src/chatParticipant.ts`)
   - If user confirms (e.g., replies "yes", "store it", "save"), call `CogneeClient.ingestSummary(summary)`.
   - If user declines, log "Summary not stored" and return.
   - **Acceptance**: User confirmation flow works; summary is ingested only on explicit approval.

3. **Add Slash Command for Summary** (optional enhancement)
   - Register a slash command `/summarize` within the participant for explicit invocation.
   - **Acceptance**: `/summarize` command triggers summary generation flow.

**Owner**: Implementer
**Dependencies**: Milestone 1 (summary template and parser)
**Validation**: Manual testing with live chat history; summary is generated, displayed, and stored on confirmation.

---

### Milestone 3: Update Python Bridge for Enriched Text Summary Ingestion

**Objective**: Migrate `ingest.py` to store summaries as enriched text with embedded metadata, enabling structured retrieval and future ranking/compaction.

**Implementation Note**: Cognee 0.3.4 does not expose a `DataPoint` class in the public API. This milestone implements the enriched-text fallback per `architecture/system-architecture.md` §4.4.1. Metadata is embedded in structured markdown with deterministic section headings. Template versioning and synchronized updates across `summaryTemplate.ts`, `ingest.py`, and `retrieve.py` are MANDATORY to prevent parsing failures. See `DATAPOINT_SCHEMA.md` for detailed implementation approach and regex patterns.

**Tasks**:

1. **Implement DataPoint Ingestion for Summaries** (`extension/bridge/ingest.py`)
   - Add new CLI arguments for structured summary ingestion:
     - `--summary` (boolean flag): Indicates DataPoint-based summary vs legacy raw-text.
     - `--summary-json` (string): JSON payload containing `ConversationSummary` with content + metadata fields.
   - When `--summary` is true:
     - Parse `--summary-json` to extract content fields (topic, context, decisions, etc.) and metadata fields (topic_id, session_id, plan_id, status, created_at, updated_at).
     - Create enriched text with embedded metadata following DATAPOINT_SCHEMA.md format:
       ```python
       # Create enriched text with embedded metadata (§4.4.1 fallback)
       # CRITICAL: Section headings must match summaryTemplate.ts and retrieve.py regex patterns
       summary_text = f"""<!-- Template: v1.0 -->
# Conversation Summary: {topic}

**Metadata:**
- Topic ID: {topic_id}
- Session ID: {session_id}
- Plan ID: {plan_id if plan_id else 'N/A'}
- Status: {status}
- Created: {created_at}
- Updated: {updated_at}

## Context
{context}

## Key Decisions
{format_list(decisions)}

## Rationale
{format_dict(rationale)}

## Open Questions
{format_list(open_questions)}

## Next Steps
{format_list(next_steps)}

## References
{format_list(references)}

## Time Scope
- Start: {time_scope['start']}
- End: {time_scope['end']}
- Turn Count: {time_scope['turn_count']}
"""
       ```
     - Call `cognee.add(data=[summary_text], dataset_name=dataset_name)` and `cognee.cognify()` to ingest into knowledge graph.
     - Emit success JSON with `topic_id` and metadata confirmation for logging/tracking.
   - When `--summary` is false (default):
     - Use existing raw-text format (Plan 010 behavior) for backward compatibility.
   - **Acceptance**: `ingest.py --summary --summary-json '{...}'` creates enriched text with embedded metadata; metadata is searchable via semantic embeddings; legacy ingestion unaffected.

2. **Update CogneeClient to Support Enriched Text Ingestion** (`extension/src/cogneeClient.ts`)
   - Add method `ingestSummary(summary: ConversationSummary): Promise<boolean>` that:
     - Generates UUID for `topicId` if not provided.
     - Sets metadata defaults: `status: "active"`, `createdAt: new Date()`, `updatedAt: new Date()`.
     - Serializes `summary` (content + metadata) to JSON.
     - Invokes `ingest.py --summary --summary-json '{...}'` with `workspace_path` injected.
     - Parses response JSON to verify success and extract metadata confirmation.
     - Logs the operation to Output channel with topic, topic_id, ingestion duration, and timestamp.
   - **Acceptance**: `CogneeClient.ingestSummary` successfully stores summaries as enriched text; returns success boolean; logs confirm ingestion with metadata.

3. **Implement Bridge Contract Tests** (`extension/bridge/test_datapoint_contract.py`)
   - Implement tests from Milestone 0 skeleton per §4.4.1 testing mandates:
     - **Test enriched-text formatting**: Verify `ingest.py --summary` generates markdown with `<!-- Template: v1.0 -->` tag, `**Metadata:**` block, and all required metadata fields (topic_id, session_id, plan_id, status, timestamps).
     - **Test metadata embedding**: Verify metadata fields are embedded in searchable text format with exact heading matches ("## Context", "## Key Decisions", etc.).
     - **Test template structure validation**: Verify enriched text includes all mandatory content sections; missing sections fail with actionable error codes.
     - **Test legacy compatibility**: Verify `ingest.py` without `--summary` still works (raw-text path unaffected).
     - **Test template version handling**: Verify version tag is present and correctly embedded.
   - **Acceptance**: Pytest tests pass covering all §4.4.1 requirements; enriched text ingestion contract validated; test output logs confirm deterministic behavior.

**Owner**: Implementer
**Dependencies**: Milestone 2 (summary generation command)
**Validation**: Pytest passes; manual test confirms summary is stored in `.cognee_data/`.

---

### Milestone 4: Update Retrieval to Return Structured JSON

**Objective**: Migrate `retrieve.py` to return structured JSON payloads with metadata fields, enabling TypeScript consumers to display rich context without text parsing.

**Tasks**:

1. **Implement Structured Retrieval Output** (`extension/bridge/retrieve.py`)
   - Modify `retrieve.py` to return JSON matching contract from Milestone 0 per §4.4.1 regex parsing requirements:
     - Query Cognee for memories matching search query.
     - For each result, detect if it contains enriched metadata by checking for "**Metadata:**" section in text:
       - **Parse metadata fields using regex** (patterns documented in `DATAPOINT_SCHEMA.md`): `topic_id`, `plan_id`, `session_id`, `status`, `created_at`, `updated_at`.
       - **Parse content sections** using deterministic heading patterns: `topic`, `context`, `decisions`, `rationale`, `open_questions`, `next_steps`, `references`.
       - Include validation hooks: if regex groups fail to match, log error with malformed text snippet and return structured error payload with actionable error code.
       - Include Cognee similarity `score`.
       - Format structured JSON entry.
     - For legacy raw-text memories (no "**Metadata:**" section) per §4.4.1 mixed-mode requirement:
       - Include `summary_text` (raw text), set all metadata fields to `null`, `status: null`.
       - Ensure TypeScript consumers can branch on `topic_id` presence to detect enriched vs legacy.
     - Return JSON array of structured results with `total_results` count.
   - **CRITICAL per §4.4.1**: Regex patterns must match `summaryTemplate.ts` section headings exactly. Any template changes require synchronized updates.
   - **Acceptance**: `retrieve.py` returns JSON matching contract; parses and includes metadata for enriched summaries; handles legacy memories gracefully; malformed summaries fail loudly with error codes; test suite validates regex extraction.

2. **Update CogneeClient to Parse Structured Responses** (`extension/src/cogneeClient.ts`)
   - Modify `CogneeClient.retrieve` to:
     - Parse JSON response from `retrieve.py`.
     - Handle error payloads from malformed summaries; log actionable error messages to Output channel.
     - Return TypeScript array of `RetrievalResult` objects (new interface matching contract):
       ```typescript
       interface RetrievalResult {
         summaryText: string;
         topic?: string;
         topicId?: string;
         planId?: string;
         sessionId?: string;
         status?: "active" | "completed" | "archived";
         createdAt?: Date;
         score: number;
         decisions?: string[];
         rationale?: { [key: string]: string };
         openQuestions?: string[];
         nextSteps?: string[];
         references?: string[];
       }
       ```
     - Handle both enriched text results (full metadata) and legacy results (null metadata) per §4.4.1 mixed-mode requirement.
     - Branch logic: if `result.topicId` is null, treat as legacy memory; if present, treat as enriched summary.
   - **Acceptance**: `CogneeClient.retrieve` returns structured objects; TypeScript consumers can access metadata directly; mixed-mode handling tested with both enriched and legacy memories.

3. **Enhance Chat Participant to Display Metadata** (`extension/src/chatParticipant.ts`)
   - Update participant to consume `RetrievalResult` objects instead of parsing text:
     - Display summary with metadata badges when available:
       ```markdown
       **Summary: {topic}**
       📋 Status: {status} | 📅 Created: {createdAt} | 🏷️ Plan: {planId}
       
       **Context**: {context bullets}
       **Decisions**: {decisions bullets}
       **Rationale**: {rationale}
       **Open Questions**: {openQuestions}
       **Next Steps**: {nextSteps}
       **References**: {references}
       ```
     - For legacy results (no metadata), display plain summary text.
     - Apply Plan 013 transparency policy: show full summary text up to 1000 characters; if longer, show truncation indicator.
   - **Acceptance**: Retrieved summaries display metadata when available; users see status, timestamps, plan IDs; legacy memories still work.

4. **Add Retrieval Contract Tests** (`extension/bridge/test_datapoint_contract.py`)
   - Add tests verifying `retrieve.py` output per §4.4.1 testing mandates:
     - **Test enriched-text retrieval**: Verify JSON includes all metadata fields parsed from "**Metadata:**" section; validate regex extraction accuracy.
     - **Test legacy retrieval**: Verify raw-text memories return with null metadata; ensure no parsing failures on plain text.
     - **Test mixed results**: Verify response handles both enriched and legacy results in same query; TypeScript consumers can branch on `topic_id` presence.
     - **Test metadata parsing accuracy**: Verify regex correctly extracts topic_id, status, timestamps from text; test edge cases (missing fields, malformed dates).
     - **Test validation hooks**: Verify malformed summaries (missing sections, invalid metadata format) return error payloads with actionable error codes instead of crashing.
     - **Test JSON contract compliance**: Verify response structure exactly matches `RETRIEVE_CONTRACT.md` schema.
   - **Acceptance**: Pytest tests pass covering all §4.4.1 retrieval requirements; retrieval contract validated; malformed summary handling tested.

**Owner**: Implementer
**Dependencies**: Milestone 3 (summary ingestion working)
**Validation**: Manual test: ingest summary, retrieve it via `@cognee-memory`, confirm structured display.

---

### Milestone 5: User-Facing Documentation and Guidance

**Objective**: Ensure users understand how to create and retrieve summaries.

**Tasks**:

1. **Update README with Summary Workflow** (`extension/README.md`)
   - Add section "Creating Conversation Summaries" with:
     - Explanation of when to create summaries (after design discussions, decision milestones).
     - Step-by-step instructions for invoking `@cognee-memory` to generate summaries.
     - Example of confirmation flow and what gets stored.
   - Add section "Retrieving Summaries" with:
     - Explanation of how to query for past summaries (e.g., "What did we decide about Plan 013?").
     - Example of structured summary display in chat.
   - **Acceptance**: README clearly documents summary creation and retrieval workflows.

2. **Add In-Chat Help Text** (`extension/src/chatParticipant.ts`)
   - When user invokes `@cognee-memory` with no query or with "help", show brief usage text:
     - "Ask a question to retrieve context, or say 'summarize this conversation' to create a memory."
   - **Acceptance**: Help text visible when participant invoked without clear intent.

3. **Create CHANGELOG Entry** (`extension/CHANGELOG.md`)
   - Document Plan 014 as new feature: "Structured conversation summaries - create and retrieve summaries using the Plan 014 schema."
   - Note backward compatibility with legacy raw-text memories.
   - **Acceptance**: CHANGELOG updated; release notes ready.

**Owner**: Implementer
**Dependencies**: Milestones 2-4 (all features implemented)
**Validation**: Documentation reviewed; in-chat help text verified.

---

### Milestone 6: Update Version and Release Artifacts

**Objective**: Update extension version to v0.3.0 and document changes for roadmap alignment.

**Steps**:

1. Update version in `extension/package.json` to 0.3.0
2. Add CHANGELOG entry under v0.3.0 section:
   - "New: Structured conversation summaries with content-only schema (Topic, Context, Decisions, Rationale, Open Questions, Next Steps, References, Time Scope)"
   - "New: @cognee-memory participant can generate and store summaries on demand"
   - "Improved: Retrieval displays summaries in structured, transparent format"
   - "Note: Backward compatible with legacy raw-text memories"
   - "Note: Metadata fields and compaction deferred to v0.4.0 (Plan 015)"
3. Update README with summary workflow sections (completed in Milestone 6)
4. Verify VSIX filename will be `cognee-chat-memory-0.3.0.vsix` during packaging
5. Update `extension/README.md` to reflect v0.3.0 features if not already done
6. Commit version changes with message: "Release v0.3.0 - Plan 014: Structured Conversation Summaries"

**Acceptance Criteria**:
- Version artifacts updated to 0.3.0
- CHANGELOG reflects Plan 014 deliverables under v0.3.0
- Version matches roadmap target (Epic 0.3.0.2)
- Extension manifest and package.json versions are consistent

---

## Testing Strategy

### Unit Tests

- `summaryTemplate.ts`: Validate formatting of `ConversationSummary` to markdown.
- `summaryParser.ts`: Validate parsing of markdown back to `ConversationSummary` struct.
- `extension/bridge/test_ingest.py`: Validate `ingest.py --summary` correctly formats and ingests structured summaries.

### Integration Tests

- End-to-end test: Generate summary via `@cognee-memory`, confirm it's stored, retrieve it, confirm structured display.
- Backward compatibility test: Ingest legacy raw-text memory, confirm it's still retrievable alongside new summaries.

### Manual Validation

- QA will:
  - Install extension, have a sample chat conversation.
  - Invoke `@cognee-memory` with "summarize this conversation."
  - Confirm summary is generated in Plan 014 format and displayed for approval.
  - Approve summary storage.
  - Query for the summary (e.g., "What did we decide about X?").
  - Confirm summary is retrieved and displayed in structured format.
  - Verify Output channel logs show summary topic.

### Coverage Expectations

- Unit test coverage ≥80% for new TypeScript modules (`summaryTemplate`, `summaryParser`).
- Integration test coverage: at least one end-to-end test per milestone (summary generation, ingestion, retrieval).
- No regressions in existing pytest suite (`extension/bridge/test_*.py`).

---

## Validation

### Definition of Done

- [ ] Users can invoke `@cognee-memory` to generate structured summaries from recent chat history.
- [ ] Summaries are displayed for user confirmation before storage.
- [ ] `ingest.py --summary` successfully stores summaries in Cognee with backward compatibility for legacy raw-text.
- [ ] Retrieval returns summaries and displays them in structured, readable format (Plan 013 transparency).
- [ ] README and CHANGELOG document summary workflows.
- [ ] All unit and integration tests pass.
- [ ] Manual QA validates end-to-end workflow (generate → store → retrieve).

### Rollback Plan

If summary ingestion or retrieval introduces breaking changes:

- Disable `--summary` mode in `ingest.py` and revert to raw-text ingestion only.
- Remove summary generation command from chat participant.
- Existing raw-text memories remain unaffected; rollback is non-destructive.

---

## Risks and Open Questions

### Risks

1. **LLM Summary Quality**: LLM may not reliably produce summaries in the Plan 014 schema format, requiring prompt refinement.
   - Mitigation: Use few-shot examples in the prompt; validate with `summaryParser` and prompt user to correct if parsing fails.

2. **User Consent Fatigue**: Frequent "Should I store this summary?" prompts may annoy users.
   - Mitigation: Require explicit invocation (no automatic summarization); user controls when summaries are created.

3. **Schema Rigidity**: Plan 014 schema may not fit all conversation types (exploratory, research-heavy).
   - Mitigation: Document that summaries are optional and best suited for decision-oriented conversations; users can skip summarization for other types.

4. **Retrieval Noise**: Summaries may dilute retrieval results if not scoped properly.
   - Mitigation: Deferred to Plan 015; this plan focuses on storage and basic retrieval, not optimized ranking.

### Open Questions

1. **RESOLVED**: How should the chat participant handle very long conversations (>50 turns)?
   - **Decision**: Default to last 15 turns (fixed). Show user preview: "I'll summarize the last 15 turns (from [time ago])." User can override by typing a number (e.g., "30") before confirming. If session has large time gap (oldest turn >24 hours ago), warn user to consider narrowing scope. This balances simplicity (fixed default) with flexibility (user override).

---

## Dependencies

- **Upstream**: None (Plan 014 is foundational for structured summaries).
- **Downstream**: Plan 015 will build on this plan's metadata foundation to add recency-aware ranking algorithms, status-based filtering, and compaction workflows. Plan 016 depends on the structured bridge contract (Milestone 0) to implement `CogneeContextProvider`.
- **Architectural**: Fully aligns with `system-architecture.md` §4.4, §4.4.1 (Enriched Text Metadata Fallback), and §9 (Bridge Migration for Structured Summaries, Enriched Text Metadata Fallback decision). This plan delivers the enriched-text ingestion and structured retrieval contract required by the architecture, with mandatory template versioning and mixed-mode handling per §4.4.1 testing mandates.

---

## Handoff Notes for Implementer

- **Start with Milestone 0**: Define and validate bridge contracts before any implementation; ensures architectural alignment and prevents rework.
- **Template Versioning is MANDATORY per §4.4.1**: Any changes to section headings or metadata format in `summaryTemplate.ts` require synchronized updates to `ingest.py` and `retrieve.py` regex patterns. Document all changes in `DATAPOINT_SCHEMA.md`.
- **Bridge Focus**: Most critical work is in Python bridge (`ingest.py` enriched-text creation, `retrieve.py` regex-based parsing + structured JSON output). This is an architectural migration with fragile regex dependencies—test coverage is critical.
- **TypeScript Consumes Contract**: TypeScript work (`cogneeClient`, `chatParticipant`) is straightforward once bridge contract is stable; focus on consuming structured metadata and handling mixed-mode (enriched + legacy) gracefully.
- **Testing First per §4.4.1**: Implement bridge contract tests in Milestone 0/3 covering enriched-text formatting, metadata parsing, legacy regression, and JSON contract validation before any UI work. This proves the foundation is solid and catches template drift early.
- **Mixed-Mode Handling Required**: TypeScript and Python layers must branch on `topicId`/`status` presence to distinguish enriched summaries from legacy memories. Test both paths thoroughly.
- **Plan 016 Coordination**: The bridge contract from Milestone 0 is a dependency for Plan 016; coordinate with Plan 016 implementer to ensure schema meets `CogneeContextProvider` requirements.
- **Manual QA Critical**: Have QA validate full workflow (generate → confirm → store → retrieve) AND verify metadata display (status badges, timestamps) in live VS Code environment. Test with both enriched summaries and legacy memories.

---

## Success Criteria

**Plan 014 is successful when**:

- Users can create structured conversation summaries via `@cognee-memory` with a single command.
- Summaries are stored in Cognee and retrievable alongside legacy raw-text memories without confusion.
- Retrieved summaries are displayed in a structured, transparent format that aligns with Plan 013's UX goals.
- Documentation and in-chat help clearly guide users through summary workflows.
- All tests pass and QA validates the end-to-end experience.

**Alignment with Master Product Objective**:

- **Automatic Context Capture**: Summaries reduce cognitive overhead by distilling conversation essence into retrievable records.
- **Natural Language Retrieval**: Structured summaries improve retrieval quality by providing semantic anchor points (Topic, Decisions).
- **Zero Cognitive Overhead**: User-controlled summarization ensures the extension doesn't become a burden; users create summaries only when valuable.
