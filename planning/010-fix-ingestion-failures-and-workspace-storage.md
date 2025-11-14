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

**Implementation steps**:

1. After setting LLM API key and provider (around line 50-55), add:

```python
# Configure workspace-local storage (eliminates site-packages defaults)
cognee.config.system_root_directory(str(Path(workspace_path) / '.cognee_system'))
cognee.config.data_root_directory(str(Path(workspace_path) / '.cognee_data'))
```

2. Keep existing `.cognee/` directory creation for local markers unchanged.

**Acceptance criteria**:
- `init.py` calls both `system_root_directory` and `data_root_directory` with workspace paths
- Successful initialization creates `.cognee_system/` and `.cognee_data/` under workspace root
- No files written to venv site-packages during ingestion

**Question**: Should we add validation that these directories were successfully created, or rely on Cognee's internal directory creation?

---

### Task 2: Require LLM_API_KEY without fallback in init.py

**Owner**: Implementer  
**Files**: `extension/bridge/init.py`

**Objective**: Validate `LLM_API_KEY` is set and fail fast with clear error message. Remove fallback to `OPENAI_API_KEY` to enforce explicit configuration.

**Implementation steps**:

1. Replace the current API key check (around line 45-50):

```python
# OLD:
api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    return {
        'success': False,
        'error': 'OPENAI_API_KEY not found in environment or .env file'
    }

# NEW:
api_key = os.getenv('LLM_API_KEY')
if not api_key:
    return {
        'success': False,
        'error': 'LLM_API_KEY not found in environment or .env file. Set LLM_API_KEY="sk-..." in your workspace .env'
    }
```

2. Keep the existing `cognee.config.set_llm_api_key(api_key)` and `set_llm_provider('openai')` calls.

**Acceptance criteria**:
- `init.py` reads only `LLM_API_KEY` (no `OPENAI_API_KEY` fallback)
- Missing key returns explicit error message referencing `.env` configuration
- Successful init with `LLM_API_KEY` present works as before

**Concern**: This is a breaking change for users who currently have only `OPENAI_API_KEY` in their `.env`. Should we:
- **Option A** (recommended): Document in CHANGELOG that users must rename/add `LLM_API_KEY` in their `.env`
- **Option B**: Add a one-time migration that reads `OPENAI_API_KEY`, logs a deprecation warning, and writes `LLM_API_KEY` to `.env`

**Recommendation**: Use Option A for clarity; breaking change is acceptable given v0.2.0 is early and aligns with upstream Cognee 0.4.0 conventions.

---

### Task 3: Remove fallback parameter retries in ingest.py

**Owner**: Implementer  
**Files**: `extension/bridge/ingest.py`

**Objective**: Eliminate try-except TypeError blocks that retry with alternate parameter names. Use correct Cognee 0.4.0 signatures directly and let mismatches surface as clear errors.

**Implementation steps**:

1. **Fix add() call** (around line 95-110):

```python
# OLD: Tries datasets=, then dataset_name=, then dataset=
try:
    await cognee.add(
        data=[conversation],
        datasets=[dataset_name]
    )
except TypeError as e:
    # retry with dataset_name...
    # retry with dataset...

# NEW: Use correct signature directly
await cognee.add(
    data=[conversation],
    dataset_name=dataset_name
)
```

2. **Fix cognify() call** (around line 115-135):

```python
# OLD: Tries with ontology_file_path kwarg, catches TypeError, retries without
cognify_kwargs = {'datasets': [dataset_name]}
if ontology_valid:
    cognify_kwargs['ontology_file_path'] = str(ontology_path)

try:
    await cognee.cognify(**cognify_kwargs)
except TypeError as e:
    if 'ontology_file_path' in str(e):
        # retry without ontology_file_path...

# NEW: Use datasets only; ontology via environment
await cognee.cognify(datasets=[dataset_name])
```

3. Remove all try-except TypeError blocks added for parameter fallbacks.

4. Keep ontology validation logic but only use it to log whether ontology is available; don't pass to cognify().

**Acceptance criteria**:
- `add()` called with `data=` and `dataset_name=` only
- `cognify()` called with `datasets=` only
- No try-except TypeError blocks for parameter retries
- TypeError from signature mismatch surfaces immediately with stack trace in Output Channel

**Note**: Ontology configuration will be handled via `.env` (user sets `ontology_file_path=/absolute/path/to/ontology.ttl`). Cognee 0.4.0 reads this via `OntologyEnvConfig`.

---

### Task 4: Require LLM_API_KEY without fallback in ingest.py

**Owner**: Implementer  
**Files**: `extension/bridge/ingest.py`

**Objective**: Match init.py's environment validation; fail fast if `LLM_API_KEY` missing.

**Implementation steps**:

1. Replace API key check (around line 35-40):

```python
# OLD:
api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    return {
        'success': False,
        'error': 'OPENAI_API_KEY not found in environment or .env file'
    }

# NEW:
api_key = os.getenv('LLM_API_KEY')
if not api_key:
    return {
        'success': False,
        'error': 'LLM_API_KEY not found in environment or .env file. Set LLM_API_KEY="sk-..." in your workspace .env'
    }
```

**Acceptance criteria**:
- `ingest.py` reads only `LLM_API_KEY`
- Missing key returns explicit error message
- Consistent behavior with `init.py`

---

### Task 5: Update error logging to include parameters used

**Owner**: Implementer  
**Files**: `extension/bridge/ingest.py`

**Objective**: When ingestion fails, log the exception class, message, and exact parameters passed to `add()` and `cognify()` for field triage.

**Implementation steps**:

1. Update the main exception handler (around line 150-160):

```python
# OLD:
except Exception as e:
    return {
        'success': False,
        'error': f'Ingestion failed: {str(e)}'
    }

# NEW:
except Exception as e:
    error_details = {
        'exception_type': type(e).__name__,
        'exception_message': str(e),
        'dataset_name': dataset_name,
        'conversation_length': len(conversation),
        'ontology_validated': ontology_valid
    }
    print(f"Ingestion error details: {json.dumps(error_details, indent=2)}", file=sys.stderr)
    return {
        'success': False,
        'error': f'Ingestion failed ({type(e).__name__}): {str(e)}'
    }
```

2. Ensure this exception handler is outside any removed try-except blocks from Task 3.

**Acceptance criteria**:
- Exception includes type name (e.g., `TypeError`, `FileNotFoundError`)
- stderr log includes structured error details with parameters
- Output Channel shows both user-facing error and detailed stderr

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

### Task 7: Test end-to-end ingestion flow

**Owner**: QA  
**Files**: N/A (manual testing)

**Objective**: Verify that Clear → Capture → Retrieve works without timeouts or file-not-found errors after implementing Tasks 1-6.

**Test steps**:

1. **Setup**:
   - Fresh workspace with `.env` containing `LLM_API_KEY=sk-...`
   - No `.cognee`, `.cognee_system`, or `.cognee_data` directories present initially

2. **Test Case 1: Clean slate ingestion**:
   - Start VS Code Extension Development Host
   - Open Output → Cognee Memory
   - Run "Cognee: Clear Workspace Memory"
   - Expected: Success; `.cognee_system/` and `.cognee_data/` created under workspace

3. **Test Case 2: Capture text**:
   - Run "Cognee: Capture to Cognee Memory"
   - Input: "Barcelona has a rich cultural heritage and is today an important cultural centre and a major tourist destination."
   - Expected: 
     - Output shows `Conversation ingested { chars: 111, timestamp: ... }`
     - No 30s timeout
     - No "File not found" errors
     - `.cognee_data/` directory grows in size

4. **Test Case 3: Retrieve text**:
   - In Chat, query `@cognee-memory what do you know about Barcelona?`
   - Expected:
     - Output shows `Context retrieved { result_count: >=1, duration: <5000 }`
     - Chat response includes snippet about Barcelona's cultural heritage
     - Retrieval latency <5s after warm-up

5. **Test Case 4: Missing LLM_API_KEY**:
   - Remove `LLM_API_KEY` from `.env`
   - Reload window
   - Attempt capture
   - Expected: Clear error message in Output: "LLM_API_KEY not found in environment or .env file. Set LLM_API_KEY=... in your workspace .env"

6. **Test Case 5: Verify no site-packages usage**:
   - After successful capture, check:
     ```bash
     ls -la .venv/lib/python3.12/site-packages/cognee/.data_storage/
     ```
   - Expected: Directory should not exist or be empty (all storage under workspace `.cognee_data/`)

**Acceptance criteria**:
- All test cases pass
- No timeouts during ingestion
- No file-not-found errors in site-packages paths
- Retrieval returns captured content
- Error messages are clear and actionable

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

## Open Questions

1. **Environment variable migration**: Should we provide a migration script or one-time warning for users with `OPENAI_API_KEY`?
   - **Recommendation**: No migration; breaking change documented in CHANGELOG is sufficient for v0.2.x

2. **Directory validation**: Should `init.py` verify that `system_root_directory` and `data_root_directory` calls succeeded?
   - **Recommendation**: Trust Cognee's internal validation; our structured logging will surface issues

3. **Ontology path validation**: Should we validate `ontology_file_path` from `.env` is accessible before passing to Cognee?
   - **Recommendation**: Current approach (validate in `ingest.py` before use) is sufficient; invalid paths surface as clear errors

4. **Backward compatibility**: Should we maintain any fallback behavior for `OPENAI_API_KEY`?
   - **Recommendation**: No; clean break aligns with Cognee 0.4.0 and removes ambiguity

## Success Criteria

- [ ] Tasks 1-6 implemented and code reviewed
- [ ] No fallback/retry code remains in bridge scripts
- [ ] All Cognee storage under workspace (`.cognee_system/`, `.cognee_data/`)
- [ ] Test Case 1-5 pass in QA validation
- [ ] Documentation updated (README, SETUP, CHANGELOG)
- [ ] User can successfully: Clear → Capture → Retrieve without timeouts or errors
- [ ] Error messages are explicit and actionable (no masked failures)

## Next Steps

1. **Implementer**: Pick up Tasks 1-6 in order
2. **After implementation**: QA executes Task 7 test cases
3. **After QA pass**: Update version to v0.2.1 and create release notes
4. **User validation**: Luke tests with Barcelona text in real workspace

## References

- Analysis 010: `analysis/010-v0.2.0-storage-and-retrieval-behavior-analysis.md`
- Cognee 0.4.0 API signatures:
  - add: <https://raw.githubusercontent.com/topoteretes/cognee/refs/heads/main/cognee/api/v1/add/add.py>
  - cognify: <https://raw.githubusercontent.com/topoteretes/cognee/refs/heads/main/cognee/api/v1/cognify/cognify.py>
  - config: <https://raw.githubusercontent.com/topoteretes/cognee/refs/heads/main/cognee/api/v1/config/config.py>
- Cognee Docs: <https://docs.cognee.ai/setup-configuration/llm-providers>
