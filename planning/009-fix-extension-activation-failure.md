# Plan 009: Fix Extension Activation Failure

**Plan ID**: 009  
**Created**: November 13, 2025  
**Related Analysis**: 009 (Extension Activation Failure Diagnosis)  
**Related Implementation**: 008 (Chat Participant Memory Integration)  
**Priority**: CRITICAL BLOCKER  
**Status**: READY FOR IMPLEMENTATION

---

## Value Statement and Business Objective

**As a VS Code extension developer, I want to fix the extension activation failure so that the Cognee Memory extension loads properly in the Extension Development Host, enabling manual testing, validation, and v0.2.0 release preparation.**

This plan delivers core value by:
- **Unblocking Testing**: Restoring extension activation enables manual validation of all implementation 008 features
- **Enabling Release**: Resolving activation is the critical blocker preventing v0.2.0 release
- **Developer Experience**: Proper debug configuration enables efficient development workflow
- **Build Visibility**: Exposing compilation errors prevents silent build failures

**CRITICAL**: This plan addresses the immediate blocker preventing any manual testing. Without these fixes, implementation 008 cannot be validated or released.

---

## Objective

Fix the critical extension activation failure by creating missing debug configuration (`.vscode/launch.json`) and enabling build error visibility (`esbuild.js` logging), allowing the extension to load in Extension Development Host for testing and validation.

---

## Assumptions

1. Implementation 008 source code is correct (QA and UAT validated)
2. Extension compiles successfully (`npm run compile` exits 0)
3. `dist/extension.js` exists and contains valid bundled code
4. VS Code version meets minimum requirement (^1.105.0)
5. Root cause is development environment configuration, not code defects

**OPEN QUESTION**: Are there hidden compilation errors masked by silent logging?  
**Resolution**: Enabling `logLevel: 'info'` will reveal any build issues

---

## Plan

### Phase 1: Environment Configuration Fixes (CRITICAL)

**Objective**: Create missing debug configuration and enable build visibility.

---

#### Task 1.1: Create VS Code Debug Configuration

**File**: `/home/luke/Documents/Github-projects/cognee/extension/.vscode/launch.json`

**Action**: Create VS Code launch configuration to enable F5 debugging with Extension Development Host.

**Location**: `extension/.vscode/launch.json` (directory will be created automatically)

**Requirements**:

The launch configuration must:
- Set `type: "extensionHost"` to launch Extension Development Host
- Pass `--extensionDevelopmentPath=${workspaceFolder}` argument (CRITICAL for extension loading)
- Configure `outFiles` pattern for TypeScript source map debugging
- Include `preLaunchTask` to auto-compile before launch
- Support both manual testing ("Run Extension") and automated tests ("Extension Tests")

**For test configuration**:
- Use `--extensionTestsPath=${workspaceFolder}/out/test/index.js` (matches `src/test/runTest.ts`)
- Set `preLaunchTask: "npm: compile:tests"`

**Reference**: See `analysis/009-extension-activation-failure-analysis.md` for complete example configuration.

**IMPORTANT - Workspace Context**: 
Open the `extension/` folder in VS Code before pressing F5. If the repository root is opened instead, `${workspaceFolder}` won't resolve correctly and the extension won't load.

**Why This Matters**:
- `--extensionDevelopmentPath` argument is CRITICAL for Extension Host to locate extension
- Without this configuration, pressing F5 launches generic debug session with no extension loaded
- Proper `outFiles` enables TypeScript debugging with source maps
- `preLaunchTask` ensures code is compiled before launching

**Expected Result**:
- F5 launches Extension Development Host with extension loaded
- Debug Console shows activation logs
- Extension commands and participant register

**Verification**:
```bash
# File should exist after creation
ls -la /home/luke/Documents/Github-projects/cognee/extension/.vscode/launch.json
```

---

#### Task 1.2: Enable Build Error Logging (Permanent Change)

**File**: `/home/luke/Documents/Github-projects/cognee/extension/esbuild.js`

**Action**: Change `logLevel` from `'silent'` to `'info'` (line 18) to permanently expose compilation errors and build progress.

**Requirements**:
- Locate `logLevel: 'silent',` in the esbuild context configuration
- Replace with `logLevel: 'info',`
- This is a permanent change to improve developer experience

**Why This Matters**:
- Silent logging hides ALL compilation errors from developers
- Build failures may produce corrupted `dist/extension.js` with zero visibility
- Info-level logging exposes errors while maintaining clean output
- Complements existing esbuild plugin that logs start/finish messages

**Note**: The existing esbuild plugin already prints `[watch] build started` and `[watch] build finished`. The `logLevel: 'info'` change primarily exposes **errors and warnings** during compilation, not progress messages.

**Expected Terminal Output** (after change):

```text
> cognee-chat-memory@0.1.0 compile
> node esbuild.js --production

[watch] build started
dist/extension.js  85.2kB

[watch] build finished
```

If compilation errors exist, they will now appear between start and finish messages.

**Verification**:

```bash
cd /home/luke/Documents/Github-projects/cognee/extension
npm run compile
# Should see build size and "build finished" message
# Any errors will now be visible
```

---

### Phase 2: Verification and Testing

**Objective**: Confirm activation fixes work and extension loads properly.

---

#### Task 2.1: Verify Compiled Output Integrity

**Action**: Confirm `dist/extension.js` exists and is valid.

**Commands**:
```bash
cd /home/luke/Documents/Github-projects/cognee/extension
ls -lh dist/extension.js dist/extension.js.map
```

**Expected Output**:
```
-rw-r--r-- 1 luke luke  85K Nov 13 extension.js
-rw-r--r-- 1 luke luke 120K Nov 13 extension.js.map
```

**Success Criteria**:
- `extension.js` exists and is >50KB (bundled with dependencies)
- `extension.js.map` exists (enables debugging)
- File timestamps are recent (not stale from old build)

**If Files Missing**: Run `npm run compile` and investigate errors (now visible with info logging).

---

#### Task 2.2: Test Extension Activation

**Action**: Launch Extension Development Host and verify activation.

**Steps**:
1. Close all Extension Development Host windows
2. In VS Code (extension workspace), press **F5**
3. New window opens (Extension Development Host)
4. Press **Ctrl+Shift+Y** to open Debug Console
5. Look for activation message

**Expected Console Output**:
```
Cognee Chat Memory extension activated
Cognee client initialized successfully
=== MILESTONE 2: Registering @cognee-memory Chat Participant ===
✅ @cognee-memory participant registered successfully
```

**Success Criteria**:
- Extension Development Host window opens
- Debug Console shows activation logs (not empty)
- No error messages in console

**If Activation Fails**:
- Check Help → Toggle Developer Tools → Console for Extension Host errors
- Verify launch.json was created correctly
- Check `dist/extension.js` exists and is valid
- Review compile output for errors

---

#### Task 2.3: Test Keyboard Shortcut

**Action**: Verify Ctrl+Alt+C keyboard shortcut works.

**Steps** (in Extension Development Host):
1. Open any file or view
2. Press **Ctrl+Alt+C** (or Cmd+Alt+C on Mac)
3. Input box should appear

**Expected Behavior**:
- Input box appears with prompt: "Enter text to capture to Cognee Memory..."
- Typing text and pressing Enter captures to memory
- Output Channel shows ingest logs

**Success Criteria**:
- Keyboard shortcut triggers command
- Input box appears
- Command executes without errors

**If Shortcut Doesn't Work**:
- Check Debug Console for command registration errors
- Verify activation completed successfully (Task 2.2)
- Check Command Palette (Ctrl+Shift+P) for "Cognee: Capture Message"

---

#### Task 2.4: Test @cognee-memory Chat Participant

**Action**: Verify chat participant registers and responds.

**Steps** (in Extension Development Host):
1. Open Chat view (Ctrl+Alt+I or Activity Bar icon)
2. Type `@cognee-memory` in chat input
3. Participant should appear in autocomplete
4. Send test message: `@cognee-memory what is cognee?`
5. Wait for response

**Expected Behavior**:
- `@cognee-memory` appears in participant autocomplete
- Participant is marked "sticky" (remains in conversation)
- Sending message triggers retrieval from Cognee memory
- Response includes relevant context

**Success Criteria**:
- Participant registers (appears in autocomplete)
- Messages send successfully
- Output Channel shows retrieval logs
- Responses are generated

**If Participant Missing**:
- Check Debug Console for registration errors
- Verify activation logs show participant registration
- Check package.json `chatParticipants` declaration is correct

---

#### Task 2.5: Verify Output Channel Logging

**Action**: Confirm CogneeClient logs appear in Output Channel.

**Steps** (in Extension Development Host):
1. View → Output (Ctrl+Shift+U)
2. Select "Cognee Memory" from dropdown
3. Review initialization and operation logs

**Expected Logs**:
```
=== Cognee Client Configuration ===
Bridge Path: /path/to/extension/bridge
Python: /path/to/python
Workspace: /path/to/test/workspace

=== Testing Python Bridge Connection ===
✅ Python bridge test passed
```

**Success Criteria**:
- "Cognee Memory" appears in Output Channel dropdown
- Initialization logs present
- Bridge connection test passes
- Operation logs appear during capture/retrieval

---

### Phase 3: Documentation Update

**Objective**: Document debug configuration for future developers.

---

#### Task 3.1: Update SETUP.md

**File**: `/home/luke/Documents/Github-projects/cognee/extension/SETUP.md`

**Action**: Add section documenting launch.json for F5 debugging.

**Location**: After "Build and Run" section

**Content to Add**:

Document the debug configuration setup, explain its purpose (F5 launching for manual testing and automated tests), note workspace requirements (open `extension/` folder), and provide troubleshooting guidance for common activation issues.

**Reference**: See `analysis/009-extension-activation-failure-analysis.md` Recommendations section for example documentation content.

**Why This Matters**:
- Prevents future developers from encountering same activation issue
- Documents standard VS Code extension debugging workflow  
- Clarifies workspace folder requirements (must open `extension/`, not repo root)

---

#### Task 3.2: Update README.md Development Section

**File**: `/home/luke/Documents/Github-projects/cognee/extension/README.md`

**Action**: Add debugging subsection to Development section.

**Content to Add**:

Explain how to launch Extension Development Host (F5), set breakpoints, view different log outputs (Debug Console vs Output Channel vs Developer Tools), and reload after code changes.

**Reference**: See `analysis/009-extension-activation-failure-analysis.md` Recommendations section for example debugging instructions.

**Why This Matters**:
- Provides quick reference for debugging workflow
- Explains different log outputs and their purposes
- Documents reload process for rapid iteration

---

## Validation

### Acceptance Criteria

**Phase 1: Configuration Fixes**
- ✅ `.vscode/launch.json` created with proper extensionHost configuration
- ✅ `esbuild.js` modified to use `logLevel: 'info'`
- ✅ `npm run compile` shows build progress with size output

**Phase 2: Activation Verification**
- ✅ `dist/extension.js` exists and is >50KB
- ✅ F5 launches Extension Development Host successfully
- ✅ Debug Console shows "Cognee Chat Memory extension activated"
- ✅ Keyboard shortcut (Ctrl+Alt+C) triggers input box
- ✅ `@cognee-memory` appears in chat participant autocomplete
- ✅ Output Channel shows CogneeClient initialization logs
- ✅ Commands visible in Command Palette

**Phase 3: Documentation**
- ✅ SETUP.md updated with debug configuration section
- ✅ README.md updated with debugging instructions

**Note on Manual Testing**: Detailed functional testing steps are documented in `qa/008-chat-participant-memory-integration-qa.md` and `uat/008-chat-participant-memory-integration-uat.md`. This plan focuses on activation verification only.

### Verification Commands

```bash
# Verify configuration files created/modified
ls -la /home/luke/Documents/Github-projects/cognee/extension/.vscode/launch.json
grep -n "logLevel: 'info'" /home/luke/Documents/Github-projects/cognee/extension/esbuild.js

# Verify compilation works
cd /home/luke/Documents/Github-projects/cognee/extension
npm run compile
ls -lh dist/extension.js dist/extension.js.map
```

---

## Risks

### Risk 1: Hidden Compilation Errors

**Description**: Changing `logLevel: 'info'` may reveal previously hidden TypeScript errors.

**Likelihood**: LOW  
**Impact**: MEDIUM (blocks activation until fixed)

**Mitigation**:
- Run `npm run compile` immediately after changing logLevel
- Fix any revealed errors before proceeding
- Most errors already caught by automated tests (27 passing)

**Contingency**: If errors appear, fix TypeScript issues before continuing to Phase 2.

---

### Risk 2: launch.json Configuration Errors

**Description**: Incorrect launch.json syntax or paths could prevent debugging.

**Likelihood**: VERY LOW  
**Impact**: HIGH (activation still blocked)

**Mitigation**:
- Use exact template from analysis 009 (tested configuration)
- Verify JSON syntax with linter
- Test immediately after creation

**Contingency**: If F5 launch fails, check VS Code's built-in JSON schema validation for errors.

---

### Risk 3: Corrupted dist/extension.js

**Description**: Existing `dist/extension.js` may be corrupted from silent build failures.

**Likelihood**: LOW  
**Impact**: HIGH (extension won't activate)

**Mitigation**:
- Verify file size (should be >50KB)
- Check file timestamps match recent compile
- Rebuild if suspicious: `rm -rf dist && npm run compile`

**Contingency**: Delete `dist/` directory and rebuild from scratch.

---

### Risk 4: VS Code Version Incompatibility

**Description**: User's VS Code version may not support required extension APIs.

**Likelihood**: VERY LOW  
**Impact**: MEDIUM (extension won't activate)

**Mitigation**:
- package.json requires `^1.105.0` (current stable)
- Check user's VS Code version: Help → About
- Verify chat participant API support (VS Code 1.90+)

**Contingency**: Update VS Code to latest stable version if below minimum.

---

### Risk 5: Extension Host Permission Issues

**Description**: Extension Host may lack permissions to access workspace or bridge files.

**Likelihood**: VERY LOW (Linux environment)  
**Impact**: MEDIUM (runtime errors)

**Mitigation**:
- Linux filesystem permissions typically permissive for user files
- Bridge files already tested successfully in Output Channel
- Extension workspace owned by user

**Contingency**: Check file permissions: `ls -la extension/bridge/` and adjust if needed.

---

## Dependencies

### Prerequisites

**Before Starting Implementation**:
- ✅ Implementation 008 code complete (Milestones 1-5)
- ✅ QA validation passed (27 tests)
- ✅ UAT validation passed (13 scenarios)
- ✅ Analysis 009 complete (root cause identified)

**System Requirements**:
- VS Code ^1.105.0
- Node.js and npm installed
- Extension workspace at `/home/luke/Documents/Github-projects/cognee/extension`

### Blocking Issues

**NONE** - All prerequisites met. Ready for immediate implementation.

---

## Rollback Plan

**If activation fixes fail**:

1. **Revert launch.json creation**:
   ```bash
   rm /home/luke/Documents/Github-projects/cognee/extension/.vscode/launch.json
   ```

2. **Revert esbuild.js logLevel**:
   - Change `logLevel: 'info'` back to `logLevel: 'silent'`

3. **Alternative Testing Method**:
   - Package extension as VSIX
   - Install globally in VS Code
   - Test without Extension Development Host
   - Commands in analysis 009 → Fallback section

**Rollback Impact**: Returns to original blocked state. Extension still won't activate in debug mode, but analysis 009 fallback method provides alternative testing path.

---

## Timeline Estimate

**Phase 1: Configuration Fixes**
- Task 1.1 (launch.json): 5 minutes
- Task 1.2 (esbuild logging): 2 minutes
- **Subtotal**: 7 minutes

**Phase 2: Verification and Testing**
- Task 2.1 (file integrity): 2 minutes
- Task 2.2 (activation test): 5 minutes
- Task 2.3 (keyboard shortcut): 3 minutes
- Task 2.4 (chat participant): 5 minutes
- Task 2.5 (output logs): 2 minutes
- **Subtotal**: 17 minutes

**Phase 3: Documentation**
- Task 3.1 (SETUP.md): 5 minutes
- Task 3.2 (README.md): 5 minutes
- **Subtotal**: 10 minutes

**Total Estimated Time**: 34 minutes

**Contingency Buffer**: +15 minutes (for troubleshooting unexpected issues)

**Total with Buffer**: ~50 minutes

---

## Success Criteria

### Immediate Success Indicators

1. **Extension Activates**: Debug Console shows activation logs when F5 is pressed
2. **Build Visibility**: `npm run compile` shows build progress and completion
3. **Commands Work**: Keyboard shortcuts and Command Palette entries function
4. **Participant Registers**: `@cognee-memory` appears in chat autocomplete

### Downstream Impact

**Unblocks**:
- Manual testing of implementation 008 features
- Milestone 1-5 validation (keyboard shortcuts, chat participant, memory operations)
- Performance testing (<1000ms retrieval target)
- Workspace isolation verification
- v0.2.0 release preparation

**Enables**:
- Efficient debugging workflow for future development
- Visible build errors for rapid iteration
- Standard VS Code extension development practices

---

## Next Steps After Completion

### For Implementer

1. **Complete Activation Fixes** (this plan)
2. **Validate Extension Works** (manual testing checklist)
3. **Proceed to Full Feature Testing**:
   - Follow implementation 008 testing procedures
   - Validate Milestones 1-5 comprehensively
   - Test workspace isolation
   - Measure performance targets

### For QA

**No QA Required for This Plan**  

Reason: This plan fixes development environment configuration, not source code. The functionality being tested (implementation 008) already has comprehensive QA validation (27 passing tests in `qa/008-chat-participant-memory-integration-qa.md`).

QA's role resumes after activation is fixed and manual testing proceeds.

### For Release Preparation

Once activation works:
1. Complete manual testing of all features
2. Verify performance targets (<1000ms retrieval)
3. Test workspace isolation thoroughly
4. Update version to v0.2.0
5. Generate CHANGELOG entries
6. Package VSIX for distribution
7. Create GitHub release

---

## References

- **Analysis 009**: `analysis/009-extension-activation-failure-analysis.md`
- **Implementation 008**: `implementation/008-chat-participant-memory-integration-implementation.md`
- **QA Validation**: `qa/008-chat-participant-memory-integration-qa.md`
- **UAT Validation**: `uat/008-chat-participant-memory-integration-uat.md`
- **VS Code Debugging Docs**: https://code.visualstudio.com/api/working-with-extensions/testing-extension

---

## Summary

This plan addresses the **critical blocker** preventing manual testing of implementation 008 by:

1. **Creating Missing Debug Configuration** (`.vscode/launch.json`) - enables F5 debugging
2. **Enabling Build Error Visibility** (`esbuild.js` logging) - exposes compilation issues
3. **Verifying Activation** - confirms extension loads in Extension Development Host
4. **Testing Core Features** - validates keyboard shortcuts and chat participant work
5. **Documenting Workflow** - prevents future developers from encountering same issue

**Root Cause**: Missing `.vscode/launch.json` prevents Extension Host from loading extension.

**Solution**: Create launch.json with `--extensionDevelopmentPath` argument + enable build logging.

**Impact**: Unblocks all manual testing, enables v0.2.0 release preparation.

**Estimated Time**: 50 minutes (including testing and documentation).

**Risk**: VERY LOW - Configuration fixes are non-invasive and well-understood.

**Value**: CRITICAL - Without these fixes, implementation 008 cannot be tested or released.
