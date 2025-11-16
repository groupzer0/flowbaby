# Cognee Chat Memory System Architecture

**Last Updated**: 2025-11-15 09:10
**Owner**: architect agent

## Change Log

| Date & Time | Change | Rationale | Related Epic/Plan |
|-------------|--------|-----------|-------------------|
| 2025-11-15 09:10 | Created baseline system architecture document covering Plans 001-011 | Establish single source of truth for planners/critics per updated architect instructions | Plans 001-011 summary |
| 2025-11-15 09:45 | Added forward-looking architecture mapping for roadmap epics | Provide planners with architecture guidance for v0.2.2, v0.2.3, v0.3.0, v0.4.0 | Roadmap epics 0.2.2.x-0.4.0 |


## 1. Purpose and Scope

This document captures the end-to-end architecture of Cognee Chat Memory as shipped through Plans 001–011. It serves as the baseline reference for future architectural decisions recorded in this file and for upcoming roadmap epics (0.2.2.x and 0.2.3.x). It covers components, runtime flows, data/storage boundaries, quality attributes, current problem areas, and how the existing system supports or blocks planned work.

## 2. High-Level Architecture

```text
+-------------------------------------------------------------+
|                    VS Code Extension (TS)                   |
|  - extension.ts (activation, registrations)                 |
|  - CogneeClient (subprocess orchestration, logging)         |
|  - UX surfaces (commands, status bar, chat participant)     |
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
|             Cognee SDK (cognee==0.4.0, Python)              |
|  - Knowledge graph ingestion / cognition                    |
|  - Hybrid graph/vector retrieval                            |
|  - System/data directories (.cognee_system/.cognee_data)    |
+-------------------------------------------------------------+
```

## 3. Component Responsibilities

### 3.1 VS Code Interaction Layer (TypeScript)

- Validates workspace context and loads configuration (`cogneeMemory.*` settings).
- Provides user entry points: keyboard capture command, command palette, @cognee-memory chat participant, toggle/clear commands.
- Streams UX feedback (notifications, Output channel logs, chat participant markdown).
- Delegates all knowledge operations to Python bridge via `CogneeClient` helper.

### 3.2 Bridge Execution Layer (Python)

- Executes as short-lived subprocess per operation; no resident daemons.
- Loads `.env` for `LLM_API_KEY`, sets Cognee config, enforces workspace-local storage.
- Maintains ontology assets (currently `ontology.ttl`) and dataset naming strategy.
- Handles Terraform-style migration markers to coordinate one-time pruning.
- Emits JSON envelopes for success/error, plus structured stderr for diagnostics.

### 3.3 Cognee Knowledge Layer

- External library responsible for persisting knowledge graph artifacts, running cognify pipelines, retrieving context, and pruning stale data.
- Stores data in workspace-local directories configured by bridge scripts.

## 4. Runtime Flows

### 4.1 Activation / Initialization

1. VS Code activates extension (startupFinished) and checks for workspace root.
2. `CogneeClient.initialize()` spawns `python init.py <workspace>`.
3. `init.py` loads `.env`, verifies `LLM_API_KEY`, sets Cognee directories to `.cognee_system` / `.cognee_data`, loads ontology, and writes migration markers.
4. Result JSON returns dataset metadata. TS layer logs to Output channel and either registers commands/participant (success) or surfaces guidance (failure).

### 4.2 Manual Capture Flow

1. User invokes keyboard shortcut or command palette (command `cognee.captureMessage`).
2. TypeScript collects text (input box or clipboard) and calls `CogneeClient.ingest(user, assistant)`.
3. `ingest.py` formats conversation, invokes `cognee.add` + `cognee.cognify`, referencing workspace dataset and ontology.
4. Result is logged and confirmation toast displayed.

### 4.3 Retrieval / Chat Participant Flow

1. User types `@cognee-memory` in GitHub Copilot Chat.
2. Participant handler checks `cogneeMemory.enabled`, calls `CogneeClient.retrieve(query)`.
3. `retrieve.py` (not shown here but present) performs hybrid search and returns ranked memories.
4. Participant previews retrieved context, augments prompt, streams LLM response, and optionally re-ingests conversation (feedback loop disabled by default).

## 5. Data & Storage Boundaries

- **Workspace-local**: `.cognee_system/` (Cognee internal DB) and `.cognee_data/` (vector/index artifacts) created under workspace root since Plan 010.
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
   - Errors in ingestion/retrieval often only appear in Output channel; no status bar indicator or actionable notification. Users perceive "extension does nothing".

5. **Python Environment Friction**
   - Auto-detection (Plan 007) improved logging but still requires manual `.venv` creation and dependency installation. Missing Python yields generic warnings.

6. **Operational Visibility**
   - No health telemetry (even local) for capture/retrieval success rates, making it difficult to diagnose support issues or run QA smoke tests.

7. **Testing Gaps for Packaged Builds**
   - Pytest suite runs on repo files, not packaged VSIX. Release verification lacks "install VSIX → run smoke script" step, allowing packaging drift to slip.

## 9. Architectural Decisions

### Decision: Baseline Three-Layer Architecture (2025-11-15 09:10)

**Context**: VS Code APIs are TypeScript-only, while the Cognee SDK is Python-only. Plans 001–011 implemented selective capture, workspace isolation, and chat participant retrieval without a unifying architectural narrative.
**Choice**: Maintain a three-layer separation (VS Code interaction, Python bridge, Cognee SDK) with JSON-over-stdout contracts, stateless subprocess invocations, and workspace-rooted storage. Keep all architectural documentation centralized in this file, supplemented by a single visual diagram.
**Alternatives Considered**: (1) Port Cognee features to TypeScript/HTTP, rejected due to loss of local-only privacy and engineering cost. (2) Run a persistent Python daemon, rejected for lifecycle/packaging complexity.
**Consequences**: (+) Clear ownership boundaries and easier testing. (-) Dual toolchains and subprocess latency remain. Provides stable baseline for future UX and reliability epics.
**Related**: Plans 002–011, Roadmap Epics 0.2.2.x/0.2.3.x.

## 10. Roadmap Architecture Outlook

### 10.1 v0.2.2 – Stability & Onboarding (Epics 0.2.2.1-0.2.2.3)

- **Ontology Loader Alignment (0.2.2.1)**: replace hardcoded `ontology.json` reference with TTL-aware loader. Preferred approach is to introduce an `OntologyProvider` module inside `extension/bridge` that can read TTL, validate with RDFLib, and emit JSON when needed. Packaging must guarantee `ontology.ttl` co-locates with bridge scripts; add relative path resolution plus checksum verification to catch missing assets during init.
- **Packaging Verification (0.2.2.2)**: add a Node-based `npm run verify:vsix` task that unpacks the built VSIX, ensures required files (bridge scripts, ontology, requirements, metadata) exist, and runs smoke initialization via `vsce ls`. CI must block releases if verification fails. Release checklist should reference this script; no architectural changes to runtime code, but we must document required artifacts here for planners and QA.
- **Discoverability UX (0.2.2.3)**: introduce a lightweight status service within TypeScript (e.g., `extension/src/statusService.ts`) that centralizes state (initialized, capturing enabled, Python ready). Welcome notifications, command descriptions, and status bar badges should consume this service rather than querying `CogneeClient` directly. This preserves layering (UX pulls from TS state, TS state updated by bridge results) and prepares the groundwork for later telemetry.

### 10.2 v0.2.3 – Operational Reliability (Epics 0.2.3.1-0.2.3.2)

- **Error Taxonomy (0.2.3.1)**: modify all bridge scripts to emit structured payloads: `{ success, error_code, user_message, remediation }`. Define canonical codes (e.g., `MISSING_API_KEY`, `PYTHON_DEP_NOT_FOUND`, `COGNEE_TIMEOUT`) and document mappings in this file. TypeScript layer should translate codes into notifications/status bar icons while also logging the raw payload. Introduce a shared `ErrorMapper` module to avoid duplicated switch statements.
- **Operational Signals**: extend `CogneeClient` to publish events (success/failure) to the status service. Consider a small circular buffer persisted via VS Code `Memento` storing last N operations for QA verification.
- **Python Environment Bootstrap (0.2.3.2)**: add a new orchestrator (`extension/src/pythonSetup.ts`) that can (a) detect absence of `.venv`, (b) run `python -m venv` via VS Code terminal, (c) execute `pip install -r requirements.txt`, and (d) update `cogneeMemory.pythonPath`. For automation, introduce a helper bridge script `verify_environment.py` to validate interpreter + dependencies without altering user environments. All automation must operate within workspace directory to avoid privilege escalations.

### 10.3 v0.3.0 – Context Intelligence (Epic 0.3.0.1)

- **Ranking Pipeline**: plan for an intermediate service layer that can score retrieved memories using embeddings + heuristic weights. Likely requires persistent metadata (scores, recency) stored in `.cognee_system/` plus a TypeScript-side ranking configuration. Architectural decision needed on whether ranking occurs in Python (preferred for access to Cognee internals) or TS (for adjustability). Either way, we must extend retrieval results to include metadata (timestamp, importance, similarity) so TS can provide transparency.
- **Feedback Loop**: support user feedback (thumbs up/down). Requires TypeScript to capture feedback events and send them via new bridge command (`feedback.py`) that updates either Cognee metadata or a local JSON log. Privacy remains local; document schema here before implementation.

### 10.4 v0.4.0 – Multi-Workspace Intelligence (Epic 0.4.0.1)

- **Selective Sync Architecture**: introduce a synchronization layer capable of exporting/importing memories between workspaces while preserving isolation. Proposed design: create signed export bundles (JSON + ontology fragments) stored in user-controlled locations. Import process runs via new bridge script that maps external dataset into current workspace with explicit namespace tagging.
- **Permission & Labeling Model**: TypeScript layer must display source workspace metadata and allow revocation, implying persistent mappings stored in `.cognee/metadata.json`. Need architectural decision on how to prevent accidental leakage (e.g., require explicit user confirmation per workspace pair).
- **Scalability Considerations**: cross-workspace queries will increase dataset size; plan for pagination, caching, and potential background jobs to maintain indexes. Document thresholds and fallback strategies (e.g., disable cross-workspace retrieval when dataset exceeds configured size) ahead of implementation.

## 11. Recommendations

1. **Codify Ontology Asset Strategy** – add dated decision entry once format/loader approach selected for Epic 0.2.2.1.
2. **Establish Packaging Verification Tooling** – define required artifacts and smoke tests, log decision + implementation guidance here.
3. **Define Error Contract** – before Epic 0.2.3.1, update bridge outputs with machine-readable codes; document decision and update readiness.
4. **Plan Python Environment Bootstrap** – decide where venv creation lives (TS vs helper script) and capture security constraints.
5. **Add Local Health Telemetry** – describe minimal instrumentation (logs or JSON summary) that QA can assert without remote analytics.

---

This system architecture document (and accompanying diagram) is the canonical reference for planners, critics, QA, and implementers. Future architectural changes must update the change log, relevant sections, and decision entries with timestamps so downstream agents always have a single, current view.
