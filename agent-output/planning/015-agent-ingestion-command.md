# Plan 015: Agent Ingestion Command

**Plan ID**: 015
**Target Release**: v0.3.1
**Created**: 2025-11-18
**Updated**: 2025-11-19
**Status**: Draft (Pending Critic Review)
**Epic Alignment**: Epic 0.3.0.3 - Agent-Driven Memory Integration
**Blocks**: Plan 016 (retrieval requires ingestion for round-trip validation)
**Related Analysis**: `analysis/016-autonomous-agent-retrieval-and-integration-analysis.md` (shared with Plan 016)
**Related Architecture**: `architecture/system-architecture.md` §3.1, §4.5, §9 (Agent-Driven Memory Surface decision)
**Dependency Note**: ✅ **Plan 014.1 COMPLETE** - Validated `languageModelTools` as primary Copilot integration path; implementation uses tool entry command proxying into internal commands

---

## Value Statement and Business Objective

As a GitHub Copilot agent (@workspace, @terminal, etc.) working in VS Code,
I want to store structured summaries of my conversations with the user directly into Cognee Chat Memory,
So that I can build continuity across sessions without requiring manual capture commands or a separate memory participant.

**Success Criteria**:
- Copilot agents can invoke a public command to ingest structured summaries (Plan 014 schema) into Cognee.
- Ingestion follows the same bridge path and ontology wiring as manual capture, ensuring storage isolation and metadata consistency.
- Users see transparent audit logs showing which agents wrote memories, when, and what topics they covered.
- Third-party VS Code extensions can also use the ingestion API for custom agent workflows.

---

## Objective

Implement the **agent ingestion command** to enable autonomous memory writes:

1. Expose VS Code command `cogneeMemory.ingestForAgent` that accepts JSON payloads matching Plan 014's structured summary schema (Topic, Context, Decisions, Rationale, etc.) plus metadata (topic_id, session_id, plan_id, status, timestamps).
2. Validate schema conformance and workspace access settings before invoking the bridge.
3. Call `ingest.py --summary --summary-json` with structured payloads, leveraging enriched-text fallback until Cognee exposes DataPoint APIs.
4. Enforce workspace-global access model (default disabled) with audit logging for all agent-initiated ingestion.
5. Provide clear error codes (`ACCESS_DISABLED`, `INVALID_PAYLOAD`, `BRIDGE_TIMEOUT`, etc.) so agents can surface actionable feedback to users.

**Dependencies**:
- ✅ **RESOLVED**: Plan 014.1 validated `languageModelTools` as the Copilot integration surface. Implementation MUST use a language model tool contribution (e.g., `cognee.storeMemory`) routed to an internal tool-entry command (`cognee.internalToolEntry`), which in turn forwards to `cogneeMemory.ingestForAgent` inside the Cognee Chat Memory extension.
- **REQUIRED**: Plan 014 bridge migration (structured ingestion via `ingest.py --summary`) must be complete. Without this, there is no structured summary ingestion path.
- **RECOMMENDED**: Plan 016 retrieval command should be delivered in parallel, as ingestion without retrieval provides minimal value.

**Out of Scope**:
- Retrieval logic (handled by Plan 016).
- @cognee-memory participant summarization (removed from Plan 014; agent-driven summarization replaces it).
- Cross-workspace or cloud-based memory sync (deferred to Epic 0.4.0).

---

## Assumptions

1. **Plan 014 Bridge Complete**: `ingest.py --summary --summary-json` accepts structured JSON payloads matching the Plan 014 schema and persists them via enriched-text fallback (embedded metadata in markdown).
2. **Tool-Based Integration Surface is Fixed**: Plan 014.1 has already selected `languageModelTools` as the Copilot-facing surface. This plan MUST implement ingestion via a language model tool entry point contributed by the Cognee Chat Memory extension; it MUST NOT introduce alternative primary paths (direct `executeCommand` from Copilot or MCP) as part of this scope.
3. **Workspace-Global Access Model**: When `cogneeMemory.agentAccess.enabled` is true, all extensions in the workspace can ingest memories. VS Code does not expose caller identity, so per-extension allow-lists are not feasible.
4. **Audit Logging Suffices for Transparency**: Users can inspect the Output channel and `.cognee/agent_audit.log` to see all agent-initiated writes. In-chat annotations are not possible without agent cooperation.
5. **Schema Validation in TypeScript**: Command handler validates JSON structure before invoking bridge, providing fast-fail feedback to agents.

---

## Plan

### Milestone 0: Verify Plan 014 Bridge Ingestion Contract (Precondition)

**Objective**: Confirm Plan 014's structured summary ingestion path is complete and documented before exposing agent commands.

**Tasks**:

1. **Verify `ingest.py --summary` Works**
   - Run integration test calling `ingest.py --summary --summary-json <payload>` with a valid Plan 014 summary.
   - Confirm enriched-text rendering includes metadata block (topic_id, session_id, plan_id, status, timestamps).
   - Verify Cognee persists the enriched text without errors.
   - **Acceptance**: Ingestion succeeds; enriched metadata visible in storage; bridge contract documented.

2. **Retrieve Test Summary**
   - Call `retrieve.py` with a query matching the test summary's topic.
   - Confirm response includes structured fields parsed from enriched text.
   - **Acceptance**: Round-trip validation passes (ingest → retrieve → verify content matches).

3. **Document Ingestion Contract**
   - Update `extension/bridge/INGEST_CONTRACT.md` with:
     - JSON schema for structured summary payloads (fields, types, required/optional).
     - Example payload demonstrating all Plan 014 sections (Topic, Context, Decisions, Rationale, etc.).
     - Error codes emitted by `ingest.py` (INVALID_JSON, MISSING_REQUIRED_FIELD, BRIDGE_TIMEOUT, etc.).
   - **Acceptance**: Contract documented; serves as reference for TypeScript validation and agent developers.

4. **Decision: Proceed or Block**
   - If bridge ingestion works and contract is documented: proceed to Milestone 1.
   - If Plan 014 bridge migration is incomplete: **STOP IMPLEMENTATION** and escalate to planner/architect.
   - **Acceptance**: Clear go/no-go decision made; no workarounds or silent degradation.

**Owner**: Implementer + QA
**Dependencies**: Plan 014 bridge migration
**Validation**: Bridge contract test passes; ingestion round-trip verified; contract documented.

---

### Milestone 1: Define TypeScript Schema and Validation

**Objective**: Create TypeScript interfaces and validation logic for agent ingestion payloads.

**Tasks**:

1. **Define TypeScript Interfaces** (`extension/src/types/agentIntegration.ts`)
   - `CogneeIngestRequest`:
     ```ts
     {
       topic: string;
       context: string;
       decisions?: string[];
       rationale?: string[];
       openQuestions?: string[];
       nextSteps?: string[];
       references?: string[];
       timeScope?: string;
       metadata?: {
         topic_id?: string;
         session_id?: string;
         plan_id?: string;
         status?: 'Active' | 'Superseded' | 'DecisionRecord';
         created_at?: string; // ISO 8601
       };
       agentName?: string; // Optional caller hint for audit logs
     }
     ```
   - `CogneeIngestResponse`:
     ```ts
     {
       success: boolean;
       summary_id?: string; // Generated if not provided
       error?: string;
       errorCode?: string; // ACCESS_DISABLED, INVALID_PAYLOAD, etc.
     }
     ```
   - **Acceptance**: Interfaces exported and documented with TSDoc comments.

2. **Implement Validation Helper** (`extension/src/validation/summaryValidator.ts`)
   - Function: `validateIngestRequest(payload: unknown): { valid: boolean; errors: string[] }`
   - Validate:
     - Required fields: `topic`, `context` (both non-empty strings).
     - Optional fields: arrays of strings (decisions, rationale, etc.).
     - Metadata: valid status enum, ISO 8601 timestamps if provided.
   - Return structured error messages if validation fails.
   - **Acceptance**: Validation function exported; unit tests cover all validation branches.

3. **Schema Documentation**
   - Add examples to `extension/AGENT_INTEGRATION.md`:
     - Minimal valid payload (topic + context only).
     - Full payload with all sections and metadata.
     - Invalid payloads with expected error messages.
   - **Acceptance**: Documentation provides clear guidance for agent developers.

**Owner**: Implementer
**Dependencies**: Milestone 0 (bridge contract documented)
**Validation**: Validation helper unit tests pass; schema documented.

---

### Milestone 2: Implement `cogneeMemory.ingestForAgent` Command

**Objective**: Expose public VS Code command for agent ingestion with access control and audit logging.

**Tasks**:

1. **Implement Command Handler** (`extension/src/commands/ingestForAgent.ts`)
   - Signature: `(requestJson: string) => Promise<string>`
   - Parse `requestJson` into `CogneeIngestRequest`.
   - Validate schema using `summaryValidator`; return error `{ error: "Invalid payload", code: "INVALID_PAYLOAD", errors: [...] }` if validation fails.
   - Check `cogneeMemory.agentAccess.enabled` setting; return error `{ error: "Agent access disabled", code: "ACCESS_DISABLED" }` if false.
   - Generate missing IDs (topic_id, session_id) if not provided; default `status` to `'Active'`, `created_at` to current timestamp.
   - Call `CogneeClient.ingestSummary(payload)` (new method wrapping `ingest.py --summary --summary-json`).
   - Log ingestion attempt to Output channel: `[Agent Ingest] <timestamp> - Agent: <agentName> - Topic: <topic> - Status: <success/error>`.
   - Append structured log entry to `.cognee/agent_audit.log`: `{ timestamp, command: "ingestForAgent", agentName, topicDigest, result, errorCode }`.
   - Return JSON response: `CogneeIngestResponse`.
   - **Acceptance**: Command callable from other extensions; returns valid JSON; access control enforced; audit logs created.

2. **Extend `CogneeClient` Class** (`extension/src/cogneeClient.ts`)
   - Add method: `ingestSummary(payload: CogneeIngestRequest): Promise<{ success: boolean; summary_id?: string; error?: string }>`
   - Serialize payload to JSON.
   - Invoke `python ingest.py --summary --summary-json '<json>'` via subprocess.
   - Parse bridge response; handle errors (`INVALID_JSON`, `MISSING_REQUIRED_FIELD`, `BRIDGE_TIMEOUT`, etc.).
   - Return structured result to command handler.
   - **Acceptance**: Method integrated; handles success and error cases; unit tests with mocked subprocess.

3. **Register Command in `package.json`**
   - Add command entry:
     ```json
     {
       "command": "cogneeMemory.ingestForAgent",
       "title": "Ingest Summary for Agent",
       "enablement": "cogneeMemory.enabled"
     }
     ```
   - Mark as **internal command** (no UI menu entry; only callable via `vscode.commands.executeCommand`).
   - **Acceptance**: Command registered; discoverable via VS Code API.

4. **Document API in `AGENT_INTEGRATION.md`**
   - Add section "Ingesting Memories from Agents".
   - Document:
     - Command signature and JSON schema.
     - Example usage from agent extension.
     - Configuration requirement (`agentAccess.enabled`).
     - Error codes and troubleshooting.
   - Example code snippet:
     ```ts
     const payload = {
       topic: "Plan 015 Implementation Strategy",
       context: "User discussed agent ingestion command design with architect.",
       decisions: ["Use VS Code commands as primary surface", "Pivot to MCP if command invocation fails"],
       metadata: { plan_id: "015", status: "Active" }
     };
     const resJson = await vscode.commands.executeCommand<string>(
       "cogneeMemory.ingestForAgent",
       JSON.stringify(payload)
     );
     const res = JSON.parse(resJson) as CogneeIngestResponse;
     ```
   - **Acceptance**: Documentation clear and actionable; example code runs successfully.

**Owner**: Implementer
**Dependencies**: Milestone 1 (TypeScript schema and validation)
**Validation**: Command callable from test extension; access control works; audit logs created; documentation complete.

---

### Milestone 3: Add Agent Access Configuration

**Objective**: Provide user controls for enabling/disabling workspace-global agent ingestion with prominent privacy warnings.

**Tasks**:

1. **Add Settings to `package.json`**
   ```json
   "cogneeMemory.agentAccess.enabled": {
     "type": "boolean",
     "default": false,
     "markdownDescription": "⚠️ **WARNING**: When enabled, ALL extensions in this workspace can write memories to Cognee. VS Code does not identify calling extensions, so per-extension access control is not possible. Only enable if you trust all installed extensions. See [Agent Integration docs](./AGENT_INTEGRATION.md) for details."
   }
   ```
   - **Acceptance**: Setting visible in VS Code settings UI; warning prominent.

2. **Implement Access Control in Command Handler**
   - In `ingestForAgent`:
     - Check `cogneeMemory.agentAccess.enabled`; return error `{ error: "Agent access disabled", code: "ACCESS_DISABLED" }` if false.
     - Log all ingestion attempts (success and blocked) to Output channel.
     - **No per-extension filtering**: All extensions are trusted when access is enabled.
   - **Acceptance**: Disabled setting blocks commands; all attempts logged.

3. **Update README with Privacy Guidance**
   - Add section "Agent Integration Configuration".
   - **Prominently warn**: "Enabling agent access grants ALL extensions in the workspace the ability to write memories to Cognee. VS Code does not identify calling extensions, so you must trust all installed extensions."
   - Explain when to enable (multi-agent workflows, custom agent development, trusted workspace).
   - Explain when NOT to enable (untrusted extensions, sensitive workspace data).
   - **Acceptance**: README includes clear warning; users understand workspace-global access model.

4. **Status Bar Indicator for Agent Access**
   - Add status bar item: "Cognee Agent Access: Enabled" when `agentAccess.enabled` is true.
   - Icon changes when ingestion is in progress (spinner).
   - Click behavior: Opens Output channel to show recent agent activity.
   - **Acceptance**: Status bar reflects agent access state; users can inspect activity.

**Owner**: Implementer
**Dependencies**: Milestone 2 (command must exist to enforce access control)
**Validation**: Settings control command access; tests confirm blocking when disabled; workspace-global model documented and warned.

---

### Milestone 4: Testing and QA

**Objective**: Validate agent ingestion across scenarios; ensure schema validation, access controls, and audit logging work.

**Tasks**:

1. **Create Reference Test Agent Extension** (`test-agent/`)
   - Build minimal VS Code extension that calls `cogneeMemory.ingestForAgent`.
   - Test cases:
     - Valid payload (all fields) → success response.
     - Minimal payload (topic + context only) → success with generated IDs.
     - Invalid payload (missing required field) → error `INVALID_PAYLOAD`.
     - Access disabled → error `ACCESS_DISABLED`.
     - Bridge timeout → error `BRIDGE_TIMEOUT`.
   - Verify response parsing and audit logs.
   - **CI Integration**: Wire test agent into VS Code integration tests where practical; document manual test procedures as fallback.
   - **Acceptance**: Test agent successfully integrates; all validation and error tests pass.

2. **Unit Tests for Validation and Command Logic**
   - Test `summaryValidator`:
     - Valid payloads pass.
     - Missing required fields fail with clear errors.
     - Invalid metadata (bad status enum, malformed timestamps) fails.
   - Test `ingestForAgent` command:
     - Valid request → calls `CogneeClient.ingestSummary`.
     - Disabled setting → returns error without calling bridge.
     - Audit logs created for all cases.
   - **Acceptance**: Unit tests cover all validation/command branches; 100% coverage.

3. **Integration Tests with Bridge**
   - Test `CogneeClient.ingestSummary`:
     - Valid payload → bridge returns success with summary_id.
     - Invalid JSON → bridge returns error `INVALID_JSON`.
     - Bridge timeout → error `BRIDGE_TIMEOUT`.
   - Verify round-trip: ingest summary → retrieve it via Plan 016 command → verify content matches.
   - **Acceptance**: Integration tests pass; bridge contract verified.

4. **End-to-End Scenario Tests**
   - Scenario: User enables agent access → agent ingests summary → user inspects Output logs and audit file → status bar shows activity.
   - Scenario: User disables agent access → agent call blocked → error `ACCESS_DISABLED` returned and logged.
   - Scenario: Agent ingests summary → retrieves it via Plan 016 → verifies structured fields match.
   - **Acceptance**: E2E tests cover happy path and key error cases.

5. **QA Validation**
   - QA installs extension + test agent.
   - Verifies commands work as documented.
   - Tests all configuration combinations.
   - Confirms audit logs and status bar indicators appear.
   - Documents any issues in `qa/015-agent-ingestion-command-qa.md`.
   - **Acceptance**: QA sign-off; no P0/P1 issues remain.

**Owner**: QA + Implementer
**Dependencies**: All previous milestones
**Validation**: All tests pass; QA approves; test agent demonstrates integration.

---

### Milestone 5: Update Version and Release Artifacts

**Objective**: Update project version to v0.3.1 and document changes for roadmap alignment.

**Tasks**:

1. **Update Version in `extension/package.json`**
   - Increment version to `0.3.1` (3-part semantic versioning required by VS Code Marketplace).
   - **Acceptance**: `package.json` version updated.

2. **Add CHANGELOG Entry**
   - Document Plan 015 deliverables under v0.3.1 section:
     - Agent ingestion command (`ingestForAgent`) for structured summaries.
     - Workspace-global agent access configuration with privacy warnings.
     - Schema validation and audit logging.
     - Reference test agent demonstrating API usage.
   - **Acceptance**: CHANGELOG reflects Plan 015 scope.

3. **Update README**
   - Add "For Agent Developers" section linking to `AGENT_INTEGRATION.md`.
   - Highlight that agents can now write memories directly to Cognee.
   - **Acceptance**: README markets agent ingestion capability.

4. **Commit Version Changes**
   - Commit with message: `"Release v0.3.1 - Plan 015: Agent Ingestion Command"`
   - Tag release: `git tag v0.3.1`
   - **Acceptance**: Version artifacts committed and tagged.

**Owner**: Implementer
**Dependencies**: All implementation milestones complete
**Validation**: Version artifacts updated; release ready for packaging.

---

## Testing Strategy

- **Unit Tests**: `summaryValidator`, `ingestForAgent` command handler, `CogneeClient.ingestSummary`, access control logic.
- **Integration Tests**: Bridge contract validation (ingest → verify persistence), round-trip with Plan 016 retrieval.
- **End-to-End Tests**: Full workflow with test agent; audit logs and status bar indicators verified; configuration changes respected.
- **QA Scenarios**: Reference test agent demonstrates ingestion; all configuration combinations tested; documentation validated.

**Coverage Expectations**:
- Unit: 90%+ for new command and validation code.
- Integration: All bridge contracts covered.
- E2E: Happy path + key error cases (disabled access, invalid payloads).

**Critical Validation Scenarios**:
1. Agent ingests valid summary → success response with summary_id.
2. Agent ingests summary with minimal fields → success with generated IDs.
3. Agent blocked when `agentAccess.enabled = false` → error `ACCESS_DISABLED`.
4. Invalid payload rejected by schema validation → error `INVALID_PAYLOAD` with field details.
5. User sees detailed Output logs and audit file for all agent activity.
6. Round-trip: Agent ingests summary → retrieves it via Plan 016 → verifies content matches.

---

## Validation

**Acceptance Criteria**:
- ✅ **Milestone 0**: Plan 014 bridge ingestion verified; contract documented.
- ✅ TypeScript schema and validation logic implemented.
- ✅ `cogneeMemory.ingestForAgent` command callable by arbitrary extensions.
- ✅ Agent access configuration (`agentAccess.enabled`) functional; workspace-global model enforced.
- ✅ Audit logging (Output channel + `.cognee/agent_audit.log`) captures all ingestion attempts.
- ✅ Status bar indicator shows agent access state.
- ✅ Reference test agent successfully integrates and validates API.
- ✅ Documentation (`AGENT_INTEGRATION.md`, README) complete with workspace-global access warnings.
- ✅ All tests pass (unit, integration, E2E); QA validation complete; no P0/P1 blockers.
- ✅ Version artifacts updated; CHANGELOG documents Plan 015.

**Feasibility Contingency**:
- This plan does **not** define any fallback away from the tool-based integration surface. If future platform changes invalidate the `languageModelTools` approach, a separate follow-on plan must be created to define and validate an alternative path (e.g., MCP), and architecture documents must be updated accordingly.

**Sign-off**: QA + Architect review; Critic approval before implementation begins.

---

## Risks

1. **Plan 014 Bridge Migration Blocking**
   - Risk: Structured summary ingestion not ready; bridge doesn't support `--summary` flag.
   - Mitigation: Milestone 0 verifies contract before implementation proceeds; escalate to planner if blocked.
   - **Impact**: If bridge not ready, entire plan is blocked—no degraded fallback.

2. **Plan 019 Feasibility Determines Implementation Path**
   - Risk: VS Code command invocation may not be accessible to Copilot agents.
   - Mitigation: Plan 019 validates command invocation before Plans 015/016 ship. If commands fail, pivot to MCP server tools with same provider backend.
   - **Impact**: Implementation path changes but business logic (validation, audit, access control) remains consistent.

3. **Workspace-Global Access Model**
   - Risk: Users may not understand that enabling access grants ALL extensions memory write access.
   - Mitigation: Prominent warnings in settings UI and README; default disabled; clear documentation of trust model.

4. **Schema Validation Complexity**
   - Risk: Complex validation logic may have bugs or miss edge cases.
   - Mitigation: Comprehensive unit tests; validation errors include field-specific messages to aid debugging.

5. **Audit Log Privacy**
   - Risk: Audit logs may inadvertently leak sensitive data (full topics, user queries).
   - Mitigation: Log only digests (first 8 chars of SHA-256 hash) for topics/queries; full text not stored in audit logs.

---

## Open Questions

### Resolved by Plan 014.1 Feasibility Analysis

1. **Command Invocation**: Can VS Code Copilot agents invoke extension commands via `vscode.commands.executeCommand`?
   - **Resolution**: See Plan 014.1 findings; implementation path documented in `test-extensions/FINDINGS.md`.
2. **Caller Identity**: Can we verify which agent is calling (for fine-grained authorization/logging)?
   - **Resolution**: See Plan 014.1 findings; authorization model documented.
3. **MCP Fallback**: If commands are inaccessible, what's the MCP connection/auth flow?
   - **Resolution**: See Plan 014.1 findings; MCP path tested if needed.
4. **Privacy Controls**: How do we communicate workspace-global access risks prominently enough to prevent misuse?
   - **Resolution**: Workspace-global model confirmed; prominent warnings required in settings UI.

### Implementation Details

5. **Default ID Generation**: Should `topic_id` be derived from `topic` (hash) or random UUID? → **Resolution pending architect input**.
6. **Status Bar Persistence**: Should status bar indicator persist across sessions or only show when access is actively used? → **Resolution: Show when enabled, update on activity**.

---

## References

- `agent-output/planning/014.1-agent-command-invocation-feasibility.md` (**BLOCKING** - determines implementation path)
- `test-extensions/FINDINGS.md` (from Plan 014.1 - technical constraints and example code)
- `agent-output/analysis/016-autonomous-agent-retrieval-and-integration-analysis.md` (shared analysis)
- `agent-output/architecture/system-architecture.md` (§3.1, §4.5, §9)
- `agent-output/roadmap/product-roadmap.md` (Epic 0.3.0.3)
- `agent-output/planning/014-chat-summary-creation-and-retrieval.md` (structured summary schema)
- `agent-output/planning/016-autonomous-agent-retrieval-and-integration.md` (retrieval counterpart)
- VS Code Extension API: https://code.visualstudio.com/api/references/vscode-api
