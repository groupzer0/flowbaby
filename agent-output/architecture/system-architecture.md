# RecallFlow Chat Memory System Architecture

**Last Updated**: 2025-11-23 10:35
**Owner**: architect agent

## Change Log

| Date & Time | Change | Rationale | Related Epic/Plan |
|-------------|--------|-----------|-------------------|
| 2025-11-15 09:10 | Created baseline system architecture document covering Plans 001-011 | Establish single source of truth for planners/critics per updated architect instructions | Plans 001-011 summary |
| 2025-11-15 09:45 | Added forward-looking architecture mapping for roadmap epics | Provide planners with architecture guidance for v0.2.2, v0.2.3, v0.3.0, v0.4.0 | Roadmap epics 0.2.2.x-0.4.0 |
| 2025-11-16 12:30 | Incorporated Plan 013/014 analyses (memory display transparency, chat summary schema, compaction pipeline) | Document UX transparency fixes and long-term memory management to guide planning/QA | Plans 013-014 |
| 2025-11-16 14:05 | Captured Plan 014 bridge addendum (structured ingestion + metadata-aware retrieval requirements) | Ensure planners know bridge migration scope before implementation | Plan 014 bridge addendum |
| 2025-11-17 10:20 | Added Plan 016 agent-integration guardrails and context provider requirements | Preserve privacy/testability before exposing public agent commands | Plan 016 |
| 2025-11-18 11:05 | Documented Plan 014 enriched-text metadata fallback + regex retrieval parsing | RecallFlow SDK (`cognee` 0.3.4) lacks DataPoint API; need interim architecture + testing guardrails | Plan 014 |
| 2025-11-18 15:40 | Added guidance for agent-driven memory integration (shared provider, agent commands, privacy guardrails) | Roadmap pivot requires agents to call RecallFlow ingest/retrieve commands directly while preserving isolation | Epic 0.3.0.3 / Plan 019 TBD |
| 2025-11-18 17:25 | Clarified headless agent-command model + MCP fallback | Prevent Plan 015/016 from shipping without validated invocation path; document MCP tool contingency if VS Code commands are inaccessible | Plan 019 feasibility |
| 2025-11-19 09:05 | Adopted languageModelTools surface as primary Copilot integration path | Align agent access with officially supported Copilot tool contract while retaining command/MCP fallback strategy | Plan 014.1 / Epic 0.3.0.3 |
| 2025-11-19 14:45 | Documented UI-visible RecallFlow tools (store/retrieve) and transparency guardrails for Plan 016 scope merge; updated diagram | Ensure planners implement workspace-gated tool discovery, shared provider usage, and audit surfaces before implementation | Plan 016 |
| 2025-11-19 18:05 | Simplified agent-access model to rely solely on VS Code Configure Tools toggles; removed status bar dependency; captured Plan 016.1 bridge-timeout diagnostics guidance | Align architecture with Plan 016.1 hotfix (tool lifecycle + timeout fixes) | Plan 016.1 |
| 2025-11-20 09:45 | Captured async cognify background-processing architecture (state tracking, notifications, diagram update) | Provide Plan 017 design guardrails before implementation to unblock agent testing | Plan 017 |
| 2025-11-20 12:05 | Resolved async notification policy (success + failure toasts with shared throttling) | Align Plan 017 acceptance criteria with architecture while preserving transparency limits | Plan 017 |
| 2025-11-20 13:05 | Clarified async ingestion definition vs bridge modes | Address critique that async intent was ambiguous; reiterate architectural contract for background cognify | Plan 017 |
| 2025-11-20 13:25 | Documented async UX messaging (staged copy + completion notification promise) | Ensure users never see "Done" while cognify still running; set expectation for 1–2 min completion + toast | Plan 017 |
| 2025-11-20 13:45 | Extended async ingestion requirement to manual capture | Align all ingestion flows with business goal of non-blocking UX; document additional UX/QA constraints | Plan 017 |
| 2025-11-21 15:05 | Recorded Plan 018 migration/ranking guardrails (maintenance mode, truthful timestamps, unified decay config) | Keep metadata ranking aligned with async ingestion contract and preserve recency semantics | Plan 018 |
| 2025-11-21 15:15 | Captured Plan 019 compaction queue + conflict-store requirements | Prevent compaction jobs from violating background limits and ensure conflict review has durable state | Plan 019 |
| 2025-11-22 09:40 | Documented RecallFlow user-facing branding shift + background log capture surfacing | Keep UX terminology consistent while exposing new ingest log diagnostics | Plan 019 |
| 2025-11-23 10:35 | Defined managed workspace setup + automated bridge dependency refresh contract | Ensure installs/upgrades pin `cognee` versions per workspace and provide deterministic refresh workflow | Plan 017 / Epic 0.4.0.2 |


## 1. Purpose and Scope

This document captures the end-to-end architecture of RecallFlow Chat Memory as shipped through Plans 001–011. It serves as the baseline reference for future architectural decisions recorded in this file and for upcoming roadmap epics (0.2.2.x and 0.2.3.x). It covers components, runtime flows, data/storage boundaries, quality attributes, current problem areas, and how the existing system supports or blocks planned work.

## 2. High-Level Architecture

The Mermaid diagram in `agent-output/architecture/system-architecture.mmd` mirrors the layered view below and is kept in sync with this document whenever structural changes occur.

```text
+-------------------------------------------------------------+
|                    VS Code Extension (TS)                   |
|  - extension.ts (activation, registrations)                 |
|  - CogneeClient (subprocess orchestration, logging)         |
|  - CogneeContextProvider (shared retrieval, rate limits)    |
|  - Agent commands/API surface (retrieveForAgent, etc.)      |
|  - UX surfaces (commands, Output logs, chat participant)    |
+---------------------------|---------------------------------+
                            v JSON over stdout/stderr
+-------------------------------------------------------------+
|                Python Bridge (extension/bridge)             |
|  - init.py  (workspace bootstrap, ontology load)            |
|  - ingest.py (capture flow → cognee.add + cognify)          |
|  - retrieve.py (search flow → cognee.search)                |
|  - workspace_utils.py (dataset naming, path canonicalization)|
|  - Assets (ontology.ttl, requirements.txt)                  |
+---------------------------|---------------------------------+
                            v API calls / local FS
+-------------------------------------------------------------+
|     RecallFlow SDK (`cognee`==0.4.0 package, Python)        |
|  - Knowledge graph ingestion / cognition                    |
|  - Hybrid graph/vector retrieval                            |
|  - System/data directories (.cognee_system/.cognee_data)    |
+-------------------------------------------------------------+
```

## 3. Component Responsibilities

### 3.1 VS Code Interaction Layer (TypeScript)

- Validates workspace context and loads configuration (`cogneeMemory.*` settings).
- Provides user entry points: keyboard capture command, command palette, @recallflow-memory chat participant, toggle/clear commands.
- Streams UX feedback (notifications, Output channel logs, chat participant markdown).
- Delegates all knowledge operations to Python bridge via `CogneeClient` helper and the shared RecallFlow Context Provider (`CogneeContextProvider` service). The provider centralizes retrieval logic, enforces concurrency/rate limits, and emits telemetry consumed by both UI surfaces and agent commands.
- User-facing copy (commands, notifications, chat participant name) ships under the **RecallFlow** brand starting v0.3.6, while internal namespaces (`cogneeMemory.*`, `CogneeClient`, command IDs) remain unchanged for backward compatibility.
- Hosts the RecallFlow Context Provider (`CogneeContextProvider`), a singleton service that normalizes retrieval responses (structured metadata once Plan 014 migration lands), enforces rate limiting/back-pressure, and feeds both the chat participant and public agent commands.
- Provides a **Workspace Setup Wizard** (`RecallFlowSetupService`) that creates or validates a workspace-local `.venv`, records ownership metadata in `.cognee/bridge-env.json`, walks users through API-key entry plus onboarding actions, and flags custom interpreters as `ownership="external"` so automation knows not to mutate them.
- Hosts the `BackgroundOperationManager`, a singleton service that coordinates async cognify() runs introduced in Plan 017. The manager owns a volatile in-memory map plus a persisted ledger at `.cognee/background_ops.json` (mirrored to VS Code `globalState`) so extension reloads can reconcile orphaned work. It enforces a hard limit of 2 concurrent background cognify() processes, maintains a FIFO queue of 3 pending jobs, exposes the `cognee.backgroundStatus` command for visibility, and publishes lifecycle events (start/complete/fail) to both the Output channel and notification pipeline (info-level success toast, warning-level failure toast, each throttled to ≤1 per 5 minutes per workspace). Any surface that returns immediately after `add-only` (agent tool response, command output, etc.) MUST state that the memory was staged, that cognify() will finish within ~1–2 minutes, and that a toast will confirm completion—never display “Done” while the background job still runs.
- Background processes now pipe `stdout`/`stderr` into `.cognee/logs/ingest.log` (rotated/truncated on startup). Failure notifications include a **View Logs** action that opens this file, and Output-channel entries record the log path alongside the `operationId` so QA can correlate ledger entries with raw diagnostics.
- Contributes VS Code `languageModelTools` metadata for the RecallFlow Store/Retrieve tools (IDs remain `cogneeStoreSummary` / `cogneeRetrieveMemory`). These definitions surface inside "Configure Tools", drive `#cogneeStoreSummary` / `#cogneeRetrieveMemory` autocomplete, and now rely solely on VS Code's opt-in UI. Tools register at activation; when users disable them in Configure Tools, VS Code hides them automatically and the extension listens for enablement events to keep audit logging/command availability in sync.
- Exposes the `cogneeMemory.retrieveForAgent` command (Plan 016) without an additional workspace setting; instead, the command consults the same tool-enablement state surfaced via Configure Tools (or fails fast if tools are disabled). Commands are headless: they remain hidden from command palette/menus and exist solely for other extensions or agents to invoke programmatically via `vscode.commands.executeCommand`. The roadmap pivot adds `cogneeMemory.ingestForAgent`, giving Copilot agents parity with @recallflow-memory capture flows while keeping ingestion centralized.
- Offers a **Refresh Bridge Dependencies** command that pauses BackgroundOperationManager, rebuilds the managed `.venv` with the pinned `requirements.txt`, reruns `verify_environment.py`, writes `.cognee/bridge-version.json` (`requirementsHash`, `cogneeVersion`, `updatedAt`), and only resumes capture/retrieval once hashes match. Workspaces marked `ownership="external"` receive guidance instead of automation to avoid touching user-managed interpreters.
- Provides a unified validation/auditing pipeline: every agent command invocation is logged (timestamp, workspace, caller hint) and rejected unless workspace access is enabled. Future capability tokens can plug into this layer without touching bridge scripts.
- Logs every agent-initiated retrieval to the Output channel and structured diagnostics to satisfy transparency requirements from Plans 013/016.
- Implements the Plan 014 summary template + parser helpers so TypeScript can (a) render structured markdown with embedded metadata for ingestion and (b) validate/round-trip summaries when RecallFlow DataPoints (exposed via the `cognee` SDK) are unavailable.

### 3.2 Bridge Execution Layer (Python)

- Executes as short-lived subprocess per operation; no resident daemons.
- Loads `.env` for `LLM_API_KEY`, sets RecallFlow (`cognee`) config, enforces workspace-local storage.
- Maintains ontology assets (currently `ontology.ttl`) and dataset naming strategy.
- Handles Terraform-style migration markers to coordinate one-time pruning.
- Emits JSON envelopes for success/error, plus structured stderr for diagnostics.
- `ingest.py` now supports explicit modes: `sync` (legacy fallback / tests), `add-only` (stage data, return immediately), and `cognify-only` (background graph construction). All UI/agent flows call `add-only`, then spawn a detached `cognify-only` subprocess identified by `operation_id`. Manual capture no longer waits for `sync`; it shares the same async orchestration contract and relies on toast notifications for completion. Each invocation writes a status stub to `.cognee/background_ops/<operation_id>.json` so TypeScript can correlate exit codes with persisted entries.
- Implements the enriched-text fallback for Plan 014 summaries: `ingest.py` accepts `--summary-json`, renders metadata-rich markdown, and `retrieve.py` parses metadata via regex before producing structured JSON. Bridge unit tests MUST cover both enriched and legacy text paths until the RecallFlow SDK (`cognee`) exposes DataPoint APIs. These scripts are the only sanctioned entry points for agents; `retrieveForAgent` and `ingestForAgent` commands ultimately call them so ontology wiring and dataset isolation remain consistent.

### 3.3 RecallFlow Knowledge Layer (`cognee` SDK)

- External library responsible for persisting knowledge graph artifacts, running cognify pipelines, retrieving context, and pruning stale data.
- Stores data in workspace-local directories configured by bridge scripts.

## 4. Runtime Flows

### 4.1 Activation / Initialization

1. VS Code activates extension (startupFinished) and checks for workspace root.
2. `CogneeClient.initialize()` spawns `python init.py <workspace>`.
3. `init.py` loads `.env`, verifies `LLM_API_KEY`, sets RecallFlow directories (`.cognee_system` / `.cognee_data`) under the workspace, loads ontology, and writes migration markers.
4. Result JSON returns dataset metadata. TS layer logs to Output channel and either registers commands/participant (success) or surfaces guidance (failure).

### 4.2 Manual Capture Flow (Async)

1. User invokes keyboard shortcut or command palette (command `cognee.captureMessage`).
2. TypeScript collects text (input box or clipboard) and calls `CogneeClient.ingestAsync()` which issues `ingest.py --mode add-only`.
3. The extension immediately responds with “Memory staged – processing will finish in ~1–2 minutes; you’ll get a notification when it’s done,” logs the operation ID, and enqueues the background job via `BackgroundOperationManager`.
4. The manager spawns a detached `ingest.py --mode cognify-only --operation-id <uuid>` process, tracks its PID/ledger entry, and surfaces completion/failure via throttled notifications plus Output logs.
5. Users rely on the success toast (and optional `cognee.backgroundStatus` command) to know when the memory is searchable; no UI surface claims completion before cognify() exits.

### 4.3 Retrieval / Chat Participant Flow

1. User types `@recallflow-memory` in GitHub Copilot Chat.
2. Participant handler checks `cogneeMemory.enabled`, calls `CogneeClient.retrieve(query)`.
3. `retrieve.py` (not shown here but present) performs hybrid search and returns ranked memories.
4. Participant previews retrieved context, augments prompt, streams LLM response, and optionally re-ingests conversation (feedback loop disabled by default).

**Plan 013 Adjustment (Pending)**: Replace the hardcoded 150-character preview with either full memory text or a configurable limit (≥1000 chars) plus explicit truncation indicator. This preserves user trust and aligns with “Zero Cognitive Overhead”. Update `CogneeClient` logging to either record full queries or clearly flag truncation length.

### 4.4 Plan 014 Bridge Modernization (Pending)

Plan 014’s structured summary + compaction work introduces bridge-specific requirements that must be satisfied before planners can implement ranking or compaction:

1. **Ingestion Path**
   - Accept Plan-014-formatted summaries (Topic/Context/Decisions/etc.) instead of raw user/assistant pairs.
   - Attach first-class metadata fields (`topic_id`, `session_id`, `plan_id`, `status`, timestamps) via RecallFlow DataPoints (exposed by the `cognee` SDK) so they survive `add → cognify → search`.
   - Maintain a migration or fallback path for legacy raw-text memories until compaction can supersede them.

2. **Retrieval Path**
   - Consume metadata-rich search results (structured node fields) rather than relying on regex parsing of text bodies.
   - Compute recency using stored timestamps (e.g., exponential decay) and combine with RecallFlow similarity scoring in a documented `final_score`.
   - Honor compaction semantics by preferring `DecisionRecord` entries and down-ranking `status = Superseded` summaries.
   - Return transparent payloads to TypeScript (`topic_id`, `plan_id`, `status`, `created_at`, `summary_text`, `final_score`) so Plan 013 transparency goals are achievable.

3. **Compaction Hooks**
   - Expose a bridge command or mode to trigger future compaction tasks and log their effects for QA.

The `014-bridge-focused-addendum-analysis` file is the canonical reference for these expectations; this section tracks them architecturally so Planner/Implementer work does not regress the three-layer contract.

#### 4.4.1 Interim Fallback: Enriched Text Metadata Embedding (2025-11-18)

The RecallFlow SDK (`cognee` 0.3.4) does **not** expose a public `DataPoint` API, so Plan 014 ingestion cannot yet persist metadata separately from text. Until the SDK delivers the API, the bridge must:

- Render summaries as enriched markdown with a `**Metadata:**` block and deterministic section headings so downstream regex parsing is stable.
- Version both the template and parser modules; changes to section headers require synchronized updates to `ingest.py`, `retrieve.py`, and their tests.
- Emit structured JSON **only after** parsing enriched text. Retrieval must include validation hooks (regex groups + default values) so malformed summaries fail loudly with actionable error codes.
- Maintain mixed-mode support: enriched summaries carry metadata, while legacy memories continue to return `null` metadata. TypeScript consumers must be able to branch on `topicId`/`status` availability.
- Treat this fallback as temporary. As soon as the RecallFlow SDK exposes DataPoints, Planner MUST schedule the migration to native metadata storage and retire regex parsing to reduce brittleness.

Testing Guidance: `extension/bridge/test_datapoint_contract.py` is now mandated to cover (a) enriched-text formatting, (b) metadata parsing, (c) legacy path regression tests, and (d) JSON contract validation so QA can rely on deterministic behavior even without DataPoints.

#### 4.4.2 Metadata Migration & Ranking Readiness (Plan 018)

- Legacy summary migration must run as a bridge-level maintenance operation that temporarily pauses `BackgroundOperationManager`, performs `add` + `cognify` synchronously per batch, and logs to a dedicated `.cognee/maintenance/migration.log`. It may not route through agent-facing ingestion commands or emit user-facing staged notifications.
- Migration must preserve truthful recency data: store both `sourceCreatedAt` (best-effort timestamp derived from legacy artifacts) and `migratedAt`, and have ranking/decay logic operate on `sourceCreatedAt` to avoid biasing scores.
- Ranking exposes a single user-facing parameter (`halfLifeDays` recommended). The bridge derives `decayAlpha` internally (`alpha = ln(2)/halfLifeDays`) so QA, docs, and retrieval consumers share one contract.
- All schema/version changes for enriched-text metadata continue to require synchronized template + parser updates with regression tests to keep fallback stable until DataPoints land.

#### 4.4.3 Compaction Prerequisites (Plan 019)

- `compact.py` jobs must coordinate with the async ingestion ledger: either enqueue `add-only` operations through `BackgroundOperationManager` with maintenance labels or hold an exclusive lock that pauses the queue while synchronous compaction runs. Automatic runs must skip if the queue is non-empty.
- Since enriched-text entries are immutable, “superseding” a summary means ingesting a new metadata wrapper that marks it `Superseded` and references the original via `supersededBy`. Retrieval logic (and Plan 018 ranking) must honor the newest metadata entry, not mutate historical text.
- Compaction must persist conflict diagnostics in a deterministic local store (e.g., `.cognee/compaction/conflicts.json`) so both bridge scripts and VS Code UI surfaces share state for review/resolution workflows. The schema must capture cluster/topic IDs, conflicting decisions, timestamps, and resolution status.

#### 4.5 Agent-Initiated Retrieval & Ingestion (Epic 0.3.0.3)

1. **Opt-In Control (Configure Tools Only)** – Users enable/disable RecallFlow access exclusively through VS Code's Configure Tools UI. The extension registers both tools at activation; when a user disables either tool, VS Code hides it immediately and the extension's enablement listener blocks related commands. There is no parallel workspace setting or status bar badge; transparency is provided via Configure Tools state and Output channel logs.

2. **Tool Surface (Primary) + Command Surface (Fallback)** – By default, the RecallFlow extension contributes two `languageModelTools` definitions (`cogneeStoreSummary`, `cogneeRetrieveMemory`) so Copilot agents can call RecallFlow without bespoke chat participants.
   - Each tool is implemented via `vscode.lm.registerTool(...)` with validation logic that mirrors the headless commands, forwards requests into `CogneeContextProvider`, and emits identical audit logs. Tool metadata (display name, descriptions, icons, schema) drives the Configure Tools UI and `#` autocomplete.
   - Public commands remain the canonical business logic surface and stay headless; tool invocations reuse the same provider + command helpers internally. This preserves support for non-Copilot extensions (direct `executeCommand`) and keeps the MCP fallback viable if tools prove insufficient.
   - Because the tool contract is the only Copilot-supported channel today, Plan 014.1/016 must validate tool invocation end-to-end (payload shaping, opt-in enforcement, rate limits, transparency logging) instead of relying solely on extension-to-extension command tests.

3. **Concurrency & Throttling** – `CogneeContextProvider` enforces max 2 concurrent bridge calls with a queue size of 5. Excess requests fail fast with `429_AGENT_THROTTLED`, keeping subprocess load predictable even if multiple agents fire simultaneously.

4. **Auditability** – Each command writes a structured log entry `{ timestamp, command, agentName, queryDigest, result }` to the RecallFlow Output channel and (optionally) `.cognee/agent_audit.log`. This satisfies privacy/transparency requirements and gives QA a deterministic artifact to inspect.

5. **Error Propagation** – Commands emit machine-readable error codes (`AGENT_ACCESS_DISABLED`, `INVALID_PAYLOAD`, `MISSING_BRIDGE_SCHEMA`, etc.) so agents can render user-friendly guidance. If bridge contracts are outdated, commands short-circuit with remediation steps instead of relaying stack traces.
6. **Tool Lifecycle & Discovery** – Language model tools honor the Configure Tools opt-in. Users toggle availability directly in VS Code, and the extension listens for `onDidChangeEnablement` to synchronize command gating and logging. Tool metadata (name/title/description) continues to drive Copilot discovery; no additional registration/unregistration dance is required beyond reacting to enablement state.

7. **MCP Fallback** – If tool invocation proves insufficient (e.g., other agent platforms lack tool support or require richer auth), the RecallFlow extension will expose equivalent `retrieve`/`ingest` tools via a local MCP server running inside the extension. Those tools proxy into `CogneeContextProvider`, reuse the same rate limiting and audit logging, and give MCP-aware agents a supported integration path without duplicating business logic. MCP remains a contingency path and should only ship after discovery/auth flows are validated.

#### 4.5.1 Async Ingestion & Background Cognify (Plan 017)

Plan 017 refines the agent-ingestion half of this flow so Copilot tools acknowledge `cognee.add()` quickly while `cognee.cognify()` finishes in the background. The architecture introduces deterministic state tracking, queueing, and error propagation so async work does not regress transparency or reliability.

> **Clarification (2025-11-20 13:45)** – “Async” in this context does **not** introduce a new magical bridge API; it is achieved by explicitly splitting the existing `ingest.py` responsibilities into two callable modes (`--mode add-only` and `--mode cognify-only`) and orchestrating them from TypeScript. Every production ingestion path (agent tools, manual capture, headless commands) calls `add-only`, returns to the user immediately (<10 s) with staged messaging, then launches a detached `cognify-only` subprocess that the `BackgroundOperationManager` supervises. The legacy `--mode sync` exists solely for diagnostics/tests. This split is the sole sanctioned way to make cognify asynchronous and is the Highest Business Objective for Plan 017.

1. **Async Entry Point** – `CogneeContextProvider` exposes `ingestAsync` (used by `cogneeStoreSummary`, `cogneeMemory.ingestForAgent`, and the manual `cognee.captureMessage` command) which wraps `CogneeClient.ingest()` but instructs it to call `ingest.py --mode add-only`. The legacy `sync` mode is reserved for diagnostics/tests only. Every caller must tell the user “Memory staged – finishing in ~1–2 minutes. You’ll get a notification when cognify completes.” instead of implying the operation is fully complete.
2. **Operation Ledger** – Once `add-only` succeeds, `BackgroundOperationManager` creates an operation record `{operationId, datasetPath, summaryDigest, startTime, pid, status=pending}` in memory, VS Code `globalState`, and `.cognee/background_ops.json`. Records age out after 24 hours (success) or 7 days (failure) so QA can inspect histories.
3. **Background Subprocess** – The manager spawns `python ingest.py --mode cognify-only --operation-id <id>` with `detached: true`, `stdio: 'ignore'`, and inherits the workspace environment. The TypeScript process keeps the `ChildProcess` handle long enough to subscribe to `exit` / `error` events, then `unref()` so VS Code threads are not blocked.
4. **Concurrency Limits** – Only 2 background cognify() jobs may run simultaneously; up to 3 additional operations queue in FIFO order. The queue is persisted with the ledger so restarts do not drop pending work. When limits are exceeded, tools fail fast with `429_COGNIFY_BACKLOG` and instruct agents to retry later. This mirrors the retrieval-side throttling and prevents a thundering herd if multiple agents ingest at once.
5. **Lifecycle Events** – When the background process starts, the manager logs `[BACKGROUND] Cognify started (operationId, pid)` to the Output channel and writes a `[PROGRESS]` marker to the ledger file. Success transitions the record to `completed`, captures duration/entity count from the subprocess JSON stub, logs `[BACKGROUND] completed in Ns`, and emits an info-level notification (`✔ Cognify finished`, "View Status" opens the status command) so agents know the summary is ready. Failures mark the record `failed`, persist the error payload, and trigger a warning notification with "Retry" (re-run add-only) and "View Logs" actions. Success and failure notifications share the same throttle budget: ≤1 per outcome type every 5 minutes per workspace to prevent alert fatigue.
6. **Crash / Restart Handling** – On activation the manager reloads `.cognee/background_ops.json`, checks each `running` entry, and verifies if the recorded PID still exists. If yes, it reattaches to the process; if not, it marks the entry `unknown` and surfaces a warning in the Output channel so users know cognify() may not have completed. During extension `deactivate()`, all live processes receive SIGTERM with a 5-second grace period followed by SIGKILL if still running, and ledger entries are updated accordingly.
7. **Status Surface** – The new `cognee.backgroundStatus` command (consumed by QA + advanced users) renders the ledger in a quick-pick: operation ID, elapsed time, current state. This command only surfaces local data and never transmits telemetry.

Error payloads remain consistent with the Plan 014/016 taxonomy: the background subprocess writes `{ operation_id, success, error_code, error_message, remediation }` to its status stub before exiting so the TypeScript side can deliver actionable notifications.

### 4.6 Workspace Initialization & Dependency Refresh

RecallFlow must control the Python environment it ships against to prevent silent drift between `requirements.txt` (particularly the pinned `cognee` version) and whatever interpreter a workspace currently points to. Installation and upgrade flows therefore have two explicit modes: a **managed** path that the extension owns end-to-end, and an **advanced** path where users accept responsibility for custom interpreters. Automation only touches managed environments.

#### 4.6.1 Managed Workspace Setup (First-Run)

1. **Detection & Ownership** – On first activation `RecallFlowSetupService` looks for `.cognee/bridge-env.json`. If absent, it offers to create a workspace-local `.venv` at `${workspace}/.venv`. Accepting creation writes `{ "pythonPath": "<abs>", "ownership": "managed", "requirementsHash": null }`. If the user selects an external interpreter, the wizard records `ownership="external"`, and all automation treats the environment as read-only.
2. **Environment Creation** – Managed mode runs `python -m venv .venv`, upgrades `pip`, and executes `pip install -r extension/bridge/requirements.txt`, guaranteeing every workspace installs the exact dependency set (including `cognee`) committed with the extension.
3. **Verification** – Immediately after install the wizard executes `bridge/verify_environment.py` to confirm `cognee` imports, ontology assets resolve, and required native deps exist. Structured JSON output is logged to the Output channel and persisted to `.cognee/bridge-version.json` alongside the current `requirements.txt` SHA256.
4. **Walkthrough Integration** – Successful setup launches the onboarding walkthrough promised in the roadmap (Epics 0.2.2.3, 0.4.0.2). The walkthrough captures API keys, explains capture/retrieve commands, and links to agent tool opt-in so new workspaces become useful immediately.
5. **Failure Handling** – Verification failures emit actionable error codes (`PYTHON_UNSUPPORTED`, `DEPENDENCY_BUILD_FAILED`, etc.) plus ready-to-run shell commands. The extension refuses to register capture/retrieve commands until a managed environment passes validation, preventing partially configured workspaces from operating in an undefined state.

#### 4.6.2 Refresh Bridge Dependencies (Upgrades)

This command covers any release that changes the pinned dependencies (for example, upgrading `cognee` or `python-dotenv`).

1. **Pre-flight** – The command reads `.cognee/bridge-env.json`. If `ownership="external"`, it aborts with guidance because RecallFlow cannot mutate user-managed interpreters. For managed envs it checks BackgroundOperationManager; if jobs are running, users can wait for completion or force cancellation.
2. **Quiesce** – BackgroundOperationManager pauses queue intake, finishes or cancels running cognify processes, and surfaces a “Refreshing dependencies” toast so users understand capture/retrieve is temporarily unavailable.
3. **Rebuild** – The service deletes (or renames for rollback) the managed `.venv`, recreates it via `python -m venv`, upgrades `pip`, and runs `pip install -r extension/bridge/requirements.txt`. This enforces one pinned dependency set per workspace.
4. **Health Check** – It re-runs `verify_environment.py`. Success updates `.cognee/bridge-version.json` with `requirementsHash`, `cogneeVersion`, and `updatedAt`. Failure restores the previous env (if preserved) and emits remediation guidance through the Output channel and notification pipeline.
5. **Resume** – Once hashes match, the command reloads bridge metadata, resumes BackgroundOperationManager, and emits a success toast with “View Logs” and “Open Version File” actions so QA/support can verify what changed.
6. **Enforcement** – During normal activation `CogneeClient.initialize()` compares the recorded `requirementsHash` to the repo version. A mismatch blocks all commands until the user runs the refresh workflow, ensuring every workspace upgrades before new codepaths execute.

Roadmap alignment:

- **Plan 012 / Epic 0.2.2.1** – Managed setup guarantees packaged assets (ontology, requirements) install consistently, preventing the v0.2.1 regression.
- **Plan 017 / Epic 0.2.3.2** – Auto setup + refresh remove manual `.venv` work, fulfilling the “Simplified Python Environment Setup” deliverable.
- **Epic 0.4.0.2** – The onboarding walkthrough triggered post-setup matches the planned “RecallFlow: Initialize Workspace” experience, giving planners and QA a clear architectural contract.

## 5. Data & Storage Boundaries

- **Workspace-local**: `.cognee_system/` (RecallFlow’s underlying `cognee` DB) and `.cognee_data/` (vector/index artifacts) created under workspace root since Plan 010.
- **Auxiliary**: `.cognee/` folder houses migration markers and metadata.
- **ONT assets**: `extension/bridge/ontology.ttl` packaged inside VSIX; expected to be copied alongside bridge scripts.
- **Secrets**: `.env` file storing `LLM_API_KEY`; redaction currently incomplete (TS logs still reference OPENAI).

## 6. External Dependencies

- VS Code API (v1.85+).
- Node.js runtime (extension host) plus dependencies from `package.json`.
- Python 3.8+, `cognee==0.4.0`, `python-dotenv`, `rdflib` (ontology parse), and standard libraries.
- LLM provider (OpenAI or compatible) via `LLM_API_KEY`.

## 7. Quality Attributes

- **Privacy**: No remote services; all data stays local.
- **Isolation**: Dataset naming uses canonical workspace path hashed with dataset prefix to avoid collisions.
- **Testability**: Python bridge covered by pytest suite (Plan 011). VS Code integration tests exist (Plan 010 release validation) but lack coverage for packaging/regression.
- **Extensibility**: Additional commands/UX elements can be added in TypeScript without touching bridge contracts.
- **Reliability gaps**: Lack of automated packaging verification and environment bootstrapping causes brittle installs (v0.2.1 failure).

## 8. Known Problem Areas

1. **Ontology Format Mismatch** (Epic 0.2.2.1 blocker)
   - `init.py` still references `ontology.json` while VSIX ships `ontology.ttl` only. Any fresh install fails before user gets value.

2. **Outdated Onboarding + Error Messaging**
   - UI still instructs `OPENAI_API_KEY` despite migration to `LLM_API_KEY`; logs do not redact new variable name.

3. **Packaging Blind Spots**
   - No automated check ensures bridge assets (ontology, requirements) are included in VSIX. QA fixtures created `ontology.json`, hiding missing-file regression.

4. **Silent Failure Modes**
   - Errors in ingestion/retrieval often only appear in the Output channel; there are still no proactive notifications or inline guidance when operations fail. Users perceive "the extension does nothing" without digging into logs.

5. **Python Environment Friction**
   - Auto-detection (Plan 007) improved logging but still requires manual `.venv` creation and dependency installation. Missing Python yields generic warnings.

6. **Operational Visibility**
   - No health telemetry (even local) for capture/retrieval success rates, making it difficult to diagnose support issues or run QA smoke tests.

7. **Testing Gaps for Packaged Builds**
   - Pytest suite runs on repo files, not packaged VSIX. Release verification lacks "install VSIX → run smoke script" step, allowing packaging drift to slip.

8. **Memory Display Transparency (Plan 013)**
   - Chat participant truncates retrieved memories to 150 chars and log previews to 50 chars, creating mistrust and violating transparency goals. Requires UX adjustments in TypeScript (`extension.ts`, `cogneeClient.ts`).

9. **Memory Graph Growth / Noise (Plan 014)**
   - Continuous ingestion of raw conversation summaries risks index bloat and conflicting context. Requires structured summary schema, metadata tagging, and compaction pipeline to maintain signal.
   - **Interim risk (2025-11-18)**: Because the RecallFlow SDK currently lacks DataPoints, metadata lives inside enriched markdown. Regex parsing is brittle; any template drift breaks retrieval. Planner/QA must treat this as high-risk technical debt and prioritize migration once APIs exist.

10. **Agent Access Privacy (Epic 0.3.0.3)**

Enabling agent access grants every extension in the workspace the ability to read/write RecallFlow memories because VS Code does not expose caller identity. Without loud warnings and audit logs, users could unintentionally leak context to untrusted extensions. Capability-token research (Plan 019) is required before we can offer finer-grained authorization.

## 9. Architectural Decisions

### Decision: Baseline Three-Layer Architecture (2025-11-15 09:10)

**Context**: VS Code APIs are TypeScript-only, while the RecallFlow SDK is Python-only. Plans 001–011 implemented selective capture, workspace isolation, and chat participant retrieval without a unifying architectural narrative.
**Choice**: Maintain a three-layer separation (VS Code interaction, Python bridge, RecallFlow SDK) with JSON-over-stdout contracts, stateless subprocess invocations, and workspace-rooted storage. Keep all architectural documentation centralized in this file, supplemented by a single visual diagram.
**Alternatives Considered**: (1) Port RecallFlow features to TypeScript/HTTP, rejected due to loss of local-only privacy and engineering cost. (2) Run a persistent Python daemon, rejected for lifecycle/packaging complexity.
**Consequences**: (+) Clear ownership boundaries and easier testing. (-) Dual toolchains and subprocess latency remain. Provides stable baseline for future UX and reliability epics.
**Related**: Plans 002–011, Roadmap Epics 0.2.2.x/0.2.3.x.

### Decision: Memory Transparency & Preview Policy (2025-11-16 12:30)

**Context**: Plan 013 analysis confirmed that truncated chat previews (150 chars) undermine user trust despite the LLM receiving full memory text. Logging also obscures full user queries, making troubleshooting harder.
**Choice**: Update the retrieval flow so that (a) the chat participant displays full memory content up to a configurable limit (>=1000 chars) with explicit truncation indicators, and (b) `CogneeClient` logs either the full query or clearly annotated previews (length + total). This keeps users aware of context while preserving log usefulness.
**Alternatives Considered**: (1) Keep short previews but add a “Show more” UI; deferred due to additional UX complexity and uncertain VS Code support. (2) Only adjust logging but leave chat previews short; rejected because transparency issues remain.
**Consequences**: (+) Aligns with Epic 0.2.2.3 “Zero Cognitive Overhead”; users can audit retrieved context. (-) Larger chat payloads require validation against VS Code performance limits; future work may need pagination. Logging adjustments may increase Output noise but improve diagnostics.
**Related**: Plan 013 (Fix Memory Display Truncation).

### Decision: Structured Conversation Summaries & Compaction (2025-11-16 12:30)

**Context**: Plan 014 introduced a schema for storing conversation summaries plus agent instructions for ingestion/retrieval. Without structured metadata, RecallFlow memories will accumulate noise and conflicting history.
**Choice**: Adopt structured summary chunks with fields (`TopicId`, `SessionId`, `PlanId`, `Status`, `Decisions`, `Rationale`, etc.) and design a compaction pipeline that periodically merges older summaries into `DecisionRecord` DataPoints while marking prior records as `Superseded`. Retrieval pipelines should support recency-aware scoring (semantic + timestamp decay) to prioritize fresh decisions.
**Alternatives Considered**: (1) Store raw chat transcripts; rejected due to size and low signal. (2) Only rely on plans/ADRs without chat summaries; rejected because many decisions happen in chat and would be lost.
**Consequences**: (+) Provides predictable retrieval behavior and a pathway to long-term knowledge management. (+) Enables future ranking/feedback features. (-) Requires additional pipeline tasks and metadata discipline; compaction logic must be implemented in the Python/RecallFlow layer before benefits materialize.
**Related**: Plan 014 analysis, future Epics on context intelligence.

### Decision: Bridge Migration for Structured Summaries (2025-11-16 14:05)

**Context**: Analysis 014 and the new bridge addendum confirmed that `ingest.py`/`retrieve.py` still operate on raw text with inline “Metadata:” strings, and regex-based recency scoring that rarely fires. Plan 014’s architecture assumes structured DataPoints, metadata-aware retrieval, and status-driven compaction.

**Choice**: Prioritize a bridge migration that (a) ingests Plan-014-formatted summaries via DataPoints with indexed metadata fields, (b) returns structured metadata from `retrieve.py` with documented recency-aware scoring, and (c) exposes hooks for future compaction tasks. Legacy raw-text memories remain until compaction supersedes them, but all new storage must follow the structured format.

**Alternatives Considered**: (1) Keep raw-text ingestion and attempt to parse metadata heuristically—rejected due to brittleness and inability to support compaction/status flags. (2) Push metadata logic into the TS layer—rejected because RecallFlow search needs metadata at ingestion time.

**Consequences**: (+) Enables Plan 014 ranking/transparency goals; (+) aligns with DecisionRecord compaction strategy; (-) requires coordinated updates to bridge scripts, tests, and planner tasks; (-) short-term complexity as legacy and structured memories coexist.

**Related**: Plan 014 bridge addendum, Decision on Structured Conversation Summaries & Compaction.

### Decision: Agent Integration Guardrails & Context Provider (2025-11-17 10:20)

**Context**: Plan 016 proposes exposing RecallFlow memories (via the existing `cogneeMemory.*` command surface) to arbitrary VS Code agents. Without explicit guardrails, this risks privacy regressions, duplicate LLM pipelines inside the extension host, and uncontrolled subprocess fan-out.

**Choice**: Introduce a TypeScript-level `CogneeContextProvider` as the single retrieval entry point for both the `@recallflow-memory` participant and any public agent commands. Access is gated behind workspace settings that default to disabled and must clearly communicate that enabling them grants all extensions in the workspace visibility into the RecallFlow memory graph. Authorization heuristics such as allow-lists can only ship if we possess verifiable caller identity (capability tokens, signed payloads). Summarization or other LLM-heavy operations remain in the Python bridge to preserve the three-layer architecture. `CogneeContextProvider` must also enforce concurrency/rate limits and log every agent-initiated request for transparency.

**Alternatives Considered**: (1) Allow each TypeScript surface (participant, commands) to call `CogneeClient` directly—rejected because it fragments logging and opens the door to inconsistent privacy checks. (2) Move all new logic into the bridge—rejected because VS Code agents need a lightweight TS façade, but bridge changes remain prerequisites for structured metadata. (3) Keep allow-lists despite lacking caller identity—rejected because it provides false assurances.

**Consequences**: (+) Centralizes retrieval logic and transparency controls; (+) keeps LLM and data processing in the Python layer; (+) lets us expose a documented command surface without regressing privacy. (-) Requires capability-token design if finer-grained authorization is desired; (-) demands precise coordination with Plan 014 bridge migration to ensure structured payloads are available before public APIs ship.

**Related**: Plan 016, Plans 013-015 (transparency + structured summaries), §7 Quality Attributes (privacy, isolation).

### Decision: Enriched Text Metadata Fallback (2025-11-18 11:05)

**Context**: Plan 014 requires DataPoint-based metadata so summaries carry status, topic IDs, and timestamps. Analysis discovered that the RecallFlow SDK (`cognee` 0.3.4) no longer exposes the DataPoint class publicly, blocking the intended ingestion path.

**Choice**: Implement a documented fallback where summaries are rendered as enriched markdown with embedded metadata, ingested via existing `cognee.add` calls, and parsed back into structured JSON via deterministic regex. Require bridge tests + TS summary templates to stay synchronized, and log this as temporary until the RecallFlow SDK restores a metadata API.

**Alternatives Considered**: (1) Delay Plan 014 entirely—rejected because we still need structured retrieval before Plans 015/016. (2) Fork the RecallFlow SDK (`cognee`) or reach into internal types—rejected due to maintenance risk and licensing concerns.

**Consequences**: (+) Unblocks Plan 014 deliverables (structured ingestion/retrieval) without waiting for SDK changes. (+) Keeps VS Code + bridge contract consistent for downstream plans. (-) Introduces regex-based fragility; template divergence causes runtime failures. (-) Requires rigorous tests + documentation so QA can detect drift. Migration to real DataPoints becomes a high-priority follow-up once SDK permits.

**Related**: Plan 014, Decision on Structured Conversation Summaries & Compaction, §4.4.1 fallback guidance.

### Decision: Agent-Driven Memory Surface (2025-11-18 15:40)

**Context**: Real-world trials of Plan 014 showed @recallflow-memory cannot summarize Copilot agent conversations it never saw (history is participant-scoped), and its retrieval path lets the LLM answer with training data rather than strictly stored memories. Users expect Copilot agents themselves to remember past interactions when routed through RecallFlow.

**Choice**: Shift from participant-centric summarization to agent-driven commands. Introduce a shared `CogneeContextProvider`, public commands `cogneeMemory.retrieveForAgent` / `cogneeMemory.ingestForAgent`, and a workspace-level opt-in that gates all agent access. Commands always return/accept the same structured contracts as the bridge, enforce concurrency limits, and log every invocation for transparency under the RecallFlow brand.

**Alternatives Considered**: (1) Attempt to expand @recallflow-memory’s visibility to entire Copilot transcripts—blocked by VS Code API limits. (2) Let agents spawn bridge scripts themselves—rejected to preserve ontology wiring, throttling, and privacy checks. (3) Continue allowing LLM-augmented answers but label them—rejected because it still violates the workspace-only contract and confuses users about what’s actually stored.

**Consequences**: (+) Aligns architecture with roadmap pivot and Master Objective by making agents memory-aware; (+) Maintains privacy guardrails through centralized settings/logging; (-) Requires feasibility analysis (Plan 019) for VS Code command invocation/auth; (-) Introduces UX complexity around opt-in warnings and audit visibility.

**Related**: Roadmap Epic 0.3.0.3, Plan 016 groundwork, §4.5 runtime flow.

### Decision: Copilot Tool Surface vs Direct Commands (2025-11-19 09:05)

**Context**: Plan 014.1 investigation uncovered that validating `vscode.commands.executeCommand` from another extension does not guarantee Copilot agents can invoke RecallFlow commands (IDs remain `cogneeMemory.*`). VS Code now provides `languageModelTools` as the supported bridge between extensions and Copilot agents, whereas direct command invocation is undocumented and brittle. Continuing to rely on headless commands alone would delay Epic 0.3.0.3 or force MCP fallback prematurely.

**Choice**: Make `languageModelTools` the primary integration surface for Copilot agents. The RecallFlow extension contributes a tool (e.g., `cognee.runCommand`) whose entry command validates tool payloads, enforces opt-in settings, and then forwards into the existing headless commands. Direct `executeCommand` usage remains supported for non-Copilot extensions, and MCP stays as a contingency path, but Copilot validation must focus on tool invocation semantics.

**Alternatives Considered**:

- Rely exclusively on direct command invocation. Rejected because Copilot provides no guarantee or capability metadata for arbitrary commands, and prior experimentation shows difficulty ensuring authentication/authorization semantics.
- Skip tool contribution and move straight to MCP. Rejected for now because MCP lifecycle/discovery adds significant complexity and is unnecessary if language model tools satisfy Copilot scenarios.

**Consequences**:

- (+) Aligns with Copilot's officially supported extension surface, improving reliability and discoverability for both coding and @workspace agents.
- (+) Maintains current TypeScript/Python layering: tools remain thin proxies on top of `CogneeContextProvider` and bridge scripts.
- (+) Allows clear opt-in/out by registering or unregistering tool contributions alongside workspace settings.
- (-) Requires Plan 014.1 to expand scope: implement tool entry command, validate Language Model Tool invocation, and document payload schema + rate limiting.
- (-) Necessitates additional QA to ensure tool metadata accurately reflects privacy behaviors and that disabling agent access hot-unregisters the tool.

**Related**: Plan 014.1 feasibility study, Plans 015/016 implementation strategy, Epic 0.3.0.3 agent-driven memory integration.

### Decision: Configure Tools as Sole Agent-Access Control (2025-11-19 18:05)

**Context**: Plan 016 QA uncovered UI desynchronization and redundant privacy messaging caused by a dual opt-in model (`cogneeMemory.agentAccess.enabled` + Configure Tools toggles). Users could not trust tool state, and the status bar indicator gave false assurance while actual enablement was managed elsewhere. Plan 016.1 removes the workspace setting and status bar entirely.
**Choice**: Make VS Code's Configure Tools UI the single source of truth for both tool and command enablement. Tools register at activation and rely on user-managed toggles; the extension listens for enablement events to gate headless commands and maintain audit logs. Status bar indicators tied to the old setting are removed; transparency is now delivered via Configure Tools state plus Output channel diagnostics.
**Alternatives Considered**: (1) Keep the workspace setting and attempt to refresh Configure Tools manually; rejected because VS Code caches tool metadata and would still mislead users. (2) Introduce a new in-extension toggle; rejected as duplicative and still unable to reflect Configure Tools state. (3) Delay change until VS Code exposes tool-refresh APIs; rejected because hotfix is required for v0.3.2.
**Consequences**: (+) Eliminates contradictory privacy controls; (+) aligns with VS Code best practices; (+) reduces lifecycle bugs by letting the platform manage tool visibility; (-) removes persistent status bar indicator, so future transparency work must leverage notifications/logs. Commands invoked outside Configure Tools must now check tool enablement and fail fast when disabled.
**Related**: Plan 016.1 (Fix Tool Lifecycle and Bridge Timeouts), §4.5 runtime flow, Epic 0.3.0.3.

### Decision: Async Cognify Background Processing (2025-11-20 09:45)

**Context**: Profiling on 2025-11-19 confirmed that `cognee.add()` completes in ~5 seconds while `cognee.cognify()` blocks agent tools for ~68 seconds. Epic 0.3.0.3 requires agent tools to return promptly so QA can exercise retrieval and audit flows, yet synchronous ingestion makes every test take 70+ seconds and causes VS Code integration tests to time out. We must decouple staging from graph construction without sacrificing transparency or workspace isolation.
**Choice**: Split `ingest.py` into explicit modes and orchestrate background cognify() via a new `BackgroundOperationManager`. All production ingestion paths (agent tools, manual capture, headless commands) call `ingest.py --mode add-only`, return success immediately with staged messaging, then enqueue a detached `--mode cognify-only` subprocess managed by the TS service. The manager persists operation state (JSON ledger + VS Code Memento), enforces 2 concurrent jobs with a bounded queue, resumes orphaned work on activation, terminates children on deactivate, and emits throttled notifications for both success (info) and failure (warning) outcomes. The legacy `sync` mode is reserved for diagnostics/tests.
**Alternatives Considered**: (1) Keep synchronous ingestion and simply increase timeouts—rejected because it blocks user workflows and still hides failures. (2) Implement a persistent Python worker/daemon—rejected for now due to packaging/lifecycle complexity and need for per-workspace sandboxing. (3) Depend on RecallFlow SDK-level async APIs—none exist today, and introducing threads within the bridge would not solve VS Code host blocking or state tracking requirements.
**Consequences**: (+) Reduces perceived agent latency from ~73s to <10s while preserving eventual consistency. (+) Introduces a durable audit trail for background work plus structured error propagation, improving transparency over the previous synchronous "spinner" UX. (-) Raises operational complexity: planners must deliver ledger persistence, queue limits, restart reconciliation, and notification throttling to avoid zombie processes or alert fatigue. (-) Async mode cannot ship until bridge tests cover all three modes, meaning Plan 017 needs a strict implementation order (bridge split → manager → tools). Future telemetry (status bar, retries) builds atop this foundation.
**Related**: Plan 017 (Async Cognify Optimization), §3.1 BackgroundOperationManager, §4.5.1 runtime flow, Roadmap Epic 0.3.0.3.

### Decision: Background Notification Policy (2025-11-20 12:05)

**Context**: Plan 017’s planner required success + failure notifications so agents know when background cognify() finishes, but the initial architectural findings allowed only failure toasts. This left QA without clear acceptance criteria and risked diverging UX between docs and implementation.
**Choice**: Adopt dual notification outcomes backed by one throttle budget: info-level success toast (`✔ Cognify finished – View Status`) and warning-level failure toast (`⚠ Cognify failed – Retry/View Logs`). Both share the existing ≤1 per outcome type per 5 minutes per workspace throttle, and the Output channel remains the authoritative log.
**Alternatives Considered**: (1) Failure-only notifications with Output logs for success—rejected for lack of positive confirmation that memories are usable. (2) Notification-per-operation with no throttling—rejected for noise during batch ingestion.
**Consequences**: (+) Resolves plan/architecture discrepancy; (+) provides deterministic user feedback while preserving noise limits; (-) adds state to `BackgroundOperationManager` (lastSuccessAt/lastFailureAt) and QA coverage for both copy variants.
**Related**: Plan 017, §3.1 BackgroundOperationManager, §4.5.1 runtime flow.

### Decision: Metadata Migration Maintenance Mode (2025-11-21 15:05)

**Context**: Plan 018 needs to migrate hundreds of legacy summaries into the structured metadata schema while Plan 017 introduced `BackgroundOperationManager` and staged messaging for every ingestion. Naively re-ingesting each summary via the public add-only path would overwhelm the background queue, emit spurious notifications, and distort the async ledger.
**Choice**: Treat metadata migration as a bridge-level maintenance operation that (a) pauses the background queue, (b) performs `cognee.add` + `cognify` synchronously per batch, (c) records progress in `.cognee/maintenance/migration.log`, and (d) resumes the queue after completion. Migration must capture both `sourceCreatedAt` and `migratedAt`, and ranking must rely on the former so exponential decay remains truthful. Users configure recency via a single `halfLifeDays` setting; the bridge derives `decayAlpha` internally.
**Alternatives Considered**: (1) Run migration through the live ingestion commands—rejected for queue saturation and noisy UX. (2) Skip truthful timestamps—rejected because ranking would perceive migrated data as brand new. (3) Expose both decay parameters—rejected for configuration drift.
**Consequences**: (+) Maintains async ingestion guarantees during maintenance; (+) preserves recency semantics for ranking; (+) simplifies configuration/testing by owning the alpha↔half-life conversion centrally; (-) Requires additional tooling (queue lock, maintenance log) and detection of legacy timestamps.
**Related**: Plan 018, §4.4.2, §4.5, §11 roadmap ranking goals.

### Decision: Compaction Queue Coordination & Conflict Store (2025-11-21 15:15)

**Context**: Plan 019 introduces background compaction that ingests new `DecisionRecord` entries and marks originals as `Superseded`, alongside a conflict-review UI. Without guidance, compaction could run concurrently with async ingestion, mutate immutable enriched-text records, or leave conflict metadata scattered across ad-hoc logs.
**Choice**: Require compaction jobs to coordinate with `BackgroundOperationManager` (either enqueue labeled add-only work or hold an exclusive maintenance lock), treat supersedence as new metadata entries rather than in-place mutations, and persist conflict diagnostics in a deterministic local store (`.cognee/compaction/conflicts.json`) consumable by both bridge scripts and VS Code UI. Auto-compaction must defer when the ingestion queue is busy and publish audit logs distinct from regular captures.
**Alternatives Considered**: (1) Let compaction run independently of the queue—rejected for risking concurrent writes and broken throttling. (2) Modify existing summaries in place—rejected because enriched-text fallback lacks mutable fields and would desynchronize metadata. (3) Keep conflicts only in Output logs—rejected because the review UI would have no durable data.
**Consequences**: (+) Preserves async ingestion invariants; (+) keeps immutable storage model intact; (+) enables deterministic conflict review; (-) Adds bookkeeping (locks, conflict files) and stricter scheduling logic for auto-compaction.
**Related**: Plan 019, §4.4.3, §8 (Problem Area 9), roadmap Epic 0.3.0.1.

### Decision: RecallFlow Branding & Log Surfacing (2025-11-22 09:40)

**Context**: Plan 019 introduces a user-facing rebrand from "Cognee" to "RecallFlow" plus new background log capture to diagnose silent failures. Architecture must clarify which identifiers change, how diagnostics surface, and how UX copy remains consistent across tools, notifications, and documentation.

**Choice**: Adopt the RecallFlow brand for all user-visible strings (extension display name, command categories/titles, chat participant label, notification copy, Output channel headings, Configure Tools descriptions) starting with release v0.3.6, while retaining existing internal identifiers (`cogneeMemory.*` settings, command IDs, language model tool names) for compatibility. BackgroundOperationManager now redirects subprocess `stdout`/`stderr` into `.cognee/logs/ingest.log`, rotates it on startup, and wires the failure toast’s "View Logs" action plus Output-channel entries to that file so support and QA can access diagnostics immediately.

**Alternatives Considered**: (1) Rename internal identifiers alongside user copy—rejected for migration risk across commands/APIs. (2) Capture logs without surfacing them—rejected because it perpetuates the "black box" issue identified in Plan 019 analysis.

**Consequences**: (+) Aligns UX terminology with branding/legal requirements without breaking configuration contracts; (+) provides deterministic log access paths tied to operation IDs, improving troubleshooting; (-) requires documentation (AGENT_INTEGRATION.md, Configure Tools descriptions, architecture diagram) to be updated during implementation to avoid mixed branding. Implementers must ensure `.cognee/logs` is created lazily and log rotation prevents unbounded growth.

**Related**: Plan 019, §3.1, §4.5.1, Roadmap Epic 0.2.3.1.

## 10. Roadmap Architecture Outlook

### 10.1 v0.2.2 – Stability & Onboarding (Epics 0.2.2.1-0.2.2.3)

- **Ontology Loader Alignment (0.2.2.1)**: replace hardcoded `ontology.json` reference with TTL-aware loader. Preferred approach is to introduce an `OntologyProvider` module inside `extension/bridge` that can read TTL, validate with RDFLib, and emit JSON when needed. Packaging must guarantee `ontology.ttl` co-locates with bridge scripts; add relative path resolution plus checksum verification to catch missing assets during init.
- **Packaging Verification (0.2.2.2)**: add a Node-based `npm run verify:vsix` task that unpacks the built VSIX, ensures required files (bridge scripts, ontology, requirements, metadata) exist, and runs smoke initialization via `vsce ls`. CI must block releases if verification fails. Release checklist should reference this script; no architectural changes to runtime code, but we must document required artifacts here for planners and QA.
- **Discoverability UX (0.2.2.3)**: introduce a lightweight status service within TypeScript (e.g., `extension/src/statusService.ts`) that centralizes state (initialized, capturing enabled, Python ready). Welcome notifications, quick actions, and future inline indicators should consume this service rather than querying `CogneeClient` directly. This preserves layering (UX pulls from TS state, TS state updated by bridge results) and prepares the groundwork for later telemetry.

### 10.2 v0.2.3 – Operational Reliability (Epics 0.2.3.1-0.2.3.2)

- **Error Taxonomy (0.2.3.1)**: modify all bridge scripts to emit structured payloads: `{ success, error_code, user_message, remediation }`. Define canonical codes (e.g., `MISSING_API_KEY`, `PYTHON_DEP_NOT_FOUND`, `COGNEE_TIMEOUT`) and document mappings in this file. TypeScript layer should translate codes into actionable notifications (toast, inline message, Output log) while also logging the raw payload. Introduce a shared `ErrorMapper` module to avoid duplicated switch statements.
- **Operational Signals**: extend `CogneeClient` to publish events (success/failure) to the status service. Consider a small circular buffer persisted via VS Code `Memento` storing last N operations for QA verification.
- **Python Environment Bootstrap (0.2.3.2)**: add a new orchestrator (`extension/src/pythonSetup.ts`) that can (a) detect absence of `.venv`, (b) run `python -m venv` via VS Code terminal, (c) execute `pip install -r requirements.txt`, and (d) update `cogneeMemory.pythonPath`. For automation, introduce a helper bridge script `verify_environment.py` to validate interpreter + dependencies without altering user environments. All automation must operate within workspace directory to avoid privilege escalations.

### 10.3 v0.3.0 – Context Intelligence (Epic 0.3.0.1)

- **Ranking Pipeline**: plan for an intermediate service layer that can score retrieved memories using embeddings + heuristic weights. Likely requires persistent metadata (scores, recency) stored in `.cognee_system/` plus a TypeScript-side ranking configuration. Architectural decision needed on whether ranking occurs in Python (preferred for access to RecallFlow internals) or TS (for adjustability). Either way, we must extend retrieval results to include metadata (timestamp, importance, similarity) so TS can provide transparency.
- **Feedback Loop**: support user feedback (thumbs up/down). Requires TypeScript to capture feedback events and send them via new bridge command (`feedback.py`) that updates either RecallFlow metadata or a local JSON log. Privacy remains local; document schema here before implementation.

### 10.4 v0.4.0 – Multi-Workspace Intelligence (Epic 0.4.0.1)

- **Selective Sync Architecture**: introduce a synchronization layer capable of exporting/importing memories between workspaces while preserving isolation. Proposed design: create signed export bundles (JSON + ontology fragments) stored in user-controlled locations. Import process runs via new bridge script that maps external dataset into current workspace with explicit namespace tagging.
- **Permission & Labeling Model**: TypeScript layer must display source workspace metadata and allow revocation, implying persistent mappings stored in `.cognee/metadata.json`. Need architectural decision on how to prevent accidental leakage (e.g., require explicit user confirmation per workspace pair).
- **Scalability Considerations**: cross-workspace queries will increase dataset size; plan for pagination, caching, and potential background jobs to maintain indexes. Document thresholds and fallback strategies (e.g., disable cross-workspace retrieval when dataset exceeds configured size) ahead of implementation.

## 11. Deployment Platform Constraints

**VS Code Marketplace Requirements**:

- **Version Format**: Requires exactly 3-part semantic versioning (X.Y.Z)
  - Valid: 0.2.3, 1.0.0, 2.1.5
  - Invalid: 0.2.2.1, 1.0.0.0 (rejected with "Invalid extension version" error)
  - Constraint discovered during Plan 013.1 deployment (2025-11-17)
- **VSIX Packaging**: All assets (bridge scripts, ontology files, media) must be included in package
- **Extension Manifest**: `package.json` must conform to VS Code extension schema

**NPM Package Differences**:

- NPM supports 4-part semantic versioning (X.Y.Z.W) for pre-release/build metadata
- This creates a trap when developing VS Code extensions that also use NPM tooling
- Always verify version format during planning for VS Code extension releases

**Git Tagging**:

- No version format restrictions for git tags
- Recommended: Match git tag to published package version for traceability

## 12. Recommendations

1. **Codify Ontology Asset Strategy** – add dated decision entry once format/loader approach selected for Epic 0.2.2.1.
2. **Establish Packaging Verification Tooling** – define required artifacts and smoke tests, log decision + implementation guidance here.
3. **Define Error Contract** – before Epic 0.2.3.1, update bridge outputs with machine-readable codes; document decision and update readiness.
4. **Plan Python Environment Bootstrap** – decide where venv creation lives (TS vs helper script) and capture security constraints.
5. **Add Local Health Telemetry** – describe minimal instrumentation (logs or JSON summary) that QA can assert without remote analytics.

---

This system architecture document (and accompanying diagram) is the canonical reference for planners, critics, QA, and implementers. Future architectural changes must update the change log, relevant sections, and decision entries with timestamps so downstream agents always have a single, current view.
