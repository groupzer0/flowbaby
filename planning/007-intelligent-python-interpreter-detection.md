# Implementation Plan: Intelligent Python Interpreter Detection and Error Surfacing

**Plan ID**: 007  
**Created**: November 11, 2025  
**Status**: Proposed  
**Depends On**: `planning/006-vsix-packaging-and-release.md` (In Progress)  
**Related Analysis**: `analysis/006-vsix-packaging-and-release-analysis.md`

---

## Value Statement and Business Objective

**As a** VS Code extension user installing the Cognee Chat Memory extension in a new workspace,  
**I want** the extension to automatically detect the correct Python interpreter with required dependencies and provide clear error messages when something is wrong,  
**So that** the extension functions immediately without requiring manual configuration of Python paths or troubleshooting cryptic error messages.

**Critical Success Criterion**: A user with a workspace containing `.venv/bin/python` (with `cognee` and `python-dotenv` installed) should experience zero-configuration activation with clear, actionable error messages if prerequisites are missing.

**Prerequisite Clarification**: This plan delivers zero-configuration *detection* of the Python interpreter. Users remain responsible for creating a virtual environment with required dependencies (`cognee`, `python-dotenv`, `OPENAI_API_KEY`). The extension does not provision Python environments—it intelligently finds and uses existing ones, then provides clear diagnostics when prerequisites are missing.

---

## Change Log

**November 11, 2025 - Initial Creation**:
- Created to address the core Python interpreter detection issue identified in Analysis 006
- Moves beyond the manual configuration workaround documented in Plan 006
- Delivers permanent fixes for interpreter auto-detection and error message visibility
- Implements HIGH-priority quality improvements deferred from Plan 006 Section 9

**November 11, 2025 - Post-Critic Review Updates**:
- Added prerequisite clarification to value statement (user responsible for environment provisioning)
- Enhanced sanitization scope: added OpenAI `sk-*`, Bearer tokens, AWS keys patterns
- Added structured success-path validation acceptance criterion (prevent regression in normal JSON parsing)
- Specified performance measurement method: `Date.now()` delta averaged over 10 runs per platform
- Marked all code snippets as "ILLUSTRATIVE ONLY" to preserve implementer autonomy
- Added streaming truncation mitigation for large output buffer management
- Added explicit "unsupported contexts" section in documentation (Remote, multi-root, conda, pyenv)
- Added risk: misconfigured explicit Python path with diagnostic hint mitigation
- Added risk: future environment type extensibility with technical debt acknowledgement
- Acknowledged sanitization limitation: current patterns cover common cases, may expand based on exposure reports

**November 11, 2025 - Post-QA Review Updates**:
- Added Milestone 4: Configure Test Infrastructure (addresses QA-identified gaps)
- Renumbered original Milestone 4 (Documentation) to Milestone 5
- Added detailed test runner configuration steps based on QA root cause analysis
- Includes creation of `runTest.ts`, `index.ts`, and build configuration updates
- Addresses zero-executable-tests failure identified in `qa/007-intelligent-python-interpreter-detection-qa.md`

**November 11, 2025 - Post-Critic Review Refinements**:
- Clarified build approach: Recommend Option B (dedicated tsc for tests with tsconfig.test.json) as default
- Updated Success Criteria: Added explicit criterion for CI headless test execution
- Clarified "100% coverage" language: Changed to "all new functions have corresponding unit tests"
- Fixed naming consistency: Updated all "quality-control/qualitycontrol" references to "qa"
- Added rationale for recommended build approach to preserve implementer autonomy

---

## 1. Objective

Permanently fix the Python interpreter mismatch and error propagation gaps that currently require manual `cogneeMemory.pythonPath` configuration for every workspace. This plan delivers:

1. **Intelligent Interpreter Auto-Detection**: Extension automatically finds and uses workspace-local virtual environments
2. **Enhanced Error Surfacing**: Users see actual Python error messages (stdout + stderr) instead of generic "exit code 1" failures
3. **Defensive Working Directory**: Bridge scripts run from workspace context for reliable relative path resolution
4. **Zero-Configuration User Experience**: Extension works out-of-the-box when workspace has proper Python environment

**What This Plan Delivers**:
- Automatic `.venv` detection with graceful fallback chain
- Visible, actionable error messages for missing dependencies or API keys
- Workspace-relative script execution for predictable behavior
- Clear user documentation on Python environment expectations

**Out of Scope**:
- Python environment creation or dependency installation (user's responsibility)
- Virtual environment management tools (not an extension concern)
- Remote contexts (SSH, WSL, Dev Containers) - remains **explicitly unsupported** for v0.2.0, will be documented as such in README
- Multi-root workspace support - remains **explicitly unsupported** for v0.2.0, will be documented as such in README
- Conda and pyenv environment detection (deferred to future enhancement)

---

## 2. Context and Current State

### The Problem (Analysis 006 Root Cause)

**Current Behavior (v0.1.0)**:
1. Extension calls generic `python3` without checking for required packages
2. Python script fails with `ImportError` for missing `cognee` or `python-dotenv`
3. Error message goes to `stdout` (structured JSON error)
4. TypeScript only captures `stderr` on non-zero exit codes
5. User sees: "Python script exited with code 1: " (empty stderr)
6. **Workaround Required**: User must manually configure `cogneeMemory.pythonPath` in every workspace

**User Impact**:
- Confusing first-run experience: extension fails silently or with cryptic messages
- Manual configuration burden: must know absolute path to virtual environment interpreter
- Poor discoverability: users unaware that Python environment is misconfigured
- Support burden: users report "extension doesn't work" without actionable diagnostics

### Analysis 006 Findings

Analysis 006 identified two critical gaps:

1. **Interpreter Mismatch** (HIGH priority):
   - Extension defaults to system `python3` which lacks `cognee`/`python-dotenv`
   - Workspace `.venv` exists but is ignored
   - No automatic detection logic in current implementation

2. **Error Propagation Failure** (HIGH priority):
   - `runPythonScript()` only logs `stderr` on failures
   - Python scripts output structured errors to `stdout`
   - Extension discards `stdout`, leaving users with "exit code 1" messages
   - Debugging becomes nearly impossible without reading source code

### Dependencies

**Completed Prerequisites**:
- ✅ Plan 005: Data isolation and pruning bugs fixed
- ✅ Analysis 006: Root cause analysis complete with specific recommendations
- ⏳ Plan 006: VSIX packaging and release (Milestone 1 complete, Milestone 2 in progress)

**Technical Constraints**:
- Must maintain backward compatibility with explicit `cogneeMemory.pythonPath` setting
- User-configured path MUST override auto-detection (explicit > implicit)
- Performance: interpreter detection must be non-blocking and lightweight
- Privacy: error logs must sanitize sensitive data (API keys, tokens)

---

## 3. Scope and Deliverables

### Milestone 1: Implement Intelligent Interpreter Auto-Detection

**Objective**: Extension automatically finds workspace-local Python interpreter before falling back to system Python.

**Deliverables**:
1. New method `detectPythonInterpreter()` in `cogneeClient.ts`
2. Search priority chain:
   - Explicit `cogneeMemory.pythonPath` setting (HIGHEST priority)
   - `.venv/bin/python` (Linux/macOS)
   - `.venv/Scripts/python.exe` (Windows)
   - System `python3` fallback (LOWEST priority)
3. Workspace-relative path resolution (use `this.workspacePath` as base)
4. File existence verification before selecting candidate
5. Updated constructor logic to use detected path
6. Configuration documentation update

**Acceptance Criteria**:
- ✅ User with `.venv/bin/python` (containing `cognee`) experiences zero-config activation
- ✅ User with explicit `cogneeMemory.pythonPath` setting has that path honored (override)
- ✅ User without virtual environment falls back to `python3` with clear error if dependencies missing
- ✅ Detection logic completes in <10ms measured via `Date.now()` delta, logged at DEBUG level once during testing, averaged over 10 constructor invocations per platform
- ✅ Windows users benefit from `.venv/Scripts/python.exe` detection
- ✅ Detection runs only once during `CogneeClient` construction (not per-script-invocation)

**Risks**:
- **Platform Path Variations**: Virtual environments on Windows use `Scripts/` not `bin/`
  - **Mitigation**: Detect OS platform and check appropriate path variant
- **Permission Errors**: User may have unreadable `.venv` directory
  - **Mitigation**: Wrap existence checks in try-catch, fall back gracefully
- **Symlink Ambiguity**: `.venv` may be symlink to external environment
  - **Mitigation**: Use `fs.existsSync()` which follows symlinks automatically

---

### Milestone 2: Enhance Error Surfacing with Stdout Capture

**Objective**: Users see actual Python error messages (stdout + stderr) instead of generic "exit code 1" failures.

**Deliverables**:
1. Updated `runPythonScript()` to capture both `stdout` and `stderr`
2. On non-zero exit codes:
   - Log full `stderr` (truncated to 1KB for safety)
   - Parse `stdout` as JSON to extract structured error
   - If JSON parsing fails, log raw `stdout` (truncated to 1KB)
   - Construct user-facing error with sanitized details
3. Sensitive data sanitization utility:
   - Redact API key patterns: `OPENAI_API_KEY=<value>` → `OPENAI_API_KEY=***`
   - Redact long hex strings (32+ chars) likely to be secrets
   - Truncate outputs to prevent accidental key logging
4. Enhanced error logging with actionable context
5. User-facing error messages with troubleshooting hints

**Acceptance Criteria**:
- ✅ User with missing `cognee` package sees: "Failed to import required module: No module named 'cognee'"
- ✅ User with missing `.env` file sees: "OPENAI_API_KEY not found in environment or .env file"
- ✅ Structured errors from Python (JSON with `error` field) are extracted and displayed
- ✅ Unstructured errors (exceptions before JSON output) are logged as raw stderr/stdout
- ✅ API keys in error logs are redacted: `OPENAI_API_KEY=***` (not full value)
- ✅ Long hex strings (32+ chars) in logs are truncated to prevent secret exposure
- ✅ Error messages include troubleshooting hint: "Configure cogneeMemory.pythonPath if using virtual environment"
- ✅ Maximum logged output: 1KB per stream (prevent token/memory bloat)
- ✅ **Structured success-path validation**: Successful script execution with valid JSON output continues to parse correctly without regression (existing behavior preserved)

**Risks**:
- **Privacy Exposure**: Error logs may inadvertently contain API keys or sensitive data
  - **Mitigation**: Implement sanitization utility to redact known patterns before logging
- **False Positives**: Sanitization may redact legitimate error context
  - **Mitigation**: Only redact patterns with high confidence (API key format, long hex strings)
- **JSON Parsing Complexity**: Python script may crash before outputting valid JSON
  - **Mitigation**: Try JSON parse first, fall back to raw stdout if parsing fails

---

### Milestone 3: Add Defensive Working Directory Setting

**Objective**: Bridge scripts run from workspace context for reliable relative path resolution.

**Deliverables**:
1. Updated `spawn()` call in `runPythonScript()` to include `cwd: this.workspacePath`
2. Verification that `ontology.json` loads correctly from workspace-relative path
3. Documentation update: note that scripts run from workspace root context
4. Test case: verify relative path resolution works after `cwd` change

**Acceptance Criteria**:
- ✅ Python scripts spawned with `cwd` set to `this.workspacePath`
- ✅ Existing relative path references (`ontology.json` in bridge scripts) continue to work
- ✅ Future scripts can reliably use workspace-relative paths
- ✅ No breaking changes to existing script behavior

**Risks**:
- **Script Path Resolution**: Setting `cwd` may break how Python finds the script itself
  - **Mitigation**: Use absolute `scriptPath` (already computed) in spawn call - `cwd` only affects script's internal path resolution
- **Unexpected Side Effects**: Scripts may assume running from `extension/bridge/` directory
  - **Mitigation**: Review all bridge scripts for hardcoded relative path assumptions (currently only `ontology.json` which is in bridge directory)

---

### Milestone 4: Configure Test Infrastructure

**Objective**: Set up VS Code extension test environment to enable unit and integration test execution.

**Deliverables**:
1. Create VS Code extension test runner: `extension/src/test/runTest.ts`
2. Create test index file: `extension/src/test/index.ts`
3. Update build configuration to compile test files
4. Verify `npm test` successfully executes test suite
5. Document test execution in project README

**Acceptance Criteria**:
- ✅ `npm test` command executes without "Cannot find module" errors
- ✅ Test runner successfully bootstraps Mocha in VS Code extension host
- ✅ All 16 unit tests in `cogneeClient.test.ts` are discovered and executed
- ✅ Test output shows pass/fail status for each test case
- ✅ Test framework can mock VS Code APIs and Node.js modules
- ✅ CI/CD pipeline can run tests in headless mode (if applicable)

**Implementation Steps**:

**Step 1: Create Test Runner (`src/test/runTest.ts`)**
- Bootstrap VS Code extension test environment using `@vscode/test-electron`
- Download and launch appropriate VS Code version
- Set extension development path to workspace root
- Set test file path to compiled test index
- Configure test options (timeouts, reporter, exit behavior)

**Step 2: Create Test Index (`src/test/index.ts`)**
- Configure Mocha test framework options
- Set up global test hooks (if needed)
- Discover and load all test files matching pattern `**/*.test.js`
- Configure test reporter for CI compatibility
- Handle test completion and error reporting

**Step 3: Update Build Configuration**

**Recommended Approach (Option B): Dedicated TypeScript Compiler for Tests**
- Add `tsc` compilation step to compile test files to `out/test/`
- Create `tsconfig.test.json` extending base config with test-specific settings
- Keep esbuild for production code bundling to `dist/`
- Update `package.json` scripts to run both build steps
- **Rationale**: Simpler, more maintainable separation of concerns. Production bundling remains isolated from test compilation. Easier to configure Mocha test discovery with unbundled test files.

**Alternative (Option A): Extend esbuild.js for Tests**
- Add `src/test/runTest.ts` and `src/test/index.ts` to esbuild entry points
- Configure separate output directory (`out/test/`)
- Ensure test files are not bundled (preserve module structure for Mocha discovery)
- **When to use**: If implementer has strong rationale for unified build tooling or esbuild expertise

**Step 4: Update package.json Test Script**
- Update test script to point to correct test runner location
- Example: `"test": "node ./out/test/runTest.js"`
- Add pre-test compilation step if needed
- Consider adding `test:watch` script for development

**Step 5: Verify Test Execution**
- Run `npm test` from `extension/` directory
- Confirm all tests are discovered (should show 16 test cases from `cogneeClient.test.ts`)
- Verify mocking works correctly (sinon stubs for fs, process, vscode)
- Check test output format is readable and reports pass/fail clearly

**Risks**:
- **VS Code API Mocking Complexity**: Extension tests require special test harness, not standard Mocha
  - **Mitigation**: Use `@vscode/test-electron` package already installed as dev dependency
- **Build Configuration Conflicts**: Test compilation may conflict with production bundling
  - **Mitigation**: Use separate output directories (`dist/` for production, `out/` for tests)
- **CI/CD Headless Mode**: Tests may fail in CI without display server
  - **Mitigation**: Configure xvfb or use VS Code test CLI's built-in headless support
- **Platform-Specific Test Failures**: Path detection tests may behave differently on Windows/Linux/macOS
  - **Mitigation**: Use sinon to mock `process.platform` for deterministic cross-platform tests

**References**:
- VS Code Extension Testing Guide: https://code.visualstudio.com/api/working-with-extensions/testing-extension
- `@vscode/test-electron` documentation: https://github.com/microsoft/vscode-test

---

### Milestone 5: Update Documentation and Configuration

**Objective**: Clearly document Python environment expectations and new auto-detection behavior.

**Deliverables**:
1. Updated `extension/README.md`:
   - Document auto-detection behavior and priority chain
   - Explain when to use explicit `cogneeMemory.pythonPath` setting
   - Add troubleshooting section for common errors
   - Include platform-specific virtual environment paths
2. Updated `package.json` configuration description:
   - Clarify that `pythonPath` is optional (auto-detection tries `.venv` first)
   - Note that explicit setting overrides auto-detection
3. Updated `CHANGELOG.md`:
   - Document new auto-detection feature
   - Document enhanced error messages
   - Note breaking change: none (backward compatible)
4. Updated integration test documentation:
   - Add test case for auto-detection behavior
   - Add test case for error message visibility

**Acceptance Criteria**:
- ✅ README explains auto-detection priority chain with examples
- ✅ README includes troubleshooting section with Failure Mode Table from Analysis 006
- ✅ `package.json` configuration schema updated with auto-detection notes
- ✅ CHANGELOG documents new v0.2.0 features clearly
- ✅ Users understand when manual `pythonPath` config is needed vs auto-detection

**Risks**:
- **Documentation Drift**: Implementation may diverge from documented behavior
  - **Mitigation**: Update docs in same PR as implementation, require reviewer to verify alignment

---

## 4. Implementation Plan

### Milestone 1: Intelligent Interpreter Auto-Detection

**Step 1: Create `detectPythonInterpreter()` method**
- Location: `extension/src/cogneeClient.ts`, after `constructor()`
- Signature: `private detectPythonInterpreter(): string`
- Logic:
  1. Check if `cogneeMemory.pythonPath` is explicitly set (not default 'python3')
  2. If set and non-default, return value immediately (user override)
  3. Detect OS platform: `process.platform === 'win32'`
  4. Build candidate paths:
     - Linux/macOS: `path.join(this.workspacePath, '.venv', 'bin', 'python')`
     - Windows: `path.join(this.workspacePath, '.venv', 'Scripts', 'python.exe')`
  5. Check candidate existence with `fs.existsSync()`
  6. Return first valid candidate, otherwise return 'python3'
- Error Handling: Wrap file checks in try-catch, log failures, proceed to next candidate

**Step 2: Update constructor to use detected interpreter**
- Replace line:
  ```typescript
  this.pythonPath = config.get<string>('pythonPath', 'python3');
  ```
- With:
  ```typescript
  this.pythonPath = this.detectPythonInterpreter();
  ```
- Log detected path at INFO level:
  ```typescript
  this.log('INFO', 'Python interpreter detected', {
      pythonPath: this.pythonPath,
      source: config.get<string>('pythonPath') !== 'python3' ? 'explicit_config' : 'auto_detected'
  });
  ```

**Step 3: Add unit tests for detection logic**
- Create test file: `extension/src/test/cogneeClient.test.ts` (if not exists)
- Test cases:
  1. Explicit config overrides auto-detection
  2. `.venv/bin/python` detected on Linux/macOS
  3. `.venv/Scripts/python.exe` detected on Windows
  4. Falls back to `python3` if no venv found
  5. Handles permission errors gracefully
- Mock `fs.existsSync()` and `process.platform` for deterministic tests

**Step 4: Verify no performance regression**
- Measure `CogneeClient` construction time before/after changes
- Ensure detection adds <10ms overhead
- Log timing at DEBUG level during development, remove before merge

---

### Milestone 2: Enhanced Error Surfacing

**Step 1: Update `runPythonScript()` to capture stdout**
- Add `stdout` accumulation (already exists, currently discarded on error)
- On non-zero exit code:
  1. Try to parse `stdout` as JSON
  2. If JSON valid and contains `error` field, extract structured error
  3. If JSON invalid, treat `stdout` as unstructured error message
  4. Log both `stderr` and `stdout` (sanitized and truncated)
- Update rejection logic to include structured error context

**Step 2: Implement sanitization utility**
- New method: `private sanitizeOutput(text: string): string`
- Redaction rules:
  1. Replace `OPENAI_API_KEY=<32+ chars>` with `OPENAI_API_KEY=***`
  2. Replace OpenAI-style keys: `sk-[A-Za-z0-9]{32,}` with `sk-***`
  3. Replace Bearer tokens: `Bearer [A-Za-z0-9\-_]{32,}` with `Bearer ***`
  4. Replace AWS-style keys: `AWS_SECRET_ACCESS_KEY=<20+ chars>` with `AWS_SECRET_ACCESS_KEY=***`
  5. Replace any 32+ character hex strings with `<redacted_token>`
  6. Truncate to 1024 characters max
- Return sanitized text
- **Note**: Current patterns cover common cases; additional secret patterns may be added in future iterations based on observed exposure risks

**Step 3: Update error logging and user messages**
- Apply sanitization to all logged stderr/stdout
- Construct user-facing error messages from structured JSON errors when available
- Include troubleshooting hint in generic errors:
  ```typescript
  `Python script failed. Check Output Channel for details. If using virtual environment, configure cogneeMemory.pythonPath setting.`
  ```

**Step 4: Add integration test for error visibility**
- Test case: Simulate missing `cognee` package
- Expected: Error message includes "No module named 'cognee'"
- Test case: Simulate missing `.env` file
- Expected: Error message includes "OPENAI_API_KEY not found"
- Test case: Verify API key redaction in logs
- Expected: Logs contain `OPENAI_API_KEY=***`, not actual key
- Test case: **Structured success-path validation** - Run successful script with valid JSON output
- Expected: JSON parsing continues to work correctly without regression from stdout/stderr capture changes

---

### Milestone 3: Defensive Working Directory

**Step 1: Update `spawn()` call with `cwd` option**
- Location: `runPythonScript()` method
- Change:
  ```typescript
  const python = spawn(this.pythonPath, [scriptPath, ...args], {
      cwd: this.workspacePath
  });
  ```
- Verify `scriptPath` is absolute (already computed with `path.join()`)

**Step 2: Test relative path resolution**
- Verify `ontology.json` loads correctly after `cwd` change
- Check that bridge scripts can still locate their own directory
- Add test case: confirm `os.getcwd()` in Python scripts returns workspace path

**Step 3: Document behavior change**
- Update inline comment in `runPythonScript()`:
  ```typescript
  // Spawn Python process with workspace as working directory
  // This ensures relative paths in scripts resolve from workspace root
  ```

---

### Milestone 5: Documentation Updates

**Step 1: Update `extension/README.md`**
- Add "Python Environment" section before "Configuration":
  ```markdown
  ## Python Environment
  
  The extension requires Python 3.x with the following packages:
  - `cognee` (version 0.3.4 or compatible)
  - `python-dotenv`
  
  ### Automatic Detection
  
  The extension automatically detects your Python interpreter in this order:
  1. **Explicit Setting**: `cogneeMemory.pythonPath` if configured (highest priority)
  2. **Workspace Virtual Environment**: `.venv/bin/python` (Linux/macOS) or `.venv/Scripts/python.exe` (Windows)
  3. **System Python**: `python3` as fallback
  
  ### When to Configure Manually
  
  Set `cogneeMemory.pythonPath` explicitly if:
  - Virtual environment is outside workspace directory
  - Virtual environment uses non-standard name (not `.venv`)
  - Multiple Python versions installed and specific one required
  - Using conda or pyenv environments (not auto-detected in v0.2.0)
  
  Example:
  ```json
  {
    "cogneeMemory.pythonPath": "/path/to/your/.venv/bin/python"
  }
  ```
  
  ### Unsupported Contexts (v0.2.0)
  
  The following contexts are **not validated or supported** in this release:
  - **Remote Development**: VS Code Remote-SSH, WSL, Dev Containers
  - **Multi-root Workspaces**: Workspaces with multiple folder roots
  - **Conda Environments**: Automatic detection not implemented (use explicit config)
  - **Pyenv Environments**: Automatic detection not implemented (use explicit config)
  
  Support for these contexts may be added in future releases.
  ```
- Add "Troubleshooting" section with Failure Mode Table from Analysis 006

**Step 2: Update `package.json` configuration**
- Update `pythonPath` description:
  ```json
  "cogneeMemory.pythonPath": {
    "type": "string",
    "default": "python3",
    "markdownDescription": "Path to Python interpreter. Leave as 'python3' for auto-detection of workspace `.venv`. Explicit path overrides auto-detection."
  }
  ```

**Step 3: Update `CHANGELOG.md`**
- Add v0.2.0 section:
  ```markdown
  ## [0.2.0] - TBD
  
  ### Added
  - **Automatic Python Interpreter Detection**: Extension now auto-detects workspace `.venv` virtual environment, eliminating need for manual `cogneeMemory.pythonPath` configuration in most cases
  - **Enhanced Error Messages**: Python errors (missing packages, API key issues) now visible in Output Channel with actionable troubleshooting hints
  - **Workspace-Relative Execution**: Bridge scripts run from workspace context for reliable path resolution
  
  ### Improved
  - Error logs sanitize sensitive data (API keys, tokens) before display
  - Configuration documentation clarifies when manual Python path setting is needed
  
  ### Fixed
  - Generic "exit code 1" errors replaced with specific failure reasons
  - Missing `cognee` package now clearly diagnosed instead of silent failure
  ```

**Step 4: Update `DISTRIBUTION.md` and `RELEASE_CHECKLIST.md`**
- Note that v0.2.0 testing requires scenarios with/without `.venv`
- Add validation step: test auto-detection with fresh workspace
- Add validation step: test error messages with intentionally broken environment

---

## 5. Testing Strategy

### Unit Tests

**Interpreter Detection Tests** (`cogneeClient.test.ts`):
1. Test explicit config overrides auto-detection
2. Test `.venv/bin/python` detection on Linux/macOS (mock platform)
3. Test `.venv/Scripts/python.exe` detection on Windows (mock platform)
4. Test fallback to `python3` when no venv exists
5. Test graceful handling of permission errors
6. Test performance: detection completes in <10ms

**Sanitization Tests** (`cogneeClient.test.ts`):
1. Test API key redaction: `OPENAI_API_KEY=sk-abc123...` → `OPENAI_API_KEY=***`
2. Test hex string redaction: 32+ char hex → `<redacted_token>`
3. Test output truncation: 2KB input → 1KB output
4. Test passthrough of normal error messages (no false positives)

### Integration Tests

**Environment Detection Tests** (new `test-integration.sh` scenarios):
1. **Scenario: Workspace with .venv**
   - Setup: Create workspace with `.venv/bin/python` containing `cognee`
   - Expected: Extension activates without config, uses venv interpreter
   - Validation: Check logs for "Python interpreter detected" with auto-detected path

2. **Scenario: Explicit Config Override**
   - Setup: Configure `cogneeMemory.pythonPath` to system Python
   - Expected: Extension uses configured path, ignores `.venv`
   - Validation: Check logs for "source: explicit_config"

3. **Scenario: No Virtual Environment**
   - Setup: Remove `.venv`, rely on system `python3`
   - Expected: Extension falls back to system Python
   - Validation: Check logs for "pythonPath: python3"

**Error Visibility Tests** (new scenarios):
1. **Scenario: Missing cognee Package**
   - Setup: Use Python interpreter without `cognee` installed
   - Expected: Error message includes "No module named 'cognee'"
   - Validation: Check Output Channel for structured error

2. **Scenario: Missing .env File**
   - Setup: Remove `.env` from workspace
   - Expected: Error message includes "OPENAI_API_KEY not found"
   - Validation: Check Output Channel for structured error

3. **Scenario: API Key Sanitization**
   - Setup: Trigger error that might log environment
   - Expected: Logs contain `OPENAI_API_KEY=***`, not actual key
   - Validation: Search logs for redaction patterns

### Manual Validation

**Fresh Workspace Testing**:
1. Create new VS Code workspace with no prior config
2. Add `.venv` with `cognee` and `python-dotenv` installed
3. Install extension, verify automatic activation
4. Check logs confirm auto-detection: "source: auto_detected"

**Error Message Clarity Testing**:
1. Rename `.venv` to break auto-detection
2. Don't configure `cogneeMemory.pythonPath`
3. Reload extension, observe error message
4. Verify message is actionable (tells user what's wrong and how to fix)

**Platform Coverage**:
- Test on Linux (dev machine)
- Test on Windows (CI or contributor)
- Test on macOS (CI or contributor)

---

## 6. Risks and Mitigations

### Risk: Breaking Changes to Existing Users

**Description**: Users with explicit `cogneeMemory.pythonPath` configured may experience unexpected behavior if auto-detection interferes.

**Likelihood**: Low  
**Impact**: Medium  
**Mitigation**:
- Ensure explicit config ALWAYS overrides auto-detection (implement priority check first)
- Add logging to show when explicit config is used vs auto-detected
- Document upgrade notes in CHANGELOG: "Explicit pythonPath setting continues to work as before"
- Test upgrade scenario: existing user with configured path should see no change

### Risk: Misconfigured Explicit Python Path

**Description**: User configures `cogneeMemory.pythonPath` to interpreter lacking required dependencies, trapping themselves in misconfiguration with no automatic fallback.

**Likelihood**: Medium  
**Impact**: Medium  
**Mitigation**:
- Respect explicit config priority (no automatic fallback) to maintain predictable behavior
- Enhanced error messages (Milestone 2) will surface missing dependencies clearly
- Log diagnostic hint: "If Python interpreter is incorrect, update cogneeMemory.pythonPath setting or remove it to enable auto-detection"
- Future enhancement consideration: passive detection check with warning (not automatic override)

### Risk: Platform-Specific Path Variations

**Description**: Virtual environment structures vary across OS (bin/ vs Scripts/) and Python distributions (conda, pyenv, etc).

**Likelihood**: Medium  
**Impact**: Medium  
**Mitigation**:
- Implement OS-specific path detection (check `process.platform`)
- Gracefully fall back to system Python if detection fails
- Document non-standard environment setups (conda, pyenv) as requiring explicit config
- Test on all three major platforms (Linux, Windows, macOS)

### Risk: Privacy Exposure in Enhanced Error Logging

**Description**: Capturing stdout/stderr may inadvertently log API keys, tokens, or sensitive environment variables.

**Likelihood**: Medium  
**Impact**: High  
**Mitigation**:
- Implement sanitization utility BEFORE any logging
- Redact known patterns: OpenAI API keys (`OPENAI_API_KEY=*`, `sk-*`), AWS keys (`AWS_SECRET_ACCESS_KEY=*`), Bearer tokens, long hex strings
- Truncate outputs to 1KB maximum per stream
- Implement streaming truncation during output collection (limit buffer growth to 2KB before final 1KB truncation)
- Review sanitization logic in code review with security mindset
- Add integration test specifically for API key redaction
- **Acknowledged Limitation**: Current sanitization covers common patterns; additional secret types may require future enhancement based on user-reported exposure

### Risk: Performance Regression from File System Checks

**Description**: Checking for `.venv` existence on every extension activation could slow startup.

**Likelihood**: Low  
**Impact**: Low  
**Mitigation**:
- Detection runs only once in constructor (not per script invocation)
- Use lightweight `fs.existsSync()` (synchronous check, no I/O queue)
- Limit checks to 2-3 candidates (explicit config, .venv, fallback)
- Measure and log detection time during testing (target: <10ms)
- No recursive directory searches (only check fixed paths)

### Risk: Relative Path Assumptions in Bridge Scripts

**Description**: Setting `cwd` to workspace may break scripts that assume running from `extension/bridge/` directory.

**Likelihood**: Low  
**Impact**: Medium  
**Mitigation**:
- Audit all bridge scripts for relative path usage (currently only `ontology.json`)
- Use absolute `scriptPath` in spawn call (already implemented)
- `ontology.json` is loaded via relative path from script's `__file__` location (unaffected by cwd)
- Add test case to verify ontology loading after cwd change
- Document that scripts should use `__file__` for script-relative paths, not `os.getcwd()`

### Risk: Future Environment Type Support

**Description**: Hard-coded detection limited to `.venv` may require structural refactoring to support conda, pyenv, or other environment managers.

**Likelihood**: Medium  
**Impact**: Low  
**Mitigation**:
- Current single-path detection is sufficient for v0.2.0 scope
- Future refactor consideration: extract detection logic into pluggable strategy pattern
- Document conda/pyenv as requiring explicit config in v0.2.0
- Low-effort enhancement path exists (check `CONDA_PREFIX`, `PYENV_VERSION` environment variables)
- Technical debt acknowledged but acceptable for initial auto-detection implementation

---

## 7. Success Criteria

### Must-Have Criteria (Release Blockers)

1. ✅ **Zero-Config Activation**: User with `.venv/bin/python` (containing `cognee`) activates extension without manual config
2. ✅ **Clear Error Messages**: User without `cognee` package sees "No module named 'cognee'" instead of "exit code 1"
3. ✅ **API Key Privacy**: Error logs sanitize API keys (`OPENAI_API_KEY=***`)
4. ✅ **Backward Compatibility**: Existing users with explicit `cogneeMemory.pythonPath` see no behavior change
5. ✅ **Platform Support**: Auto-detection works on Linux, macOS, Windows
6. ✅ **Performance**: Interpreter detection completes in <10ms (no activation slowdown)
7. ✅ **Test Infrastructure**: `npm test` executes all unit tests successfully with pass/fail reporting
8. ✅ **Documentation**: README clearly explains auto-detection and when manual config is needed

### Should-Have Criteria (Quality Goals)

1. ✅ All unit tests pass (100% pass rate for all test cases in `cogneeClient.test.ts`)
2. ✅ All new functions have corresponding unit tests (`detectPythonInterpreter`, `sanitizeOutput`)
3. ✅ Integration tests pass for auto-detection scenarios
4. ✅ Integration tests pass for error visibility scenarios
5. ✅ Sanitization utility covers common secret patterns (API keys, tokens, hex strings)
6. ✅ Tests can run headlessly in CI/CD environment (xvfb or VS Code headless mode)
7. ✅ CHANGELOG documents new features clearly for v0.2.0
8. ✅ Troubleshooting section in README includes Failure Mode Table from Analysis 006

### Nice-to-Have Criteria (Future Enhancements)

1. 🔮 Environment readiness command (`Cognee: Verify Environment`) for preflight diagnostics
2. 🔮 Support for conda environments (`conda/bin/python`)
3. 🔮 Support for pyenv virtual environments
4. 🔮 Interactive prompt suggesting `.venv` creation if missing
5. 🔮 Telemetry on interpreter detection success rate (opt-in)

---

## 8. Rollback Plan

### If Critical Issues Arise

**Scenario 1: Auto-Detection Breaks Existing Configurations**
- **Symptoms**: Users with explicit `pythonPath` report extension not working after upgrade
- **Immediate Action**:
  1. Verify priority logic: explicit config should ALWAYS win
  2. Add logging to confirm which path is used
  3. If logic is correct but users confused, clarify in documentation
  4. If logic is broken, revert detection logic, keep explicit config only
- **Rollback Strategy**: Release v0.2.1 with detection disabled, revert to v0.1.0 behavior

**Scenario 2: Privacy Exposure in Error Logs**
- **Symptoms**: User reports API key visible in Output Channel logs
- **Immediate Action**:
  1. Verify sanitization utility is applied to all error paths
  2. Check for sanitization bypass in error handling
  3. Enhance redaction patterns if new exposure vector found
- **Rollback Strategy**: Release emergency patch disabling stdout capture, revert to stderr-only logging

**Scenario 3: Performance Regression**
- **Symptoms**: Extension activation noticeably slower after update
- **Immediate Action**:
  1. Measure detection time with profiler
  2. If >50ms, investigate file system bottleneck
  3. Cache detection result if repeated checks found
- **Rollback Strategy**: Release v0.2.1 with detection optimized or disabled

### Version Control Strategy

- **Feature Branch**: `feature/007-intelligent-interpreter-detection`
- **Merge to**: `main` after all success criteria met
- **Tag**: `v0.2.0` after successful validation
- **Rollback Tag**: `v0.1.0` remains available if emergency revert needed

---

## 9. Future Enhancements (Out of Scope for v0.2.0)

### Environment Readiness Command (MEDIUM Priority)

**User Story**: As a user troubleshooting extension issues, I want a command to verify my Python environment is correctly configured.

**Implementation**:
- Command: `Cognee: Verify Environment`
- Checks:
  1. Python interpreter path exists and is executable
  2. `cognee` package is importable
  3. `python-dotenv` package is importable
  4. `.env` file exists in workspace
  5. `OPENAI_API_KEY` is set in environment
- Output: Diagnostic report in Output Channel with pass/fail for each check
- Benefit: User-facing self-service diagnostics before filing issues

### Conda Environment Support (LOW Priority)

**User Story**: As a data scientist using conda, I want the extension to detect my conda environments.

**Implementation**:
- Extend detection logic to check `conda/bin/python` or `conda/Scripts/python.exe`
- Detect active conda environment via `CONDA_PREFIX` env var
- Fall back to conda base environment if workspace env not found

### Remote Context Support (FUTURE - NOT v0.2.0)

**User Story**: As a remote developer using SSH/WSL/Dev Containers, I want the extension to work in remote contexts.

**Implementation**:
- Investigate VS Code Remote API for workspace path resolution
- Test interpreter detection in remote contexts (may need different paths)
- Validate error logging doesn't break with remote stdout/stderr capture
- Document remote-specific setup requirements

**Status**: Explicitly out of scope for v0.2.0 (same as v0.1.0)

---

## 10. Acceptance and Handoff

### Implementation Readiness

**Prerequisites Complete**:
- ✅ Analysis 006 documented root cause and recommendations
- ✅ Plan 006 v0.1.0 release in progress (Milestone 1 complete)
- ✅ Current codebase structure supports proposed changes (no major refactor needed)
- ✅ TypeScript patterns established in existing `cogneeClient.ts`

**Blockers**: None identified

### Implementer Guidance

**Start Here**:
1. Read this plan in full
2. Review `extension/src/cogneeClient.ts` constructor and `runPythonScript()` method
3. Review Analysis 006 Recommendations section for technical context
4. Implement Milestone 1 (interpreter detection) first - enables testing of subsequent milestones
5. Implement Milestone 2 (error surfacing) second - most impactful user-facing improvement
6. Implement Milestone 3 (defensive cwd) third - low-risk defensive enhancement
7. Implement Milestone 4 (test infrastructure) fourth - **CRITICAL: must be completed before validation**
8. Implement Milestone 5 (documentation) last - captures final implementation details

**Key Implementation Details**:
- Detection logic must check explicit config FIRST (user override is sacred)
- Sanitization must run BEFORE any logging (privacy is non-negotiable)
- Use `fs.existsSync()` not `fs.promises.access()` (synchronous ok in constructor)
- Log detected path with source attribution ("explicit_config" vs "auto_detected")
- Test on Linux first (dev machine), then Windows/macOS (CI or contributors)

### Validation Checklist

Before marking implementation complete:
- [ ] All unit tests pass (interpreter detection, sanitization)
- [ ] All integration tests pass (environment detection, error visibility)
- [ ] Manual testing complete on primary platform (Linux)
- [ ] Documentation updated (README, package.json, CHANGELOG)
- [ ] Code review complete with focus on sanitization logic
- [ ] API key redaction verified in integration test
- [ ] Performance check: detection <10ms
- [ ] Backward compatibility verified: explicit config still works

### Reviewer Handoff

After implementation complete:
- Reviewer (Product Owner) conducts UAT per revised reviewer chatmode
- Creates UAT document in `uat/007-intelligent-python-interpreter-detection-uat.md`
- Validates business value: "User with `.venv` activates without config" (core value statement)
- UAT Status must be "UAT Complete" before merging to main

### Quality Control Handoff

After implementation complete:
- qa chatmode verifies test coverage
- Creates QA document in `qa/007-intelligent-python-interpreter-detection-qa.md`
- Validates all code changes have corresponding tests
- QA Status must be "QA Complete" before merging to main

---

## 11. Appendix: Technical References

### Related Documents

- **Analysis 006**: `analysis/006-vsix-packaging-and-release-analysis.md`
  - Root cause analysis of interpreter mismatch
  - Failure mode table
  - Medium-term quality improvement recommendations
- **Plan 006**: `planning/006-vsix-packaging-and-release.md`
  - Section 9: Quality Improvements (HIGH priority items)
  - Milestone 2: Environment setup and troubleshooting
- **CogneeClient Source**: `extension/src/cogneeClient.ts`
  - Current constructor logic (line 45-68)
  - Current `runPythonScript()` implementation (line 266-339)

### Code Snippets

**IMPORTANT**: The following code snippets are **ILLUSTRATIVE ONLY** and provided as guidance for implementer understanding. They are NOT prescriptive requirements. Implementers have full autonomy to choose optimal technical approaches, naming conventions, and structural patterns that best fit the codebase and deliver the specified outcomes.

**Interpreter Detection Logic** (illustrative example):
```typescript
private detectPythonInterpreter(): string {
    const config = vscode.workspace.getConfiguration('cogneeMemory');
    const configuredPath = config.get<string>('pythonPath', 'python3');
    
    // Explicit config always wins
    if (configuredPath !== 'python3') {
        return configuredPath;
    }
    
    // Auto-detect workspace .venv
    const isWindows = process.platform === 'win32';
    const venvPath = isWindows
        ? path.join(this.workspacePath, '.venv', 'Scripts', 'python.exe')
        : path.join(this.workspacePath, '.venv', 'bin', 'python');
    
    try {
        if (fs.existsSync(venvPath)) {
            return venvPath;
        }
    } catch (error) {
        // Permission error, missing directory, etc - fall through
    }
    
    // Fall back to system Python
    return 'python3';
}
```

**Sanitization Logic** (illustrative example):
```typescript
private sanitizeOutput(text: string): string {
    let sanitized = text;
    
    // Redact OpenAI API keys
    sanitized = sanitized.replace(
        /OPENAI_API_KEY=[\w\-]{32,}/g,
        'OPENAI_API_KEY=***'
    );
    
    // Redact OpenAI-style keys (sk-...)
    sanitized = sanitized.replace(
        /sk-[A-Za-z0-9]{32,}/g,
        'sk-***'
    );
    
    // Redact Bearer tokens
    sanitized = sanitized.replace(
        /Bearer [A-Za-z0-9\-_]{32,}/g,
        'Bearer ***'
    );
    
    // Redact long hex strings (likely tokens)
    sanitized = sanitized.replace(
        /\b[0-9a-fA-F]{32,}\b/g,
        '<redacted_token>'
    );
    
    // Truncate to 1KB
    if (sanitized.length > 1024) {
        sanitized = sanitized.substring(0, 1024) + '\n... (truncated)';
    }
    
    return sanitized;
}
```

### Configuration Schema Reference

**Current `package.json` configuration**:
```json
"cogneeMemory.pythonPath": {
    "type": "string",
    "default": "python3",
    "description": "Path to Python interpreter"
}
```

**Proposed `package.json` configuration** (updated in Milestone 4):
```json
"cogneeMemory.pythonPath": {
    "type": "string",
    "default": "python3",
    "markdownDescription": "Path to Python interpreter. Leave as 'python3' for auto-detection of workspace `.venv`. Explicit path overrides auto-detection."
}
```

### Platform-Specific Paths

| Platform | Virtual Environment Interpreter Path |
|----------|--------------------------------------|
| Linux    | `.venv/bin/python`                  |
| macOS    | `.venv/bin/python`                  |
| Windows  | `.venv\Scripts\python.exe`          |

---

**Plan Author**: planner chatmode  
**Last Updated**: November 11, 2025  
**Review Status**: Pending critic review  
**Implementation Status**: Not started
