# 016 Language Model Tools Definition Update Analysis

Changelog

- 2025-11-21 15:08 UTC – Received directly from user (acting planner) – Request: validate proposed replacements for the two `languageModelTools` JSON entries in `extension/package.json`. Added compatibility assessment, privacy alignment check, and adoption recommendations for Plan 016 scope.

Value Statement and Business Objective
As a Cognee extension maintainer, I want to ensure the Copilot-facing tool definitions stay accurate and policy-compliant so that agents interact with workspace memory safely and deliver the "perfect context" experience promised in the master objective.

Objective
Confirm whether the proposed `cognee_storeMemory` and `cognee_retrieveMemory` JSON replacements remain valid within VS Code's `languageModelTools` contract, align with Plan 016 requirements, and uphold architectural privacy/UX guarantees.

Architectural Context

- Consulted `agent-output/architecture/system-architecture.md` (§3.1, §4.5) to restate constraints: Configure Tools is the sole opt-in surface, tool metadata must communicate workspace-local privacy, and commands remain headless proxies. (Architect owner update 2025-11-20.)
- Reviewed Plan 016 (agent-output/planning/016-Agent-retrieval-and ui-visible-extension-tools.md) success criteria to ensure new copy does not undermine transparency, concurrency, or rate-limiting expectations.
- Plan 016.1 hotfix (tool lifecycle) and Plan 017 async ingestion stress that messaging must remain accurate about staging/background completion.

Root Cause Analysis
Need for richer tool guidance stemmed from inconsistent agent usage: prior short descriptions led to shallow summaries and infrequent retrieval, reducing the value of Plan 016's Configure Tools exposure. The proposed replacements aim to direct agents toward proactive storage/retrieval habits but unintentionally removed explicit privacy cues required by the architecture decision that tools must advertise workspace-local isolation.

Methodology

1. Compared proposed JSON blobs with current `extension/package.json` entries to spot structural or semantic deltas.
2. Cross-referenced Plan 016 acceptance criteria and architecture decisions to ensure descriptions continue to reflect system capabilities (workspace isolation, asynchronous ingestion messaging).
3. Reviewed `extension/src/test/storeMemoryTool.test.ts` to confirm schema-sensitive tests remain valid if textual descriptions change.
4. Verified VS Code `languageModelTools` contract requirements (name, displayName, toolReferenceName, icon, schema) remain satisfied by the replacements.

Findings

1. **Structural Compatibility (Confirmed)** – Field names (`name`, `displayName`, `toolReferenceName`, `inputSchema`, etc.) and schema definitions remain untouched. Existing TypeScript interfaces/tests continue to match the JSON schema, so no code changes are triggered purely by these copy updates.
2. **Behavioral Guidance Improvement (Positive)** – New `modelDescription` text now instructs agents to capture meaningful work summaries (300–1500 characters) and to run retrieval before planning responses, reinforcing the roadmap objective of eliminating manual context reconstruction.
3. **Privacy/Isolation Messaging Removed (Risk)** – Current descriptions explicitly mention "Workspace-specific and stores data locally." The proposed replacements omit any reference to workspace-local storage or opt-in behavior. Architecture §4.5 mandates that tool metadata communicate privacy guarantees; losing that language could mislead users who rely on Configure Tools to understand scope.
4. **Usage Frequency vs. Rate Limits (Watch)** – Retrieval description encourages calling the tool "at the start of a turn" and "before planning an answer." This aligns with desired behavior but may drive higher invocation frequency. Plan 016 rate limits (2 concurrent, 10/min clamped to 5 and 30) can handle this, yet documentation should remind agents to respect throttling errors.
5. **Metadata Expectations Not Enforced (Neutral)** – Guidance on "0–5 decisions" or "300–1500 characters" is advisory only; the extension does not validate length/count. This is acceptable but should be documented so QA knows behavior relies on agent compliance, not schema enforcement.

Strategic Considerations

- Aligns with Master Objective by nudging agents toward proactive state checkpointing, reducing cognitive load on developers.
- Ensure privacy language stays front-and-center to maintain user trust, a key pillar of roadmap epics (workspace isolation, zero cognitive overhead).
- Consider whether future plans (Plan 018 metadata transparency, Plan 019 compaction) should cross-link to these descriptions to keep terminology consistent (DecisionRecord, Superseded).

Recommendations

1. **Adopt the richer descriptions but reintroduce an explicit privacy clause** (e.g., "Data remains local to this workspace; nothing leaves your machine without user opt-in") in both `modelDescription` strings before merging.
2. **Add a short sentence reminding agents about staging/notifications** for the store tool ("Responses indicate whether the summary was staged; background cognify completes within ~2 minutes") to stay consistent with Plan 017 messaging.
3. **Document expected invocation cadence** in `AGENT_INTEGRATION.md`, referencing the new guidance so integrators understand rate-limit behavior and how to handle `429` errors if they do call the tool every turn.

Scope Considerations

- Analysis focused solely on text replacements inside `package.json`. Did not review tool implementation (`storeMemoryTool.ts`, `retrieveMemoryTool.ts`) or bridge behavior.
- MCP tool definitions and non-Copilot integrations remain out of scope.

Open Questions

1. Should we explicitly instruct agents to mention whether a summary was staged vs. fully processed when relaying results to users?
2. Do we need to add minimum/maximum validators for `decisions` array length to enforce the "0–5" guidance, or is documentation sufficient?
3. Would embedding workspace/privacy language in `userDescription` (not just `modelDescription`) better satisfy VS Code Configure Tools expectations?

Testing Infrastructure Needs

- No new frameworks required. Existing unit test (`storeMemoryTool.test.ts`) already covers schema alignment; keep it updated if future schema tweaks accompany description edits.
- If privacy text is restored, consider adding a lightweight linter snippet or doc test to ensure required phrases ("workspace" / "local") remain in tool metadata during future edits.

References

- extension/package.json (proposed vs current tool metadata)
- agent-output/planning/016-Agent-retrieval-and ui-visible-extension-tools.md
- agent-output/architecture/system-architecture.md (§3.1, §4.5)
- extension/src/test/storeMemoryTool.test.ts
