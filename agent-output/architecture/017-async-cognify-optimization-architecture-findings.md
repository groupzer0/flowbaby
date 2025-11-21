# Architectural Findings – Plan 017: Async cognify() Optimization

**Date**: 2025-11-20 13:45  
**Architect**: GitHub Copilot (GPT-5.1-Codex Preview)

**Reviewed Artifacts**:

- `agent-output/planning/017-async-cognify-optimization.md`
- `agent-output/architecture/system-architecture.md` (updated §3.1, §4.5.1, §9)
- `agent-output/roadmap/product-roadmap.md` (Epic 0.3.0.3 sequencing)

**Verdict**: **APPROVED_WITH_CHANGES** – Async cognify() is architecturally sound provided the constraints below are enforced before implementation proceeds.

---

## Architectural Overview
Plan 017 decouples the expensive `cognee.cognify()` step from the agent-facing ingestion acknowledgement so Store Summary tools respond within <10 s. The approved architecture splits `ingest.py` into `sync`, `add-only`, and `cognify-only` modes and introduces a TypeScript `BackgroundOperationManager` responsible for:

- Writing/reading a persisted ledger (`.cognee/background_ops.json` mirrored in VS Code `globalState`) so restart scenarios do not orphan background work.
- Spawning detached `cognify-only` subprocesses, tracking PIDs, and reconciling them on activation/deactivation.
- Enforcing bounded concurrency (2 active + FIFO queue of 3 pending) and surfacing queue saturation via explicit error codes (`429_COGNIFY_BACKLOG`).
- Sending lifecycle signals (start, success, fail) into the Output channel and the new `cognee.backgroundStatus` command, and surfacing throttled notifications for both success (info-level) and failure (warning-level) outcomes.

Manual capture flows now share the same async ingestion path (add-only + background cognify) so that no user waits 60+ seconds in the UI. The legacy `sync` mode is only for diagnostics/tests.

---

## Critical Requirements (Must Be Reflected in Plan + Implementation)

1. **Bridge Mode Split & Status Stubs**  
   `ingest.py` MUST accept `--mode sync|add-only|cognify-only` with identical argument handling. Add-only returns after staging data; cognify-only accepts `--operation-id` (UUID) and writes `{operation_id, success, error_code, error_message, remediation, elapsed_ms}` to `.cognee/background_ops/<operation_id>.json` before exit. Bridge tests must cover all three modes plus malformed combinations. Sync is retained only for diagnostics/tests; every production flow (agent + manual) uses add-only + cognify-only.

2. **Durable Operation Ledger**  
   `BackgroundOperationManager` maintains an in-memory map plus persisted ledger at `.cognee/background_ops.json` (mirrored to `globalState`). Every entry tracks `{operationId, datasetPath, summaryDigest, pid, queueIndex, startTime, status}`. Success records are retained for 24 h; failures for 7 days to aid QA. Extension activation must reconcile ledger entries with live PIDs (re-attach or mark `unknown`).

3. **Concurrency & Queueing Guarantees**  
   Maximum of 2 concurrent cognify processes. Queue up to 3 pending operations (FIFO) with persisted ordering; additional requests fail fast with `429_COGNIFY_BACKLOG` plus remediation text for agents. Queue state must survive reloads so that pending operations resume spawning after restart. Metrics (counts/duration) are logged locally for troubleshooting.

4. **Error Propagation & Notification Discipline**  
   Background completion logs success to the Output channel and emits an info-level toast (`✔ Cognify finished`) with a "View Status" action that opens `cognee.backgroundStatus`. Failures trigger a warning notification containing workspace name, summary digest, remediation guidance, "Retry" (re-run add-only) and "View Logs" actions. Success and failure toasts share the same throttle budget (≤1 per outcome every 5 min per workspace). Error codes reuse the taxonomy from Plan 016 (e.g., `MISSING_API_KEY`, `COGNEE_TIMEOUT`).

5. **Lifecycle Management**  
   - **Activation**: Manager loads ledger, reattaches to running PIDs, marks stale entries (`running` but PID missing) as `unknown`, and logs remediation instructions.
   - **Deactivation**: All running PIDs receive SIGTERM with 5 s grace, then SIGKILL if needed; ledger updates to `terminated` with exit reason.
   - **Status Surface**: `cognee.backgroundStatus` command renders current ledger entries (operationId, elapsed, status, last message) for QA and support. No remote telemetry is emitted.

6. **Testing Hooks**  
   Integration tests that previously skipped for timeouts (Plan 016.1) must be re-enabled once async ingestion lands. Add targeted tests for: queue overflow, failure notification path, restart reconciliation (simulate ledger entries, ensure manager handles them), and manual capture regression (verifies staged messaging + background completion rather than synchronous blocking).

7. **User Messaging for Async Flows**  
   Any surface that returns before cognify() finishes (agent tools, manual capture UI, headless commands, retry prompts) MUST tell the user that the memory was staged, background processing will complete in roughly 1–2 minutes, and a toast notification will announce completion. Never present “Done”/“Completed” copy while the background job is still running; success toasts are the authoritative completion signal.

---

## Integration Requirements & Constraints

- All ingestion entry points (agent tools, manual capture, headless commands) MUST call `ingestAsync`; the legacy sync mode is diagnostic-only. This ensures no user waits for cognify() inline while maintaining a single orchestration path.
- Ledger location `.cognee/background_ops*` lives alongside other workspace metadata, so packaging scripts must include this directory when exporting diagnostic bundles.
- Background operations inherit the same `.env` / interpreter resolution as foreground ingest. If Python path lookup fails mid-operation, the ledger entry must transition to `failed` with actionable remediation.
- Output channel lines must include `operationId` so QA can cross-reference notifications, ledger entries, and subprocess logs quickly.
- Bridge scripts are still the single source of truth for actual data writes; async orchestration cannot bypass `ingest.py` (avoids ontology drift).

---

## Preconditions Before Implementation Starts

1. Bridge contract (mode split + status stubs) must be fully specified and accepted by QA; update `system-architecture.md` (done) and ensure planner adds tasks for tests + documentation.
2. Implementer must size work so BackgroundOperationManager lands before any TypeScript surfaces flip to async; tools cannot toggle modes until manager + ledger exist.
3. QA sign-off on notification copy/behavior and on the new `cognee.backgroundStatus` surface to guarantee observability expectations are met.

---

## Outstanding Questions / Follow-Ups

1. **Operation ID Generation**: Planner should confirm canonical ID format (`uuid v4` preferred) and whether summary digests should include plan/topic IDs for later debugging.
2. **Queue Persistence Format**: Document how queued-but-not-started operations are serialized so reloads maintain ordering without race conditions.
3. **Retry UX**: Phase 1 keeps retries manual; document in README/AGENT_INTEGRATION how users should respond to failure notifications (e.g., run capture again vs click "Retry").

Once these items are captured in the plan and test strategy, Plan 017 can proceed.
