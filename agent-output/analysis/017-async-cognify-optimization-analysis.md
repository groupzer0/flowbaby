# 017-async-cognify-optimization-analysis

## Value Statement and Business Objective

As a developer using GitHub Copilot agents with Cognee memory tools,
I want memory storage operations to acknowledge quickly and finish knowledge graph processing in the background,
So that agents stay responsive while still guaranteeing that every stored summary is eventually cognified or surfaced with actionable errors.

## Objective

Deep-dive Plan 017s two unresolved research areas(a) Python async subprocess management and (b) post-add cognify outcome notificationsso the planner can size implementation work that meets the architects constraints without jeopardizing reliability or UX transparency.

## Architectural Context

- Consulted `agent-output/architecture/system-architecture.md` and `agent-output/architecture/017-async-cognify-optimization-architecture-findings.md` per architect guidance. The architect approved the async split with strict constraints: three ingest modes, durable ledgers in `.cognee/background_ops*`, 2+3 concurrency limits, failure-first notifications, and lifecycle reconciliation on activation/deactivation.
- Current runtime path (`StoreMemoryTool`  `cogneeMemory.ingestForAgent`  `CogneeClient.ingestSummary`  `extension/bridge/ingest.py --summary`) is fully synchronous: the TypeScript layer blocks until both `cognee.add()` and `cognee.cognify()` finish.
- Manual capture flows (`CogneeClient.ingest` conversation mode and keyboard shortcut) share the same Python script; architecture dictates they must remain synchronous to avoid surprising foreground users. Async mode is strictly for agent-driven ingestion until UX is redesigned.

## Root Cause Analysis (Focus Areas)

1. **Python Async Subprocess Management**
   - `ingest_summary()` and `ingest_conversation()` are both awaited inside a single `asyncio.run(...)` call, so the spawned Python process cannot terminate until `cognee.cognify()` finishes. VS Code therefore blocks for ~73 seconds per ingestion.
   - The bridge has no CLI flag or mode separation, so TypeScript cannot selectively run `cognee.add()` first, capture its success, and then spawn a second detached process for `cognify()` while returning early.
   - There is no durable artifact describing in-flight operations. Without `.cognee/background_ops/*.json` status stubs or a ledger, the TypeScript host has nothing to reconcile after crashes/reloads, making async orchestration brittle.

2. **Error Notification Patterns**
   - Plan 016.1 only surfaced foreground timeouts; there is no UX element signaling whether Cognify eventually succeeded or failed once the synchronous call returns.
   - The architecture document mandates deterministic warnings with Retry/View Logs actions plus throttling, but the current codebase lacks: (a) a notification scheduler keyed by workspace, (b) mappings from bridge `error_code` to remediation text, and (c) a retry hook that re-invokes add-only + cognify-only safely.
   - Success notification policy conflicts between plan (success + failure toasts) and architect findings (failure-only popups, success in Output/status command), leaving planners uncertain about acceptance criteria.

## Methodology

1. Reviewed Plan 017 and architecture findings to document mandatory constraints (mode split, ledger schema, queue sizing, notification discipline).
2. Inspected `extension/bridge/ingest.py` to understand existing CLI surfaces, `asyncio` usage, and dataset resolution logic.
3. Examined `extension/src/cogneeClient.ts`, `extension/src/commands/ingestForAgent.ts`, and `extension/src/tools/storeMemoryTool.ts` to map the current agent ingestion stack, subprocess handling, and logging behavior.
4. Cross-referenced Plan 016.1 tool lifecycle work to ensure Configure Tools remains the sole opt-in surface and to understand pending integration-test skips that async ingestion is expected to unblock.

## Findings

### Confirmed Facts

1. **Single Entry Point**: Both manual and agent ingestion ultimately call `python ingest.py ...`, meaning the mode split must be implemented without breaking existing CLI arguments (summary JSON parsing, conversation args, optional importance).
2. **Structured Summaries Already Pass Workspace Path**: Summary mode requires `workspace_path` embedded in JSON, so add-only and cognify-only modes can derive dataset names consistently via `generate_dataset_name(workspace_path)` without additional inputs.
3. **Run Loop Constraints**: `ingest.py` relies on `asyncio.run(...)`; the script can trivially branch based on a `--mode` flag but needs to ensure mutually exclusive execution (e.g., `add-only` must skip `await cognee.cognify`).
4. **TypeScript Timeout Guardrails**: `CogneeClient.ingestSummary` uses a 120s timeout; once async mode returns in <10s, this timeout effectively disappears for agent tools but must remain for manual capture (sync flow).
5. **No Ledger Infrastructure Exists**: There is currently no `.cognee/background_ops.json` nor a VS Code `globalState` mirror. Implementers need a new persistence layer plus migration-safe directory handling.
6. **Tool Integration Tests Skipped**: Plan 016.1 disabled four VS Code integration tests because sync ingestion exceeded test timeouts (25s/8s/3s). Async ingestion is explicitly expected to re-enable these tests; success is measurable.
7. **Architect vs Plan Notification Wording Diverges**: The planning docs constraint #5 demands notifications for both success and failure, yet the architects findings limit notifications to failures (success lives in Output + status command). This must be reconciled before implementation to avoid conflicting acceptance criteria.

### Hypotheses / Risks (by focus)

#### Async Subprocess Management

1. **Ledger Consistency**: Concurrent writes from VS Code (JSON ledger) and Python status stubs may require file locking or atomic rename patterns to avoid corruption on Windows. Hypothesis: use atomic temp-file writes (`tempfile.NamedTemporaryFile(delete=False)` + `os.replace`) on the Python side and `fs.writeFileSync` + `fsync` on the TS side.
2. **Detached Process Survivability**: `spawn(..., { detached: true, stdio: 'ignore' })` + `child.unref()` should allow background cognify to survive command completion, but Windows job objects sometimes terminate detached children when the parent exits abruptly (e.g., VS Code crash). Need empirical verification on Windows/macOS/Linux.
3. **Queue Replay Safety**: Restart reconciliation must detect stale `running` entries whose recorded PID no longer exists, otherwise ledger replay will spawn duplicate cognify jobs against the same dataset.

#### Error Notification Patterns

1. **Retry Flooding**: Notifications with a Retry button must honor the 2-active + 3-queued cap. Without queue awareness, repeated retries could overrun concurrency limits or starve new ingestions.
2. **Throttling Implementation**: Enforcing "≤1 notification per 5 minutes per workspace per outcome type" requires per-workspace state persisted alongside operations; lacking this, users could be spammed during batch imports.
3. **Architectural Ambiguity**: Plan vs architecture disagreement on success notifications risks shipping behavior that fails either acceptance test or architectural review; this must be resolved before coding.

## Testing Infrastructure Needs

- **Bridge Unit Tests**: Extend existing pytest suite (Plan 011) to cover all three modes (`sync`, `add-only`, `cognify-only`), status stub generation, malformed mode combinations, and error propagation. Include fixtures for `.cognee/background_ops/<operation_id>.json` to verify schema and values (elapsed_ms, remediation text).
- **TypeScript Unit Tests**: New tests for `BackgroundOperationManager` covering ledger persistence, queueing (2 running + 3 queued), retention policy (24h success/7d failure), activation reconciliation, and SIGTERM/SIGKILL behavior simulated via mocked child processes.
- **Integration Tests**: Re-enable the skipped tool-roundtrip tests once async mode lands. Add new cases for queue overflow (`429_COGNIFY_BACKLOG`), notification throttling, and status command output. Tests should stub `child_process.spawn` to avoid actually running `cognify-only` on CI while still exercising orchestration logic.
- **Manual QA Checklist**: Validate multi-workspace behavior, VS Code reload reconciliation, Windows vs macOS process termination, and cross-check ledger + notification content for accuracy (operationId, summaryDigest, elapsed time).

## Strategic Considerations

- **Alignment with Master Product Objective**: Async subprocess orchestration maintains agent responsiveness (natural workflow) while error notifications ensure cognitive overhead stays low by surfacing actionable remediation only when needed.
- **Legacy Debt Exposure**: Solving for detached cognify() runs and notification discipline forces creation of background ledgers, a prerequisite for future ranking, compaction, and telemetry work called out in Epics 0.3.0.1/0.3.0.2.
- **Architectural Consistency**: Enforcing the same concurrency contract (2 active, 3 queued) across retrieval and ingestion builds predictable behavior for all agent integrations, aiding future MCP or Configure Tools surfaces.
- **Transparency & Trust**: Clearly defined notification copy plus Output/command status surfaces is essential to uphold plan goals and the system architecture mandate around auditability.

## Recommendations

1. **Resolve Notification Policy Immediately**: Planner must confirm with architect whether success notifications remain (per Plan 017) or if failure-only toasts plus Output logs satisfy acceptance. This impacts copy, throttling state, and QA scripts.
2. **Design `--mode` CLI Contract First**: Refactor `ingest.py` so that shared setup (env load, dataset resolution) runs once, then dispatch to `run_sync()`, `run_add_only()`, or `run_cognify_only(operation_id)`. Include validation (UUID v4 check) and shared error taxonomy.
3. **Specify Operation Ledger Schema Early**: Draft the `BackgroundOperationManager` TypeScript interface and JSON schema before implementation so Python status stubs (`.cognee/background_ops/<id>.json`) align with `.cognee/background_ops.json` and VS Code `globalState` mirrors.
4. **Define Atomic Write Strategy**: Document (and later implement) atomic file-write patterns for both the Python status stubs and TypeScript ledger updates to avoid corruption on Windows.
5. **Integrate Notification Throttling Into Manager**: Treat notification throttling (≤1 per 5 minutes per workspace per outcome) as a first-class concern of `BackgroundOperationManager`, storing last-notified timestamps alongside operation history so any consumer (tools, commands) behaves consistently.
6. **Document Retry Flow**: Update README/AGENT_INTEGRATION to explain manual retries (what "Retry" triggers, queue impact, expectations) so users and QA know how to respond to failure notifications.

## Scope Considerations

- **In Scope**: Structured summary ingestion (agent tools) moving to async; ledger/notification work required to support it; test re-enablement mandated by Plan 017.
- **Out of Scope**: Priority queues, automatic retries, status bar indicators, or reducing `cognee.cognify()` duration itself (deferred to Phase 2 per plan). Any expansion should be documented as future work rather than silently added here.

## Open Questions

1. Should success notifications remain (per plan) or be downgraded to Output-channel-only per architect guidance? Needs architect + planner alignment.
2. Do we need file-locking semantics on `.cognee/background_ops.json` to prevent corruption on Windows when multiple async operations update rapidly?
3. How should retries interact with queue capacity? If a user hits "Retry" while two operations run and three are queued, does the retry skip the queue (to avoid starvation) or respect FIFO ordering?
4. Can we reuse existing audit log infrastructure (`.cognee/agent_audit.log`) to cross-link operation IDs, or do we need a separate diagnostic artifact?

## References

- `agent-output/planning/017-async-cognify-optimization.md`
- `agent-output/architecture/system-architecture.md`
- `agent-output/architecture/017-async-cognify-optimization-architecture-findings.md`
- `extension/bridge/ingest.py`
- `extension/src/cogneeClient.ts`
- `extension/src/commands/ingestForAgent.ts`
- `extension/src/tools/storeMemoryTool.ts`
