# Plan 016: Agent Retrieval and UI-Visible Extension Tools

**Plan ID**: 016
**Target Release**: v0.3.2  
**Created**: 2025-11-17
**Updated**: 2025-11-19 (Merged retrieval capabilities with UI-visible tools; Approved by Critic)
**Status**: Approved - Ready for Implementation
**Epic Alignment**: Epic 0.3.0.3 - Agent-Driven Memory Integration (completion)
**Related Plans**: Plan 015 (agent ingestion command - prerequisite)
**Related Analysis**: `analysis/016-autonomous-agent-retrieval-and-integration-analysis.md`
**Related Architecture**: `architecture/016-autonomous-agent-retrieval-and-integration-architecture-findings.md`, `architecture/system-architecture.md` §3.1, §4.5, §9

---

## Value Statement and Business Objective

As a VS Code user configuring custom agents,
I want to see "Cognee Memory" tools (Store Memory, Retrieve Memory) in the "Configure Tools" dialog with enable/disable toggles,
So that custom agents and GitHub Copilot can autonomously access workspace memory through the standard VS Code tools UI, making conversations richer and eliminating the need to manually reconstruct context.

**Success Criteria**:
- Tools appear in VS Code's "Configure Tools" dialog under "Cognee Memory" category
- Users can enable/disable individual tools (Store Memory, Retrieve Memory) via UI toggles
- Custom agents can reference tools using `#cogneeStoreSummary` and `#cogneeRetrieveMemory` in chat
- Custom agent `.agent.md` files can declare tools in `tools: ['cogneeStoreSummary', 'cogneeRetrieveMemory']` front-matter
- AI agents retrieve structured context (summaries, decisions, metadata) without requiring `@cognee-memory` participant
- Users see transparent indicators when agents use Cognee (Output logs, status bar)
- Third-party VS Code extensions can integrate via documented commands

---

## Objective

Implement **agent retrieval capabilities** and **UI-visible extension tools** for Cognee Chat Memory:

1. **Add UI visibility flags** to existing `cognee_storeMemory` tool from Plan 015:
   - `canBeReferencedInPrompt: true` (enables Configure Tools UI)
   - `toolReferenceName: "cogneeStoreSummary"` (user-facing reference name)
   - Icon selection for visual identity

2. **Implement `cognee_retrieveMemory` tool** as companion to ingestion:
   - Complete languageModelTools contribution in `package.json`
   - Implement `RetrieveMemoryTool` class with `LanguageModelTool` interface
   - Register tool dynamically based on `cogneeMemory.agentAccess.enabled` setting
   - Include UI visibility flags from the start

3. **Create `CogneeContextProvider` service** for structured retrieval:
   - Wrap `CogneeClient.retrieve` with agent-friendly responses
   - Enforce concurrency/rate limits
   - Return structured data (`CogneeContextEntry` with summaries, decisions, metadata)

4. **Expose internal command** `cogneeMemory.retrieveForAgent` that tools proxy to

5. **Update `@cognee-memory` participant** to use shared provider

6. **Add transparency indicators**: Output channel logs, status bar showing agent activity

**Dependencies**:
- **REQUIRED (BLOCKING)**: Plan 014 bridge migration must be complete before Milestone 1. The bridge must deliver structured `CogneeContextEntry` fields (`summaryText`, `decisions`, `topicId`, `planId`, `createdAt`, `score`) via `retrieve.py`. Without this, the provider will degrade to string parsing and recreate transparency issues.
- **REQUIRED (BLOCKING)**: Plan 015 agent ingestion command (`ingestForAgent`) must be complete before Milestone 1. Agents need the ability to write memories before retrieval can be meaningfully tested and validated.
- ✅ **RESOLVED**: Plan 014.1 **fixed** the agent integration surface to `languageModelTools` as the primary Copilot integration path:
  - Extension MUST contribute a language model tool (e.g., `cognee.retrieveMemory`) that routes to the internal tool-entry command `cognee.internalToolEntry`.
  - Tool entry command validates payloads, enforces `cogneeMemory.agentAccess.enabled` setting, and forwards to the internal command `cogneeMemory.retrieveForAgent`.
  - Direct command invocation (`executeCommand('cogneeMemory.retrieveForAgent', ...)`) is preserved ONLY as a convenience surface for non-Copilot VS Code extensions, not as an alternative Copilot integration design.
  - See `architecture/system-architecture.md` §4.5 and §9 (ADR: Copilot Tool Surface vs Direct Commands) for implementation guidance.
- **RECOMMENDED**: Plan 017 metadata and ranking infrastructure should be complete for optimal agent experience, but provider can start with Plan 014-level structured summaries and basic recency scoring.
- **PRECONDITION**: Contract tests must demonstrate bridge returns structured schema before public commands are exposed (see Milestone 0).

**Out of Scope**:

- MCP server integration (not required per user clarification - tools are extension-based)
- Built-in tool modifications (Microsoft-controlled)
- Deep changes to VS Code's chat API or new agent runtimes
- Cloud-based coordination or multi-user memory (deferred to Epic 0.4.0)
- Automatic background monitoring of all chat sessions (violates privacy model; only opt-in, request-scoped retrieval)
- Cross-workspace memory sync

---

## Assumptions

1. **VS Code 1.106+ API Available**: `canBeReferencedInPrompt` and `toolReferenceName` properties are supported in the version of VS Code we're targeting (these were introduced in 1.106). Implementation MUST update `package.json > engines.vscode` to `^1.106.0` or higher to prevent installation on incompatible VS Code versions.

2. **Plan 015 Tool Implementation is Correct**: The existing `cognee_storeMemory` tool implementation in `src/tools/storeMemoryTool.ts` is functionally complete; we're only adding UI visibility flags, not rewriting the tool logic.

3. **Plan 014 Bridge Migration Complete**: Bridge migration from Plan 014 is complete and verified; `retrieve.py` returns structured `CogneeContextEntry` fields (`summaryText`, `decisions`, `topicId`, `planId`, `createdAt`, `score`). This is a hard precondition—implementation cannot proceed without it.

4. **Retrieval Bridge Contract Exists**: `retrieve.py` accepts query parameters (query, maxResults) and returns structured results (JSON with topic, context, metadata fields). If contract is incomplete, Plan 016 implementation will document the expected contract and work with implementer to validate.

5. **Workspace-Global Access Model Persists**: Both tools share the same `cogneeMemory.agentAccess.enabled` opt-in setting. Enabling agent access exposes both store and retrieve tools; disabling hides both. Agent access is **disabled by default**; users must explicitly enable it. When enabled, **all extensions in the workspace** can access Cognee memories—VS Code does not expose caller extension IDs, so per-extension authorization is not feasible.

6. **Tool Registration Lifecycle**: Tools are registered/unregistered dynamically when the setting changes (already implemented for `storeMemory` in Plan 015; same pattern applies to `retrieveMemory`).

7. **Confirmation Messages Are Optional**: `prepareInvocation()` can return confirmation prompts, but agents may auto-approve depending on user trust settings. We should implement confirmations for transparency, but not rely on them for security.

8. **Workspace Isolation**: All retrieval remains workspace-scoped and local; no cross-workspace leakage.

9. **Transparency First**: Cognee logs all agent activity to Output channel and status bar. In-chat annotations require agent cooperation and are out of scope.

10. **Third-Party Agents**: Arbitrary VS Code extensions (not just Copilot) can call Cognee commands when access is enabled.

---

## Plan

### Milestone 0: Verify Bridge Contract (Precondition - Blocking)

**Objective**: Confirm Plan 014 bridge migration is complete and delivers structured metadata before proceeding with agent integration.

**Tasks**:

1. **Verify `retrieve.py` Returns Structured Schema**
   - Run existing bridge tests or create integration test that calls `retrieve.py` with a test query.
   - Confirm response includes structured fields: `summaryText`, `decisions`, `rationale`, `topicId`, `planId`, `createdAt`, `score`.
   - If bridge still returns plain text or inline "Metadata:" strings, implementation is **BLOCKED** until Plan 014 bridge migration completes.
   - **Architectural Note**: Per §4.4.1 of `system-architecture.md`, bridge currently uses enriched-text metadata fallback (embedded "Metadata:" blocks parsed via regex) until Cognee SDK exposes DataPoint APIs. Provider must handle both enriched-text and future native-metadata responses.
   - **Acceptance**: Bridge contract test passes; structured schema verified; fallback parsing documented.

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
**Dependencies**: Milestone 0 (bridge contract verified); Plan 014 bridge migration complete; Plan 015 agent ingestion complete  
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
   - **Privacy Constraint (Architecture §4.5)**: Command returns raw memory entries only (no LLM augmentation, no training-data fallback). If no memories match query, return empty `entries` array—do not generate synthetic responses.
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
     - **Error Code Reference Table**: Create a dedicated section listing all agent-facing error codes (`ACCESS_DISABLED`, `RATE_LIMIT_EXCEEDED`, `QUEUE_FULL`, `BRIDGE_TIMEOUT`, `INVALID_REQUEST`) with descriptions, HTTP-like semantics, and recommended handling. This serves as the canonical reference for third-party developers and eases future harmonization with global error taxonomy (Epic 0.2.3.1).
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
   - **Documentation Strategy**: Keep README as high-level overview with prominent link to `AGENT_INTEGRATION.md` for detailed schemas/examples. Avoid duplicating request/response schemas; instead reference the canonical definitions in `AGENT_INTEGRATION.md` to minimize drift.
   - **Acceptance**: README includes clear warning; users understand workspace-global access model; documentation follows single-source-of-truth pattern.

**Owner**: Implementer  
**Dependencies**: Milestone 2 (commands must exist to enforce access control)  
**Validation**: Settings control command access; tests confirm blocking when disabled; workspace-global model documented and warned.

---

### Milestone 4: Add UI Visibility Flags to Existing Store Tool

**Objective**: Update `cognee_storeMemory` tool contribution to appear in "Configure Tools" dialog.

**Tasks**:

1. **Update `extension/package.json` - Add UI Visibility Flags and Engine Version Gate**
   - **Set minimum VS Code version**: Update `engines.vscode` field to `^1.106.0` (or higher) to enforce minimum version for `canBeReferencedInPrompt`/`toolReferenceName` support
   - Locate `languageModelTools` → `cognee_storeMemory` contribution
   - Add `canBeReferencedInPrompt: true` property (enables Configure Tools UI)
   - Add `toolReferenceName: "cogneeStoreSummary"` property (user-facing reference name for `#` autocomplete and agent `tools:` array)
   - Add `icon: "$(database)"` property (use VS Code codicon for visual identity)
   - Verify existing `displayName`, `modelDescription`, `userDescription` are clear and user-facing
   - **Acceptance**: Engine version set to `^1.106.0`; tool contribution includes all required UI visibility properties

2. **Verify Tool Appears in Configure Tools Dialog**
   - Rebuild extension (`npm run compile`)
   - Reload VS Code window to pick up package.json changes
   - Open Copilot chat and click "Tools" button → "Configure Tools"
   - Confirm "Store Memory in Cognee" appears in the tools list (likely under "Extension tools" or extension display name category)
   - Verify toggle switch works (enable/disable)
   - **Acceptance**: Tool visible in UI; toggle state persists across sessions

3. **Verify `#` Autocomplete Works**
   - In Copilot chat, type `#cognee` and verify autocomplete suggests `#cogneeStoreSummary`
   - Select tool from autocomplete and verify tool description appears
   - **Acceptance**: Tool discoverable via `#` autocomplete with correct reference name

4. **Update Existing Tool Implementation - Add Confirmation Messages**
   - Edit `extension/src/tools/storeMemoryTool.ts`
   - Update `prepareInvocation()` method to return confirmation message:
     ```typescript
     return {
       invocationMessage: 'Storing summary in Cognee memory...',
       confirmationMessages: {
         title: 'Store Cognee Summary',
         message: new vscode.MarkdownString(
           'Store this conversation summary in Cognee knowledge graph so it can be retrieved in future sessions.\n\n' +
           '**Workspace**: ' + vscode.workspace.workspaceFolders?.[0].name
         )
       }
     };
     ```
   - **Acceptance**: Tool invocation shows progress message and confirmation prompt (if user trust level requires it)

**Owner**: Implementer
**Dependencies**: None (modifying existing Plan 015 implementation)
**Validation**: Tool appears in Configure Tools; `#cogneeStoreSummary` autocomplete works; confirmation messages display correctly

---

### Milestone 5: Implement Retrieve Memory Tool with UI Visibility

**Objective**: Create companion retrieval tool for custom agents to query Cognee memory, with UI visibility from the start.

**Tasks**:

1. **Add `cognee_retrieveMemory` Tool Contribution to `package.json`**
   - Add new entry to `languageModelTools` array:
     ```json
     {
       "name": "cognee_retrieveMemory",
       "displayName": "Retrieve Cognee Memory",
       "toolReferenceName": "cogneeRetrieveMemory",
       "canBeReferencedInPrompt": true,
       "icon": "$(search)",
       "modelDescription": "Retrieve relevant memories from Cognee knowledge graph based on a query. Returns structured summaries with topic, context, decisions, and metadata from past conversations. Use this when you need context about previous decisions, implementations, or discussions in this workspace.",
       "userDescription": "Search Cognee knowledge graph for relevant conversation history",
       "inputSchema": {
         "type": "object",
         "properties": {
           "query": {
             "type": "string",
             "description": "Natural language query to search for relevant memories (e.g., 'How did we implement caching?', 'What was decided about authentication?')"
           },
           "maxResults": {
             "type": "number",
             "description": "Maximum number of results to return (default: 3, max: 10)",
             "default": 3,
             "minimum": 1,
             "maximum": 10
           }
         },
         "required": ["query"]
       },
       "tags": ["memory", "knowledge-graph", "search", "retrieval", "cognee"]
     }
     ```
   - **Acceptance**: Tool contribution complete with UI visibility flags

2. **Create `extension/src/tools/retrieveMemoryTool.ts`**
   - Implement `RetrieveMemoryTool` class following same pattern as `StoreMemoryTool`
   - Implements `vscode.LanguageModelTool<RetrieveMemoryToolInput>`
   - Key methods:
     - `prepareInvocation()`: Validate query, return confirmation message
     - `invoke()`: Check agent access setting, call `CogneeContextProvider.retrieveContext()` directly (NOT via command), format results
   - **Shared Provider Enforcement**: Tool MUST invoke `CogneeContextProvider.retrieveContext()` directly to leverage centralized concurrency/rate limiting. Do NOT duplicate throttling logic or call `cogneeMemory.retrieveForAgent` command (command is for external extensions only).
   - Access control: Return error if `agentAccess.enabled = false`
   - **Result Formatting - Structured Payload Preservation**: Return result containing BOTH:
     - Human-readable markdown summary (numbered results with topic, context, decisions)
     - Verbatim structured JSON payload in fenced code block (full `CogneeContextResponse` for agent parsing/auditing)
   - Error handling: Catch and format errors as JSON responses
   - **Acceptance**: Tool routes through singleton `CogneeContextProvider`; response includes structured JSON payload verbatim plus narrative summary; no duplicate queueing logic

3. **Register Retrieve Tool in `extension/src/extension.ts`**
   - Import `RetrieveMemoryTool` class
   - Update `registerLanguageModelTool()` function to manage both tools:
     - Both tools register/unregister together when `agentAccess.enabled` changes
     - Use separate disposables for each tool (`storeMemoryToolDisposable`, `retrieveMemoryToolDisposable`)
   - **Tool Registration Lifecycle Test (REQUIRED)**: Add acceptance test verifying that toggling `cogneeMemory.agentAccess.enabled` from true→false immediately removes BOTH tools from:
     - Configure Tools UI
     - `#` autocomplete suggestions
     - `vscode.lm.tools` API list
   - **Acceptance**: Both tools register/unregister atomically when `agentAccess.enabled` changes; acceptance test validates immediate removal from all surfaces

**Owner**: Implementer
**Dependencies**: Milestones 1-3 (provider and commands must exist); Python bridge `retrieve.py` must accept query and maxResults parameters
**Validation**: Tool appears in Configure Tools; `#cogneeRetrieveMemory` autocomplete works; invocation returns structured results

---

### Milestone 6: Update `@cognee-memory` Participant to Use Provider

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
   - **Graceful Degradation**: With only Plan 014 complete (structured summaries but no Plan 017 ranking), metadata fields like `score` may be null/undefined and ranking may use basic recency heuristics. The participant should display available fields and omit missing ones without error. Full scoring and status-aware filtering require Plan 017.
   - Allow user to request "show metadata" for detailed inspection.
   - **Acceptance**: Participant shows richer context when metadata available (Plan 017 complete); degrades gracefully when only Plan 014 summaries exist.

3. **Update Participant Tests**
   - Mock `CogneeContextProvider` in participant unit tests.
   - Verify participant correctly formats and streams `CogneeContextResponse` entries.
   - **Acceptance**: All participant tests pass; no regressions.

**Owner**: Implementer  
**Dependencies**: Milestone 1 (`CogneeContextProvider`)  
**Validation**: Participant uses provider; existing functionality preserved; tests pass.

---

### Milestone 7: Transparency UX Indicators

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
   - **Architectural Constraint (§4.5)**: Output channel and status bar are **privacy controls**, not optional UX. Cognee cannot inject annotations into third-party agent responses; only the responding agent controls chat output. All agent access must be auditable via Cognee-controlled surfaces.
   - **Acceptance**: Output channel logs all agent retrieval attempts with structured format; logs are detailed enough for QA debugging; logs meet audit requirements.

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

### Milestone 8: Documentation and Testing

**Objective**: Document custom agent integration, validate end-to-end tool usage, and ensure privacy/access controls work.

**Tasks**:

1. **Update `extension/README.md` - Add Custom Agent Integration Section**
   - Add new section "Using Cognee Tools with Custom Agents"
   - Explain how to enable agent access via settings
   - Document tool discovery in "Configure Tools" dialog
   - Provide example custom agent `.agent.md` file:
     ```markdown
     ---
     name: Memory-Aware Code Assistant
     description: Copilot assistant with access to workspace memory
     tools: ['search', 'cogneeStoreSummary', 'cogneeRetrieveMemory']
     ---

     You are a code assistant with access to workspace-specific memory.

     When the user asks about past decisions or implementations:
     1. Use #cogneeRetrieveMemory to search for relevant context
     2. Ground your answer in the retrieved memories
     3. If no memories exist, use your training data but clarify it's not workspace-specific

     When the user completes an important implementation or makes a decision:
     1. Offer to store a summary using #cogneeStoreSummary
     2. Include topic, context, and key decisions in the summary
     ```
   - **Acceptance**: Documentation clear, actionable, with working examples

2. **Enhance `extension/AGENT_INTEGRATION.md` - Add Tool Integration Guide**
   - Add section on tool schemas (input parameters, expected responses)
   - Document `#` autocomplete usage and custom agent front-matter references
   - Provide troubleshooting guide (common issues: agent access disabled, Python bridge not initialized, tools not appearing in Configure Tools)
   - Include TypeScript examples for extension developers building custom agent workflows
   - **Acceptance**: Comprehensive integration guide suitable for third-party extension developers

3. **Create Integration Test - Store and Retrieve Round-Trip**
   - Add test file `extension/src/test/tools.integration.test.ts`
   - Test sequence:
     1. Enable `cogneeMemory.agentAccess.enabled` setting
     2. Invoke `cognee_storeMemory` tool with test summary
     3. Verify tool returns success response
     4. Invoke `cognee_retrieveMemory` tool with query matching test summary topic
     5. Verify tool returns results containing stored summary
   - **Acceptance**: Round-trip test passes; validates tools work end-to-end

4. **Manual Testing Checklist**
   - [ ] Install extension and enable agent access setting
   - [ ] Open "Configure Tools" dialog and verify both tools appear
   - [ ] Toggle tools on/off and verify state persists
   - [ ] Type `#cognee` in Copilot chat and verify both tools autocomplete
   - [ ] Create custom agent `.agent.md` with `tools: ['cogneeStoreSummary', 'cogneeRetrieveMemory']`
   - [ ] Invoke custom agent and verify tools are available
   - [ ] Store a test summary via tool and verify success
   - [ ] Retrieve stored summary via tool and verify results match
   - [ ] Disable agent access setting and verify tools disappear from Configure Tools
   - **Acceptance**: All manual tests pass; tools behave as expected

5. **Create Reference Test Agent Extension** (`test-agent/`)
   - Build minimal VS Code extension that calls `cogneeMemory.ingestForAgent` (Plan 015) and `cogneeMemory.retrieveForAgent`.
   - Test cases:
     - Agent ingests memory → retrieves it successfully (round-trip validation).
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
**Validation**: All **must-have** tests pass (see Testing Strategy below); QA approves; test agent demonstrates integration.

**Testing Priorities** (per Critique):
- **Must-Have (Release Blockers)**: Bridge contract test (Milestone 0), provider unit tests with rate/concurrency coverage, round-trip integration test (store→retrieve), access control tests (disabled setting blocks commands), tool registration lifecycle test.
- **Stretch Goals**: 100% coverage target, full E2E scenarios for all error codes, CI wiring for test agent. If deferred, document in `qa/016-agent-integration-qa.md` with explicit follow-on plan reference.

---

### Milestone 9: Update Version and Release Artifacts

**Objective**: Update project version to v0.3.2 and document changes for roadmap alignment.

**Tasks**:

1. **Update Version in `extension/package.json`**
   - Change `"version": "0.3.1"` to `"version": "0.3.2"`
   - Verify `engines.vscode` is `^1.106.0` or higher (set in Milestone 4)
   - Ensure 3-part semantic versioning (X.Y.Z format, required by VS Code Marketplace).
   - **Acceptance**: `package.json` version updated to v0.3.2; engine version gate in place.

2. **Add CHANGELOG Entry**
   - Document Plan 016 deliverables under v0.3.2 section:
     - **Agent Retrieval**: `CogneeContextProvider` service, `retrieveForAgent` command, structured `CogneeContextEntry` responses
     - **UI-Visible Tools**: Both tools (`storeMemory`, `retrieveMemory`) appear in Configure Tools dialog with `#` autocomplete
     - **Custom Agent Integration**: Tools support `.agent.md` front-matter references, confirmation messages, structured results with verbatim JSON payloads
     - **Transparency**: Output channel logs, status bar indicator, comprehensive documentation
     - **Participant Refactor**: `@cognee-memory` uses shared `CogneeContextProvider`
     - Workspace-global agent access configuration with privacy warnings
     - **Minimum VS Code Version**: Requires VS Code 1.106+ for `languageModelTools` UI visibility features
   - **Acceptance**: CHANGELOG reflects all Plan 016 features (retrieval + UI visibility) and engine version requirement.

3. **Update README for Agent Integration**
   - Verify "Using Cognee Tools with Custom Agents" section is present (added in Milestone 8)
   - Add "For Agent Developers" section linking to `AGENT_INTEGRATION.md`
   - Highlight that Cognee tools appear in VS Code Configure Tools dialog
   - **Acceptance**: README documents both tool UI and programmatic integration.

4. **Commit Version Changes**
   - Commit message: "Release v0.3.2 - Agent Retrieval and UI-Visible Tools (Plan 016)"
   - Include all version artifact updates in single commit
   - Tag release: `git tag v0.3.2 -m "Complete Epic 0.3.0.3: Agent Retrieval + UI-Visible Tools"`
   - **Acceptance**: Version changes committed with descriptive message; release tagged.

**Owner**: Implementer  
**Dependencies**: All implementation milestones complete  
**Validation**: Version artifacts updated; release ready for packaging.

---

## Testing Strategy

**Unit Tests**:

- `CogneeContextProvider`: Concurrency/rate limiting, response formatting, error handling
- `RetrieveMemoryTool`: Tool interface implementation, validation, access control, result formatting
- Command handlers (`retrieveForAgent`): Access control, JSON parsing, error codes
- Tool confirmation messages and invocation flows

**Integration Tests**:

- Round-trip store and retrieve: Store test summary via tool → retrieve via query → verify results match
- Dynamic tool registration: Toggle `agentAccess.enabled` and verify tools register/unregister
- Commands callable from test extension: Verify JSON responses, error codes
- Bridge integration via mocked `CogneeClient`

**Manual Testing** (documented in Milestone 8):

- Configure Tools UI appearance and toggle behavior
- `#` autocomplete functionality for both tools (`#cogneeStoreSummary`, `#cogneeRetrieveMemory`)
- Custom agent integration (create agent, reference tools, invoke successfully)
- Confirmation message display during invocations
- Error handling when agent access disabled
- Status bar and Output channel transparency indicators

**QA Scenarios**:

- Reference test agent demonstrates integration
- All configuration combinations tested (access enabled/disabled, rate limits, concurrency limits)
- Documentation validated (README, AGENT_INTEGRATION.md examples work)

**Coverage Expectations**:

- **Must-Have for v0.3.2 Release**:
  - Unit: Core provider concurrency/rate limiting logic, command access control, error code paths
  - Integration: Bridge contract test (Milestone 0), round-trip store→retrieve, tool registration lifecycle
  - Manual: Configure Tools visibility, `#` autocomplete, basic custom agent workflow
- **Stretch Goals** (defer if time-constrained; document in QA follow-on):
  - Unit: 90-100% coverage for provider/tools/commands
  - Integration: All error codes validated (INVALID_REQUEST, BRIDGE_TIMEOUT, etc.)
  - E2E: Full matrix of configuration combinations, comprehensive concurrency scenarios
  - CI: Automated test agent wired into VS Code integration tests

**Critical Validation Scenarios**:

1. **Tool UI Visibility**: Both tools appear in Configure Tools dialog; toggles work; `#` autocomplete functions
2. **Custom Agent Integration**: Create `.agent.md` with `tools: ['cogneeStoreSummary', 'cogneeRetrieveMemory']` and verify tools available
3. **Agent retrieves context successfully**: When enabled, structured schema from bridge returned
4. **Access Control**: Agent blocked when `agentAccess.enabled = false` (error `ACCESS_DISABLED`)
5. **Rate Limiting**: Error `RATE_LIMIT_EXCEEDED` after threshold
6. **Concurrency Limiting**: Requests queued or rejected when max exceeded
7. **Transparency**: User sees detailed Output logs and status bar indicators for all agent activity
8. **Participant Refactor**: `@cognee-memory` continues to work unchanged, uses shared `CogneeContextProvider`
9. **Structured Responses**: Metadata-rich responses include all fields (`topicId`, `planId`, `score`, etc.)
10. **Round-Trip Validation**: Test agent ingests memory via Plan 015 → retrieves via Plan 016 → verifies content matches

---

## Validation

**Milestone Acceptance**:

- ✅ **Milestone 0**: Bridge contract verified; Plan 014 migration complete; structured schema documented
- ✅ **Milestone 1**: `CogneeContextProvider` service implemented with concurrency/rate limiting
- ✅ **Milestone 2**: `cogneeMemory.retrieveForAgent` command callable by arbitrary extensions
- ✅ **Milestone 3**: Agent access configuration functional; workspace-global model enforced
- ✅ **Milestone 4**: Engine version gate set (`^1.106.0`); store tool appears in Configure Tools; `#cogneeStoreSummary` autocomplete works; confirmation messages display
- ✅ **Milestone 5**: Retrieve tool appears in Configure Tools; `#cogneeRetrieveMemory` autocomplete works; tool uses shared provider (not command); response includes verbatim JSON + narrative; lifecycle test validates atomic registration/unregistration
- ✅ **Milestone 6**: `@cognee-memory` participant refactored to use shared provider
- ✅ **Milestone 7**: Transparency indicators (Output logs, status bar) show all agent activity
- ✅ **Milestone 8**: Documentation complete; integration tests pass; manual testing checklist completed
- ✅ **Milestone 9**: Version updated to v0.3.2; engine version verified; CHANGELOG reflects changes including VS Code 1.106+ requirement; commit created

**Epic Completion Criteria** (from Roadmap Epic 0.3.0.3):

- [x] Cognee contributes `languageModelTools` for store and retrieve (Plan 015 + Plan 016)
- [x] Tools gated behind opt-in workspace setting (default: disabled)
- [x] Tool registration lifecycle manages both tools together
- [x] Tool invocations logged to Output channel with payload digest and result status
- [x] Documentation explains tool integration model, privacy controls, and opt-in workflow
- [x] **Agent Retrieval**: `CogneeContextProvider` service with structured responses
- [x] **Internal Commands**: `retrieveForAgent` command for programmatic access
- [x] **UI Visibility**: Tools visible in "Configure Tools" UI with enable/disable toggles
- [x] **Custom Agent Support**: Tools support `#` autocomplete and `.agent.md` front-matter references
- [x] **Transparency**: Output logs and status bar show agent activity

**Plan Success**:

- Users can discover Cognee tools in standard VS Code "Configure Tools" dialog
- Custom agents can declare Cognee tools in `.agent.md` and invoke them successfully
- Agents retrieve structured context (`CogneeContextEntry` with metadata) via tools
- Tool invocations are transparent (confirmation messages, progress indicators, audit logs)
- `@cognee-memory` participant uses shared retrieval infrastructure
- Documentation enables third-party extension developers to integrate Cognee memory
- Reference test agent demonstrates full round-trip integration (ingest + retrieve)

**Feasibility Contingency**:
- This plan does **not** define any fallback away from the tool-based integration surface for Copilot agents. If future platform changes invalidate the `languageModelTools` approach, a separate follow-on plan must be created to define and validate an alternative path (e.g., MCP server tools), and architecture documents (`system-architecture.md` ADR) must be updated accordingly.
- Implementers are **not authorized** under Plan 016 to pivot the primary Copilot integration surface to direct commands or MCP without explicit planner and architect approval via a new plan.
- **Alignment with Plan 015**: Both agent ingestion (Plan 015) and agent retrieval (Plan 016) share the same architectural stance: tool-only for Copilot, commands-only-as-convenience for non-Copilot extensions, MCP-requires-new-plan for any future pivot.

**Sign-off**: ✅ Architect review complete; ✅ Critic approved (see `critiques/016-Agent-retrieval-and ui-visible-extension-tools-critique.md`).

**Implementation Guidance from Critique**:
- Treat Milestone 0 (bridge contract verification) as hard gate; no PRs for provider/commands/tools until contract test passes.
- Centralize type definitions for requests/responses/errors in single TS module; mirror in `AGENT_INTEGRATION.md`.
- Focus on must-have tests for v0.3.2; defer stretch goals to follow-on QA plan if needed.
- Keep tool implementations thin; delegate logic to `CogneeContextProvider` and shared helpers.

---

## Risks

1. **Bridge Migration Blocking**
   - Risk: Plan 014 bridge migration incomplete; structured schema not available.
   - Mitigation: Milestone 0 verifies contract before implementation proceeds; escalate to planner if blocked.
   - **Impact**: If bridge not ready, entire plan is blocked—no degraded fallback to string parsing.

2. **Workspace-Global Access Model**
   - Risk: Users may not understand that enabling access grants ALL extensions memory access.
   - Mitigation: Prominent warnings in settings UI and README; default disabled; clear documentation of trust model.

3. **Tool-Based Integration Surface Assumption**
   - Risk: Future VS Code platform changes could alter or deprecate the `languageModelTools` API.
   - Mitigation: This plan explicitly does not define fallback paths; any surface change requires a new plan and ADR. Monitor VS Code API changelog for breaking changes.
   - **Impact**: If `languageModelTools` become unavailable, agent integration will be blocked until a new plan (e.g., MCP-based) is approved and implemented.

4. **Transparency Indicator Feasibility**
   - Risk: VS Code Chat API may not support injecting annotations into agent responses.
   - Mitigation: Prioritize Output channel logs and status bar; treat in-chat annotation as stretch goal.

5. **Third-Party Agent Adoption**
   - Risk: No third-party agents adopt integration initially; feature unused.
   - Mitigation: Create compelling reference agent; document use cases in README; engage with VS Code agent developer community.

6. **Privacy Perception**
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

## Architectural Notes (2025-11-19 Review)

The following architectural requirements were incorporated per `architecture/016-autonomous-agent-retrieval-and-integration-architecture-findings.md` (2025-11-19 14:45 review).

**Critique Status**: Plan approved by critic on 2025-11-19. See `critiques/016-Agent-retrieval-and ui-visible-extension-tools-critique.md` for detailed findings. All critical issues resolved; medium-priority recommendations (error code centralization, testing priorities, documentation drift prevention) incorporated into milestones.

**Key Architectural Requirements**:

1. **Engine Version Gate**: `package.json > engines.vscode` MUST be set to `^1.106.0` (or higher) to prevent installation on VS Code versions lacking `canBeReferencedInPrompt`/`toolReferenceName` support. Without this gate, users on older builds will encounter unknown contribution properties at runtime.

2. **Tool Registration Lifecycle**: Both `cogneeStoreSummary` and `cogneeRetrieveMemory` tools MUST register/unregister atomically when `cogneeMemory.agentAccess.enabled` changes. An explicit acceptance test validates that disabling the setting immediately removes tools from Configure Tools UI, `#` autocomplete, and `vscode.lm.tools` API list.

3. **Structured Payload Preservation**: `RetrieveMemoryTool.invoke()` MUST return results containing BOTH a human-readable markdown summary AND the verbatim `CogneeContextResponse` JSON in a fenced code block. This keeps tool output faithful to the command contract, allows agents to quote metadata verbatim, and satisfies transparency requirements.

4. **Shared Provider Enforcement**: All tool invocations MUST route through the singleton `CogneeContextProvider` instance (NOT via `cogneeMemory.retrieveForAgent` command). Commands exist for external extensions; tools leverage the provider directly to avoid duplicate throttling/queueing logic.

---

## References

- `agent-output/planning/014.1-agent-command-invocation-feasibility.md` ✅ **COMPLETE** - validated `languageModelTools` as primary Copilot integration surface; tool-based approach is the operative decision for this plan)
- `test-extensions/FINDINGS.md` (from Plan 014.1 - technical constraints and example code; retained as background only)
- `agent-output/analysis/016-autonomous-agent-retrieval-and-integration-analysis.md` (historic analysis; command/MCP feasibility references superseded by Plan 014.1 decision)
- `agent-output/architecture/016-autonomous-agent-retrieval-and-integration-architecture-findings.md` (Architectural Review)
- `agent-output/architecture/system-architecture.md` (§4.5, §9 ADR: Copilot Tool Surface vs Direct Commands)
- `agent-output/roadmap/product-roadmap.md` (Epic 0.3.0.3 - Agent-Driven Memory Integration)
- `agent-output/planning/014-chat-summary-creation-and-retrieval.md` (structured summary schema)
- `agent-output/planning/015-agent-ingestion-command.md` ✅ **PREREQUISITE** - shares tool-only approach for Copilot)
- `agent-output/planning/017-metadata-ranking-and-compaction.md` (metadata and ranking infrastructure)
- VS Code Extension API: https://code.visualstudio.com/api/references/vscode-api
- VS Code Chat API: https://code.visualstudio.com/api/extension-guides/chat
- VS Code Language Model Tools API: https://code.visualstudio.com/api/references/vscode-api#LanguageModelTool
