# Plan 019 Architecture Findings

## Changelog

- 2025-11-21 15:15 – Planner handed Plan 019 draft (memory compaction pipeline) for architectural review, requesting validation that the proposed compaction, auto-scheduling, and conflict UI align with current async ingestion and metadata contracts. Outcome: **APPROVED_WITH_CHANGES** with three architectural blockers that must be addressed before Critic review.

## Critical Architectural Findings

1. **Compaction must integrate with the BackgroundOperationManager contract.** The draft proposes that `compact.py` ingest new `DecisionRecord` entries by calling `ingest.py --summary`, but since Plan 017 split ingestion into add-only + background cognify, any new writes must either (a) invoke `add-only` and then register themselves with the `BackgroundOperationManager`, or (b) run entirely inside the bridge while holding an exclusive maintenance lock so the async queue cannot mutate the same dataset concurrently. Today’s plan does neither, which risks concurrent writes fighting over `.cognee/background_ops` and emitting user-facing notifications for maintenance work. Planner must add explicit milestones describing how compaction enqueues background jobs (with separate audit labels) or how it pauses the queue during maintenance.
2. **Status updates cannot mutate existing enriched-text summaries in place.** With the current metadata fallback, we cannot “update” a stored summary to flip `status = Superseded`; we can only ingest a replacement entry. The plan’s Milestone 1 step that “updates originals” therefore conflicts with the documented architecture. Instead, compaction must write a new enriched-text payload for each superseded summary (or a single “superseded marker”) and let retrieval logic honor the new status via metadata precedence while preserving the immutable original text. Planner must capture this strategy and ensure retrieval prioritization (from Plan 018) consumes the new `supersededBy` metadata.
3. **Conflict metadata requires a persistent store accessible to both bridge and TypeScript.** The plan assumes conflicts are logged somewhere and later displayed in a conflict review UI, but it does not define where that data lives. Given all data must stay local and DataPoints remain unavailable, architecture requires conflicts to be recorded in a deterministic workspace asset (e.g., `.cognee/compaction/conflicts.json`) with a documented schema so both the bridge and VS Code extension can query/update it. Planner must add this storage contract before implementing Milestone 4.

## Integration Requirements & Constraints

- Manual and auto-compaction executions have to publish structured audit events (Output channel + optional `.cognee/compaction/history.log`) so QA can trace when the system automatically altered statuses. These events must be distinct from ingest/retrieve logs mandated in §4.5 of the system architecture.
- Auto-compaction scheduling cannot start when the background ingestion queue is non-empty or when another maintenance operation holds the lock. Planner needs to describe the handshake (e.g., consult the ledger, defer runs, emit warning) to avoid exceeding the two-job concurrency cap.
- Any new webview/UI for conflict resolution must treat the local conflict store as the source of truth and ensure edits re-ingest updated `DecisionRecord` entries via the sanctioned ingestion path.

## Preconditions Before Implementation

- Plan 018 metadata ranking must be complete so `DecisionRecord` + `Superseded` statuses have meaning in retrieval flows.
- Planner must revise milestones to cover queue coordination, immutable supersedence strategy, and conflict-storage schema prior to Critic review.

## Verdict

**APPROVED_WITH_CHANGES.** Once compaction is made queue-aware, status changes respect the immutable-storage constraint, and conflict metadata is given a durable home, the plan aligns with the documented three-layer architecture and privacy guarantees. Proceeding without these updates would jeopardize async ingestion stability and leave conflict review without a reliable data source.
