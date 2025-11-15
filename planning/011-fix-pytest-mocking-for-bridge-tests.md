# Plan 011: Fix Pytest Mocking for Python Bridge Tests

## Value Statement and Business Objective

As a VS Code extension maintainer, I want all pytest unit tests passing for the Python bridge scripts, so that CI can provide fast, reliable feedback on code changes without requiring manual E2E testing for every commit.

## Objective

Fix the 11 failing pytest tests in `extension/bridge/tests/` by updating test mocking strategy to work with the bridge scripts' function-scoped `import cognee` pattern, without changing any production code behavior.

## Background

**Context from Analysis 011**:
- Plan 010 Task 7 created pytest testing infrastructure for `init.py` and `ingest.py`.
- Test execution shows: **2 PASSED, 11 FAILED** (most recent run collected 13 tests total).
- Root cause: Tests attempt `patch('init.cognee', ...)` and `patch('ingest.cognee', ...)`, but these attributes don't exist because `import cognee` happens *inside* functions, not at module level.
- CLI tests fail because patching `sys.exit` prevents process termination, causing control flow to continue through multiple validation branches.

**Current failure patterns**:
- **Majority of tests**: `AttributeError: <module 'init/ingest'> does not have the attribute 'cognee'`
- **CLI tests**: `IndexError` or `AssertionError` from strict `sys.exit` call-count assertions

**Why not change production code**:
- Moving `import cognee` to module level changes error handling surface area (import errors at module load vs function execution).
- Current pattern is intentional: imports after environment configuration, with narrow try/except.
- Plan 010 explicitly avoids prescriptive code changes; implementer chose function-scoped imports for good reasons.

## Plan

### Task 1: Update Cognee Mocking to Use `sys.modules`

**Owner**: Implementer  
**Files**: 
- `extension/bridge/tests/test_init.py`
- `extension/bridge/tests/test_ingest.py`

**Objective**: Replace failing `patch('init.cognee', mock_cognee)` and `patch('ingest.cognee', mock_cognee)` patterns with `sys.modules['cognee']` injection before importing test functions.

**What**: Modify all tests that require mocked Cognee APIs to install a mock module into `sys.modules['cognee']` before importing `initialize_cognee` or `ingest_conversation`.

**Where**: 
- `test_init.py`: Tests that currently use `with patch('init.cognee', mock_cognee):`
  - `test_initialize_workspace_storage_directories`
  - `test_initialize_success_with_llm_api_key`
  - `test_initialize_ontology_validation`
  - (Additional tests may exist as test suite evolves)
- `test_ingest.py`: Tests that currently use `with patch('ingest.cognee', mock_cognee):`
  - `test_ingest_add_with_correct_parameters`
  - `test_ingest_cognify_with_datasets_parameter`
  - `test_ingest_structured_error_logging`
  - `test_ingest_success_returns_metadata`
  - (Additional tests may exist as test suite evolves)

**Why**: When `import cognee` runs inside bridge functions, Python checks `sys.modules['cognee']` first. By pre-populating this with a mock module containing the necessary attributes (`config`, `add`, `cognify`, `prune`), tests can intercept and verify calls without altering production code.

**Scope Note**: This task applies only to existing tests in `test_init.py` and `test_ingest.py` that mock Cognee APIs. Adding new tests (e.g., for `retrieve.py`) is out of scope for Plan 011.

**Implementation approach**:

For each affected test function:

1. **Build mock module from conftest fixture**:
   ```python
   import types
   
   mock_cognee_module = types.SimpleNamespace(
       config=mock_cognee.config,
       add=getattr(mock_cognee, 'add', None),
       cognify=getattr(mock_cognee, 'cognify', None),
       prune=getattr(mock_cognee, 'prune', None),
   )
   ```

2. **Install into sys.modules before import**:
   ```python
   sys.modules['cognee'] = mock_cognee_module
   ```

3. **Import test function as normal**:
   ```python
   from init import initialize_cognee
   # or
   from ingest import ingest_conversation
   ```

4. **Clean up sys.modules after test**:
   ```python
   # At end of test or in fixture teardown
   if 'cognee' in sys.modules:
       del sys.modules['cognee']
   ```

**Recommended: Centralized cleanup fixture**:

To reduce repetition and ensure consistent cleanup, consider adding a reusable fixture in `conftest.py`:

```python
@pytest.fixture
def mock_cognee_module(mock_cognee):
    """Install mock Cognee module into sys.modules for test, clean up after."""
    import types
    mock_module = types.SimpleNamespace(
        config=mock_cognee.config,
        add=getattr(mock_cognee, 'add', None),
        cognify=getattr(mock_cognee, 'cognify', None),
        prune=getattr(mock_cognee, 'prune', None),
    )
    sys.modules['cognee'] = mock_module
    yield mock_cognee  # Return original fixture for assertions
    if 'cognee' in sys.modules:
        del sys.modules['cognee']
```

Tests can then use `mock_cognee_module` fixture instead of manual setup/teardown. This pattern:
- Centralizes sys.modules handling in one place
- Ensures cleanup happens even if test fails
- Reduces risk of cross-test contamination
- Makes tests more maintainable

**Special considerations**:

- **test_ingest.py tests**: Already patch `ingest.Path` and `ingest.Graph` (RDFLib). Keep those patches; add `sys.modules['cognee']` injection alongside them.
- **test_init.py complex mocking**: `test_initialize_success_with_llm_api_key` heavily mocks `Path` class. Keep existing Path mocking; add `sys.modules['cognee']` at start of test.
- **Fixture reuse**: `mock_cognee` fixture from `conftest.py` remains unchanged; it already provides the necessary mock attributes.

**Acceptance criteria**:
- All tests with `AttributeError` failures now pass
- No changes to `init.py`, `ingest.py`, or other production bridge scripts
- Mock assertions (e.g., `mock_cognee.config.system_root_directory.assert_called_once_with(...)`) still work correctly
- Tests remain isolated (no cross-test contamination from stale `sys.modules` entries)
- If centralized fixture added, all affected tests use it consistently

---

### Task 2: Relax CLI Test Assertions for `sys.exit` Behavior

**Owner**: Implementer  
**Files**:
- `extension/bridge/tests/test_init.py`
- `extension/bridge/tests/test_ingest.py`

**Objective**: Update CLI tests (`test_main_*` functions) to assert on observable outputs (JSON error payloads) rather than strict `sys.exit` call counts.

**What**: Replace `mock_exit.assert_called_once_with(1)` with `mock_exit.assert_any_call(1)` and add assertions on captured stdout JSON error messages.

**Where**:
- `test_init.py`: CLI tests (e.g., `test_main_*` functions)
  - `test_main_missing_workspace_argument`
  - `test_main_invalid_workspace_path`
  - (Additional CLI tests may exist)
- `test_ingest.py`: CLI tests (e.g., `test_main_*` functions)
  - `test_main_missing_arguments`
  - `test_main_invalid_importance_value`
  - (Additional CLI tests may exist)

**Why**: When `sys.exit` is patched, execution continues past the first validation failure, potentially triggering additional `sys.exit` calls. Real users never see this behavior (process terminates on first `sys.exit`), so strict call-count assertions are testing an artifact of mocking, not actual behavior.

**Implementation approach**:

For each CLI test:

1. **Keep existing test structure**:
   ```python
   with patch('sys.argv', [...]):
       with patch('sys.exit') as mock_exit:
           from init import main  # or from ingest import main
           main()
   ```

2. **Replace strict assertion**:
   ```python
   # OLD:
   mock_exit.assert_called_once_with(1)
   
   # NEW:
   mock_exit.assert_any_call(1)
   ```

3. **Add JSON payload assertion**:
   ```python
   captured = capsys.readouterr()
   output = json.loads(captured.out)
   
   assert output['success'] is False
   assert 'Missing required argument' in output['error']  # or appropriate message
   ```

**Specific updates per test**:

- **test_main_missing_workspace_argument**: Assert error contains "Missing required argument: workspace_path"
- **test_main_invalid_workspace_path**: Assert error contains "Workspace path does not exist"
- **test_main_missing_arguments**: Assert error contains "Missing required arguments: workspace_path, user_message, assistant_message"
- **test_main_invalid_importance_value**: Assert error contains "Invalid importance value" and "(must be float 0-1)"

**Acceptance criteria**:
- All CLI tests in both files pass
- Tests verify user-facing behavior (JSON error format and content)
- Tests no longer fail on `AssertionError` about call counts or `IndexError` from continued execution
- No changes to `main()` functions in production code

---

### Task 3: Verify Test Isolation and Run Full Suite

**Owner**: Implementer  
**Files**: N/A (implementer validation task)

**Objective**: Ensure all existing bridge tests pass and are properly isolated from each other.

**What**: Run `pytest tests/ -v` and verify no test failures, no warnings about stale `sys.modules` entries, and consistent results across multiple runs.

**Where**: Execute from `extension/bridge/` directory.

**Why**: sys.modules manipulation can cause cross-test contamination if not cleaned up properly. Multiple runs verify tests are deterministic.

**Note on scope**: This task is implementer-side validation to confirm test fixes work correctly. Broader QA validation (manual E2E testing, real API integration) remains under Plan 010 Task 8 and is the responsibility of the qa agent.

**Test execution commands**:

```bash
cd extension/bridge
pytest tests/ -v
pytest tests/ -v  # Run again to verify determinism
pytest tests/test_init.py -v  # Verify init tests in isolation
pytest tests/test_ingest.py -v  # Verify ingest tests in isolation
```

**Expected results**:
- **All existing tests pass**: Both test_init.py and test_ingest.py tests green (specific count may vary as test suite evolves)
- **0 failures**: No AttributeError, IndexError, or AssertionError
- **Consistent across runs**: Same results when run multiple times

**Validation checklist**:
- [ ] `test_ingest_missing_llm_api_key` still passes (already working, no Cognee mocking)
- [ ] `test_initialize_missing_llm_api_key` still passes (already working, no Cognee mocking)
- [ ] All previously-failing Cognee mock tests now pass
- [ ] All CLI tests now pass
- [ ] No warnings about import errors or missing modules
- [ ] Tests can run in any order (pytest randomization safe)

**Acceptance criteria**:
- `pytest tests/ -v` shows all tests passing with 0 failures
- No test failures, errors, or warnings
- Multiple consecutive runs produce identical results
- Ready for CI integration via `npm run test:bridge`

**Clarification**: This validation confirms the test fixes work correctly. It is NOT a replacement for Plan 010 Task 8 QA validation, which includes manual E2E testing with real Cognee APIs and is documented by the qa agent in `qa/` directory.

---

## Dependencies

- **Plan 010 Task 7**: Created initial pytest infrastructure (requirements.txt, pytest.ini, conftest.py, test files)
- **Analysis 011**: Identified root causes and recommended sys.modules mocking approach
- **Python 3.12**: venv with pytest, pytest-asyncio, pytest-mock installed
- **Existing mock fixtures**: `conftest.py` provides `mock_cognee`, `temp_workspace`, `mock_env` fixtures

## Risks and Mitigation

### Risk 1: sys.modules cleanup issues cause cross-test contamination
**Impact**: Tests pass individually but fail when run together, or results vary between runs  
**Mitigation**:
- Use centralized `mock_cognee_module` fixture in conftest.py (recommended in Task 1) to ensure consistent cleanup
- If per-test cleanup used, add explicit cleanup in test teardown or fixture finalizers
- Run full suite multiple times during Task 3 validation to verify determinism
- The centralized fixture pattern significantly reduces this risk by enforcing cleanup automatically

### Risk 2: Mock module structure incomplete for edge cases
**Impact**: Tests pass but don't catch real issues because mock doesn't match Cognee API surface  
**Mitigation**:
- Keep mock structure minimal (only config, add, cognify, prune as needed per test)
- Task 8 manual E2E tests still validate against real Cognee API
- Mock assertions verify correct parameters passed, which is the main concern for unit tests

### Risk 3: Future bridge code changes break mocking assumptions
**Impact**: If bridge scripts move imports to module level later, tests will need updates  
**Mitigation**:
- Document mocking pattern in test docstrings
- Any future refactor to module-level imports is a deliberate change that would update tests accordingly
- Analysis 011 already documents simpler mocking pattern for that scenario

## Testing Strategy

**Scope**: Verify test fixes without changing production behavior (implementer validation)

**Validation approach**:
1. **Unit test coverage** (Task 3): All existing pytest tests passing
2. **No production changes**: Confirm init.py and ingest.py unchanged by Task 1 and Task 2
3. **Mock assertions still work**: Verify tests still catch parameter mismatches (e.g., wrong kwarg names)
4. **Deterministic results**: Run suite 3+ times to confirm no flakiness

**Out of scope**:
- Adding new tests for retrieve.py or other bridge scripts (future enhancement)
- Adding new test cases beyond fixing existing failures (Plan 010 Task 7 already completed test creation)
- Manual E2E validation with real Cognee APIs (covered by Plan 010 Task 8, owned by qa agent)
- QA process definition and test planning (exclusive domain of qa agent, documented in `qa/` directory)

**Role clarification**: Task 3 validation is implementer-side verification that test fixes work correctly. Comprehensive QA validation remains the responsibility of the qa agent under Plan 010 Task 8, which includes manual testing, real API integration checks, and broader system validation.

## Success Criteria

- [ ] Task 1 complete: All Cognee mocking tests updated and passing
- [ ] Task 2 complete: All CLI tests updated and passing
- [ ] Task 3 complete: Full suite runs clean (all existing tests passing, 0 failures)
- [ ] No production code changes to init.py, ingest.py, or production fixtures
- [ ] Tests documented with comments explaining sys.modules pattern
- [ ] If centralized fixture added to conftest.py, it's properly implemented with setup/teardown
- [ ] Ready for CI: `npm run test:bridge` works and can be added to CI pipeline
- [ ] Implementation report updated to note test fixes complete, enabling Plan 010 Task 8 QA validation

## Next Steps

1. **Implementer**: Execute Tasks 1-3 sequentially
2. **After all tests passing**: Update Plan 010 implementation doc to note test fixes complete
3. **QA**: Proceed with Plan 010 Task 8 manual E2E validation
4. **After QA pass**: Consider adding `npm run test:bridge` to CI as pre-commit or pre-push hook

## References

- **Analysis 011**: `analysis/011-python-bridge-testing-infrastructure-analysis.md` (mocking recommendations)
- **Plan 010**: `planning/010-fix-ingestion-failures-and-workspace-storage.md` (parent plan, Tasks 1-8)
- **Test files**: `extension/bridge/tests/test_init.py`, `extension/bridge/tests/test_ingest.py`
- **Python unittest.mock docs**: <https://docs.python.org/3/library/unittest.mock.html>
- **pytest sys.modules patterns**: <https://docs.pytest.org/en/stable/how-to/monkeypatch.html>
