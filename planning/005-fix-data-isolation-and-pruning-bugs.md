# Implementation Plan: Fix Data Isolation and Pruning Bugs

**Plan ID**: 005  
**Created**: November 10, 2025  
**Status**: Proposed  
**Depends On**: `analysis/005-fix-data-isolation-and-pruning-bugs-analysis.md`  
**Blocks**: `planning/004-extension-packaging-and-distribution.md` (Milestone 3)

---

## Change Log

**November 10, 2025 - Post-Critic Review Updates (Round 1)**:
- Fixed inconsistent analysis file reference in Section 8 (corrected to `analysis/005-fix-data-isolation-and-pruning-bugs-analysis.md`)
- Specified test location: concurrency tests extend `test-integration.sh` to maintain single test entry point
- Added data-safety acceptance criteria: release notes updates, dataset preservation verification, pre-prune logging
- Added error-mode acceptance criteria: graceful failure when data directory unwritable
- Tightened dataset name generation requirements: explicit symlink resolution and case handling policy
- Added marker versioning convention (`.migration_v1_complete`) for future migration iterations
- Added standardized logging requirement: single initialization line with dataset ID and migration status
- Resolved open questions with recommendations for Windows support (defer), backup (future enhancement), marker lifecycle

**November 10, 2025 - Post-Critic Review Updates (Round 2)**:
- Updated Problem Summary to reflect current implementation state (dataset scoping exists but lacks hardening)
- Clarified marker strategy: global atomic marker + local workspace acknowledgement markers retained for traceability
- Specified path canonicalization policy: `Path.resolve()` for symlinks; case-sensitive on POSIX; Windows deferred
- Added structured metadata requirement for global marker (timestamp, workspace ID, pre/post-prune size)
- Refined concurrency acceptance criteria with explicit validation observables
- Clarified logging contract: standardized line required; supplemental detail lines permitted
- Added fallback strategy for data directory determination via environment variable
- Specified tagging detection mechanism for data safety (Cognee API dataset enumeration)
- Resolved all ten clarification questions raised by critic

---

## Summary of Critic Feedback and Resolutions

**Critic's Key Findings**:
1. Problem Summary was outdated—dataset scoping already exists in current code but lacks hardening
2. Marker strategy conflicted with integration tests (local vs. global markers)
3. Path canonicalization policy (symlinks, case handling) was undefined
4. Tagged dataset preservation mechanism was unspecified
5. Logging contract ambiguity (single line vs. multi-line diagnostics)
6. Concurrency validation success metrics needed explicit observables
7. Missing fallback strategy for data directory determination

**Resolutions Applied**:
- Updated Problem Summary (Section 2) to reflect current implementation state: dataset scoping exists but path normalization needs hardening
- Clarified hybrid marker strategy (Section 3, Part 2): global atomic marker coordinates prune; local markers retained for traceability
- Specified binding path canonicalization policy (Section 3, Part 1): `Path.resolve()` for symlinks; case-sensitive on POSIX; Windows deferred
- Added structured metadata requirements for global marker (Section 3, Part 2): timestamp, workspace ID, pre/post-prune sizes, version
- Refined logging contract (Section 4, Step 5): standardized line required plus supplemental detail lines permitted
- Enhanced concurrency validation (Section 4, Milestone 2, Step 3): explicit observables for single-prune assertion
- Added fallback strategy (Section 3, Part 2): prioritize API, fallback to env var, fail gracefully
- Resolved all 15 clarification questions with binding decisions (Section 7)

This plan is now aligned with current implementation reality and provides unambiguous guidance for the implementer.

---

## 1. Objective

This plan directs the `implementer` to fix two critical bugs discovered during the review of Plan 003's implementation and subsequent test failures. The objective is to ensure the extension is stable, secure, and reliable by:

1.  **Fixing Workspace Data Leakage**: Implement correct dataset-based logical isolation in the Python bridge scripts to prevent data from one workspace from being accessible in another.
2.  **Eliminating Pruning Race Condition**: Refactor the one-time data pruning logic to be atomic and globally consistent, preventing potential data loss during concurrent workspace initializations.

Completing this plan is a prerequisite for unblocking the VSIX packaging and release process outlined in Plan 004.

---

## 2. Problem Summary

**Current Implementation State**: Recent code review reveals that `ingest.py` and `retrieve.py` **already include** dataset scoping parameters (`dataset_name` passed to `add()`, `cognify()`, and `search()`). However, the Test 4 failure indicates either:
- Path normalization inconsistencies producing different dataset IDs for the same logical workspace, or
- Edge cases (symlinks, relative paths, case variations) not handled uniformly across scripts, or
- Residual untagged data from prior versions leaking into search results.

The analysis documented in `analysis/005-fix-data-isolation-and-pruning-bugs-analysis.md` identified two areas requiring hardening:

1.  **Dataset Scoping Requires Hardening**: While dataset parameters are present, path normalization (symlink resolution, case handling, absolute path enforcement) is inconsistent. The "Workspace A leaked data from workspace B" test failure suggests dataset ID generation diverges under certain path conditions, causing isolation to fail.
2.  **Global Prune Race Condition**: The `init.py` script uses a **local** marker file (`.dataset_migration_complete` in each workspace's `.cognee` directory) to decide whether to perform a **global** data prune. This creates a race condition where two new workspaces initializing simultaneously could both trigger a prune, leading to data loss or corruption.

---

## 3. Solution Approach

The `implementer` will execute the two recommendations from the analyst's report, with additional requirements for data safety, observability, and edge case handling.

### Part 1: Harden Dataset Scoping with Path Normalization

**Objective**: Ensure dataset ID generation is robust, deterministic, and consistent across all path representations.

**What to Verify and Harden**:

- **All three bridge scripts** (`init.py`, `ingest.py`, `retrieve.py`): Confirm dataset scoping parameters are present and validate path normalization consistency.

**Path Canonicalization Policy** (CRITICAL - answer to Critic Question 4, 5):

- **Symlink Resolution**: Always resolve symlinks to their canonical real path using Python's `Path.resolve()` before hashing.
- **Absolute Path Enforcement**: Convert all workspace paths to absolute paths before canonicalization.
- **Case Handling**: Preserve exact case as returned by filesystem (case-sensitive on POSIX). No case normalization applied on Linux/macOS.
- **Windows**: Deferred to future enhancement. If Windows detection is needed, document unsupported status clearly.

**Requirements**:

- Dataset name generation must be **identical** across all three bridge scripts (shared function or identical implementation).
- Path normalization must apply canonicalization **before** hashing in all scripts.
- Dataset identifiers must be stable across workspace re-opens, extension reloads, and symlink/real-path access.
- Validation must confirm that a symlinked path and its real path produce **identical** dataset IDs.
- If path canonicalization fails (permission errors, broken symlinks), initialization must fail gracefully with clear error.

### Part 2: Fix Pruning Race Condition with Data Safety Measures

**Objective**: Ensure exactly one global data prune occurs system-wide, with proper safeguards and observability.

**What to Change**:

- `extension/bridge/init.py`: Replace local-marker-triggers-global-prune logic with hybrid marker strategy.

**Marker Strategy** (CRITICAL - answer to Critic Question 1):

- **Global Atomic Marker**: Create a single global marker (`.migration_v1_complete`) in Cognee's data directory using OS-level atomic file creation to coordinate system-wide pruning.
- **Local Acknowledgement Markers**: Retain per-workspace local markers (`.dataset_migration_complete` in each workspace's `.cognee` directory) for traceability and test compatibility.
- **Dual-Marker Logic**: Process creates global marker atomically and performs prune; all processes (winner and losers) then create their local acknowledgement marker to record participation.

**Global Marker Requirements** (answers Critic Questions 2, 7, 8):

- **Atomic Creation**: Use `os.open()` with `os.O_CREAT | os.O_EXCL | os.O_WRONLY` flags for OS-level exclusivity.
- **Structured Metadata**: Global marker must contain JSON with:
  - `migrated_at`: ISO 8601 timestamp
  - `workspace_id`: Dataset name or workspace path of winning process
  - `data_dir_size_before`: Directory size in bytes before prune (answer to Critic Question 8)
  - `data_dir_size_after`: Directory size in bytes after prune
  - `version`: Migration version identifier (e.g., "v1")
- **Location Determination** (answer to Critic Question 6): Prioritize `cognee.config.get_data_dir()` API; fallback to `COGNEE_DATA_DIR` environment variable if API unavailable; fail gracefully with clear error if neither resolves.
- **Versioned Naming**: Use `.migration_v1_complete` to support future incremental migrations.

**Concurrency Requirements** (answer to Critic Question 5):

- Exactly one process system-wide successfully creates global marker and performs prune.
- All other concurrent processes detect `FileExistsError`, skip prune, and log "migration already performed."
- Observable artifacts for validation: global marker creation timestamp, `migration_performed` flag in init response, log entries showing exactly one prune execution.

**Error Handling**:

- If data directory is not accessible or writable, initialization must fail gracefully with actionable error in Output Channel.
- Handle permission errors, broken symlinks, missing directories, and filesystem failures with clear user-facing messages.
- If global marker cannot be created due to permissions (not concurrency), escalate error to user.

**Logging and Observability** (answer to Critic Question 3):

- Log data directory size **before** pruning to alert users of potential data loss (threshold: log at INFO level always; consider WARN if > 100MB).
- Python bridge should return `migration_performed` boolean and global marker metadata in init response.
- TypeScript layer should log a **single standardized initialization line** (e.g., `"Initialized workspace [dataset_id] (migration: [status])"`) followed by **supplemental detail lines** with metadata (marker location, ontology status, sizes). This preserves debuggability while meeting the standardized-line requirement.

**Data Safety Considerations** (answer to Critic Question 2):

- **Tagged Dataset Preservation**: Prune operation must only remove untagged data. Detect tagged datasets via Cognee's dataset enumeration API (e.g., `cognee.datasets.list()` or equivalent) before pruning.
- **Irreversibility**: Global prune is one-time; if marker is manually deleted, log warning but **do NOT re-prune** to prevent accidental data loss.
- **Validation**: Confirm pre-existing tagged datasets (e.g., tutorial data with `tutorial_` prefix) remain accessible and intact after migration.

---

## 4. Plan

### Milestone 1: Implement Fixes

**Objective**: Apply the code changes recommended in the analysis report to the Python bridge scripts.

**Steps**:

1. **Harden Path Normalization in All Bridge Scripts**:
   - **Extract shared canonicalization logic**: Create a common function or ensure identical path processing in all three scripts.
   - **Apply `Path.resolve()`**: Convert workspace path to absolute, resolve all symlinks to canonical real path.
   - **Verify determinism**: Confirm dataset hash generation produces identical IDs across all scripts for the same logical workspace.
   - **Add defensive checks**: Handle broken symlinks, permission errors during resolution; fail gracefully with clear error message.

2. **Verify Dataset Scoping in `extension/bridge/ingest.py`**:
   - Confirm `dataset_name` parameter is passed to `cognee.add()` and `cognee.cognify()`.
   - Validate that canonicalized workspace path is used for dataset hash generation.
   - Ensure entity extraction (cognify) is scoped exclusively to the workspace dataset.

3. **Verify Dataset Filtering in `extension/bridge/retrieve.py`**:
   - Confirm `datasets=[dataset_name]` parameter is passed to `cognee.search()`.
   - Validate that canonicalized workspace path is used for dataset hash generation (identical to init/ingest).
   - Ensure search results are filtered to include only data from the workspace's dataset.

4. **Refactor Pruning Logic in `extension/bridge/init.py`**:
   - **Determine global data directory**: Use `cognee.config.get_data_dir()` with fallback to `COGNEE_DATA_DIR` environment variable.
   - **Enumerate tagged datasets**: Before pruning, detect existing tagged datasets via Cognee API (e.g., list all datasets with tags/metadata) to preserve them.
   - **Measure data directory size**: Calculate total size before pruning; log to Output Channel if non-trivial (e.g., > 1MB).
   - **Atomic global marker creation**: Use `os.open()` with `O_CREAT | O_EXCL` to create `.migration_v1_complete` in global data directory.
   - **Write structured metadata**: Populate global marker with JSON containing timestamp, workspace ID, pre/post-prune sizes, version.
   - **Perform prune**: If marker creation succeeds, execute `cognee.prune.prune_system()` to remove untagged data only.
   - **Create local acknowledgement marker**: All processes (winner and losers) create/update local `.dataset_migration_complete` in workspace's `.cognee` directory for traceability.
   - **Return migration status**: Include `migration_performed` boolean and marker metadata in JSON response to TypeScript.

5. **Enhance Logging in `extension/src/cogneeClient.ts`**:
   - **Standardized initialization line**: Log a single, parseable line containing dataset ID and migration status (e.g., `"[INFO] Initialized workspace [dataset_ws_abc123] (migration: performed)"`).
   - **Supplemental detail lines**: Follow standardized line with additional structured logs for marker location, ontology metadata, data sizes, diagnostics.
   - **Error escalation**: Surface permission errors, missing API keys, broken paths as user-facing warnings with actionable troubleshooting links.
   - **Migration metadata display**: Parse Python bridge response and log global marker location, pre/post-prune sizes if migration was performed.

### Milestone 2: Validate Fixes

**Objective**: Verify that the fixes have resolved both bugs and have not introduced any regressions, with enhanced validation for concurrency and edge cases.

**Steps**:

1. **Execute Integration Tests**:
   - Run the full integration test suite: `./test-integration.sh`
   - **Primary Acceptance Criterion**: All tests must pass, especially "Test 4: Workspace Isolation".

2. **Enhanced Validation Checks**:
   - **Dataset Stability**: Re-initialize the same workspace multiple times and verify the dataset name remains identical.
   - **Cross-Workspace Isolation**: Verify that retrieval in workspace A never returns data ingested in workspace B (deterministic query test).
   - **Single Global Prune**: Inspect global marker file metadata to confirm only one prune occurred system-wide.
   - **Path Normalization**: Test with symlinked workspace paths to ensure dataset name generation is consistent.
   - **Re-initialization Safety**: Verify that re-opening a workspace does not trigger additional pruning.

3. **Concurrency Validation** (Critical - answer to Critic Question 10):
   - Extend `extension/test-integration.sh` with a new test section for concurrent initialization.
   - Create 2-3 temporary isolated workspace directories to avoid shared state conflicts.
   - Launch parallel subprocess calls to `init.py` with staggered starts (0-100ms random delay) to test both simultaneous and near-simultaneous scenarios.
   - **Observable validation artifacts** (answer to Critic Question 5):
     - Exactly one Python process returns `migration_performed: true` in JSON response.
     - Global marker file exists with single creation timestamp.
     - Global marker metadata shows one workspace ID as winner.
     - All processes' local markers show participation but only one performed prune.
     - Log analysis confirms exactly one "performing global prune" message.
   - Confirm no data loss or corruption by verifying pre-existing tagged datasets remain accessible after concurrent initialization.
   - Note: Keep tests consolidated in `test-integration.sh` to maintain single test entry point for CI.

4. **Logging and Observability Verification**:
   - Verify that `CogneeClient` logs include: dataset name, migration status, ontology load status, and marker file path.
   - Check VS Code Output Channel "Cognee Memory" contains clear diagnostic information about initialization.
   - Confirm error conditions (permission failures, missing directories) produce actionable error messages.

5. **Manual Cross-Workspace Verification**:
   - Open two unrelated project folders in separate VS Code windows.
   - Ingest distinct topic-specific conversations in each workspace (e.g., "React hooks" vs "Docker containers").
   - Query each workspace for the other workspace's topic and verify zero results returned.
   - Inspect Output Channel logs to confirm different dataset names assigned to each workspace.

---

## 5. Validation and Success Criteria

This plan will be considered complete when:

**Functional Requirements**:
- ✅ All code changes from the "Solution Approach" section are implemented.
- ✅ The `test-integration.sh` script runs to completion with all tests passing.
- ✅ The "Workspace A leaked data from workspace B" error is confirmed to be resolved.
- ✅ Re-initializing the same workspace always produces an identical dataset name (deterministic).
- ✅ Cross-workspace queries return zero results from other workspaces (verified with test data).

**Concurrency and Safety Requirements**:
- ✅ The pruning logic in `init.py` is confirmed to be atomic and safe from race conditions.
- ✅ Concurrency test demonstrates exactly one global prune occurs when multiple workspaces initialize simultaneously (validated via `migration_performed` flag, marker timestamp, and log analysis).
- ✅ Global marker file contains structured JSON metadata: timestamp, workspace ID, pre/post-prune sizes, migration version.
- ✅ Local acknowledgement markers exist in all concurrent workspaces' `.cognee` directories for traceability.
- ✅ Symlinked workspace paths are normalized correctly via `Path.resolve()` and produce consistent dataset names.

**Observability Requirements**:
- ✅ VS Code Output Channel "Cognee Memory" logs include: dataset name, migration status, global marker location, and data sizes.
- ✅ TypeScript layer logs a **single standardized initialization line** with dataset ID and migration status, followed by **supplemental detail lines** with metadata (preserves debuggability while meeting standardization requirement).
- ✅ Error conditions (permission failures, missing API key, broken symlinks, invalid paths) produce clear, actionable error messages with troubleshooting links.
- ✅ TypeScript `CogneeClient` surfaces ontology metadata and migration status from Python bridge responses.
- ✅ Python bridge returns structured JSON with `migration_performed`, `global_marker_location`, `data_dir_size_before`, `data_dir_size_after` fields.

**Error Mode Requirements**:
- ✅ When data directory is not writable, initialization fails gracefully with actionable error in Output Channel.
- ✅ Extension does not register features that depend on successful initialization when init fails.
- ✅ Error messages direct users to troubleshooting documentation.

**Data Safety Requirements**:
- ✅ Data directory size is logged before pruning operation executes (log at WARN level if > 100MB to alert users).
- ✅ Tagged datasets are identified via Cognee's dataset enumeration API before pruning and explicitly preserved.
- ✅ Only untagged legacy data (from pre-dataset-isolation extension versions) is removed during migration.
- ✅ Validation confirms that pre-existing tagged datasets (e.g., tutorial data) remain intact and accessible post-migration.
- ✅ If global marker is manually deleted, re-initialization logs warning but does NOT re-prune to prevent accidental data loss.

**Documentation Requirements**:
- ✅ Release notes (for Plan 004) are updated to describe one-time migration behavior and potential data loss.
- ✅ CHANGELOG.md includes clear warning about global prune affecting untagged data on first initialization.
- ✅ Troubleshooting guide includes recovery steps if users experience unexpected data loss.

**Testing Requirements**:
- ✅ Concurrency test added to `extension/test-integration.sh` validating atomic marker behavior.
- ✅ Symlink test verifies consistent dataset ID generation for real and symlinked paths.
- ✅ Re-initialization test confirms marker prevents repeated pruning.

**Blocking Requirements**:
- ✅ Milestone 3 of Plan 004 ("Package Extension as VSIX") is unblocked.

---

## 6. Risks and Mitigations

### High-Severity Risks

**Risk: Data Loss from Global Prune**
- **Likelihood**: Medium (affects users with existing tutorial data or prior extension usage)
- **Impact**: High (permanent deletion of untagged knowledge graph data)
- **Mitigation**: 
  - Implementer should log data directory size before pruning to alert users.
  - Consider documenting the one-time migration in release notes.
  - Evaluate whether tutorial datasets should be explicitly preserved.
  - Future enhancement: Provide a backup/restore mechanism or dry-run mode.

**Risk: Race Condition in Atomic Marker Creation**
- **Likelihood**: Low (requires simultaneous workspace initialization)
- **Impact**: Critical (potential data corruption or loss if both processes prune)
- **Mitigation**: 
  - Use OS-level atomic file creation (O_CREAT | O_EXCL) as specified in analysis.
  - Implement mandatory concurrency validation test in Milestone 2.
  - Log marker creation attempts and failures for debugging.

**Risk: Path Normalization Inconsistencies**
- **Likelihood**: Medium (symlinks, network mounts, case-sensitive filesystems)
- **Impact**: Medium (multiple dataset IDs for same logical workspace)
- **Mitigation**: 
  - Require consistent path canonicalization (resolve symlinks, normalize case).
  - Test with symlinked workspace paths in validation phase.
  - Document expected behavior for edge cases.

### Medium-Severity Risks

**Risk: Cognee Data Directory Unavailable or Unwritable**
- **Likelihood**: Low (unusual permissions or corrupted installation)
- **Impact**: High (extension fails to initialize)
- **Mitigation**: Graceful error handling with clear user-facing error message directing to troubleshooting docs.

**Risk: Cross-Platform Filesystem Differences**
- **Likelihood**: Medium (Windows vs Unix file locking semantics)
- **Impact**: Medium (atomic marker may not work identically on all platforms)
- **Mitigation**: Test on multiple platforms if Windows support is in scope; document platform-specific behavior.

**Risk: Incomplete Implementation of Dataset Scoping**
- **Likelihood**: Low (implementer has clear guidance)
- **Impact**: High (workspace isolation remains broken)
- **Mitigation**: Enhanced validation tests in Milestone 2 will catch missing scoping parameters.

---

## 7. Resolved Questions and Decisions

All clarification questions raised during planning have been resolved. Implementer should follow these binding decisions:

**1. Marker Strategy** (Critic Question 1):
- **DECISION**: Hybrid approach—global atomic marker (`.migration_v1_complete`) coordinates system-wide prune; local acknowledgement markers (`.dataset_migration_complete`) retained in each workspace's `.cognee` for traceability and test compatibility.

**2. Tagged Dataset Preservation** (Critic Question 2):
- **DECISION**: Use Cognee's dataset enumeration API (e.g., `cognee.datasets.list()` or equivalent) to identify tagged datasets before pruning. Preserve all tagged datasets; remove only untagged legacy data.

**3. Logging Contract** (Critic Question 3):
- **DECISION**: TypeScript must log a single standardized initialization line (e.g., `"[INFO] Initialized workspace [dataset_id] (migration: [status])"`). Supplemental detail lines are permitted and encouraged for diagnostics (marker location, sizes, ontology status).

**4. Path Canonicalization** (Critic Question 4):
- **DECISION**: Apply `Path.resolve()` in Python to resolve symlinks and convert to absolute canonical paths before hashing. This ensures symlinked and real paths produce identical dataset IDs.

**5. Case Handling** (Critic Question 5):
- **DECISION**: Preserve exact case as returned by filesystem (case-sensitive on POSIX). No case normalization or lowercasing applied on Linux/macOS. Windows support deferred.

**6. Concurrency Validation Observables** (Critic Question 5 extended):
- **DECISION**: Assert exactly one prune via: (a) one `migration_performed: true` response, (b) global marker timestamp uniqueness, (c) log analysis showing single prune execution, (d) marker metadata showing one workspace ID as winner.

**7. Global Data Directory Determination** (Critic Question 6):
- **DECISION**: Prioritize `cognee.config.get_data_dir()` API; fallback to `COGNEE_DATA_DIR` environment variable if API unavailable; fail gracefully with actionable error if neither resolves.

**8. Global Marker Metadata** (Critic Question 7, 8):
- **DECISION**: Global marker must contain structured JSON: `migrated_at` (ISO timestamp), `workspace_id` (dataset name or path), `data_dir_size_before` (bytes), `data_dir_size_after` (bytes), `version` (e.g., "v1").

**9. Pre-Prune Warning Threshold** (Critic Question 8 extended):
- **DECISION**: Always log data directory size before pruning. Use WARN level if size > 100MB to alert users of significant data impact.

**10. Unwritable Directory Test** (Critic Question 9):
- **DECISION**: Add basic negative test using temporary directory with restricted permissions (chmod). Test must confirm graceful failure with clear error message. CI compatibility not critical; can be marked optional or manual if environment constraints exist.

**11. Concurrency Test Staggering** (Critic Question 10):
- **DECISION**: Use staggered starts (0-100ms random delay) to test both simultaneous and near-simultaneous initialization scenarios. Reduces flakiness while validating race-free behavior.

**12. Platform Support**:
- **DECISION**: Target POSIX systems (Linux, macOS) only for v0.1.0. Add platform detection; if Windows detected, fail with clear "unsupported platform" error directing to documentation. Windows atomic file semantics deferred to future enhancement.

**13. Data Recovery and Rollback**:
- **DECISION**: No backup or rollback mechanism in v0.1.0. Document migration as one-way and irreversible in release notes and CHANGELOG. Warn users that untagged data will be permanently deleted. Future enhancement could add dry-run mode or backup.

**14. Marker Lifecycle and Re-Prune Prevention**:
- **DECISION**: If global marker is manually deleted, log warning but do NOT re-prune to prevent accidental data loss. Use versioned markers (`.migration_v1_complete`, `.migration_v2_complete`) to support future incremental migrations without affecting prior state.

**15. Network-Mounted Workspace Paths**:
- **DECISION**: No special handling required for network mounts. Canonical path resolution via `Path.resolve()` should handle network paths correctly on POSIX systems. If resolution fails (permissions, unavailable mount), fail gracefully with clear error.

---

## 8. Implementation Guidance

**For the Implementer**:

The analyst's report (`analysis/005-fix-data-isolation-and-pruning-bugs-analysis.md`) contains reference implementation patterns for the atomic marker creation logic. These are provided as guidance on **HOW** to achieve the objectives, but the implementer has full autonomy to:

- Choose appropriate Python idioms and error handling patterns
- Determine optimal logging verbosity and format
- Structure the code for maintainability and testability
- Add defensive checks and validation beyond the minimum requirements

**Critical Constraints**:
- Dataset name generation **must** be identical across all three bridge scripts (use a shared function or identical logic)
- Path normalization **must** be consistent (decide on and document the approach)
- Atomic marker creation **must** use OS-level exclusivity guarantees
- All changes **must** maintain backward compatibility with existing integration tests

**Reference Materials**:
- Analysis Report: `analysis/005-fix-data-isolation-and-pruning-bugs-analysis.md` (contains recommended patterns)
- Original Architecture: `planning/003-fix-workspace-isolation-and-ontology.md` (background on dataset-based isolation)
- Test Suite: `extension/test-integration.sh` (validation framework)

---

## 9. Next Steps

1. The `implementer` will review this plan and the analysis report.
2. The `implementer` will resolve or document answers to open questions (Section 7) as implementation proceeds.
3. The `implementer` will execute Milestone 1 (implement fixes) following the Solution Approach guidance.
4. The `implementer` will execute Milestone 2 (validate fixes) ensuring all success criteria are met.
5. Upon successful validation, the `implementer` will resume work on Plan 004, starting with the now-unblocked Milestone 3.
