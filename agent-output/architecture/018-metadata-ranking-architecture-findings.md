# Plan 018 Architecture Findings

## Changelog

- 2025-11-21 15:05 – Planner handed Plan 018 draft (metadata infrastructure + ranking) for architectural review requesting confirmation that the proposed milestones align with structured-summary and async-ingestion architecture. Outcome: **APPROVED_WITH_CHANGES**; three architectural corrections required before planning proceeds.

## Critical Architectural Findings

1. **Migration path must bypass the async ingestion queue.** The proposed `migrate_summaries.py` re-ingests every legacy summary via `cognee.add`, which under Plan 017 now routes through `BackgroundOperationManager` (add-only → queued cognify). Running dozens of migrations through this path will spam staged-toasts, pollute the ledger, and can deadlock legitimate user captures. The migration needs a dedicated maintenance mode that runs entirely inside the bridge (Python) and performs both `add` and `cognify` synchronously per batch, while logging to a maintenance ledger separate from the live background queue. Planner must specify that the migration script never calls the VS Code-facing ingestion commands and that it temporarily pauses/locks the background manager while it operates.
2. **Recency ranking requires truthful timestamps.** Milestone 1 currently sets `created_at`/`updated_at` to the migration time, which would cause the exponential decay formula to treat every migrated summary as “brand new,” defeating ranking. The architecture requires either (a) deriving timestamps from existing artifacts (filesystem mtimes in `.cognee_data`, metadata embedded in Plan 014 summaries) or (b) persisting both `sourceCreatedAt` (original best-effort timestamp) and `migratedAt`, then having the ranking function operate on `sourceCreatedAt`. Planner must add this field strategy so that recency scoring is meaningful and auditable in transparency surfaces.
3. **Ranking parameters need a single source of truth.** Introducing both `decayAlpha` and `halfLifeDays` as independent settings creates conflicting inputs and pushes conversion logic into every consumer. Architecture requires a single canonical value (recommend exposing `halfLifeDays` to users, deriving `alpha = ln(2)/halfLifeDays` inside the bridge) so tests, QA, and documentation stay aligned. Planner must update the configuration story accordingly and document how the bridge validates mutually exclusive inputs.

## Integration Requirements & Constraints

- Migration tooling must coordinate with the async ingestion ledger: pause background jobs, checkpoint outstanding operations, and resume once migration finishes. Planner must document this handshake plus required audit artifacts (e.g., `migration.log` under `.cognee/maintenance/`).
- `retrieve.py` must emit the new metadata fields (`topicId`, `status`, `createdAt`, `sourceCreatedAt`, `finalScore`) consistently for both agent commands and the @cognee-memory participant. The plan needs explicit tasks to update `CogneeContextProvider` contracts and the shared telemetry/audit logs so QA can validate transparency requirements from §4.5.
- Migration and ranking changes must remain compatible with the enriched-text metadata fallback documented in system architecture §4.4.1; any schema change requires synchronized template + parser versioning with regression tests.

## Preconditions Before Implementation

- Plan 014 structured-summary migration must already be in place and green across bridge tests.
- Planner must add the maintenance-mode ingestion requirement, truthful timestamp strategy, and single-parameter config updates to the milestones (0–2) before Critic review.

## Verdict

**APPROVED_WITH_CHANGES.** Once the migration path is updated to bypass the async queue, timestamp handling preserves recency semantics, and ranking configuration is unified, the plan aligns with the established architecture. Shipping without these changes would undermine the BackgroundOperationManager contract and produce misleading ranking results.
