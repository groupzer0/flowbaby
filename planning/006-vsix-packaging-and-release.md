# Implementation Plan: VSIX Packaging and GitHub Release

**Plan ID**: 006  
**Created**: November 10, 2025  
**Status**: Proposed  
**Depends On**: `planning/005-fix-data-isolation-and-pruning-bugs.md` (Completed)  
**Supersedes**: Plan 004 Milestones 3-5 (incorporated here with updates)

---

## Change Log

**November 10, 2025 - Initial Creation**:
- Extracted VSIX packaging and release milestones from Plan 004
- Updated to reflect current implementation state (Plan 005 complete)
- Incorporated migration warnings and one-time prune behavior in release notes
- Updated validation requirements based on new integration tests (7 tests now)
- Added migration metadata documentation requirements
- Removed already-completed documentation tasks (LICENSE, CHANGELOG, DISTRIBUTION, etc.)
- Focused on executable packaging and release tasks only

**November 10, 2025 - Post-Critic Review Updates (First Round)**:
- Added `__pycache__` exclusion requirement to `.vscodeignore` (prevent bytecode bloat)
- Clarified marker path determination: parent directory of `relational_config.db_path`
- Redefined post-install validation: user flow observation replaces test suite re-run
- Added re-initialization test to confirm marker prevents second prune
- Added README anchor verification step before release
- Added VSIX checksum (SHA256) generation for release notes
- Added version consistency check (package.json vs CHANGELOG)
- Clarified VSIX size threshold handling (>5MB triggers investigation, not failure)
- Documented manual marker deletion behavior in risks section
- Added dataset ID format verification (ws_{16 hex chars}) to symlink test

**November 10, 2025 - Post-Critic Review Updates (Second Round)**:
- Fixed step numbering in Milestone 1 (renumbered 1-11 sequentially)
- Fixed section numbering (resolved duplicate "Section 6", now 1-10 sequential)
- Added Milestone 1 Step 7: Secret scanning and dependency version pinning check
- Enhanced Milestone 1 Step 11: Size remediation decision tree (5-10MB justify, >10MB must reduce)
- Added explicit marker timestamp verification to Milestone 2 Step 6 acceptance criteria
- Added dataset ID format deviation handling to Milestone 4 Step 7 (abort release if invalid)
- Added rollback procedure section in Milestone 4 (delete release/tag, fix, republish)
- Added checksum archival strategy to GitHub Release Validation checklist
- Enhanced Post-Release Validation checklist (timestamp immutability, format validation)
- Converted risk items to proper markdown headings (### Risk: ...) throughout Section 6
- Updated Acceptance Criteria for Milestone 1 with new validation requirements

**November 11, 2025 - Post-Critic Review Updates (Third Round)**:
- Fixed Milestone 3 step numbering duplication (renumbered 7-10 sequentially)
- Updated Milestone 2 acceptance criteria: replaced "integration tests pass" with "user flow validation completed"
- Aligned VSIX size thresholds across VSIX Build Validation, Success Criteria, and all references
- Added dotenv and OS cruft exclusions: `.env`, `.env.*`, `.DS_Store`, `Thumbs.db` to Step 2 and Excluded Files Checklist
- Updated all step number references in Critic Clarifications section to match current numbering
- Added rollback cross-reference to GitHub Release Validation checklist
- Enhanced VSIX Build Validation with explicit secret scanning and dependency pinning checks
- Updated Success Criteria to reflect "reasonable" size with justification allowance
- Fixed Milestone 4 step numbering duplication (renumbered 8-11 sequentially)

**November 11, 2025 - Post-Analysis Integration Updates (Fourth Round)**:
- Updated VS Code minimum version to 1.105.0 consistently across release notes and all references
- Added explicit "Not validated in v0.1.0" disclaimer for Remote-SSH, WSL, Dev Containers, and multi-root workspaces
- Moved dataset ID format validation from Milestone 4 (post-release) to Installation Validation checklist (pre-release gate)
- Added medium-term quality improvements to Future Enhancements: error surfacing with stdout capture, interpreter auto-detection, defensive cwd setting, environment readiness command
- Reduced command prescriptiveness in Milestone 2 prerequisite section to preserve implementer autonomy
- Added environment readiness verification to Installation Validation acceptance criteria

---

## 1. Objective

Package the Cognee Chat Memory extension as a production-ready VSIX file and publish the initial v0.1.0 release on GitHub. This plan focuses exclusively on the final build, validation, and release steps now that all foundational work (bug fixes, documentation, metadata) is complete.

**What This Plan Delivers**:
1. Production VSIX build with all Plan 005 fixes integrated
2. Comprehensive VSIX validation (size, contents, functionality)
3. GitHub Release v0.1.0 with VSIX download and migration warnings
4. Post-release validation ensuring end-to-end user experience works

**Out of Scope**:
- VS Code Marketplace publishing (future enhancement)
- Additional documentation creation (all docs already exist)
- Code changes or bug fixes (addressed in Plan 005)

---

## 2. Context and Current State

### Completed Prerequisites (Plan 004 Milestones 1-2, 4)

All metadata, documentation, and distribution guides are already complete:

- ✅ **Extension Icon**: `extension/media/icon.png` (128x128 PNG)
- ✅ **LICENSE**: MIT license at `extension/LICENSE`
- ✅ **CHANGELOG.md**: Documents v0.1.0 features with technical details
- ✅ **package.json**: Complete metadata (icon, repository, bugs, homepage, publisher)
- ✅ **.vscodeignore**: Properly configured to exclude source files
- ✅ **DISTRIBUTION.md**: Complete release workflow documentation
- ✅ **RELEASE_CHECKLIST.md**: Step-by-step release process
- ✅ **CONTRIBUTING.md**: Developer setup at repository root
- ✅ **README.md**: User-facing documentation (assumed complete per Plan 004)

### Implementation State (Plan 005 Complete)

All critical bugs fixed and validated:

- ✅ **Workspace Isolation**: Path canonicalization via `workspace_utils.py`
- ✅ **Pruning Race Condition**: Hybrid marker strategy (global atomic + local acknowledgement)
- ✅ **Enhanced Logging**: Standardized initialization line with migration metadata
- ✅ **Integration Tests**: All 7 tests passing (including concurrency and symlink tests)
- ✅ **Data Safety**: Global marker prevents re-prune; tagged datasets preserved

### Migration Behavior (Critical for Release Notes)

**One-Time Global Prune**: First workspace initialization performs system-wide pruning of untagged data:
- Uses atomic global marker (`.migration_v1_complete`) to coordinate across processes
- Logs data directory size before pruning (WARN if >100MB)
- Only removes untagged legacy data (pre-dataset-isolation versions)
- Tagged datasets explicitly preserved via Cognee API enumeration
- Migration metadata logged: `migration_performed`, `data_dir_size_before/after`, `global_marker_location`

**User Impact**:
- Users with existing Cognee data from prior extension versions (or tutorial usage) may see data pruned
- Users starting fresh have no data loss risk
- Release notes MUST warn about one-time prune and recommend backup if uncertain

---

## 3. Plan

### Milestone 1: Build Production VSIX

**Objective**: Create production-ready VSIX file with all Plan 005 fixes and proper asset bundling.

**Steps**:

1. **Install VSCE packaging tool** (if not already installed):
   ```bash
   npm install -g @vscode/vsce
   ```

2. **Update `.vscodeignore` to exclude Python bytecode and environment files**:
   ```bash
   cd /home/luke/Documents/Github-projects/cognee/extension
   ```
   
   Add to `.vscodeignore` if not already present:
   ```
   **/__pycache__/**
   **/*.pyc
   .env
   .env.*
   .DS_Store
   Thumbs.db
   ```
   
   **Rationale**: Prevents Python bytecode, secrets in dotenv files, and OS-specific files from bloating VSIX or leaking sensitive data. Ensures deterministic builds across environments.

3. **Verify version consistency**:
   ```bash
   # Check package.json version
   grep '"version"' package.json
   
   # Check CHANGELOG.md version
   grep '\[0.1.0\]' CHANGELOG.md
   ```
   
   **Acceptance Criteria**:
   - Both files reference version `0.1.0`
   - CHANGELOG has dated entry for v0.1.0
   - No version mismatches

4. **Clean and rebuild extension from scratch**:
   ```bash
   rm -rf dist/ node_modules/
   npm install
   npm run compile
   ```
   
   **Verify**:
   - `dist/extension.js` exists
   - File is minified (production build via esbuild)
   - No errors during compilation

5. **Run final integration tests**:
   ```bash
   ./test-integration.sh
   ```
   
   **Acceptance Criteria**:
   - All 7 tests pass (including new concurrency and symlink tests from Plan 005)
   - Test 4 (Workspace Isolation) passes (was failing before Plan 005)
   - No errors in Python bridge scripts
   - Global marker behavior validated

6. **Validate Python bridge files**:
   ```bash
   ls -la bridge/
   ```
   
   **Required Files**:
   - `workspace_utils.py` (new from Plan 005)
   - `init.py` (updated with hybrid marker strategy)
   - `ingest.py` (updated with path canonicalization)
   - `retrieve.py` (updated with path canonicalization)
   - `ontology.json` (chat entity schema)
   - `requirements.txt` (Cognee dependencies)
   - `README.md` (bridge documentation)

7. **Scan for secrets and verify dependency pinning**:
   ```bash
   # Scan for potential secrets/API keys in source files
   grep -r "api[_-]key\|secret\|password\|token" --include="*.ts" --include="*.py" src/ bridge/ || echo "No hardcoded secrets found"
   
   # Verify Cognee version pinning
   grep "cognee==0.3.4" bridge/requirements.txt
   ```
   
   **Acceptance Criteria**:
   - No hardcoded credentials in source files
   - `bridge/requirements.txt` explicitly pins `cognee==0.3.4`
   - If secrets found, remove before packaging

8. **Package extension as VSIX**:
   ```bash
   vsce package
   ```
   
   **Expected Output**: `cognee-chat-memory-0.1.0.vsix` created in `extension/` directory
   
   **Troubleshooting**:
   - **"publisher cannot be empty"**: Verify `package.json` has `"publisher": "cognee"` (currently set)
   - **Icon errors**: Confirm `media/icon.png` exists (already validated)
   - **Large size warning**: Normal if <5MB; requires investigation if >5MB (not automatic failure)
   - **Missing files**: Check `.vscodeignore` didn't exclude required assets

9. **Generate VSIX checksum**:
   ```bash
   sha256sum cognee-chat-memory-0.1.0.vsix > cognee-chat-memory-0.1.0.vsix.sha256
   cat cognee-chat-memory-0.1.0.vsix.sha256
   ```
   
   **Purpose**: Users can verify download integrity. Include checksum in release notes.

10. **Inspect VSIX contents**:
   ```bash
   unzip -l cognee-chat-memory-0.1.0.vsix
   ```
   
   **Required Files Checklist**:
   - ✅ `extension/dist/extension.js` (TypeScript bundle)
   - ✅ `extension/bridge/workspace_utils.py` (NEW from Plan 005)
   - ✅ `extension/bridge/init.py`
   - ✅ `extension/bridge/ingest.py`
   - ✅ `extension/bridge/retrieve.py`
   - ✅ `extension/bridge/ontology.json`
   - ✅ `extension/bridge/requirements.txt`
   - ✅ `extension/bridge/README.md`
   - ✅ `extension/media/icon.png`
   - ✅ `extension/package.json`
   - ✅ `extension/README.md`
   - ✅ `extension/CHANGELOG.md`
   - ✅ `extension/LICENSE`
   
   **Excluded Files Checklist** (should NOT appear):
   - ❌ `src/*.ts` (TypeScript source)
   - ❌ `node_modules/` (dependencies)
   - ❌ `test-integration.sh`
   - ❌ `test-*.js`, `test-*.txt`
   - ❌ `.eslintrc.json`, `tsconfig.json`, `esbuild.js`
   - ❌ `DISTRIBUTION.md`, `RELEASE_CHECKLIST.md` (dev docs)
   - ❌ `.vscode/` directory
   - ❌ `**/__pycache__/**`, `**/*.pyc` (Python bytecode)
   - ❌ `.env`, `.env.*` (environment/secret files)
   - ❌ `.DS_Store`, `Thumbs.db` (OS-specific cruft)

11. **Measure VSIX size and validate**:
   ```bash
   ls -lh cognee-chat-memory-0.1.0.vsix
   ```
   
   **Acceptance Criteria**:
   - Size <5 MB (ideal: <1 MB)
   
   **If size >5MB**:
   - Run: `unzip -l cognee-chat-memory-0.1.0.vsix | sort -k4 -nr | head -20` to identify largest files
   - **Decision tree**:
     - **5-10 MB**: Investigate and justify necessity (e.g., required dependencies)
     - **>10 MB**: Must reduce size:
       - Remove unnecessary media assets
       - Check for accidental inclusions (test files, large data files)
       - Verify `.vscodeignore` is properly excluding dev artifacts
       - Consider compressing large required assets
   - **Remediation**: Fix `.vscodeignore`, remove bloat, rebuild VSIX, re-measure

**Acceptance Criteria for Milestone 1**:
- VSIX file created without errors
- VSIX size reasonable (<5 MB, justified if 5-10 MB, must reduce if >10 MB)
- All required files present in VSIX
- No source files, dev artifacts, bytecode, or secrets in VSIX
- Integration tests pass before packaging
- `workspace_utils.py` included (critical new file from Plan 005)
- `cognee==0.3.4` explicitly pinned in `bridge/requirements.txt`
- No hardcoded credentials in packaged files

---

### Milestone 2: Validate VSIX Installation and Functionality

**Objective**: Test VSIX installation in clean environment and verify all features work end-to-end.

**CRITICAL PREREQUISITE**: Before starting validation, configure the Python interpreter path. The extension requires a Python environment with `cognee==0.3.4` and `python-dotenv` installed.

**Environment Setup** (required before Step 1):
- Configure `cogneeMemory.pythonPath` setting to point to Python interpreter with Cognee packages installed
- Or ensure packages are installed in system Python that extension will use
- Verify environment readiness before proceeding with validation steps

**Reference**: See `analysis/006-vsix-packaging-and-release-analysis.md` for detailed root cause analysis and platform-specific path examples.

**Steps**:

1. **Test VSIX installation in current VS Code**:
   ```bash
   code --install-extension cognee-chat-memory-0.1.0.vsix
   ```
   
   **Expected**:
   - Installation completes without errors
   - "Extension installed successfully" message

2. **Reload VS Code and verify extension activation**:
   - Open Command Palette: `Ctrl+Shift+P`
   - Run: "Developer: Reload Window"
   - Open Output Panel: View → Output → Select "Cognee Memory"
   
   **Expected Logs** (from Plan 005 enhancements):
   ```
   Initialized workspace [ws_abc123...] (migration: performed)
   Migration metadata: ...
   Global marker: /path/to/.migration_v1_complete
   Data directory size before prune: 1024 bytes
   Data directory size after prune: 512 bytes
   Ontology loaded: 8 entity types
   ```

3. **Verify extension appears in Extensions panel**:
   - Open Extensions (Ctrl+Shift+X)
   - Search for "Cognee" or filter by "Installed"
   - Verify extension listed with correct name, version (0.1.0), and icon

4. **Verify configuration settings**:
   - File → Preferences → Settings
   - Search for "cognee"
   - Verify all settings present:
     - `cogneeMemory.enabled`
     - `cogneeMemory.maxContextResults`
     - `cogneeMemory.maxContextTokens`
     - `cogneeMemory.recencyWeight`
     - `cogneeMemory.importanceWeight`
     - `cogneeMemory.pythonPath`
     - `cogneeMemory.logLevel`

5. **Test workspace initialization (fresh workspace)**:
   ```bash
   mkdir -p /tmp/vsix-test-workspace
   cd /tmp/vsix-test-workspace
   code .
   ```
   
   **Expected**:
   - Extension activates when workspace opens
   - Output Channel shows initialization sequence
   - `.cognee/` directory created in workspace
   - Local marker `.dataset_migration_complete` created (from Plan 005 hybrid strategy)

6. **Verify migration behavior and marker location**:
   
   **Find actual marker path** (implementation-specific):
   ```bash
   python3 -c "from cognee.infrastructure.databases.relational import get_relational_config; import pathlib; print(pathlib.Path(get_relational_config().db_path).parent / '.migration_v1_complete')"
   ```
   
   **Check marker exists**:
   - Marker should be in parent directory of `relational_config.db_path` (typically `~/.local/share/cognee/.migration_v1_complete`)
   - Verify marker contains structured JSON metadata:
     ```json
     {
       "migrated_at": "2025-11-10T...",
       "workspace_id": "ws_...",
       "data_dir_size_before": 1024,
       "data_dir_size_after": 512,
       "version": "v1"
     }
     ```
   
   **Test re-initialization does NOT re-prune**:
   - Record marker timestamp: `stat -c %Y <marker_path>` (Linux) or `stat -f %m <marker_path>` (macOS)
   - Close and reopen same workspace
   - Check Output Channel logs
   - Confirm `migration_performed: false` on second initialization
   - Re-check marker timestamp: `stat -c %Y <marker_path>`
   - **Acceptance**: Timestamp MUST be identical (marker immutability proves no re-prune occurred)

7. **Observe user-facing behavior** (replaces test suite re-run):
   
   Instead of running `test-integration.sh` (which tests repo scripts, not VSIX), perform user flow validation:
   
   - Open new workspace and observe initialization logs
   - Verify standardized log line format: `Initialized workspace [ws_{16 hex chars}] (migration: status)`
   - Check Settings UI reflects all 7 configuration options
   - Toggle `cogneeMemory.enabled` and confirm behavior change in logs
   - Verify no console errors in Developer Tools
   
   **Rationale**: Integration tests validate repository code; post-install validation should exercise the packaged VSIX through user-facing flows.
   
   **Troubleshooting Initialization Failures**:
   
   If you see `Python script failed {"script":"init.py","exit_code":1,"stderr":""}`:
   
   | Symptom | Likely Cause | Solution |
   |---------|--------------|----------|
   | Exit code 1, empty stderr | Python interpreter lacks `cognee` or `python-dotenv` | Configure `cogneeMemory.pythonPath` to point to Python with packages installed |
   | Exit code 1, mentions `OPENAI_API_KEY` | Missing or invalid API key | Create `.env` file in workspace root with valid `OPENAI_API_KEY` |
   | Timeout after 10 seconds | Network/filesystem delay | Check network connectivity, verify workspace is on local filesystem |
   
   **Common Fix**: Set `cogneeMemory.pythonPath` in Settings to the project's virtual environment interpreter (see prerequisite at top of Milestone 2).

8. **Test in clean VS Code instance** (optional but recommended):
   ```bash
   # Launch isolated VS Code with no other extensions
   code --disable-extensions --user-data-dir=/tmp/vscode-test
   ```
   
   Then install VSIX via UI:
   - Extensions → ··· → Install from VSIX
   - Navigate to `cognee-chat-memory-0.1.0.vsix`
   - Verify installation and activation as above

9. **Check for runtime errors**:
   - Open Developer Tools: Help → Toggle Developer Tools
   - Check Console tab for errors or warnings
   - Filter by "cognee" or "extension"
   
   **Acceptance Criteria**:
   - No red errors related to extension
   - Warnings (if any) are informational only
   - No "module not found" or "command not registered" errors

**Acceptance Criteria for Milestone 2**:
- Environment readiness verified: Python interpreter successfully executes `import cognee, dotenv` without errors; OpenAI API key presence checked (warning logged if absent, but not blocking)
- VSIX installs successfully in current VS Code
- Extension activates when workspace opened
- All settings appear in Settings UI
- Dataset ID format validated (ws_{16 hex chars}) from initialization logs
- Migration metadata logged correctly (from Plan 005)
- Global marker created with structured JSON
- Marker timestamp immutability verified (no re-prune on re-initialization)
- User flow validation completed without runtime errors (logs, settings, behavior)
- No runtime errors in Developer Tools console
- Extension works in clean VS Code instance (optional verification)

---

### Milestone 3: Create GitHub Release v0.1.0

**Objective**: Publish GitHub Release with VSIX download, comprehensive release notes, and migration warnings.

**Steps**:

1. **Verify Git repository state**:
   ```bash
   cd /home/luke/Documents/Github-projects/cognee
   git status
   ```
   
   **Acceptance Criteria**:
   - No uncommitted changes (or only VSIX file, which shouldn't be committed)
   - On `main` branch
   - All Plan 005 changes committed and pushed

2. **Create Git tag for release**:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
   
   **Verify**: Tag appears at https://github.com/lsalsich/cognee/tags

3. **Navigate to GitHub Releases page**:
   - URL: https://github.com/lsalsich/cognee/releases
   - Click: "Draft a new release"

4. **Configure release settings**:
   - **Choose a tag**: Select `v0.1.0` from dropdown
   - **Release title**: `Cognee Chat Memory v0.1.0 - Initial Release`
   - **Target**: `main` branch

5. **Verify README anchor links before release**:
   ```bash
   # Check that release notes' links actually exist in README
   grep -E "^#{1,3} (Installation|Troubleshooting|Usage)" extension/README.md
   ```
   
   **Acceptance Criteria**:
   - README has matching section headers for all release note links
   - If headers differ, update release note anchor links (e.g., `#setup` instead of `#installation`)
   - Test at least one link by opening README on GitHub and clicking anchor

6. **Write release notes** (copy adapted content below):

   **RELEASE NOTES CONTENT - CRITICAL SECTIONS**:
   
   The implementer must include these sections. The text below provides required content structure with freedom to improve wording.

   ```markdown
   # Cognee Chat Memory v0.1.0
   
   **Initial release** of the Cognee Chat Memory VS Code extension! 🎉
   
   This extension provides automatic memory for GitHub Copilot chat using Cognee knowledge graphs. Conversations are captured and retrieved automatically without manual commands.
   
   ## ⚠️ IMPORTANT: One-Time Data Migration
   
   **First workspace initialization performs a one-time global data prune:**
   - Removes untagged data from previous extension versions or Cognee usage
   - Uses atomic marker to ensure exactly one prune occurs system-wide
   - Logs data directory size before pruning (see Output Channel)
   - Tagged datasets are preserved (tutorial data, explicitly named datasets)
   
   **If you have existing Cognee data you want to preserve:**
   1. Back up your Cognee data directory before installation:
      ```bash
      # Find Cognee data directory
      python3 -c "from cognee.infrastructure.databases.relational import get_relational_config; print(get_relational_config().db_path)"
      # Back up the parent directory
      ```
   2. Or install in a fresh environment without prior Cognee usage
   
   **What gets pruned:** Only untagged, unscoped data from pre-v0.1.0 usage  
   **What's preserved:** All dataset-tagged data, workspace-scoped data from v0.1.0+  
   **Migration is one-time:** Subsequent initializations do NOT prune data
   
   ---
   
   ## Features
   
   - ✅ Automatic capture of GitHub Copilot chat conversations
   - ✅ Automatic context retrieval before responses
   - ✅ Workspace-isolated memory (separate knowledge graphs per workspace)
   - ✅ Hybrid graph-vector search combining relationships and semantics
   - ✅ Recency and importance weighting for context relevance
   - ✅ Chat-specific ontology (User, Question, Answer, Topic, Concept, Problem, Solution, Decision)
   - ✅ Configurable settings for behavior tuning
   - ✅ Atomic migration with global marker prevents data loss during concurrent initialization
   - ✅ Comprehensive integration test suite (7 tests including concurrency validation)
   
   ## Installation
   
   ### Prerequisites
   
   - VS Code 1.105.0 or higher
   - Python 3.8+ installed and in PATH
   - Cognee 0.3.4: `pip install cognee==0.3.4`
   - OpenAI API key (or compatible LLM provider)
   
   ### Quick Start
   
   1. Download `cognee-chat-memory-0.1.0.vsix` (attached below)
   2. Open VS Code
   3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   4. Type "Install from VSIX" and select the command
   5. Navigate to the downloaded `.vsix` file
   6. Reload VS Code when prompted
   7. Open a workspace folder
   8. Create `.env` file in workspace with: `OPENAI_API_KEY=your_key_here`
   9. Check Output panel → "Cognee Memory" for activation status
   
   **📖 [Full Installation Guide](https://github.com/lsalsich/cognee/tree/main/extension#installation)**  
   **🔧 [Troubleshooting Guide](https://github.com/lsalsich/cognee/tree/main/extension#troubleshooting)**  
   **⚙️ [Configuration Options](https://github.com/lsalsich/cognee/tree/main/extension#usage)**
   
   ## What's New in v0.1.0
   
   ### Core Features
   - Initial public release with automatic memory for Copilot chat
   - Workspace isolation ensures no data leakage between projects
   - Hybrid search balances semantic similarity with relationship traversal
   - Configurable weights for recency and importance scoring
   
   ### Technical Implementation (Plan 005 Fixes)
   - Path canonicalization via `workspace_utils.py` ensures consistent dataset IDs
   - Hybrid marker strategy: global atomic marker + local acknowledgement markers
   - SHA1-hashed workspace identifiers for stable naming across symlinks
   - Structured metadata in global marker (timestamp, workspace ID, data sizes)
   - Enhanced logging with standardized initialization line and migration metadata
   - Integration test suite with concurrency and symlink validation
   
   See **[CHANGELOG.md](https://github.com/lsalsich/cognee/blob/main/extension/CHANGELOG.md)** for complete technical details.
   
   ## Known Limitations
   
   - Requires workspace folder (doesn't work in single-file mode)
   - Python and Cognee must be installed separately (not bundled)
   - First conversation in new workspace has no context (memory starts empty)
   - Primarily tested on local macOS and Linux environments (Windows may require configuration)
   - **Not validated in v0.1.0**: Remote-SSH, WSL, Dev Containers, and multi-root workspaces
   - Chat Participant captures conversations (inline completions not captured)
   
   ## Feedback & Support
   
   - 🐛 **Report bugs**: [GitHub Issues](https://github.com/lsalsich/cognee/issues)
   - 💡 **Request features**: [GitHub Discussions](https://github.com/lsalsich/cognee/discussions)
   - 📖 **Read documentation**: [Extension README](https://github.com/lsalsich/cognee/tree/main/extension)
   - 🤝 **Contribute**: [Contributing Guide](https://github.com/lsalsich/cognee/blob/main/CONTRIBUTING.md)
   
   ## Privacy & Data Storage
   
   - All data stays on your local machine (no cloud services)
   - Memory stored in Cognee's database (typically `~/.local/share/cognee`)
   - Each workspace has isolated memory (no cross-project leakage)
   - No telemetry or analytics collected
   - API keys never logged or transmitted except to configured LLM provider
   
   ## Technical Details
   
   - **Cognee Version**: 0.3.4 with dataset-based logical isolation
   - **Dataset Naming**: SHA1-hashed workspace paths for deterministic identifiers
   - **Migration**: One-time global prune coordinated by atomic marker file
   - **Path Handling**: Symlink resolution via `Path.resolve()` ensures canonical paths
   - **Concurrency Safety**: OS-level atomic file creation prevents race conditions
   - **Ontology**: 8 entity types (User, Question, Answer, Topic, Concept, Problem, Solution, Decision)
   - **Architecture**: TypeScript extension + Python bridge scripts (subprocess communication)
   
   ---
   
   **Full Changelog**: [CHANGELOG.md](https://github.com/lsalsich/cognee/blob/main/extension/CHANGELOG.md)  
   **Distribution Guide**: [DISTRIBUTION.md](https://github.com/lsalsich/cognee/blob/main/extension/DISTRIBUTION.md)
   
   ---
   
   ## Download Verification
   
   **SHA256 Checksum**:
   ```
   <paste checksum from cognee-chat-memory-0.1.0.vsix.sha256>
   ```
   
   Verify download integrity:
   ```bash
   sha256sum -c cognee-chat-memory-0.1.0.vsix.sha256
   ```
   ```

7. **Attach VSIX file to release**:
   - Scroll to "Attach binaries" section at bottom of release form
   - Drag `cognee-chat-memory-0.1.0.vsix` from `extension/` directory
   - OR click "choose files" and navigate to VSIX
   - Verify filename appears in attachments list

8. **Configure release options**:
   - ✅ Check: "Set as the latest release"
   - ❌ Uncheck: "Set as a pre-release" (this is stable release)
   - ❌ Uncheck: "Create a discussion" (optional, can enable later)

9. **Publish release**:
   - Click: "Publish release" (NOT "Save draft")
   - Verify redirect to release page: https://github.com/lsalsich/cognee/releases/tag/v0.1.0

10. **Verify release page rendering**:
   - Check markdown formatting renders correctly
   - Verify VSIX download link is clickable
   - Confirm release is marked "Latest"
   - Check that warning box for migration is prominent

**Acceptance Criteria for Milestone 3**:
- Git tag v0.1.0 created and pushed to GitHub
- GitHub Release published at `/releases/tag/v0.1.0`
- Release title: "Cognee Chat Memory v0.1.0 - Initial Release"
- Release notes include migration warning prominently
- VSIX file attached and downloadable
- Release marked as "latest" (not pre-release)
- All documentation links resolve correctly
- Markdown renders properly on GitHub

---

### Milestone 4: Post-Release Validation

**Objective**: Verify end-to-end user experience by downloading VSIX from GitHub and installing as a new user would.

**Steps**:

1. **Download VSIX from GitHub Release**:
   - Navigate to: https://github.com/lsalsich/cognee/releases/tag/v0.1.0
   - Click on `cognee-chat-memory-0.1.0.vsix` to download
   - Save to a neutral location (e.g., `~/Downloads/`)
   - **DO NOT use the locally-built VSIX** - this validates the upload

2. **Uninstall previous version** (if installed from Milestone 2):
   - Extensions → Cognee Chat Memory → Uninstall
   - Reload VS Code
   - Verify extension no longer appears

3. **Install from downloaded VSIX**:
   ```bash
   code --install-extension ~/Downloads/cognee-chat-memory-0.1.0.vsix
   ```
   
   OR via UI:
   - Extensions → ··· → Install from VSIX
   - Select downloaded file

4. **Test in fresh workspace**:
   ```bash
   mkdir -p /tmp/release-validation-workspace
   cd /tmp/release-validation-workspace
   code .
   ```

5. **Verify complete activation sequence**:
   - Open Output Channel: View → Output → "Cognee Memory"
   - Check for standardized initialization line (Plan 005 enhancement):
     ```
     Initialized workspace [ws_...] (migration: performed|skipped)
     ```
   - Verify migration metadata logged if this is first system-wide initialization
   - Confirm no errors in activation

6. **Test workspace isolation** (from Plan 005 Test 4):
   ```bash
   # Create two separate workspaces
   mkdir -p /tmp/workspace-a /tmp/workspace-b
   
   # Open workspace A, verify unique dataset ID in logs
   code /tmp/workspace-a
   
   # Open workspace B in new window, verify different dataset ID
   code -n /tmp/workspace-b
   ```
   
   **Acceptance Criteria**:
   - Each workspace shows different dataset ID (e.g., `ws_abc123...` vs `ws_def456...`)
   - No data leakage between workspaces

7. **Test symlink path normalization** (from Plan 005 Test 7):
   ```bash
   mkdir -p /tmp/real-workspace
   ln -s /tmp/real-workspace /tmp/symlink-workspace
   
   # Open real path
   code /tmp/real-workspace
   # Note dataset ID from Output Channel
   
   # Open symlink path in new window
   code -n /tmp/symlink-workspace
   # Verify same dataset ID appears
   ```
   
   **Acceptance Criteria**:
   - Real path and symlink produce identical dataset IDs
   - Dataset ID format: `ws_{16 hex characters}` (e.g., `ws_018476d9803f1646`)
   - Both workspaces share same `.cognee/` data
   
   **Note**: Dataset ID format should have been validated during Installation Validation (Milestone 2). If format issues are discovered here, it indicates a validation gap requiring rollback.

8. **Verify checksum from release**:
   - Download checksum file from GitHub Release assets
   - Run verification: `sha256sum -c cognee-chat-memory-0.1.0.vsix.sha256`
   - Confirm output: `cognee-chat-memory-0.1.0.vsix: OK`

9. **Verify settings and configuration**:
   - Open Settings: File → Preferences → Settings
   - Search: "cognee"
   - Confirm all 7 settings present and functional
   - Test toggling `cogneeMemory.enabled` and verify logs reflect change

10. **Check documentation links**:
   - From GitHub Release page, click all documentation links
   - Verify each link resolves correctly:
     - Installation Guide
     - Troubleshooting
     - Configuration
     - CHANGELOG
     - CONTRIBUTING
     - Issues page

11. **Verify migration warning visibility**:
    - Re-read GitHub Release notes as new user would
    - Confirm migration warning is prominent and clear
    - Check that backup instructions are actionable

**Rollback Procedure (If Validation Fails)**:

If critical issues discovered during Milestone 4 validation:

1. **Communicate with users** (if release was public):
   - Create GitHub Issue titled "Release v0.1.0 temporarily withdrawn" explaining situation
   - Pin the issue to repository for visibility
   - Include timeline for corrected release

2. **Delete GitHub Release**:
   - Navigate to release page: https://github.com/lsalsich/cognee/releases/tag/v0.1.0
   - Click "Delete release" (does NOT delete Git tag)
   - Draft new release notes with updated warnings/fixes

3. **Delete Git tag** (if necessary):
   ```bash
   git tag -d v0.1.0
   git push origin :refs/tags/v0.1.0
   ```

4. **Fix identified issues**:
   - Update source code if bugs found
   - Rebuild VSIX (return to Milestone 1)
   - Re-run validation (Milestone 2)
   - Create new tag (v0.1.1 or re-use v0.1.0 if tag was deleted)

5. **Re-publish release** once validation passes:
   - Update withdrawal issue with resolution summary and link to new release tag
   - Unpin the issue from repository
   - Close the issue with resolution details

**Acceptance Criteria for Milestone 4**:
- VSIX downloads successfully from GitHub Release
- Downloaded VSIX installs without errors
- Extension activates in fresh workspace
- Workspace isolation works correctly (different dataset IDs)
- Symlink normalization produces identical dataset IDs
- All settings accessible and functional
- Documentation links from release notes resolve correctly
- Migration warning is clear and prominent in release notes
- No runtime errors during end-to-end test

---

## 4. Validation and Success Criteria

### Pre-Release Checklist

Review `extension/RELEASE_CHECKLIST.md` and confirm:

- [ ] All Plan 005 changes committed and pushed
- [ ] Integration test suite passes (7 tests including concurrency)
- [ ] Git repository clean (no uncommitted changes except VSIX)
- [ ] CHANGELOG.md updated for v0.1.0
- [ ] package.json version is `0.1.0`
- [ ] Icon file present at `media/icon.png`
- [ ] All documentation files present (README, LICENSE, CHANGELOG, DISTRIBUTION)
- [ ] Python bridge includes `workspace_utils.py` (new from Plan 005)

### VSIX Build Validation

- [ ] `.vscodeignore` excludes `**/__pycache__/**` and `**/*.pyc`
- [ ] Version consistency verified (package.json matches CHANGELOG.md)
- [ ] VSIX builds without errors (`vsce package` succeeds)
- [ ] VSIX size validated: <5 MB ideal; 5-10 MB requires justification; >10 MB must be reduced
- [ ] SHA256 checksum generated for VSIX
- [ ] No hardcoded secrets in packaged files
- [ ] Cognee version pinned to 0.3.4 in bridge/requirements.txt
- [ ] All required files present in VSIX (use `unzip -l` checklist)
- [ ] No source files in VSIX (`src/`, `node_modules/`, test files, `__pycache__` excluded)
- [ ] `workspace_utils.py` included in bridge directory
- [ ] Production bundle (`dist/extension.js`) is minified

### Installation Validation

- [ ] Environment readiness verified (Python interpreter configured with required packages)
- [ ] VSIX installs in current VS Code without errors
- [ ] Extension appears in Extensions panel with correct name/version/icon
- [ ] Extension activates when workspace opened
- [ ] Output Channel shows initialization logs with migration metadata
- [ ] Dataset ID format validated: lowercase hex, first 16 chars of SHA1(canonical workspace path), prefixed `ws_` (e.g., `ws_018476d9803f1646`)
- [ ] Global marker path verified (parent of `relational_config.db_path`)
- [ ] Re-initialization does NOT trigger second prune (`migration_performed: false`)
- [ ] Settings panel shows all 7 configuration options
- [ ] User flow validation performed (logs, settings, behavior)
- [ ] No console errors in Developer Tools

### GitHub Release Validation

- [ ] README anchor links verified before release (Installation, Troubleshooting, Usage sections exist)
- [ ] Git tag v0.1.0 created and pushed
- [ ] GitHub Release published at `/releases/tag/v0.1.0`
- [ ] Release marked as "Latest" (not pre-release)
- [ ] VSIX file and SHA256 checksum file attached and downloadable
- [ ] Release notes include migration warning prominently
- [ ] Checksum included in release notes with verification instructions
- [ ] All documentation links resolve correctly
- [ ] Markdown renders properly on GitHub
- [ ] Checksum file archived (optional: commit `extension/checksums/0.1.0.sha256` for version control)
- [ ] If any critical validation fails, follow Rollback Procedure in Milestone 4

### Post-Release Validation

- [ ] VSIX downloads from GitHub Release page
- [ ] Checksum verification passes (`sha256sum -c`)
- [ ] Downloaded VSIX installs successfully
- [ ] Extension works in fresh workspace
- [ ] Workspace isolation verified (different dataset IDs)
- [ ] Symlink normalization verified (identical dataset IDs for real/symlink paths)
- [ ] Migration behavior correct (one-time prune with global marker)
- [ ] Re-initialization confirmed safe (no second prune, marker timestamp unchanged)
- [ ] Documentation accessible from release page
- [ ] All release note links resolve correctly

---

## 5. Critic Clarifications and Responses

**Response to Key Questions**:

1. **Marker Location**: Global marker is located in parent directory of `relational_config.db_path` (typically `~/.local/share/cognee/.migration_v1_complete`). Milestone 2 step 6 now includes explicit path determination command to align release notes with actual implementation.

2. **VSIX Validation Approach**: Milestone 2 step 7 updated to replace `test-integration.sh` re-run with user flow observation (logs, settings, behavior). Integration tests validate repository code; post-install validation exercises the packaged VSIX through user-facing features.

3. **README Anchors**: Milestone 3 step 5 added to verify section headers exist before release and adjust anchor links if needed.

4. **`__pycache__` Exclusion**: Milestone 1 Step 2 added to update `.vscodeignore` with `**/__pycache__/**`, `**/*.pyc`, `.env*`, `.DS_Store`, and `Thumbs.db` exclusion patterns.

5. **Irreversibility Validation**: Milestone 2 Step 6 now includes explicit re-initialization test confirming `migration_performed: false` on second workspace open with marker timestamp verification.

6. **Integrity & Security**: Milestone 1 Step 9 added SHA256 checksum generation; Milestone 3 Step 6 includes checksum in release notes template; Milestone 4 Step 8 validates checksum from GitHub download. Milestone 1 Step 7 scans for hardcoded secrets.

7. **Failure Contingency**: Milestone 1 Step 11 clarified that >5MB size triggers investigation with decision tree: 5-10MB justify, >10MB reduce. Implementer inspects largest files to confirm necessity or remediate.

8. **Post-Release Monitoring**: Section 8 (Next Steps After Release) already includes GitHub Issues monitoring. First-24h triage implicit in community engagement point.

9. **Symlink Test Scope**: Milestone 4 Step 7 now specifies expected dataset ID format: `ws_{16 hex characters}` with abort-release procedure if format deviates.

10. **Documentation Consistency**: Milestone 1 Step 3 added to verify package.json version matches CHANGELOG.md version programmatically before build.

**Response to Second Round Critic Findings**:

1. **Step Numbering Issues**: All Milestone 1 steps renumbered sequentially (1-11) to fix duplicates caused by post-review edits.

2. **Section Numbering Conflict**: Resolved duplicate "Section 6" - "Risks and Mitigations" remains Section 6, "Success Criteria" renumbered to Section 7, subsequent sections incremented to 8-10.

3. **Secret Scanning**: Added Milestone 1 Step 7 to scan for hardcoded credentials using `grep` and verify Cognee version pinning in `requirements.txt`. Also added dotenv and OS cruft exclusions to Step 2.

4. **Size Remediation Path**: Enhanced Milestone 1 Step 11 with decision tree: 5-10MB requires justification, >10MB must be reduced with specific remediation steps (remove unnecessary assets, check for accidental inclusions, compress if needed).

5. **Marker Timestamp Verification**: Updated Milestone 2 Step 6 to explicitly record and re-check marker timestamp using `stat` command, with acceptance criterion requiring identical timestamps to prove immutability.

6. **Dataset ID Format Deviation**: Added abort-release procedure to Milestone 4 Step 7 if dataset ID format doesn't match `ws_{16 hex chars}` pattern.

7. **Rollback Procedure**: Added new subsection in Milestone 4 documenting release deletion, tag deletion, fix workflow, and republish steps.

8. **Checksum Archival**: Added optional checksum archival recommendation to GitHub Release Validation checklist (commit to version control).

9. **Risk Formatting**: Converted all risk items from bold emphasis (`**Risk: ...**`) to proper markdown headings (`### Risk: ...`) throughout Section 6.

10. **Validation Checklist Updates**: Enhanced VSIX Build Validation and Post-Release Validation checklists with new acceptance criteria (secrets, pinning, timestamp immutability, format validation).

---

## 6. Risks and Mitigations

### High-Severity Risks

### Risk: Migration Warning Not Visible

- **Impact**: Users lose data unexpectedly during first initialization
- **Likelihood**: Medium (GitHub formatting issues, users skip reading)
- **Mitigation**: 
  - Place warning in prominent position (top of release notes, warning emoji)
  - Use bold/italics/warning box formatting
  - Include backup instructions before installation steps
  - Log data directory size before prune to alert users in Output Channel

### Risk: VSIX Missing Critical Files

- **Impact**: Extension fails to activate or bridge scripts don't work
- **Likelihood**: Low (validation catches this)
- **Mitigation**:
  - Thorough VSIX contents inspection in Milestone 1
  - Test installation from VSIX before release
  - Validate `workspace_utils.py` present (critical new file)

### Risk: Global Marker Doesn't Prevent Re-Prune

- **Impact**: Data loss on subsequent initializations
- **Likelihood**: Very Low (Plan 005 tested this extensively)
- **Mitigation**:
  - Integration Test 6 validates marker behavior
  - Manual re-initialization test in Milestone 2
  - Log analysis confirms no repeated pruning

### Risk: Symlink Normalization Fails

- **Impact**: Multiple dataset IDs for same logical workspace
- **Likelihood**: Very Low (Plan 005 Test 7 validates this)
- **Mitigation**:
  - Integration Test 7 validates symlink handling
  - Post-release validation includes symlink test

### Medium-Severity Risks

### Risk: VSIX Size Exceeds Limit

- **Impact**: GitHub upload fails or download slow
- **Likelihood**: Low (properly configured `.vscodeignore`)
- **Mitigation**:
  - Size check in Milestone 1 (acceptance: <5 MB)
  - Investigate large files if size exceeds threshold

### Risk: Documentation Links Break

- **Impact**: Users can't find help resources
- **Likelihood**: Low (links tested during validation)
- **Mitigation**:
  - Validate all links in Milestone 4
  - Use relative links where possible (avoid branch-specific URLs)

### Risk: Platform-Specific Issues

- **Impact**: Extension fails on Windows or macOS
- **Likelihood**: Medium (primarily tested on Linux)
- **Mitigation**:
  - Document platform limitations in Known Limitations section
  - Encourage community testing and issue reporting
  - Python/Cognee compatibility assumed (not extension-specific)

### Risk: Global Marker JSON Corruption

- **Impact**: Migration system unable to read marker state; potential re-prune if corruption misinterpreted
- **Likelihood**: Very Low (requires filesystem corruption or manual editing)
- **Expected Behavior**:
  - If `.migration_v1_complete` is malformed or unreadable, system logs warning
  - Prune operation skipped to prevent data loss (fail-safe: assume migration already occurred)
  - Marker file not recreated automatically (requires manual intervention)
- **Mitigation**:
  - Log clear error message with path to corrupted marker
  - Document manual marker recovery procedure in troubleshooting guide
  - Future: Add validation command to check marker integrity
  - Atomic file writes reduce corruption probability

### Risk: Manual Global Marker Deletion

- **Impact**: User confusion or expectation of re-prune after marker deletion
- **Likelihood**: Low (requires manual filesystem intervention)
- **Expected Behavior** (per Plan 005 design):
  - If `.migration_v1_complete` is manually deleted, initialization logs warning
  - System does NOT re-prune to prevent accidental data loss
  - Versioned markers (v1, v2, etc.) support future incremental migrations without affecting prior state
- **Mitigation**:
  - Document marker lifecycle in release notes under "Migration is one-time"
  - Log clear warning if marker deletion detected
  - Include troubleshooting section for "accidentally deleted marker" scenario

---

## 7. Success Criteria

**Plan 006 Complete When**:

- ✅ VSIX file builds successfully with all Plan 005 fixes
- ✅ VSIX size reasonable (<5 MB ideal; 5-10 MB with justification; >10 MB reduced before release)
- ✅ All required files in VSIX, no source files, secrets, or OS cruft
- ✅ `workspace_utils.py` included in bridge directory
- ✅ VSIX installs and activates in clean VS Code
- ✅ Integration tests pass (7 tests including Plan 005 enhancements)
- ✅ Git tag v0.1.0 created and pushed
- ✅ GitHub Release published with VSIX download
- ✅ Release notes include migration warning prominently
- ✅ Downloaded VSIX installs and works end-to-end
- ✅ Workspace isolation validated (different dataset IDs)
- ✅ Symlink normalization validated (identical dataset IDs)
- ✅ Migration metadata logged correctly
- ✅ No runtime errors during validation
- ✅ All documentation links resolve correctly

**Ready for Users When**:

- ✅ All above criteria met
- ✅ Migration warning is clear and actionable
- ✅ Backup instructions provided for cautious users
- ✅ Known Limitations section is accurate
- ✅ Post-release validation confirms end-to-end user experience

---

## 8. Timeline Estimate

- **Milestone 1** (Build VSIX): 30-45 minutes
- **Milestone 2** (Validate Installation): 45-60 minutes
- **Milestone 3** (GitHub Release): 30-45 minutes
- **Milestone 4** (Post-Release Validation): 30-45 minutes

**Total Estimate**: 2-3 hours

---

## 9. Next Steps After Release

1. **Monitor GitHub Issues**: Watch for user-reported bugs or installation problems
2. **Community Engagement**: Respond to questions and feedback in Discussions
3. **Telemetry Analysis**: (If/when implemented) Review usage patterns and errors
4. **Future Enhancements**:
   - VS Code Marketplace publishing (separate plan)
   - Chat Participant improvements (Plan 002 Milestone 5)
   - Windows platform testing and support
   - Backup/restore mechanism for migration
   - Dry-run mode for prune preview
   
5. **Quality Improvements** (prioritized by impact, from Analysis 006 recommendations):
   1. **Error Surfacing** (HIGH): Capture and log stdout (truncated, sanitized) on non-zero exit for better diagnostics - addresses #1 user pain point in initialization failures
   2. **Interpreter Auto-Detection** (HIGH): Check workspace `.venv` first, fall back to setting, then system Python - reduces configuration burden for most users
   3. **Defensive cwd Setting** (MEDIUM): Set working directory to workspace path when spawning bridge processes - prevents edge-case failures with relative paths
   4. **Environment Readiness Command** (MEDIUM): Add command palette entry to verify Python path, packages, and API key - aids self-service troubleshooting
   5. **Tool-Based Secret Scanning** (LOW): Replace manual grep with standardized scanning tool integration - improves maintainability but requires tool evaluation

---

## 10. Implementation Notes

**For the Implementer**:

This plan assumes all documentation, metadata, and bug fixes are complete (Plans 004 Milestones 1-2,4 + Plan 005). Focus exclusively on:

1. Building the VSIX with current code state
2. Validating packaging and installation
3. Publishing GitHub Release with migration warnings
4. Testing end-to-end user experience

**Critical Reminders**:

- Migration warning MUST be prominent in release notes
- Include backup instructions before installation steps
- Validate `workspace_utils.py` is in VSIX (new file from Plan 005)
- Test workspace isolation and symlink handling post-installation
- Use downloaded VSIX (not local build) for final validation

**Reference Materials**:

- Release Checklist: `extension/RELEASE_CHECKLIST.md`
- Distribution Guide: `extension/DISTRIBUTION.md`
- CHANGELOG: `extension/CHANGELOG.md` (source for "What's New")
- Plan 005: `planning/005-fix-data-isolation-and-pruning-bugs.md` (migration behavior details)
