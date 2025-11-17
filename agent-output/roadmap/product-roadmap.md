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
**So that I eliminate the cognitive overhead of context reconstruction and can focus on solving problems instead of remembering what I learned.**

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

**Current State (v0.2.1)**: Extension has functional chat capture (Ctrl+Alt+C) and @cognee-memory participant retrieval, but critical gaps prevent user adoption:

1. **Installation Failure**: v0.2.1 regression blocks all new installs (ontology file mismatch)
2. **Feature Invisibility**: Even successful installs provide no onboarding or feature discovery
3. **Silent Failures**: Errors manifest as non-operation without user-facing explanations
4. **Setup Friction**: Manual Python environment setup required before any functionality works

**Strategic Course Correction**: Comprehensive review of Plans 001-011 revealed that technical infrastructure (workspace isolation, Python detection, testing) is solid, but **user-facing experience is critically deficient**. Plans 001-011 were heavily implementation-focused with minimal UX consideration. The roadmap now prioritizes:

- **v0.2.2** (Target: 2025-11-18): Fix initialization regression + ensure reliable packaging
- **v0.2.3** (Target: 2025-11-25): Add discoverability, error visibility, and automated setup (parallel to v0.3.0)
- **v0.3.0** (Target: TBD): Context intelligence (unblocked after Plan 013)

**Implementation Mapping** (Plans → Epics):

- **Plan 012** (Implemented) → Epic 0.2.2.1 (Installation), Epic 0.2.2.2 (Packaging)
- **Plan 013** (Proposed) → Epic 0.2.2.3 (Discoverability)
- **Plan 014** (Proposed) → Epic 0.3.0.2 (Structured Summaries) - prerequisite for Plan 015
- **Plan 015** (Proposed) → Epic 0.3.0.1 (Ranking and Relevance)
- **Plan 016** (Proposed) → Epic 0.2.3.1 (Error Transparency) - parallel to v0.3.0
- **Plan 017** (Proposed) → Epic 0.2.3.2 (Python Auto-Setup) - parallel to v0.3.0

**Strategic Decision**: Plans 012/013 resolve v0.2.x blockers; v0.3.0 work (Plans 014/015) can proceed after Plan 013. Remaining v0.2.3 epics (Plans 016/017) enhance UX but don't block advanced features—proceed in parallel.

## Change Log

| Date | Change | Rationale |
|------|--------|-----------|
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
**Status**: Planned

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
- [ ] First successful initialization shows welcome message with quick-start actions
- [ ] Status bar shows extension state (active, capturing enabled/disabled) and keyboard shortcut hint
- [ ] @cognee-memory participant shows help text when invoked without query
- [ ] Command palette entries have clear descriptions ("Capture Current Chat to Memory", not "Cognee: Capture")
- [ ] README walkthrough validated with fresh user (someone who didn't build the extension)

**Constraints**:
- Must not be intrusive or annoying to existing users
- Should respect VS Code's notification guidelines (not spam)

**Status Notes**:

- 2025-11-17: **IN PROGRESS** - Plan 013 proposed and ready for implementation. Will remove 150-char display truncation, improve query logging, enhance transparency.
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
- **BLOCKER**: Epic 0.2.2.3 (users must discover retrieval workflow before ranking matters)
- **BLOCKER**: Epic 0.2.3.1 (must have operational reliability before optimizing results)
- Requires stable v0.2.x foundation with real usage data to inform ranking approach
- May require embeddings/similarity research (Analyst + Architect collaboration)

**Acceptance Criteria** (outcome-focused):
- [ ] Retrieval results ranked by relevance to query
- [ ] Recent context weighted appropriately (balance recency vs relevance)
- [ ] Cross-file connections surfaced when semantically related
- [ ] User can provide feedback on result quality (thumbs up/down)

**Constraints**:
- Must maintain <2s retrieval performance target
- Should work within existing workspace-local storage model

**Status Notes**:

- 2025-11-17: **UNBLOCKED** - Plans 012 (installation stability) and 013 (display transparency) resolve critical v0.2.x blockers. Epic can proceed after Plan 013 completion. Will be implemented by Plan 015 (metadata, ranking, compaction).
- 2025-11-16: DEFERRED - Review of Plans 001-011 revealed users cannot yet discover or reliably use basic retrieval. Ranking optimization premature until foundational UX and error handling delivered in v0.2.x.
- 2025-11-15: Epic placeholder. Requires research phase to determine ranking approach.

---

### Epic 0.3.0.2: Structured Conversation Summaries

**Priority**: P1 (High value - prerequisite for Epic 0.3.0.1)
**Status**: Proposed (Plan 014)

**User Story**:
As a developer capturing conversation summaries,
I want summaries structured with metadata (topic, plan, decisions, references),
So that I can organize, search, and compact context more effectively over time.

**Business Value**:

- **User Impact**: Enables organizing conversation history by topic/plan instead of chronological order only
- **Strategic Importance**: Foundation for compaction and ranking features; without structured summaries, advanced features cannot deliver value
- **Measurable Success**: Users create structured summaries with metadata; retrieval benefits from richer context

**Dependencies**:

- Epic 0.2.2.3 (users must discover capture workflow before adding structure)
- Plan 014 defines and implements this epic

**Acceptance Criteria** (outcome-focused):

- [ ] Users can create conversation summaries with embedded metadata (topic, session, plan IDs, timestamps, status)
- [ ] Summary schema includes decisions, rationale, open questions, next steps, and references (files, plans, branches, issues)
- [ ] Manual compaction trigger exposed in UI (backend implemented in Epic 0.3.0.1)
- [ ] Summaries ingested into Cognee with plain-text format (DataPoint migration in Epic 0.3.0.1)
- [ ] Documentation explains summary structure and metadata fields

**Constraints**:

- Must maintain backward compatibility with existing raw-text memories
- Should not require users to change existing capture workflows
- Metadata extraction should be transparent (no manual field entry)

**Status Notes**:

- 2025-11-17: Epic created to capture Plan 014 scope. Structured summaries are prerequisite for ranking/compaction (Epic 0.3.0.1/Plan 015).

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
