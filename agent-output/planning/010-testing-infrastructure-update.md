# Plan 010 Update: Testing Infrastructure

**Date**: 2025-11-14  
**Reason**: QA identified missing testing infrastructure blocking validation of Tasks 1-6

## Summary

Updated Plan 010 to address inadequate testing infrastructure identified during QA validation. Added comprehensive testing framework requirements and new Task 7 for setting up pytest-based Python bridge tests.

## Changes Made

### 1. Expanded Testing Strategy Section

Added detailed "Testing Infrastructure Requirements" subsection covering:

- **Test Frameworks**: Mocha/Chai (existing) + pytest (new)
- **Testing Libraries**: Added pytest, pytest-asyncio, pytest-mock requirements
- **Configuration Files**: pytest.ini, conftest.py, test file structure
- **Environment Requirements**: .env.test with test credentials
- **Dependencies**: Installation commands for npm and pip packages
- **Build Tooling**: New npm scripts for running Python tests

### 2. Added Task 7: Set up Python Bridge Testing Infrastructure

**New task added between original Tasks 6 and 7 (now renumbered to Task 8)**

**Owner**: Implementer  
**Objective**: Create pytest-based testing infrastructure for Python bridge scripts

**Key deliverables**:
- Add pytest dependencies to `requirements.txt`
- Create `extension/bridge/pytest.ini` configuration
- Create `extension/bridge/tests/` directory with:
  - `__init__.py` (marker file)
  - `conftest.py` (fixtures for mocking Cognee APIs)
  - `test_init.py` (unit tests for initialization logic)
  - `test_ingest.py` (unit tests for ingestion logic)
- Create `extension/bridge/manual_test.py` CLI harness for E2E testing
- Add `npm run test:bridge` and `npm run test:all` scripts

**Acceptance criteria**: 8+ unit tests covering Tasks 2, 4, 5 validation logic, all using mocks to avoid real API calls

### 3. Renumbered and Enhanced Task 8 (formerly Task 7)

**Original**: "Test end-to-end ingestion flow"  
**Updated**: "Execute end-to-end ingestion validation"

**Key changes**:
- Added prerequisite: Task 7 testing infrastructure must be completed first
- Split test execution into two phases:
  1. **Automated Unit Tests**: Run pytest suite from Task 7
  2. **Manual E2E Tests**: Execute 6 test scenarios with real API
- Added Test Case 6: Structured error logging verification
- Updated acceptance criteria to include pytest unit test pass requirement

### 4. Added Risk 4: Testing infrastructure complexity

Documented risk of adding pytest framework and mitigation strategies:
- Keep tests simple with clear fixtures
- Document test execution
- pytest is standard Python tool
- Tests prevent regressions and provide usage examples
- Can skip automated tests if preferred (manual E2E still validates)

### 5. Updated Success Criteria

Added new success criteria items:
- [ ] Task 7 testing infrastructure created (pytest framework, unit tests, manual harness)
- [ ] Task 8 automated unit tests pass (8+ pytest tests)
- [ ] Structured error logging verified in Output channel

### 6. Updated Next Steps

Added implementation step 2:
- **Implementer**: Pick up Task 7 (testing infrastructure)

Updated QA steps:
- **QA**: Execute Task 8 automated unit tests
- **QA**: Execute Task 8 manual E2E test cases

### 7. Added Resolved Question 6

**Testing infrastructure**: ✓ RESOLVED - Add pytest framework with mocked unit tests and manual E2E harness (Task 7); QA can validate with real API key in Task 8

## Rationale

**Problem identified by QA**:
- Zero test coverage for Python bridge scripts modified in Tasks 1-6
- QA blocked: cannot validate workspace storage, LLM_API_KEY enforcement, or error logging without testing infrastructure
- Existing TypeScript tests only cover extension surface, not Python bridge logic
- No automated way to validate core acceptance criteria

**Solution**:
- Add pytest framework for Python unit testing with mocked Cognee APIs
- Create manual test harness for E2E validation with real API
- Separate automated unit tests (fast, no API key) from manual E2E tests (requires API key)
- Provide clear test structure and fixtures for future test additions

## Impact on Plan Timeline

**Original plan**: 7 tasks (Tasks 1-6 implementation, Task 7 QA)  
**Updated plan**: 8 tasks (Tasks 1-6 implementation, Task 7 testing setup, Task 8 QA)

**Effort estimate for new Task 7**: 2-4 hours
- pytest configuration: 30 minutes
- Fixture setup (conftest.py): 1 hour
- Unit test creation (8+ tests): 1-2 hours
- Manual test harness: 30 minutes

**Total plan increase**: ~3 hours average

## Next Actions

1. **Critic**: Review updated plan for completeness and architectural alignment
2. **Implementer**: Execute Task 7 to create testing infrastructure
3. **QA**: Execute Task 8 with new automated and manual testing capabilities
4. **After QA pass**: Proceed to version bump and release

## Files Modified

- `planning/010-fix-ingestion-failures-and-workspace-storage.md` (expanded Testing Strategy, added Task 7, renumbered Task 8, added Risk 4, updated Success Criteria and Next Steps)

## Files to Create (by Implementer in Task 7)

- `extension/bridge/requirements.txt` (add pytest dependencies)
- `extension/bridge/pytest.ini`
- `extension/bridge/tests/__init__.py`
- `extension/bridge/tests/conftest.py`
- `extension/bridge/tests/test_init.py`
- `extension/bridge/tests/test_ingest.py`
- `extension/bridge/manual_test.py`
- `extension/package.json` (add test:bridge and test:all scripts)

## References

- QA Report: `qa/010-fix-ingestion-failures-and-workspace-storage-qa.md`
- Original Plan: `planning/010-fix-ingestion-failures-and-workspace-storage.md` (now updated)
