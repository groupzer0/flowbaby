# Plan 017: Metadata Ranking and Compaction

**Plan ID**: 017
**Target Release**: v0.3.2
**Created**: 2025-11-18
**Updated**: 2025-11-18
**Status**: Draft (Pending Critic Review)
**Epic Alignment**: Epic 0.3.0.1 - Context Ranking and Relevance
**Related Analysis**: `analysis/015-metadata-ranking-and-compaction-placeholder-analysis.md` (TBD)
**Related Architecture**: `architecture/system-architecture.md` §4.4, §9, §10.3
**Dependency Note**: This plan was originally numbered 015; renumbered to 017 to prioritize agent ingestion/retrieval (Plans 015/016)

---

## Value Statement and Business Objective

As a developer retrieving context from Cognee Chat Memory,
I want the most relevant and up-to-date information surfaced first,
So that I don't waste time sifting through tangential, outdated, or superseded results.

**Success Criteria**:

- Retrieval results ranked by recency-aware scoring (semantic similarity + exponential time decay).
- Status-aware filtering prioritizes `DecisionRecord` entries and excludes `Superseded` summaries by default.
- Compaction pipeline merges multiple related summaries into consolidated `DecisionRecord` entries with conflict detection.
- Users see relevance scores and metadata (topic_id, plan_id, status, timestamps) transparently in retrieval results.
- Retrieval latency remains <2s even after metadata infrastructure is operational.

---

## Objective

Implement **metadata infrastructure, ranking algorithms, and compaction pipeline** to improve retrieval relevance:

1. **Metadata Infrastructure**: Extend Plan 014 structured summaries with indexed metadata fields (`topic_id`, `session_id`, `plan_id`, `status`, `created_at`, `updated_at`, `relevance_score`) persisted via Cognee DataPoints or enriched-text fallback.
2. **Recency-Aware Ranking**: Compute `final_score = semantic_similarity * exp(-decay_alpha * days_since_creation)` to balance relevance and freshness; expose configurable decay parameters (`alpha`, `halfLifeDays`).
3. **Status-Aware Retrieval**: Filter results by status (`Active`, `Superseded`, `DecisionRecord`); prioritize `DecisionRecord`, exclude `Superseded` by default (user can opt-in to include all statuses).
4. **Compaction Pipeline**: Implement background task that detects clusters of related summaries (same topic_id), merges them into consolidated `DecisionRecord` entries, marks originals as `Superseded`, and flags conflicts for user review.
5. **Transparency UX**: Display relevance scores, status, and metadata in @cognee-memory participant and agent API responses.

**Dependencies**:

- **REQUIRED**: Plan 014 bridge migration (structured summaries with enriched-text metadata) must be complete. Without this, there is no metadata to rank or compact.
- **RECOMMENDED**: Plans 015/016 (agent ingestion/retrieval commands) should be delivered before or in parallel, as ranking primarily benefits agent-initiated workflows.

**Out of Scope**:

- Cross-workspace ranking (deferred to Epic 0.4.0).
- LLM-based semantic similarity (rely on Cognee's existing hybrid search).
- Real-time compaction (batch processing only; user-triggered or scheduled).
- User feedback loop (thumbs up/down) - deferred to future enhancement.

---

## Assumptions

1. **Plan 014 Bridge Complete**: `ingest.py` accepts structured summaries with metadata; `retrieve.py` returns metadata fields (`topic_id`, `status`, `created_at`, `score`).
2. **Enriched-Text Fallback Active**: Metadata persisted via embedded markdown blocks until Cognee exposes DataPoint APIs (per §4.4.1 of architecture).
3. **Recency Decay Formula**: Exponential decay `exp(-alpha * days)` is sufficient; more complex models (linear, logarithmic) deferred to future research.
4. **Status Enum Stability**: Status values (`Active`, `Superseded`, `DecisionRecord`) are fixed for this release; additional statuses (e.g., `Draft`, `Archived`) deferred.
5. **Compaction Triggers**: Batch processing triggered manually (command) or on schedule (configurable interval); no automatic compaction on every ingestion.
6. **Conflict Detection Heuristics**: Simple heuristics (keyword overlap, decision contradiction) for initial implementation; sophisticated ML-based conflict detection deferred.

---

## Plan

### Milestone 0: Metadata Schema and Bridge Contract Extension

**Objective**: Extend Plan 014 bridge contract to include metadata fields required for ranking and compaction.

**Tasks**:

1. **Define Extended Metadata Schema** (`extension/bridge/DATAPOINT_SCHEMA.md`)
   - Add fields to Plan 014 schema:
     - `topic_id`: string (UUID or hash of topic name; links related summaries).
     - `session_id`: string (UUID; tracks conversation sessions).
     - `plan_id`: string (optional; links summary to specific plan/epic).
     - `status`: enum (`Active`, `Superseded`, `DecisionRecord`).
     - `created_at`: ISO 8601 timestamp (when summary was created).
     - `updated_at`: ISO 8601 timestamp (when summary was last modified).
     - `relevance_score`: float (computed during retrieval; not persisted).
   - Document enriched-text format for metadata embedding (fallback until DataPoints available).
   - **Acceptance**: Schema documented; enriched-text format specified; versioned for tracking template changes.

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
     - updated_at: <ISO 8601>
     ```
   - Call `cognee.add` with enriched text; persist to workspace dataset.
   - **Acceptance**: `ingest.py` accepts extended metadata; enriched-text rendering includes all fields; integration tests verify persistence.

3. **Update `retrieve.py` to Parse and Return Metadata**
   - Parse enriched-text metadata blocks via regex (deterministic pattern matching).
   - Compute `relevance_score` using recency-aware formula (see Milestone 2).
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

### Milestone 1: Migrate Existing Summaries to Metadata Schema

**Objective**: One-time migration of Plan 014 summaries to include metadata fields for ranking and compaction.

**Tasks**:

1. **Create Migration Script** (`extension/bridge/migrate_summaries.py`)
   - Query Cognee for all summaries created by Plan 014 (heuristic: contains structured sections like "**Topic:**", "**Decisions:**").
   - For each summary:
     - Generate `topic_id` from topic name (deterministic hash or UUID).
     - Generate `session_id` (placeholder UUID; cannot reconstruct from content).
     - Set `status = 'Active'` (default for existing summaries).
     - Set `created_at` = current timestamp (cannot reconstruct from content; document limitation).
     - Set `updated_at` = `created_at`.
   - Re-ingest summaries with enriched-text metadata via `cognee.add`.
   - Mark originals as migrated (metadata flag or separate dataset).
   - **Acceptance**: Migration script runs without errors; all Plan 014 summaries have metadata fields.

2. **Validation and Rollback**
   - Verify migrated summaries retrievable via `retrieve.py` with metadata.
   - Compare migrated count to expected count (log discrepancies).
   - Document rollback procedure (restore from backup if migration fails).
   - **Acceptance**: Migration validated; rollback procedure documented.

3. **User Communication**
   - Update CHANGELOG to note migration; warn that `created_at` timestamps are approximate for migrated summaries.
   - Provide configuration option to skip migration (user can defer if workspace has many summaries).
   - **Acceptance**: Migration communicated clearly; users understand timestamp limitations.

**Owner**: Implementer + QA
**Dependencies**: Milestone 0 (metadata schema and bridge extension)
**Validation**: Migration script runs successfully; summaries retrievable with metadata; no data loss.

---

### Milestone 2: Recency-Aware Ranking Algorithm

**Objective**: Implement ranking algorithm that balances semantic similarity and temporal relevance.

**Tasks**:

1. **Define Ranking Formula**
   - Formula: `final_score = semantic_similarity * exp(-decay_alpha * days_since_creation)`
   - Parameters:
     - `semantic_similarity`: from Cognee's hybrid search (vector + graph).
     - `decay_alpha`: configurable decay rate (default: `0.1`).
     - `days_since_creation`: `(current_time - created_at) / 86400` (seconds to days).
   - Document formula in `extension/bridge/RANKING_ALGORITHM.md`.
   - **Acceptance**: Formula documented; parameters configurable via settings.

2. **Implement Ranking in `retrieve.py`**
   - After Cognee search returns results, compute `final_score` for each entry.
   - Sort results by `final_score` descending.
   - Configurable parameters:
     - `decay_alpha`: float (default: `0.1`; higher = faster decay).
     - `halfLifeDays`: int (alternative parameterization; compute `alpha = ln(2) / halfLifeDays`).
   - Return sorted results with `score` field in JSON response.
   - **Acceptance**: Ranking implemented; results sorted by `final_score`; tests verify sorting accuracy.

3. **Add Configuration Settings** (`extension/package.json`)
   ```json
   "cogneeMemory.ranking.decayAlpha": {
     "type": "number",
     "default": 0.1,
     "description": "Exponential decay rate for recency scoring (higher = faster decay)."
   },
   "cogneeMemory.ranking.halfLifeDays": {
     "type": "number",
     "default": 7,
     "description": "Half-life in days for recency scoring (alternative to decay alpha)."
   }
   ```
   - **Acceptance**: Settings visible in VS Code; configurable by user.

4. **Validate Ranking Behavior**
   - Integration tests:
     - Two summaries with same semantic similarity; older summary ranked lower.
     - Two summaries with different creation dates; verify decay effect.
     - Legacy summaries without `created_at`: treated as current date (no decay penalty).
   - **Acceptance**: Ranking tests pass; recency decay validated.

**Owner**: Implementer
**Dependencies**: Milestone 0 (metadata schema); Milestone 1 (migration for existing summaries)
**Validation**: Ranking algorithm implemented; tests verify recency decay; configurable parameters work.

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

4. **UI Transparency for Status**
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

### Milestone 4: Compaction Pipeline (Backend)

**Objective**: Implement background task to merge related summaries into consolidated `DecisionRecord` entries.

**Tasks**:

1. **Define Compaction Heuristics**
   - Clustering: Group summaries by `topic_id`.
   - Trigger conditions:
     - Cluster has ≥3 summaries with `status = 'Active'`.
     - All summaries in cluster are older than threshold (e.g., 7 days).
   - Merge logic:
     - Combine `decisions` arrays (deduplicate).
     - Combine `rationale` arrays (deduplicate).
     - Flag conflicts: contradictory decisions (keyword overlap with negation).
   - Document heuristics in `extension/bridge/COMPACTION_ALGORITHM.md`.
   - **Acceptance**: Heuristics documented; clustering and merge logic defined.

2. **Implement Compaction Script** (`extension/bridge/compact.py`)
   - Query Cognee for all summaries with `status = 'Active'`.
   - Group by `topic_id`; identify clusters meeting trigger conditions.
   - For each cluster:
     - Create consolidated `DecisionRecord` summary:
       - Merge decisions, rationale, references.
       - Set `status = 'DecisionRecord'`.
       - Set `created_at` = earliest summary in cluster.
       - Set `updated_at` = current timestamp.
     - Ingest `DecisionRecord` via `ingest.py --summary`.
     - Update originals: set `status = 'Superseded'`, add reference to `DecisionRecord`.
   - Log compaction actions: cluster size, conflicts detected, `DecisionRecord` ID.
   - **Acceptance**: Compaction script runs without errors; creates `DecisionRecord` entries; marks originals as `Superseded`.

3. **Conflict Detection**
   - Heuristic: Flag if `decisions` array contains contradictory keywords (e.g., "use X" vs "do not use X").
   - Log conflicts to Output channel: "Conflict detected in cluster <topic_id>: <details>".
   - Do not block compaction; create `DecisionRecord` with conflict flag for user review.
   - **Acceptance**: Conflict detection logs issues; compaction proceeds with warnings.

4. **Integration with Bridge**
   - Expose compaction as bridge command: `python compact.py <workspace>`.
   - Return JSON summary: `{ compacted_clusters: 5, decision_records_created: 5, conflicts_detected: 2 }`.
   - **Acceptance**: Compaction callable from TypeScript; returns structured summary.

**Owner**: Implementer
**Dependencies**: Milestone 0 (metadata schema); Milestone 1 (existing summaries migrated)
**Validation**: Compaction script runs successfully; `DecisionRecord` entries created; originals marked `Superseded`; conflicts logged.

---

### Milestone 5: Compaction UX and Command

**Objective**: Expose compaction as user-triggered command with transparency and status reporting.

**Tasks**:

1. **Implement Compaction Command** (`extension/src/commands/compactMemories.ts`)
   - Command: `cognee.compactMemories`.
   - Check workspace initialized; warn user if many summaries will be compacted.
   - Call `CogneeClient.compact()` (new method wrapping `compact.py`).
   - Display progress notification: "Compacting memories... (cluster 3 of 5)".
   - Show completion toast with summary: "Compacted 5 clusters → 5 Decision Records (2 conflicts detected)".
   - Log details to Output channel.
   - **Acceptance**: Command callable from command palette; provides real-time progress and completion summary.

2. **Register Command in `package.json`**
   ```json
   {
     "command": "cognee.compactMemories",
     "title": "Cognee: Compact Memories",
     "enablement": "cogneeMemory.enabled"
   }
   ```
   - **Acceptance**: Command visible in command palette; callable by users.

3. **Add Scheduled Compaction** (Optional)
   - Configuration setting: `cogneeMemory.compaction.autoInterval` (in days; default: `0` = disabled).
   - Background timer triggers compaction at interval.
   - Log to Output channel: "Auto-compaction triggered (last run: <date>)".
   - **Acceptance**: Auto-compaction configurable; runs on schedule if enabled.

4. **Conflict Review UI** (Stretch Goal)
   - Command: `cognee.reviewCompactionConflicts`.
   - Display conflicting summaries side-by-side.
   - Allow user to select which version is correct.
   - Update `DecisionRecord` status or roll back compaction for specific cluster.
   - **Acceptance**: Conflict review UI functional; users can resolve conflicts manually.

**Owner**: Implementer
**Dependencies**: Milestone 4 (compaction backend)
**Validation**: Compaction command works; progress and completion feedback provided; conflicts logged.

---

### Milestone 6: Testing and QA

**Objective**: Validate metadata ranking and compaction across scenarios; ensure performance and correctness.

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

3. **Compaction Integration Tests**
   - Create cluster of 3+ summaries with same `topic_id`.
   - Run compaction script → verify `DecisionRecord` created, originals marked `Superseded`.
   - Retrieve from same `topic_id` → verify `DecisionRecord` returned, originals excluded (unless `includeSuperseded = true`).
   - **Acceptance**: Compaction integration tests pass; round-trip validated.

4. **Performance Tests**
   - Ingest 100 summaries with metadata; measure retrieval latency.
   - Target: <2s retrieval with ranking and status filtering.
   - Profile ranking computation; optimize if necessary.
   - **Acceptance**: Retrieval latency meets <2s target; performance validated.

5. **End-to-End Scenario Tests**
   - Scenario: User ingests summaries → enables auto-compaction → waits for interval → verifies `DecisionRecord` created.
   - Scenario: User manually triggers compaction → reviews conflicts in Output channel → resolves conflict via UI (if implemented).
   - Scenario: Agent retrieves context → receives ranked results with metadata → verifies status badges in UI.
   - **Acceptance**: E2E tests cover happy path and key workflows.

6. **QA Validation**
   - QA verifies ranking behavior (recency decay observable).
   - QA triggers compaction and validates `DecisionRecord` creation.
   - QA confirms status filtering works in participant and agent API.
   - Documents any issues in `qa/017-metadata-ranking-and-compaction-qa.md`.
   - **Acceptance**: QA sign-off; no P0/P1 issues remain.

**Owner**: QA + Implementer
**Dependencies**: All previous milestones
**Validation**: All tests pass; performance target met; QA approves.

---

### Milestone 7: Update Version and Release Artifacts

**Objective**: Update project version to v0.3.2 and document changes for roadmap alignment.

**Tasks**:

1. **Update Version in `extension/package.json`**
   - Increment version to `0.3.2` (3-part semantic versioning required by VS Code Marketplace).
   - **Acceptance**: `package.json` version updated.

2. **Add CHANGELOG Entry**
   - Document Plan 017 deliverables under v0.3.2 section:
     - Metadata infrastructure (topic_id, session_id, plan_id, status, timestamps).
     - Recency-aware ranking algorithm with configurable decay parameters.
     - Status-aware retrieval filtering (prioritize `DecisionRecord`, exclude `Superseded` by default).
     - Compaction pipeline (merge summaries into `DecisionRecord` entries).
     - Manual and auto-compaction commands.
   - **Acceptance**: CHANGELOG reflects Plan 017 scope.

3. **Update README**
   - Add "Intelligent Context Ranking" section explaining recency decay and status filtering.
   - Add "Memory Compaction" section explaining how summaries merge into decision records.
   - **Acceptance**: README markets ranking and compaction features.

4. **Commit Version Changes**
   - Commit with message: `"Release v0.3.2 - Plan 017: Metadata Ranking and Compaction"`
   - Tag release: `git tag v0.3.2`
   - **Acceptance**: Version artifacts committed and tagged.

**Owner**: Implementer
**Dependencies**: All implementation milestones complete
**Validation**: Version artifacts updated; release ready for packaging.

---

## Testing Strategy

- **Unit Tests**: Ranking algorithm (recency decay, status prioritization), status filtering logic, compaction heuristics (clustering, merge, conflict detection).
- **Integration Tests**: Bridge contract validation (metadata persistence, retrieval with ranking), compaction round-trip (ingest → compact → retrieve).
- **Performance Tests**: Retrieval latency with 100+ summaries; ranking computation overhead.
- **End-to-End Tests**: Full workflow (ingest → auto-compact → retrieve ranked results → verify status badges).
- **QA Scenarios**: Manual compaction, conflict review, configuration changes (decay alpha, auto-interval), participant and agent API behavior.

**Coverage Expectations**:

- Unit: 90%+ for ranking, filtering, and compaction logic.
- Integration: All metadata persistence and retrieval paths covered.
- Performance: <2s retrieval latency validated with realistic datasets.
- E2E: Happy path + key workflows (compaction, conflict detection, status filtering).

**Critical Validation Scenarios**:

1. Summaries with same semantic similarity but different `created_at` → older ranked lower (recency decay verified).
2. Query with `includeSuperseded = false` → `Superseded` summaries excluded.
3. Compaction creates `DecisionRecord` from 3+ summaries → originals marked `Superseded`.
4. Retrieval prioritizes `DecisionRecord` over `Active` summaries (status-aware ranking).
5. Conflict detection flags contradictory decisions → logged to Output channel.
6. Performance: Retrieve from 100+ summaries with ranking in <2s.

---

## Validation

**Acceptance Criteria**:

- ✅ Metadata schema extended with `topic_id`, `status`, `created_at`, `updated_at`, `relevance_score`.
- ✅ Existing Plan 014 summaries migrated to include metadata (one-time script).
- ✅ Recency-aware ranking algorithm implemented with configurable decay parameters.
- ✅ Status-aware retrieval filtering prioritizes `DecisionRecord`, excludes `Superseded` by default.
- ✅ Compaction pipeline merges related summaries into `DecisionRecord` entries with conflict detection.
- ✅ Manual compaction command (`cognee.compactMemories`) callable from command palette.
- ✅ Auto-compaction configurable via settings (interval-based).
- ✅ Ranking and status metadata visible in @cognee-memory participant and agent API responses.
- ✅ All tests pass (unit, integration, performance, E2E); QA validation complete; no P0/P1 blockers.
- ✅ Version artifacts updated; CHANGELOG documents Plan 017.

**Sign-off**: QA + Architect review; Critic approval before implementation begins.

---

## Risks

1. **Recency Decay Complexity**
   - Risk: Exponential decay may be too aggressive or too lenient; tuning required.
   - Mitigation: Configurable `decay_alpha` and `halfLifeDays` parameters; document tuning guidance in README.

2. **Conflict Detection Accuracy**
   - Risk: Heuristic-based conflict detection may produce false positives or miss real conflicts.
   - Mitigation: Start with simple keyword-based heuristics; log conflicts for user review rather than blocking compaction.

3. **Compaction Data Loss**
   - Risk: Merge logic may inadvertently drop important context from original summaries.
   - Mitigation: Preserve references to original summaries in `DecisionRecord`; mark originals as `Superseded` rather than deleting.

4. **Migration Timestamp Accuracy**
   - Risk: One-time migration cannot reconstruct original `created_at` timestamps; approximates with migration timestamp.
   - Mitigation: Document limitation in CHANGELOG; explain that ranking for migrated summaries uses approximate timestamps.

5. **Performance Degradation**
   - Risk: Ranking computation may slow retrieval beyond <2s target with large datasets.
   - Mitigation: Profile ranking overhead; optimize formula or cache scores if needed; consider moving ranking to Cognee layer.

---

## Open Questions

1. **Decay Parameter Defaults**: Are `alpha = 0.1` and `halfLifeDays = 7` reasonable defaults? → **Resolution pending user research/feedback**.
2. **Conflict Resolution UI**: Is manual conflict review UI required for MVP, or can it be deferred? → **Resolution: Defer to future enhancement; log conflicts for now**.
3. **Compaction Frequency**: Should auto-compaction default to enabled or disabled? → **Resolution: Default disabled; users opt-in via settings**.
4. **Status Enum Extension**: Should additional statuses (e.g., `Draft`, `Archived`) be supported? → **Resolution: Defer to future enhancement; stick to 3 statuses for MVP**.

---

## References

- `agent-output/analysis/015-metadata-ranking-and-compaction-placeholder-analysis.md` (TBD)
- `agent-output/architecture/system-architecture.md` (§4.4, §9, §10.3)
- `agent-output/roadmap/product-roadmap.md` (Epic 0.3.0.1)
- `agent-output/planning/014-chat-summary-creation-and-retrieval.md` (structured summary schema)
- `agent-output/planning/015-agent-ingestion-command.md` (ingestion counterpart)
- `agent-output/planning/016-autonomous-agent-retrieval-and-integration.md` (retrieval counterpart)
