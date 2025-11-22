# Plan 018: Metadata Infrastructure and Ranking

**Plan ID**: 018
**Target Release**: v0.3.5
**Created**: 2025-11-18
**Updated**: 2025-11-21 (Revised per Architecture Findings: Maintenance Mode, Truthful Timestamps, Unified Config)
**Status**: Draft (Pending Critic Review)
**Epic Alignment**: Epic 0.3.0.1 - Context Ranking and Relevance (Partial - Metadata + Ranking only)
**Related Analysis**: `analysis/018-metadata-ranking-analysis.md` (TBD)
**Related Architecture**: `architecture/system-architecture.md` §4.4, §9, §10.3; `architecture/018-metadata-ranking-architecture-findings.md`
**Dependency Note**: Compaction work split out to Plan 019; Plan 018 delivers metadata infrastructure and ranking algorithms only

---

## Changelog

**2025-11-21 - Architectural Revision**
- **Handed off from**: Architect Agent
- **What was requested**: Update plan to align with async ingestion and transparency architecture.
- **Changes**:
  - **Milestone 1**: Converted migration to "Maintenance Mode" (pauses background queue, synchronous execution, separate log) to avoid polluting async ledger.
  - **Milestone 1**: Added `source_created_at` field to preserve truthful recency from legacy artifacts.
  - **Milestone 2**: Unified ranking configuration to single `halfLifeDays` setting (bridge derives alpha) to prevent configuration conflicts.

**2025-11-21 - Initial Creation**
- **Handed off from**: User request to separate compaction from Plan 018

As a developer retrieving context from Cognee Chat Memory,
I want the most relevant and up-to-date information surfaced first with transparent metadata,
So that I can quickly assess context relevance and freshness without sifting through tangential or outdated results.

**Success Criteria**:

- Retrieval results ranked by recency-aware scoring (semantic similarity + exponential time decay).
- Status-aware filtering prioritizes `DecisionRecord` entries and excludes `Superseded` summaries by default.
- Users see relevance scores and metadata (topic_id, plan_id, status, timestamps) transparently in retrieval results.
- Retrieval latency remains <2s even after metadata infrastructure is operational.
- Metadata infrastructure supports future compaction features (Plan 019).

---

## Objective

Implement **metadata infrastructure and ranking algorithms** to improve retrieval relevance and prepare for future compaction features:

1. **Metadata Infrastructure**: Extend Plan 014 structured summaries with indexed metadata fields (`topic_id`, `session_id`, `plan_id`, `status`, `created_at`, `updated_at`, `relevance_score`) persisted via Cognee DataPoints or enriched-text fallback.
2. **Recency-Aware Ranking**: Compute `final_score = semantic_similarity * exp(-decay_alpha * days_since_creation)` to balance relevance and freshness; expose configurable decay parameter (`halfLifeDays`) while deriving `decay_alpha` internally.
3. **Status-Aware Retrieval**: Filter results by status (`Active`, `Superseded`, `DecisionRecord`); prioritize `DecisionRecord`, exclude `Superseded` by default (user can opt-in to include all statuses).
4. **Language Model Tools Update**: Revise `cognee_storeMemory` and `cognee_retrieveMemory` tool descriptions to guide agents toward proactive memory usage and communicate workspace-local privacy (per Analysis 016).
5. **Transparency UX**: Display relevance scores, status, and metadata in @cognee-memory participant and agent API responses.
6. **Extension Identity**: Add custom icon assets for extension and @cognee-memory participant.

**Dependencies**:

- **REQUIRED**: Plan 014 bridge migration (structured summaries with enriched-text metadata) must be complete. Without this, there is no metadata to rank or compact.
- **RECOMMENDED**: Plans 015/016 (agent ingestion/retrieval commands) should be delivered before or in parallel, as ranking primarily benefits agent-initiated workflows.

**Out of Scope**:

- **Compaction pipeline** (deferred to Plan 019): Background task that merges related summaries into consolidated `DecisionRecord` entries with conflict detection.
- Cross-workspace ranking (deferred to Epic 0.4.0).
- LLM-based semantic similarity (rely on Cognee's existing hybrid search).
- User feedback loop (thumbs up/down) - deferred to future enhancement.

---

## Assumptions

1. **Plan 014 Bridge Complete**: `ingest.py` accepts structured summaries with metadata; `retrieve.py` returns metadata fields (`topic_id`, `status`, `created_at`, `score`).
2. **Enriched-Text Fallback Active**: Metadata persisted via embedded markdown blocks until Cognee exposes DataPoint APIs (per §4.4.1 of architecture).
3. **Recency Decay Formula**: Exponential decay `exp(-alpha * days)` is sufficient; more complex models (linear, logarithmic) deferred to future research.
4. **Status Enum Stability**: Status values (`Active`, `Superseded`, `DecisionRecord`) are fixed for this release; additional statuses (e.g., `Draft`, `Archived`) deferred.
5. **Manual Status Management**: Users can manually mark summaries with different statuses via ingestion flags; automated status transitions (e.g., compaction creating `DecisionRecord` entries) deferred to Plan 019.

---

## Plan

### Milestone 0: Metadata Schema and Bridge Contract Extension

**Objective**: Extend Plan 014 bridge contract to include metadata fields required for ranking and compaction, including truthful timestamp preservation.

**Tasks**:

1. **Define Extended Metadata Schema** (`extension/bridge/DATAPOINT_SCHEMA.md`)
   - Add fields to Plan 014 schema:
     - `topic_id`: string (UUID or hash of topic name; links related summaries).
     - `session_id`: string (UUID; tracks conversation sessions).
     - `plan_id`: string (optional; links summary to specific plan/epic).
     - `status`: enum (`Active`, `Superseded`, `DecisionRecord`).
     - `created_at`: ISO 8601 timestamp (system ingestion time).
     - `source_created_at`: ISO 8601 timestamp (original creation time of the content; used for ranking).
     - `updated_at`: ISO 8601 timestamp (when summary was last modified).
     - `relevance_score`: float (computed during retrieval; not persisted).
   - Document enriched-text format for metadata embedding (fallback until DataPoints available).
   - **Acceptance**: Schema documented; `source_created_at` included for truthful ranking; versioned for tracking template changes.

2. **Update `ingest.py` to Persist Metadata**
   - Accept metadata fields in JSON payload (extend Plan 014 `--summary-json` format).
   - Render enriched-text markdown with metadata block:
     ```markdown
     **Metadata:**
     - topic_id: <uuid>
     - session_id: <uuid>
     - plan_id: <id>
     - status: Active
     - created_at: <ISO 8601>
     - source_created_at: <ISO 8601>
     - updated_at: <ISO 8601>
     ```
   - Call `cognee.add` with enriched text; persist to workspace dataset.
   - **Acceptance**: `ingest.py` accepts extended metadata including `source_created_at`; enriched-text rendering includes all fields; integration tests verify persistence.

3. **Update `retrieve.py` to Parse and Return Metadata**
   - Parse enriched-text metadata blocks via regex (deterministic pattern matching).
   - Compute `relevance_score` using recency-aware formula (operating on `source_created_at` if present, else `created_at`).
   - Return structured JSON with metadata fields:
     ```json
     {
       "entries": [
         {
           "summaryText": "...",
           "decisions": [...],
           "topicId": "<uuid>",
           "planId": "<id>",
           "status": "Active",
           "createdAt": "<ISO 8601>",
           "sourceCreatedAt": "<ISO 8601>",
           "updatedAt": "<ISO 8601>",
           "score": 0.87
         }
       ]
     }
     ```
   - Handle missing metadata gracefully (legacy summaries return `null` for metadata fields).
   - **Acceptance**: `retrieve.py` returns structured metadata; mixed-mode (enriched + legacy) supported; tests verify parsing accuracy.

4. **Update Bridge Contract Documentation**
   - Extend `RETRIEVE_CONTRACT.md` with metadata field descriptions.
   - Document fallback behavior (legacy summaries without metadata).
   - Add example response payloads showing enriched summaries vs legacy summaries.
   - **Acceptance**: Contract documented; serves as reference for TypeScript consumers and QA.

**Owner**: Implementer
**Dependencies**: Plan 014 bridge migration
**Validation**: Bridge contract tests pass; metadata persists and retrieves correctly; mixed-mode supported.

---

### Milestone 1: Migrate Existing Summaries (Maintenance Mode)

**Objective**: One-time migration of Plan 014 summaries to include metadata fields, executed in a safe maintenance mode that bypasses the async ingestion queue.

**Tasks**:

1. **Create Maintenance Migration Script** (`extension/bridge/migrate_summaries.py`)
   - **Maintenance Mode Logic**:
     - Acquire exclusive lock (e.g., `.cognee/maintenance.lock`) to pause `BackgroundOperationManager` (TS side must respect this or script must fail if queue active).
     - Log start of migration to `.cognee/maintenance/migration.log`.
   - **Migration Logic**:
     - Query Cognee for all summaries created by Plan 014.
     - For each summary:
       - Generate `topic_id` from topic name.
       - Generate `session_id` (placeholder).
       - Set `status = 'Active'`.
       - Derive `source_created_at`:
         - Attempt to parse date from summary text (if available).
         - Fallback: Use filesystem creation time of the artifact in `.cognee_data` (if accessible).
         - Fallback: Use current time (last resort).
       - Set `created_at` = current time (migration time).
       - Set `updated_at` = current time.
     - **Synchronous Ingestion**:
       - Call `cognee.add()` followed immediately by `cognee.cognify()` (bypass async queue).
       - Do NOT emit staged notifications or write to `.cognee/background_ops.json`.
   - **Cleanup**:
     - Release exclusive lock.
     - Log completion stats to migration log.
   - **Acceptance**: Script runs in maintenance mode; no background ops created; `source_created_at` preserved where possible.

2. **Validation and Rollback**
   - Verify migrated summaries retrievable via `retrieve.py` with metadata.
   - Verify `source_created_at` is distinct from `created_at` (migration time).
   - Compare migrated count to expected count.
   - **Acceptance**: Migration validated; timestamps truthful.

3. **User Communication**
   - Update CHANGELOG to note migration.
   - Provide configuration option to skip migration.
   - **Acceptance**: Migration communicated clearly.

**Owner**: Implementer + QA
**Dependencies**: Milestone 0 (metadata schema and bridge extension)
**Validation**: Migration script runs successfully in maintenance mode; summaries retrievable with metadata; no data loss.

---

### Milestone 2: Recency-Aware Ranking Algorithm

**Objective**: Implement ranking algorithm that balances semantic similarity and temporal relevance using a unified configuration.

**Tasks**:

1. **Define Ranking Formula**
   - Formula: `final_score = semantic_similarity * exp(-decay_alpha * days_since_creation)`
   - Parameters:
     - `semantic_similarity`: from Cognee's hybrid search (vector + graph).
     - `days_since_creation`: `(current_time - source_created_at) / 86400`. (Use `created_at` if `source_created_at` missing).
     - `decay_alpha`: Derived internally from `halfLifeDays`.
   - **Derivation**: `decay_alpha = ln(2) / halfLifeDays`.
   - Document formula in `extension/bridge/RANKING_ALGORITHM.md`.
   - **Acceptance**: Formula documented; `source_created_at` priority established.

2. **Implement Ranking in `retrieve.py`**
   - Accept `halfLifeDays` from query payload (or default to 7).
   - Compute `decay_alpha = ln(2) / halfLifeDays`.
   - Compute `final_score` for each entry.
   - Sort results by `final_score` descending.
   - **Acceptance**: Ranking implemented; results sorted by `final_score`; tests verify sorting accuracy.

3. **Add Configuration Settings** (`extension/package.json`)
   ```json
   "cogneeMemory.ranking.halfLifeDays": {
     "type": "number",
     "default": 7,
     "description": "Half-life in days for recency scoring. Memories older than this will have their relevance score halved."
   }
   ```
   - **Note**: Do NOT expose `decayAlpha` to users to avoid conflicting settings.
   - **Acceptance**: Single setting visible in VS Code; configurable by user.

4. **Validate Ranking Behavior**
   - Integration tests:
     - Two summaries with same semantic similarity; older `source_created_at` ranked lower.
     - Verify `halfLifeDays` parameter correctly influences decay rate.
     - Legacy summaries without `source_created_at`: treated as current date (no decay penalty) or use `created_at` if available.
   - **Acceptance**: Ranking tests pass; recency decay validated with unified config.

**Owner**: Implementer
**Dependencies**: Milestone 0 (metadata schema); Milestone 1 (migration)
**Validation**: Ranking algorithm implemented; tests verify recency decay; single parameter config works.

---

### Milestone 3: Status-Aware Retrieval and Filtering

**Objective**: Filter retrieval results by status; prioritize `DecisionRecord`, exclude `Superseded` by default.

**Tasks**:

1. **Implement Status Filtering in `retrieve.py`**
   - Accept `includeSuperseded` flag in query payload (default: `false`).
   - Filter results:
     - If `includeSuperseded = false`: exclude entries with `status = 'Superseded'`.
     - If `includeSuperseded = true`: include all statuses.
   - Prioritize `DecisionRecord` entries:
     - Within same `final_score` range, rank `DecisionRecord` > `Active` > `Superseded`.
   - **Acceptance**: Status filtering implemented; tests verify exclusion behavior and prioritization.

2. **Update Bridge Contract** (`RETRIEVE_CONTRACT.md`)
   - Document `includeSuperseded` query parameter.
   - Describe status prioritization logic.
   - Example query payload:
     ```json
     {
       "query": "decisions about Plan 014",
       "maxResults": 5,
       "includeSuperseded": false
     }
     ```
   - **Acceptance**: Contract updated; query parameter documented.

3. **Expose Status Filtering in TypeScript**
   - Update `CogneeContextRequest` interface (from Plan 016):
     ```ts
     {
       query: string;
       maxResults?: number;
       maxTokens?: number;
       contextHints?: string[];
       includeSuperseded?: boolean; // NEW
     }
     ```
   - Update `CogneeContextProvider` to pass `includeSuperseded` to bridge.
   - **Acceptance**: TypeScript interface updated; parameter propagated to bridge.

4. **Update Context Provider Contracts and Telemetry**
   - Extend `CogneeContextResult` interface to include `sourceCreatedAt`, `finalScore`, and `status`.
   - Ensure these fields are logged in shared telemetry/audit logs per architecture §4.5.
   - **Acceptance**: Agent tools and participant share consistent metadata view; logs capture ranking details.

5. **UI Transparency for Status**
   - @cognee-memory participant displays status badges:
     - `[Decision]` for `DecisionRecord`.
     - `[Active]` for `Active`.
     - `[Superseded]` (only if `includeSuperseded = true`).
   - Agent API responses include `status` field in JSON.
   - **Acceptance**: Status visible in UI and API responses; users understand filtering behavior.

**Owner**: Implementer
**Dependencies**: Milestone 0 (status field in metadata)
**Validation**: Status filtering tests pass; UI displays status badges; API includes status field.

---

### Milestone 4: Update Language Model Tools Metadata for Agent Guidance

**Objective**: Revise `cognee_storeMemory` and `cognee_retrieveMemory` tool descriptions in `package.json` to encourage proactive agent usage and communicate workspace-local privacy.

**Rationale**: Analysis 016 (language-model-tools-definition-update-analysis.md) identified that current tool descriptions are too brief, leading to inconsistent agent behavior (shallow summaries, infrequent retrieval). Updated descriptions should guide agents toward storing meaningful 300–1500 character summaries after completing work, and retrieving context at the start of turns. Architecture §4.5 requires tool metadata to state "data stays in this workspace" since Configure Tools is the sole opt-in surface.

**Tasks**:

1. **Update `cognee_storeMemory` Tool Definition in `package.json`**
   - Replace existing `languageModelTools` entry with the following JSON (PRESCRIPTIVE CODE EXCEPTION GRANTED - deep analysis completed in Analysis 016):
   
   ```json
   {
     "name": "cognee_storeMemory",
     "displayName": "Store Memory in Cognee",
     "toolReferenceName": "cogneeStoreSummary",
     "canBeReferencedInPrompt": true,
     "icon": "$(database)",
     "modelDescription": "Primary tool for writing episodic long-term memory into Cognee's knowledge graph. Agents should call this after meaningful progress, at the end of multi-step reasoning, or when concluding a task, to persist a rich summary of what was done and why. Use this tool proactively as a state checkpoint; do not wait for the user to explicitly ask to save memory. Summaries should be 300–1500 characters and describe goals, actions, important files, decisions, and rationale. Use it to record durable decisions, plans, and implementation notes that will be useful in future turns in this workspace. Do not use this for trivial or ephemeral chit-chat.\n\nExample usage (conceptual): after completing a refactor or design decision, call this tool with topic=\"Auth refactor step 1\" and context summarizing the work, and include any key decisions and rationale. Data stays in this workspace.",
     "userDescription": "Store a structured conversation or work summary into Cognee's knowledge graph for future retrieval. Data stays in this workspace.",
     "inputSchema": {
       "type": "object",
       "properties": {
         "topic": {
           "type": "string",
           "description": "Short 3–7 word title for this memory that clearly identifies the work or decision (e.g., \"Redis caching implementation plan\"). Do not put the full summary here."
         },
         "context": {
           "type": "string",
           "description": "A rich 300–1500 character summary describing the goal, what was done, key files or components, important details, and the reasoning behind the work. This acts as long-term memory and should be understandable if read weeks later."
         },
         "decisions": {
           "type": "array",
           "items": { "type": "string" },
           "description": "Optional list (0–5 items) of durable decisions made in this session (e.g., \"Keep legacy hashing for backward compatibility\"). Only include decisions that will matter for future work."
         },
         "rationale": {
           "type": "array",
           "items": { "type": "string" },
           "description": "Optional list (0–5 items) explaining why the decisions were made (e.g., trade-offs, constraints, or risk considerations)."
         },
         "metadata": {
           "type": "object",
           "properties": {
             "plan_id": {
               "type": "string",
               "description": "Optional identifier used to group related summaries or steps in a plan (e.g., \"memory-2025-01-15-auth-refactor\")."
             },
             "status": {
               "type": "string",
               "enum": ["Active", "Superseded", "DecisionRecord"],
               "description": "Optional status describing whether this memory is the current approach (Active), has been replaced (Superseded), or is a stable decision record (DecisionRecord)."
             }
           },
           "description": "Optional metadata about this memory entry. If omitted, the system may auto-generate values. Use this to track plan IDs and status of decisions."
         }
       },
       "required": ["topic", "context"]
     },
     "tags": ["memory", "knowledge-graph", "persistence", "cognee", "long-term-memory", "state-checkpoint"]
   }
   ```
   
   - **Note to Critic/Architect**: Prescriptive code exception granted due to deep analysis in Analysis 016 (language-model-tools-definition-update-analysis.md). This JSON must be used verbatim to preserve schema compatibility and behavioral guidance research.
   - **Acceptance**: Tool metadata updated in `package.json`; privacy clause ("Data stays in this workspace") present in both `modelDescription` and `userDescription`.

2. **Update `cognee_retrieveMemory` Tool Definition in `package.json`**
   - Replace existing `languageModelTools` entry with the following JSON (PRESCRIPTIVE CODE EXCEPTION GRANTED):
   
   ```json
   {
     "name": "cognee_retrieveMemory",
     "displayName": "Retrieve Cognee Memory",
     "toolReferenceName": "cogneeRetrieveMemory",
     "canBeReferencedInPrompt": true,
     "icon": "$(search)",
     "modelDescription": "Primary mechanism for retrieving past context, decisions, and implementation details from Cognee's knowledge graph. Agents should call this at the start of a turn, or before planning an answer, whenever the user request might relate to prior work, previous discussions, or existing decisions in this workspace. Use a natural-language query that describes the user goal or task (not just keywords), and retrieve a small number of highly relevant memories to ground reasoning. The tool returns human-readable markdown plus structured JSON with topic, context, decisions, rationale, and metadata, which should be used to guide current planning and responses. If no results are relevant, the agent should proceed but note that no prior memory was found.\n\nExample usage (conceptual): when asked \"How did we implement caching?\" call this tool with query=\"Previous decisions and implementation details for redis caching\" and review the returned summaries before answering. Data stays in this workspace.",
     "userDescription": "Search Cognee knowledge graph for relevant stored summaries, decisions, and context from past work. Data stays in this workspace.",
     "inputSchema": {
       "type": "object",
       "properties": {
         "query": {
           "type": "string",
           "description": "Natural-language description of what you want to recall, including the goal or task (e.g., \"Previous decisions about authentication strategy\", \"How we implemented Redis caching in this project\"). Avoid short keyword-only queries; instead, describe the intent and context."
         },
         "maxResults": {
           "type": "number",
           "description": "Maximum number of results to return. Use small numbers (1–5) to keep context focused. Default: 3, max: 10.",
           "default": 3,
           "minimum": 1,
           "maximum": 10
         }
       },
       "required": ["query"]
     },
     "tags": ["memory", "knowledge-graph", "search", "retrieval", "cognee", "context", "long-term-memory"]
   }
   ```
   
   - **Note to Critic/Architect**: Prescriptive code exception granted due to deep analysis in Analysis 016.
   - **Acceptance**: Tool metadata updated in `package.json`; privacy clause present; behavioral guidance encourages proactive retrieval.

3. **Verify Schema Compatibility**
   - Confirm existing TypeScript interfaces (`StoreMemoryToolInput`, `RetrieveMemoryToolInput`) remain compatible with updated `inputSchema` definitions.
   - Run existing unit tests (`extension/src/test/storeMemoryTool.test.ts`) to verify no regressions.
   - **Acceptance**: Tests pass; no type errors; schema alignment maintained.

4. **Update `AGENT_INTEGRATION.md` Documentation**
   - Add section explaining expected invocation cadence: agents should store after completing work; retrieve at start of turns when context may exist.
   - Document rate-limit behavior: 2 concurrent requests, 10/min default (clamped to 5 concurrent max, 30/min max per Plan 016).
   - Explain how to handle `429_AGENT_THROTTLED` errors (retry with exponential backoff).
   - Clarify that length/count guidance ("300–1500 chars", "0–5 decisions") is advisory; extension does not enforce limits.
   - **Acceptance**: Documentation updated; partners understand behavioral expectations and error handling.

**Owner**: Implementer
**Dependencies**: None (metadata changes only; no runtime logic affected)
**Validation**: Tool metadata updated per Analysis 016; tests pass; privacy clause present; documentation complete.

---

### Milestone 6: Icon Assets and Extension Identity

**Objective**: Add custom icon assets for extension and @cognee-memory participant to improve brand recognition and discoverability.

**Tasks**:

1. **Design Extension Icon**
   - Create 128x128 PNG icon for extension marketplace listing and VS Code UI.
   - Ensure icon is distinctive, professional, and represents memory/context concept.
   - **Acceptance**: Icon file created at `extension/media/icon.png`.

2. **Design Participant Icon**
   - Create participant icon for @cognee-memory chat participant (appears in chat UI).
   - Follow VS Code design guidelines for participant icons (size, style).
   - **Acceptance**: Participant icon created and referenced in `package.json` contribution.

3. **Update Extension Manifest**
   - Add `icon` field to `package.json` pointing to `media/icon.png`.
   - Verify icon displays correctly in Extensions view and marketplace.
   - **Acceptance**: Extension icon visible in VS Code UI.

4. **Testing and Validation**
   - Test icon rendering across different VS Code themes (light, dark, high contrast).
   - Verify icon meets marketplace display requirements.
   - **Acceptance**: Icons render correctly; no visual regressions.

**Owner**: Implementer
**Dependencies**: None (independent visual assets)
**Validation**: Extension icon visible in Extensions view; participant icon displays in chat UI.

---

### Milestone 7: Testing and QA

**Objective**: Validate metadata ranking and status filtering across scenarios; ensure performance and correctness.

**Tasks**:

1. **Unit Tests for Ranking Algorithm**
   - Test recency decay formula:
     - Same semantic similarity, different `created_at` → older ranked lower.
     - Verify exponential decay with configurable `alpha`.
     - Verify `halfLifeDays` parameter conversion to `alpha`.
   - Test status prioritization:
     - Within same score range, `DecisionRecord` > `Active` > `Superseded`.
   - **Acceptance**: Ranking unit tests pass; formula verified.

2. **Integration Tests for Status Filtering**
   - Ingest summaries with different statuses (`Active`, `Superseded`, `DecisionRecord`).
   - Query with `includeSuperseded = false` → verify `Superseded` excluded.
   - Query with `includeSuperseded = true` → verify all statuses returned.
   - **Acceptance**: Status filtering tests pass; exclusion behavior validated.

3. **Metadata Persistence and Retrieval Tests**
   - Ingest summaries with full metadata (topic_id, session_id, plan_id, status, timestamps).
   - Verify enriched-text rendering includes all metadata fields.
   - Retrieve summaries and verify metadata parsing accuracy.
   - Test mixed-mode retrieval (enriched summaries + legacy raw-text).
   - **Acceptance**: Metadata round-trip validated; mixed-mode supported.

4. **Performance Tests**
   - Ingest 100 summaries with metadata; measure retrieval latency.
   - Target: <2s retrieval with ranking and status filtering.
   - Profile ranking computation; optimize if necessary.
   - **Acceptance**: Retrieval latency meets <2s target; performance validated.

5. **End-to-End Scenario Tests**
   - Scenario: User ingests summaries with metadata → retrieves with ranking → verifies older results ranked lower.
   - Scenario: Agent retrieves context → receives ranked results with metadata → verifies status badges in UI.
   - Scenario: User configures decay parameters → verifies ranking behavior changes accordingly.
   - **Acceptance**: E2E tests cover happy path and key workflows.

6. **Language Model Tools Metadata Tests**
   - Run existing unit tests (`extension/src/test/storeMemoryTool.test.ts`) to verify updated `inputSchema` definitions remain compatible with TypeScript interfaces.
   - Manually verify tool descriptions appear correctly in VS Code Configure Tools dialog.
   - Confirm privacy clause ("Data stays in this workspace") is present in both `modelDescription` and `userDescription` for both tools.
   - **Acceptance**: Tests pass; no schema regressions; privacy statements visible in Configure Tools UI.

7. **Icon Asset Validation**
   - Verify extension icon displays in Extensions view (light, dark, high contrast themes).
   - Verify participant icon displays in chat UI.
   - Test icon rendering on different platforms (Windows, macOS, Linux).
   - **Acceptance**: Icons render correctly; no visual regressions.

8. **QA Validation**
   - QA verifies ranking behavior (recency decay observable).
   - QA confirms status filtering works in participant and agent API.
   - QA validates metadata transparency (scores, timestamps visible in UI).
   - Documents any issues in `qa/018-metadata-ranking-qa.md`.
   - **Acceptance**: QA sign-off; no P0/P1 issues remain.

**Owner**: QA + Implementer
**Dependencies**: All previous milestones
**Validation**: All tests pass; performance target met; QA approves.

---

### Milestone 8: Update Version and Release Artifacts

**Objective**: Update project version to v0.3.5 and document changes for roadmap alignment.

**Tasks**:

1. **Update Version in `extension/package.json`**
   - Increment version to `0.3.5` (3-part semantic versioning required by VS Code Marketplace).
   - **Acceptance**: `package.json` version updated.

2. **Add CHANGELOG Entry**
   - Document Plan 018 deliverables under v0.3.5 section:
     - Metadata infrastructure (topic_id, session_id, plan_id, status, timestamps including `source_created_at`).
     - Recency-aware ranking algorithm with configurable `halfLifeDays`.
     - Status-aware retrieval filtering (prioritize `DecisionRecord`, exclude `Superseded` by default).
     - Updated language model tools metadata to guide agent behavior and communicate workspace privacy.
     - Extension and participant icon assets for improved brand identity.
     - Maintenance-mode migration script for existing Plan 014 summaries.
   - **Acceptance**: CHANGELOG reflects Plan 018 scope.

3. **Update README**
   - Add "Intelligent Context Ranking" section explaining recency decay and status filtering.
   - Add "Metadata Transparency" section explaining how relevance scores and status are surfaced.
   - Update screenshots to show new extension icon.
   - **Acceptance**: README markets ranking features and displays new branding.

4. **Commit Version Changes**
   - Commit with message: `"Release v0.3.5 - Plan 018: Metadata Infrastructure and Ranking"`
   - Tag release: `git tag v0.3.5`
   - **Acceptance**: Version artifacts committed and tagged.

**Owner**: Implementer
**Dependencies**: All implementation milestones complete
**Validation**: Version artifacts updated; release ready for packaging.

---

## Testing Strategy

- **Unit Tests**: Ranking algorithm (recency decay, status prioritization), status filtering logic, metadata parsing and rendering.
- **Integration Tests**: Bridge contract validation (metadata persistence, retrieval with ranking), mixed-mode handling (enriched + legacy summaries).
- **Performance Tests**: Retrieval latency with 100+ summaries; ranking computation overhead.
- **End-to-End Tests**: Full workflow (ingest with metadata → retrieve ranked results → verify status badges and scores).
- **Visual Tests**: Icon rendering across themes (light, dark, high contrast) and platforms.
- **QA Scenarios**: Configuration changes (decay alpha, halfLifeDays), participant and agent API behavior, metadata transparency.

**Coverage Expectations**:

- Unit: 90%+ for ranking, filtering, and metadata handling logic.
- Integration: All metadata persistence and retrieval paths covered; mixed-mode validated.
- Performance: <2s retrieval latency validated with realistic datasets.
- E2E: Happy path + key workflows (ranking, status filtering, metadata display).
- Visual: Icons validated across all supported themes and platforms.

**Critical Validation Scenarios**:

1. Summaries with same semantic similarity but different `created_at` → older ranked lower (recency decay verified).
2. Query with `includeSuperseded = false` → `Superseded` summaries excluded.
3. Retrieval prioritizes `DecisionRecord` over `Active` summaries (status-aware ranking).
4. Metadata round-trip: Ingest with metadata → retrieve → verify all fields present and accurate.
5. Mixed-mode retrieval: Legacy summaries without metadata coexist with enriched summaries.
6. Performance: Retrieve from 100+ summaries with ranking in <2s.
7. Icon visibility: Extension icon displays in Extensions view; participant icon in chat UI.

---

## Validation

**Acceptance Criteria**:

- ✅ Metadata schema extended with `topic_id`, `status`, `created_at`, `updated_at`, `relevance_score`.
- ✅ Existing Plan 014 summaries migrated to include metadata (one-time script).
- ✅ Recency-aware ranking algorithm implemented with configurable decay parameters.
- ✅ Status-aware retrieval filtering prioritizes `DecisionRecord`, excludes `Superseded` by default.
- ✅ Language model tools (`cognee_storeMemory`, `cognee_retrieveMemory`) updated with richer behavioral guidance and workspace-local privacy statements per Analysis 016.
- ✅ Extension icon and participant icon assets created and integrated.
- ✅ Ranking and status metadata visible in @cognee-memory participant and agent API responses.
- ✅ All tests pass (unit, integration, performance, E2E, visual); QA validation complete; no P0/P1 blockers.
- ✅ Version artifacts updated; CHANGELOG documents Plan 018.

**Sign-off**: QA + Architect review; Critic approval before implementation begins.

---

## Risks

1. **Recency Decay Complexity**
   - Risk: Exponential decay may be too aggressive or too lenient; tuning required.
   - Mitigation: Configurable `halfLifeDays` parameter (deriving alpha); document tuning guidance in README.

2. **Migration Timestamp Accuracy**
   - Risk: One-time migration cannot reconstruct original `source_created_at` timestamps perfectly; approximates with file creation time or migration timestamp.
   - Mitigation: Document limitation in CHANGELOG; explain that ranking for migrated summaries uses approximate timestamps.

3. **Performance Degradation**
   - Risk: Ranking computation may slow retrieval beyond <2s target with large datasets.
   - Mitigation: Profile ranking overhead; optimize formula or cache scores if needed; consider moving ranking to Cognee layer.

4. **Metadata Parsing Brittleness**
   - Risk: Regex-based metadata parsing from enriched-text may break if format changes.
   - Mitigation: Version metadata templates; validate parsing in integration tests; plan migration to DataPoints once available.

5. **Icon Compatibility**
   - Risk: Custom icons may not render correctly across all VS Code themes or platforms.
   - Mitigation: Test icons across light, dark, and high contrast themes; follow VS Code design guidelines; use SVG or high-DPI PNG.

---

## Open Questions

1. **Decay Parameter Defaults**: Are `alpha = 0.1` and `halfLifeDays = 7` reasonable defaults? → **Resolution pending user research/feedback**.
2. **Status Enum Extension**: Should additional statuses (e.g., `Draft`, `Archived`) be supported? → **Resolution: Defer to future enhancement; stick to 3 statuses for MVP**.
3. **Icon Design Direction**: Should icons emphasize "memory" metaphor (brain, storage) or "context" metaphor (connections, graph)? → **Resolution pending design review**.
4. **DataPoint Migration Timeline**: When will Cognee expose DataPoint APIs to replace enriched-text fallback? → **Resolution: Monitor Cognee roadmap; plan migration in future release**.

---

## References

- `agent-output/analysis/018-metadata-ranking-analysis.md` (TBD)
- `agent-output/architecture/system-architecture.md` (§4.4, §9, §10.3)
- `agent-output/roadmap/product-roadmap.md` (Epic 0.3.0.1)
- `agent-output/planning/014-chat-summary-creation-and-retrieval.md` (structured summary schema)
- `agent-output/planning/015-agent-ingestion-command.md` (ingestion counterpart)
- `agent-output/planning/016-autonomous-agent-retrieval-and-integration.md` (retrieval counterpart)
- `agent-output/planning/019-memory-compaction-pipeline.md` (compaction features - deferred from Plan 018)
