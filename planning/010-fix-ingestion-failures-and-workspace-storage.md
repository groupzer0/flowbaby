# Plan 010: Fix Ingestion Failures and Workspace Storage Isolation

## Value Statement and Business Objective

As a VS Code extension user, I want Cognee Memory v0.2.0 to store and retrieve my relevant information reliably in my workspace, so that the @cognee-memory participant can answer questions with accurate, fast context.

## Objective

Fix critical ingestion failures and storage isolation issues causing 30s timeouts, file-not-found errors, and unreliable data capture. Eliminate fallback code that masks errors and enforce workspace-local storage for all Cognee databases.

## Background

Analysis 010 identified the root cause of ingestion failures:

1. **Cognee system/data directories default to site-packages** instead of workspace paths, causing cross-context file mismatches and timeouts
2. **Bridge uses wrong parameter names** for Cognee 0.4.0 APIs (e.g., `datasets=[...]` in `add()` which expects `dataset_name`)
3. **Silent fallback code** catches TypeErrors and retries with alternate parameters, masking configuration errors
4. **Environment variable mismatch**: bridge checks `OPENAI_API_KEY` but Cognee 0.4.0 expects `LLM_API_KEY`

User observed symptoms:
- Repeated 30s Python script timeouts during ingestion
- "File not found" errors under venv site-packages: `.../site-packages/cognee/.data_storage/text_649c....txt`
- High retrieval latency (7-12s) consistent with non-local storage penalties
- Successful initialization but failed captures

## Plan

### Task 1: Configure workspace-local storage directories in init.py

**Owner**: Implementer  
**Files**: `extension/bridge/init.py`

**Objective**: Set Cognee's system and data directories to workspace-scoped paths so all databases and storage are isolated per-workspace.

**What**: After LLM API key setup, configure Cognee to use workspace-local directories for all system and data storage instead of defaulting to site-packages paths.

**Where**: In `init.py`, after setting LLM API key and provider configuration (around line 50-55).

**Why**: Cognee 0.4.0 defaults to site-packages for storage, causing cross-context file mismatches, permission issues, and slow I/O. Workspace-scoped directories eliminate these issues and ensure proper isolation.

**Implementation approach**:
- Call `cognee.config.system_root_directory()` with path: `<workspace>/.cognee_system`
- Call `cognee.config.data_root_directory()` with path: `<workspace>/.cognee_data`
- Keep existing `.cognee/` directory creation for local markers unchanged
- Rely on Cognee's internal directory creation (no explicit validation needed initially)

**Acceptance criteria**:
- `init.py` calls both `system_root_directory` and `data_root_directory` with workspace paths
- Successful initialization creates `.cognee_system/` and `.cognee_data/` under workspace root
- No files written to venv site-packages during ingestion

---

### Task 2: Require LLM_API_KEY without fallback in init.py

**Owner**: Implementer  
**Files**: `extension/bridge/init.py`

**Objective**: Validate `LLM_API_KEY` is set and fail fast with clear error message. Remove fallback to `OPENAI_API_KEY` to enforce explicit configuration aligned with Cognee 0.4.0.

**What**: Replace environment variable check from `OPENAI_API_KEY` to `LLM_API_KEY` and provide explicit setup instructions in error message.

**Where**: In `init.py`, at the API key validation section (around line 45-50).

**Why**: Cognee 0.4.0 documentation and code expect `LLM_API_KEY` as the canonical environment variable. Using the wrong variable name causes silent failures or misleading error messages when users follow official docs.

**Implementation approach**:
- Read `LLM_API_KEY` from environment (remove `OPENAI_API_KEY` check)
- Return structured error with setup instructions if missing
- Keep existing `cognee.config.set_llm_api_key()` and `set_llm_provider()` calls unchanged

**Migration decision (FINAL)**: Breaking change with clear documentation (Option A). Users must add `LLM_API_KEY` to `.env`. This is acceptable for v0.2.x early stage and aligns with upstream conventions. No automatic migration to avoid complexity/risk of modifying user `.env` files.

**Acceptance criteria**:
- `init.py` reads only `LLM_API_KEY` (no `OPENAI_API_KEY` fallback)
- Missing key returns explicit error: "LLM_API_KEY not found in environment or .env file. Set LLM_API_KEY=\"sk-...\" in your workspace .env"
- Successful init with `LLM_API_KEY` present works as before

---

### Task 3: Remove fallback parameter retries in ingest.py

**Owner**: Implementer  
**Files**: `extension/bridge/ingest.py`

**Objective**: Eliminate try-except TypeError blocks that retry with alternate parameter names. Use correct Cognee 0.4.0 signatures directly and let mismatches surface as clear errors.

**What**: Replace fallback retry logic with direct API calls using correct parameter names for Cognee 0.4.0.

**Where**: In `ingest.py`, at the `add()` call (around line 95-110) and `cognify()` call (around line 115-135).

**Why**: Silent fallback code masks configuration errors and API signature mismatches. By using correct parameters directly, TypeErrors surface immediately with actionable stack traces, making debugging faster and preventing silent failures.

**Implementation approach for add()**:
- Call `cognee.add()` with `data=[conversation]` and `dataset_name=dataset_name`
- Remove try-except blocks that retry with `datasets=` or `dataset=` parameters
- Let any TypeError surface directly to exception handler

**Implementation approach for cognify()**:
- Call `cognee.cognify()` with `datasets=[dataset_name]` only
- Remove `ontology_file_path` kwarg passing (Cognee 0.4.0 reads from environment via `OntologyEnvConfig`)
- Remove try-except blocks for ontology parameter fallback
- Keep ontology validation for logging purposes only

**Acceptance criteria**:
- `add()` called with `data=` and `dataset_name=` parameters only
- `cognify()` called with `datasets=` parameter only
- No try-except TypeError blocks for parameter retry logic
- TypeError from signature mismatch surfaces immediately with full stack trace in Output Channel
- Ontology configuration documented as environment-based (`.env` with `ontology_file_path=/path/to/file.ttl`)

---

### Task 4: Require LLM_API_KEY without fallback in ingest.py

**Owner**: Implementer  
**Files**: `extension/bridge/ingest.py`

**Objective**: Match init.py's environment validation; fail fast if `LLM_API_KEY` missing with consistent error messaging.

**What**: Update environment variable check from `OPENAI_API_KEY` to `LLM_API_KEY` in the ingestion script.

**Where**: In `ingest.py`, at the API key validation section (around line 35-40).

**Why**: Consistent environment variable usage across all bridge scripts prevents confusion and ensures error messages align with documentation and Cognee 0.4.0 conventions.

**Implementation approach**:
- Replace `os.getenv('OPENAI_API_KEY')` with `os.getenv('LLM_API_KEY')`
- Update error message to match init.py format
- Maintain same structured error response format

**Acceptance criteria**:
- `ingest.py` reads only `LLM_API_KEY` (consistent with init.py)
- Missing key returns error: "LLM_API_KEY not found in environment or .env file. Set LLM_API_KEY=\"sk-...\" in your workspace .env"
- Error response structure unchanged (maintains `{'success': False, 'error': '...'}`)

---

### Task 5: Update error logging to include parameters used

**Owner**: Implementer  
**Files**: `extension/bridge/ingest.py`

**Objective**: When ingestion fails, log the exception class, message, and exact parameters passed to `add()` and `cognify()` for rapid field triage.

**What**: Enhance the main exception handler to output structured error details including exception type, message, and relevant parameters.

**Where**: In `ingest.py`, at the main exception handler (around line 150-160), outside any removed try-except blocks from Task 3.

**Why**: Generic "Ingestion failed" errors lack context for debugging. Structured logging with exception types and parameters enables quick identification of root causes (missing env vars, wrong parameter types, network failures, etc.).

**Implementation approach**:
- Capture exception type via `type(e).__name__`
- Build structured error details dictionary with: exception type, message, dataset name, conversation length (as character count), ontology validation status
- Log structured details to stderr as JSON for Output Channel visibility
- Return user-facing error with exception type and message

**Acceptance criteria**:
- User-facing error includes exception type: "Ingestion failed (TypeError): ..."
- stderr log contains JSON with: exception_type, exception_message, dataset_name, conversation_length (character count), ontology_validated
- Output Channel displays both user-facing error and detailed stderr output
- Exception handler positioned outside any removed try-except blocks (no error masking)

---

### Task 6: Update user-facing documentation

**Owner**: Implementer  
**Files**: 
- `extension/README.md`
- `extension/SETUP.md`
- `extension/CHANGELOG.md`

**Objective**: Document the breaking change (LLM_API_KEY requirement) and updated workspace storage behavior.

**Implementation steps**:

1. **CHANGELOG.md** - add under v0.2.1 or next version:

```markdown
### Breaking Changes
- Environment: `LLM_API_KEY` is now required in workspace `.env`. Previously supported `OPENAI_API_KEY` fallback removed to align with Cognee 0.4.0 conventions.

### Fixed
- Ingestion failures and 30s timeouts caused by Cognee using site-packages storage instead of workspace-local directories
- Silent parameter fallback code that masked configuration errors
- File-not-found errors during ingestion due to cross-context storage mismatches

### Changed
- All Cognee system and data directories now scoped to workspace (`.cognee_system/`, `.cognee_data/`)
- Removed fallback parameter retries; signature mismatches now surface as clear errors
```

2. **README.md** - update Prerequisites or Configuration section:

```markdown
## Prerequisites

- Python 3.10 to 3.12
- OpenAI API key set in workspace `.env` as `LLM_API_KEY`:
  ```
  LLM_API_KEY=sk-your-key-here
  ```
```

3. **SETUP.md** - add troubleshooting section:

```markdown
### Common Issues

**Ingestion fails with "LLM_API_KEY not found"**
- Create or update `.env` in your workspace root with:
  ```
  LLM_API_KEY=sk-your-key-here
  ```
- Note: `OPENAI_API_KEY` is no longer supported; use `LLM_API_KEY` to align with Cognee 0.4.0.
```

**Acceptance criteria**:
- CHANGELOG documents breaking change and fixes
- README shows `LLM_API_KEY` in examples
- SETUP troubleshooting covers common env var issue

---

### Task 7: Set up Python Bridge Testing Infrastructure

**Owner**: Implementer  
**Files**: 
- `extension/bridge/requirements.txt`
- `extension/bridge/pytest.ini` (NEW)
- `extension/bridge/tests/` (NEW directory)
- `extension/bridge/tests/conftest.py` (NEW)
- `extension/bridge/tests/test_init.py` (NEW)
- `extension/bridge/tests/test_ingest.py` (NEW)
- `extension/bridge/manual_test.py` (NEW)
- `extension/package.json`

**Objective**: Create pytest-based testing infrastructure for Python bridge scripts so QA can validate Tasks 1-6 with automated unit tests and manual E2E harness.

**What**: Set up pytest framework with fixtures for mocking Cognee APIs, create unit tests for `init.py` and `ingest.py` validation logic, and provide manual test harness for E2E ingestion flow.

**Where**: Create new `extension/bridge/tests/` directory with pytest configuration and test files. Add pytest dependencies to `requirements.txt` and npm test script to `package.json`.

**Why**: Current testing infrastructure only covers TypeScript surface. Python bridge scripts modified in Tasks 1-6 have zero test coverage, preventing QA from validating workspace storage, LLM_API_KEY enforcement, and error logging behavior without manual setup.

**Implementation approach**:

1. **Add pytest dependencies to `extension/bridge/requirements.txt`**:
   - `pytest>=7.4.0`
   - `pytest-asyncio>=0.21.0`
   - `pytest-mock>=3.11.0`

2. **Create `extension/bridge/pytest.ini`** with standard configuration:
   - testpaths = tests
   - asyncio_mode = auto
   - python_files/classes/functions patterns

3. **Create test directory structure**:
   - `extension/bridge/tests/__init__.py` (empty marker file)
   - `extension/bridge/tests/conftest.py` with fixtures:
     * `mock_cognee` fixture providing mocked Cognee client
     * `temp_workspace` fixture creating isolated workspace directories
     * `mock_env` fixture setting test environment variables

4. **Create `extension/bridge/tests/test_init.py`**:
   - Test `LLM_API_KEY` missing raises clear error
   - Test workspace storage directories configured correctly
   - Test ontology path validation (mocked file checks)
   - Mock `cognee.config` methods to avoid real API calls

5. **Create `extension/bridge/tests/test_ingest.py`**:
   - Test `add()` called with `data=` and `dataset_name=` parameters
   - Test `cognify()` called with `datasets=` parameter
   - Test structured error logging includes exception metadata
   - Test missing `LLM_API_KEY` returns proper error response
   - Mock `cognee.add()` and `cognee.cognify()` to avoid real API calls

6. **Create `extension/bridge/manual_test.py`**:
   - CLI script accepting `--action` (init|ingest|retrieve|clear)
   - Loads `.env.test` or `.env` from workspace
   - Calls corresponding bridge script with sample data
   - Reports success/failure with timing and directory checks
   - Usage: `python manual_test.py --action ingest --workspace /path/to/test-workspace`

7. **Add npm test script to `extension/package.json`**:
   ```json
   "test:bridge": "cd bridge && pytest tests/ -v",
   "test:all": "npm test && npm run test:bridge"
   ```

**Acceptance criteria**:
- `pytest extension/bridge/tests/ -v` runs successfully (requires pytest installed)
- At least 8 unit tests created covering Tasks 2, 4, 5 validation logic
- Tests use mocks; no real Cognee API calls during pytest execution
- `manual_test.py` script can execute init and ingest with real API key
- QA can run `npm run test:bridge` to validate Python bridge changes
- Documentation in `TESTING.md` (optional) or test file docstrings explains fixture usage

---

### Task 8: Execute end-to-end ingestion validation

**Owner**: QA  
**Files**: N/A (manual testing with Task 7 infrastructure)

**Objective**: Verify that Clear → Capture → Retrieve works without timeouts or file-not-found errors after implementing Tasks 1-7.

**Prerequisites**:
- Task 7 testing infrastructure completed (pytest framework, manual_test.py script)
- Workspace with `.env` containing valid `LLM_API_KEY`
- Python environment with Cognee 0.4.0 and pytest installed

**Test execution approach**:

1. **Automated Unit Tests** (using pytest from Task 7):
   - Run `npm run test:bridge` to execute Python bridge unit tests
   - Verify all mocked tests pass for LLM_API_KEY validation, storage config, error logging
   - Expected: 8+ tests passing, 0 failures

2. **Manual E2E Tests** (using manual_test.py from Task 7):
   - Use `manual_test.py` script to test real Cognee API integration
   - Execute test scenarios below with real API key

**Manual Test Scenarios**:

1. **Test Case 1: Clean slate ingestion**:
   - Start VS Code Extension Development Host
   - Open Output → Cognee Memory
   - Run "Cognee: Clear Workspace Memory"
   - Expected: Success; `.cognee_system/` and `.cognee_data/` created under workspace

2. **Test Case 2: Capture text**:
   - Run "Cognee: Capture to Cognee Memory"
   - Input: "Barcelona has a rich cultural heritage and is today an important cultural centre and a major tourist destination."
   - Expected:
     - Output shows `Conversation ingested { chars: 111, timestamp: ... }`
     - No 30s timeout
     - No "File not found" errors
     - `.cognee_data/` directory grows in size

3. **Test Case 3: Retrieve text**:
   - In Chat, query `@cognee-memory what do you know about Barcelona?`
   - Expected:
     - Output shows `Context retrieved { result_count: >=1, duration: <5000 }`
     - Chat response includes snippet about Barcelona's cultural heritage
     - Retrieval latency <5s after warm-up

4. **Test Case 4: Missing LLM_API_KEY**:
   - Remove `LLM_API_KEY` from `.env`
   - Reload window
   - Attempt capture
   - Expected: Clear error message in Output: "LLM_API_KEY not found in environment or .env file. Set LLM_API_KEY=... in your workspace .env"

5. **Test Case 5: Verify no site-packages usage**:
   - After successful capture, check:
     ```bash
     ls -la .venv/lib/python3.12/site-packages/cognee/.data_storage/
     ```
   - Expected: Directory should not exist or be empty (all storage under workspace `.cognee_data/`)

6. **Test Case 6: Structured error logging**:
   - Trigger ingestion failure (e.g., invalid dataset name or network error)
   - Check Output → Cognee Memory for stderr logs
   - Expected: JSON output with exception_type, exception_message, dataset_name, conversation_length, ontology_validated

**Acceptance criteria**:
- All automated pytest unit tests pass (Task 7 test suite)
- All 6 manual test cases pass
- No timeouts during ingestion
- No file-not-found errors in site-packages paths
- Retrieval returns captured content
- Error messages are clear and actionable
- Structured error logging verified in Output channel

---

## Dependencies

- **Analysis 010**: Root cause analysis and verified Cognee 0.4.0 API signatures
- **Cognee 0.4.0**: Python library installed in workspace venv
- **Extension v0.2.0**: Current codebase with bridge scripts

## Risks and Mitigation

### Risk 1: Breaking change disrupts existing users
**Impact**: Users with only `OPENAI_API_KEY` in `.env` will see initialization failures  
**Mitigation**:
- Document migration clearly in CHANGELOG and README
- Provide explicit error message with instructions
- Consider this acceptable for early v0.2.x given alignment with upstream

### Risk 2: Workspace storage directories grow large over time
**Impact**: `.cognee_system/` and `.cognee_data/` consume disk space per workspace  
**Mitigation**:
- Already have "Clear Workspace Memory" command to prune
- Document periodic cleanup recommendation in SETUP.md
- Future: Add storage size monitoring/warnings

### Risk 3: Ontology configuration via environment may be missed by users
**Impact**: Users may not realize they need `ontology_file_path` in `.env` to use custom ontologies  
**Mitigation**:
- Log ontology status during initialization (already done)
- Document in README with example `.env` snippet
- Default behavior (no ontology) still works

### Risk 4: Testing infrastructure adds complexity and dependencies
**Impact**: Adding pytest framework increases maintenance burden and requires Python testing expertise  
**Mitigation**:
- Keep tests simple with clear fixtures and minimal mocking
- Document test execution in SETUP.md or test file docstrings
- pytest is standard Python testing tool with excellent documentation
- Tests prevent regressions and provide examples of correct API usage
- Can skip automated tests and rely on manual E2E testing if preferred (Task 8 manual scenarios still validate)

## Testing Strategy

**Owner**: QA Agent  
**Scope**: End-to-end validation of ingestion flow after Tasks 1-6 implementation

**Expected test types**:
- **Integration tests**: Clear → Capture → Retrieve workflow with real Cognee API
- **Error handling tests**: Missing `LLM_API_KEY`, invalid workspace paths, network failures
- **Storage isolation tests**: Verify no files written to site-packages; all data under workspace directories
- **Performance tests**: Measure retrieval latency after warm-up; confirm <5s for typical queries

**Coverage expectations**:
- All happy path scenarios (successful initialization, ingestion, retrieval)
- All error scenarios documented in Tasks 2, 4, 5 (missing env vars, parameter mismatches)
- Edge cases: empty captures, large conversations, ontology configuration via `.env`

**Critical validation scenarios**:
1. Fresh workspace with correct `.env` setup completes full workflow without timeouts
2. Missing `LLM_API_KEY` produces clear, actionable error message
3. Storage directories created under workspace (`.cognee_system/`, `.cognee_data/`), not site-packages
4. Retrieved context matches captured content
5. Error logging includes structured details for triage

### Testing Infrastructure Requirements

**Test Frameworks**:
- **TypeScript**: Mocha + Chai (already configured in `package.json`)
- **Python Bridge**: pytest for unit tests (NEW - to be added)

**Testing Libraries**:
- **Existing**: `@vscode/test-electron`, `sinon`, `mock-fs` (TypeScript mocking)
- **Required NEW**: 
  - `pytest>=7.4.0` (Python test runner)
  - `pytest-asyncio>=0.21.0` (async test support for Cognee APIs)
  - `pytest-mock>=3.11.0` (Python mocking utilities)

**Configuration Files**:
- **Existing**: `package.json` test script, `tsconfig.test.json`, `out/test/runTest.ts`
- **Required NEW**:
  - `extension/bridge/pytest.ini` (pytest configuration)
  - `extension/bridge/tests/` directory structure with `__init__.py`
  - `extension/bridge/tests/conftest.py` (pytest fixtures for mocked Cognee client)

**Environment Requirements**:
- **Testing Environment Variables** (in `.env.test` or CI secrets):
  - `LLM_API_KEY=sk-test-mock-key-12345` (for integration tests)
  - `WORKSPACE_PATH=/tmp/test-workspace` (isolated test workspace)
- **CI/CD Variables**: Same as above, plus `COGNEE_TEST_MODE=true` to gate real API calls

**Dependencies to Install**:
```bash
# TypeScript (already done)
npm install
npm run compile

# Python Bridge Testing (NEW)
cd extension/bridge
pip install pytest pytest-asyncio pytest-mock
pip install cognee==0.4.0 python-dotenv
```

**Build Tooling Changes**:
- **Add to `extension/bridge/requirements.txt`**:
  ```
  # Testing dependencies
  pytest>=7.4.0
  pytest-asyncio>=0.21.0
  pytest-mock>=3.11.0
  ```
- **Add npm script to `extension/package.json`**:
  ```json
  "scripts": {
    "test:bridge": "cd bridge && pytest tests/ -v",
    "test:all": "npm test && npm run test:bridge"
  }
  ```

**Test Files to Create**:
1. `extension/bridge/pytest.ini`:
   ```ini
   [pytest]
   testpaths = tests
   python_files = test_*.py
   python_classes = Test*
   python_functions = test_*
   asyncio_mode = auto
   ```

2. `extension/bridge/tests/conftest.py`:
   - Fixtures for mocked Cognee client
   - Fixtures for temporary workspace directories
   - Fixtures for mock LLM_API_KEY environment

3. `extension/bridge/tests/test_init.py`:
   - Test `LLM_API_KEY` validation and error messages
   - Test workspace storage directory configuration
   - Test ontology path validation

4. `extension/bridge/tests/test_ingest.py`:
   - Test `add()` and `cognify()` with correct parameters
   - Test structured error logging output
   - Test missing `LLM_API_KEY` error path
   - Mock Cognee API responses to avoid real API calls

5. `extension/bridge/tests/test_retrieve.py`:
   - Test retrieval with mocked search results
   - Test error handling for failed retrievals

**Manual Test Harness** (for Task 7 E2E validation):
- Create `extension/bridge/manual_test.py` script that:
  - Loads `.env.test` with real `LLM_API_KEY`
  - Calls `init.py` and `ingest.py` with sample data
  - Validates storage directories created
  - Measures retrieval latency
  - Outputs structured test report

**QA will define specific test cases and create comprehensive test plan in `qa/` directory.**

## Resolved Questions

1. **Environment variable migration**: ✓ RESOLVED - No migration; breaking change documented in CHANGELOG is sufficient for v0.2.x
2. **Directory validation**: ✓ RESOLVED - Trust Cognee's internal validation; our structured logging will surface issues
3. **Ontology path validation**: ✓ RESOLVED - Keep current validation in `ingest.py`; invalid paths surface as clear errors
4. **Backward compatibility**: ✓ RESOLVED - No fallback for `OPENAI_API_KEY`; clean break aligns with Cognee 0.4.0
5. **Code snippet policy**: ✓ RESOLVED - Removed prescriptive code; replaced with high-level descriptions (WHAT/WHERE/WHY, not HOW)
6. **Testing infrastructure**: ✓ RESOLVED - Add pytest framework with mocked unit tests and manual E2E harness (Task 7); QA can validate with real API key in Task 8

## Success Criteria

- [ ] Tasks 1-6 implemented and code reviewed
- [ ] Task 7 testing infrastructure created (pytest framework, unit tests, manual harness)
- [ ] No fallback/retry code remains in bridge scripts
- [ ] All Cognee storage under workspace (`.cognee_system/`, `.cognee_data/`)
- [ ] Task 8 automated unit tests pass (8+ pytest tests)
- [ ] Task 8 manual test cases pass (6 test scenarios)
- [ ] Documentation updated (README, SETUP, CHANGELOG)
- [ ] User can successfully: Clear → Capture → Retrieve without timeouts or errors
- [ ] Error messages are explicit and actionable (no masked failures)
- [ ] Structured error logging verified in Output channel

## Next Steps

1. **Implementer**: Pick up Tasks 1-6 in order (code changes)
2. **Implementer**: Pick up Task 7 (testing infrastructure)
3. **QA**: Execute Task 8 automated unit tests
4. **QA**: Execute Task 8 manual E2E test cases
5. **After QA pass**: Update version to v0.2.1 and create release notes
6. **User validation**: Luke tests with Barcelona text in real workspace

## References

- Analysis 010: `analysis/010-v0.2.0-storage-and-retrieval-behavior-analysis.md`
- Cognee 0.4.0 API signatures:
  - add: <https://raw.githubusercontent.com/topoteretes/cognee/refs/heads/main/cognee/api/v1/add/add.py>
  - cognify: <https://raw.githubusercontent.com/topoteretes/cognee/refs/heads/main/cognee/api/v1/cognify/cognify.py>
  - config: <https://raw.githubusercontent.com/topoteretes/cognee/refs/heads/main/cognee/api/v1/config/config.py>
- Cognee Docs: <https://docs.cognee.ai/setup-configuration/llm-providers>
