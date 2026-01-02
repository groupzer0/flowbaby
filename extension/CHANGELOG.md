# Changelog

All notable changes to the Flowbaby extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- markdownlint-disable MD022 MD024 MD032 MD007 MD009 -->

## [0.7.0] - Unreleased

### ⚠️ Breaking Changes

- **Cloud-Only Mode (Plan 083)**: Flowbaby v0.7.0 is Cloud-only. Local API key configuration (`Flowbaby: Set API Key`) has been removed. Users must login to Flowbaby Cloud for LLM-powered memory operations.
  - Removed commands: `Flowbaby.configureApiKey`, `Flowbaby.setApiKey`, `Flowbaby.clearApiKey`
  - Removed settings: `Flowbaby.llm.provider`, `Flowbaby.llm.model`, `Flowbaby.llm.endpoint`
  - Removed env var injection: `LLM_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL` no longer injected into Python bridge
  - Legacy API keys stored in SecretStorage are automatically migrated with a one-time info message

### Added

- **Cloud API Endpoint Override Setting (Plan 084)**: New `flowbaby.cloud.apiEndpoint` setting allows developers and testers to override the Flowbaby Cloud API endpoint for testing against staging, development, or local environments without modifying code.

- **Flowbaby Cloud Credential Provider Wiring (Plan 081)**: Unified credential/provider architecture wired into extension activation and all Python bridge paths. Key changes:
  - **API Contract v2.1.0**: Added `BedrockRegion` type with `preferredRegion` field on `VendRequest` for region preference passthrough.
  - **Region Preference Setting**: New `flowbaby.cloud.preferredRegion` setting allows users to express region affinity (us-east-1, eu-west-1, me-south-1, ap-southeast-1). Backend remains authoritative for actual routing.
  - **Activation Wiring**: Credentials manager and provider singleton now initialize during extension activation (after Cloud auth) with proper dependency ordering.
  - **Bridge Environment Injection**: All three bridge code paths (spawn-per-request, daemon-mode, background operations) now inject Cloud credentials into Python subprocess environment when authenticated.
  - **Security Guardrails**: Verified no secret values (AWS keys, tokens, JWTs) are logged; existing redaction patterns remain adequate.

- **Credential Single-Flight Guard (Plan 083 M1)**: Prevents concurrent `/vend/credentials` requests during high-frequency operations. Multiple callers share a single in-flight refresh, reducing API load and preventing credential thrashing.

- **Centralized Cloud Error → UX Mapping (Plan 083 M3)**: New `errorMapping.ts` module provides consistent error messaging across all Cloud error scenarios:
  - Maps error codes to severity, actionable messages, and recovery actions
  - Supports rate limiting, quota exceeded, session expiry, and network errors
  - Provides `showCloudError()` helper for consistent toast notifications

### Changed

- **Cloud API Endpoint Resolution (Plan 084)**: Updated default Cloud API endpoint from placeholder `api.flowbaby.dev` to correct staging endpoint `api-staging.flowbaby.ai`. Endpoint resolution now follows clear precedence: VS Code setting > `FLOWBABY_CLOUD_API_URL` environment variable > built-in default. This enables reliable Cloud connectivity for v0.7.0 launch.

- **Bootstrap Decoupled from Cloud Credentials (Plan 084)**: Python bridge initialization (`init.py`) no longer requires Cloud credentials to succeed. Extension bootstrap (environment creation, workspace indexing) now completes without Cloud authentication, with only LLM-powered operations (memory ingestion, retrieval synthesis) gated on Cloud login. This fixes activation failures where users saw "Cloud login required" before they could even log in.

- **Cloud Authentication Flow (Plans 077–081)**: The v0.7.0 Cloud integration now provides a complete OAuth → STS → Bridge credential flow, enabling managed AWS Bedrock inference without local API keys.

- **Status Bar UX (Plan 083 M6)**: Updated status bar for Cloud-only mode:
  - Renamed `NeedsApiKey` status to `NeedsCloudLogin` (backward-compatible alias preserved)
  - Status menu now shows "Flowbaby Cloud Status" instead of "Set API Key"
  - Tooltip updated to "Cloud Login Required" instead of "LLM API Key Required"

- **Walkthrough Updated (Plan 083 M6)**: Getting Started walkthrough step changed from "Set Your API Key" to "Login to Flowbaby Cloud" with updated description.

### Fixed

- **Cloud API Endpoint Hardcoding (Plan 084)**: Fixed hardcoded `api.flowbaby.dev` URL in `types.ts` that referenced a non-existent domain. Now correctly defaults to staging endpoint (`api-staging.flowbaby.ai`) with documented fallback to execute API gateway URL when needed.

- **Cloud Error Code Preservation (Plan 083 M2)**: Fixed error masking in `flowbabyClient.ts`, `PythonBridgeDaemonManager.ts`, and `BackgroundOperationManager.ts` where Cloud errors were being converted to generic "login required" errors. Now preserves original error codes (RATE_LIMITED, QUOTA_EXCEEDED, SESSION_INVALID, etc.) for accurate UX.

- **Cloud Login Commands Not Responding (Plan 085)**: Fixed UI entrypoints (first-run prompt buttons, status bar menu) that invoked unregistered command IDs (`FlowbabyCloud.*`) instead of canonical registered commands (`flowbaby.cloud.*`). Clicking "Login to Cloud" or "Flowbaby Cloud Status" now reliably triggers the intended action. Status bar now updates automatically after login/logout without requiring an extension reload.

## [0.6.2] - 2025-12-20

### Added

- **Copilot Synthesis Model Selection (Plan 075)**: New `Flowbaby.synthesis.modelId` setting allows users to choose which Copilot model performs memory retrieval synthesis. Options include GPT-5 mini (default), GPT-4o, and GPT-4.1. Synthesis fails with a clear, actionable error if the selected model is unavailable—no silent fallback to a different model.
- **Settings Clarity (Plan 075)**: Updated settings descriptions to clearly distinguish:
  - `Flowbaby.synthesis.modelId`: Controls Copilot synthesis model for memory retrieval
  - `Flowbaby.llm.*`: Controls Python bridge LLM for memory ingestion and graph operations (does NOT affect Copilot synthesis)
- **Rebuild Tool Batch Processing & Resilience (Plan 076)**: The developer/tester rebuild CLI tool (`rebuild_workspace.py`) now supports robust filesystem-based rebuild with:
  - **Batch ingestion**: Configurable batch size (`--batch-size`) with rate limiting (`--batch-delay`) for API quota management
  - **Checkpointing & resumability**: JSON checkpoints with SHA-256 input fingerprinting allow resuming interrupted operations (`--resume`) or starting fresh (`--restart`)
  - **Preflight/dry-run mode**: `--dry-run` shows file counts, total size, and skip reasons without making changes
  - **Fail-closed semantics**: Destructive `reset-and-rebuild` mode validates all inputs before resetting stores; aborts on encoding errors or permission issues
  - **Concurrent writer detection**: Refuses to run when daemon mode is active to prevent data corruption
  - **File size limits**: Configurable maximum file size (`--max-file-size`, default 10MB) with override (`--allow-oversized`)

### Changed

- **Extension Activation Refactor (Plan 062)**: Decomposed the 2066 LOC `extension.ts` monolith into three cohesive modules: `extension.ts` (267 LOC orchestrator), `activation/registrations.ts` (1175 LOC for commands, LM tools, chat participant), and `activation/init.ts` (797 LOC for initialization, health checks, setup commands). No user-facing changes; architecture maintainability improvement only.

### Fixed

- **Windows daemon I/O reliability (post-Plan 076)**: Improved bridge daemon stdio handling on Windows to prevent stuck requests and unreliable background operations.
- **Windows refresh tooling reliability**: Improved `Flowbaby: Refresh Bridge Dependencies` behavior on Windows where `.flowbaby\\venv` can be locked (common `EPERM` rename failures). The refresh/health flows now behave more predictably when a Python process is still holding file handles.
- **Workspace health check robustness (Windows + general)**: Fixed setup health checks to better detect and report environment readiness, reducing false negatives during initialization.
- **Cross-platform VSIX verification**: `npm run verify:vsix` now supports Windows environments without `unzip` by falling back to PowerShell `Expand-Archive`, preventing packaging regressions before publishing.
- **Notification Observability (Plan 075)**: Removed temporary diagnostic logging from toast notification code paths, keeping production logs clean while preserving notification functionality.
- **Daemon Idle-Timeout KuzuDB Locks (Plan 061)**: Fixed aggressive SIGKILL escalation during idle-timeout shutdown that left KuzuDB `.pkl` file locks orphaned. The daemon manager now uses a 3-phase graceful shutdown (5s graceful → 3s SIGTERM → SIGKILL as last resort), allowing Cognee/KuzuDB time to release locks cleanly. Added operational fallback: after 3 consecutive forced kills, daemon mode automatically suspends and falls back to spawn-per-request until manually re-enabled.
- **Memory Ingestion KuzuDB Lock Conflicts (Plan 062)**: Fixed `flowbaby_storeMemory` tool failures with "Could not set lock on file" errors. Memory ingestion now routes through the daemon process (which holds the single KuzuDB connection) instead of spawning a separate subprocess that would conflict with the daemon's lock. Both `ingestSummary()` and `ingestSummaryAsync()` now use daemon-based ingestion when daemon mode is enabled, with fallback to subprocess when daemon is unavailable.

### Changed

- **Cognee Upgrade to 0.5.1 (Plan 059)**: Upgraded from Cognee 0.4.1 to 0.5.1 to enable filesystem-backed session caching. Cognee 0.5.0+ introduces `CACHE_BACKEND=fs` via diskcache (bundled), removing the implicit Redis dependency that caused connection failures in managed environments without Redis installed.
- **Filesystem Cache Backend Default**: Managed environments now default to `CACHING=true` and `CACHE_BACKEND=fs` (filesystem session cache) instead of falling back to Redis. This eliminates Redis-related timeout errors and improves retrieval reliability out-of-the-box.
- **Environment Variable Precedence**: Cache configuration now respects explicit user-provided environment variables (`CACHING`, `CACHE_BACKEND`). Flowbaby-managed defaults are only applied when values are not already set.
- **Daemon Default Idle Timeout**: Increased default idle timeout from 5 minutes to 30 minutes to reduce daemon restart frequency during normal development sessions.

### Added

- **Cache Configuration Logging**: All bridge entry points (daemon, init, ingest, retrieve) now log cache configuration at startup for improved observability and troubleshooting.
- **Automatic Schema Migration (Plan 060)**: Databases created with Cognee 0.4.x are automatically migrated to 0.5.x schema on initialization. The migration adds required columns for multi-tenant support (`datasets.tenant_id` and 10 `dataset_database` columns) using additive-only `ALTER TABLE` operations. No data loss occurs.
  - **Fail-Closed Safety**: If schema migration fails, initialization fails cleanly rather than proceeding with an incompatible database.
  - **Receipt Generation**: Migration attempts are logged to `.flowbaby/system/schema_migration_receipt.json` for auditability.
  - **External Repair**: Users with external Python environments can run `python bridge/migrate_cognee_0_5_schema.py <workspace> --dry-run` to check schema status and apply migrations manually.
- **Daemon Startup Hygiene (Plan 061)**: Added stale PID file cleanup and orphan process detection on daemon startup to prevent ghost daemon accumulation and ensure clean daemon lifecycle management.

## [0.6.1] - 2025-12-13

### Changed

- Switched the project and extension licensing from PolyForm Strict to MIT and prepared the repository for public open-source use, based on user feedback.

## [0.6.0] - 2025-12-11

### Changed

- Documentation refresh: Updated extension README and marketplace-facing documentation for clarity around setup, features, and troubleshooting. No functional code changes compared to 0.5.23.

## [0.5.23] - 2025-12-11

### Added

- **Per-Workspace Python Bridge Daemon (Plan 054)**: Introduced a long-lived Python bridge daemon that eliminates per-request Python startup overhead (~2-3 seconds) by keeping Cognee imported and warm. Retrieval and capture requests now respond in ~300ms instead of 2-3s.
- **New Configuration Options**:
  - `Flowbaby.bridgeMode`: Choose between `daemon` (default, faster) or `spawn` (legacy per-request mode) for bridge execution
  - `Flowbaby.daemonIdleTimeoutMinutes`: Configure how long the daemon stays alive after inactivity (default: 5 minutes)
- **Daemon Lifecycle Management**: The extension automatically starts, monitors, and restarts the daemon as needed. Graceful shutdown on workspace close.
- **Automatic Fallback**: If daemon mode fails repeatedly, the extension automatically falls back to spawn-per-request mode for reliability.

### Changed

- **Bridge Architecture**: Retrieval and ingestion now route through the daemon manager when daemon mode is enabled, with transparent fallback to the existing spawn-per-request pattern.

### Technical

- Added `PythonBridgeDaemonManager` TypeScript class for daemon lifecycle management
- Added `daemon.py` Python script as the long-lived bridge process entrypoint
- Added JSON-RPC 2.0 communication protocol over stdio for daemon IPC
- Added daemon health monitoring with automatic restart and exponential backoff

## [0.5.22] - 2025-12-10

### Fixed

- **Data Integrity Check False Positives**: Fixed initialization data-integrity check that was incorrectly reporting "Data mismatch: X SQLite entries but only Y vector tables" warnings. The previous implementation counted LanceDB *directories* (a fixed ~6 tables in Cognee 0.4.x) instead of actual *row counts*, producing false positives once SQLite rows exceeded the table count. The fix now compares SQLite document counts against actual LanceDB embedding row counts from the `DocumentChunk_text` table.

### Added

- **Shared Data Integrity Utilities**: New `data_integrity_utils.py` module provides shared helper functions (`get_sqlite_document_count`, `get_lancedb_embedding_count`, `evaluate_data_health`) used by both `init.py` and `recover_data.py` for consistent data integrity checking.
- **Improved Health Semantics**: Data integrity warnings now use smarter thresholds—small workspaces (≤5 documents) with minor discrepancies are treated as healthy to avoid noise, while significant mismatches in larger workspaces trigger appropriate warnings.

### Changed

- **LanceDB Row Counting**: The `lancedb_count` field in initialization JSON output now represents actual embedding row count rather than table directory count. This is a semantic change but maintains backward compatibility for consumers checking the `healthy` field.

## [0.5.21] - 2025-12-10

### Changed

- **Retrieval Timeout Increased**: Increased retrieval timeout from 15 seconds to 30 seconds to accommodate large workspaces and cold-start environments. Retrieval operations will now wait longer before timing out, reducing spurious failures in legitimate high-latency scenarios.
- **Retrieval Diagnostics**: Added phase markers (bridge call start/finish) and duration logging to retrieval operations for improved performance diagnostics and future bridge-daemon compatibility (Plan 054).

### Added

- **Capture Input Visibility**: Added status bar message when capture input opens (`$(edit) Flowbaby capture: input box open at top — Enter to save, Esc to cancel`) to draw attention to the input UI.
- **First-Time Capture Hint**: One-time onboarding toast message for new users explaining that the capture input appears at the top of the window, stored in globalState to avoid repeated notifications.
- **Improved Capture Prompt**: Updated capture input prompt and placeholder text for better discoverability (`Flowbaby capture: type in the top input box (Esc cancels)`).

## [0.5.20] - 2025-12-10

### Fixed

- **Tool Registration Guards**: Fixed over-aggressive guard logic that incorrectly set `setToolsRegistered(true)` based on host inventory presence rather than actual registration outcomes. Guards now follow evidence-only semantics per architecture invariant 4.2.
- **All-or-Nothing Tool Set Registration**: Tool registration now treats both `flowbaby_storeMemory` and `flowbaby_retrieveMemory` as an atomic unit—the guard is only set if all tools register successfully or return known duplicate errors.
- **Copilot Tool Availability**: Resolved issue where Flowbaby tools would not appear in GitHub Copilot's tool list after non-initial activations because guards were being set prematurely.

### Added

- **Duplicate Error Classifiers**: Added `isKnownDuplicateToolError()` and `isKnownDuplicateParticipantError()` helper functions to centralize error classification and provide forward-compatible matching for VS Code API changes.
- **Host Tool Snapshots**: Added `createHostToolSnapshot()` for compact diagnostic snapshots of registered tools (observational only, does not affect guard state per invariant 4.3.1).
- **Plan 056 Test Suite**: Added comprehensive tests for guard behavior, duplicate-error classification, tool/participant independence (invariant 4.5.4), and evidence-only semantics.

### Changed

- **Participant Registration**: Updated `registerFlowbabyParticipant()` to use centralized `isKnownDuplicateParticipantError()` classifier and moved guard setting to immediately after successful registration.
- **Guard Lifecycle**: Registration guards are now completely independent—tool guard state does not affect participant guard state and vice versa, ensuring one subsystem's registration issues don't block the other.

## [0.5.19] - 2025-12-07

### Added

- Activation ledger now records workspace path, health/requirements state, registration guards, and deactivation details for every activation, enabling lifecycle reconstruction across test runs.
- Structured safePush diagnostics capture context fingerprints, host tool snapshots, and test-mode push probes so DisposableStore anomalies can be attributed to specific intents.
- Workspace initialization isolation from Plan 050 is preserved under repeated activations, with each workspace tracked independently so a broken workspace cannot contaminate others sharing the same window or host.
- Single-activation lifecycle model from Plan 051 is enforced via registration helpers and activation ledger state, ensuring that extension-owned registrations are routed through lifecycle-safe paths and never pushed into known-disposed contexts.

### Changed

- Language model tool and chat participant registration skip when host inventory already contains Flowbaby assets, reducing duplicate registration noise in reused test hosts.
- Test-mode prompt handling now logs suppression reasons with activation metadata and avoids modal dialogs that block CI runs.
- Debug logging automatically enables in test mode to surface lifecycle and registration traces during automated suites.

## [0.5.18] - 2025-12-07

### Added

- **Global Shortcut**: `Ctrl/Cmd+Alt+F` now works across VS Code views without focus restrictions, still prompting for capture input when no editor selection is available.
- **Session Toggle**: New `Flowbaby.sessionManagement.enabled` setting (default on) lets users disable session IDs for stateless interactions.
- **Dependency Mismatch Notice**: Early hash check marks the workspace as needing setup and prompts to refresh when bridge dependencies are out of date.

### Changed

- **Graph Retriever Debug Gating**: Cognee graph completion debug logs now obey the `Flowbaby.debugLogging` setting to reduce noisy output by default.
- **Workspace Isolation**: Initialization status is tracked per workspace to avoid a broken workspace contaminating others in the same window.

## [0.5.17] - 2025-12-05

### Added

- **Dependency Enforcement**: Added strict verification of Python environment dependencies. The extension now blocks operations and prompts for updates if `requirements.txt` hashes do not match the installed environment.
- **Environment Guardrails**: Added `FlowbabySetupService` checks to `FlowbabyContextProvider` and command handlers to prevent crashes from stale dependencies.
- **Update Modals**: Added user-friendly modals to guide users through updating managed or external environments.

### Changed

- **Verification Logic**: `FlowbabySetupService` now tracks verification state and only allows operations when the environment is fully verified.

## [0.5.16] - 2025-12-05

### Fixed

- **Ingestion Crash**: Fixed a critical `UnboundLocalError` in the background ingestion process (`cognify-only` mode) that caused crashes when API keys were missing.
- **Notification Throttling**: Removed throttling for failure notifications to ensure users are always alerted to issues. Success notifications are now only suppressed by user setting, not by frequency.

## [0.5.15] - 2025-12-05

### Changed - Cognee Upgrade & Session Infrastructure

- **Cognee 0.4.1 Upgrade**: Upgraded managed Python environments to `cognee==0.4.1` for improved stability and native session management support.
- **Session-Aware Retrieval**: Added infrastructure to pass session IDs to the memory engine when available, laying the foundation for conversational memory.
- **Workspace Caching**: Enhanced workspace-local caching configuration (`CACHE_ROOT_DIRECTORY`) to support future session features.
- **Isolation**: Maintained strict workspace isolation and backward compatibility for all ingestion/retrieval workflows.

## [0.5.14] - 2025-12-05

### Added - Unified Session Context

- Implemented unified session context for chat threads. Flowbaby now maintains conversational continuity by passing a consistent `session_id` to the memory engine for each chat thread.
- Updated Python bridge to accept and map `__user_session_id` to Cognee's `session_id`.

## [0.5.13] - 2025-12-03

### Changed - Maintenance Release

- Version bump only to align with latest internal planning and release numbering. No user-visible functionality changes beyond those already included in 0.5.12.

## [0.5.12] - 2025-12-03

### Fixed - Windows Installation and Stability

**Windows Support Release** - Resolves remaining Windows installation issues and makes the bridge fully reliable on Windows.

#### Improvements
- **Background Ingestion on Windows**: Switched background ingestion to use `pythonw.exe` when available, preventing stray console windows and improving stability for long-running operations.
- **Initialization Race Fix**: Resolved a fresh workspace initialization race on Windows, ensuring the bridge environment and Kuzu databases are fully ready before marking setup as complete.
- **Kuzu and DLL Handling**: Added targeted Windows Kuzu tests and fixed Python detection / Kuzu DLL load issues, resulting in the first fully working end-to-end Windows configuration.
- **Platform Prerequisites**: Updated documentation to call out the Visual C++ Redistributable requirement on Windows, reducing installation surprises.

## [0.5.11] - 2025-12-01

### Added - Plan 047: Enhanced Setup Diagnostics

**Diagnostics Release** - Improves troubleshooting for environment setup failures by exposing detailed command execution logs and system errors.

#### Improvements
- **Command Transparency**: Setup logs now show the exact command, arguments, and working directory for every subprocess execution.
- **System Error Codes**: Failures now report specific Node.js system error codes (e.g., `ENOENT`, `EACCES`) instead of generic messages.
- **Full Stack Traces**: Error logs include full stack traces to pinpoint the exact failure location in the code.
- **Automatic Log Focus**: The Flowbaby Output Channel is automatically revealed when a setup error occurs, ensuring immediate visibility of diagnostic information.
- **Captured Output**: Standard output from failed commands (which was previously swallowed) is now included in the error logs.

#### Windows Reliability Improvements
- **Background Ingestion on Windows**: Switched background ingestion to use `pythonw.exe` when available, preventing stray console windows and improving stability for long-running operations.
- **Initialization Race Fix**: Resolved a fresh workspace initialization race on Windows, ensuring the bridge environment and Kuzu databases are fully ready before marking setup as complete.
- **Kuzu and DLL Handling**: Added targeted Windows Kuzu tests and fixed Python detection / Kuzu DLL load issues, resulting in the first fully working end-to-end Windows configuration.
- **Platform Prerequisites**: Updated documentation to call out the Visual C++ Redistributable requirement on Windows, reducing installation surprises.

## [0.5.10] - 2025-02-18

### Fixed - Plan 046: Windows Spawn Fix

**Hotfix Release** - Resolves "Environment creation failed" error on Windows when workspace path contains spaces.

#### Issues Resolved
- **Environment Creation Failure**: Fixed a regression in v0.5.9 where `Flowbaby: Initialize Workspace` failed immediately on Windows if the path contained spaces.
- **Root Cause**: The manual quoting logic introduced in v0.5.9 conflicted with `spawn`'s `shell: true` behavior on Windows, leading to malformed commands.
- **Fix**: Switched `FlowbabySetupService.runCommand` to use `shell: false`, allowing Node.js to handle argument escaping natively and robustly across all platforms.

#### Technical Changes
- **FlowbabySetupService**: Removed `quoteIfNecessary` helper and manual quoting.
- **Spawn Options**: Changed `shell: true` to `shell: false` for `python` and `pip` commands.
- **Verification**: Confirmed that `FlowbabyClient` already uses `shell: false` and was unaffected.

## [0.5.9] - 2025-12-01

### Fixed - Plan 022: Windows Path Spaces Fix

**Critical Fix** - Resolves environment creation failures on Windows when the workspace path contains spaces.

#### Issues Resolved
- **Environment Creation Failure**: Fixed a bug where `Flowbaby: Initialize Workspace` would fail or create stray folders if the workspace path contained spaces (e.g., `C:\Users\My Name\Project`).
- **Root Cause**: Node.js `spawn` with `shell: true` does not automatically quote arguments on Windows, causing paths with spaces to be split into multiple arguments.
- **Fix**: Implemented robust quoting logic in `FlowbabySetupService` to ensure both the command and arguments are correctly quoted when they contain spaces.

#### Technical Changes
- **FlowbabySetupService**: Added `quoteIfNecessary` helper in `runCommand` to wrap paths in double quotes if they contain spaces and aren't already quoted.
- **Cross-Platform Safety**: Verified that the quoting logic is safe for Windows (`cmd.exe`) and Unix-like systems (`/bin/sh`), ensuring no regressions on macOS/Linux.
- **Test Coverage**: Added unit tests to `FlowbabySetupService.test.ts` to verify that commands and arguments are correctly quoted before being passed to `spawn`.

## [0.5.8] - 2025-11-30

### Fixed - Hotfix: Fresh Workspace Memory Operations

**Hotfix Release** - Fixes issues discovered when using memory tools on fresh workspaces without stored data.

#### Issues Resolved

1. **DatasetNotFoundError on fresh workspace retrieval**: When querying `@flowbaby` or using `flowbaby_retrieveMemory` on a fresh workspace with no stored memories, the extension now gracefully returns empty results instead of throwing `DatasetNotFoundError: No datasets found`. This is the expected UX - the workspace simply has no memories yet.

2. **BackgroundOperationManager not initialized error**: When using `flowbaby_storeMemory` tool before full workspace setup, the extension now shows a helpful prompt to initialize the workspace instead of failing with a confusing "BackgroundOperationManager not initialized" error.

3. **Misleading success log on staging failure**: The "✅ Memory staged" log message now only appears when staging actually succeeds. Previously it showed success before checking the result, then showed failure notification.

#### Technical Changes

##### Python Bridge (`retrieve.py`)
- **Added**: Detection for `DatasetNotFoundError` in search exception handler
- **Behavior**: Fresh workspaces with no data return `{"success": true, "results": [], "message": "No data has been ingested yet"}`

##### Agent Commands (`ingestForAgent.ts`)
- **Added**: Try-catch wrapper around `BackgroundOperationManager.getInstance()` call
- **Behavior**: Returns helpful `NOT_INITIALIZED` error with "Initialize Now" action button
- **UX**: User sees clear path to fix instead of cryptic error

##### Store Memory Tool (`storeMemoryTool.ts`)
- **Fixed**: Success log message now appears after response check, not before
- **Fixed**: Failure log includes actual error message from response

## [0.5.7] - 2025-11-30

### Fixed - Hotfix: Smoke Test Issues from v0.5.6

**Hotfix Release** - Addresses five UX issues discovered during v0.5.6 smoke testing.

#### Issues Resolved

1. **Ingestion failure notifications not showing**: Failed memory ingestions via `flowbaby_storeMemory` tool now show warning toast with "View Logs" option. (Note: success notifications can be disabled via `flowbaby.notifications.showIngestionSuccess`, but failure notifications always show.)

2. **Chat participant icon missing**: `@flowbaby` icon now displays correctly in chat. Fixed icon path from non-existent `icon.png` to actual `flowbaby-icon-tightcrop.png`.

3. **Missing API key causes infinite "working..." state**: When API key is not configured, `@flowbaby` chat now shows helpful error message with link to configure instead of hanging indefinitely.

4. **API key setup notice auto-dismissing**: Post-initialization API key prompt now uses modal dialog that stays until user explicitly dismisses it.

5. **Status bar not updating after API key config**: After setting API key via command, status bar now updates from yellow "API Key Required" to green "Ready" state.

#### Technical Changes

- Added failure notification to `StoreMemoryTool.invoke()` for non-success responses
- Fixed `participant.iconPath` to use correct file path
- Added API key check in chat participant before retrieval operations
- Changed post-init prompt to modal dialog (`{ modal: true }`)
- Added status bar update in `Flowbaby.setApiKey` command handler

## [0.5.6] - 2025-11-30

### Fixed - Plan 045 Hotfix: Smoke Test Issues

**Hotfix Release** - Addresses three issues discovered during v0.5.5 smoke testing.

#### Issues Resolved

1. **Progress notification stuck**: "Initializing Flowbaby databases..." progress notification no longer blocks waiting for user input. Post-init API key prompt now shows after progress completes.

2. **Post-init prompt timing**: API key setup prompt now appears after initialization fully completes, not while progress is still showing.

3. **Configure API Key command not found**: `Flowbaby.configureApiKey` command now works from Command Palette (was only `Flowbaby.setApiKey` before).

#### Technical Changes

- Moved post-init API key prompt outside `withProgress` callback to non-blocking `.then()` pattern
- Added `Flowbaby.configureApiKey` command as alias to `Flowbaby.setApiKey`
- Added `getApiKeyState()` method to FlowbabyClient for cached state access

## [0.5.5] - 2025-11-30

### Fixed - Plan 045: Fix Fresh Install API Key Blocking

**Fresh Install Experience Release** - Eliminates API key blocking issue that prevented new users from completing setup.

#### Problem Resolved
- **Issue**: Fresh installations failed with "LLM_API_KEY not found in environment" error
- **Impact**: New users couldn't complete Flowbaby setup without already having an API key configured
- **Root Cause**: `init.py` required API key before user had opportunity to set it

#### Changes

##### Python Bridge (`init.py`)
- **Modified**: API key validation now logs warning instead of returning error
- **Added**: `api_key_configured` and `llm_ready` fields to initialization response
- **Behavior**: Initialization completes successfully, directories and databases created without API key

##### TypeScript Client (`flowbabyClient.ts`)
- **Added**: `ApiKeyState` interface for centralized API key tracking
- **Added**: `InitializeResult` interface with success status and API key state
- **Added**: `hasApiKey()` public method for pre-checking API key availability
- **Modified**: `initialize()` now returns `InitializeResult` with API key state

##### Status Bar (`FlowbabyStatusBar.ts`)
- **Added**: `NeedsApiKey` status with distinct key icon and warning background
- **Behavior**: Shows $(key) icon when initialized but API key not configured

##### Extension Activation (`extension.ts`)
- **Added**: Post-initialization API key prompt when no key configured
- **Added**: Graceful handling of `InitializeResult` return type
- **Behavior**: Shows "Set your API key to enable LLM operations" with action button

##### Graceful Degradation
- **Added**: Pre-check in `ingestForAgent` and `FlowbabyContextProvider.retrieveContext`
- **Behavior**: If no API key, prompts user with "Set API Key" action before attempting operation
- **Message**: "Flowbaby memory operations require an API key."

#### User Experience
1. Fresh install now completes successfully
2. Status bar shows key icon indicating API key needed
3. User prompted to set API key after initialization
4. Memory operations prompt for API key if not configured
5. All existing functionality preserved when API key is set

## [0.5.2] - 2025-11-29

### Removed - Plan 044: Remove Non-Functional Auto-Ingest Setting

**Configuration Cleanup Release** - Removes experimental setting that never functioned.

#### Removed
- **Setting**: `Flowbaby.autoIngestConversations` removed from VS Code settings
- **Code**: Step 6 "feedback loop" code block removed from chat participant
- **Rationale**: Feature was introduced as experimental but never worked due to Cognee SDK limitations (file hashing bug). Keeping non-functional settings creates user confusion.

#### Impact
- Users who had this setting enabled will see no behavior change (it was already non-functional)
- Configuration surface is now cleaner and only exposes working features
- Any future auto-ingest or feedback-loop features will be redesigned under the current architecture (e.g., via structured summaries and Flowbaby tools) rather than reusing this removed pattern

## [0.5.1] - 2025-11-28

### Changed - Plan 043: Tool Descriptions and UX Improvements

**Agent Integration & UX Polish Release** - Enhances tool descriptions for better agent behavior and improves user experience.

#### Enhanced Tool Descriptions (Milestone 1)
- **Updated**: `flowbaby_storeMemory` and `flowbaby_retrieveMemory` tools now include comprehensive, structured instructions (~1,800 characters each) that encode the full Flowbaby memory contract
- **Benefit**: Agents automatically understand when, how, and what to store/retrieve without requiring custom `.agent.md` files
- **Content**: Descriptions include guidance on timing, query construction, what to capture, retrieval limits, and structure guidance

#### Configurable Success Notifications (Milestone 2)
- **New Setting**: `flowbaby.notifications.showIngestionSuccess` (default: `true`)
- **Behavior**: When `false`, suppresses success toast notifications ("Memory staged...", "Flowbaby finished...") while preserving all error notifications
- **Use Case**: Power users who find frequent success toasts distracting can disable them while still receiving critical error alerts

#### Keyboard Shortcut Change (Milestone 3)
- **Changed**: Default capture shortcut from `Ctrl+Alt+C` / `Cmd+Alt+C` to `Ctrl+Alt+F` / `Cmd+Alt+F`
- **Rationale**: Avoids potential conflicts with other extensions and common VS Code operations
- **Migration**: Users with custom keybindings should update to the new shortcut

### Documentation
- Updated README.md with new keyboard shortcut references
- Added `flowbaby.notifications.showIngestionSuccess` to Configuration table
- Updated walkthrough step to reflect new shortcut

## [0.5.0] - 2025-11-28

### Changed - Plan 042: Comprehensive Lint Cleanup

**Code Quality Release** - Establishes consistent code quality standards across TypeScript, Python, and Markdown.

#### TypeScript ESLint (Milestone 1-5)
- **Resolved**: All 272 ESLint violations (12 errors, 260 warnings → 0 errors, 0 warnings)
- **Updated**: ESLint naming-convention rules to allow snake_case for Python bridge JSON contracts
- **Fixed**: 9 `@typescript-eslint/no-explicit-any` by adding proper type definitions
- **Fixed**: 9 `@typescript-eslint/no-unused-vars` by removing/prefixing unused variables
- **Fixed**: 3 `@typescript-eslint/no-var-requires` by converting to ES module imports
- **Auto-fixed**: 47 curly braces and useless escape warnings

#### Python Linting (Milestone 6)
- **Added**: `ruff` linter for Python bridge code (`requirements-dev.txt`)
- **Created**: `extension/bridge/ruff.toml` configuration
- **Resolved**: All Python lint errors (1322 → 0)
- **Added**: `npm run lint:python` script

#### Markdown Linting (Milestone 7)
- **Updated**: `.markdownlint.json` with appropriate rule exceptions
- **Verified**: Zero markdownlint errors on user-facing documentation
- **Added**: `npm run lint:markdown` script

### Developer Experience
- **New**: `npm run lint:all` - Comprehensive lint check (TypeScript + Python + Markdown)
- **New**: `npm run lint:python` - Bridge code linting with ruff
- **New**: `npm run lint:markdown` - User-facing doc linting
- **New**: `.github/workflows/lint.yml` - CI lint enforcement on push/PR

## [0.4.9]

### Fixed - Plan 041: Capture Command UX Fixes

**UX Improvement Release** - Improves the `Ctrl+Alt+C` (Cmd+Alt+C on Mac) capture workflow for intuitive behavior.

#### Editor Selection Prioritization
- **Fixed**: `Ctrl+Alt+C` capture command now correctly uses highlighted text from the active editor
- **Behavior**: When text is selected in the editor, the input box pre-fills with that selection
- **Benefit**: Users can capture highlighted code or notes directly without manual copying

#### Cancellation Logic Fix
- **Fixed**: Pressing Escape now properly cancels the capture operation
- **Previous**: Escape would fall back to clipboard content, causing unintended captures
- **Now**: Escape shows "Capture cancelled" message and aborts without any ingestion

#### Clipboard Fallback (Power User Feature)
- **Preserved**: Submitting an empty input box (Enter with no text) still reads from clipboard
- **Use Case**: Power users can copy content to clipboard, press `Ctrl+Alt+C`, then Enter to capture

#### Content Source Transparency
- **Improved**: Output channel now logs the source of captured content:
  - "Capturing from Editor Selection (X chars)"
  - "Capturing from User Input (X chars)"
  - "Capturing from Clipboard (X chars)"
- **Benefit**: Users can verify what content was actually captured via Output > Flowbaby

#### Empty-All-Sources Handling
- **Added**: When no selection exists, input is empty, and clipboard is empty, shows "Nothing to capture" info message
- **Benefit**: Clear feedback instead of silent failure when there's nothing to capture

## [0.4.8]

### Fixed - Plan 040.1: First-Time Initialization Hotfix

**Critical Hotfix** - Resolves first-time workspace initialization failure introduced in v0.4.7 that required window reload.

#### FlowbabyClient Recreation After Environment Setup (M1)
- **Bug**: Fresh workspaces showed "No module named 'cognee'" error after clicking "Initialize" because FlowbabyClient was created at activation time with system Python before venv existed
- **Root Cause**: When `createEnvironment()` succeeded, the existing client retained its stale `pythonPath: "python3"` instead of detecting the newly-created `.flowbaby/venv`
- **Fix**: Recreate FlowbabyClient after successful environment creation to detect the new venv Python interpreter
- **Benefit**: Users can now use `@flowbaby` immediately after initialization without any window reload

#### Initialization Timeout Fix (M1.1)
- **Bug**: First-run database creation could timeout on slower machines because `initialize()` used the default 10-second timeout
- **Fix**: Increased `init.py` timeout from 10 seconds to 60 seconds
- **Benefit**: First-run initialization (SQLite, Kuzu, LanceDB setup) completes successfully on slower systems

#### Initialization Logging (M2, M3)
- Added detailed progress logging throughout the initialization flow:
  - `[Plan 040] Starting workspace initialization...`
  - `[Setup] Virtual environment created successfully.`
  - `[Setup] Starting dependency installation...`
  - `[Setup] Dependency installation complete.`
  - `[Plan 040] ✅ Environment created successfully`
  - `[Plan 040] Recreating FlowbabyClient with new environment...`
  - `[Plan 040] ✅ Flowbaby client initialized successfully`
- **Benefit**: Users and support can trace initialization issues via Output > Flowbaby channel

### User Experience Improvements
- **No-reload workflow**: First-time initialization now completes in a single process
- **Clear progress**: Setup notifications show venv creation → dependency install → database init
- **Error transparency**: Detailed logging aids troubleshooting when issues occur

## [0.4.7]

### Fixed - Plan 040: Initialization JSON Errors and No-Reload Workflow

**User Experience Release** - Enables frictionless first-run experience by fixing JSON parse errors, eliminating window reloads, and providing clearer health status messaging.

#### M1: Fix `init.py` Stdout Pollution (Critical)
- **Bug**: The cognee SDK prints "User X has registered" and other messages to stdout during database initialization, corrupting the JSON output and causing `JSON.parse()` failures in the TypeScript client
- **Root Cause**: `create_db_and_tables()`, `get_graph_engine()`, and other cognee operations print directly to stdout
- **Fix**: Added `suppress_stdout()` context manager that captures all stdout/stderr during cognee operations and redirects to file logger
- **Contract**: `init.py` now emits exactly one JSON line to stdout and nothing else

#### M2: Chain `flowbabyClient.initialize()` After Environment Setup
- **Bug**: The "Initialize Workspace" command only created the venv but did not initialize the Flowbaby client, forcing users to reload the window
- **Fix**: After successful environment creation, the command now chains into `flowbabyClient.initialize()`, sets `clientInitialized = true`, and registers all providers/tools
- **Benefit**: Users can immediately use `@flowbaby` after clicking "Initialize" without any page reload
- **Added**: Structured error handling with user-facing notifications and Output channel logging for initialization failures

#### M3: Unify Health Check Logic for Fresh Workspaces
- **Bug**: Fresh workspaces with only `.flowbaby/logs` directory were incorrectly marked as "BROKEN" instead of "FRESH"
- **Root Cause**: `checkWorkspaceHealth()` returned `BROKEN` if `.flowbaby` existed but `bridge-env.json` was missing
- **Fix**: Missing `bridge-env.json` now correctly returns `FRESH` (setup required), not `BROKEN` (repair required)
- **Benefit**: Fresh workspaces show "Initialize" prompt instead of confusing "Repair Environment" prompt
- **Updated**: UX messaging now clearly distinguishes between "needs setup" (FRESH) and "needs repair" (BROKEN) states

#### M4: Increase Initialization Timeout
- **Bug**: First-run initialization could time out prematurely (15s) during database creation on slower machines or when downloading LanceDB embedding models
- **Fix**: Increased timeout from 15 seconds to 60 seconds for first-run initialization
- **Benefit**: Slow first-run initializations complete successfully without false timeout failures

### User Experience Improvements
- **No-reload workflow**: Complete initialization from setup to ready state without any window reload
- **Clear messaging**: Distinct prompts for fresh workspaces ("Initialize") vs broken environments ("Repair")
- **Error transparency**: Initialization failures now show user-facing notifications with actionable guidance

## [0.4.6]

### Fixed - Plan 039: Initialization UX and Security Hardening

**User Experience and Security Release** - Resolves activation deadlock, improves initialization guidance, and implements security hardening from Plan 037 audit.

#### M1: Fix Activation Deadlock
- **Bug**: Extension activation could hang indefinitely when initialization failed, requiring VS Code restart
- **Root Cause**: Blocking `await vscode.window.showWarningMessage()` in failure path prevented `activate()` from returning
- **Fix**: Replaced blocking `await` with non-blocking `.then()` callback pattern, ensuring activation completes within 2 seconds

#### M2: Register `Flowbaby.initializeWorkspace` Command
- **New**: Added `Flowbaby.initializeWorkspace` command for workspace initialization
- **Change**: `Flowbaby.setupEnvironment` retained as backward-compatible alias
- **Benefit**: Consistent command naming within `Flowbaby.*` namespace

#### M3: Proactive Health Check
- **New**: `checkWorkspaceHealth()` method returns `FRESH | BROKEN | VALID` status
- **Change**: Activation flow now checks workspace health before attempting client initialization
- **Benefit**: Targeted UX guidance based on actual workspace state (fresh vs corrupted vs ready)
- **Added**: Migration marker validation (`.migration-in-progress` check) per architecture review R3

#### M4: Full Database Initialization
- **Verified**: `init.py` already performs complete database priming (SQLite, Kuzu, LanceDB) for fresh workspaces
- **No changes required**: Existing implementation meets acceptance criteria

#### M5: Remove `.env` API Key Support (Security - F2)
- **Breaking Change**: Removed workspace `.env` file API key loading
- **Migration**: Users must use `Flowbaby: Set API Key` command for secure SecretStorage
- **Rationale**: Plaintext API keys in `.env` files are credential exposure risk
- **Files Updated**: `flowbabyClient.ts`, `init.py`, `ingest.py`, `retrieve.py`, `list_memories.py`, `validate_memories.py`

#### M6: Audit Logging (Security - F7)
- **New**: `AuditLogger` class for security event tracking
- **Format**: JSON-lines structured logging to `.flowbaby/logs/audit.jsonl`
- **Events Logged**: API key changes, memory clear operations, environment initialization
- **Benefit**: Security audit trail for credential and data operations

#### M7: Safe Memory Clear with Soft-Delete (Security - F8)
- **Change**: `clearMemory()` now moves data to `.flowbaby/.trash/{timestamp}/` instead of permanent deletion
- **Benefit**: Recovery possible for accidentally cleared memories
- **New**: `purgeTrash()` method for permanent trash cleanup
- **Audit**: All clear operations logged via AuditLogger

#### M8: Version and Release Artifacts
- **Version**: 0.4.5 → 0.4.6
- **Changelog**: Updated with Plan 039 changes

### Breaking Changes
- **API Key Source**: Workspace `.env` files no longer used for API key resolution. Use `Flowbaby: Set API Key` command or set `LLM_API_KEY` environment variable.

### Security Improvements
- Credentials now stored in VS Code SecretStorage (encrypted)
- Security-relevant operations logged to audit trail
- Data deletion uses soft-delete with recovery option

## [0.4.5]

### Fixed - Plan 034: Initialization Bugs and Background Notification Issues

**Maintenance Release** - Resolves 3 critical bugs affecting new workspace initialization and background processing notifications.

#### Database Initialization for Fresh Workspaces
- **Bug**: Fresh workspaces threw `sqlite3.OperationalError: no such table: principals` during user registration
- **Root Cause**: Database table creation was implicitly part of `prune_system()`. Fresh workspaces (where pruning is skipped) never called table creation
- **Fix**: Explicitly call `create_db_and_tables()` from `cognee.infrastructure.databases.relational` in the fresh workspace initialization path

#### Lance Namespace Import Error
- **Bug**: `ModuleNotFoundError: No module named 'lance_namespace'` prevented vector engine loading
- **Root Cause**: The `lance-namespace==0.2.0` package on PyPI is broken/incomplete - missing the `lance_namespace` top-level module
- **Fix**: Pinned `lance-namespace==0.0.21` in `requirements.txt` (verified working version)

#### Background Notification False Positives
- **Bug**: "Flowbaby processing failed" notifications appeared despite successful ingestion in logs
- **Root Cause**: `ingest.py` wrote status stubs to `.cognee/background_ops/` (legacy path) while `BackgroundOperationManager.ts` looked for stubs in `.flowbaby/background_ops/`
- **Fix**: Updated `ingest.py` to write status stubs to `.flowbaby/background_ops/`

### Technical Notes
- All fixes maintain backward compatibility with existing workspaces
- Legacy `.cognee/background_ops` stubs will be ignored (no functional impact)
- No migration required from v0.4.4

## [0.4.4]

### Fixed - Plan 033: Complete Environment Variable Hotfix

**Hotfix** - Completes the v0.4.3 environment variable fix that missed `init.py`, preventing "still initializing" hang and `.cognee` folder creation.

#### Root Cause
v0.4.3 correctly fixed `ingest.py` and `retrieve.py` to set `SYSTEM_ROOT_DIRECTORY` and `DATA_ROOT_DIRECTORY` before importing Cognee SDK. However, **`init.py` was missed**, causing:
1. Creation of orphan `.cognee` folder in workspace root
2. Missing `.flowbaby/data` directory
3. "Flowbaby is still initializing..." hang on first activation
4. Retrieval failures ("no relevant memories found")

#### Fix Applied
- Set `SYSTEM_ROOT_DIRECTORY` and `DATA_ROOT_DIRECTORY` environment variables **before** `import cognee` in `init.py` (lines 178-215)
- Changed legacy `.cognee` directory creation to `.flowbaby` for marker files (line 263)
- Conducted bridge-wide import audit - all 8 scripts now follow the "env vars before import" invariant
- Fixed additional non-compliant scripts: `list_memories.py`, `validate_memories.py`, `recover_data.py`

#### Bridge-Wide Invariant (Documented)
All bridge entrypoints must now follow this sequence:
1. Compute `.flowbaby/system` and `.flowbaby/data` paths
2. Create directories with `Path.mkdir(parents=True, exist_ok=True)`
3. Set `os.environ['SYSTEM_ROOT_DIRECTORY']` and `os.environ['DATA_ROOT_DIRECTORY']`
4. **Only then** `import cognee`

This invariant is enforced because Cognee SDK uses `pydantic-settings` with `@lru_cache`, reading environment variables at import time.

#### Test Coverage Added
- `test_sets_env_vars_before_cognee_import` - verifies env var values
- `test_creates_flowbaby_dirs_not_cognee_dirs` - filesystem regression test
- `test_env_vars_contain_flowbaby_path` - path validation

## [0.4.3]

### Fixed - Hotfix: Cognee SDK Environment Variable Names

**Critical Hotfix** - Fixes storage directory misconfiguration causing `FileNotFoundError: Storage directory does not exist: '.cognee_data'`.

#### Root Cause
v0.4.2 used incorrect environment variable names (`COGNEE_SYSTEM_ROOT_DIRECTORY`, `COGNEE_DATA_ROOT_DIRECTORY`). The Cognee SDK's `BaseConfig` uses pydantic-settings which reads environment variables matching the exact field names—no `COGNEE_` prefix.

#### Fix Applied
- Changed `COGNEE_SYSTEM_ROOT_DIRECTORY` → `SYSTEM_ROOT_DIRECTORY` in `ingest.py` and `retrieve.py`
- Changed `COGNEE_DATA_ROOT_DIRECTORY` → `DATA_ROOT_DIRECTORY` in `ingest.py` and `retrieve.py`

#### Impact
- Background cognify operations now correctly use workspace-local `.flowbaby/` paths
- New data files appear in `.flowbaby/data/` instead of `~/.cognee_data`

## [0.4.2]

### Fixed - Plan 032: Activation and Background Processing Bugs

**Maintenance Release** - Resolves 6 bugs affecting extension activation, database generation, log rotation, and branding consistency.

#### Chat Agent Registration (#1)
- **Bug**: @flowbaby chat participant only appeared after extension fully initialized, requiring user to reload window
- **Root Cause**: `registerFlowbabyParticipant()` was called inside `if (initialized)` block, delaying UI registration
- **Fix**: Moved chat participant registration BEFORE `flowbabyClient.initialize()` with graceful degradation - handler shows "⏳ Flowbaby is still initializing..." message while backend completes setup

#### Cognee SDK Storage Pathing (#2)
- **Bug**: Database files created in `~/.cognee_data` instead of workspace-local `.flowbaby/data`
- **Root Cause**: Cognee SDK may cache paths on import; environment variables were set after import in bridge scripts
- **Fix**: 
  - Added explicit `.flowbaby/data` directory creation in `init.py` alongside `.flowbaby/system`
  - Restructured `ingest.py` and `retrieve.py` to set `COGNEE_SYSTEM_ROOT_DIRECTORY` and `COGNEE_DATA_ROOT_DIRECTORY` environment variables BEFORE `import cognee`
  - Safety check `workspace_has_data()` already existed and continues to prevent accidental data loss

#### Log Rotation Fix (#3)
- **Bug**: Python RotatingFileHandler writing to `.log.1` instead of `.log` after rotation
- **Root Cause**: TypeScript `BackgroundOperationManager` was opening log file descriptor and passing it to spawned Python process; TypeScript holding the fd prevented Python from rotating properly
- **Fix**: Removed `logFd` file descriptor passing in `spawnCognifyProcess()`. Python `bridge_logger.py` now handles all log rotation independently using its own RotatingFileHandler

#### Branding Consistency (#4)
- **Bug**: Toast notifications showed "⚠️ Cognify failed" and "✅ Cognify finished" instead of Flowbaby branding
- **Fix**: Updated all user-facing toast messages in `BackgroundOperationManager.ts`:
  - `'✅ Cognify finished'` → `'✅ Flowbaby processing finished'`
  - `'⚠️ Cognify failed'` → `'⚠️ Flowbaby processing failed'`
  - Updated corresponding internal log messages for consistency

### Technical Notes
- Plan 032 follows architectural guidance from Plan 031 and maintains backward compatibility
- No migration required from v0.4.1; users can update seamlessly
- Log file location unchanged: `.flowbaby/logs/flowbaby.log`

## [0.4.1]

### Fixed - Plan 031: Background API Key and Logging Consolidation

**Critical Hotfix** - Resolves v0.4.0 regressions affecting background ingestion and logging.

#### Background Ingestion API Key Fix
- **Root Cause**: `BackgroundOperationManager.spawnCognifyProcess()` was not injecting `LLM_API_KEY` from SecretStorage into the spawned process environment, causing `MISSING_API_KEY` errors for users who relied on the "Flowbaby: Set API Key" command.
- **Fix**: Added `resolveApiKey()` and `getLLMEnvironment()` methods to `BackgroundOperationManager`, mirroring the working implementation in `FlowbabyClient`. These methods now properly inject API keys from:
  1. Workspace `.env` file (highest priority)
  2. VS Code SecretStorage (`flowbaby.llmApiKey`)
  3. System environment variable (`LLM_API_KEY`)
- **Scope**: Applies to `spawnCognifyProcess()` (background cognify) and `runPythonJson()` (add-only retry).

#### Logging Consolidation
- **Unified Log File**: All Python bridge logs now write to `.flowbaby/logs/flowbaby.log` (was split between `bridge.log` and `ingest.log`).
- **Updated Logger**: `bridge_logger.py` updated to use `.flowbaby/logs/flowbaby.log` path and `flowbaby.*` logger names.
- **View Logs Action**: "View Logs" notification action now opens the consolidated log file.

#### Test Infrastructure
- **rdflib Dependency**: Added early detection for missing `rdflib` library in test environment with actionable error message in `conftest.py`.
- **Updated Tests**: `test_logging_overhaul.py` updated to use new log paths.

#### Documentation
- **README.md**: Fixed Windows path example to use `.flowbaby` instead of `.cognee`.
- **extension.ts**: Fixed incorrect pip install instruction - changed "pip install flowbaby" to "pip install cognee" (flowbaby is the VS Code extension name, not a Python package).

## [0.4.0]

### ⚠️ BREAKING CHANGES

This release rebrands the extension from "RecallFlow Chat Memory" to "Flowbaby" with significant breaking changes:

#### Branding Changes
- Extension renamed: `cognee-chat-memory` → `flowbaby`
- Publisher changed: `flowbaby` → `flowbaby`
- Display name: `RecallFlow Chat Memory` → `Flowbaby`

#### Command Changes
- All `cognee.*` commands renamed to `Flowbaby.*`
- Example: `cognee.captureMessage` → `Flowbaby.captureMessage`

#### Settings Changes
- All `cogneeMemory.*` settings renamed to `Flowbaby.*`
- Example: `cogneeMemory.enabled` → `Flowbaby.enabled`
- **Action Required**: Update your settings.json if you have custom configurations

#### Chat Participant Changes
- `@flowbaby-memory` → `@flowbaby`

#### Tool Changes (for Agent Developers)
- `flowbaby_storeMemory` → `flowbaby_storeMemory`
- `flowbaby_retrieveMemory` → `flowbaby_retrieveMemory`
- `#flowbabyStoreSummary` → `#flowbabyStoreSummary`
- **Action Required**: Update your `.agent.md` files

#### Workspace Storage Changes
- All extension data now stored under `.flowbaby/` (was `.cognee/`, `.cognee_data/`, `.cognee_system/`)
- **Action Required**: Re-set your API key via `Flowbaby: Set API Key` command
- **Note**: Previous workspace memories are not migrated

#### Logging Consolidation
- Single log file: `.flowbaby/logs/flowbaby.log`
- Removed redundant `ingest.log`

### Migration Steps

1. Uninstall the old extension
2. Install Flowbaby v0.4.0
3. Run `Flowbaby: Set API Key` to configure your LLM API key
4. Update any custom keybindings from `cognee.*` to `Flowbaby.*`
5. Update any agent definitions to use new tool names

## [0.3.17]

### Fixed - Plan 028: Post-v0.3.16 Bug Fixes and Developer Experience

- **Duplicate Output Channels**: Fixed issue where multiple "Flowbaby Memory" output channels were created. Implemented singleton pattern in `outputChannels.ts`.
- **Status Bar Unclickable**: Fixed status bar command registration timing issue. Commands are now registered early in activation with try/catch error handling.

### Added

- **Debug Logging Channel**: New opt-in debug output channel for troubleshooting. Enable via `Flowbaby.debugLogging` setting and use "Flowbaby: Show Debug Logs" command.
- **Isolated Python Environment**: venv moved from `.venv` to `.flowbaby/venv` to prevent conflicts with project virtual environments and Python language servers (e.g., Pylance/Jedi).
- **venv Conflict Detection**: When an existing `.venv` is detected, users are offered a choice between the isolated `.flowbaby/venv` (recommended) or using the existing `.venv` (advanced).
- **Global API Key via SecretStorage**: New "Flowbaby: Set API Key" command stores API keys securely via VS Code's SecretStorage API. Keys are shared across all workspaces.
- **API Key Priority**: Resolution order is now workspace `.env` > SecretStorage (global) > system environment variable.
- **Global LLM Configuration**: New settings `Flowbaby.llm.provider`, `Flowbaby.llm.model`, and `Flowbaby.llm.endpoint` for configuring LLM providers without per-workspace `.env` files.
- **Clear API Key Command**: New "Flowbaby: Clear API Key" command to remove stored SecretStorage key.

### Changed

- **Python Interpreter Detection**: Priority order updated to: explicit setting > `.flowbaby/venv` > `.venv` (legacy) > system python3.
- **Documentation**: Updated README and SETUP docs to reflect new setup flow, removed global pip install requirement, documented new features and troubleshooting steps.

## [0.3.16]

### Fixed - Plan 027: Migration Marker Data Loss Bug

- **Critical P0 Bug Fix**: Fixed a bug that caused 96% data loss when the cognee Python package was reinstalled. The migration marker was being written to the volatile venv location instead of the workspace-local `.flowbaby/system/` directory.
- **Root Cause**: `get_relational_config()` was called BEFORE `cognee.config.system_root_directory()`, returning the venv path instead of the configured workspace path.
- **Reordered Initialization**: Workspace directories are now configured FIRST, and the marker path is derived directly from the workspace path (never querying SDK config).
- **Safety Check**: Added `workspace_has_data()` function that refuses to prune if existing LanceDB or Kuzu data is detected, preventing accidental data loss.
- **Prominent Warnings**: Added visual warning separators (`====`) before any prune operation to make the action obvious in logs.
- **Data Integrity Health Check**: Added `get_data_integrity_status()` function to compare SQLite vs LanceDB counts for consistency monitoring.

### Testing
- Added `extension/bridge/tests/test_init_migration.py` with 15 test cases covering marker location, safety checks, and integrity status.

## [0.3.15]

### Fixed - Plan 026: Path Canonicalization and Retrieval Scoring

- **Path Canonicalization**: All 5 Python bridge scripts (`ingest.py`, `retrieve.py`, `init.py`, `list_memories.py`, `validate_memories.py`) now strictly canonicalize workspace paths at entry. This fixes `IngestionError 415` when opening workspaces with relative paths (e.g., `code .`).
- **UI Initialization**: Fixed a "chicken-and-egg" bug where the Status Bar and Setup Service were only created *after* successful initialization. They now appear immediately, ensuring the "Setup Required" indicator is visible in fresh workspaces.
- **Synthesized Answer Scoring**: Fixed confusing display of synthesized graph answers (which have a raw score of 0.00). The bridge now detects this sentinel, assigns a high ranking score, and attaches a `confidenceLabel="synthesized_high"` metadata field.
- **Qualitative UI Labels**: The UI now displays "High relevance (synthesized)" for graph completions instead of overloading the numeric score or showing 0.00.

## [0.3.14]

### Added - Plan 025: Simplified Python Environment Setup

- **Managed Python Environment**: Flowbaby now automatically creates and manages a dedicated `.venv` virtual environment in your workspace, eliminating manual setup steps.
- **One-Click Setup**: New "Initialize Workspace" command handles Python version checks (3.8+), virtual environment creation, and dependency installation in a single click.
- **Status Bar Indicator**: Added a status bar item showing environment health (Ready, Setup Required, Refreshing, Error) with quick access to repair actions.
- **Dependency Management**: New "Refresh Dependencies" command safely updates the bridge environment, coordinating with background operations to prevent conflicts.
- **Smart Precedence**: Automatically detects existing `.venv` or configured Python paths, but prioritizes the managed environment for reliability.
- **Enhanced Walkthrough**: The "Get Started" walkthrough now guides users through the automated setup process with context-aware completion steps.
- **Robust Metadata**: Tracks environment state and version compatibility in `.flowbaby/bridge-env.json` to ensure stability across updates.

## [0.3.13]

### Added - Plan 024: Configurable Search Parameters

- **Configurable Search Depth (`searchTopK`)**: Added new `Flowbaby.searchTopK` setting (default 10, range 1–100) to control how many candidates the Flowbaby search engine returns before ranking.
- **Higher Context Token Budget**: Increased `Flowbaby.maxContextTokens` default from 2000 to 32000 and maximum to 100000 to better support large-context models.
- **Bridge Safeguards**: `retrieve.py` now clamps `max_tokens` into the [100, 100000] window, normalizes `top_k` so it is never lower than `max_results`, and hard-clamps `top_k` to 100 to prevent runaway latency.
- **Normalization & Logging**: When a user-provided `top_k` is raised to meet `max_results` or clamped to the ceiling, the bridge logs a structured warning with both requested and effective values for easier debugging.
- **Client Logging & Truncation**: `CogneeClient` logs the configured `searchTopK` value on each retrieval and passes it through to the bridge. Output-channel payloads remain truncated to keep the VS Code UI responsive.

## [0.3.12]

### Fixed - Plan 022: Retrieval Filtering and Truncation

- **Retrieval Filtering**: Fixed aggressive filtering of "no_relevant_context" responses. The bridge now uses an exact match check instead of a substring match, preventing valid answers that quote the sentinel value from being discarded.
- **Client Truncation**: Increased `CogneeClient` stdout buffer from 2KB to 1MB. This fixes JSON parse errors when retrieval results exceed the default buffer size.
- **Error Logging**: Improved error reporting to capture and log both stdout and stderr when JSON parsing fails, aiding in debugging bridge issues.
- **Telemetry**: Added `filtered_count` to retrieval telemetry to track how many items are filtered by the bridge.

## [0.3.11]

### Fixed - Plan 021: Retrieval Display for Synthesized Answers

- **Retrieval Display Bug**: Fixed a regression where synthesized answers (score 0.0) were silently filtered out by the client-side safety check.
- **Sentinel-Aware Filter**: Updated `CogneeContextProvider` to explicitly allow results with `score === 0.0` (sentinel for synthesized answers) while maintaining strict filtering for low-confidence noise (e.g., 0.001 - 0.009).
- **Logging**: Added debug logging to indicate when synthesized answers are included in retrieval results.

## [0.3.10]

### Fixed - Plan 023: Retrieval Scoring Hotfix

- **Retrieval Regression**: Fixed an issue where valid `GRAPH_COMPLETION` answers (synthesized strings) were discarded because they lacked a semantic score and hit the strict `score <= 0.01` filter introduced in v0.3.9.
- **Logic Update**: `retrieve.py` now bypasses the strict score filter for synthesized answers (which default to score 0.0) while maintaining the filter for `NO_RELEVANT_CONTEXT` responses.

## [0.3.9]

### Added - Plan 021: Logging Infrastructure Overhaul

**Structured Bridge Logging** - Python bridge scripts now use a shared logging utility that emits structured JSON-lines to both the VS Code Output Channel and a persistent workspace log file (`.flowbaby/logs/bridge.log`).
- **Rotating Log File**: `bridge_logger.py` writes untruncated diagnostics with 5MB rotation (3 backups) so retrieval and ingestion history is never lost.
- **Detailed Retrieval Telemetry**: `retrieve.py` logs candidate lists, semantic scores, recency/status multipliers, filtering reasons, and final selections for each query.
- **Ingestion Metrics**: `ingest.py` reports character counts and stage durations, making performance bottlenecks obvious.
- **Consistent Formatting**: All bridge scripts (`init.py`, `validate_memories.py`, `list_memories.py`) now produce structured JSON logs for easier parsing and UI rendering.
- **VS Code Output Contract**: Stderr handler keeps Output Channel entries lightweight (~2KB) while retaining full fidelity in file logs.

### Testing
- Added `extension/bridge/tests/test_logging_overhaul.py` covering log file creation, ingestion metrics, retrieval scoring telemetry, and stderr formatting.

## [0.3.8]

### Added - Plan 021: Memory Visibility and Trust

**Zero-Hallucination Retrieval** - Implemented strict filtering to prevent irrelevant memories from polluting context:
- **Strict Score Threshold**: Retrieval results with distance scores > 0.01 are now filtered out by default.
- **Explicit "No Context" Signal**: Bridge now returns `NO_RELEVANT_CONTEXT` signal when no memories meet the threshold, preventing hallucinated "matches".
- **Validation Tools**: New commands for inspecting memory state:
  - `Flowbaby: Validate Memories` - Runs integrity checks on stored memories.
  - `Flowbaby: List Memories` - Dumps raw memory content for debugging.

**Fixed**:
- **Integration Test Stability**: Fixed path resolution errors in integration tests by correctly injecting `extensionPath` into the mock context. All 149 tests now pass.
- **Branding Cleanup**: Removed "formerly Cognee" references from extension description and UI strings for a cleaner "Flowbaby" identity.

## [0.3.7]

### Fixed - Plan 019: Flowbaby Rebranding Gaps

- **Publisher Identity**: Marketplace publisher ID now set to `flowbaby` with author updated to "Flowbaby Team" so the extension no longer appears under the legacy Cognee brand.
- **Language Model Tools**: Renamed tool identifiers and reference names to `flowbaby_storeMemory` / `flowbaby_retrieveMemory` so Configure Tools, chat autocomplete, and `.agent.md` definitions all reflect the Flowbaby brand.
- **Documentation Alignment**: `README.md` and `AGENT_INTEGRATION.md` now show the correct tool names and usage examples, preventing confusion for agent developers.
- **Test Coverage**: Integration tests updated to ensure the new tool identifiers register correctly with GitHub Copilot chat and that UI instructions stay in sync.

## [0.3.6]

### Added - Plan 019: Retrieval Fabrication and Silent Failure Fix

**Rebranding to Flowbaby** - The extension has been renamed to "Flowbaby" to better reflect its purpose as a memory and recall layer for AI agents.
- **User-Facing Changes**:
  - Extension name: "Flowbaby Chat Memory"
  - Commands: `Flowbaby: Capture to Memory`, `Flowbaby: Toggle Memory`, etc.
  - Output Channel: "Flowbaby Agent Activity"
  - Chat Participant: `@flowbaby-memory`
  - Tools: "Store Memory in Flowbaby", "Retrieve Flowbaby Memory"
  - **Tool Renaming**: `flowbaby_storeMemory` → `flowbaby_storeMemory`, `flowbaby_retrieveMemory` → `flowbaby_retrieveMemory`
- **Backward Compatibility**:
  - Internal configuration keys (`Flowbaby.*`) remain unchanged
  - File paths (`.flowbaby/`) remain unchanged
  - Python package (`cognee`) remains unchanged

**Fixes & Improvements**:

- **Retrieval Fabrication Fix**: Changed default semantic score for unscored results from 0.7 to 0.0. This prevents empty or irrelevant results from appearing with artificially high confidence scores.
- **Silent Failure Detection**:
  - Implemented log rotation for background processes (`.flowbaby/logs/ingest.log`)
  - Redirected `stdout`/`stderr` of background processes to log files to capture crashes
  - Added "zombie" detection for processes that exit without writing a status stub
- **Proactive Prevention**: Enforced 100k character limit on ingestion payloads to prevent bridge crashes and memory exhaustion.
- **UX Enhancements**: Added timestamps to `Flowbaby: Show Background Operations` quick pick items for better visibility.

## [0.3.5]

### Added - Plan 018: Metadata Infrastructure and Ranking

**Intelligent Ranking & Filtering** - Retrieval now prioritizes memories based on recency and status:
- **Recency-Aware Ranking**: New exponential decay algorithm prioritizes fresh memories. Configurable via `Flowbaby.ranking.halfLifeDays` (default: 7 days).
- **Status Filtering**: Memories can be marked as `Active`, `Superseded`, or `DecisionRecord`.
  - `Superseded` memories are hidden by default to reduce noise.
  - `DecisionRecord` memories receive a relevance boost.
- **Metadata-Rich Storage**: Summaries now embed structured metadata (topicId, status, timestamps) directly in the text, enabling robust tracking even without graph metadata support.

**Technical Implementation**:
- **Enriched Text Fallback**: Implemented "Enriched Text" pattern to store metadata within summary text, bypassing Cognee 0.3.4 DataPoint limitations.
- **Migration Script**: New `migrate_summaries.py` script automatically upgrades legacy memories to the new schema.
- **Safe Migration**: Uses file locking (`.flowbaby/maintenance.lock`) to pause background operations during migration.
- **Updated Tool Definitions**: `flowbaby_storeMemory` and `flowbaby_retrieveMemory` tools updated with clearer descriptions and privacy guarantees ("Data stays in this workspace").

### Fixed
- **Ranking Quality**: Addressed issue where old, less relevant memories cluttered retrieval results.
- **Status Visibility**: Superseded plans and decisions no longer confuse agents.

## [0.3.4]

### Release

This release packages the async cognify() optimization (Plan 017) with no functional changes from v0.3.3. Version bumped to v0.3.4 for clean release tracking.

All features, improvements, and technical details remain as documented in v0.3.3 below. This is a packaging-only release to formalize the deployment.

## [0.3.3]

### Added - Plan 017: Async cognify() Optimization

**Universal Async Memory Ingestion** - ALL ingestion flows (agent tools, manual capture, headless commands) now return in <10 seconds:

- **Staged Messaging**: Every ingestion surface shows: "Memory staged – processing will finish in ~1–2 minutes. You'll get a notification when it's done."
- **Background Processing**: Knowledge graph construction (`cognee.cognify()`) runs in detached subprocess while agents continue working
- **Completion Notifications**: 
  - Success (info): "✅ Cognify finished" with workspace name, summary digest, elapsed time, entity count, "View Status" action
  - Failure (warning): "⚠️ Cognify failed" with workspace name, summary digest, remediation guidance, "Retry"/"View Logs" actions
- **Independent Throttling**: Success and failure notifications throttled separately (≤1 per 5 min per workspace per outcome type)
- **Background Status Command**: New `cognee.backgroundStatus` command shows all in-flight/completed operations with quick-pick UI

**Technical Implementation**:

- Split `ingest.py` into 3 modes: `--mode sync` (diagnostic), `--mode add-only` (fast staging <10s), `--mode cognify-only` (background graph construction)
- BackgroundOperationManager service with:
  - Dual-ledger persistence (`.flowbaby/background_ops.json` + VS Code globalState)
  - Concurrency limits: max 2 concurrent + FIFO queue of 3 pending operations
  - Detached subprocess spawning with PID tracking
  - Activation reconciliation (reattach live PIDs, mark stale entries `unknown`)
  - Deactivation cleanup (SIGTERM with 5s grace + SIGKILL)
  - Atomic status stub writes prevent corruption on crashes
- Updated client methods: `ingestSummaryAsync()` and `ingestAsync()` for summary and conversation ingestion
- Comprehensive bridge test suite (15+ tests) covering all modes, error handling, backward compatibility

**Performance Impact**:

- Agent blocking time: **73s → <10s (86% reduction)**
- Manual capture blocking time: **73s → <10s (86% reduction)**
- Background processing: 60-90s (unchanged, runs asynchronously)
- **Result**: Agents can store 3 memories in 30s instead of 219s

**User Experience Changes**:

- Manual capture (`Ctrl+Alt+C`) now shows staged toast instead of blocking
- Agent tools (`#cogneeStoreSummary`) return immediately with operationId
- All users receive completion notification when background processing finishes
- Output channel shows full audit trail: `[BACKGROUND]` markers for start/success, `[ERROR]` for failures

**Backward Compatibility**:

- Sync mode (`--mode sync`) preserves legacy behavior for diagnostic/test use
- Conversation mode (positional args) continues to work with sync mode
- All existing tests pass unchanged

### Fixed - Plan 016.1: Tool Lifecycle and Bridge Timeouts Hotfix

**Bug Fixes**:

- **Tool Lifecycle UI Desync**: Fixed issue where Configure Tools dialog showed stale enablement state when toggling tools on/off. Tools now register unconditionally at extension activation; VS Code's Configure Tools UI is the sole authorization mechanism (no redundant workspace setting).
- **Bridge Timeout Opacity**: Added comprehensive diagnostic logging to Python bridge scripts (ingest.py, retrieve.py) with `[PROGRESS]`, `[WARNING]`, and `[ERROR]` markers. Users now see step-by-step progress in Output channel when bridge operations are slow or fail.
- **Redundant Authorization**: Removed `Flowbaby.agentAccess.*` workspace settings entirely. Simplified authorization model: users enable/disable tools via Configure Tools UI only.

**Breaking Changes**:

- Removed settings: `Flowbaby.agentAccess.enabled`, `Flowbaby.agentAccess.maxResultsDefault`, `Flowbaby.agentAccess.maxTokensDefault`, `Flowbaby.agentAccess.maxConcurrentRequests`, `Flowbaby.agentAccess.rateLimitPerMinute`
- Status bar "Cognee Agent Access" indicator removed (Configure Tools dialog provides feedback)
- Error code `ACCESS_DISABLED` no longer returned (tools always registered)

**Technical Details**:

- Bridge scripts emit structured error payloads with error codes: `LLM_API_ERROR`, `COGNEE_SDK_ERROR`, `PYTHON_ENV_ERROR`, `ONTOLOGY_LOAD_ERROR`
- TypeScript client (cogneeClient.ts) parses stderr for diagnostic markers and surfaces at appropriate log levels (INFO/ERROR/WARN)
- Fixed sys module import shadowing bug in retrieve.py
- Test suite updated to reflect new authorization model

**User Impact**:

- Simpler authorization: single source of truth (Configure Tools)
- Better debugging: diagnostic logs visible in Output > "Flowbaby" channel
- Faster resolution of bridge issues: progress markers identify exactly where operations block

## [0.3.2]

### Fixed - Plan 016.1: Tool Lifecycle and Bridge Timeouts Hotfix

**Bug Fixes**:

- **Tool Lifecycle UI Desync**: Fixed issue where Configure Tools dialog showed stale enablement state when toggling tools on/off. Tools now register unconditionally at extension activation; VS Code's Configure Tools UI is the sole authorization mechanism (no redundant workspace setting).
- **Bridge Timeout Opacity**: Added comprehensive diagnostic logging to Python bridge scripts (ingest.py, retrieve.py) with `[PROGRESS]`, `[WARNING]`, and `[ERROR]` markers. Users now see step-by-step progress in Output channel when bridge operations are slow or fail.
- **Redundant Authorization**: Removed `Flowbaby.agentAccess.*` workspace settings entirely. Simplified authorization model: users enable/disable tools via Configure Tools UI only.

**Breaking Changes**:

- Removed settings: `Flowbaby.agentAccess.enabled`, `Flowbaby.agentAccess.maxResultsDefault`, `Flowbaby.agentAccess.maxTokensDefault`, `Flowbaby.agentAccess.maxConcurrentRequests`, `Flowbaby.agentAccess.rateLimitPerMinute`
- Status bar "Cognee Agent Access" indicator removed (Configure Tools dialog provides feedback)
- Error code `ACCESS_DISABLED` no longer returned (tools always registered)

**Technical Details**:

- Bridge scripts emit structured error payloads with error codes: `LLM_API_ERROR`, `COGNEE_SDK_ERROR`, `PYTHON_ENV_ERROR`, `ONTOLOGY_LOAD_ERROR`
- TypeScript client (cogneeClient.ts) parses stderr for diagnostic markers and surfaces at appropriate log levels (INFO/ERROR/WARN)
- Fixed sys module import shadowing bug in retrieve.py
- Test suite updated to reflect new authorization model

**User Impact**:

- Simpler authorization: single source of truth (Configure Tools)
- Better debugging: diagnostic logs visible in Output > "Flowbaby" channel
- Faster resolution of bridge issues: progress markers identify exactly where operations block

## [0.3.1]

### Added - Plan 015: Agent Ingestion Command

- **Agent Ingestion API**: `Flowbaby.ingestForAgent` command enables GitHub Copilot agents and third-party extensions to store structured summaries in Cognee
  - TypeScript schema validation with detailed error messages
  - Workspace-global access model with prominent privacy warnings
  - Structured JSON request/response with camelCase field naming
  - Auto-generation of missing IDs (topicId, timestamps)
  - Fast-fail validation before bridge invocation
- **Agent Access Control**: New `Flowbaby.agentAccess.enabled` setting (default: false)
  - Workspace-global trust model (all extensions granted access when enabled)
  - Prominent warning in settings UI about privacy implications
  - Access enforcement at command handler level
- **Audit Logging**: Comprehensive logging for all agent ingestion attempts
  - Real-time logs in `Output` > `Cognee Agent Activity` channel
  - Structured JSON audit log at `.flowbaby/agent_audit.log`
  - Privacy-preserving topic digests (8-char SHA-256 hash)
  - Tracks timestamp, agent name, result, error codes, duration
- **Agent Integration Documentation**: Complete API guide at `extension/AGENT_INTEGRATION.md`
  - TypeScript examples (minimal and full payloads)
  - Error handling patterns with error codes
  - Security model explanation
  - Best practices for topic ID generation and ingestion timing
  - Troubleshooting guide
- **Bridge Contract Documentation**: `extension/bridge/INGEST_CONTRACT.md` defines stable ingestion schema
  - JSON payload specification (required/optional fields)
  - Error codes reference (ACCESS_DISABLED, INVALID_PAYLOAD, etc.)
  - Example payloads (minimal, full, invalid)
  - Performance characteristics
  - Testing instructions
- **Test Agent Extension**: Reference implementation at `test-agent/`
  - Validates all ingestion scenarios (valid, invalid, access control)
  - Automated test suite with pass/fail reporting
  - Can be used as template for custom agent development

### Added - Plan 016: Agent Retrieval and UI-Visible Extension Tools

- **Agent Retrieval API**: `Flowbaby.retrieveForAgent` command enables agents to query Cognee knowledge graph
  - Structured JSON request/response with `CogneeContextRequest`/`CogneeContextResponse` types
  - Returns metadata-rich entries (topic, topicId, planId, score, decisions, timestamps)
  - Concurrency limiting (max 2 in-flight requests, configurable up to 5)
  - Rate limiting (max 10 requests/minute, configurable up to 30)
  - Graceful degradation for legacy memories (null metadata fields)
- **CogneeContextProvider Service**: Centralized retrieval infrastructure with architectural guardrails
  - FIFO request queueing with concurrency enforcement
  - Per-minute rate limiting with sliding window
  - Structured error responses (ACCESS_DISABLED, RATE_LIMIT_EXCEEDED, QUEUE_FULL, BRIDGE_TIMEOUT, INVALID_REQUEST)
  - Settings clamping with safe upper bounds (prevents misconfiguration)
- **UI-Visible Language Model Tools**: Both tools appear in VS Code's "Configure Tools" dialog
  - `flowbaby_storeMemory` (`#cogneeStoreSummary`) - Store conversation summaries
  - `flowbaby_retrieveMemory` (`#cogneeRetrieveMemory`) - Retrieve relevant memories
  - Tools support `#` autocomplete in chat and `.agent.md` front-matter references
  - Atomic lifecycle: both tools register/unregister together when `agentAccess.enabled` toggles
  - Icon support for visual identity (`$(database)` and `$(search)`)
- **Custom Agent Integration**: Full support for custom `.agent.md` files
  - Tools reference name format: `tools: ['cogneeStoreSummary', 'cogneeRetrieveMemory']`
  - Confirmation messages for transparency (optional, depends on user trust settings)
  - Retrieve tool returns BOTH narrative markdown AND verbatim JSON payload
- **@flowbaby Participant Refactor**: Now uses shared `CogneeContextProvider`
  - Consistent retrieval behavior across participant and tools
  - Leverages centralized concurrency/rate limiting
  - Enhanced metadata display (topicId, planId, score when available)
- **Transparency Indicators**: All agent activity is auditable
  - Output channel logs every retrieval/ingestion with timestamps, query hashes, result counts
  - Status bar indicator shows "Cognee Agent Access: Enabled" with spinner during operations
  - Click behavior opens Output channel for inspection
- **Enhanced Documentation**:
  - `AGENT_INTEGRATION.md` extended with retrieval examples, tool integration guide, error code reference
  - `README.md` includes "Using Cognee Tools with Custom Agents" section with `.agent.md` examples
  - Complete TypeScript interfaces in `types/agentIntegration.ts`
- **Agent Access Settings**: Additional configuration for retrieval behavior
  - `Flowbaby.agentAccess.maxResultsDefault` (default: 5)
  - `Flowbaby.agentAccess.maxTokensDefault` (default: 4000)
  - `Flowbaby.agentAccess.maxConcurrentRequests` (default: 2, max: 5)
  - `Flowbaby.agentAccess.rateLimitPerMinute` (default: 10, max: 30)

### Changed

- **Minimum VS Code Version**: Requires VS Code 1.106+ for `canBeReferencedInPrompt`/`toolReferenceName` support
- **Extension Activation**: CogneeContextProvider initialization happens after CogneeClient setup
- **Participant Behavior**: @flowbaby now routes through CogneeContextProvider (no breaking changes to user experience)

### Added - Test Coverage Enhancements (from previous release)

### Added - Test Coverage Enhancements

- **Summary Workflow Integration Tests**: 14 new automated tests in `summaryWorkflow.integration.test.ts`
  - 7 workflow tests validate complete "summarize → generate → store" flow
  - 7 snapshot tests guard against README/template drift
  - Tests cover trigger detection, no-history errors, cancellation, large conversations
- **Template Consistency Validation**: Round-trip preservation tests ensure format → parse cycle stability
- **Mixed-Mode Test Coverage**: Validates enriched vs legacy memory handling in integration context
- **Section Heading Stability**: Tests enforce that headings match DATAPOINT_SCHEMA.md exactly

### Fixed

- **Manual Test Isolation**: Added `@pytest.mark.manual` decorator to manual scripts to prevent CI failures
- **Pytest Configuration**: Registered `manual` marker in `pytest.ini` for proper test filtering
- **QA Documentation**: Updated with environment-specific test execution guidance

### Improved

- **Test Suite Reliability**: Default `pytest` runs now succeed (37 passed, 1 skipped)
- **VS Code Test Coverage**: 77 total tests passing (up from 63), no regressions
- **Documentation Accuracy**: Snapshot tests catch template/README divergence automatically

## [0.3.0]

### Added - Plan 014: Structured Conversation Summaries

- **Conversation Summary Generation**: Create structured summaries via `@flowbaby summarize this conversation`
  - Adjustable turn count scope (default: last 15 turns)
  - Interactive scope adjustment before generation
  - LLM-powered summary extraction with Plan 014 schema
  - User confirmation required before storage
- **Enriched Summary Schema**: Structured format with Topic, Context, Decisions, Rationale, Open Questions, Next Steps, References, and Time Scope
- **Metadata-Rich Retrieval**: Summaries include status badges (📋 Status, 📅 Created, 🏷️ Plan ID), structured content sections, and temporal awareness
- **Mixed-Mode Support**: Seamless handling of both enriched summaries (Plan 014+) and legacy raw-text memories
- **In-Chat Help**: Type `@flowbaby help` or invoke with no query to see usage guide
- **Bridge Contract Documentation**: `DATAPOINT_SCHEMA.md` and `RETRIEVE_CONTRACT.md` define stable schemas for downstream consumers

### Changed

- **Retrieval Display**: Now shows structured metadata badges and organized content sections for enriched summaries
- **Python Bridge**: `retrieve.py` returns structured JSON with parsed metadata instead of raw text
- **CogneeClient**: `retrieve()` method returns `RetrievalResult[]` with typed fields (topicId, status, createdAt, decisions, etc.)

### Improved

- **Summary Quality**: Structured format improves retrieval precision by surfacing key decisions and rationale
- **Temporal Context**: Created timestamps enable recency-aware reasoning (foundation for Plan 015 ranking)
- **Status Tracking**: Active/Superseded status field enables decision lifecycle tracking (foundation for Plan 015 compaction)
- **User Control**: Explicit summary creation and confirmation flow ensures intentional memory capture
- **Backward Compatibility**: All legacy raw-text memories remain accessible; retrieval transparently handles both formats

### Technical

- **Enriched Text Storage**: Summaries stored as markdown with embedded metadata per §4.4.1 (Cognee 0.3.4 constraint)
- **Template Versioning**: `<!-- Template: v1.0 -->` tag enables future format migrations
- **Regex-Based Parsing**: Deterministic section heading patterns for metadata extraction
- **TypeScript Tests**: 59/59 passing with updated RetrievalResult mocks
- **Python Tests**: 16/16 passing with enriched text formatting and contract validation

## [0.2.3]

### Fixed

- Display truncation in chat participant - users can now see full retrieved memory content (up to 2000 chars)
- Query logging truncation increased from 50 to 200+ characters for better debugging
- Ingestion timeout increased from 30s to 120s to reduce false-positive failures
- Error messages now distinguish timeout (may still succeed) from true ingestion failure
- Added comprehensive ingestion performance metrics (Python-side duration, step-level timing)
- Added process exit vs timeout logging for diagnosing bridge-level latency

### Improved

- Transparent memory display with character count indicators aligns with discoverability goals (Epic 0.2.2.3)
- Clear truncation indication when memories exceed 2000 chars (shows "showing X of Y chars")
- Query length now shown in debug logs when queries exceed 200 chars
- Ingestion timeout errors now explain background processing may still succeed
- Extension logs include both Node-side and Python-side duration metrics for correlation
- Step-level metrics (load_env, init_cognee, config_llm, dataset_ontology, add, cognify) enable bottleneck identification

## [0.2.2]

### Fixed

- Display truncation in chat participant - users can now see full retrieved memory content (up to 2000 chars)
- Query logging truncation increased from 50 to 200+ characters for better debugging

### Improved

- Transparent memory display with character count indicators aligns with discoverability goals (Epic 0.2.2.3)
- Clear truncation indication when memories exceed 2000 chars (shows "showing X of Y chars")
- Query length now shown in debug logs when queries exceed 200 chars

## [0.2.1]

### Breaking Changes

- **Environment**: `LLM_API_KEY` is now required in workspace `.env`. Previously supported `OPENAI_API_KEY` fallback removed to align with Cognee 0.4.0 conventions.

### Fixed

- Ingestion failures and 30s timeouts caused by Cognee using site-packages storage instead of workspace-local directories
- Silent parameter fallback code that masked configuration errors
- File-not-found errors during ingestion due to cross-context storage mismatches

### Changed

- All Cognee system and data directories now scoped to workspace (`.flowbaby/system/`, `.flowbaby/data/`)
- Removed fallback parameter retries; signature mismatches now surface as clear errors
- Enhanced error logging with structured details (exception type, parameters, context)

## [0.2.0]

### Added

- **Debug Configuration**: VS Code launch.json for F5 Extension Development Host debugging
- **Visible Build Logging**: esbuild now shows compilation progress and errors (logLevel: 'info')
- **Developer Documentation**: Enhanced SETUP.md and README.md with debugging workflow and troubleshooting guidance

### Fixed

- **Extension Activation Failure**: Missing .vscode/launch.json prevented Extension Development Host from loading the extension
- **Silent Build Errors**: Build failures were hidden with logLevel: 'silent', now visible for rapid debugging

### Implementation 008 Features (from v0.1.0 foundation)

#### Added

- **Keyboard Shortcut Capture (Ctrl+Alt+C / Cmd+Alt+C)**: Selective conversation capture via keyboard shortcut + input box workflow
- **@flowbaby Chat Participant**: Explicit memory-augmented chat participant for context retrieval and informed responses
- **Command Palette Capture**: Alternative capture method via "Cognee: Capture to Memory" command
- **Toggle Memory Command**: Quick on/off toggle via "Cognee: Toggle Memory" command
- **Clear Memory Command**: Delete workspace memory via "Cognee: Clear Workspace Memory" command (with confirmation)
- **OWL/Turtle Ontology**: Chat-specific ontology file (`ontology.ttl`) with 8 classes and 12 object properties for grounded entity extraction
- **Conversational Ingestion Format**: Simplified natural prose format for better LLM extraction quality
- **Step 6 Feedback Loop (Experimental)**: Optional automatic capture of @flowbaby conversations (disabled by default due to Cognee 0.4.0 bug)
- **Graceful Degradation**: Retrieval failures show warning but participant continues without context
- **Configuration Setting**: `Flowbaby.autoIngestConversations` for experimental feedback loop control

### Changed

- **User Workflow**: Shifted from automatic global capture to selective, user-controlled keyboard shortcut capture
- **Participant Model**: `@flowbaby` requires explicit invocation; no passive injection into other participants
- **Ontology Integration**: Updated `ingest.py` to use `ontology_file_path` parameter with RDFLib validation and graceful fallback
- **Ingestion Format**: Changed from bracketed metadata format to conversational prose for improved extraction

### Improved

- **Automatic Python Interpreter Detection**: Extension now auto-detects workspace `.venv` virtual environment, eliminating need for manual `Flowbaby.pythonPath` configuration in most cases
- **Enhanced Error Messages**: Python errors (missing packages, API key issues) now visible in Output Channel with actionable troubleshooting hints
- **Workspace-Relative Execution**: Bridge scripts run from workspace context for reliable path resolution
- **Context Display**: Retrieved memories formatted with clear markdown previews ("📚 Retrieved N memories")
- **Performance Logging**: Retrieval timing logged to Output Channel for monitoring (<1000ms P95 target)
- Error logs sanitize sensitive data (API keys, tokens) before display
- Configuration documentation clarifies when manual Python path setting is needed
- Structured error extraction from Python subprocess stdout
- Better diagnostics for missing dependencies and environment issues

### Fixed

- Generic "exit code 1" errors replaced with specific failure reasons
- Missing `cognee` package now clearly diagnosed instead of silent failure
- Python interpreter mismatch no longer requires manual configuration for standard `.venv` setups
- Keyboard shortcut comment typo in code (Ctrl+Shift+M → Ctrl+Alt+C)

### Known Issues

- **Cognee 0.4.0 File Hashing Bug**: Intermittent ingestion failures for repeated identical content affect Step 6 auto-ingestion; workaround via `Flowbaby.autoIngestConversations=false` (default)
- **Manual Capture Workflow**: Keyboard shortcut requires copy-paste; cannot extract message from chat UI directly (VS Code API limitation)
- **Explicit Participant Invocation**: Must type `@flowbaby`; cannot inject context into other participants (API limitation)

### Technical Implementation

- 6-step participant flow: retrieval → format display → augment prompt → generate response → capture conversation (conditional)
- RDFLib ontology parsing with graceful fallback to no-ontology mode
- Asynchronous fire-and-forget ingestion (non-blocking)
- Comprehensive integration test suite (27 passing tests)
- VS Code Chat API v1.105+ compatibility

## [0.1.0]

### Added

- Initial release of Flowbaby extension
- Automatic capture of GitHub Copilot chat conversations  
- Automatic context retrieval from Cognee memory before responses
- Workspace-isolated memory with separate knowledge graphs per workspace
- Chat-specific ontology defining User, Question, Answer, Topic, Concept, Problem, Solution, and Decision entities
- Hybrid graph-vector search combining relationship traversal with semantic similarity
- Recency and importance weighting for intelligent context relevance scoring
- Configurable settings:
  - `Flowbaby.enabled` - Toggle memory on/off
  - `Flowbaby.maxContextResults` - Maximum results to retrieve (1-10)
  - `Flowbaby.maxContextTokens` - Token budget for context (100-10000)
  - `Flowbaby.recencyWeight` - Prioritize recent conversations (0-1)
  - `Flowbaby.importanceWeight` - Prioritize marked conversations (0-1)
  - `Flowbaby.pythonPath` - Custom Python interpreter path
  - `Flowbaby.logLevel` - Debug verbosity (error/warn/info/debug)
- Comprehensive integration test suite with 6 test cases
- Python bridge scripts for Cognee library communication
- Output Channel logging for debugging and monitoring

### Technical Implementation

- Uses Cognee 0.3.4 with dataset-based logical isolation
- SHA1-hashed workspace identifiers for stable and unique dataset naming
- Global marker file pattern prevents data loss during concurrent initialization
- Stateless ontology configuration applied per ingestion operation
- TypeScript extension with Python subprocess bridge architecture
- esbuild-based compilation for optimized bundle size

### Known Limitations

- Requires workspace folder (doesn't work in single-file mode)
- Currently captures conversations through Chat Participant API
- Python and Cognee must be installed separately (not bundled)
- First conversation in new workspace has no context (memory starts empty)
- macOS and Linux tested; Windows support may require additional configuration

[0.1.0]: https://github.com/groupzer0/flowbaby/releases/tag/v0.1.0
