# Plan 017: Async cognify() Optimization

**Plan ID**: 017
**Target Release**: v0.3.3
**Created**: 2025-11-19
**Updated**: 2025-11-20 (Architecture alignment: manual capture async, staged messaging)
**Status**: Ready for Implementer
**Epic Alignment**: Epic 0.3.0.3 - Agent-Driven Memory Integration (performance optimization)
**Related Plans**: Plan 016 (Agent Retrieval and Tools), Plan 016.1 (Tool Lifecycle Hotfix)
**Requires Analysis**: ✅ Complete - See `agent-output/analysis/017-async-cognify-optimization-analysis.md`
**Requires Architecture**: ✅ Complete - See `agent-output/architecture/017-async-cognify-optimization-architecture-findings.md` and `system-architecture.md` §9 Decisions 2025-11-20 09:45, 12:05, 13:05, 13:25, 13:45
**Requires Critique**: ✅ Complete - See `agent-output/critiques/017-async-cognify-optimization-critique.md`
**Architecture Requirements**: MUST implement per architectural constraints (mode split, ledger format, concurrency limits, dual-notification discipline with independent per-outcome throttling, staged messaging for ALL ingestion flows)

---

## Architectural Constraints (MUST BE SATISFIED)

Per `agent-output/architecture/017-async-cognify-optimization-architecture-findings.md`, the following requirements are **MANDATORY** and must be reflected in all milestones:

1. **Bridge Mode Split**: `ingest.py` MUST accept `--mode sync|add-only|cognify-only` with identical argument handling
2. **Status Stubs**: Cognify-only mode MUST write `{operation_id, success, error_code, error_message, remediation, elapsed_ms}` to `.cognee/background_ops/<operation_id>.json`
3. **Durable Ledger**: BackgroundOperationManager MUST maintain `.cognee/background_ops.json` (mirrored to VS Code `globalState`) with schema `{operationId, datasetPath, summaryDigest, pid, queueIndex, startTime, status}`
4. **Concurrency Limits**: Maximum 2 concurrent cognify processes + FIFO queue of 3 pending operations; fail fast with `429_COGNIFY_BACKLOG` when exceeded
5. **Notification Discipline**: Both success (info-level) and failure (warning-level) trigger VS Code notifications so users know ingestion outcome; Success = `✔ Cognify finished` with "View Status" action; Failure = `⚠ Cognify failed` with "Retry"/"View Logs" actions; independent throttle budgets per outcome type: ≤1 success notification per 5 min per workspace, ≤1 failure notification per 5 min per workspace (tracked separately: lastSuccessAt, lastFailureAt)
6. **Lifecycle Management**: Activation reconciles PIDs, deactivation sends SIGTERM (5s grace) + SIGKILL, ledger updated accordingly
7. **Operation ID Format**: Use UUID v4 for `operation_id`; include summary digest (first 50 chars) in ledger for debugging
8. **Queue Persistence**: Queued operations serialized with position index; reloads resume queue in FIFO order
9. **Staged Messaging Requirement**: ALL ingestion surfaces (agent tools, manual capture, headless commands) MUST display "Memory staged – processing will finish in ~1–2 minutes. You'll get a notification when it's done." Never show "Done"/"Completed" while background cognify() runs; success toasts are the authoritative completion signal

---

## Value Statement and Business Objective

As a developer using GitHub Copilot agents with Cognee memory tools, I want memory storage operations to return quickly without blocking the agent for 68+ seconds, so that agents can continue working while knowledge graph processing completes in the background, and I'm only interrupted if there's an error.

**Success Criteria**:

- ALL ingestion surfaces (agent tools, manual capture, headless commands) return after successful `add()` function, indicating that content has been staged for ingestion, which should complete in 1-2 minutes
- Knowledge graph construction (`cognee.cognify()`) completes in background without blocking any user workflow
- Users receive clear "staged" messaging immediately, then notification when cognify() completes (success) OR fails
- Background cognify() operations are tracked in ledger for auditability and debugging
- **Measurable**: Reduce ALL ingestion blocking time from 73 seconds to <10 seconds (agent AND manual capture)

**Intent of Splitting add() and cognify()**:

The split serves two critical purposes:

1. **Agent Responsiveness**: Agents can acknowledge the ingestion request immediately after staging data (~5-10s) and continue their workflow while the expensive LLM-based graph construction happens asynchronously. This prevents 73-second blocking that currently makes agents unresponsive during memory storage.

2. **Testing & Development**: Separating the fast staging operation (add) from the slow processing operation (cognify) enables:
   - Faster integration tests that can validate staging without waiting 60+ seconds per test
   - Ability to test add() and cognify() independently for debugging
   - Option to re-run failed cognify() operations without re-staging data
   - Future flexibility to batch or prioritize cognify() operations based on system load

---

## Objective

Optimize the memory ingestion flow to eliminate agent blocking during expensive LLM-based knowledge graph construction. Current behavior forces agents to wait 73 seconds (5s for data staging + 68s for graph processing) before receiving tool confirmation. This creates poor UX when agents need to store multiple memories during a conversation.

**Current Performance** (measured 2025-11-19):

```text
load_env_sec: 0.004
init_cognee_sec: 2.09
add_sec: 4.92          ← Fast: stage data in dataset
cognify_sec: 68.35     ← Slow: LLM entity extraction, knowledge graph construction
total: ~73 seconds
```

**Target Performance**:

- Agent blocking: <10 seconds (return after `cognee.add()`)
- Background processing: 60-90 seconds (unchanged for `cognee.cognify()`)
- Total improvement: **~65 seconds faster agent response**

**Dependencies**:

- Plan 016.1 must complete (baseline tool functionality working)
- Requires Analysis: Python subprocess daemonization, Node.js background process management, error notification UX
- Requires Architecture: State tracking for background operations, restart handling, concurrency limits

**Out of Scope**:

- Advanced queue management with priorities (defer to Phase 2)
- UI status tracking in status bar or progress views (defer to Phase 2)
- Retry logic for failed cognify() operations (manual re-ingestion acceptable for Phase 1)
- Performance improvements to cognify() itself (60-90s is normal Cognee SDK behavior)

---

## Problem Analysis

### Current Behavior

The `ingest.py` bridge script performs two sequential operations:

1. **`cognee.add(text, dataset_name)`** - Stages data in dataset (fast, ~5s)
2. **`cognee.cognify()`** - Builds knowledge graph via LLM entity extraction (slow, ~68s)

Both operations are synchronous and block the calling TypeScript code until completion. This means:

- GitHub Copilot agents must wait 73 seconds before receiving tool response
- During this time, agents cannot process other tasks or respond to user
- Users perceive the extension as "frozen" or unresponsive
- Storing multiple memories in one conversation multiplies the delay (3 memories = 219 seconds blocked)

### Root Cause

The design assumption was that ingestion must be atomic (data staging + graph construction together) to ensure memories are immediately searchable. However, real-world usage shows:

1. **Race condition is acceptable**: Agents rarely store and immediately retrieve the same memory within 60 seconds
2. **Silent success preferred**: Users don't need confirmation that cognify() succeeded unless it fails
3. **Background processing viable**: Knowledge graph construction is independent work that doesn't require agent context

### Proposed Solution

**Phase 1** (This Plan - v0.3.3):

Modify ingestion flow to return after `cognee.add()` completes, then continue `cognee.cognify()` in background:

```text
BEFORE (synchronous):
┌─────────────┐      ┌──────────────┐      ┌────────────────────┐
│ Agent calls │─────→│ cognee.add() │─────→│ cognee.cognify()   │─────→ Return
│ tool        │      │ (5s)         │      │ (68s)              │       (73s later)
└─────────────┘      └──────────────┘      └────────────────────┘

AFTER (async):
┌─────────────┐      ┌──────────────┐
│ Agent calls │─────→│ cognee.add() │─────→ Return immediately
│ tool        │      │ (5s)         │       (5s later)
└─────────────┘      └──────────────┘
                              │
                              └─────→ ┌────────────────────┐
                                      │ cognee.cognify()   │ (background)
                                      │ (68s)              │
                                      └────────────────────┘
                                               │
                                               ├─→ Success: notify user (completion)
                                               └─→ Failure: notify user (error + retry)
```

**Key Changes**:

1. **Split `ingest.py` into three modes**: `--mode sync` (diagnostic/test only), `--mode add-only` (stage data, return immediately), `--mode cognify-only` (background graph construction)
2. **Universal async adoption**: ALL production ingestion flows (agent tools, manual capture, headless commands) use add-only + background cognify-only; no user waits for cognify() inline
3. **Background subprocess**: After `cognee.add()` returns, spawn detached Python process for `cognee.cognify()`
4. **Staged messaging**: Every surface shows "Memory staged – processing will finish in ~1–2 minutes. You'll get a notification when it's done." instead of "Done"
5. **Outcome notifications**: Background process triggers VS Code notification on both success (info: completion time, entity count) and failure (warning: error + retry option)
6. **State tracking**: Record in-flight cognify() operations to prevent duplicate processing and support status queries

---

## Plan

### Milestone 1: Analysis - Async Subprocess Patterns and Constraints

**Objective**: Validate technical approach for background cognify() operations and identify platform-specific constraints.

**Tasks**:

1. **Research Python subprocess daemonization**
   - **Architecture Answer**: Use `detached: true` + `unref()` after event subscription per §4.5.1
   - **Platform Constraints** (from analysis):
     - Windows: Job objects may terminate detached children on parent crash; validate survival across VS Code reload/crash scenarios
     - macOS: Sandbox may restrict detached process signals; test SIGTERM/SIGKILL delivery
     - Linux: Standard detached behavior expected; verify systemd does not interfere
   - **Implementation Pattern**: `spawn(pythonPath, [script, ...args], { detached: true, stdio: 'ignore', cwd: workspace })` then `child.unref()` after attaching `exit`/`error` listeners
   - **Risks Identified**:
     - Zombie processes if ledger tracking fails
     - Orphaned cognify() if extension crashes during operation
     - PID reuse race conditions on rapid restart
   - **Acceptance**: Platform-specific validation complete; detached process pattern documented with fallback strategies

2. **Research background process state tracking**
   - **Architecture Answer**: Dual-ledger system: `.cognee/background_ops.json` (durable audit) + VS Code `globalState` (fast access)
   - **Schema** (architecture-mandated): `{operationId: UUID, datasetPath: string, summaryDigest: string, pid: number, queueIndex: number, startTime: ISO8601, status: 'pending'|'running'|'completed'|'failed'|'unknown'|'terminated', lastUpdate: ISO8601, errorCode?: string, errorMessage?: string}`
   - **Atomic Write Strategy** (from analysis):
     - Python status stubs: Use temporary file with atomic rename pattern to prevent corruption
     - TypeScript ledger: Use temporary file write + fsync + atomic rename to ensure durability across platforms (POSIX and Windows NTFS)
   - **State Lifecycle**: 24h retention (success), 7 days (failure); cleanup on activation via age filter
   - **Reconciliation Logic** (analysis requirement): On activation, read ledger + check each `running` entry's PID via `process.kill(pid, 0)` (signal 0 = existence check); mark stale entries `unknown` with remediation note
   - **Queue Persistence**: Serialize with `queueIndex`; on reload, filter `status=pending`, sort by index ascending, spawn up to (2 - active_count)
   - **Operation ID Format**: UUID v4 format for operationId; summaryDigest = first 50 chars of summary text for debugging
   - **Acceptance**: Ledger schema finalized; atomic write patterns documented; reconciliation algorithm specified with PID validation

3. **Research error notification patterns**
   - **Architectural Decision** (resolved 2025-11-20 12:05): Dual-notification policy approved with shared throttle budget per outcome type.
   - **Notification Format** (architecture-mandated):
     - **Success**: `vscode.window.showInformationMessage` with title "✅ Cognify finished", body "Workspace: {name}\nSummary: {digest}\nCompleted in {elapsed}s ({entity_count} entities)", action "View Status" → opens `cognee.backgroundStatus` command
     - **Failure**: `vscode.window.showWarningMessage` with title "⚠️ Cognify failed", body "Workspace: {name}\nSummary: {digest}\n{remediation}", actions ["Retry", "View Logs"] → Retry calls `ingest.py --mode add-only` + spawns new `cognify-only`; View Logs opens Output channel
   - **Throttling Strategy** (architecture-approved 2025-11-20 12:05):
     - **Final Decision (12:05)**: Independent per-outcome throttles—success notifications throttled separately from failure notifications. Success throttle does NOT block failure notifications and vice versa.
     - Maintain per-workspace, per-outcome-type timestamps: `Map<workspacePath, { lastSuccessAt: Date | null, lastFailureAt: Date | null }>`
     - Enforce independent throttle budgets: ≤1 success notification per 5 min per workspace AND ≤1 failure notification per 5 min per workspace
     - Subsequent events within throttle window → log to Output channel only, skip notification
     - Store throttle state in `BackgroundOperationManager` memory; **OPTIONAL**: persist to `.cognee/notification_throttle.json` for cross-reload consistency (defer unless user reports notification noise after reload; in-memory throttle sufficient for Phase 1)
   - **Retry Semantics** (analysis constraint): Retry button must check queue capacity before enqueueing; if at 5 total operations (2 running + 3 queued), show error toast "Cannot retry: background queue full. Wait 30-60s and try again."
   - **Error Code Mapping** (reuse Plan 016.1 taxonomy):
     - `MISSING_API_KEY` → "LLM_API_KEY not found in workspace .env. Add LLM_API_KEY=sk-... to continue."
     - `COGNEE_TIMEOUT` → "Cognee processing exceeded suite-configured timeout. Check Output logs for details."
     - `PYTHON_ENV_ERROR` → "Python dependencies missing. Run: pip install -r extension/bridge/requirements.txt"
     - `COGNEE_SDK_ERROR` → "Cognee SDK error: {message}. Check API key validity and network connectivity."
   - **Acceptance**: Notification copy finalized (pending architect decision on success); throttling logic specified; retry capacity check documented; error code mapping complete

4. **Identify platform-specific constraints**
   - **Windows**:
     - No fork support; detached processes via job objects which may terminate on parent crash
     - File locking required for ledger writes due to NTFS semantics
     - PID validation: `process.kill(pid, 0)` throws on non-existent PID (catch ESRCH)
     - Test with VS Code crash simulator (kill process group) to verify cognify() survival
   - **macOS**:
     - App sandbox may restrict signal delivery to detached children; validate SIGTERM reaches cognify() subprocess
     - APFS supports atomic renames; atomic write pattern should be reliable
     - PID validation: `process.kill(pid, 0)` returns true/false, does not throw
   - **Linux**:
     - Standard detached process behavior; systemd should not interfere with VS Code extension subprocesses
     - ext4/btrfs support atomic renames; no special handling needed
     - PID validation: same as macOS (signal 0 check)
   - **Python subprocess choice**: Use `subprocess` module (not `multiprocessing`) because:
     - `multiprocessing` requires pickling which breaks with Cognee SDK objects
     - `subprocess` with `detached=true` + `unref()` pattern is Node.js idiomatic
     - Cognee SDK is already async-aware via `asyncio.run()`
   - **Extension restart policy** (analysis recommendation): Background cognify() should survive extension reload but NOT VS Code exit. Rationale: reload is routine (extension updates, settings changes), but full VS Code exit signals user intent to stop all work. Implementation: on deactivate, send SIGTERM with 5s grace → SIGKILL to all tracked PIDs, mark ledger entries `terminated`.
   - **Acceptance**: Platform differences documented with atomic-write and PID-check variations; subprocess vs multiprocessing decision recorded; restart survival policy specified

**Owner**: Analyst  
**Dependencies**: None (pure research)  
**Acceptance**: Analysis document created at `agent-output/analysis/017-async-cognify-optimization-analysis.md` with detailed findings on subprocess patterns, ledger atomicity, notification throttling, and platform constraints. Notification policy resolved by architect (2025-11-20 12:05): dual notifications with independent throttling per outcome type.

---

### Milestone 2: Architecture - Background Process Lifecycle and Error Propagation

**Objective**: Define architectural approach for background cognify() operations, state management, and error handling.

**Tasks**:

1. **Design background process lifecycle**
   - Document process creation: when/how to spawn background cognify()
   - Define process termination: graceful shutdown on extension deactivate
   - Handle edge cases: extension reload during cognify(), VS Code exit during operation
   - **Acceptance**: Lifecycle documented in architecture findings

2. **Design state tracking mechanism**
   - Choose persistence layer (Memento for simple state, JSON file for auditability)
   - Define state transitions: `pending → running → completed/failed`
   - Document cleanup policy: retain completed operations for 24 hours, failed for 7 days
   - **Acceptance**: State management architecture documented

3. **Design error propagation path**
   - Define error detection: how background process reports failures to extension
   - Document notification strategy: immediate popup vs batch summary vs log-only
   - Design recovery guidance: what should users do when cognify() fails?
   - **Acceptance**: Error propagation flow documented with notification criteria

4. **Design concurrency limits**
   - Define max concurrent background cognify() operations (recommendation: 2)
   - Document queuing strategy: FIFO queue vs fail-fast on overflow
   - Handle race conditions: multiple agents storing memories simultaneously
   - **Acceptance**: Concurrency control strategy documented

5. **Update system architecture diagram**
   - Add background cognify() subprocess to runtime flow
   - Document state tracking and error notification paths
   - Update §4 Runtime Flows in `system-architecture.md`
   - **Acceptance**: Architecture document updated with async ingestion flow

**Owner**: Architect  
**Dependencies**: Milestone 1 (analysis findings)  
**Acceptance**: Architecture findings document created; `system-architecture.md` updated

---

### Milestone 3: Implement Split Ingestion Mode in Bridge

**Objective**: Modify `ingest.py` to support async mode where `cognee.add()` and `cognee.cognify()` can be invoked separately.

**Tasks**:

1. **Add `--mode` flag to `ingest.py`**
   - **Refactor CLI dispatch** (analysis recommendation): Extract shared setup into `setup_environment(workspace_path) → (dataset_name, api_key, cognee_config)`, then branch:
     - `--mode sync` (diagnostic/test only): calls `run_sync(summary_json | conversation_args)` → `await cognee.add()` + `await cognee.cognify()` (NOT used in production)
     - `--mode add-only` (production default): calls `run_add_only(summary_json | conversation_args)` → `await cognee.add()`, return JSON with `{success, ingested_chars, timestamp, staged: true}`
     - `--mode cognify-only --operation-id <UUID>`: calls `run_cognify_only(workspace_path, operation_id)` → derives dataset via `generate_dataset_name(workspace_path)`, runs `await cognee.cognify(datasets=[dataset_name])`, writes status stub
   - **Argument Validation**:
     - `cognify-only` requires `--operation-id` in valid UUID format (implementer decides validation approach)
     - `cognify-only` requires workspace path as first positional arg (for dataset derivation)
     - `add-only` and `sync` accept existing `--summary` + `--summary-json` OR positional conversation args
   - **Architecture Requirement**: All modes share dataset resolution logic (identical `generate_dataset_name()` calls) to prevent dataset drift
   - **Acceptance**: CLI parsing refactored; three dispatch functions exist; operation ID validation implemented; all modes derive dataset identically

2. **Implement add-only mode**
   - Execute `cognee.add(text, dataset_name)`
   - Return JSON with success status and staged data metadata
   - Do NOT call `cognee.cognify()`
   - **Acceptance**: `python ingest.py --mode add-only ...` returns after add() completes

3. **Implement cognify-only mode**
   - **Entry Point**: `run_cognify_only(workspace_path: str, operation_id: str)`
   - **Dataset Resolution**: Call `generate_dataset_name(workspace_path)` to derive same dataset used by add-only
   - **Cognify Execution**: `start_time = perf_counter()` → `await cognee.cognify(datasets=[dataset_name])` → `elapsed_ms = (perf_counter() - start_time) * 1000`
   - **Status Stub Writing** (atomic per analysis):
     - Schema: `{operation_id: str, success: bool, error_code: str | None, error_message: str | None, remediation: str | None, elapsed_ms: int, entity_count: int | None, timestamp: ISO8601}`
     - Directory: `.cognee/background_ops/` (create directory if missing)
     - Atomic write pattern: Write to temporary file in same directory, then use atomic rename to final path (prevents corruption on crash)


   - **Success Path**: Write stub with `success=true`, `entity_count` (if available from cognify return), return JSON to stdout
   - **Failure Path**: Catch exception, map to error code (reuse Plan 016.1 taxonomy: `MISSING_API_KEY`, `COGNEE_TIMEOUT`, `COGNEE_SDK_ERROR`), write stub with `success=false` + error details + remediation text, return error JSON to stdout, exit code 1
   - **Architecture Requirement**: Status stub write MUST complete before script exit (no `atexit` handlers that could fail silently)
   - **Acceptance**: `python ingest.py --mode cognify-only --operation-id <uuid> <workspace>` writes atomic status stub; exit code correlates with success field; both stub and stdout contain identical error payloads on failure

4. **Update progress markers for async mode**
   - Emit `[PROGRESS] Add completed` marker before returning in add-only mode
   - Emit `[PROGRESS] Cognify started` marker in cognify-only mode
   - Maintain flush=True for real-time visibility (Plan 016.1 requirement)
   - **Acceptance**: Progress markers appear in Output channel for both modes

5. **Add bridge tests for split modes**
   - **Conversation Mode Regression Prevention** (analysis finding): Although async is targeted at summaries, `ingest_conversation()` shares the same script. Test that:
     - Conversation args (`python ingest.py <workspace> <user_msg> <asst_msg>`) default to sync mode (no `--mode` flag)
     - Explicit `--mode sync` with conversation args produces identical behavior to legacy code
     - `--mode add-only` with conversation args is REJECTED (not yet supported; require `--summary` flag)
   - **Add-Only Mode Tests**:
     - Verify returns JSON with `success=true, staged=true` after `cognee.add()` completes
     - Verify dataset exists in `.cognee_data` via directory check
     - Verify NO cognify() execution (check stderr for absence of `[PROGRESS] Cognify started`)
   - **Cognify-Only Mode Tests**:
     - Pre-stage data via add-only, then run cognify-only with same workspace + operation ID
     - Verify cognify() processes existing dataset (check for entity count in response)
     - Verify status stub exists at `.cognee/background_ops/<uuid>.json` with correct schema
     - Verify atomic write: status stub is complete JSON (no truncation or partial writes)
   - **Sync Mode Tests**:
     - Verify backward compatibility: existing test fixtures pass unchanged
     - Verify add + cognify execute sequentially within one subprocess lifecycle
   - **Malformed Input Tests**:
     - `cognify-only` without `--operation-id` → exit code 1, error message
     - `cognify-only` with invalid UUID format → exit code 1, validation error
     - `add-only` + `cognify-only` with mismatched workspace paths → cognify finds no staged data, fails gracefully
   - **Acceptance**: 15+ bridge tests cover mode dispatch, argument validation, atomic stub writes, conversation mode preservation, and error cases

**Owner**: Implementer  
**Dependencies**: Milestones 1-2 (analysis and architecture complete)  
**Acceptance**: Bridge script tests pass; manual test shows split execution

---

### Milestone 4: Implement Background Subprocess Management in TypeScript

**Objective**: Add background process spawning, state tracking, and error notification to `CogneeClient`.

**Tasks**:

1. **Create `BackgroundOperationManager` service**
   - **Location**: `extension/src/background/BackgroundOperationManager.ts` (new directory)
   - **Singleton Pattern**: Export singleton instance; constructor private
   - **Ledger Schema** (analysis-finalized):
     - Fields are classified as REQUIRED (must be present) or OPTIONAL (may be absent initially or deferred):

     | Field | Type | Required/Optional | Description |
     |-------|------|-------------------|-------------|
     | `operationId` | string (UUID v4) | REQUIRED | Unique operation identifier |
     | `datasetPath` | string | REQUIRED | Workspace path for duplicate detection |
     | `pid` | number \| null | REQUIRED | Process ID (null if queued/completed) |
     | `startTime` | string (ISO8601) | REQUIRED | Operation start timestamp |
     | `status` | enum | REQUIRED | One of: pending, running, completed, failed, terminated, unknown |
     | `summaryDigest` | string | OPTIONAL | First 50 chars of summary for debugging |
     | `queueIndex` | number | OPTIONAL | FIFO position if queued |
     | `elapsedMs` | number | OPTIONAL | Duration from status stub (available after completion) |
     | `entityCount` | number | OPTIONAL | Entity count from cognify success path (may be absent if SDK doesn't provide) |
     | `errorCode` | string | OPTIONAL | Plan 016.1 error taxonomy (only for failed status) |
     | `errorMessage` | string | OPTIONAL | Human-readable error (only for failed status) |
     | `lastUpdate` | string (ISO8601) | OPTIONAL | Timestamp of last status change |


   - **Dual Persistence** (architecture + analysis):
     - **JSON File**: `.cognee/background_ops.json` (durable audit trail)
     - **globalState**: `context.globalState.update('cognee.backgroundOps', ledger)` (fast read on activation)
     - **Atomic Write Approach**: Use tempfile write + fsync + rename pattern to ensure durability and prevent corruption from crashes or concurrent access (atomic on POSIX and Windows NTFS)

   - **Reconciliation Algorithm** (analysis-specified):
     - On activation: load JSON ledger + globalState, merge (JSON is source of truth)
     - For each `status=running` entry: check `process.kill(pid, 0)` (signal 0 = existence test)
       - If PID exists: reattach exit listener, keep status=running
       - If PID missing (throws ESRCH or returns false): mark status=unknown, add errorMessage="Process not found after reload"
     - For each `status=pending` entry: sort by queueIndex, spawn up to (2 - activeCount)
   - **Retention Policy**: On activation cleanup, filter out entries where:
     - `status=completed` AND `age > 24 hours`
     - `status=failed` AND `age > 7 days`
     - **Rationale**: Assuming 5-10 ingestion operations per workspace per day (agent summaries + occasional manual captures), 24h success retention = ~10 entries, 7d failure retention = ~70 entries worst-case. At ~200 bytes/entry, total footprint <20KB per workspace. Short success window reduces clutter; extended failure window supports troubleshooting patterns. Future: If high-volume workspaces report ledger bloat, consider configurable retention via workspace setting.
   - **Public API**:
     - `startOperation(summaryText: string, datasetPath: string): string` → generates operationId, computes digest, enqueues or spawns
     - `completeOperation(operationId: string, result: {entityCount, elapsedMs})` → updates status, schedules notification
     - `failOperation(operationId: string, error: {code, message, remediation})` → updates status, triggers notification
     - `getStatus(operationId?: string): OperationEntry | OperationEntry[]` → query ledger
     - `reconcileLedger(): Promise<void>` → activation reconciliation
     - `shutdown(): Promise<void>` → SIGTERM/SIGKILL all running PIDs
   - **Acceptance**: Service implemented with atomic writes, PID reconciliation, retention cleanup, and documented API

2. **Modify `CogneeClient.ingest()` for async mode**
   - Add optional `async: boolean` parameter (default: true for agent tools, false for manual capture)
   - When `async = true` (production default):
     - Execute `ingest.py --mode add-only`
     - Return immediately after add() completes
     - Spawn detached background process for `ingest.py --mode cognify-only`
     - Register operation with `BackgroundOperationManager`
   - When `async = false` (test/diagnostic only): execute `ingest.py --mode sync` (blocking add + cognify)
   - **Acceptance**: Async ingestion returns in <10s; background cognify() spawns successfully; sync mode available for tests

3. **Implement detached subprocess spawning**
   - Use `child_process.spawn()` with `detached: true`, `stdio: 'ignore'`
   - Capture background process PID for tracking
   - Emit audit log: "Background cognify() started for workspace X (PID: Y)"
   - **Acceptance**: Background subprocess spawns and runs independently of parent

4. **Implement background process monitoring**
   - **Exit Listener**: Attach to spawned process: `child.on('exit', (code, signal) => handleExit(operationId, code, signal))`
   - **Status Stub Reading**: On exit, read `.cognee/background_ops/<operationId>.json`, parse JSON, extract `{success, error_code, error_message, remediation, elapsed_ms, entity_count}`
   - **Notification Throttling** (architecture-approved):
     - Store in `BackgroundOperationManager`: `Map<workspacePath, {lastSuccessAt: Date | null, lastFailureAt: Date | null}>`
     - Before showing notification, check: `now - lastNotification[type] < 5 minutes` → skip toast, log to Output only
     - After showing notification, update: `lastNotification[type] = now`
     - Optionally persist throttle state to `.cognee/notification_throttle.json` for cross-reload consistency
   - **Success Notification** (architecture-approved 2025-11-20 12:05):
     - `vscode.window.showInformationMessage` with:
       - Title: "✅ Cognify finished"
       - Message: `Workspace: ${workspaceName}\nSummary: ${summaryDigest}\nCompleted in ${(elapsedMs/1000).toFixed(1)}s (${entityCount} entities)`
       - Actions: ["View Status"] → opens `cognee.backgroundStatus` command
   - **Failure Notification** (architecture-required):
     - `vscode.window.showWarningMessage` with:
       - Title: "⚠️ Background Memory Processing Failed"
       - Message: `Workspace: ${workspaceName}\nSummary: ${summaryDigest}\n${remediation}`
       - Actions: ["Retry", "View Logs"]
         - **Retry Logic** (analysis constraint): Check queue capacity before retrying; if at 5 total operations (2 running + 3 queued), show error toast "Cannot retry: background queue full. Wait 30-60s and try again." Otherwise, re-run add-only mode + spawn new cognify-only subprocess, log operation ID mapping to Output channel.

         - **View Logs**: `outputChannel.show()` + search for `[ERROR] ${operationId}`
   - **Output Logging** (all events, regardless of notification throttling):
     - Start: `[BACKGROUND] ${timestamp} - Cognify started (operationId=${id}, workspace=${name}, pid=${pid})`
     - Success: `[BACKGROUND] ${timestamp} - Cognify completed (operationId=${id}, elapsed=${ms}ms, entities=${count})`
     - Failure: `[ERROR] ${timestamp} - Cognify failed (operationId=${id}, errorCode=${code}, message=${msg})`
   - **Ledger Update**: Call `manager.completeOperation(id, result)` or `manager.failOperation(id, error)` to persist final state
   - **Acceptance**: Exit handler reads status stub, enforces throttling per workspace+type, shows conditional success toast + required failure toast with retry capacity check, logs all events to Output

5. **Implement concurrency limits**
   - **Architecture-Mandated Limits**: Max 2 running + 3 queued = 5 total capacity
   - **Enqueue Logic**: Check active + queued count; if >= 5, reject with `429_COGNIFY_BACKLOG` error. If < 2 active, spawn immediately (status=running); otherwise queue with FIFO index (status=pending). Persist ledger after each state change.
   - **Dequeue Logic**: On operation completion, filter pending entries by queueIndex (ascending), spawn up to (2 - activeCount) processes, update status to running, persist ledger.

   - **Duplicate Prevention** (analysis finding): Before enqueueing, check if identical `datasetPath + summaryDigest` already exists with `status=running|pending`. If found, reject with error: "Duplicate ingestion detected. Wait for in-flight operation to complete." **Important**: If existing entry has `status=completed|failed|terminated|unknown`, **allow new operation** (rationale: supports iterative refinement workflows where user edits and re-ingests near-identical content, or explicit retry after failure). Note: Digest-based collision detection uses first-pass content hash; legitimate iterative updates may produce identical digests. This policy prioritizes UX (allow re-ingest) over strict deduplication.
   - **Queue Persistence**: Ledger writes capture full queue state (pending entries with queueIndex). On activation, `reconcileLedger()` restores queue and resumes spawning.
   - **Acceptance**: Load test with 6+ rapid ingestions validates: first 2 spawn immediately (running), next 3 enqueue (pending with indexes 0-2), 6th rejects with 429; completion of any running operation triggers dequeue of pending[0]

6. **Add cleanup on extension deactivate**
   - **Deactivation Hook**: Register `context.subscriptions.push({ dispose: () => manager.shutdown() })`
   - **Shutdown Sequence** (analysis-specified): Send SIGTERM to all running PIDs (graceful shutdown signal), wait 5 seconds, then send SIGKILL to any remaining processes (force kill). Update ledger entries to status=terminated with errorMessage="Extension deactivated during cognify", persist final ledger state.

   - **Ledger Finalization**: Mark all running entries as `terminated` with timestamp so activation reconciliation knows they didn't crash
   - **Acceptance**: Deactivation sends SIGTERM, waits 5s, sends SIGKILL to stragglers, updates ledger with terminated status, persists final state

**Owner**: Implementer  
**Dependencies**: Milestone 3 (split ingestion modes available)  
**Acceptance**: Async ingestion completes in <10s; background cognify() tracked correctly

---

### Milestone 5: Update All Ingestion Surfaces to Use Async Mode

**Objective**: Configure ALL ingestion entry points (agent tools, manual capture, headless commands) to use async ingestion with staged messaging.

**Tasks**:

1. **Update `storeMemoryTool.ts` to use async ingestion**
   - Modify tool's call to `CogneeClient.ingest()` to pass `async: true`
   - Update tool description: "Memory will be fully searchable within 60-90 seconds"
   - Update confirmation message: "Memory staged – processing will finish in ~1–2 minutes. You'll get a notification when it's done."
   - **Acceptance**: Tool invocation returns quickly; users see staged messaging

2. **Update `ingestForAgent.ts` command for async mode**
   - Remove `async` parameter (always async in production)
   - Update audit logging to log operation ID and staged status
   - **Acceptance**: Command returns quickly with operation ID; background processing tracked

3. **Update manual capture for async mode**
   - Manual capture command (`cognee.captureMessage`) now uses async mode (matches agent flow)
   - **Rationale Change**: Architecture Decision (2025-11-20 13:45) mandates universal async adoption—no user (agent or manual) should wait 60+ seconds for cognify(). This changes prior analysis assumption that manual capture might remain synchronous. Tradeoff: immediate confirmation toast replaced by staged messaging + completion notification, ensuring consistent UX across all ingestion surfaces.
   - Update confirmation toast: "Memory staged – processing will finish in ~1–2 minutes. You'll get a notification when it's done."
   - **Acceptance**: Manual capture returns in <10s with staged messaging; completion confirmed via toast

4. **Update tool metadata and documentation**
   - Update `package.json` tool descriptions to mention background processing
   - Update AGENT_INTEGRATION.md with async behavior explanation
   - Document timing expectations: 5-10s agent response, 60-90s full processing
   - **Acceptance**: Documentation reflects new async behavior

**Owner**: Implementer  
**Dependencies**: Milestone 4 (async client implementation complete)  
**Acceptance**: All ingestion surfaces return quickly (<10s); staged messaging consistent across agent tools, manual capture, and headless commands

---

### Milestone 6: Outcome Notifications and Status Visibility

**Objective**: Implement user-facing notifications for both success (info-level) and failure (warning-level) outcomes per architectural decision 2025-11-20 12:05, plus status query capability.

**Tasks**:

1. **Implement success notification on cognify() completion**
   - **Architecture Requirement** (approved 2025-11-20 12:05): Show VS Code **info** notification on successful completion:
     - Title: "✅ Cognify finished"
     - Body: "Workspace: {workspace name}\nSummary: {first 50 chars of summary}\nCompleted in {elapsed}s ({entity count} entities processed)"
     - Action: "View Status" (opens `cognee.backgroundStatus` command)
   - Include workspace name and summary digest for multi-workspace/multi-operation scenarios
   - **Throttling**: Independent budget for success notifications: ≤1 per 5 minutes per workspace (tracked via lastSuccessAt; does NOT block failure notifications)
   - **Acceptance**: Successful cognify() triggers info notification per format; throttling prevents spam; View Status action opens status command

2. **Implement error notification on cognify() failure**
   - **Architecture-Mandated Format**: Show VS Code **warning** notification:
     - Title: "⚠️ Cognify failed"
     - Body: "Workspace: {workspace name}\nSummary: {first 50 chars of summary}\n{remediation text from status stub}"
     - Actions: ["Retry", "View Logs"]
   - "View Logs" button opens Output channel scrolled to error log for this operationId
   - "Retry" button re-runs the ingestion (calls `ingest.py --mode add-only` + spawns new cognify-only)
   - Include workspace name and summary digest for multi-workspace/multi-operation scenarios
   - **Throttling**: Independent budget for failure notifications: ≤1 per 5 minutes per workspace (tracked via lastFailureAt; does NOT block success notifications)
   - **Acceptance**: Failed cognify() triggers notification per format; throttling prevents spam; retry action functional

3. **Add Output channel logging for background operations**
   - Log start: "[BACKGROUND] Cognify() started for workspace X"
   - Log success: "[BACKGROUND] Cognify() completed in 68s (1234 entities processed)"
   - Log failure: "[ERROR] Cognify() failed: ERROR_CODE - message details"
   - Include operation ID for correlation with state tracking
   - **Acceptance**: Output channel shows clear audit trail for all background operations

4. **Add status query command (optional)**
   - Register `cognee.backgroundStatus` command
   - Show quick pick with in-flight operations and their status
   - Display: operation ID, workspace, duration, status (pending/running/completed/failed)
   - **Acceptance**: Command exists; users can check background operation status

5. **Add telemetry for success/failure rates (Output only, local) - OPTIONAL**
   - **Status**: OPTIONAL - defer to Phase 2 unless QA requires for validation
   - Track: total cognify() operations, success count, failure count, avg duration
   - Log summary to Output channel on extension deactivate
   - Do NOT send telemetry remotely (privacy requirement)
   - **Rationale for deferral**: Ledger + Output logs provide sufficient audit trail for Phase 1; only implement if time permits or QA explicitly needs aggregated metrics
   - **Acceptance**: If implemented: Local telemetry available for debugging and QA

**Owner**: Implementer  
**Dependencies**: Milestone 4 (background process monitoring implemented)  
**Acceptance**: Notifications appear on both success and failure; Output logs provide visibility

---

### Milestone 7: Testing and Documentation

**Objective**: Validate async ingestion behavior and document for users and developers.

**Tasks**:

1. **Update integration tests**
   - Add test for async ingestion: verify returns quickly, cognify() runs in background
   - Add test for sync mode: verify diagnostic mode still available for testing/debugging
   - Add test for concurrency limits: verify queuing and fail-fast behavior across agent + manual sources
   - Add test for error notification: verify notification appears on failure with correct throttling
   - Add test for staged messaging: verify all ingestion surfaces show "Memory staged..." copy
   - **Acceptance**: Integration tests cover async ingestion paths for all surfaces

2. **Add unit tests for BackgroundOperationManager**
   - Test state transitions: pending → running → completed/failed
   - Test cleanup policy: verify old operations are pruned
   - Test concurrency enforcement: verify limits respected
   - **Acceptance**: Unit tests pass for state management

3. **Re-enable skipped tests from Plan 016.1**
   - **Context**: Plan 016.1 added timeout guards to 4 VS Code tests that consistently timed out due to synchronous cognify() blocking (25s, 8s, 3s timeouts). These tests now skip when bridge subprocess exceeds timeout, leaving core acceptance criteria unverified.
   - **Opportunity**: With async cognify() returning in <10s, these tests should complete within their timeout windows and provide positive coverage validation instead of environmental skips.
   - **Affected Tests**:
     - `extension/src/test/toolIntegration.test.ts` - "Store summary via tool and retrieve via query returns matching results" (25s timeout → expect <10s with async)
     - `extension/src/test/storeMemoryTool.test.ts` - "invoke returns structured result" and "invoke validates tool invocation flow" (8s timeout → expect <10s with async)
     - `extension/src/test/agentIngestion.integration.test.ts` - "creates audit log file on ingestion attempt" (3s timeout → may still need adjustment)
   - **Task**: After async implementation, verify these tests now pass consistently. If audit log test still skips (3s may be too tight even with async), increase to 10s or refactor to mock filesystem.
   - **Acceptance**: Previously skipped tests now pass and validate round-trip workflow, tool invocation, and audit logging without timeouts

4. **Manual QA scenarios**
   - Scenario 1: Store memory via agent tool, verify <10s response, check Output for cognify() completion
   - Scenario 2: Store 3 memories rapidly (mix agent + manual), verify concurrency limits enforced across all sources
   - Scenario 3: Simulate cognify() failure (invalid LLM key), verify notification appears with correct throttling
   - Scenario 4: Reload extension during cognify(), verify graceful termination and reconciliation
   - Scenario 5: Manual capture via `Ctrl+Alt+C`, verify async behavior (returns <10s with staged message, toast on completion)
   - Scenario 6: Test independent throttling: trigger rapid successes (no failure block) and rapid failures (no success block)
   - **Acceptance**: All scenarios pass; behavior matches expectations; manual capture never waits for cognify()

5. **Update CHANGELOG for v0.3.3**
   - **Added**: Universal async memory ingestion - all ingestion flows (agent, manual, headless) return in <10s with staged messaging: "Memory staged – processing will finish in ~1–2 minutes. You'll get a notification when it's done."
   - **Changed**: `#cogneeStoreSummary` tool description mentions 60-90s background processing; manual capture now async
   - **Fixed**: Ingestion blocking reduced from 73s to <10s across all surfaces
   - **Technical**: Split ingestion modes in bridge (`--mode sync|add-only|cognify-only`), background subprocess management, dual notifications with independent throttling
   - **Acceptance**: CHANGELOG entry complete with verbatim staged messaging copy

6. **Update README**
   - Add section explaining async ingestion behavior
   - Document timing expectations: 5-10s agent response, 60-90s full processing
   - Explain notification behavior: staged message immediately, then success/failure toast on completion
   - **Include verbatim staged messaging copy**: "Memory staged – processing will finish in ~1–2 minutes. You'll get a notification when it's done."
   - **Acceptance**: README accurately describes async behavior with consistent messaging

7. **Update AGENT_INTEGRATION.md**
   - Document async ingestion API: how to control sync vs async mode
   - Explain background process lifecycle and error handling
   - Provide guidance for extension developers using Cognee commands
   - **Acceptance**: Integration docs reflect async capabilities

**Owner**: Implementer + QA  
**Dependencies**: Milestones 3-6 (implementation complete)  
**Acceptance**: All tests pass; documentation accurate and complete

---

### Milestone 7.5: Architecture Compliance Validation

**Objective**: Verify implementation satisfies all architecture-mandated constraints before release.

**Tasks**:

1. **Bridge Contract Validation**
   - Verify `ingest.py` accepts all three modes with identical argument handling
   - Verify cognify-only writes status stub with correct schema to `.cognee/background_ops/<uuid>.json`
   - Verify status stub includes `operation_id`, `success`, `error_code`, `remediation`, `elapsed_ms`
   - **Acceptance**: Bridge tests cover all modes; status stub format matches architecture schema

2. **Ledger Schema Validation**
   - Verify `BackgroundOperationManager` ledger matches architecture schema: `{operationId, datasetPath, summaryDigest, pid, queueIndex, startTime, status}`
   - Verify dual persistence (JSON file + globalState) with reconciliation on activation
   - Verify retention policy (24h success, 7 days failure) enforced
   - **Acceptance**: Ledger inspection shows correct schema; retention tested

3. **Concurrency & Queue Validation**
   - Verify maximum 2 concurrent processes enforced
   - Verify FIFO queue of 3 pending operations with persistence across reloads
   - Verify fail-fast with `429_COGNIFY_BACKLOG` when queue full
   - **Acceptance**: Load test spawns 6+ operations; first 2 run, next 3 queue, 6th rejects with 429

4. **Notification Discipline Validation**
   - Verify success path shows info notification (`✔ Cognify finished`) with workspace name, summary digest, elapsed time, entity count, View Status action
   - Verify failure path shows warning notification (`⚠ Cognify failed`) with workspace name, summary digest, remediation, Retry/View Logs actions
   - Verify independent throttling per outcome type (≤1 per 5 min per workspace): rapid successes throttle independently from rapid failures
   - Verify Output channel logs all events regardless of notification throttling
   - **Acceptance**: QA scenario validates dual notification architecture per decision 2025-11-20 12:05; throttle budgets tracked separately (lastSuccessAt, lastFailureAt)

5. **Lifecycle Validation**
   - Verify activation reconciles ledger with live PIDs (reattach or mark `unknown`)
   - Verify deactivation sends SIGTERM (5s grace) + SIGKILL to running processes
   - Verify ledger updates to `terminated` with exit reason
   - **Acceptance**: Extension reload during cognify() shows correct reconciliation; deactivate cleanly terminates

6. **Operation ID Format Validation**
   - Verify operationId uses UUID v4 format
   - Verify summaryDigest captures first 50 chars of summary text
   - Verify Output logs include operationId for correlation
   - **Acceptance**: Ledger inspection shows UUID v4 IDs + digest; logs correlate correctly

**Owner**: QA + Architect  
**Dependencies**: Milestone 7 (testing complete)  
**Acceptance**: Architect reviews implementation against `017-async-cognify-optimization-architecture-findings.md` checklist; all mandatory constraints satisfied

---

### Milestone 8: Update Version and Release Artifacts

**Objective**: Update project version to v0.3.3 and document changes for roadmap alignment.

**Tasks**:

1. **Update version in package.json**
   - Change `"version": "0.3.2"` to `"version": "0.3.3"`
   - **Acceptance**: package.json reflects v0.3.3

2. **Update CHANGELOG.md**
   - Add v0.3.3 section with async ingestion improvements
   - Document user-facing changes: faster agent response, background processing
   - Document technical changes: split bridge modes, subprocess management
   - **Acceptance**: CHANGELOG entry reflects plan deliverables

3. **Update extension README**
   - Add version history entry for v0.3.3
   - Update performance expectations section (if exists)
   - **Acceptance**: README current with v0.3.3 changes

4. **Commit version changes**
   - Commit message: "Release v0.3.3 - Async cognify() optimization (Plan 017)"
   - Include all version artifacts in single commit
   - **Acceptance**: Version changes committed with descriptive message

**Owner**: Implementer  
**Dependencies**: Milestone 7 (testing complete)  
**Acceptance**: Version artifacts updated; ready for release

---

## Testing Strategy

**Unit Tests**:

- `BackgroundOperationManager` state management and transitions
- Bridge script mode selection (`--mode sync|add-only|cognify-only`)
- Concurrency limit enforcement
- Error propagation from background process to notification

**Integration Tests**:

- Round-trip async ingestion: store via tool, verify quick return, check background completion
- Universal async adoption: verify agent tools, manual capture, and headless commands all use async mode with staged messaging
- Concurrency stress test: spawn multiple background operations across all surfaces, verify limits respected
- Error handling: simulate cognify() failure, verify notification appears with independent throttling
- Extension reload: verify background operations terminate gracefully and reconcile on restart

**Manual Tests**:

- Store memory via `#cogneeStoreSummary`, verify <10s response
- Check Output channel for background cognify() completion logs
- Trigger cognify() failure (e.g., invalid LLM key), verify notification
- Store multiple memories rapidly, verify concurrency limits enforced
- Manual capture via `Ctrl+Alt+C`, verify sync behavior (waits for full ingestion)
- Reload extension during cognify(), verify no zombie processes or orphaned operations

**QA Acceptance**:

- Agent blocking time reduced from 73s to <10s (measured)
- Background cognify() completes successfully (Output log evidence)
- Success notifications show completion details (elapsed time, entity count, workspace context)
- Failure notifications show actionable remediation with Retry/View Logs actions
- Notification throttling prevents spam (≤1 per 5 min per workspace per outcome type)
- Manual capture still synchronous (user expectation preserved)
- No performance regression in retrieval or other extension features

---

## Risks

1. **Platform-Specific Subprocess Behavior**
   - Risk: Detached subprocess handling differs between Windows/macOS/Linux
   - Mitigation: Analysis phase (Milestone 1) validates approach on all platforms; fallback to sync mode if async fails
   - Impact: Async optimization may not work on all platforms, requiring platform-specific code paths

2. **Zombie Processes on Extension Crash**
   - Risk: Extension crash during cognify() leaves orphaned Python processes consuming resources
   - Mitigation: Store PIDs in Memento; cleanup on next activation; document process termination in architecture
   - Impact: User may need to manually kill processes if extension crashes repeatedly

3. **Race Conditions in Rapid Ingestion**
   - Risk: Multiple agents store memories simultaneously, overwhelming subprocess limits
   - Mitigation: Concurrency limits (max 2 concurrent) + queue with fail-fast on overflow
   - Impact: Some ingestion requests may fail with "rate limit" error during heavy usage

4. **Error Notification Fatigue**
   - Risk: Repeated cognify() failures spam user with notifications
   - Mitigation: Implement notification throttling (max 1 per 5 minutes per workspace)
   - Impact: Users may miss important errors if notifications are suppressed

5. **Background Processing Visibility**
   - Risk: Users don't know if cognify() is still running or completed
   - Mitigation: Output channel logging + optional status query command
   - Impact: Users must actively check Output to monitor progress (acceptable for Phase 1)

6. **Backward Compatibility with Sync Mode**
   - Risk: Changes to bridge scripts break existing ingestion flows
   - Mitigation: Sync mode still available as `--mode sync` for diagnostic/test purposes; regression tests validate all three modes
   - Impact: If mode dispatch breaks, ingestion will fail (caught by tests)

---

## Expected Validation Criteria

**Milestone Completion Criteria**:

- **Milestone 1**: Analysis document created with subprocess patterns and platform constraints
- **Milestone 2**: Architecture findings document created; system-architecture.md updated
- **Milestone 3**: Bridge script supports split modes; tests pass for all three modes
- **Milestone 4**: Async client implementation complete; background subprocess management working
- **Milestone 5**: All ingestion surfaces use async mode; staged messaging deployed universally
- **Milestone 6**: Dual notifications (success + failure) implemented; Output logging provides visibility
- **Milestone 7**: Tests pass; documentation updated; CHANGELOG current
- **Milestone 7.5**: Architecture compliance validated; all mandatory constraints satisfied
- **Milestone 8**: Version updated to v0.3.3; release artifacts prepared

**Plan Success Criteria**:

- ALL ingestion blocking time reduced from 73s to <10s (agent tools AND manual capture - measurable improvement)
- Background cognify() completes successfully without blocking any user workflow
- Users receive clear "staged" messaging immediately, then outcome notifications for BOTH success (info with completion details) and failure (warning with retry option)
- Notification throttling prevents alert fatigue (independent budgets: ≤1 success per 5 min per workspace, ≤1 failure per 5 min per workspace)
- Manual capture returns immediately with staged messaging, relies on toast for completion signal (matches agent UX)
- No zombie processes or resource leaks from background operations
- Output channel provides full audit trail of background operations
- Documentation explains async behavior, staged messaging, and timing expectations clearly
- QA report shows all acceptance criteria passing
- **Architecture Compliance (Milestone 7.5)**: All mandatory constraints from `017-async-cognify-optimization-architecture-findings.md` (updated 2025-11-20 13:45) satisfied and validated by architect

---

## Open Questions

1. ✅ **ANSWERED**: Should background cognify() operations survive extension reload?
   - **Architecture Decision**: Operations persist in ledger with PID tracking. On reload, manager reattaches to live PIDs or marks stale entries `unknown`. Queue persists and resumes spawning.

2. ✅ **ANSWERED**: What is the optimal concurrency limit for background cognify() operations?
   - **Architecture Decision**: 2 concurrent + FIFO queue of 3 pending (total capacity: 5). This matches Plan 016 retrieval limits and prevents subprocess overload.

3. **DEFERRED**: Should we add progress notifications for long-running cognify() operations?
   - Recommendation: Defer to Phase 2. Phase 1 delivers silent success with Output logging; users can check status if curious via `cognee.backgroundStatus` command.

4. ✅ **ANSWERED**: How should we handle cognify() failures: retry automatically or require manual re-ingestion?
   - **Architecture Decision**: No automatic retry in Phase 1. Notification shows "Retry" button that re-runs add-only + spawns new cognify-only. Defer retry queue to Phase 2.
   - **Action Required**: Document retry UX in README/AGENT_INTEGRATION per architect question 3.

5. **DEFERRED**: Should async mode be configurable via workspace setting?
   - Recommendation: No, async mode is now universal (agent tools, manual capture, headless commands) per architecture decision 2025-11-20 13:45. Sync mode available only as `--mode sync` for diagnostic/testing purposes. Avoid adding settings unless users explicitly request granular control.

---

## Future Enhancements (Deferred to Phase 2)

1. **Status Bar Progress Indicator**
   - Show icon in status bar while cognify() operations are in flight
   - Click to open status view with operation details
   - Update icon on completion/failure

2. **Retry Queue for Failed Operations**
   - Automatically retry failed cognify() operations with exponential backoff
   - Max 3 retries before giving up and notifying user

3. **Advanced Concurrency Control**
   - Priority queue: user-initiated capture gets priority over agent-initiated
   - Adaptive limits: increase concurrency if system resources available

4. **Background Operation History View**
   - VS Code tree view showing recent cognify() operations
   - Click to view logs, retry failed operations, or cancel in-flight operations

5. **Metrics Dashboard**
   - Local-only dashboard showing ingestion success rates, avg duration, failure patterns
   - Helps users understand extension health without remote telemetry

---

## References

- `agent-output/roadmap/product-roadmap.md` (Epic 0.3.0.3 - Agent-Driven Memory Integration)
- `agent-output/architecture/system-architecture.md` (§4 Runtime Flows, §10.3 Context Intelligence)
- `agent-output/planning/016-agent-retrieval-and-ui-visible-extension-tools.md` (parent plan)
- `agent-output/planning/016.1-fix-tool-lifecycle-and-timeouts.md` (baseline tool functionality)
- `extension/bridge/ingest.py` (current ingestion implementation)
- `extension/src/cogneeClient.ts` (subprocess orchestration)
- `extension/src/tools/storeMemoryTool.ts` (agent tool implementation)
