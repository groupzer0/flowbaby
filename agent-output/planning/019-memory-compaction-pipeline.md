# Plan 019: Memory Compaction Pipeline

**Plan ID**: 019
**Target Release**: v0.3.6
**Created**: 2025-11-21
**Updated**: 2025-11-21 (Revised per Architecture Findings: Queue Coordination, Immutable Supersedence, Conflict Store)
**Status**: Draft (Pending Critic Review)
**Epic Alignment**: Epic 0.3.0.1 - Context Ranking and Relevance (Compaction Component)
**Related Analysis**: `analysis/019-memory-compaction-analysis.md` (TBD)
**Related Architecture**: `architecture/system-architecture.md` §4.4, §9, §10.3; `architecture/019-memory-compaction-pipeline-architecture-findings.md`
**Dependency Note**: Split from Plan 018; requires Plan 018 metadata infrastructure to be complete

---

## Changelog

**2025-11-21 - Architectural Revision**
- **Handed off from**: Architect Agent
- **What was requested**: Update plan to align with async ingestion and immutable storage architecture.
- **Changes**:
  - **Milestone 1**: Compaction script must coordinate with `BackgroundOperationManager` (maintenance lock or labeled add-only) to avoid queue collisions.
  - **Milestone 1**: Supersedence implemented as *new* metadata entries (wrappers) rather than in-place mutation, respecting immutable enriched-text.
  - **Milestone 4**: Conflict diagnostics must persist to `.cognee/compaction/conflicts.json` to provide a durable source of truth for the review UI.

**2025-11-21 - Initial Creation**
- **Handed off from**: User request to separate compaction from Plan 018
- **What was requested**: Break out all compaction-related work from Plan 018 into separate plan
- **Scope**: Background compaction pipeline that merges related summaries into consolidated `DecisionRecord` entries with conflict detection, manual and auto-compaction commands, and conflict review UI

---

## Value Statement and Business Objective

As a developer with growing workspace memory,
I want related conversation summaries automatically consolidated into cohesive decision records,
So that I retrieve authoritative, conflict-free context instead of sifting through redundant or contradictory summaries.

**Success Criteria**:

- Compaction pipeline detects clusters of related summaries (same `topic_id`) and merges them into consolidated `DecisionRecord` entries.
- Conflict detection flags contradictory decisions for user review before creating `DecisionRecord`.
- Manual compaction command allows users to trigger consolidation on-demand.
- Auto-compaction runs on configurable schedule (disabled by default; users opt-in).
- Original summaries marked as `Superseded` (not deleted) to preserve audit trail.
- Compaction operation completes in <30s for typical workspace (50-100 summaries).

---

## Objective

Implement **memory compaction pipeline** to reduce retrieval noise and surface authoritative context:

1. **Compaction Algorithm**: Detect clusters of related summaries (same `topic_id`, status `Active`, age threshold), merge decisions/rationale/references into consolidated `DecisionRecord` entry.
2. **Conflict Detection**: Flag contradictory decisions within cluster using keyword-based heuristics; log conflicts for user review.
3. **Bridge Integration**: Expose compaction as Python bridge command (`compact.py`) callable from TypeScript.
4. **Manual Compaction Command**: User-triggered command (`cognee.compactMemories`) with progress indicators and completion summary.
5. **Auto-Compaction**: Optional scheduled background task (configurable interval in days; default disabled).
6. **Conflict Review UI**: (Stretch goal) Side-by-side comparison of conflicting summaries with user resolution workflow.

**Dependencies**:

- **REQUIRED**: Plan 018 metadata infrastructure (topic_id, status, timestamps) must be complete and deployed.
- **RECOMMENDED**: User should have some existing summaries with metadata to enable meaningful testing.

**Out of Scope**:

- LLM-based semantic merging (use deterministic text merging for MVP).
- Real-time compaction (triggered on every ingestion; batch only).
- Cross-workspace compaction (deferred to Epic 0.4.0).
- User feedback loop (thumbs up/down on compacted results; future enhancement).

---

## Assumptions

1. **Plan 018 Deployed**: Metadata infrastructure operational; summaries include `topic_id`, `status`, `created_at`, `updated_at` fields.
2. **Status Management**: Compaction creates new summaries with `status = 'DecisionRecord'`; updates originals to `status = 'Superseded'`.
3. **Clustering Trigger**: Cluster requires ≥3 summaries with same `topic_id`, status `Active`, and age >7 days (configurable).
4. **Merge Strategy**: Deterministic text merging (deduplicate arrays, preserve references); no LLM generation.
5. **Conflict Heuristics**: Simple keyword-based detection (e.g., "use X" vs "do not use X"); sophisticated ML deferred.
6. **User Control**: Auto-compaction defaults to disabled; users explicitly opt-in via settings.

---

## Plan

### Milestone 0: Compaction Algorithm Design and Documentation

**Objective**: Define clustering, merging, and conflict detection heuristics for compaction pipeline.

**Tasks**:

1. **Document Compaction Algorithm** (`extension/bridge/COMPACTION_ALGORITHM.md`)
   - **Clustering Logic**:
     - Group summaries by `topic_id`.
     - Filter for `status = 'Active'`.
     - Require cluster size ≥3 summaries.
     - Require all summaries older than age threshold (default: 7 days).
   - **Merge Logic**:
     - Combine `decisions` arrays (deduplicate exact matches).
     - Combine `rationale` arrays (deduplicate exact matches).
     - Combine `references` arrays (deduplicate by URL or identifier).
     - Preserve `openQuestions` and `nextSteps` from all summaries.
     - Set `created_at` = earliest timestamp in cluster.
     - Set `updated_at` = current timestamp.
     - Set `status = 'DecisionRecord'`.
     - Add metadata field: `merged_from` = array of original summary IDs.
   - **Conflict Detection Heuristics**:
     - Parse `decisions` array for contradictory keywords:
       - Negation patterns: "do not use X" vs "use X".
       - Opposite terms: "enable Y" vs "disable Y".
     - Flag conflict if contradictions detected; do not block compaction.
     - Log conflict details: `{ cluster_id, conflicting_decisions, summary_ids }`.
   - **Acceptance**: Algorithm documented with examples; heuristics testable; configurable parameters identified.

2. **Define Configurable Parameters** (`extension/package.json`)
   ```json
   "cogneeMemory.compaction.minClusterSize": {
     "type": "number",
     "default": 3,
     "description": "Minimum number of summaries required to trigger compaction."
   },
   "cogneeMemory.compaction.minAgeDays": {
     "type": "number",
     "default": 7,
     "description": "Minimum age (in days) for summaries to be eligible for compaction."
   },
   "cogneeMemory.compaction.autoInterval": {
     "type": "number",
     "default": 0,
     "description": "Auto-compaction interval in days (0 = disabled)."
   }
   ```
   - **Acceptance**: Settings visible in VS Code; defaults documented.

3. **Update Bridge Contract** (`COMPACTION_CONTRACT.md`)
   - Document compaction command: `python compact.py <workspace> [--dry-run]`.
   - Document request payload: `{ workspace: string, dryRun: boolean, minClusterSize: number, minAgeDays: number }`.
   - Document response payload:
     ```json
     {
       "compactedClusters": 5,
       "decisionRecordsCreated": 5,
       "conflictsDetected": 2,
       "supersededSummaries": 18,
       "conflicts": [
         {
           "clusterId": "uuid",
           "topicId": "uuid",
           "conflictingDecisions": ["use X", "do not use X"],
           "summaryIds": ["id1", "id2"]
         }
       ]
     }
     ```
   - **Acceptance**: Contract documented; serves as reference for TypeScript implementation.

**Owner**: Implementer
**Dependencies**: Plan 018 (metadata schema)
**Validation**: Algorithm documented; contract defined; parameters configurable.

---

### Milestone 1: Compaction Script (Backend)

**Objective**: Implement Python bridge script that performs compaction logic, coordinating with the async ingestion queue and respecting immutable storage.

**Tasks**:

1. **Implement `extension/bridge/compact.py`**
   - **Queue Coordination**:
     - Acquire exclusive lock (e.g., `.cognee/maintenance.lock`) to pause `BackgroundOperationManager`.
     - If lock fails (queue busy), exit with error (or wait).
   - **Compaction Logic**:
     - Query Cognee for all summaries with `status = 'Active'`.
     - Group by `topic_id`; identify clusters meeting trigger conditions.
     - For each cluster:
       - Merge summaries using documented merge logic.
       - Detect conflicts using heuristics.
       - **Create DecisionRecord**:
         - Call `cognee.add()` + `cognee.cognify()` synchronously (bypass async queue).
         - Persist `DecisionRecord` with enriched metadata.
       - **Supersede Originals**:
         - Do NOT mutate original text (enriched-text is immutable).
         - Ingest *new* metadata-only entry (or wrapper) for each original:
           - `status = 'Superseded'`.
           - `superseded_by = <decision_record_id>`.
           - `topic_id` = original topic ID.
           - `source_created_at` = original creation time.
         - Ensure retrieval logic prioritizes this new entry over the old one (by timestamp/status).
   - **Cleanup**:
     - Release exclusive lock.
     - Log actions to stdout (structured JSON).
   - **Acceptance**: Script runs safely; `DecisionRecord` created; originals superseded via new metadata entries; no queue collisions.

2. **Conflict Detection Implementation**
   - Parse `decisions` arrays for negation patterns.
   - Flag conflicts; include in response payload.
   - Persist conflicts to `.cognee/compaction/conflicts.json` (see Milestone 4).
   - **Acceptance**: Conflict detection logs issues; compaction proceeds with warnings.

3. **Dry-Run Mode**
   - If `--dry-run` flag set, simulate compaction without writing to Cognee.
   - Return preview of actions.
   - **Acceptance**: Dry-run mode returns accurate preview; no state changes.

4. **Integration with Cognee**
   - Use `cognee.add()` for synchronous ingestion during maintenance.
   - Handle Cognee errors gracefully.
   - **Acceptance**: Compaction script integrates with Cognee; errors handled gracefully.

**Owner**: Implementer
**Dependencies**: Milestone 0 (algorithm design); Plan 018 (metadata infrastructure)
**Validation**: Compaction script runs successfully; `DecisionRecord` entries created; originals marked `Superseded` immutably; conflicts logged.

---

### Milestone 2: Manual Compaction Command (TypeScript)

**Objective**: Expose manual compaction as user-triggered command with progress feedback.

**Tasks**:

1. **Implement `CogneeClient.compact()` Method** (`extension/src/cogneeClient.ts`)
   - Wrapper for `compact.py` bridge command.
   - Accept parameters: `{ workspace, dryRun, minClusterSize, minAgeDays }`.
   - Spawn Python subprocess; parse JSON response.
   - Return structured result: `CompactionResult` interface with clusters, records, conflicts.
   - **Acceptance**: `compact()` method callable from TypeScript; returns parsed response.

2. **Implement Compaction Command** (`extension/src/commands/compactMemories.ts`)
   - Command: `cognee.compactMemories`.
   - Check workspace initialized; show warning if not initialized.
   - Read configuration settings (minClusterSize, minAgeDays).
   - Show confirmation dialog: "Compact memories for workspace `<name>`? (Estimated: X summaries affected)".
   - Call `CogneeClient.compact()` with progress notification:
     - Display: "Compacting memories... (analyzing clusters)".
     - Update: "Compacting memories... (processing cluster 3 of 5)".
   - On completion, show toast with summary:
     - Success: "Compacted 5 clusters → 5 Decision Records (2 conflicts detected)".
     - Conflicts: "Review conflicts in Output channel".
   - Log detailed results to Output channel (cluster IDs, summary IDs, conflicts).
   - **Acceptance**: Command callable from command palette; provides real-time progress and completion summary.

3. **Register Command in `package.json`**

   ```json
   {
     "command": "cognee.compactMemories",
     "title": "Cognee: Compact Memories",
     "category": "Cognee",
     "enablement": "cogneeMemory.enabled"
   }
   ```

   - **Acceptance**: Command visible in command palette; callable by users.

4. **Error Handling**
   - Handle Python subprocess failures (exit code, stderr).
   - Handle Cognee timeouts or API errors gracefully.
   - Show user-friendly error notification: "Compaction failed: `<reason>`".
   - Log detailed error to Output channel.
   - **Acceptance**: Errors handled gracefully; users see actionable messages.

**Owner**: Implementer
**Dependencies**: Milestone 1 (compaction script)
**Validation**: Command works; progress notifications display; completion summary shown; errors handled.

---

### Milestone 3: Auto-Compaction (Background Task)

**Objective**: Implement scheduled background compaction with configurable interval.

**Tasks**:

1. **Implement Auto-Compaction Scheduler** (`extension/src/services/compactionScheduler.ts`)
   - Check configuration: `cogneeMemory.compaction.autoInterval`.
   - If `autoInterval > 0`, schedule background task at interval (in days).
   - Use VS Code workspace storage to track last compaction timestamp.
   - On timer trigger:
     - Check workspace initialized.
     - Call `CogneeClient.compact()` with default settings.
     - Log results to Output channel: "Auto-compaction completed (5 clusters, 2 conflicts)".
     - Update last compaction timestamp in storage.
   - **Acceptance**: Auto-compaction runs on schedule; respects interval setting; logs results.

2. **Auto-Compaction Opt-In UX**
   - Show information message on first workspace initialization:
     - "Enable automatic memory compaction? (Recommended for workspaces with frequent context updates)"
     - Buttons: "Enable", "Remind Me Later", "Never".
   - If "Enable", set `autoInterval = 7` (weekly default).
   - If "Never", set flag in workspace storage to skip future prompts.
   - **Acceptance**: Users prompted once; can opt-in or dismiss; preference persisted.

3. **Status Bar Indicator**
   - Show status bar item when auto-compaction enabled: "Cognee Auto-Compact: Enabled".
   - Display countdown to next compaction: "Next compaction: in 3 days".
   - Click status bar item to open Output channel (view last compaction results).
   - **Acceptance**: Status bar indicator visible; shows next compaction time; clickable.

4. **Manual Trigger During Auto-Compaction**
   - If user runs manual `cognee.compactMemories` while auto-compaction scheduled:
     - Reset auto-compaction timer (defer next scheduled run by interval).
     - Log: "Manual compaction reset auto-compaction schedule".
   - **Acceptance**: Manual compaction resets auto-compaction timer; no conflicts.

**Owner**: Implementer
**Dependencies**: Milestone 2 (manual command)
**Validation**: Auto-compaction runs on schedule; opt-in UX works; status bar displays correctly; timer resets on manual trigger.

---

### Milestone 4: Conflict Review UI (Stretch Goal)

**Objective**: Provide side-by-side UI for reviewing and resolving compaction conflicts using durable local storage.

**Tasks**:

1. **Implement Conflict Review Command** (`cognee.reviewCompactionConflicts`)
   - Query `.cognee/compaction/conflicts.json` for unresolved conflicts.
   - Display webview panel with conflict list:
     - Each conflict shows: topic, conflicting decisions, source summaries.
   - User selects conflict to review details.
   - **Acceptance**: Conflict list displays from local JSON store; users can select conflicts.

2. **Side-by-Side Comparison View**
   - Show summaries with conflicting decisions side-by-side.
   - Highlight conflicting sections in red.
   - Provide resolution options:
     - "Keep Decision A" (mark Decision B as invalid).
     - "Keep Decision B" (mark Decision A as invalid).
     - "Keep Both" (flag as intentional divergence).
     - "Manual Edit" (open text editor to merge manually).
   - **Acceptance**: Side-by-side comparison functional; resolution options work.

3. **Resolution Persistence**
   - On resolution:
     - Update `DecisionRecord` (ingest new version with resolved decision).
     - Update `.cognee/compaction/conflicts.json` to mark conflict as resolved.
     - Add metadata: `conflict_resolution = { resolved_at, chosen_decision, rejected_decision }`.
   - **Acceptance**: Resolution persisted to both Cognee and local JSON store; conflict marked resolved.

4. **Conflict Notification**
   - After manual or auto-compaction with conflicts:
     - Show information message: "2 conflicts detected. Review now?".
     - Buttons: "Review", "Later".
   - If "Review", open conflict review command.
   - **Acceptance**: Users notified of conflicts; can review immediately or defer.

**Owner**: Implementer
**Dependencies**: Milestone 2 (compaction command)
**Validation**: Conflict review UI functional; resolutions persist; users can resolve or defer.

---

### Milestone 5: Testing and QA

**Objective**: Validate compaction pipeline across scenarios; ensure correctness and performance.

**Tasks**:

1. **Unit Tests for Compaction Logic**
   - Test clustering: verify clusters meet trigger conditions (size, age, status).
   - Test merge logic: verify deduplication, reference preservation, timestamp handling.
   - Test conflict detection: verify contradictory keywords flagged.
   - **Acceptance**: Compaction unit tests pass; logic validated.

2. **Integration Tests for Compaction Round-Trip**
   - Ingest 5+ summaries with same `topic_id`, status `Active`, age >7 days.
   - Run compaction script → verify `DecisionRecord` created.
   - Verify originals marked `Superseded` with `superseded_by` reference.
   - Retrieve from `topic_id` with `includeSuperseded = false` → verify only `DecisionRecord` returned.
   - Retrieve with `includeSuperseded = true` → verify originals also returned.
   - **Acceptance**: Compaction round-trip validated; status filtering works.

3. **Conflict Detection Tests**
   - Ingest summaries with contradictory decisions (e.g., "use React" vs "do not use React").
   - Run compaction → verify conflict flagged in response.
   - Verify `DecisionRecord` created with conflict metadata.
   - **Acceptance**: Conflict detection identifies contradictions; compaction proceeds.

4. **Performance Tests**
   - Ingest 100 summaries across 20 topics (clusters of varying sizes).
   - Run compaction → measure execution time.
   - Target: <30s for typical workspace (50-100 summaries).
   - Profile bottlenecks; optimize if necessary.
   - **Acceptance**: Compaction completes within performance target.

5. **End-to-End Scenario Tests**
   - Scenario 1: User manually triggers compaction → sees progress → verifies completion summary.
   - Scenario 2: User enables auto-compaction → waits for interval → verifies compaction ran automatically.
   - Scenario 3: User reviews conflicts via UI → resolves conflict → verifies `DecisionRecord` updated.
   - Scenario 4: User runs dry-run compaction → verifies preview accurate without state changes.
   - **Acceptance**: E2E tests cover happy path and key workflows.

6. **QA Validation**
   - QA manually triggers compaction; validates results.
   - QA enables auto-compaction; validates scheduled execution.
   - QA reviews conflicts via UI (if implemented); validates resolution workflow.
   - Documents any issues in `qa/019-memory-compaction-qa.md`.
   - **Acceptance**: QA sign-off; no P0/P1 issues remain.

**Owner**: QA + Implementer
**Dependencies**: All previous milestones
**Validation**: All tests pass; performance target met; QA approves.

---

### Milestone 6: Update Version and Release Artifacts

**Objective**: Update project version to v0.3.6 and document changes.

**Tasks**:

1. **Update Version in `extension/package.json`**
   - Increment version to `0.3.6` (3-part semantic versioning required by VS Code Marketplace).
   - **Acceptance**: `package.json` version updated.

2. **Add CHANGELOG Entry**
   - Document Plan 019 deliverables under v0.3.6 section:
     - Memory compaction pipeline (merge related summaries into `DecisionRecord` entries).
     - Conflict detection with keyword-based heuristics.
     - Manual compaction command (`cognee.compactMemories`).
     - Auto-compaction with configurable interval (default disabled).
     - Conflict review UI for resolving contradictions (if implemented).
   - **Acceptance**: CHANGELOG reflects Plan 019 scope.

3. **Update README**
   - Add "Memory Compaction" section explaining:
     - How related summaries merge into decision records.
     - Manual vs auto-compaction workflows.
     - Conflict detection and resolution.
   - Include screenshots of compaction command and conflict review UI.
   - **Acceptance**: README markets compaction features.

4. **Commit Version Changes**
   - Commit with message: `"Release v0.3.6 - Plan 019: Memory Compaction Pipeline"`
   - Tag release: `git tag v0.3.6`
   - **Acceptance**: Version artifacts committed and tagged.

**Owner**: Implementer
**Dependencies**: All implementation milestones complete
**Validation**: Version artifacts updated; release ready for packaging.

---

## Testing Strategy

- **Unit Tests**: Clustering logic, merge logic, conflict detection heuristics, deduplication algorithms.
- **Integration Tests**: Compaction round-trip (ingest → compact → retrieve), status filtering with compacted results, dry-run mode accuracy.
- **Performance Tests**: Compaction execution time with 100+ summaries across 20+ topics.
- **End-to-End Tests**: Full workflow (manual compaction, auto-compaction, conflict review, dry-run preview).
- **QA Scenarios**: Configuration changes (cluster size, age threshold, auto-interval), error handling (Cognee failures, timeout), conflict resolution workflows.

**Coverage Expectations**:

- Unit: 90%+ for compaction logic, conflict detection, merge algorithms.
- Integration: All compaction paths covered (manual, auto, dry-run); status filtering validated.
- Performance: <30s compaction time validated with realistic datasets.
- E2E: Happy path + key workflows (manual/auto compaction, conflict review, dry-run).

**Critical Validation Scenarios**:

1. Cluster of 5 summaries (same topic_id) → compaction creates 1 `DecisionRecord`, marks 5 originals `Superseded`.
2. Conflicting decisions detected → compaction proceeds, conflict flagged in response.
3. Retrieve with `includeSuperseded = false` → only `DecisionRecord` returned, originals excluded.
4. Auto-compaction runs on schedule → results logged, timestamp updated.
5. Dry-run mode → preview accurate, no state changes.
6. Performance: Compact 100 summaries in <30s.
7. Conflict review UI → user resolves conflict, `DecisionRecord` updated.

---

## Validation

**Acceptance Criteria**:

- ✅ Compaction algorithm documented with clustering, merging, and conflict detection heuristics.
- ✅ Python bridge script (`compact.py`) implements compaction logic; creates `DecisionRecord` entries; marks originals `Superseded`.
- ✅ Manual compaction command (`cognee.compactMemories`) callable from command palette with progress feedback.
- ✅ Auto-compaction configurable via settings (interval-based); opt-in UX provided.
- ✅ Conflict detection flags contradictory decisions; compaction proceeds with warnings.
- ✅ Conflict review UI (if implemented) allows side-by-side comparison and resolution.
- ✅ All tests pass (unit, integration, performance, E2E); QA validation complete; no P0/P1 blockers.
- ✅ Version artifacts updated; CHANGELOG documents Plan 019.

**Sign-off**: QA + Architect review; Critic approval before implementation begins.

---

## Risks

1. **Conflict Detection Accuracy**
   - Risk: Keyword-based heuristics may produce false positives or miss subtle conflicts.
   - Mitigation: Start simple; log conflicts for user review rather than blocking compaction; iterate based on feedback.

2. **Compaction Data Loss**
   - Risk: Merge logic may inadvertently drop important context from original summaries.
   - Mitigation: Preserve references to originals via `merged_from` metadata; mark as `Superseded` (not deleted); enable rollback if needed.

3. **Performance Degradation**
   - Risk: Compaction may slow down significantly with large workspaces (1000+ summaries).
   - Mitigation: Profile bottlenecks; optimize clustering (e.g., index by topic_id); consider incremental compaction.

4. **Auto-Compaction Disruption**
   - Risk: Background compaction may interrupt user workflows or cause unexpected state changes.
   - Mitigation: Default to disabled; require explicit opt-in; show clear status bar indicator; log all actions.

5. **Conflict Resolution Complexity**
   - Risk: Side-by-side UI may be insufficient for complex conflicts (e.g., 5+ contradictory decisions).
   - Mitigation: Provide manual edit option; allow users to defer resolution; do not block compaction on unresolved conflicts.

---

## Open Questions

1. **Merge Strategy**: Should merge logic prefer newest decisions over oldest, or treat all equally? → **Resolution pending user research**.
2. **Compaction Frequency**: Is 7-day age threshold appropriate, or should it vary by workspace activity level? → **Resolution: Start with 7 days; make configurable; iterate based on feedback**.
3. **Conflict Resolution Authority**: Should conflicts require user resolution before `DecisionRecord` becomes active, or proceed with conflict flag? → **Resolution: Proceed with flag; do not block compaction; user can review later**.
4. **Rollback Support**: Should users be able to undo compaction (restore original summaries, delete `DecisionRecord`)? → **Resolution: Defer to future enhancement; marking as `Superseded` preserves data for manual recovery**.

---

## References

- `agent-output/analysis/019-memory-compaction-analysis.md` (TBD)
- `agent-output/architecture/system-architecture.md` (§4.4, §9, §10.3)
- `agent-output/roadmap/product-roadmap.md` (Epic 0.3.0.1)
- `agent-output/planning/018-metadata-ranking.md` (metadata infrastructure prerequisite)
- `agent-output/planning/014-chat-summary-creation-and-retrieval.md` (structured summary schema)
