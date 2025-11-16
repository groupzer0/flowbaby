# ADR 001: Cognee Chat Memory System Architecture

**Status**: Accepted (baseline)
**Date**: 2025-11-15
**Architect**: architect

## Context
The Cognee Chat Memory project blends a VS Code extension (TypeScript) with a Python bridge that orchestrates the Cognee knowledge graph SDK. Eleven completed plans delivered significant functionality (keyboard capture workflow, @cognee-memory participant, workspace-local storage, Python bridge testing), but no unified architectural record exists. Without a single reference, downstream agents (Planner, QA, Implementer) lack clarity about module boundaries, data flow, and future extensibility—especially as the roadmap now emphasizes user experience fixes (v0.2.2/v0.2.3) and future intelligence features (v0.3.x+).

Key architectural forces:
- **Separation of concerns**: VS Code APIs only accessible via TypeScript, but Cognee SDK is Python-only.
- **Workspace isolation**: Each VS Code workspace must have its own dataset and filesystem roots to avoid cross-project leakage.
- **Selective capture**: Users explicitly capture content; no background telemetry allowed.
- **Local-only operation**: No remote services—everything must run on the developer's machine.
- **Packaging and portability**: VSIX must bundle Python bridge assets while respecting users' Python environments.

## Decision
Adopt and document a three-tier architecture that cleanly separates VS Code UX, orchestration, and Cognee knowledge operations while anchoring future epics to this structure:

1. **VS Code Interaction Layer (TypeScript, `extension/src/`)**
   - Entry point `extension.ts` handles activation, workspace validation, and registers all UI surfaces (commands, status bar, chat participant).
   - `CogneeClient` encapsulates subprocess orchestration, configuration, logging, and error surfacing for Python bridge scripts.
   - UX-focused modules (commands, onboarding, status, notifications) will remain in this layer to keep Python scripts focused on data operations only.

2. **Bridge Execution Layer (Python, `extension/bridge/`)**
   - Scripts `init.py`, `ingest.py`, `retrieve.py`, and utilities provide deterministic CLI interfaces that TypeScript invokes.
   - All scripts share workspace context via CLI args, load `.env`, enforce `LLM_API_KEY`, and operate on workspace-local directories (`.cognee_system/`, `.cognee_data/`).
   - Ontology assets, dataset naming (`workspace_utils.generate_dataset_name`), and migration markers live here and must remain self-contained for packaging.

3. **Cognee Knowledge Layer (External SDK)**
   - `cognee` library (currently v0.4.0) performs ingestion (`add`), cognition (`cognify`), search, and pruning.
   - Configuration occurs per invocation via Python bridge to ensure stateless subprocesses and prevent long-lived background daemons.
   - Workspace isolation enforced by per-workspace dataset name + per-workspace filesystem roots.

Cross-cutting principles:
- **JSON over stdout** for TypeScript ↔ Python communication (consistent success/error envelopes).
- **Stateless invocations** so VS Code never keeps Python processes resident; this eases packaging/testing.
- **Workspace-rooted storage** to satisfy privacy and to allow project-specific cleanup.
- **Extensible UX surfaces** (status bar, notifications, welcome views) remain in TypeScript so they can evolve without altering bridge contracts.

## Consequences

### Positive
- Single architectural record enables consistent reasoning for future epics and ADRs.
- Clear boundaries simplify testing: TypeScript unit/integration tests focus on orchestration; Python pytest suite focuses on bridge logic.
- Workspace isolation enshrined as non-negotiable, preventing regressions like Plan 010 storage bug.

### Negative
- Dual-language architecture increases onboarding complexity (Node + Python toolchains required).
- Subprocess overhead introduces latency (especially ingestion) compared to an in-process solution.

### Neutral
- Packaging remains responsible for copying Python assets; decision neither simplifies nor complicates packaging, but it clarifies responsibility.
- Future roadmap features (ranking, multi-workspace sharing) will require additional ADRs but now have a baseline to reference.

## Alternatives Considered

### Alternative 1: Rewrite Cognee interactions in TypeScript
**Description**: Port Cognee SDK functionality (or call HTTP APIs) directly from TypeScript to eliminate Python bridge.
**Rejected because**: Cognee SDK is Python-first, porting would delay delivery and diverge from upstream updates; HTTP APIs would break "local-only" privacy requirement.

### Alternative 2: Persistent Python daemon with JSON-RPC
**Description**: Launch a background Python service once per workspace to avoid repeated subprocess spin-up.
**Rejected because**: Adds lifecycle complexity (cleanup, crash recovery), increases long-running resource usage, and complicates VSIX packaging; current workload is light enough for subprocess model.

## Related Decisions
- (Future) ADR-002+: Epic-specific architectural decisions will reference this baseline for module ownership and constraints.

## Implementation Guidance
- Maintain `CogneeClient` as the sole TypeScript module that understands subprocess details; other modules should depend on its high-level methods (`initialize`, `ingest`, `retrieve`, `clearMemory`).
- Continue to add bridge scripts/utilities under `extension/bridge/` with dedicated pytest coverage; share helpers via `workspace_utils.py` rather than embedding logic in each script.
- When new UX features require persistent state (e.g., onboarding dismissal), store data via VS Code Memento APIs in TypeScript; avoid leaking such concerns into Python.
- Treat `LLM_API_KEY`, ontology assets, and dataset naming as bridge responsibilities; TypeScript should only surface guidance and results.

## Validation
- Smoke test by installing VSIX, verifying activation logs in Output channel, and confirming that `init`, `ingest`, and `retrieve` invocations succeed via `CogneeClient`.
- Unit test coverage: `extension/bridge/tests/` for Python logic, VS Code integration tests for TypeScript commands/participant.
- Architectural completeness validated when future epics can reference this ADR without re-describing core system structure.
