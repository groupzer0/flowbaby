# Plan 017: Async cognify() Optimization

**Plan ID**: 017
**Target Release**: v0.3.3
**Created**: 2025-11-19
**Status**: Planning
**Epic Alignment**: Epic 0.3.0.3 - Agent-Driven Memory Integration (performance optimization)
**Related Plans**: Plan 016 (Agent Retrieval and Tools), Plan 016.1 (Tool Lifecycle Hotfix)
**Requires Analysis**: Yes - Python async subprocess management, error notification patterns
**Requires Architecture**: Yes - Background process lifecycle, state tracking, error propagation

---

## Value Statement and Business Objective

As a developer using GitHub Copilot agents with Cognee memory tools,
I want memory storage operations to return quickly without blocking the agent for 68+ seconds,
So that agents can continue working while knowledge graph processing completes in the background, and I'm only interrupted if there's an error.

**Success Criteria**:

- Agent receives tool response within 5-10 seconds after invoking `#cogneeStoreSummary` (time for `cognee.add()` only)
- Knowledge graph construction (`cognee.cognify()`) completes in background without blocking agent workflow
- Users see notification ONLY if cognify() fails (silent success)
- Background cognify() operations are tracked so users can verify completion status if needed
- **Measurable**: Reduce agent blocking time from 73 seconds to <10 seconds for memory storage operations

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
                                               ├─→ Success: silent
                                               └─→ Failure: notify user
```

**Key Changes**:

1. **Split `ingest.py` into two modes**: `--sync` (current behavior for testing) and `--async` (new default for agent tools)
2. **Background subprocess**: After `cognee.add()` returns, spawn detached Python process for `cognee.cognify()`
3. **Error notifications only**: Background process logs success to Output channel; failures trigger VS Code notification
4. **State tracking**: Record in-flight cognify() operations to prevent duplicate processing and support status queries

---

## Plan

### Milestone 1: Analysis - Async Subprocess Patterns and Constraints

**Objective**: Validate technical approach for background cognify() operations and identify platform-specific constraints.

**Tasks**:

1. **Research Python subprocess daemonization**
   - Document how to spawn detached Python process that survives parent termination
   - Validate whether Node.js `child_process.spawn()` with `detached: true` + `stdio: 'ignore'` is sufficient
   - Test signal handling (SIGTERM, SIGINT) to ensure clean shutdown
   - Identify risks: zombie processes, orphaned operations on extension reload
   - **Acceptance**: Documented approach with code samples for detached subprocess creation

2. **Research background process state tracking**
   - Design lightweight state store (in-memory Map vs workspace Memento vs `.cognee/bg_operations.json`)
   - Define state schema: `{ operationId, workspaceUri, startTime, status, pid? }`
   - Determine state lifecycle: when to persist, how long to retain completed operations
   - **Acceptance**: State tracking design documented with persistence strategy

3. **Research error notification patterns**
   - Survey VS Code notification best practices for background operations
   - Design notification message format: clear error, actionable guidance, link to Output channel
   - Determine escalation path: when to show notification vs log-only
   - **Acceptance**: Error notification UX design with message templates

4. **Identify platform-specific constraints**
   - Document differences: Windows (no fork), macOS (sandbox), Linux (systemd?)
   - Validate Python `multiprocessing` vs `subprocess` for background cognify()
   - Test extension restart scenarios: do background processes survive? should they?
   - **Acceptance**: Platform constraints documented with mitigation strategies

**Owner**: Analyst  
**Dependencies**: None (pure research)  
**Validation**: Analysis document created in `agent-output/analysis/017-async-cognify-optimization-analysis.md`

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
**Validation**: Architecture findings document created; `system-architecture.md` updated

---

### Milestone 3: Implement Split Ingestion Mode in Bridge

**Objective**: Modify `ingest.py` to support async mode where `cognee.add()` and `cognee.cognify()` can be invoked separately.

**Tasks**:

1. **Add `--mode` flag to `ingest.py`**
   - Support `--mode sync` (default, current behavior: add + cognify in one call)
   - Support `--mode add-only` (new: only run `cognee.add()`, skip cognify)
   - Support `--mode cognify-only` (new: only run `cognee.cognify()` on existing dataset)
   - **Acceptance**: `ingest.py` accepts mode flag and behaves correctly for each mode

2. **Implement add-only mode**
   - Execute `cognee.add(text, dataset_name)`
   - Return JSON with success status and staged data metadata
   - Do NOT call `cognee.cognify()`
   - **Acceptance**: `python ingest.py --mode add-only ...` returns after add() completes

3. **Implement cognify-only mode**
   - Skip text/dataset argument parsing (not needed for cognify)
   - Execute `cognee.cognify()` on existing dataset
   - Return JSON with success status, cognify duration, entity count
   - Emit structured error payload on failure (reuse Plan 016.1 error codes)
   - **Acceptance**: `python ingest.py --mode cognify-only` runs cognify independently

4. **Update progress markers for async mode**
   - Emit `[PROGRESS] Add completed` marker before returning in add-only mode
   - Emit `[PROGRESS] Cognify started` marker in cognify-only mode
   - Maintain flush=True for real-time visibility (Plan 016.1 requirement)
   - **Acceptance**: Progress markers appear in Output channel for both modes

5. **Add bridge tests for split modes**
   - Test add-only mode: verify returns after add(), dataset exists
   - Test cognify-only mode: verify processes existing dataset correctly
   - Test sync mode: verify backward compatibility (existing behavior unchanged)
   - **Acceptance**: Bridge tests pass for all three modes

**Owner**: Implementer  
**Dependencies**: Milestones 1-2 (analysis and architecture complete)  
**Validation**: Bridge script tests pass; manual test shows split execution

---

### Milestone 4: Implement Background Subprocess Management in TypeScript

**Objective**: Add background process spawning, state tracking, and error notification to `CogneeClient`.

**Tasks**:

1. **Create `BackgroundOperationManager` service**
   - Singleton service to track in-flight cognify() operations
   - State store using VS Code Memento: `{ operationId, workspaceUri, startTime, status, pid }`
   - Methods: `startOperation()`, `completeOperation()`, `failOperation()`, `getStatus()`
   - **Acceptance**: Service exists with documented API

2. **Modify `CogneeClient.ingest()` for async mode**
   - Add optional `async: boolean` parameter (default: true for agent tools, false for manual capture)
   - When `async = true`:
     - Execute `ingest.py --mode add-only`
     - Return immediately after add() completes
     - Spawn detached background process for `ingest.py --mode cognify-only`
     - Register operation with `BackgroundOperationManager`
   - When `async = false`: retain current behavior (sync mode for backward compatibility)
   - **Acceptance**: Async ingestion returns in <10s; background cognify() spawns successfully

3. **Implement detached subprocess spawning**
   - Use `child_process.spawn()` with `detached: true`, `stdio: 'ignore'`
   - Capture background process PID for tracking
   - Emit audit log: "Background cognify() started for workspace X (PID: Y)"
   - **Acceptance**: Background subprocess spawns and runs independently of parent

4. **Implement background process monitoring**
   - Listen for background process exit events
   - On exit code 0: log success to Output channel (silent to user)
   - On exit code != 0: show VS Code notification with error + link to Output
   - Update operation state in `BackgroundOperationManager`
   - **Acceptance**: Exit events trigger correct logging and notifications

5. **Implement concurrency limits**
   - Check active cognify() operations before spawning new one
   - If at limit (recommendation: 2 concurrent): queue operation with timeout
   - If queue full: fail fast with clear error message
   - **Acceptance**: Concurrency limits enforced; no subprocess overload

6. **Add cleanup on extension deactivate**
   - Gracefully terminate background cognify() processes on extension shutdown
   - Send SIGTERM, wait 5s, send SIGKILL if still running
   - Log termination events to Output channel
   - **Acceptance**: Extension deactivate cleanly terminates background operations

**Owner**: Implementer  
**Dependencies**: Milestone 3 (split ingestion modes available)  
**Validation**: Async ingestion completes in <10s; background cognify() tracked correctly

---

### Milestone 5: Update Agent Tools to Use Async Mode

**Objective**: Configure `StoreMemoryTool` to use async ingestion by default, preserving sync mode for manual capture.

**Tasks**:

1. **Update `storeMemoryTool.ts` to use async ingestion**
   - Modify tool's call to `CogneeClient.ingest()` to pass `async: true`
   - Update tool description: "Memory will be fully searchable within 60-90 seconds"
   - Update confirmation message: "Memory staged successfully. Processing in background..."
   - **Acceptance**: Tool invocation returns quickly; users see updated messaging

2. **Update `ingestForAgent.ts` command for async mode**
   - Add `async` parameter to command (default: true)
   - Pass through to `CogneeClient.ingest()`
   - Update audit logging to distinguish sync vs async calls
   - **Acceptance**: Command supports both modes; agent tools use async by default

3. **Preserve sync mode for manual capture**
   - Manual capture command (`cognee.captureMessage`) should continue using sync mode
   - Rationale: User explicitly invoked capture and expects immediate confirmation
   - Update UX: show duration feedback after capture completes
   - **Acceptance**: Manual capture still waits for full ingestion; users see duration

4. **Update tool metadata and documentation**
   - Update `package.json` tool descriptions to mention background processing
   - Update AGENT_INTEGRATION.md with async behavior explanation
   - Document timing expectations: 5-10s agent response, 60-90s full processing
   - **Acceptance**: Documentation reflects new async behavior

**Owner**: Implementer  
**Dependencies**: Milestone 4 (async client implementation complete)  
**Validation**: Agent tools return quickly; manual capture still synchronous

---

### Milestone 6: Error Notification and Status Visibility

**Objective**: Implement user-facing notifications for background cognify() failures and status query capability.

**Tasks**:

1. **Implement error notification on cognify() failure**
   - Show VS Code notification: "⚠️ Background memory processing failed. [View Details]"
   - "View Details" button opens Output channel at error log
   - Include workspace name in notification for multi-workspace scenarios
   - **Acceptance**: Failed cognify() triggers notification; user can view details

2. **Add Output channel logging for background operations**
   - Log start: "[BACKGROUND] Cognify() started for workspace X"
   - Log success: "[BACKGROUND] Cognify() completed in 68s (1234 entities processed)"
   - Log failure: "[ERROR] Cognify() failed: ERROR_CODE - message details"
   - Include operation ID for correlation with state tracking
   - **Acceptance**: Output channel shows clear audit trail for all background operations

3. **Add status query command (optional)**
   - Register `cognee.backgroundStatus` command
   - Show quick pick with in-flight operations and their status
   - Display: operation ID, workspace, duration, status (pending/running/completed/failed)
   - **Acceptance**: Command exists; users can check background operation status

4. **Add telemetry for success/failure rates (Output only, local)**
   - Track: total cognify() operations, success count, failure count, avg duration
   - Log summary to Output channel on extension deactivate
   - Do NOT send telemetry remotely (privacy requirement)
   - **Acceptance**: Local telemetry available for debugging and QA

**Owner**: Implementer  
**Dependencies**: Milestone 4 (background process monitoring implemented)  
**Validation**: Notifications appear on failure; Output logs provide visibility

---

### Milestone 7: Testing and Documentation

**Objective**: Validate async ingestion behavior and document for users and developers.

**Tasks**:

1. **Update integration tests**
   - Add test for async ingestion: verify returns quickly, cognify() runs in background
   - Add test for sync ingestion: verify backward compatibility (manual capture)
   - Add test for concurrency limits: verify queuing and fail-fast behavior
   - Add test for error notification: verify notification appears on failure
   - **Acceptance**: Integration tests cover async ingestion paths

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
   - Scenario 2: Store 3 memories rapidly, verify concurrency limits enforced
   - Scenario 3: Simulate cognify() failure (invalid LLM key), verify notification appears
   - Scenario 4: Reload extension during cognify(), verify graceful termination
   - Scenario 5: Manual capture still waits for full ingestion (sync mode preserved)
   - **Acceptance**: All scenarios pass; behavior matches expectations

5. **Update CHANGELOG for v0.3.3**
   - **Added**: Async memory ingestion - agent tools return in <10s while processing continues in background
   - **Changed**: `#cogneeStoreSummary` tool description mentions 60-90s processing time
   - **Fixed**: Agent blocking during memory storage reduced from 73s to <10s
   - **Technical**: Split ingestion modes in bridge, background subprocess management
   - **Acceptance**: CHANGELOG entry complete

6. **Update README**
   - Add section explaining async ingestion behavior
   - Document timing expectations: 5-10s agent response, 60-90s full processing
   - Explain error notification behavior: silent success, popup on failure
   - **Acceptance**: README accurately describes async behavior

7. **Update AGENT_INTEGRATION.md**
   - Document async ingestion API: how to control sync vs async mode
   - Explain background process lifecycle and error handling
   - Provide guidance for extension developers using Cognee commands
   - **Acceptance**: Integration docs reflect async capabilities

**Owner**: Implementer + QA  
**Dependencies**: Milestones 3-6 (implementation complete)  
**Validation**: All tests pass; documentation accurate and complete

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
**Validation**: Version artifacts updated; ready for release

---

## Testing Strategy

**Unit Tests**:

- `BackgroundOperationManager` state management and transitions
- Bridge script mode selection (`--mode sync|add-only|cognify-only`)
- Concurrency limit enforcement
- Error propagation from background process to notification

**Integration Tests**:

- Round-trip async ingestion: store via tool, verify quick return, check background completion
- Sync ingestion backward compatibility: manual capture waits for full processing
- Concurrency stress test: spawn multiple background operations, verify limits respected
- Error handling: simulate cognify() failure, verify notification appears
- Extension reload: verify background operations terminate gracefully

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
- Notifications appear ONLY on failure (silent success validated)
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
   - Risk: Changes to bridge scripts break existing manual capture flow
   - Mitigation: Preserve sync mode as default for `ingest.py`; async mode is opt-in via flag
   - Impact: If backward compatibility breaks, manual capture will fail (caught by tests)

---

## Validation

**Milestone Acceptance**:

- ✅ **Milestone 1**: Analysis document created with subprocess patterns and platform constraints
- ✅ **Milestone 2**: Architecture findings document created; system-architecture.md updated
- ✅ **Milestone 3**: Bridge script supports split modes; tests pass for all three modes
- ✅ **Milestone 4**: Async client implementation complete; background subprocess management working
- ✅ **Milestone 5**: Agent tools use async mode; manual capture preserved as sync
- ✅ **Milestone 6**: Error notifications implemented; Output logging provides visibility
- ✅ **Milestone 7**: Tests pass; documentation updated; CHANGELOG current
- ✅ **Milestone 8**: Version updated to v0.3.3; release artifacts prepared

**Plan Success**:

- Agent blocking time reduced from 73s to <10s during memory storage (measurable improvement)
- Background cognify() completes successfully without blocking agent workflow
- Error notifications appear ONLY when cognify() fails (silent success validated)
- Manual capture (user-initiated) still synchronous with full completion feedback
- No zombie processes or resource leaks from background operations
- Output channel provides full audit trail of background operations
- Documentation explains async behavior and timing expectations clearly
- QA report shows all acceptance criteria passing

---

## Open Questions

1. **Should background cognify() operations survive extension reload?**
   - Recommendation: No, terminate gracefully on reload to avoid orphaned processes. User can re-ingest if needed.

2. **What is the optimal concurrency limit for background cognify() operations?**
   - Recommendation: Start with 2 concurrent (matches Plan 016 retrieval limit); monitor via local telemetry and adjust in future if needed.

3. **Should we add progress notifications for long-running cognify() operations?**
   - Recommendation: Defer to Phase 2. Phase 1 delivers silent success with Output logging; users can check status if curious.

4. **How should we handle cognify() failures: retry automatically or require manual re-ingestion?**
   - Recommendation: No automatic retry in Phase 1 (simpler). Show notification with "Retry" button that re-invokes manual capture. Defer retry queue to Phase 2.

5. **Should async mode be configurable via workspace setting?**
   - Recommendation: No, async mode should be the default for agent tools (hardcoded). Manual capture remains sync. Avoid adding more settings unless users explicitly request control.

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

---

**Status**: Planning - Requires Analyst and Architect Review

**Next Steps**:

1. Invoke analyst for Milestone 1 (async subprocess patterns and constraints)
2. Invoke architect for Milestone 2 (background process lifecycle and error propagation)
3. Invoke critic for plan review before implementation begins
