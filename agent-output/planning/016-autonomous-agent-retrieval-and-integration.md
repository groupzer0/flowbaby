# Plan 016: Autonomous Agent Retrieval and Integration

**Plan ID**: 016
**Target Release**: v0.3.1 (or v0.4.0, parallel to Plan 015)  
**Created**: 2025-11-17
**Updated**: 2025-11-17 (Revised per Architectural Findings)
**Status**: Under Architectural Review
**Epic Alignment**: New Epic Required - "Agent Integration Platform"  
**Related Analysis**: `analysis/016-autonomous-agent-retrieval-and-integration-analysis.md`
**Related Architecture**: `architecture/016-autonomous-agent-retrieval-and-integration-architecture-findings.md`
**Architectural References**: `architecture/system-architecture.md` §3.1, §9

---

## Value Statement and Business Objective

As a developer working with multiple AI agents in VS Code,
I want Cognee Chat Memory to proactively provide relevant workspace context to these agents (not just when I explicitly prompt `@cognee-memory`),
So that conversations are richer, less myopic to recent turns, and I no longer have to manually reconstruct or restate prior decisions for every interaction.

**Success Criteria**:
- AI agents can autonomously retrieve Cognee context via a public API without user typing `@cognee-memory`.
- Retrieved context includes structured summaries (from Plan 014) with metadata (from Plan 015) for agent consumption.
- Users see transparent indicators when agents use Cognee (e.g., "(Context from Cognee: Plan 014 decisions)").
- Third-party VS Code extensions can integrate with Cognee as a context provider via documented commands.

---

## Objective

Implement **autonomous agent-initiated retrieval** and **agent-to-agent integration APIs** for Cognee Chat Memory:

1. Create a TypeScript-level `CogneeContextProvider` service that wraps `CogneeClient.retrieve` with agent-friendly structured responses, enforcing concurrency/rate limits.
2. Expose public VS Code command `cogneeMemory.retrieveForAgent` for arbitrary agents to call.
3. Add workspace-global agent access configuration (`agentAccess.enabled`) with prominent privacy warnings; access defaults to disabled.
4. Update the `@cognee-memory` participant to use the same provider, treating it as a UI surface over shared logic.
5. Introduce UX transparency indicators (Output channel logs, status bar) showing agent activity via Cognee-controlled surfaces.

**Dependencies**:
- **REQUIRED (BLOCKING)**: Plan 014 bridge migration must be complete before Milestone 1. The bridge must deliver structured `CogneeContextEntry` fields (`summaryText`, `decisions`, `topicId`, `planId`, `createdAt`, `score`) via `retrieve.py`. Without this, the provider will degrade to string parsing and recreate transparency issues.
- **REQUIRED**: Plan 015 metadata and ranking infrastructure should be complete for optimal agent experience, but provider can start with Plan 014-level structured summaries.
- **PRECONDITION**: Contract tests must demonstrate bridge returns structured schema before public commands are exposed (see Milestone 0).

**Out of Scope**:
- Deep changes to VS Code's chat API or new agent runtimes.
- Cloud-based coordination or multi-user memory (deferred to Epic 0.4.0 "Team Context Sharing").
- Automatic background monitoring of all chat sessions (violates privacy model; only opt-in, request-scoped retrieval).

---

## Assumptions

1. **Plan 014 Bridge Migration Complete**: Bridge migration from Plan 014 is complete and verified; `retrieve.py` returns structured `CogneeContextEntry` fields (`summaryText`, `decisions`, `topicId`, `planId`, `createdAt`, `score`). This is a hard precondition—implementation cannot proceed without it.
2. **VS Code Command API**: Commands are the primary integration surface; no special agent registries or VS Code API changes needed.
3. **User Opt-In (Workspace-Global)**: Agent access is **disabled by default**; users must explicitly enable `cogneeMemory.agentAccess.enabled`. When enabled, **all extensions in the workspace** can access Cognee memories—VS Code does not expose caller extension IDs, so per-extension authorization is not feasible.
4. **Workspace Isolation**: All retrieval remains workspace-scoped and local; no cross-workspace leakage.
5. **Transparency First**: Cognee logs all agent activity to Output channel and status bar. In-chat annotations require agent cooperation and are out of scope.
6. **Third-Party Agents**: Arbitrary VS Code extensions (not just Copilot) can call Cognee commands when access is enabled.

---

## Plan

### Milestone 0: Verify Bridge Contract (Precondition)

**Objective**: Confirm Plan 014 bridge migration is complete and delivers structured metadata before proceeding with agent integration.

**Tasks**:

1. **Verify `retrieve.py` Returns Structured Schema**
   - Run existing bridge tests or create integration test that calls `retrieve.py` with a test query.
   - Confirm response includes structured fields: `summaryText`, `decisions`, `rationale`, `topicId`, `planId`, `createdAt`, `score`.
   - If bridge still returns plain text or inline "Metadata:" strings, implementation is **BLOCKED** until Plan 014 bridge migration completes.
   - **Acceptance**: Bridge contract test passes; structured schema verified.

2. **Document Bridge Response Schema**
   - Create `extension/bridge/RETRIEVE_CONTRACT.md` documenting expected JSON structure from `retrieve.py`.
   - Include example response payload showing all fields.
   - Reference this document in `CogneeContextProvider` implementation.
   - **Acceptance**: Contract documented; serves as reference for provider parsing logic.

3. **Decision: Proceed or Block**
   - If bridge delivers structured schema: proceed to Milestone 1.
   - If bridge migration incomplete: **STOP IMPLEMENTATION** and escalate to planner/architect. Plan 016 implementers are NOT authorized to add fallback text parsing, modify bridge scripts, or work around missing schema under this plan's scope.
   - Escalation options: (a) pause Plan 016 until Plan 014 bridge owner completes migration, or (b) formally re-scope Plan 016 to include bridge migration work with architect approval.
   - **Acceptance**: Clear go/no-go decision made; no silent degradation to string parsing; escalation path followed if blocked.

**Owner**: Implementer + QA  
**Dependencies**: Plan 014 bridge migration scope  
**Validation**: Bridge contract test passes; schema documented; decision recorded.

---

### Milestone 1: Create `CogneeContextProvider` Service

**Objective**: Centralize retrieval logic into a TS service that returns agent-friendly structured data.

**Tasks**:

1. **Define TypeScript Interfaces** (`extension/src/types/agentIntegration.ts`)
   - `CogneeContextRequest`: `{ query: string; maxResults?: number; maxTokens?: number; contextHints?: string[] }`
   - `CogneeContextEntry`: `{ summaryText: string; decisions?: string[]; rationale?: string[]; topicId?: string; planId?: string; createdAt?: string; score?: number }`
   - `CogneeContextResponse`: `{ entries: CogneeContextEntry[]; totalResults: number; tokensUsed: number }`
   - **Acceptance**: Types exported and documented with TSDoc comments.

2. **Implement `CogneeContextProvider` Class** (`extension/src/cogneeContextProvider.ts`)
   - Constructor: accepts `CogneeClient` instance and concurrency config (max in-flight requests, queue size).
   - **Concurrency Control**: Maintain internal queue of pending requests; enforce max 2 concurrent bridge processes per workspace (default from settings).
   - **Rate Limiting**: Track request timestamps; reject requests exceeding 10/minute threshold with error code `RATE_LIMIT_EXCEEDED` (default from settings).
   - **Settings Guardrails**: Enforce safe upper bounds even if user settings exceed recommended limits. Clamp `maxConcurrentRequests` to a maximum of 5 and `rateLimitPerMinute` to a maximum of 30, logging a warning if user-configured values are reduced. This prevents misconfiguration from degrading VS Code performance.
   - Method: `retrieveContext(req: CogneeContextRequest): Promise<CogneeContextResponse>`
     - Enqueue request; wait for slot if concurrency limit reached.
     - Calls `CogneeClient.retrieve(req.query)` once slot available.
     - Parses bridge response using contract schema from Milestone 0 (`RETRIEVE_CONTRACT.md`).
     - Applies token budget and max results limits.
     - Returns `CogneeContextResponse` with structured entries.
   - **Error Handling**: Propagate bridge errors; return structured error payloads (`BRIDGE_TIMEOUT`, `RATE_LIMIT_EXCEEDED`, `QUEUE_FULL`).
   - **Acceptance**: Service enforces concurrency/rate limits with safe upper bounds; unit tests verify queueing behavior, clamping logic, and error codes.

3. **Integrate Provider into Extension Activation** (`extension/src/extension.ts`)
   - Instantiate `CogneeContextProvider` during `activate()`.
   - Store as module-level singleton or in extension context.
   - Ensure it respects `cogneeMemory.enabled` setting.
   - **Acceptance**: Provider available after activation; existing commands unaffected.

**Owner**: Implementer  
**Dependencies**: Milestone 0 (bridge contract verified); Plan 014 bridge migration complete  
**Validation**: Unit tests pass; provider returns structured data per contract; concurrency/rate limits enforced.

---

### Milestone 2: Expose Public Agent Commands

**Objective**: Create VS Code commands that arbitrary agents can invoke to retrieve Cognee context.

**Tasks**:

1. **Implement `cogneeMemory.retrieveForAgent` Command** (`extension/src/commands/retrieveForAgent.ts`)
   - Signature: `(requestJson: string) => Promise<string>`
   - Parse `requestJson` into `CogneeContextRequest`.
   - Check `cogneeMemory.agentAccess.enabled` setting; return error `{ error: "Agent access disabled", code: "ACCESS_DISABLED" }` if false.
   - Call `CogneeContextProvider.retrieveContext(req)`.
   - Serialize `CogneeContextResponse` to JSON string and return.
   - Error handling: Return JSON error payload `{ error: string, code: string }` if retrieval fails.
   - **Error Code Alignment**: The error codes introduced in this plan (`ACCESS_DISABLED`, `RATE_LIMIT_EXCEEDED`, `QUEUE_FULL`, `BRIDGE_TIMEOUT`, `INVALID_REQUEST`) are aligned with the broader error taxonomy work planned in roadmap Epic 0.2.3.1. These codes represent the agent-integration subset of the global taxonomy and may be harmonized with other error sources in future plans.
   - Log all access attempts to Output channel with timestamp, query hash, and result count (no per-extension filtering—workspace-global access model).
   - **Acceptance**: Command callable from other extensions; returns valid JSON response; workspace-global access enforced; error codes documented.

2. **[DEFERRED] `summarizeForAgent` Command Removed**
   - **Architectural Constraint**: Running LLM/summarization in TypeScript violates the three-layer architecture (Decision "Baseline Three-Layer Architecture").
   - **Future Work**: If summarization API is needed, implement as bridge operation (`summarize.py`) invoking Cognee/LLM, then expose via TypeScript command wrapper.
   - **Current Scope**: Only `retrieveForAgent` command ships in this plan.

3. **Register Commands in `package.json`**
   - Add command entry:
     ```json
     {
       "command": "cogneeMemory.retrieveForAgent",
       "title": "Retrieve Context for Agent",
       "enablement": "cogneeMemory.enabled"
     }
     ```
   - Mark as **internal command** (no UI menu entry; only callable via `vscode.commands.executeCommand`).
   - **Acceptance**: Command registered; other extensions can discover it via VS Code API.

4. **Document Agent Integration API** (`extension/AGENT_INTEGRATION.md`)
   - Create new markdown file documenting:
     - Command signatures and JSON schemas.
     - Example usage from a hypothetical agent extension.
     - Configuration requirements (`agentAccess.enabled`).
     - Expected response formats and error codes.
     - **API Versioning & Compatibility Policy**: Document that the `CogneeContextResponse` schema is forward-compatible: new fields may be added in future releases, but existing fields will not be removed or renamed without a major version bump. Third-party agents should ignore unknown fields. Optionally reserve a `schemaVersion` field in the response for future explicit versioning.
   - Include code snippet:
     ```ts
     const req = { query: "decisions about Plan 014", maxResults: 3 };
     const resJson = await vscode.commands.executeCommand<string>(
       "cogneeMemory.retrieveForAgent",
       JSON.stringify(req)
     );
     const res = JSON.parse(resJson) as CogneeContextResponse;
     ```
   - **Acceptance**: Documentation clear and actionable; example code runs successfully in test extension; compatibility policy stated.

**Owner**: Implementer  
**Dependencies**: Milestone 1 (`CogneeContextProvider`)  
**Validation**: Commands callable from test extension; return expected JSON; documented in `AGENT_INTEGRATION.md`.

---

### Milestone 3: Add Agent Access Configuration (Workspace-Global Opt-In)

**Objective**: Provide user controls for enabling/disabling workspace-global agent access with prominent privacy warnings, concurrency limits, and rate limits.

**Tasks**:

1. **Add Settings to `package.json`**
   ```json
   "cogneeMemory.agentAccess.enabled": {
     "type": "boolean",
     "default": false,
     "markdownDescription": "⚠️ **WARNING**: When enabled, ALL extensions in this workspace can retrieve Cognee memories. VS Code does not identify calling extensions, so per-extension access control is not possible. Only enable if you trust all installed extensions. See [Agent Integration docs](./AGENT_INTEGRATION.md) for details."
   },
   "cogneeMemory.agentAccess.maxResultsDefault": {
     "type": "number",
     "default": 5,
     "description": "Default maximum results returned to agents when not specified in request."
   },
   "cogneeMemory.agentAccess.maxTokensDefault": {
     "type": "number",
     "default": 4000,
     "description": "Default token budget for agent retrieval requests."
   },
   "cogneeMemory.agentAccess.maxConcurrentRequests": {
     "type": "number",
     "default": 2,
     "description": "Maximum concurrent agent retrieval requests allowed per workspace (prevents subprocess fan-out)."
   },
   "cogneeMemory.agentAccess.rateLimitPerMinute": {
     "type": "number",
     "default": 10,
     "description": "Maximum agent retrieval requests per minute (prevents performance degradation)."
   }
   ```
   - **Acceptance**: Settings visible in VS Code settings UI; warning prominent; defaults applied.

2. **Implement Access Control in Command Handlers**
   - In `retrieveForAgent`:
     - Check `cogneeMemory.agentAccess.enabled`; return error `{ error: "Agent access disabled", code: "ACCESS_DISABLED" }` if false.
     - Log all access attempts to Output channel with timestamp, query hash (first 8 chars of SHA-256), and result count.
     - **No per-extension filtering**: VS Code command API does not expose caller identity, so all extensions are trusted when access is enabled.
   - **Acceptance**: Disabled setting blocks commands; all attempts logged; workspace-global model enforced.

3. **Create Settings UI Documentation** (in `extension/README.md`)
   - Add section "Agent Integration Configuration".
   - **Prominently warn**: "Enabling agent access grants ALL extensions in the workspace access to Cognee memories. VS Code does not identify calling extensions, so you must trust all installed extensions."
   - Explain when to enable (multi-agent workflows, custom agent development).
   - Explain when NOT to enable (untrusted extensions installed, sensitive workspace data).
   - Document concurrency and rate limit settings.
   - **Acceptance**: README includes clear warning; users understand workspace-global access model.

**Owner**: Implementer  
**Dependencies**: Milestone 2 (commands must exist to enforce access control)  
**Validation**: Settings control command access; tests confirm blocking when disabled; workspace-global model documented and warned.

---

### Milestone 4: Update `@cognee-memory` Participant to Use Provider

**Objective**: Refactor participant to use shared `CogneeContextProvider` instead of directly calling `CogneeClient.retrieve`.

**Tasks**:

1. **Refactor Participant Retrieval Logic** (`extension/src/cogneeParticipant.ts`)
   - Replace direct `CogneeClient.retrieve` calls with `CogneeContextProvider.retrieveContext`.
   - Parse `CogneeContextResponse` entries into markdown for streaming.
   - Maintain existing transparency behavior (display full summaries, metadata if available).
   - **Acceptance**: Participant behavior unchanged from user perspective; uses shared provider.

2. **Add Participant-Specific Enhancements**
   - If `CogneeContextEntry` includes metadata (`topicId`, `planId`, `score`), display it inline:
     - Example: `**Memory from Plan 014** (Relevance: 0.87, Created: 2025-11-15)`
   - **Graceful Degradation**: With only Plan 014 complete (structured summaries but no Plan 015 ranking), metadata fields like `score` may be null/undefined and ranking may use basic recency heuristics. The participant should display available fields and omit missing ones without error. Full scoring and status-aware filtering require Plan 015.
   - Allow user to request "show metadata" for detailed inspection.
   - **Acceptance**: Participant shows richer context when metadata available (Plan 015 complete); degrades gracefully when only Plan 014 summaries exist.

3. **Update Participant Tests**
   - Mock `CogneeContextProvider` in participant unit tests.
   - Verify participant correctly formats and streams `CogneeContextResponse` entries.
   - **Acceptance**: All participant tests pass; no regressions.

**Owner**: Implementer  
**Dependencies**: Milestone 1 (`CogneeContextProvider`)  
**Validation**: Participant uses provider; existing functionality preserved; tests pass.

---

### Milestone 5: Transparency UX Indicators

**Objective**: Show users when agents use Cognee via Cognee-controlled surfaces (Output channel, status bar). In-chat annotations require agent cooperation and are out of scope.

**Tasks**:

1. **Add Memory Usage Logging to Output Channel**
   - When any agent (participant or external) uses `retrieveForAgent`, log structured entry:
     - Timestamp
     - Query hash (first 8 chars of SHA-256 for privacy)
     - Result count
     - Token usage
     - Whether rate limit or concurrency limit was applied
   - Include prominent header: `[Agent Access] <timestamp> - Query: <hash> - Results: <count>`
   - **Architectural Constraint**: Cognee cannot inject annotations into third-party agent responses; only the responding agent controls chat output.
   - **Acceptance**: Output channel logs all agent retrieval attempts with structured format; logs are detailed enough for QA debugging.

2. **Status Bar Indicator for Agent Activity**
   - Add status bar item showing "Cognee Agent Access: Enabled" when `agentAccess.enabled` is true.
   - Change icon/color when an agent retrieval is in progress.
   - Click behavior: Opens Output channel to show recent agent queries.
   - **Acceptance**: Status bar reflects agent access state; users can inspect activity.

3. **Document Transparency Features**
   - Update README to explain transparency indicators (Output channel, status bar).
   - Show screenshots of Output channel logs and status bar.
   - **Clarify limitation**: "Cognee logs all agent access but cannot modify other agents' chat responses. If you want agents to acknowledge when they use Cognee, configure the agent directly (if supported)."
   - Emphasize that users always have visibility via Cognee's own surfaces.
   - **Acceptance**: README documents transparency features; users understand Cognee's visibility boundaries.

**Owner**: Implementer  
**Dependencies**: Milestones 2-4 (commands and provider must be operational)  
**Validation**: Output logs capture agent activity; status bar indicator works; documentation complete.

---

### Milestone 6: Testing and QA

**Objective**: Validate agent integration across scenarios; ensure privacy and access controls work.

**Tasks**:

1. **Create Reference Test Agent Extension** (`test-agent/`)
   - Build minimal VS Code extension that calls `cogneeMemory.retrieveForAgent`.
   - Test cases:
     - Query with valid request → receives structured response.
     - Query when `agentAccess.enabled = false` → receives error `ACCESS_DISABLED`.
     - Rapid queries exceeding rate limit → receives error `RATE_LIMIT_EXCEEDED`.
     - Concurrent queries exceeding max → subsequent requests queued or rejected.
   - Verify response parsing and token limits.
   - **CI Integration**: The test agent is intended as both a reference implementation for third-party developers AND an automated test fixture. Where practical, wire it into VS Code integration tests to validate command contracts. If CI integration proves complex, document manual test procedures for QA and treat automated integration as future work.
   - **Acceptance**: Test agent successfully integrates; all access control and rate limit tests pass; CI integration status documented.

2. **Unit Tests for `CogneeContextProvider`**
   - Mock `CogneeClient` responses (with and without metadata).
   - Verify token budget enforcement.
   - Verify max results limiting.
   - Verify fallback when bridge returns plain text only.
   - **Acceptance**: Provider unit tests cover all branches; 100% coverage.

3. **Integration Tests for Commands**
   - Test `retrieveForAgent` command:
     - Valid request → structured response.
     - Invalid JSON → error response `INVALID_REQUEST`.
     - Disabled setting → error response `ACCESS_DISABLED`.
     - Rate limit exceeded → error response `RATE_LIMIT_EXCEEDED`.
     - Concurrency limit exceeded → request queued or error `QUEUE_FULL`.
     - Bridge timeout → error response `BRIDGE_TIMEOUT`.
   - **Acceptance**: Command integration tests pass; all error codes verified.

4. **End-to-End Scenario Tests**
   - Scenario: User enables agent access → agent queries Cognee → user inspects Output channel log → status bar shows activity.
   - Scenario: User disables agent access → agent call blocked → error `ACCESS_DISABLED` returned and logged.
   - Scenario: Agent retrieves structured summaries (requires Plan 014 bridge) → agent parses metadata fields.
   - Scenario: Multiple agents query concurrently → concurrency limit enforced → requests queued or rejected.
   - **Acceptance**: E2E tests cover happy path and key error/limit cases.

5. **QA Validation**
   - QA installs extension + test agent.
   - Verifies commands work as documented.
   - Tests all configuration combinations.
   - Confirms transparency indicators appear.
   - Documents any issues in `qa/016-agent-integration-qa.md`.
   - **Acceptance**: QA sign-off; no P0/P1 issues remain.

**Owner**: QA + Implementer  
**Dependencies**: All previous milestones  
**Validation**: All tests pass; QA approves; test agent demonstrates integration.

---

### Milestone 7: Update Version and Release Artifacts

**Objective**: Update project version to v0.3.1 (or v0.4.0) and document changes for roadmap alignment.

**Tasks**:

1. **Update Version in `extension/package.json`**
   - Increment version to `0.3.1` (or `0.4.0` if parallel to Plan 015).
   - Ensure 3-part semantic versioning (X.Y.Z format, required by VS Code Marketplace).
   - **Acceptance**: `package.json` version updated.

2. **Add CHANGELOG Entry**
   - Document Plan 016 deliverables under v0.3.1 section:
     - Agent integration command (`retrieveForAgent` only; `summarizeForAgent` deferred to future bridge-based implementation).
     - `CogneeContextProvider` service with concurrency/rate limiting.
     - Workspace-global agent access configuration (`agentAccess.enabled` with privacy warnings; no per-extension allowList).
     - Transparency indicators (Output logs, status bar) showing agent activity.
     - Reference test agent and integration documentation (`AGENT_INTEGRATION.md`).
   - **Acceptance**: CHANGELOG reflects approved Plan 016 scope only; deferred features not mentioned.

3. **Update README for Agent Integration**
   - Add "For Agent Developers" section linking to `AGENT_INTEGRATION.md`.
   - Highlight that Cognee can now serve as a context provider for arbitrary VS Code agents.
   - **Acceptance**: README markets agent integration capability.

4. **Commit Version Changes**
   - Commit with message: `"Release v0.3.1 - Plan 016: Agent Integration Platform"`
   - Tag release: `git tag v0.3.1`
   - **Acceptance**: Version artifacts committed and tagged.

**Owner**: Implementer  
**Dependencies**: All implementation milestones complete  
**Validation**: Version artifacts updated; release ready for packaging.

---

## Testing Strategy

- **Unit Tests**: `CogneeContextProvider`, command handlers, access control logic, response formatting.
- **Integration Tests**: Commands callable from test extension; bridge integration via mocked `CogneeClient`.
- **End-to-End Tests**: Full workflow with test agent; user sees transparency indicators; configuration changes respected.
- **QA Scenarios**: Reference test agent demonstrates integration; all configuration combinations tested; documentation validated.

**Coverage Expectations**:
- Unit: 90%+ for new provider and command code.
- Integration: All public commands covered.
- E2E: Happy path + key error cases (disabled access, invalid requests).

**Critical Validation Scenarios**:
1. Agent retrieves context successfully when enabled (receives structured schema from bridge).
2. Agent blocked when `agentAccess.enabled = false` (error `ACCESS_DISABLED`).
3. Rate limit enforced (error `RATE_LIMIT_EXCEEDED` after threshold).
4. Concurrency limit enforced (requests queued or rejected when max exceeded).
5. User sees detailed Output logs and status bar indicators for all agent activity.
6. Participant continues to work unchanged (uses same `CogneeContextProvider`).
7. Metadata-rich responses (from Plan 014 bridge) include all structured fields (`topicId`, `planId`, etc.).

---

## Validation

**Acceptance Criteria**:
- ✅ **Milestone 0**: Bridge contract verified; Plan 014 migration complete; structured schema documented.
- ✅ `CogneeContextProvider` service implemented with concurrency/rate limiting.
- ✅ `cogneeMemory.retrieveForAgent` command callable by arbitrary extensions.
- ✅ Agent access configuration (`agentAccess.enabled`) functional; workspace-global model enforced.
- ✅ `@cognee-memory` participant refactored to use shared provider.
- ✅ Transparency indicators (Output logs, status bar) show all agent activity via Cognee surfaces.
- ✅ Reference test agent successfully integrates and retrieves structured context.
- ✅ Documentation (`AGENT_INTEGRATION.md`, README) complete with workspace-global access warnings.
- ✅ All tests pass (unit, integration, E2E); rate/concurrency limits validated.
- ✅ QA validation complete; no P0/P1 blockers.
- ✅ Version artifacts updated; CHANGELOG documents Plan 016.

**Sign-off**: QA + Architect review; Critic approval before implementation begins.

---

## Risks

1. **Bridge Migration Blocking**
   - Risk: Plan 014 bridge migration incomplete; structured schema not available.
   - Mitigation: Milestone 0 verifies contract before implementation proceeds; escalate to planner if blocked.
   - **Impact**: If bridge not ready, entire plan is blocked—no degraded fallback to string parsing.

2. **Workspace-Global Access Model**
   - Risk: Users may not understand that enabling access grants ALL extensions memory access.
   - Mitigation: Prominent warnings in settings UI and README; default disabled; clear documentation of trust model.

3. **Transparency Indicator Feasibility**
   - Risk: VS Code Chat API may not support injecting annotations into agent responses.
   - Mitigation: Prioritize Output channel logs and status bar; treat in-chat annotation as stretch goal.

4. **Third-Party Agent Adoption**
   - Risk: No third-party agents adopt integration initially; feature unused.
   - Mitigation: Create compelling reference agent; document use cases in README; engage with VS Code agent developer community.

5. **Privacy Perception**
   - Risk: Users fear agents access memories without consent.
   - Mitigation: Default `agentAccess.enabled = false`; require explicit opt-in; emphasize transparency indicators and local-only storage.

---

## Open Questions

### Resolved per Architectural Review

1. **Copilot-Specific Hooks**: Are there Copilot APIs for registering Cognee as a native "context provider"?
   - **Resolution**: Defer to future enhancement; command-based integration sufficient for v0.3.1.

2. **Rate Limiting**: Should agent retrieval be rate-limited?
   - **Resolution**: YES—implemented in `CogneeContextProvider` (10 requests/minute default, configurable, clamped to max 30).

3. **Caller Identification**: Can VS Code expose calling extension ID?
   - **Resolution**: NO—VS Code command API does not expose caller metadata. Workspace-global access model adopted; users must trust all extensions.

4. **Multi-Agent Coordination**: Do we need deduplication for concurrent requests?
   - **Resolution**: Concurrency limiting (max 2 in-flight default, clamped to max 5) prevents subprocess fan-out; no deduplication needed.

5. **Ranking Layer Placement**: Should `CogneeContextProvider` perform ranking locally or rely on bridge?
   - **Resolution**: Rely on bridge (Plan 014/015 deliver scored results); provider applies token limits but does not re-rank.

6. **Empty Result Behavior**: What happens when no memories match?
   - **Resolution**: Return structured response `{ entries: [], totalResults: 0, tokensUsed: 0 }` (not an exception); agents handle gracefully.

### Added per Critique Review (2025-11-17)

7. **Milestone 0 Ownership**: If bridge contract verification fails, is Plan 016 paused entirely or can implementers contribute to bridge work?
   - **Resolution**: Plan 016 implementation STOPS if Milestone 0 fails; implementers escalate to Plan 014 bridge owner. No fallback parsing or bridge modifications allowed under Plan 016 scope without formal re-scoping and architect approval.

8. **Error Taxonomy Status**: Are Plan 016 error codes provisional or canonical for the global error taxonomy?
   - **Resolution**: These codes are aligned with roadmap Epic 0.2.3.1 error taxonomy work and represent the agent-integration subset. They may be harmonized with other error sources in future plans but are considered stable for agent API consumers.

9. **API Versioning**: Should `CogneeContextResponse` include a `schemaVersion` field from the start?
   - **Resolution**: Document forward-compatibility policy (fields may be added but not removed); reserve `schemaVersion` as optional future enhancement. For initial release, compatibility is enforced by policy rather than explicit versioning field.

10. **Settings Upper Bounds**: Are there architect-mandated limits for `maxConcurrentRequests` and `rateLimitPerMinute`?
    - **Resolution**: YES—provider enforces safe upper bounds (max 5 concurrent, max 30/minute) regardless of user settings, logging warnings when clamping occurs.

11. **Test Agent CI Role**: Should the reference test agent be wired into automated CI tests or remain a manual QA tool?
    - **Resolution**: Intended for both; wire into CI where practical, document manual procedures if CI integration deferred. Automation status documented as part of QA deliverables.

---

## References

- `agent-output/analysis/016-autonomous-agent-retrieval-and-integration-analysis.md`
- `agent-output/architecture/016-autonomous-agent-retrieval-and-integration-architecture-findings.md` (Architectural Review)
- `agent-output/architecture/system-architecture.md`
- `agent-output/roadmap/product-roadmap.md`
- `agent-output/planning/014-chat-summary-creation-and-retrieval.md`
- `agent-output/planning/015-metadata-ranking-and-compaction.md`
- VS Code Extension API: https://code.visualstudio.com/api/references/vscode-api
- VS Code Chat API: https://code.visualstudio.com/api/extension-guides/chat
