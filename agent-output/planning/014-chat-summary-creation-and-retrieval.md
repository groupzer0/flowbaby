# Plan 014: Chat Summary Creation and Retrieval

**Plan ID**: 014
**Target Release**: v0.3.0 (from Roadmap Epic 0.3.0.2)  
**Created**: 2025-11-16
**Status**: Draft
**Epic Alignment**: Epic 0.3.0.2 - Structured Conversation Summaries  
**Related Analysis**: `analysis/014-chat-conversation-summaries-and-agent-instructions-analysis.md`, `analysis/014-bridge-focused-addendum-analysis.md`
**Architectural References**: `architecture/system-architecture.md` §4.4, §9 (Bridge Migration for Structured Summaries)

---

## Value Statement and Business Objective

As a developer using Cognee Chat Memory and GitHub Copilot Chat,
I want my conversations to be periodically summarized and stored in a structured format with metadata (topic, time, plan references) optimized for retrieval,
So that future chat sessions can automatically rediscover relevant context, decisions, and rationale without me manually re-reading old threads or losing valuable insights.

---

## Objective

Implement the **creation, ingestion, and retrieval** of structured conversation summaries **with metadata** in the Cognee Chat Memory extension. This plan focuses on:

1. Defining and storing chat summaries using the Plan 014 schema (Topic, Context, Decisions, Rationale, OpenQuestions, NextSteps, References, TimeScope).
2. **Defining and implementing metadata fields** (topic_id, session_id, plan_id, timestamps) that will be used for future ranking and compaction (Plan 015).
3. Updating the `@cognee-memory` chat participant to generate summaries on demand.
4. Updating `ingest.py` to accept and store structured summaries with metadata as plain text (transitional format; will migrate to DataPoints in Plan 015).
5. Ensuring `retrieve.py` can return stored summaries **without introducing any new ranking logic** (relies on Cognee's existing similarity-based ranking).
6. **Implementing initial manual compaction trigger** (command/button) with recommended usage cadence.
7. Ensuring transparency in the TypeScript layer so users can inspect what is stored and retrieved.

**Out of Scope (deferred to Plan 015)**:

- **Recency-aware ranking algorithms** (exponential decay, configurable weights)
- **DataPoint-based ingestion** with Pydantic models and `metadata.index_fields`
- **Compaction behavior evolution** (automated triggers, LLM-based summarization of DecisionRecords)
- **Status-aware retrieval logic** (`Superseded` filtering, DecisionRecord prioritization)

---

## Assumptions

1. **User Workflow**: Users will explicitly invoke summary creation via `@cognee-memory` commands or by asking "summarize this conversation."
2. **Schema Adoption**: The Plan 014 summary schema (Topic/Context/Decisions/etc.) is sufficient for capturing conversation essence without requiring custom DataPoints in this phase.
3. **Metadata in This Plan**: This plan **defines and implements** metadata fields (topic_id, session_id, plan_id, timestamps) as part of the plain-text summary format; Plan 015 will migrate these to DataPoints.
4. **Backward Compatibility**: Legacy raw-text memories from Plans 001-011 remain accessible; new summaries coexist with old ingestion format.
5. **No New Ranking Logic**: Retrieval will return Cognee's native similarity-based results **without any changes to ranking algorithms**; recency-aware ranking is exclusively Plan 015's responsibility.
6. **Transitional Ingestion Format**: Plain-text summary ingestion with embedded metadata (this plan) is a **temporary step** toward DataPoint-based ingestion (Plan 015); code should be structured to ease migration.
7. **TypeScript Transparency**: All summary text and metadata are surfaced to the user via chat participant markdown and Output channel logs.

---

## Plan

### Milestone 1: Define and Validate Summary Schema with Metadata

**Objective**: Establish the summary structure as a reusable text template **with metadata fields** and validate it with a sample conversation.

**Tasks**:

1. **Create Summary Template Module** (`extension/src/summaryTemplate.ts`)
   - Define TypeScript interface `ConversationSummary` with fields:
     - **Content fields**: `topic`, `context`, `decisions`, `rationale`, `openQuestions`, `nextSteps`, `references`, `timeScope`.
     - **Metadata fields**: `topicId` (string; slugified topic), `sessionId` (string; date-based session identifier), `planId` (optional string; extracted from references), `createdAt` (ISO8601 timestamp), `status` (default "Final").
   - Implement function `formatSummaryAsText(summary: ConversationSummary): string` that produces the Plan 014 markdown format including metadata footer:

     ```markdown
     ---
     Metadata: topic_id={topicId}, session_id={sessionId}, plan_id={planId}, created_at={createdAt}, status={status}
     ```

   - Include validation logic to ensure required fields (`topic`, `context`, `topicId`, `sessionId`, `createdAt`) are present.
   - **Acceptance**: Template generates valid markdown with metadata footer; unit test confirms formatting.

2. **Create Summary Parser Module** (`extension/src/summaryParser.ts`)
   - Implement function `parseSummaryFromText(text: string): ConversationSummary | null` to extract structured fields from markdown summary.
   - Handle optional fields gracefully (e.g., missing `OpenQuestions` section).
   - **Acceptance**: Parser correctly round-trips a formatted summary; unit test confirms parsing.

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
   - Extract recent chat turns from `request.history` (default: last 10-20 turns).
   - Send a prompt to the LLM asking it to generate a summary in the Plan 014 schema format.
   - Parse the LLM's response using `summaryParser.parseSummaryFromText`.
   - Display the summary to the user via `stream.markdown` and ask: "Should I store this summary in Cognee memory?"
   - **Acceptance**: User can trigger summary generation; LLM produces valid schema; summary is displayed for confirmation.

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

### Milestone 3: Update Python Bridge for Structured Summary Ingestion

**Objective**: Modify `ingest.py` to accept and store structured summaries while preserving backward compatibility with raw-text ingestion.

**Tasks**:

1. **Extend Ingest Script to Accept Summary Format with Metadata** (`extension/bridge/ingest.py`)
   - Add new CLI argument `--summary` (boolean flag) to indicate structured summary ingestion vs legacy raw-text.
   - Add new CLI arguments for metadata: `--topic-id`, `--session-id`, `--plan-id` (optional), `--status` (default "Final").
   - When `--summary` is true:
     - Expect `user_message` to contain the summary title/topic.
     - Expect `assistant_message` to contain the full structured summary text (Topic/Context/Decisions/etc.).
     - Format as a single blob:

       ```text
       Summary: {topic}
       
       {full summary text}
       
       Metadata: topic_id={topic_id}, session_id={session_id}, plan_id={plan_id}, created_at={timestamp}, status={status}
       ```

   - When `--summary` is false (default):
     - Use existing raw-text format (Plan 010 behavior).
   - **Note**: This plain-text format with embedded metadata is **transitional**; Plan 015 will migrate to DataPoint-based ingestion. Code should be structured to ease this migration (e.g., separate metadata extraction helper).
   - **Acceptance**: `ingest.py --summary --topic-id "..." --session-id "..."` ingests structured summaries with metadata; `ingest.py` without flag preserves legacy behavior.

2. **Update CogneeClient to Support Summary Ingestion with Metadata** (`extension/src/cogneeClient.ts`)
   - Add method `ingestSummary(summary: ConversationSummary): Promise<void>` that:
     - Generates metadata fields if not already present:
       - `topicId`: slugify `summary.topic` (e.g., "Plan 014 Summary" → "plan-014-summary").
       - `sessionId`: generate from current date (e.g., "2025-11-16-session-1").
       - `planId`: extract from `summary.references.plans` if present, else `null`.
       - `createdAt`: current ISO8601 timestamp.
       - `status`: default "Final".
     - Calls `formatSummaryAsText(summary)` to get the full markdown text with metadata footer.
     - Invokes `ingest.py --summary --topic-id "{topicId}" --session-id "{sessionId}" --plan-id "{planId}" --status "{status}" --user-message "{summary.topic}" --assistant-message "{summaryText}" --timestamp "{createdAt}" --importance "high"`.
     - Logs the operation to Output channel with summary topic, metadata, and timestamp.
   - **Acceptance**: `CogneeClient.ingestSummary` successfully stores summaries with metadata; logs confirm ingestion and metadata values.

3. **Add Integration Test for Summary Ingestion** (`extension/bridge/test_ingest.py`)
   - Write pytest test that mocks Cognee SDK and verifies `ingest.py --summary` formats data correctly and calls `cognee.add` + `cognee.cognify`.
   - Validate that `Metadata: summary_type=structured` is included.
   - **Acceptance**: Pytest test passes; structured summary ingestion path is validated.

**Owner**: Implementer
**Dependencies**: Milestone 2 (summary generation command)
**Validation**: Pytest passes; manual test confirms summary is stored in `.cognee_data/`.

---

### Milestone 4: Update Retrieval to Return Structured Summaries

**Objective**: Ensure `retrieve.py` can return structured summaries and that the chat participant displays them transparently.

**Tasks**:

1. **Verify Retrieval Works with Summaries** (`extension/bridge/retrieve.py`)
   - No code changes required initially; `retrieve.py` already searches all ingested text.
   - Confirm via manual test that structured summaries are returned in search results.
   - **Acceptance**: Retrieval returns summaries when queried with relevant topics/keywords.

2. **Enhance Chat Participant to Display Summaries Transparently** (`extension/src/chatParticipant.ts`)
   - When retrieval results include structured summaries (detected by presence of "Summary:" or "Metadata:" markers in text):
     - Parse the summary sections (Topic, Context, Decisions, etc.) using `summaryParser.parseSummaryFromText`.
     - Extract metadata from the "Metadata:" footer line (topic_id, session_id, plan_id, created_at, status).
     - Display summary in a readable format via `stream.markdown`:

       ```markdown
       **Summary: {topic}** (topic: {topic_id}, created: {created_at})
       
       **Context**: {context bullets}
       **Decisions**: {decisions bullets}
       ...
       ```

   - Apply Plan 013 transparency policy: show full summary text up to 1000 characters; if longer, show truncation indicator and offer "Show more".
   - **Note**: This marker-based detection is **temporary**; Plan 015 will migrate to relying on structured JSON metadata fields from `retrieve.py` responses instead of text pattern matching.
   - **Acceptance**: Retrieved summaries are displayed in structured, readable format with metadata; users can see full context and metadata.

3. **Log Retrieval Results with Summary Metadata** (`extension/src/cogneeClient.ts`)
   - When `CogneeClient.retrieve` returns results, log summary topics and timestamps to Output channel.
   - Include indication if result is a structured summary vs legacy raw text.
   - **Acceptance**: Logs clearly distinguish summaries from raw-text memories; timestamps visible.

**Owner**: Implementer
**Dependencies**: Milestone 3 (summary ingestion working)
**Validation**: Manual test: ingest summary, retrieve it via `@cognee-memory`, confirm structured display.

---

### Milestone 5: Implement Manual Compaction Trigger with Recommended Cadence

**Objective**: Provide users with a manual tool to trigger memory compaction and document when/why to use it.

**Tasks**:

1. **Create Compaction Command** (`extension/src/commands.ts`)
   - Add VS Code command `cognee.compactMemories` that:
     - Prompts user: "Compaction will consolidate redundant summaries for a topic. Continue?"
     - On confirmation, prompts user to enter a topic ID or select from recently used topics.
     - Calls a new bridge script placeholder `compact.py --workspace-path "{workspace}" --topic-id "{topic_id}"` (implementation deferred to Plan 015; for now, log a message: "Compaction triggered for topic {topic_id}. Full compaction implementation coming in Plan 015.").
     - Shows notification: "Compaction queued for topic {topic_id}."
   - **Acceptance**: Command palette includes "Compact Cognee Memories"; user can trigger compaction flow (even if behavior is placeholder).

2. **Document Recommended Compaction Cadence** (`extension/README.md`)
   - Add section "Memory Compaction" explaining:
     - What compaction does: consolidates multiple summaries for a topic into a single decision record, marks old summaries as superseded.
     - **Recommended cadence**: Run compaction manually when:
       - A topic accumulates 5+ summaries.
       - After completing a major milestone or plan (e.g., end of Plan 014 implementation).
       - Weekly or bi-weekly for active projects with frequent conversations.
     - Include warning: "Compaction is irreversible; always review summaries before compacting."
   - **Acceptance**: README clearly documents compaction purpose, when to use it, and recommended cadence.

3. **Add Compaction Hint to Chat Participant** (`extension/src/chatParticipant.ts`)
   - When retrieval returns 5+ summaries for the same topic, display hint:

     ```text
     ℹ️ Tip: You have {N} summaries for this topic. Consider running "Compact Cognee Memories" to consolidate them.
     ```

   - **Acceptance**: Hint displayed when appropriate; users are prompted to compact when memory graph grows.

**Owner**: Implementer
**Dependencies**: Milestones 1-4 (summary ingestion and retrieval functional)
**Validation**: Command exists in palette; README documents cadence; hint appears when many summaries exist.

---

### Milestone 6: User-Facing Documentation and Guidance

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
**Dependencies**: Milestones 2-5 (all features implemented)
**Validation**: Documentation reviewed; in-chat help text verified.

---

### Milestone 7: Update Version and Release Artifacts

**Objective**: Update extension version to v0.3.0 and document changes for roadmap alignment.

**Steps**:

1. Update version in `extension/package.json` to 0.3.0
2. Add CHANGELOG entry under v0.3.0 section:
   - "New: Structured conversation summaries with metadata (topic, session, plan IDs, timestamps, status)"
   - "New: Summary schema with decisions, rationale, open questions, next steps, and references"
   - "New: @cognee-memory participant can generate and store summaries on demand"
   - "New: Manual compaction trigger (command/button) with recommended usage cadence"
   - "Improved: Retrieval displays summaries in structured, transparent format"
   - "Note: Backward compatible with legacy raw-text memories"
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
  - Verify Output channel logs show summary metadata (topic, timestamp).

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

1. **OPEN QUESTION**: Should summaries include a `status` field (Draft/Final) in this plan, or defer to Plan 015?
   - **Recommendation**: Defer to Plan 015; Plan 014 summaries default to "Final" implicitly.

2. **OPEN QUESTION**: Should summary topics be automatically slugified (e.g., "Plan 013 Memory Truncation" → "plan-013-memory-truncation") for consistency?
   - **Recommendation**: Yes; implement `slugify(topic)` helper in `summaryTemplate.ts`.

3. **OPEN QUESTION**: How should the chat participant handle very long conversations (>50 turns)?
   - **Recommendation**: Limit summary generation to last 20 turns; user can manually segment longer conversations.

---

## Dependencies

- **Upstream**: None (Plan 014 is foundational for structured summaries).
- **Downstream**: Plan 015 will build on this plan to add metadata-driven ranking, compaction, and DataPoint-based ingestion.
- **Architectural**: Aligns with `system-architecture.md` §4.4 (Plan 014 Bridge Modernization); this plan implements the ingestion/retrieval prerequisites.

---

## Handoff Notes for Implementer

- **Start with Milestone 1**: Establish the schema and template module before touching the chat participant or bridge.
- **TypeScript Focus**: Most of the work is in TypeScript (`summaryTemplate`, `summaryParser`, `chatParticipant`, `cogneeClient`).
- **Bridge Changes Minimal**: `ingest.py` requires only a `--summary` flag and conditional formatting; no architectural refactor.
- **Testing First**: Write unit tests for template/parser before integrating into chat participant; this ensures schema is stable.
- **Manual QA Critical**: Have QA validate the full user workflow (generate → confirm → store → retrieve) in a live VS Code environment with real Cognee SDK.

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
