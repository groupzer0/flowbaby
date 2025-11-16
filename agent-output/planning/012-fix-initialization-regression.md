# Plan 012: Fix Extension Initialization Regression

**Created**: 2025-11-15  
**Status**: Implemented - Pending QA  
**Related Epic**: 0.2.2.1 - Smooth Extension Installation  
**Related Analysis**: [012-extension-init-regression-analysis.md](../analysis/012-extension-init-regression-analysis.md)  
**Implementation Report**: [012-fix-initialization-regression-implementation.md](../implementation/012-fix-initialization-regression-implementation.md)  
**Priority**: P0 (blocks all user value - every fresh install fails)

---

## Value Statement and Business Objective

**As an extension user, I want Cognee Chat Memory to initialize successfully after installation, So that I can capture and recall workspace context without being blocked by errors or confusing messages**

This plan delivers on the Master Product Objective's "Zero Cognitive Overhead" principle by eliminating initialization friction that prevents users from experiencing automatic context capture immediately after installation.

---

## Objective

Fix the v0.2.1 initialization regression that prevents fresh installations from completing setup successfully. Users encounter ontology loading failures and outdated API key guidance, blocking access to all extension functionality. This plan resolves the root causes identified in analysis 012 and implements architectural guidance from Section 10.1 to prevent future packaging regressions.

**Success Criteria**:
- Fresh VSIX installation initializes without errors on clean workspace
- User receives clear, accurate guidance for `LLM_API_KEY` setup (no references to deprecated `OPENAI_API_KEY`)
- Ontology loads successfully from packaged `ontology.ttl` asset
- Packaging verification catches missing assets before release

---

## Assumptions

1. **Ontology Format**: `ontology.ttl` (Turtle RDF) is the canonical format moving forward; `ontology.json` is deprecated and should not be referenced.
2. **Packaging Tooling**: Current build process (`npm run package`) uses `vsce` and bundles files according to `.vscodeignore`; bridge assets must be explicitly included.
3. **RDFLib Availability**: Python dependency `rdflib` is already in `requirements.txt` and available for TTL parsing.
4. **Initialization Contract**: `init.py` is the single entry point for workspace setup; all asset loading and validation happens here.
5. **No Breaking Changes**: Solution must work with existing `.env` structure and Cognee SDK 0.4.0 without requiring user migration.

**OPEN QUESTIONS**: None blocking - all technical approaches validated in analysis 012.

---

## Plan

### Milestone 1: Align Ontology Loader with TTL Format

**Objective**: Replace hardcoded `ontology.json` reference with TTL-aware loader per architecture Section 10.1 guidance.

**Steps**:

1. **Create OntologyProvider Module** (`extension/bridge/ontology_provider.py`):
   - Implement `load_ontology()` function that:
     - Locates `ontology.ttl` using relative path resolution from bridge script location
     - Validates TTL file exists and is readable
     - Parses TTL using `rdflib.Graph().parse()` with format="turtle"
     - Performs basic validation (non-empty graph, expected namespaces present)
     - Returns parsed ontology object or raises descriptive error
   - **Optional enhancement** (can be deferred to follow-up): Add checksum verification to compute SHA256 of `ontology.ttl` and compare against expected value to detect corruption

2. **Update init.py Ontology Loading**:
   - Remove hardcoded `ontology.json` reference
   - Import and call `ontology_provider.load_ontology()`
   - Handle loading errors gracefully:
     - Emit structured JSON error: `{"success": false, "error_code": "ONTOLOGY_LOAD_FAILED", "user_message": "...", "remediation": "..."}`
     - **Note**: Error codes introduced here are provisional seeds for the comprehensive error taxonomy planned in Epic 0.2.3.1; they may be normalized or renamed when the global catalog is defined
     - Log detailed diagnostic to stderr (file path checked, parse errors, etc.)
   - Pass loaded ontology to Cognee configuration as currently expected

3. **Verify Packaging Includes ontology.ttl**:
   - Confirm `.vscodeignore` does NOT exclude `extension/bridge/ontology.ttl`
   - Manually inspect packaged VSIX to verify asset presence before milestone completion

**Acceptance Criteria**:
- `init.py` successfully loads `ontology.ttl` from packaged location
- Missing or corrupted ontology file produces clear error message with remediation steps
- No references to `ontology.json` remain in bridge code

---

### Milestone 2: Update API Key Messaging and Redaction

**Objective**: Eliminate all `OPENAI_API_KEY` references and ensure consistent `LLM_API_KEY` guidance.

**Steps**:

1. **Audit and Replace Variable References**:
   - Search codebase for `OPENAI_API_KEY` string (TypeScript and Python)
   - Replace with `LLM_API_KEY` in:
     - Error messages (init.py, ingest.py, retrieve.py)
     - User-facing notifications (extension.ts)
     - Output channel logs (CogneeClient.ts)
     - Documentation strings and comments

2. **Update Error Messaging in init.py**:
   - When `LLM_API_KEY` is missing or invalid, emit:
     - `error_code`: `MISSING_API_KEY` (provisional - will be harmonized with Epic 0.2.3.1 error taxonomy)
     - `user_message`: "LLM_API_KEY not found. Please add it to your workspace .env file."
     - `remediation`: "Create .env in workspace root with: LLM_API_KEY=your_key_here"
   - Remove any fallback checks for deprecated `OPENAI_API_KEY`

3. **Enhance Log Redaction** (extension/src/cogneeClient.ts):
   - Ensure `LLM_API_KEY` is added to redaction patterns (currently only `OPENAI_API_KEY` may be covered)
   - Verify Output channel logs mask API key values in all error scenarios

**Acceptance Criteria**:
- No user-visible references to `OPENAI_API_KEY` remain
- Missing `LLM_API_KEY` produces clear, actionable guidance
- API key values never appear in Output channel logs

---

### Milestone 3: Add Packaging Verification Automation

**Objective**: Implement automated verification per architecture Section 10.1 to catch missing assets before release.

**Steps**:

1. **Create Verification Script** (`extension/scripts/verify-vsix.js`):
   - Accept VSIX path as argument (e.g., `cognee-chat-memory-0.2.1.vsix`)
   - Unpack VSIX to temporary directory (VSIX files are ZIP archives)
   - Verify presence of required assets:
     - `extension/bridge/*.py` (init.py, ingest.py, retrieve.py, workspace_utils.py, ontology_provider.py)
     - `extension/bridge/ontology.ttl`
     - `extension/bridge/requirements.txt`
     - `package.json` with correct version
   - Perform basic integrity checks:
     - Required files exist and are non-empty (size > 0 bytes)
     - Files are readable (valid UTF-8 encoding)
     - **Implementation detail left to implementer**: Specific heuristics (entry point checks, etc.) are optional and should not block releases unless they validate critical functionality
   - Exit with code 0 (success) or 1 (failure) and log results

2. **Add NPM Script** (package.json):
   - Add `"verify:vsix": "node scripts/verify-vsix.js *.vsix"`
   - Document usage in `RELEASE_CHECKLIST.md`

3. **Integrate into CI** (if applicable):
   - Add verification step after `npm run package` in GitHub Actions workflow
   - Block release if verification fails

**Acceptance Criteria**:
- `npm run verify:vsix` detects missing `ontology.ttl` and fails
- Script provides clear diagnostic output (which files missing, expected paths)
- Release checklist references verification script

---

### Milestone 4: Regression Testing and Documentation

**Objective**: Validate fixes with clean-slate testing and update documentation for maintainability.

**Steps**:

1. **Clean Installation Test**:
   - Uninstall extension completely from test VS Code instance
   - Delete `.cognee/`, `.cognee_system/`, `.cognee_data/` directories
   - Install newly packaged VSIX
   - Verify:
     - Extension activates without errors
     - Output channel shows successful ontology load
     - Status bar indicates "Cognee Memory: Initialized"
     - Error guidance for missing `LLM_API_KEY` is correct and actionable

2. **Update Bridge Documentation** (`extension/bridge/README.md` or inline docstrings):
   - Document `ontology_provider.py` module and its usage
   - Explain ontology loading strategy (TTL parsing, relative path resolution, validation)
   - Note deprecated `ontology.json` format for future maintainers

3. **Update Release Checklist** (`RELEASE_CHECKLIST.md`):
   - Add step: "Run `npm run verify:vsix` and confirm all assets present"
   - Add step: "Test fresh installation on clean workspace (no .cognee directories)"
   - Reference this plan as rationale for new steps

**Acceptance Criteria**:
- Fresh installation test passes without errors
- Documentation clearly explains ontology loading approach
- Release checklist prevents future packaging regressions

---

## Testing Strategy

**High-Level Validation Requirements** (detailed test design and execution to be defined by QA agent):

**Critical Validation Scenarios**:

1. **Ontology Loading**:
   - QA must validate that `init.py` successfully loads `ontology.ttl` from packaged VSIX location
   - QA must validate that missing or corrupted ontology files produce clear, actionable error messages
   - QA must validate that no references to deprecated `ontology.json` remain in runtime code

2. **API Key Guidance and Redaction**:
   - QA must validate that missing `LLM_API_KEY` produces correct error messaging (not deprecated `OPENAI_API_KEY` references)
   - QA must validate that API key values are properly redacted in Output channel logs across all error scenarios
   - QA must validate that all user-facing surfaces (notifications, logs, documentation) reference `LLM_API_KEY` consistently

3. **Packaging Integrity**:
   - QA must validate that `npm run verify:vsix` detects missing critical assets (ontology.ttl, bridge scripts, requirements.txt)
   - QA must validate that packaged VSIX contains all required files for successful initialization
   - QA must validate fresh installation on clean workspace (no pre-existing .cognee directories) succeeds without errors

4. **Regression Prevention**:
   - QA must validate that existing capture and retrieval workflows continue to function after changes
   - QA must validate that initialization works correctly on workspaces with pre-existing `.cognee/` directories (migration scenario)

**Expected Coverage**:
- Unit tests for `ontology_provider.py` (new critical-path module)
- Integration tests for initialization flows (success and error paths)
- Packaging smoke tests as part of release process
- Regression tests for existing workflows

**QA Deliverable**: QA agent will create detailed test cases, execution plans, and coverage metrics in `agent-output/qa/012-fix-initialization-regression-qa.md`

---

## Validation

**Pre-Implementation Validation**:
- ✅ Analysis 012 confirms root causes (ontology mismatch, outdated messaging, no packaging verification)
- ✅ Architecture Section 10.1 provides OntologyProvider approach and packaging requirements
- ✅ Epic 0.2.2.1 acceptance criteria align with plan milestones

**Post-Implementation Validation**:
- [ ] All unit tests pass (pytest suite for bridge)
- [ ] All integration tests pass (VS Code extension tests)
- [ ] `npm run verify:vsix` succeeds on packaged VSIX
- [ ] Clean installation test succeeds (fresh workspace, no errors)
- [ ] Manual inspection confirms no `OPENAI_API_KEY` references in user-visible output
- [ ] Critic review confirms architectural alignment and completeness

**Rollback Plan**:
- If initialization fails in unexpected ways, revert to v0.2.0 VSIX (last known stable)
- Document new failure modes in analysis document for future iteration
- No data migration rollback needed (initialization failures prevent data creation)

---

## Risks

1. **RDFLib Parsing Brittleness**:
   - **Risk**: TTL format variations or encoding issues cause parse failures
   - **Mitigation**: Validate `ontology.ttl` with RDFLib during development; add format validation to packaging script
   - **Contingency**: If parse errors occur in production, emit clear error with sample valid TTL for user reference

2. **Packaging Tool Changes**:
   - **Risk**: Future `vsce` updates change file inclusion behavior, breaking asset bundling
   - **Mitigation**: Automated `verify:vsix` script catches changes immediately; pin `vsce` version in package.json
   - **Contingency**: Update `.vscodeignore` or packaging logic as needed; verification script provides diagnostic output

3. **Existing Workspace Migration**:
   - **Risk**: Users with pre-existing `.cognee/` directories encounter unexpected behavior if ontology format expectations change
   - **Mitigation**: `init.py` already handles workspace re-initialization; ontology loading is per-session
   - **Contingency**: Document migration path in CHANGELOG if issues arise; consider migration marker for ontology format version

4. **Incomplete Variable Renaming**:
   - **Risk**: Hidden `OPENAI_API_KEY` references in third-party code or configuration files
   - **Mitigation**: Comprehensive codebase search (grep) for string literal; manual review of dependencies
   - **Contingency**: User reports allow identification of missed references; patch in follow-up minor release

---

## Dependencies

**Blocking Dependencies**: None (all implementation can proceed immediately)

**Related Work**:
- Epic 0.2.2.2 (Packaging Verification) is partially addressed by Milestone 3 verification script
- Epic 0.2.3.1 (Error Taxonomy) will benefit from structured error codes introduced in Milestone 2

**Handoff**:
- **To Critic**: Review plan for architectural alignment with Section 10.1 and completeness before implementation
- **To Implementer**: Execute milestones sequentially; ontology provider must be complete before init.py changes
- **To QA**: Create test cases for scenarios in Testing Strategy section; document findings in `agent-output/qa/`

---

## References

- **Analysis**: [012-extension-init-regression-analysis.md](../analysis/012-extension-init-regression-analysis.md)
- **Epic**: Roadmap 0.2.2.1 - Smooth Extension Installation
- **Architecture**: [system-architecture.md](../architecture/system-architecture.md) Section 10.1
- **Master Product Objective**: Roadmap 🎯 Master Product Objective - "Zero Cognitive Overhead" principle

---

**Next Steps**: Hand off to critic agent for architectural review and completeness validation before implementation begins.
