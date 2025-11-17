# Plan 015: Metadata Infrastructure, Ranking, and Compaction

**Plan ID**: 015
**Target Release**: v0.3.0 (from Roadmap Epic 0.3.0.1)  
**Created**: 2025-11-16
**Status**: Draft
**Epic Alignment**: Epic 0.3.0.1 - Context Ranking and Relevance  
**Related Analysis**: `analysis/014-chat-conversation-summaries-and-agent-instructions-analysis.md`, `analysis/014-bridge-focused-addendum-analysis.md`
**Architectural References**: `architecture/system-architecture.md` §4.4, §9 (Bridge Migration for Structured Summaries, Structured Conversation Summaries & Compaction)
**Prerequisite Plans**: Plan 014 (chat summary creation and retrieval must be functional)

---

## Value Statement and Business Objective

As a developer with a growing collection of conversation summaries in Cognee Chat Memory,
I want the system to automatically rank results by relevance and recency, compact redundant summaries into decision records, and prevent memory graph bloat,
So that retrieval stays fast, accurate, and high-signal even as my workspace knowledge accumulates over months of work.

---

## Objective

Implement the **DataPoint migration, recency-aware ranking algorithms, and compaction behavior evolution** building on Plan 014's metadata foundation. This plan focuses on:

1. **DataPoint Migration**: Migrate ingestion from Plan 014's plain-text format to Cognee DataPoints with Pydantic models, using the metadata fields (`topic_id`, `session_id`, `plan_id`, `status`, timestamps) **already defined and implemented in Plan 014**.
2. **Recency-Aware Ranking Algorithms**: Implement transparent scoring in `retrieve.py` that combines Cognee's semantic similarity with exponential timestamp decay and configurable weights.
3. **Compaction Behavior Evolution**: Implement the actual compaction logic (LLM-based DecisionRecord creation, status transitions) for the manual trigger **already exposed in Plan 014**; optionally add automation/scheduling.
4. **Status-Aware Retrieval**: Prefer `DecisionRecord` entries and filter/downrank `Superseded` summaries unless user explicitly requests history.
5. **Bridge Transparency**: Extend JSON responses from `retrieve.py` to include all metadata (topic, plan, status, created_at, final_score) so the TypeScript layer can display ranking rationale.

**Out of Scope**:

- Metadata field definition (already done in Plan 014).
- Initial manual compaction trigger UI (already done in Plan 014; this plan implements the backend behavior).
- Automated summarization triggers (user-controlled summarization remains from Plan 014).
- Cross-workspace context sharing (deferred to future roadmap epics).

---

## Assumptions

1. **Plan 014 Delivered**: Chat summary creation, ingestion with metadata (topic_id, session_id, plan_id, timestamps), basic retrieval, and manual compaction trigger are functional; users are creating summaries in the Plan 014 schema with embedded metadata.
2. **Metadata Defined in Plan 014**: This plan **does not define new metadata fields**; it migrates the metadata structure from Plan 014's plain-text format to DataPoints and uses those fields for ranking/compaction.
3. **Cognee DataPoint Support**: Cognee SDK (v0.4.0 or compatible) supports custom DataPoints with Pydantic models and `metadata.index_fields`; **this will be explicitly verified in Milestone 1**.
   - **Contingency Path**: If DataPoint API is unsupported or incomplete:
     - Milestone 1 will be blocked; planner must be consulted for re-planning.
     - Minimal fallback scope (if re-planned): implement ranking on existing metadata (timestamps extracted from text), status-aware retrieval on plain-text status markers, and defer DataPoint migration + compaction to a future plan.
     - Full DataPoint migration (Milestones 2-5) cannot proceed without verified API support.
4. **Python-Side Ranking**: Recency-aware scoring is implemented in `retrieve.py` (Python) because it has direct access to Cognee search results and metadata.
5. **Manual Compaction Trigger Exists**: Plan 014 exposed a manual compaction command/button; this plan implements the actual backend behavior (`compact.py`) that the trigger calls.
6. **Backward Compatibility**: Legacy raw-text memories from Plans 001-014 remain accessible; compaction only applies to structured summaries.
7. **Mixed Memory Retrieval**: When both legacy raw-text memories and DataPoint-backed summaries match a query:
   - Retrieval will prioritize DataPoint-backed summaries/DecisionRecords (they receive full ranking treatment).
   - Legacy memories will be appended after DataPoint results, sorted by Cognee's default similarity only, and labeled with `[Legacy]` tag in UI.
   - Users can distinguish memory types via metadata presence (DataPoint results include full metadata; legacy results do not).
8. **Status Semantics Alignment**: Plan 014 summaries (plain-text with embedded metadata) default to `status = "Final"` implicitly. When migrated to DataPoints in this plan, they are explicitly marked `status = "Final"` unless compaction has superseded them. The `Draft` status is reserved for future use; `Superseded` is set only by compaction.

---

## Plan

### Milestone 1: Define DataPoint Models and Metadata Schema

**Objective**: Establish Pydantic DataPoint models for `ConversationSummary` and `DecisionRecord` with indexed and non-indexed metadata fields.

**Tasks**:

1. **Verify Cognee DataPoint API Support** (prerequisite spike)
   - Inspect Cognee SDK (v0.4.0 or compatible) to confirm:
     - Custom Pydantic DataPoint models are supported.
     - `metadata.index_fields` configuration works as expected.
     - `cognee.add(data=[datapoint], ...)` correctly ingests DataPoints.
     - `cognee.search` returns DataPoint properties in results.
   - If API differs from assumptions, document differences and adjust plan accordingly **before proceeding**.
   - Create a minimal test script (`test_cognee_datapoint_api.py`) that validates DataPoint CRUD operations.
   - **Acceptance**: Cognee DataPoint API verified; test script passes; any API deviations documented.
   - **Gate**: Do not proceed to Task 2 until API is verified; if unsupported, escalate to planner for re-planning.

2. **Create DataPoint Models** (`extension/bridge/datapoints.py`)
   - Define `ConversationSummary` Pydantic model with fields:
     - `topic_id: str` (indexed)
     - `session_id: str` (non-indexed)
     - `plan_id: Optional[str]` (indexed)
     - `status: str` (non-indexed; values: `Draft`, `Final`, `Superseded`)
     - `created_at: datetime` (non-indexed)
     - `updated_at: datetime` (non-indexed)
     - `summary_text: str` (indexed; main content)
     - `decisions: List[str]` (indexed)
     - `rationale: List[str]` (non-indexed)
     - `open_questions: List[str]` (non-indexed)
     - `next_steps: List[str]` (non-indexed)
     - `references_files: List[str]` (non-indexed)
     - `references_plans: List[str]` (non-indexed)
     - `references_branches: List[str]` (non-indexed)
     - `references_issues: List[str]` (non-indexed)
   - Configure `metadata.index_fields = ["topic_id", "plan_id", "summary_text", "decisions"]`.
   - Define `DecisionRecord` Pydantic model with fields:
     - `topic_id: str` (indexed)
     - `plan_id: Optional[str]` (indexed)
     - `status: str = "Final"` (non-indexed)
     - `created_at: datetime` (non-indexed)
     - `updated_at: datetime` (non-indexed)
     - `consolidated_decisions: List[str]` (indexed)
     - `consolidated_rationale: List[str]` (non-indexed)
     - `key_open_questions: List[str]` (non-indexed)
     - `key_references_files: List[str]` (non-indexed)
     - `key_references_plans: List[str]` (non-indexed)
     - `key_references_branches: List[str]` (non-indexed)
     - `key_references_issues: List[str]` (non-indexed)
     - `summary_text: str` (indexed; consolidated narrative)
   - Configure `metadata.index_fields = ["topic_id", "plan_id", "summary_text", "consolidated_decisions"]`.
   - **Acceptance**: DataPoint models defined; pytest test confirms instantiation and field access.

3. **Document Metadata Schema** (`extension/bridge/README.md`)
   - Add section explaining the DataPoint models, indexed vs non-indexed fields, and metadata propagation.
   - Include examples of how to create and ingest DataPoints.
   - **Acceptance**: Schema documented; implementers understand metadata structure.

4. **Add Pytest Tests for DataPoints** (`extension/bridge/test_datapoints.py`)
   - Test instantiation of `ConversationSummary` and `DecisionRecord`.
   - Validate that `metadata.index_fields` is correctly configured.
   - **Acceptance**: Pytest tests pass; DataPoint models validated.

**Owner**: Implementer
**Dependencies**: None (foundational)
**Validation**: Pytest passes; schema documented.

---

### Milestone 2: Migrate Ingestion to DataPoint-Based Format

**Objective**: Update `ingest.py` to create and ingest `ConversationSummary` DataPoints instead of plain text blobs.

**Tasks**:

1. **Update Ingest Script for DataPoint Ingestion** (`extension/bridge/ingest.py`)
   - When `--summary` flag is present:
     - Parse CLI arguments to extract `topic_id`, `session_id`, `plan_id` (new args).
     - Parse `assistant_message` (full summary text) to extract structured fields (decisions, rationale, etc.) using a helper function.
     - Create `ConversationSummary` DataPoint instance with all fields populated.
     - Call `cognee.add(data=[summary_datapoint], dataset_name=dataset_name)` followed by `cognee.cognify`.
   - Maintain backward compatibility: if `--summary` is false, use legacy plain-text format.
   - **Acceptance**: `ingest.py --summary --topic-id "..." --session-id "..." --plan-id "..."` ingests DataPoints; pytest test confirms Cognee receives structured data.

2. **Add CLI Arguments for Metadata** (`extension/bridge/ingest.py`)
   - Add arguments: `--topic-id`, `--session-id`, `--plan-id`, `--status` (default `Final`).
   - Validate that `--topic-id` is required when `--summary` is true.
   - **Acceptance**: CLI arguments parsed correctly; validation enforces required fields.

3. **Update CogneeClient to Pass Metadata** (`extension/src/cogneeClient.ts`)
   - Extend `ingestSummary(summary: ConversationSummary)` to:
     - Generate `topic_id` by slugifying `summary.topic` (e.g., "Plan 014 Summary" → "plan-014-summary").
     - Generate `session_id` using current date (e.g., "2025-11-16-session-1").
     - Extract `plan_id` from `summary.references.plans` if present, else `null`.
     - Pass all metadata as CLI arguments to `ingest.py --summary --topic-id "..." --session-id "..." --plan-id "..."`.
   - **Acceptance**: `CogneeClient.ingestSummary` calls `ingest.py` with full metadata; DataPoints are stored in Cognee.

4. **Add Integration Test for DataPoint Ingestion** (`extension/bridge/test_ingest.py`)
   - Mock Cognee SDK and verify that `ingest.py --summary` creates `ConversationSummary` DataPoint with correct metadata.
   - Validate that `cognee.add` receives DataPoint (not plain string).
   - **Acceptance**: Pytest test passes; DataPoint ingestion validated.

**Owner**: Implementer
**Dependencies**: Milestone 1 (DataPoint models)
**Validation**: Pytest passes; manual test confirms DataPoints stored in `.cognee_data/`.

---

### Milestone 3: Implement Recency-Aware Ranking in Retrieval

**Objective**: Update `retrieve.py` to compute `final_score` by combining Cognee similarity with exponential timestamp decay.

**Tasks**:

1. **Add Recency Scoring Function** (`extension/bridge/retrieve.py`)
   - Implement `recency_score(created_at: datetime, half_life_days: float = 30.0) -> float`:
     - Compute days since `created_at`.
     - Return `0.5 ** (age_days / half_life_days)` (exponential decay).
   - Implement `combined_score(semantic_score: float, created_at: datetime, alpha: float = 0.8, half_life_days: float = 30.0) -> float`:
     - Return `alpha * semantic_score + (1 - alpha) * recency_score(created_at, half_life_days)`.
   - **Acceptance**: Scoring functions tested with sample timestamps; recency decay validated.

2. **Update Retrieval to Use Metadata-Rich Results** (`extension/bridge/retrieve.py`)
   - After calling `cognee.search`, iterate over results and:
     - Extract `created_at` from result metadata (assume Cognee returns DataPoint properties).
     - Extract `semantic_score` from Cognee's result (or default to 1.0 if not provided).
     - Compute `final_score = combined_score(semantic_score, created_at)`.
     - Sort results by `final_score` descending.
   - Remove regex-based timestamp parsing (obsolete now that timestamps are metadata).
   - **Acceptance**: Retrieval sorts by `final_score`; more recent summaries ranked higher when similarity is similar.

3. **Extend JSON Response to Include Metadata** (`extension/bridge/retrieve.py`)
   - For each result, return JSON structure:

     ```json
     {
       "text": "...",
       "topic_id": "...",
       "plan_id": "...",
       "status": "...",
       "created_at": "ISO8601",
       "semantic_score": 0.9,
       "recency_score": 0.7,
       "final_score": 0.85
     }
     ```

   - **Acceptance**: JSON response includes all metadata; TypeScript layer can consume it.

4. **Add Pytest Tests for Ranking** (`extension/bridge/test_retrieve.py`)
   - Mock Cognee search results with varying timestamps and semantic scores.
   - Verify that `final_score` is computed correctly and results are sorted.
   - **Acceptance**: Pytest test passes; ranking logic validated.

**Owner**: Implementer
**Dependencies**: Milestone 2 (metadata-rich DataPoints ingested)
**Validation**: Pytest passes; manual test confirms recency affects ranking (ingest two summaries with different dates, retrieve, confirm newer is ranked higher).

---

### Milestone 4: Implement Status-Aware Retrieval

**Objective**: Filter or downrank `Superseded` summaries and prefer `DecisionRecord` entries during retrieval.

**Tasks**:

1. **Add Status Filtering in Retrieval** (`extension/bridge/retrieve.py`)
   - After sorting by `final_score`, filter results:
     - If a `DecisionRecord` exists for a `topic_id`, exclude any `ConversationSummary` with matching `topic_id` and `status = "Superseded"`.
     - If user explicitly requests history (e.g., query contains "history" or "all summaries"), include superseded summaries but mark them clearly.
   - Add CLI argument `--include-superseded` (default false) to control this behavior.
   - **Acceptance**: Retrieval excludes superseded summaries by default; `--include-superseded` includes them.

2. **Update CogneeClient to Support History Queries** (`extension/src/cogneeClient.ts`)
   - Add optional parameter `includeSuperseded: boolean` to `retrieve()` method.
   - Pass `--include-superseded` to `retrieve.py` when true.
   - **Acceptance**: TypeScript layer can request history; retrieval behavior controlled by flag.

3. **Add Pytest Tests for Status Filtering** (`extension/bridge/test_retrieve.py`)
   - Mock search results with mix of `Final` and `Superseded` statuses.
   - Verify that superseded summaries are excluded by default.
   - Verify that `--include-superseded` includes them.
   - **Acceptance**: Pytest test passes; status filtering validated.

**Owner**: Implementer
**Dependencies**: Milestone 3 (ranking functional)
**Validation**: Pytest passes; manual test confirms superseded summaries are hidden unless requested.

---

### Milestone 5: Implement Compaction Backend Behavior

**Objective**: Create the `compact.py` script that implements the actual compaction logic called by Plan 014's manual compaction trigger.

**Tasks**:

1. **Create Compaction Script** (`extension/bridge/compact.py`)
   - Accept CLI arguments: `--workspace-path`, `--topic-id` (which topic to compact), `--preview` (optional; dry-run mode).
   - Query Cognee for all `ConversationSummary` DataPoints matching `topic_id` with `status != "Superseded"`.
   - Aggregate fields:
     - `consolidated_decisions` = union of all `decisions` lists.
     - `consolidated_rationale` = union of all `rationale` lists.
     - `key_open_questions` = union of all `open_questions` lists.
     - `key_references_*` = union of all references.
     - Detect conflicting decisions: if multiple summaries have contradictory decisions for the same aspect, include both with explicit markers (e.g., `"[Earlier] Decision A"`, `"[Later] Decision B supersedes A"`).
     - `summary_text` = LLM-generated narrative summarizing the combined history, including conflict notes if any.
   - If `--preview` is true:
     - Return JSON preview of what would be compacted (list of summaries, aggregated fields, conflict warnings) without modifying Cognee.
   - Otherwise:
     - Create `DecisionRecord` DataPoint with aggregated fields.
     - Ingest `DecisionRecord` via `cognee.add` + `cognee.cognify`.
     - Update all included `ConversationSummary` records to set `status = "Superseded"`.
   - Log compaction action: "Compacted {N} summaries for topic {topic_id} into DecisionRecord. Conflicts detected: {Y/N}."
   - **Acceptance**: `compact.py --topic-id "..."` creates DecisionRecord and marks summaries as superseded; `--preview` returns preview without changes.

2. **Update Plan 014's Compaction Command to Call Actual Logic** (`extension/src/commands.ts`)
   - Modify the placeholder `cognee.compactMemories` command from Plan 014 to:
     - Prompt user to enter or select a topic ID.
     - Call `compact.py --workspace-path "{workspace}" --topic-id "{topic_id}" --preview` to generate preview.
     - Display preview to user (number of summaries, any detected conflicts, sample aggregated decisions).
     - Prompt user: "Compact {N} summaries into DecisionRecord? This will mark them as superseded. [Confirm/Cancel]"
     - On confirmation, call `compact.py --workspace-path "{workspace}" --topic-id "{topic_id}"` (without `--preview`).
     - Show success notification with result: "Compacted {N} summaries for topic {topic_id}. {Conflict warnings if any}."
   - **Acceptance**: Existing command now triggers real compaction with preview/confirmation step; users can review before consolidating memories.

3. **Add Pytest Tests for Compaction** (`extension/bridge/test_compact.py`)
   - Mock Cognee SDK with sample `ConversationSummary` records.
   - Verify that `compact.py` creates `DecisionRecord` with correct aggregated fields.
   - Verify that original summaries are marked `Superseded`.
   - **Acceptance**: Pytest test passes; compaction logic validated.

**Owner**: Implementer
**Dependencies**: Milestones 1-4 (DataPoints, ingestion, retrieval all functional)
**Validation**: Pytest passes; manual test confirms compaction reduces summary count and retrieval prioritizes DecisionRecord.

---

### Milestone 6: Enhance TypeScript UI for Ranking Transparency

**Objective**: Display ranking metadata in chat participant and Output channel so users understand why certain summaries are surfaced.

**Tasks**:

1. **Update Chat Participant to Display Ranking Metadata** (`extension/src/chatParticipant.ts`)
   - When displaying retrieval results, show:
     - Summary topic and creation date.
     - Final score (if user enabled advanced logging).
     - Status (Final, Superseded) if not Final.
   - Format: "**Summary: {topic}** (created {date}, relevance score: {final_score})"
   - **Acceptance**: Chat participant shows metadata inline; users can see ranking rationale.

2. **Add Ranking Details to Output Channel** (`extension/src/cogneeClient.ts`)
   - Log retrieval results with full metadata:

     ```text
     [Retrieve] Query: "Plan 014 summary"
     [Retrieve] Result 1: topic_id=plan-014-summary, final_score=0.92, created_at=2025-11-15
     [Retrieve] Result 2: topic_id=plan-013-memory-truncation, final_score=0.78, created_at=2025-11-10
     ```

   - **Acceptance**: Output channel logs show ranking scores and timestamps for debugging.

3. **Add Configuration for Ranking Weights** (`package.json`)
   - Add settings:
     - `cogneeMemory.ranking.alpha` (default `0.8`, range `0.6` to `0.95`): weight for semantic similarity. Values closer to 1.0 prioritize relevance over recency.
     - `cogneeMemory.ranking.halfLifeDays` (default `30`, range `7` to `90`): recency decay half-life in days. Shorter values favor recent memories more aggressively.
   - Validate settings in TypeScript layer; if out of range, log warning and clamp to valid range.
   - Pass these settings as CLI arguments to `retrieve.py`.
   - **Acceptance**: Users can tune ranking behavior via settings; defaults are sensible and ranges prevent pathological behavior.

**Owner**: Implementer
**Dependencies**: Milestone 3 (ranking functional)
**Validation**: Manual test confirms metadata is visible in chat and logs; settings can be adjusted.

---

### Milestone 7: Documentation and Release Artifacts

**Objective**: Document metadata infrastructure, ranking, and compaction for users and maintainers.

**Tasks**:

1. **Update README** (`extension/README.md`)
   - Add section "Metadata and Ranking" explaining:
     - How summaries are tagged with topic/session/plan IDs (defined in Plan 014, migrated to DataPoints in Plan 015).
     - How recency-aware scoring works (exponential decay, configurable weights).
     - How compaction consolidates summaries into decision records.
   - Enhance the "Memory Compaction" section (from Plan 014) with:
     - Technical details: what happens during compaction (LLM aggregation, status transitions).
     - Advanced cadence guidance: consider compaction after N summaries or M days, depending on project velocity; optionally explore automated triggers in future.
   - **Acceptance**: README clearly documents metadata migration, ranking algorithms, and enhanced compaction guidance.

2. **Update Architecture Document** (`agent-output/architecture/system-architecture.md`)
   - Record Plan 015 in change log.
   - Update §4.4 to reflect DataPoint ingestion as "Implemented".
   - Add architectural note on compaction strategy and status semantics.
   - **Acceptance**: Architecture doc reflects Plan 015 changes.

3. **Create CHANGELOG Entry** (`extension/CHANGELOG.md`)
   - Document Plan 015 as new feature: "Metadata-driven ranking, compaction pipeline, and status-aware retrieval."
   - Note that ranking weights are configurable via settings.
   - **Acceptance**: CHANGELOG updated; release notes ready.

**Owner**: Implementer
**Dependencies**: Milestones 1-6 (all features implemented)
**Validation**: Documentation reviewed; release artifacts ready.

---

### Milestone 8: Update Version and Release Artifacts

**Objective**: Update extension version to v0.3.0 and document Plan 015 changes for roadmap alignment.

**Note**: This plan shares v0.3.0 with Plan 014. If Plan 014 has already updated the version to 0.3.0, this milestone adds to the existing v0.3.0 CHANGELOG section rather than incrementing the version.

**Steps**:

1. Check current version in `extension/package.json`:
   - If version is already 0.3.0 (from Plan 014), proceed to step 2 without updating version
   - If version is not 0.3.0, update `extension/package.json` to 0.3.0
2. Add/update CHANGELOG entry under v0.3.0 section:
   - "New: DataPoint-based ingestion with Pydantic models and structured metadata"
   - "New: Recency-aware ranking algorithm with exponential decay (configurable alpha and halfLifeDays)"
   - "New: Status-aware retrieval - filters Superseded summaries, prioritizes DecisionRecords"
   - "New: Compaction backend - consolidates summaries into DecisionRecords with LLM aggregation"
   - "New: Ranking transparency - display relevance scores, metadata, and ranking rationale in UI"
   - "New: Configurable ranking settings (cogneeMemory.ranking.alpha, cogneeMemory.ranking.halfLifeDays)"
   - "Improved: Memory compaction now includes preview/confirmation flow with conflict detection"
3. Update README with ranking and compaction sections (completed in Milestone 7)
4. Verify VSIX filename will be `cognee-chat-memory-0.3.0.vsix` during packaging
5. Commit version changes with message: "Release v0.3.0 - Plan 015: Metadata, Ranking, and Compaction" (or "Update v0.3.0 - Plan 015 additions" if version already set)

**Acceptance Criteria**:
- Version artifacts updated to 0.3.0 (or confirmed already at 0.3.0)
- CHANGELOG reflects Plan 015 deliverables under v0.3.0
- Version matches roadmap target (Epic 0.3.0.1)
- Extension manifest and package.json versions are consistent
- Documented coordination with Plan 014 version (both deliver v0.3.0)

---

## Testing Strategy

### Unit Tests

- `extension/bridge/datapoints.py`: Validate DataPoint models and `metadata.index_fields`.
- `extension/bridge/retrieve.py`: Validate `recency_score` and `combined_score` functions with sample timestamps (deterministic, no LLM calls).
- `extension/bridge/compact.py`: Validate aggregation logic and status updates with mocked LLM responses (focus on conflict detection, metadata aggregation, status transitions).

### Integration Tests

- `extension/bridge/test_ingest.py`: Validate DataPoint ingestion end-to-end with mocked Cognee SDK (fast, deterministic).
- `extension/bridge/test_retrieve.py`: Validate ranking with mixed semantic scores and timestamps; validate status filtering with mocked search results.
- `extension/bridge/test_compact.py`: Validate compaction creates DecisionRecord and marks summaries as superseded with mocked Cognee SDK and LLM (prioritize deterministic tests; reserve full LLM-based tests for manual QA).

**Testing Priority Guidance**:

- Prioritize deterministic unit tests for ranking functions, metadata aggregation, and status transitions.
- Use mocks for Cognee SDK and LLM in integration tests to keep CI fast and reliable.
- Reserve full end-to-end tests (real Cognee SDK, real LLM) for manual QA validation to avoid brittle/expensive CI tests.

### Manual Validation

- QA will:
  - Ingest multiple summaries for the same topic with different timestamps.
  - Retrieve summaries and confirm more recent ones rank higher.
  - Trigger compaction for a topic.
  - Confirm DecisionRecord is created and superseded summaries are no longer returned by default.
  - Adjust ranking settings and confirm behavior changes (e.g., increase `alpha` to prioritize semantic similarity).

### Coverage Expectations

- Unit test coverage ≥80% for new Python modules (`datapoints`, `retrieve` ranking functions, `compact`).
- Integration test coverage: at least one end-to-end test per milestone (DataPoint ingestion, ranking, status filtering, compaction).
- No regressions in existing pytest suite or Plan 014 functionality.

---

## Validation

### Definition of Done

- [ ] Ingestion uses Cognee DataPoints with structured metadata (topic_id, session_id, plan_id, status, timestamps).
- [ ] Retrieval ranks results by combining semantic similarity with recency decay (configurable weights).
- [ ] Retrieval excludes superseded summaries by default; includes them when user requests history.
- [ ] Compaction script merges summaries into DecisionRecord and marks old summaries as superseded.
- [ ] TypeScript UI displays ranking metadata in chat participant and Output channel.
- [ ] README and CHANGELOG document metadata, ranking, and compaction.
- [ ] All unit and integration tests pass.
- [ ] Manual QA validates end-to-end workflows (ingestion → ranking → compaction → retrieval).

### Rollback Plan

If DataPoint migration introduces breaking changes:

- Revert `ingest.py` to plain-text ingestion (disable DataPoint path).
- Disable compaction command and script.
- Ranking remains functional with legacy timestamps (if available).
- Plan 014 functionality preserved; rollback is non-destructive to existing summaries.

---

## Risks and Open Questions

### Risks

1. **Cognee DataPoint API Incompatibility**: Cognee SDK may not support DataPoints as assumed in analysis 014.
   - Mitigation: Verify DataPoint support in Cognee v0.4.0 before Milestone 1; if unsupported, defer to Cognee upgrade or use alternative metadata approach.

2. **Compaction Complexity**: Aggregating and summarizing multiple summaries via LLM may produce low-quality DecisionRecords.
   - Mitigation: Use structured prompts with clear instructions; allow manual review of DecisionRecords before final storage.

3. **Performance Degradation**: Recency scoring and status filtering add computational overhead to retrieval.
   - Mitigation: Profile `retrieve.py` performance; optimize sorting/filtering if latency exceeds 2s target.

4. **User Confusion**: Users may not understand why some summaries are hidden (superseded) or ranked lower.
   - Mitigation: Provide clear UI indicators (status badges, ranking scores) and "Show all history" option in chat participant.

### Open Questions

1. **RESOLVED**: Should compaction be automatic (e.g., triggered after N summaries for a topic), or remain manual?
   - **Decision**: Start with manual trigger with preview/confirmation step; add automatic scheduling in future work if users request it.

2. **RESOLVED**: How should DecisionRecord `summary_text` be generated? LLM-based or template-based?
   - **Decision**: LLM-based (send all summary texts to LLM with prompt: "Consolidate these summaries into a single narrative, noting any conflicting decisions").

3. **RESOLVED**: Should ranking weights (`alpha`, `half_life_days`) be workspace-specific or global settings?
   - **Decision**: Global settings initially (default `alpha=0.8`, `halfLifeDays=30`, with validated ranges); allow workspace-specific overrides in future work.

4. **RESOLVED**: How to handle conflicting decisions across summaries during compaction?
   - **Decision**: Include all decisions in `consolidated_decisions` list; mark conflicts explicitly (e.g., `"[Earlier] Decision A"`, `"[Later] Decision B supersedes A"`); detect conflicts during aggregation and include warnings in compaction preview and logs.

5. **RESOLVED**: How should mixed legacy/DataPoint retrieval results be ordered and labeled?
   - **Decision**: Prioritize DataPoint-backed summaries/DecisionRecords (full ranking treatment); append legacy raw-text memories sorted by Cognee's default similarity, labeled with `[Legacy]` tag in UI.

---

## Dependencies

- **Upstream**: Plan 014 (chat summary creation and retrieval must be functional).
- **Downstream**: Future work on automated summarization, cross-workspace context sharing.
- **Architectural**: Fully implements `system-architecture.md` §4.4 (Plan 014 Bridge Modernization) and Decision "Bridge Migration for Structured Summaries".

---

## Handoff Notes for Implementer

- **Start with Milestone 1**: DataPoint models are foundational; validate with Cognee SDK before proceeding.
- **Incremental Delivery**: Each milestone can be delivered and tested independently (DataPoints → ranking → status filtering → compaction).
- **Python Focus**: Most work is in Python (`datapoints.py`, `ingest.py`, `retrieve.py`, `compact.py`); TypeScript changes are UI-focused.
- **Testing Critical**: Each milestone must have passing pytest tests before moving to next milestone; integration tests prevent regressions.
- **Manual QA Essential**: Have QA validate each milestone in live VS Code environment with real Cognee SDK; ranking and compaction require end-to-end validation.
- **Plan 014 Dependency**: Treat `analysis/014-chat-conversation-summaries-and-agent-instructions-analysis.md` and `analysis/014-bridge-focused-addendum-analysis.md` as the single source of truth for metadata shapes and CLI contracts. If Plan 014 implementation deviates from assumed metadata structure (e.g., different field names, missing fields), document deviations in implementation notes and adjust this plan's DataPoint models accordingly before proceeding to Milestone 2.

---

## Success Criteria

**Plan 015 is successful when**:

- Summaries are stored as Cognee DataPoints with full metadata (topic, session, plan, status, timestamps).
- Retrieval ranks results transparently using recency-aware scoring; users can tune weights via settings.
- Compaction consolidates redundant summaries into DecisionRecords; retrieval prioritizes DecisionRecords over superseded summaries.
- TypeScript UI displays ranking metadata so users understand why certain summaries are surfaced.
- Documentation clearly explains metadata, ranking, and compaction workflows.
- All tests pass and QA validates the end-to-end experience.

**Alignment with Master Product Objective**:

- **Natural Language Retrieval**: Metadata-driven ranking improves retrieval relevance; users find the right context faster.
- **Zero Cognitive Overhead**: Compaction prevents memory graph bloat; users never sift through redundant summaries.
- **Automatic Context Capture**: Status-aware retrieval ensures only fresh, actionable decisions are surfaced; stale context fades gracefully.
