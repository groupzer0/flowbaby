# Cognee Chat Memory - Product Roadmap

**Last Updated**: 2025-11-17 (Roadmap Agent)
**Roadmap Owner**: roadmap agent

---

## 🎯 Master Product Objective

### ⚠️ IMMUTABLE - USER MODIFICATION ONLY ⚠️

This master objective defines the fundamental value proposition of Cognee Chat Memory. All epics, plans, architecture, and implementation must align with and support this objective. Agents are FORBIDDEN from modifying this section.

### Value Statement

**As a developer working in VS Code,**
**I want to maintain perfect context across coding sessions by automatically capturing and intelligently retrieving workspace-specific knowledge through natural language,**
**So that I eliminate the repeated need to reconstruct context for the AI agents and so that the AI agent can focus on solving that are properly contextualized.**

### Core Principles

1. **Automatic Context Capture** - Knowledge is captured seamlessly without disrupting developer flow
2. **Natural Language Retrieval** - Developers retrieve context by asking questions, not searching files
3. **Workspace Isolation** - Context is private, local, and specific to each project
4. **Zero Cognitive Overhead** - The extension should fade into the background, never becoming a burden itself

### Success Metrics

- Developers can resume work on any project instantly without re-reading documentation or chat history
- Context retrieval feels as natural as asking a teammate
- No setup friction prevents developers from experiencing value
- Privacy and control remain entirely in developer's hands

---

## Executive Summary

**Current State (v0.2.3)**: Extension has functional chat capture (Ctrl+Alt+C) and @cognee-memory participant retrieval with improved discoverability and transparency:

1. ✅ **Installation Stability**: v0.2.2 resolved initialization regression (ontology file mismatch)
2. ✅ **Feature Discoverability**: Plans 013/013.1 delivered display transparency, ingestion metrics, and timeout handling
3. **Silent Failures**: Still needs comprehensive error taxonomy and status indicators (Plan 016)
4. **Setup Friction**: Manual Python environment setup required before any functionality works (Plan 017)

**Strategic Course Correction**: Comprehensive review of Plans 001-011 revealed that technical infrastructure (workspace isolation, Python detection, testing) is solid, but **user-facing experience is critically deficient**. Plans 001-011 were heavily implementation-focused with minimal UX consideration. The roadmap now prioritizes:

- **v0.2.2** ✅ COMPLETE (2025-11-17): Fix initialization regression + ensure reliable packaging
- **v0.2.3** ✅ PARTIALLY COMPLETE (2025-11-17): Display transparency and ingestion reliability delivered (Plans 013/013.1)
- **v0.3.0** (Target: TBD): Context intelligence (UNBLOCKED - ready to proceed)
- **v0.2.4** (Target: TBD): Comprehensive error handling and Python auto-setup (Plans 016/017)

**Implementation Mapping** (Plans → Epics):

- **Plan 012** ✅ Complete → Epic 0.2.2.1 (Installation), Epic 0.2.2.2 (Packaging)
- **Plan 013** ✅ Complete → Epic 0.2.2.3 (Discoverability)
- **Plan 013.1** ✅ Complete → Epic 0.2.2.3 (Discoverability - ingestion reliability)
- **Plan 014** (Proposed) → Epic 0.3.0.2 (Structured Summaries) - prerequisite for Plans 015/016
- **Plan 014.1** ✅ Complete → Epic 0.3.0.3 (feasibility validation for languageModelTools integration)
- **Plan 015** (Proposed) → Epic 0.3.0.3 (Agent-Driven Memory Integration - ingestion)
- **Plan 016** ✅ Complete → Epic 0.3.0.3 (Agent-Driven Memory Integration - retrieval + UI visibility)
- **Plan 016.1** ✅ Complete → Epic 0.3.0.3 (Tool lifecycle hotfix)
- **Plan 017** (Ready for Implementation) → Async cognify() optimization - unblocks testing and Epic 0.3.0.1
- **Plan 018** (Proposed) → Epic 0.3.0.1 (Metadata infrastructure + Ranking) + Icons (participant + extension)
- **Plan 019** (Proposed) → Epic 0.3.0.1 (Compaction pipeline - merge summaries, conflict detection)
- **Plans TBD** → Epic 0.2.3.1 (Error Transparency), Epic 0.4.0.2 (Auto-Setup Wizard), Epic 0.4.0.3 (Memory Browser), Epic 0.4.0.4 (Graph Export)

**Strategic Decision**: Plans 012/013/013.1 resolve v0.2.x blockers; v0.3.0 work (Plans 014/015) can now proceed. Remaining v0.2.x epics (Plans 016/017) enhance UX but don't block advanced features—proceed in parallel.

## Change Log

| Date | Change | Rationale |
|------|--------|-----------|
| 2025-11-21 | Added four v0.4.0 epics: Auto-Setup Wizard (0.4.0.2), Memory Browser (0.4.0.3), Context Cards, Graph Export (0.4.0.4) | UX improvement brainstorming identified key onboarding and transparency features. Auto-Setup Wizard reduces friction by guiding Python/venv setup post-install via `Cognee: Initialize Workspace` command + walkthrough (aligns with VS Code 1.106 best practices). Memory Browser and Context Cards make Plan 018 metadata actionable through persistent UI. Graph Export leverages graph backend to visualize knowledge relationships. |
| 2025-11-21 | Plan 018/019 scope split: Plan 018 = Metadata infrastructure + Ranking + Icons (v0.3.5), Plan 019 = Compaction pipeline (v0.3.6) | User requested separation of compaction work from Plan 018 to reduce plan complexity and enable independent delivery of metadata/ranking features. Plan 018 delivers metadata schema, recency-aware ranking, status filtering, and visual identity. Plan 019 delivers memory compaction pipeline (merge summaries into DecisionRecords, conflict detection, manual/auto-compaction). |
| 2025-11-20 | Plan 017/018 sequencing finalized: Plan 017 = Async cognify() optimization (v0.3.4), Plan 018 = Metadata infrastructure + Icons (v0.3.5) | User prioritized async optimization to unblock testing workflows - 73s synchronous ingestion blocks automation testing and would create poor UX during metadata testing. Plan 018 will bundle metadata infrastructure (Epic 0.3.0.1) with icon assets (participant + extension identity). Icons added to implementation mapping as Plan 018 deliverable. |
| 2025-11-19 | Plan 016 merged scope finalized: Agent retrieval infrastructure + UI-visible extension tools combined into single comprehensive plan targeting v0.3.2 | User clarified that extension tools (not MCP) are the path to Configure Tools UI visibility via `canBeReferencedInPrompt` and `toolReferenceName` flags. Plan 016 now delivers both agent retrieval capabilities (CogneeContextProvider, retrieveForAgent command, structured responses) AND tool UI visibility (`#` autocomplete, `.agent.md` support, Configure Tools appearance) as interdependent features. Epic 0.3.0.3 acceptance criteria updated to reflect merged scope. |
| 2025-11-19 | Plan 014.1 complete: languageModelTools validated as primary Copilot integration path; Epic 0.3.0.3 unblocked | Plan 014.1 confirmed VS Code's `languageModelTools` API is the officially supported mechanism for Copilot agent integration (vs undocumented command invocation). Architecture updated to contribute Cognee tools that proxy into existing commands, preserving fallback strategies (direct commands, MCP). Epic 0.3.0.3 ready for implementation (Plans 015/016). |
| 2025-11-18 | **STRATEGIC PIVOT**: Epic 0.3.0.2 scope revised - @cognee-memory participant summarization deferred; adding Epic 0.3.0.3 for agent-driven memory integration | User testing revealed two critical misalignments: (1) @cognee-memory augments answers with LLM training data instead of constraining to stored memories only, violating workspace-local memory principle; (2) "summarize this conversation" only sees @cognee-memory turns, not the broader Copilot agent conversations users want to summarize. Root cause: chatContext.history is participant-scoped, not session-scoped. **Strategic solution**: Instead of forcing @cognee-memory to summarize conversations it wasn't part of, expose Cognee ingest/retrieve functions so Copilot agents can manage their own memory (store summaries of agent conversations, retrieve context when needed). This aligns with Master Product Objective: "eliminate repeated context reconstruction **for AI agents**" - agents should be memory-aware, not reliant on a separate memory participant. Requires feasibility analysis (Plan 014.1) before implementation. |
| 2025-11-17 | Plans 013 and 013.1 completed: display transparency (removed 150-char truncation), ingestion metrics (token count, chunk count, duration), timeout handling (30s → 300s configurable), streaming progress indicators | Delivered Epic 0.2.2.3 (Feature Discoverability) - users now see full memory content, ingestion feedback, and reliable operation. Unblocks v0.3.0 work (Plans 014/015). |
| 2025-11-17 | Strategic unblocking: Plans 012 (implemented) and 013 (planned) resolve v0.2.x blockers; Epic 0.3.0.1 unblocked after Plan 013; added Epic 0.3.0.2; split error handling (Plan 016) and Python setup (Plan 017) into separate plans | Plans 012/013 address installation stability (0.2.2.1) and discoverability (0.2.2.3), enabling v0.3.0 work to proceed. Remaining v0.2.3 epics (error transparency, auto-setup) are valuable but not blocking—can proceed in parallel. Created focused plan structure: 013 (display fixes), 016 (error taxonomy), 017 (Python auto-setup) for better isolation and parallel development. |
| 2025-11-16 | Added 3 new epics (0.2.2.3, 0.2.3.1, 0.2.3.2); revised v0.3.0 scope | Comprehensive review of Plans 001-011 revealed critical gaps: UX discoverability, Python environment complexity, and lack of operational monitoring. User cannot discover features after installation even if initialization succeeds. Shifted v0.3.0 focus from ranking (which requires baseline usage) to foundational UX and reliability. |
| 2025-11-15 | Initial roadmap created | Establishing strategic direction after completing v0.2.0 foundation |

---

## Release v0.2.2 - Stability and User Onboarding

**Target Date**: 2025-11-18
**Strategic Goal**: Ensure users can successfully install and use core capture/retrieval features without encountering setup blockers or confusing error messages.

### Epic 0.2.2.1: Smooth Extension Installation

**Priority**: P0 (Critical - blocks all user value)
**Status**: Planned

**User Story**:
As an extension user,
I want Cognee Chat Memory to initialize successfully after installation,
So that I can capture and recall workspace context without setup blockers.

**Business Value**:
- **User Impact**: Every new install currently fails, preventing any value delivery
- **Strategic Importance**: Installation is the gateway to all other features; failure here means zero adoption
- **Measurable Success**: Extension initializes successfully on first install with clear onboarding

**Dependencies**:
- None (this is foundational)

**Acceptance Criteria** (outcome-focused):
- [ ] User installs VSIX and extension initializes without errors
- [ ] User sees clear, accurate guidance for required setup (LLM_API_KEY, not OPENAI_API_KEY)
- [ ] User can immediately use capture commands after providing API key
- [ ] Ontology configuration loads correctly from packaged assets

**Constraints**:
- Must maintain backward compatibility with existing workspace storage structure
- Must not break existing users who have v0.2.0/v0.2.1 already installed

**Status Notes**:

- 2025-11-17: **RESOLVED** - Plan 012 implemented (pending QA). Ontology loading fixed, API key messaging updated, packaging verification added.
- 2025-11-15: Epic created based on Plan 012 analysis findings. Ontology file format mismatch (JSON vs TTL) and outdated error messaging block all new installs.

---

### Epic 0.2.2.2: Reliable Packaging and Release Process

**Priority**: P0 (Critical - prevents future regressions)
**Status**: Planned

**User Story**:
As a product maintainer,
I want releases to include all required runtime assets and accurate documentation,
So that users never encounter missing-file errors or outdated guidance.

**Business Value**:
- **User Impact**: Prevents entire classes of "works on dev machine, broken in production" failures
- **Strategic Importance**: Regression prevention reduces support burden and maintains user trust
- **Measurable Success**: Automated checks catch packaging issues before release

**Dependencies**:
- Epic 0.2.2.1 (must establish what "correct packaging" means)

**Acceptance Criteria** (outcome-focused):
- [ ] VSIX build process includes automated verification of required assets
- [ ] Release checklist enforced through tooling, not manual memory
- [ ] Smoke tests validate extension initializes with packaged assets (not just dev environment)
- [ ] Documentation references current environment variables and setup steps

**Constraints**:
- Verification script must run in CI/GitHub Actions
- Must not significantly slow down build process

**Status Notes**:
- 2025-11-15: Epic created based on Plan 012 analysis findings. QA process missed packaging regression because tests used fixtures that masked the missing ontology file.

---

### Epic 0.2.2.3: Feature Discoverability and Onboarding UX

**Priority**: P0 (Critical - users cannot discover core features)
**Status**: ✅ Delivered (Plans 013/013.1)

**User Story**:
As a new extension user,
I want to understand what the extension can do and how to use it immediately after installation,
So that I can start capturing and retrieving context without reading external documentation.

**Business Value**:
- **User Impact**: Users who successfully install (post-0.2.2.1) still don't know keyboard shortcuts, participant commands, or workflow patterns
- **Strategic Importance**: Feature adoption requires discoverability; invisible features deliver zero value
- **Measurable Success**: Users invoke capture command within 5 minutes of installation without consulting docs

**Dependencies**:
- Epic 0.2.2.1 (users must be able to initialize before discovering features)

**Acceptance Criteria** (outcome-focused):
- [x] ✅ Display transparency: Removed 150-char truncation, users see full memory content (Plan 013)
- [x] ✅ Ingestion metrics: Token count, chunk count, duration displayed after capture (Plan 013.1)
- [x] ✅ Timeout handling: Configurable timeout (30s → 300s) with streaming progress (Plan 013.1)
- [x] ✅ Query transparency: Improved logging shows what memories are retrieved (Plan 013)
- [ ] ⏳ First-run welcome message with quick-start actions (deferred to Plan 016)
- [ ] ⏳ Status bar indicators for extension state (deferred to Plan 016)
- [ ] ⏳ @cognee-memory participant help text (deferred to future enhancement)

**Constraints**:
- Must not be intrusive or annoying to existing users
- Should respect VS Code's notification guidelines (not spam)

**Status Notes**:

- 2025-11-17: **✅ DELIVERED** - Plans 013 and 013.1 completed:
  - **Plan 013**: Removed 150-char display truncation, improved query logging, enhanced retrieval transparency
  - **Plan 013.1**: Added ingestion metrics (tokens, chunks, duration), timeout handling (300s configurable), streaming progress indicators
  - **Outcome**: Users now see full memory content, understand what's being captured, and get feedback on ingestion success
  - **Remaining**: First-run onboarding, status bar indicators, and comprehensive error taxonomy deferred to Plans 016/017
- 2025-11-16: Epic created based on Plans 001-011 review. Plans focused heavily on technical infrastructure but delivered minimal user-facing guidance. Even with working capture/retrieval, users don't know the extension exists or how to use it. Plan 008 implemented keyboard shortcut (Ctrl+Alt+C) and participant but provided no in-product discovery mechanism.

---

## Release v0.2.3 - Operational Reliability

**Target Date**: 2025-11-25
**Strategic Goal**: Eliminate silent failures and environment setup friction so users trust the system runs correctly.

### Epic 0.2.3.1: Transparent Operation and Error Recovery

**Priority**: P0 (Critical - silent failures erode trust)
**Status**: Planned

**User Story**:
As an extension user,
I want to know when capture or retrieval fails and why,
So that I can take corrective action instead of assuming the extension is broken.

**Business Value**:
- **User Impact**: Current implementation has 30s timeout issues (Cognee 0.4.0 bug), file hashing problems, and initialization failures that manifest as silent non-operation
- **Strategic Importance**: Silent failures lead to "the extension doesn't work" perception and immediate uninstall
- **Measurable Success**: Users see actionable error messages for 100% of failures; support requests include specific error codes

**Dependencies**:
- None (independent of other epics)

**Acceptance Criteria** (outcome-focused):
- [ ] Capture failures show user-friendly notification with specific cause ("API key invalid", "Cognee service timeout", "Python environment missing")
- [ ] Retrieval failures degrade gracefully (show "No results found" vs silent failure)
- [ ] Output channel logs structured error context (timestamps, operation type, error category)
- [ ] Status bar icon reflects operational state (working, error, disabled)
- [ ] Known issues (like Cognee 0.4.0 file hashing bug) proactively detected and explained to user

**Constraints**:
- Error messages must be user-actionable, not technical stack traces
- Should not spam notifications for transient issues

**Status Notes**:

- 2025-11-17: **PROPOSED** - Will be addressed by Plan 016 (separate from Plan 013). Requires system-wide error taxonomy design, structured error propagation, status bar indicators.
- 2025-11-16: Epic created based on Plans 010-011 findings. CHANGELOG notes "Known Issues: Cognee 0.4.0 file hashing bug affects auto-ingestion" but users have no visibility into whether this is affecting them. Plan 010 fixed 30s timeout issues but didn't add user-facing error reporting. Plan 009 fixed silent activation failure, but pattern of silent failures persists.

---

### Epic 0.2.3.2: Simplified Python Environment Setup

**Priority**: P1 (High - reduces setup friction)
**Status**: Planned

**User Story**:
As an extension user without a pre-configured Python environment,
I want the extension to guide me through Python setup or automatically create an isolated environment,
So that I can start using memory features without troubleshooting dependency conflicts.

**Business Value**:
- **User Impact**: Plan 007 implemented intelligent detection but still requires users to manually create .venv and install dependencies
- **Strategic Importance**: Every setup step is a drop-off point; reducing from N manual steps to zero dramatically increases adoption
- **Measurable Success**: 90% of users never see "Python environment not found" error

**Dependencies**:
- None (can be delivered independently)

**Acceptance Criteria** (outcome-focused):
- [ ] Extension detects missing Python and offers to create workspace .venv automatically
- [ ] User clicks "Set Up Python Environment" button and extension handles venv creation + pip install
- [ ] Fallback: If auto-setup fails, show step-by-step guided instructions with clipboard-ready commands
- [ ] Status bar shows Python environment health (ready, missing, outdated dependencies)
- [ ] Works across Windows, macOS, Linux without platform-specific manual steps

**Constraints**:
- Must respect existing .venv if present (don't override user's environment)
- Auto-install must use workspace-local .venv, not global site-packages
- Should validate Python version compatibility (3.8+ required)

**Status Notes**:

- 2025-11-17: **PROPOSED** - Will be addressed by Plan 017 (separate from Plan 013). Requires platform-specific venv creation, subprocess orchestration, cross-platform testing.
- 2025-11-16: Epic created based on Plan 007 review. Plan 007 delivered auto-detection of .venv and enhanced error messages, but setup remains manual. SETUP.md requires users to run terminal commands before extension works. This creates multi-step onboarding friction that loses users.

---

## Release v0.3.0 - Enhanced Context Intelligence

**Target Date**: TBD (deferred until v0.2.x operational reliability achieved)
**Strategic Goal**: Improve relevance and utility of retrieved context so users trust the system to surface what they need.

**Course Correction**: Originally planned for immediate post-v0.2.2 delivery, but comprehensive review of Plans 001-011 revealed foundational UX and reliability gaps must be addressed first. Context ranking is only valuable once users can discover, use, and trust the basic capture/retrieval workflow.

### Epic 0.3.0.1: Context Ranking and Relevance

**Priority**: P1 (High value - deferred until foundational UX delivered)
**Status**: Backlog (blocked by v0.2.x epics)

**User Story**:
As a developer retrieving context,
I want the most relevant information surfaced first,
So that I don't waste time sifting through tangential results.

**Business Value**:
- **User Impact**: Reduces friction in retrieval workflow, increases trust in system
- **Strategic Importance**: Relevance determines whether users adopt retrieval as primary workflow
- **Measurable Success**: Users report finding needed context in first 3 results >80% of time

**Dependencies**:
- **✅ RESOLVED**: Epic 0.2.2.3 (display transparency, ingestion reliability) - Plans 012/013/013.1 complete
- **PREREQUISITE**: Epic 0.3.0.2 (structured summaries) - Plan 014 must establish content schema before metadata
- **PREREQUISITE**: Plan 017 (async cognify optimization) - testing and metadata ingestion blocked by 73s synchronous operations
- Requires stable v0.2.x foundation with real usage data to inform ranking approach

**Acceptance Criteria** (outcome-focused):
- [ ] Metadata infrastructure introduced (topic_id, session_id, plan_id, status, timestamps) via Cognee DataPoints (Plan 018)
- [ ] Plan 014 summaries migrated to DataPoints with generated metadata (one-time migration script) (Plan 018)
- [ ] Retrieval results ranked by recency-aware scoring (exponential decay, configurable alpha and halfLifeDays) (Plan 018)
- [ ] Status-aware retrieval filters Superseded summaries, prioritizes DecisionRecords (Plan 018)
- [ ] Compaction pipeline creates DecisionRecords from multiple summaries with conflict detection (Plan 019)
- [ ] Ranking transparency displays relevance scores and metadata in UI (Plan 018)

**Constraints**:
- Must maintain <2s retrieval performance target
- Should work within existing workspace-local storage model
- Must support migration of Plan 014 content-only summaries without data loss

**Status Notes**:

- 2025-11-20: **BLOCKED - Plan 017 prerequisite** - Async cognify() optimization required before implementing metadata infrastructure. Current 73s synchronous ingestion blocks testing workflows and would create poor UX during metadata testing. Plan 017 (async optimization) → Plan 018 (metadata infrastructure) sequencing prioritizes practical testing needs.
- 2025-11-17: Epic unblocked after Plans 012/013/013.1 completed installation stability and display transparency.
- 2025-11-16: DEFERRED - Review of Plans 001-011 revealed users cannot yet discover or reliably use basic retrieval. Ranking optimization premature until foundational UX and error handling delivered in v0.2.x.
- 2025-11-15: Epic placeholder. Requires research phase to determine ranking approach.

---

### Epic 0.3.0.2: Structured Conversation Summaries (Bridge Infrastructure Only)

**Priority**: P1 (High value - prerequisite for Epic 0.3.0.3)
**Status**: Revised (Plan 014 - scope narrowed to bridge contract only)

**User Story**:
As a Cognee bridge consumer (future Copilot agents or extension features),
I want a stable ingestion and retrieval contract for structured conversation summaries,
So that I can store and retrieve organized context (decisions, rationale, references) regardless of where conversations happen.

**Business Value**:

- **User Impact**: Provides foundation for agent-driven memory (Epic 0.3.0.3) and future ranking/compaction (Epic 0.3.0.1)
- **Strategic Importance**: Establishes bridge contract that multiple consumers can use; decouples storage format from UX surface
- **Measurable Success**: Bridge contract documented and tested; structured summaries ingestible and retrievable via Python bridge

**Dependencies**:

- Epic 0.2.2.3 (operational transparency and reliability must be proven)
- Plan 014 delivers this epic (scope narrowed to bridge only)

**Acceptance Criteria** (outcome-focused):

- [ ] Bridge contract documented (`DATAPOINT_SCHEMA.md`, `RETRIEVE_CONTRACT.md`) with structured summary schema (Topic, Context, Decisions, Rationale, Open Questions, Next Steps, References, Time Scope) plus metadata fields (topic_id, session_id, plan_id, status, timestamps)
- [ ] `ingest.py --summary` accepts structured JSON and stores summaries as enriched text with embedded metadata (Cognee 0.3.4 fallback per §4.4.1)
- [ ] `retrieve.py` returns structured JSON with metadata fields parsed from enriched text; handles mixed-mode (enriched summaries + legacy raw-text)
- [ ] Bridge contract tests validate ingestion, retrieval, and mixed-mode handling
- [ ] **OUT OF SCOPE**: @cognee-memory participant summarization (deferred - see Epic 0.3.0.3 rationale)

**Constraints**:

- Must maintain backward compatibility with existing raw-text memories
- Enriched-text fallback is temporary until Cognee exposes DataPoint APIs
- Template versioning required; changes to section headings need synchronized updates across summaryTemplate.ts, ingest.py, retrieve.py

**Status Notes**:

- 2025-11-18: **SCOPE NARROWED** - Epic now focuses only on bridge infrastructure (ingestion/retrieval contract). @cognee-memory participant summarization removed from Plan 014 scope due to architectural mismatch: (1) Participant can only summarize its own turns, not broader Copilot agent conversations; (2) Retrieval path currently augments answers with LLM training data instead of constraining to stored memories. Strategic pivot: expose Cognee functions to Copilot agents instead (see Epic 0.3.0.3). Plan 014 Milestones 0/1/3/4 remain (bridge contract, schema, ingestion, retrieval); Milestone 2 (participant summarization) deferred pending Plan 019 feasibility analysis.
- 2025-11-17: Epic updated to reflect Plan 014 scope accurately. Plan 014 delivers content structure (schema), Plan 015 delivers metadata infrastructure. Epic 0.3.0.2 focuses on content organization, Epic 0.3.0.1 adds intelligence layer (metadata, ranking, compaction).

---

### Epic 0.3.0.3: Agent-Driven Memory Integration

**Priority**: P0 (Critical - addresses core architectural misalignment)
**Status**: ✅ Unblocked - Plan 014.1 Complete (languageModelTools validated)

**User Story**:
As a developer using GitHub Copilot agents (@workspace, coding agent, etc.),
I want those agents to automatically store summaries of our conversations and retrieve relevant past context,
So that agents maintain continuity across sessions without me manually reconstructing context.

**Business Value**:

- **User Impact**: Enables the Master Product Objective's core promise - "eliminate repeated context reconstruction **for AI agents**" - by making agents memory-aware instead of requiring a separate memory participant
- **Strategic Importance**: Corrects architectural mismatch where @cognee-memory cannot access broader Copilot conversations; aligns with VS Code's agent-centric chat model and officially supported tool surface
- **Measurable Success**: Copilot agents store conversation summaries automatically; retrieve context when needed; users see continuity across sessions

**Dependencies**:

- **PREREQUISITE**: Epic 0.3.0.2 (bridge contract for structured summaries must exist)
- **✅ RESOLVED**: Plan 014.1 confirmed `languageModelTools` as the supported Copilot integration path (2025-11-19)

**Acceptance Criteria** (outcome-focused):

**Tool Visibility & Discovery** (Plan 016 - Milestones 4-5):
- [ ] Both tools (`cognee_storeMemory`, `cognee_retrieveMemory`) appear in VS Code "Configure Tools" dialog
- [ ] Tools include UI visibility flags: `canBeReferencedInPrompt: true`, `toolReferenceName`, `icon`
- [ ] Custom agents can reference tools via `#cogneeStoreSummary` and `#cogneeRetrieveMemory` autocomplete
- [ ] Custom agent `.agent.md` files can declare tools in `tools: ['cogneeStoreSummary', 'cogneeRetrieveMemory']` front-matter
- [ ] Tool confirmation messages show workspace context and describe operation clearly

**Agent Retrieval Infrastructure** (Plan 016 - Milestones 1-3):
- [ ] `CogneeContextProvider` service centralizes retrieval logic, enforces rate limits (max 2 concurrent, queue size 5, clamped to max 5/30)
- [ ] `cogneeMemory.retrieveForAgent` command returns structured `CogneeContextEntry` responses (summaryText, decisions, metadata)
- [ ] Access gated behind `cogneeMemory.agentAccess.enabled` workspace setting (default: disabled)
- [ ] Enabling agent access registers tool contributions; disabling unregisters them to remove from Copilot's tool selection
- [ ] Agent commands return structured retrieval results with metadata (topicId, planId, createdAt, score) when available

**Tool Integration** (Plan 015 + 016):
- [ ] Cognee contributes `languageModelTools` (`cognee_storeMemory`, `cognee_retrieveMemory`) via package.json
- [ ] Tools implement `LanguageModelTool` interface with `prepareInvocation()` and `invoke()` methods
- [ ] Tools proxy to internal commands (`cogneeMemory.ingestForAgent`, `cogneeMemory.retrieveForAgent`) for business logic
- [ ] Direct command invocation preserved for non-Copilot VS Code extensions

**Transparency & Audit** (Plan 016 - Milestone 7):
- [ ] All tool invocations logged to Output channel with timestamp, query hash, result count, token usage
- [ ] Status bar indicator shows "Cognee Agent Access: Enabled" when `agentAccess.enabled = true`
- [ ] Status bar changes icon/color during active agent retrieval; click opens Output channel
- [ ] Documentation explains tool integration model, privacy controls, opt-in workflow, and fallback support (direct commands for non-Copilot extensions, MCP as contingency)

**Testing & Documentation** (Plan 016 - Milestones 8-9):
- [ ] Reference test agent extension demonstrates round-trip store/retrieve integration
- [ ] README includes "Using Cognee Tools with Custom Agents" section with `.agent.md` examples
- [ ] AGENT_INTEGRATION.md provides comprehensive integration guide for third-party extension developers
- [ ] Integration tests validate tool registration/unregistration, round-trip store→retrieve, error handling

**Constraints**:

- Must preserve workspace-local privacy (no agent can access memories from other workspaces)
- Tool metadata (name/title/description) must accurately describe privacy behaviors and workspace isolation
- LLM usage restricted to formatting/structuring retrieved memories, not generating new content from training data
- Rate limiting prevents subprocess overload from multiple simultaneous agent requests

**Resolved Questions (from Plan 014.1)**:

1. ✅ **Tool Surface**: `languageModelTools` is the officially supported Copilot integration mechanism (vs undocumented `executeCommand`)
2. ✅ **Authorization**: Workspace-global access model with opt-in setting; tool registration/unregistration enforces enable/disable
3. ⏳ **Chat History Access**: Deferred - agents pass conversation context as tool arguments rather than extension accessing history directly
4. ✅ **Privacy Controls**: Tool contribution clearly documents workspace-wide access; enabling agent access shows status bar indicator
5. ✅ **Rate Limiting**: `CogneeContextProvider` enforces concurrency limits (2 concurrent, queue size 5) with fast-fail on overflow

**Status Notes**:

- 2025-11-19: **✅ READY FOR IMPLEMENTATION** - Plan 016 merged scope complete (agent retrieval + UI-visible tools), pending critic review. Plan 016 combines:
  - **Agent Retrieval Infrastructure**: `CogneeContextProvider` service, `retrieveForAgent` command, structured `CogneeContextEntry` responses, concurrency/rate limiting
  - **UI-Visible Tools**: Both `storeMemory` and `retrieveMemory` tools configured with `canBeReferencedInPrompt: true`, `toolReferenceName` properties, and `icon` for Configure Tools UI visibility
  - **Custom Agent Integration**: Tools support `#` autocomplete, `.agent.md` front-matter references, confirmation messages, comprehensive documentation
  - **Transparency**: Output channel logs, status bar indicator, audit trail for all agent activity
  - Plan 015 (agent ingestion) is prerequisite; Plan 014 (bridge contract) is blocking dependency
- 2025-11-19: Plan 014.1 complete. Architecture updated to adopt `languageModelTools` as primary integration path (ADR: "Copilot Tool Surface vs Direct Commands"). Tool entry command proxies into existing headless commands, preserving command/MCP fallback strategies.
- 2025-11-18: **EPIC CREATED** - Strategic pivot from @cognee-memory participant-driven summarization to agent-driven memory integration. Addresses two critical issues discovered in v0.3.1 user testing: (1) @cognee-memory cannot summarize conversations it wasn't part of (chatContext.history is participant-scoped); (2) retrieval augments answers with LLM training data instead of constraining to stored memories. Solution: expose Cognee functions so agents manage their own memory.

---

## Release v0.4.0 - Multi-Workspace Intelligence

**Target Date**: TBD
**Strategic Goal**: Enable cross-workspace learning while maintaining privacy and isolation.

### Epic 0.4.0.1: Selective Cross-Workspace Context Sharing

**Priority**: P2 (Nice to have)
**Status**: Backlog

**User Story**:
As a developer working across multiple related projects,
I want to selectively share learnings between workspaces,
So that I can leverage patterns discovered in one project while working on another.

**Business Value**:
- **User Impact**: Reduces cognitive load of remembering patterns across projects
- **Strategic Importance**: Differentiates from simple per-workspace note-taking tools
- **Measurable Success**: Users explicitly share context across workspaces >50% of multi-project sessions

**Dependencies**:
- Requires v0.3.0 relevance features
- Requires architectural design for opt-in sharing model

**Acceptance Criteria** (outcome-focused):
- [ ] User can opt-in to cross-workspace context on per-workspace basis
- [ ] Shared context clearly labeled with source workspace
- [ ] Privacy maintained (no leakage of private/sensitive context)
- [ ] User can revoke sharing permissions at any time

**Constraints**:
- Must preserve workspace isolation as default
- Cannot compromise existing single-workspace performance

**Status Notes**:
- 2025-11-15: Epic placeholder. Requires significant architectural planning.

---

### Epic 0.4.0.2: Auto-Setup Wizard and Onboarding

**Priority**: P1 (High value - reduces setup friction)
**Status**: Backlog

**User Story**:
As a new extension user,
I want the extension to guide me through environment setup automatically,
So that I can start capturing and retrieving context without troubleshooting dependencies.

**Business Value**:
- **User Impact**: Eliminates manual Python/venv setup that currently blocks 90% of new users
- **Strategic Importance**: Zero-friction onboarding directly supports "Zero Cognitive Overhead" core principle
- **Measurable Success**: 90% of users complete setup on first attempt without consulting docs

**Dependencies**:
- None (can be delivered independently)

**Acceptance Criteria** (outcome-focused):
- [ ] `Cognee: Initialize Workspace` command checks Python, offers one-click `.venv` creation, installs bridge deps
- [ ] Setup progress streams to Output channel and status-bar badge with clear success/failure indicators
- [ ] VS Code walkthrough launches after successful setup, highlighting capture shortcuts, @cognee-memory usage, ranking signals
- [ ] Walkthrough includes "try it now" buttons that invoke commands (capture, retrieve) for immediate hands-on learning
- [ ] Status bar displays persistent Python env health; clicking opens diagnostics panel with quick fixes

**Constraints**:
- Must respect existing `.venv` if present (don't override user's environment)
- Auto-install must use workspace-local `.venv`, not global site-packages
- Walkthrough must use VS Code's `contributes.walkthroughs` standard (not custom webview unless necessary)

**Status Notes**:
- 2025-11-21: Epic created based on UX improvement brainstorming. Aligns with Microsoft's activation-event and walkthrough guidelines (v1.106, Nov 2025) for post-install setup patterns.

---

### Epic 0.4.0.3: Memory Browser and Context Cards

**Priority**: P2 (Nice to have - enhances discoverability)
**Status**: Backlog

**User Story**:
As a developer using Cognee Chat Memory,
I want to browse and audit stored memories with rich metadata visualization,
So that I understand what the system knows and can act on context directly.

**Business Value**:
- **User Impact**: Makes Plan 018 metadata (ranking, status, topics) actionable; enables manual memory management
- **Strategic Importance**: Transparency builds trust; browser view surfaces hidden value in stored context
- **Measurable Success**: 50% of active users open Memory Browser at least once per session

**Dependencies**:
- **PREREQUISITE**: Plan 018 (metadata infrastructure) must be complete
- Ideally delivered after Plan 019 (compaction) to surface DecisionRecords

**Acceptance Criteria** (outcome-focused):
- [ ] `Cognee Memories` tree view groups entries by topic_id/status with expandable metadata
- [ ] Quick actions on each entry: open source file, copy decisions, mark as favorite/archived
- [ ] Retrieval results (in chat or agent responses) render as rich cards with relevance bars, metadata badges, inline actions (pin, open, copy)
- [ ] Context cards make ranking/status/timestamps visible to users during retrieval workflows
- [ ] Memory browser supports filtering (Active/Superseded/DecisionRecord) and search by topic/plan

**Constraints**:
- Tree view must lazy-load for large workspaces (1000+ summaries)
- Context cards should not clutter chat UI; collapsible or tabbed presentation

**Status Notes**:
- 2025-11-21: Epic created based on UX improvement brainstorming. Complements Plan 018 transparency goals by providing persistent inspection UI.

---

### Epic 0.4.0.4: Graph HTML Export

**Priority**: P3 (Future enhancement)
**Status**: Backlog

**User Story**:
As a developer with complex workspace knowledge,
I want to visualize memory relationships as a graph,
So that I can see how topics, plans, and decisions connect over time.

**Business Value**:
- **User Impact**: Enables high-level understanding of workspace knowledge structure; useful for onboarding or documentation
- **Strategic Importance**: Differentiates Cognee from simple note-taking tools; showcases graph-based backend
- **Measurable Success**: 20% of power users export graph at least once

**Dependencies**:
- **PREREQUISITE**: Plan 018 (metadata with topic_id, plan_id references)
- Optional: Plan 019 (compaction) to include DecisionRecord → original summary edges

**Acceptance Criteria** (outcome-focused):
- [ ] `Cognee: Export Memory Graph` command walks metadata (topic_id relationships, plan references) and emits HTML/JS bundle
- [ ] Graph uses D3.js or Cytoscape for interactive node/edge visualization
- [ ] Nodes represent summaries; edges represent relationships (same topic, plan references, superseded-by)
- [ ] Export saves to `.cognee_system/exports/graph-<timestamp>.html` as static file
- [ ] Graph respects status filtering (option to exclude Superseded summaries)

**Constraints**:
- Graph export should not block UI (run in background task with progress notification)
- HTML/JS bundle must work offline (embed libraries, no CDN dependencies)
- Large workspaces (1000+ nodes) may require clustering or pagination

**Status Notes**:
- 2025-11-21: Epic created based on UX improvement brainstorming. Leverages Cognee's graph backend to expose knowledge structure visually.

---

## Backlog / Future Consideration

### Epic: Team Context Sharing
**User Story**: As a team member, I want to share curated context with teammates, so that onboarding and knowledge transfer happen organically.

**Priority**: P3
**Status**: Future consideration
**Dependencies**: Would require architectural decisions about remote sync, permissions, privacy

### Epic: Automated Context Pruning
**User Story**: As a user with long-lived workspaces, I want stale or irrelevant context automatically archived, so that retrieval stays focused on current work.

**Priority**: P2
**Status**: Future consideration
**Dependencies**: Requires usage analytics and smart staleness detection

---

## Completed Epics Archive

### Epic 0.2.0.1: Workspace-Isolated Context Storage ✅

**Delivered**: 2025-11-14 (Plan 010)

**User Story**:
As a user managing multiple projects,
I want each workspace's context to remain isolated,
So that I don't get irrelevant results from other projects.

**Outcome**:
- Successfully delivered workspace-local `.cognee_system/` and `.cognee_data/` directories
- Migration from global storage completed with one-time pruning of untagged legacy data
- LLM_API_KEY environment variable enforcement implemented

**Lessons Learned**:
- Testing infrastructure (Plan 011) was essential to validate storage isolation
- QA focused on test passage but missed packaging regression (see Plan 012)

### Epic 0.2.0.2: Python Bridge Test Infrastructure ✅

**Delivered**: 2025-11-14 (Plan 011)

**User Story**:
As a developer maintaining the extension,
I want comprehensive automated tests for the Python bridge,
So that changes don't break initialization or ingestion workflows.

**Outcome**:
- 13/13 pytest tests passing with sys.modules-based mocking strategy
- Tests execute in <0.05s, making them practical for CI integration
- Coverage includes init.py and ingest.py critical paths

**Lessons Learned**:
- Test fixtures can mask packaging issues if they create assets that production expects from package
- Need end-to-end smoke tests with actual packaged VSIX, not just unit tests (see Epic 0.2.2.2)
