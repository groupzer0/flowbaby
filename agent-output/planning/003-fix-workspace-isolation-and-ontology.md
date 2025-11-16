# Implementation Plan: Fix Workspace Isolation and Ontology Loading

**Plan ID**: 003  
**Created**: November 9, 2025  
**Status**: Active  
**Depends On**: Plan 002 Milestones 1-4 (Completed)  
**Blocks**: Plan 002 Milestone 5 (Chat Participant Implementation)

---

## Objective

Fix critical issues discovered during Milestone 4 review that prevent proper workspace isolation and ontology usage:

1. **Workspace Isolation Broken**: Python bridge scripts currently use Cognee's global storage location without any workspace-specific tagging
2. **Ontology Not Loaded**: Extension's chat-specific ontology (`extension/bridge/ontology.json`) is never loaded by Cognee
3. **Tutorial/Extension Data Mixed**: Both tutorial and extension share the same Cognee storage, causing ontology conflicts

These issues must be resolved before implementing Milestone 5 (Chat Participant) to ensure:
- Each workspace has isolated memory (no cross-project leakage)
- Chat conversations use the correct ontology (User, Question, Answer, etc.)
- Tutorial and extension don't interfere with each other

---

## Solution Approach Update (November 10, 2025)

**Original Approach (Failed)**: Attempt physical isolation by configuring workspace-local `.cognee/` directories via `cognee.config.data_root_directory()`.

**Failure Reason**: Cognee 0.3.4 initializes database connections at module import time, making post-import configuration ineffective. No environment variable or pre-import configuration mechanism exists.

**New Approach (Analyst-Recommended)**: Use Cognee's native **dataset-based logical isolation**:
- Generate unique `dataset_name` per workspace (SHA1 hash of workspace path)
- Tag all ingested data with `cognee.add(data, dataset_name=...)`
- Filter all searches with `cognee.search(query, datasets=[...])`
- Scope ontology application with `cognee.cognify(datasets=[...], config=ontology_config)`

**Key Benefits**:
- Uses documented, supported Cognee API (no workarounds)
- Ontology is per-dataset, not global (tutorial and extension can coexist)
- Simple implementation (3 lines of code per script: generate dataset name)
- Deterministic and testable (same workspace → same dataset name)

**Trade-offs Accepted**:
- Logical isolation (application-level) instead of physical (file-system)
- Shared global database (acceptable for local development use case)
- Dataset deletion research deferred to later phase

See `analysis/003-fix-workspace-isolation-and-ontology-analysis.md` for full analysis.

---

## Problem Analysis

### Issue 1: Workspace Isolation Not Implemented

**Current Behavior** (from `extension/bridge/init.py`):
```python
# Set workspace-local storage directory
cognee_dir = workspace_dir / '.cognee'
cognee_dir.mkdir(parents=True, exist_ok=True)

# Configure Cognee to use workspace-local directory
# Note: Cognee will use its default location, but we create .cognee/ for future use
```

**Problem**: The script creates a `.cognee/` directory but **never tells Cognee to use it**. Cognee continues using its global default location (likely `~/.local/share/cognee` or similar).

**Evidence**: 
- Comment admits "Cognee will use its default location"
- No call to `cognee.config.data_root_directory()` or equivalent
- All workspaces share the same Cognee database

**Impact**: 
- ❌ Workspace isolation completely broken
- ❌ Multiple workspaces see each other's conversations
- ❌ Privacy/security requirement violated

### Issue 2: Ontology Not Loaded

**Current Behavior**:
- `extension/bridge/ontology.json` exists with 8 chat-centric entities
- `tutorial/data/sample/ontology.json` exists with 6 developer-focused entities
- **Neither is explicitly loaded** by any bridge script

**Problem**: Cognee may be using:
1. Its default built-in ontology, OR
2. A mixed/corrupted ontology from previous runs, OR
3. No ontology at all (entity extraction disabled)

**Evidence**:
- No `grep` matches for "ontology" in any `.py` file in `extension/bridge/`
- No calls to load or configure ontology during initialization
- Test results from Milestone 3-4 show ingestion working, but unclear which ontology was used

**Impact**:
- ❌ Chat-specific entity extraction may not work (no "Question", "Answer", "Topic" entities)
- ❌ Graph relationships may be generic or missing
- ❌ Retrieval quality degraded (hybrid graph-vector search relies on proper ontology)

### Issue 3: Tutorial and Extension Data Sharing

**Current Behavior**:
- Tutorial runs use ontology from `tutorial/data/sample/ontology.json`
- Extension runs use (or should use) `extension/bridge/ontology.json`
- Both write to same Cognee database

**Problem**: Two incompatible ontologies in one graph database:
- "Developer" entity from tutorial
- "User" entity from extension
- Cognee may not handle ontology conflicts gracefully

**Impact**:
- ⚠️ Potential graph corruption or entity extraction errors
- ⚠️ Search results may return mixed tutorial/extension data
- ⚠️ Unclear which ontology "wins" during entity extraction

---

## Root Cause: Cognee API Limitations and Usage Gaps

**Analysis Findings** (see `analysis/003-fix-workspace-isolation-and-ontology-analysis.md`):

The initial approach of configuring physical workspace-local storage is not feasible with Cognee 0.3.4:
1. **No environment variable** exists for data root directory configuration
2. **`data_root_directory()` is ineffective** when called after module import (database connections already initialized)
3. **Logical isolation via datasets is supported** - the intended mechanism for multi-tenancy

The bridge scripts need to adopt Cognee's native dataset-based isolation model instead of attempting physical separation.

---

## Solution Design

### Approach: Logical Data Isolation via Datasets

**Strategy** (based on analyst recommendations):

Instead of attempting physical file-system isolation (which Cognee 0.3.4 doesn't support), use Cognee's built-in **dataset** feature for logical data separation:

1. **Generate unique dataset names**: Create a stable, unique `dataset_name` for each VS Code workspace (e.g., SHA1 hash of workspace path)
2. **Tag all data on ingestion**: Pass `dataset_name` to `cognee.add(data, dataset_name=...)`
3. **Filter searches by dataset**: Pass `datasets=[dataset_name]` to `cognee.search(..., datasets=[...])`
4. **Scope ontology per dataset**: Use `cognee.cognify(datasets=[dataset_name])` to apply chat ontology only to extension data
5. **One-time global cleanup**: On first initialization, prune any untagged legacy data from previous runs

**Implementation Steps**:

1. **Update `init.py`**:
   - Generate workspace-unique dataset name: `dataset_name = "ws_" + hashlib.sha1(workspace_path.encode()).hexdigest()[:16]`
   - Create `.cognee/` directory for marker files (not database storage)
   - Check for `.dataset_migration_complete` marker
   - If marker doesn't exist: Call `await cognee.prune.prune_system()` for one-time cleanup of untagged data
   - Create marker file to prevent repeated pruning
   - Load `extension/bridge/ontology.json`
   - Return dataset name and ontology info in JSON response

2. **Update `ingest.py`**:
   - Generate same workspace-unique dataset name
   - Pass `dataset_name` to `cognee.add(data, dataset_name=...)`
   - Pass `datasets=[dataset_name]` to `cognee.cognify(datasets=[...])`
   - This ensures ontology is applied only to this workspace's data

3. **Update `retrieve.py`**:
   - Generate same workspace-unique dataset name
   - Pass `datasets=[dataset_name]` to `cognee.search(..., datasets=[...])`
   - This ensures searches only return results from this workspace

4. **Test workspace isolation**:
   - Create two workspaces with different paths → different dataset names
   - Ingest different conversations in each
   - Verify retrieval only returns workspace-specific results (no cross-workspace leakage)
   - Note: Single global database, but logically separated by dataset tags

5. **Test ontology scoping**:
   - Verify tutorial (with its own dataset) can use its ontology
   - Verify extension workspaces (with unique datasets) use chat ontology
   - Confirm no ontology conflicts between tutorial and extension data

---

## Implementation Plan

### Milestone 3.5: Research Cognee Dataset API and Ontology Scoping

**Objective**: Verify Cognee 0.3.4 dataset-based isolation works as expected and determine ontology scoping behavior.

**Status**: ✅ COMPLETED (analysis documented in `analysis/003-fix-workspace-isolation-and-ontology-analysis.md`)

**Key Findings**:

1. **Dataset-based logical isolation is fully supported**:
   - `cognee.add(data, dataset_name="...")` tags data with a dataset identifier
   - `cognee.search(query, datasets=["..."])` filters results to specified datasets
   - `cognee.cognify(datasets=["..."])` processes only specified datasets

2. **Ontology is per-dataset, not global**:
   - Ontology configuration is passed to `cognify()` per dataset
   - Tutorial and extension can use different ontologies without conflict
   - No need for per-process ontology reloading in subprocesses

3. **Data cleanup mechanism**:
   - `cognee.prune.prune_system()` clears all data (graph + vector + metadata)
   - Suitable for one-time migration to remove untagged legacy data
   - Should be controlled by a marker file to prevent repeated data loss

4. **No physical isolation possible**:
   - No environment variable or API for workspace-local data directories
   - All data stored in global Cognee database (typically in user's home directory)
   - Logical isolation via datasets is the intended multi-tenancy model

**Acceptance Criteria**: ✅ All Met

- ✅ Confirmed dataset-based isolation API exists and is well-documented
- ✅ Verified ontology scoping is per-dataset (via `cognify(datasets=[...])`)
- ✅ Identified `prune_system()` for one-time data cleanup
- ✅ Confirmed no physical isolation mechanism available
- ✅ Analysis report created with implementation recommendations

**Decision**: ✅ **Proceed with logical isolation via datasets** (Milestone 4.5)

---

### Milestone 4.5: Implement Dataset-Based Workspace Isolation

**Objective**: Update `init.py`, `ingest.py`, and `retrieve.py` to use unique dataset names for logical workspace isolation.

**Steps**:

1. **Update `extension/bridge/init.py`**:

   **Requirements**:
   - Generate a stable, unique `dataset_name` for this workspace (recommend SHA1 hash of workspace path, truncated to 16 chars)
   - Create `.cognee/` directory within workspace for local marker files
   - Determine Cognee's global data directory path (query `cognee` for its storage location)
   - Check for GLOBAL marker file (e.g., `<cognee_data_dir>/.migration_complete`)
   - If global marker doesn't exist:
     - Attempt to create it atomically using `os.open()` with `os.O_CREAT | os.O_EXCL` flags
     - If creation succeeds: This workspace won the race, call `cognee.prune.prune_system()` to clear legacy data
     - If creation fails (FileExistsError): Another workspace already pruned, skip prune operation
   - Create local workspace marker (`.cognee/.initialized`) to track this workspace's initialization
   - Load `extension/bridge/ontology.json` and count entities/relationships
   - Return extended JSON response with dataset info and ontology metadata

   **JSON Output Contract**:
   ```json
   {
     "success": true,
     "dataset_name": "ws_a3f5e7d912c4b8f0",
     "workspace_path": "/home/user/project",
     "cognee_dir": "/home/user/project/.cognee",
     "ontology_loaded": true,
     "ontology_entities": 8,
     "ontology_relationships": 12,
     "migration_performed": true
   }
   ```
   
   **Note**: `migration_performed: true` indicates that THIS workspace performed the global prune (won the race). The global marker prevents any other workspace from ever pruning again. The local `.cognee/.initialized` marker tracks individual workspace initialization status.

2. **Update `extension/bridge/ingest.py`**:

   **Requirements**:
   - Generate the same unique `dataset_name` using identical logic as `init.py`
   - Tag ingested data with `dataset_name` parameter in `cognee.add()`
   - Load `extension/bridge/ontology.json` file path
   - Create a `Config` object with ontology resolver pointing to the ontology file
   - Pass `config` to `cognee.cognify()` along with `datasets=[dataset_name]`
   - This ensures ontology is scoped to this workspace's dataset only
   
   **Key Guidance**:
   - Each script must independently load the ontology (separate processes, no shared state)
   - Consult `cognee` v0.3.4 source code for correct `Config` structure and ontology resolver class
   - The `config` parameter is stateless - must be provided on every `cognify()` call

3. **Update `extension/bridge/retrieve.py`**:

   **Requirements**:
   - Generate the same unique `dataset_name` using identical logic as `init.py` and `ingest.py`
   - Pass `datasets=[dataset_name]` parameter to `cognee.search()`
   - This filters search results to only this workspace's data

4. **Update `extension/bridge/README.md`**:
   - Document workspace isolation implementation
   - Document ontology loading process
   - Add troubleshooting section for isolation issues
   - Explain how to verify workspace has separate data
   - Reference `test-integration.sh` Test 4 for isolation verification examples

**Note on Test Script**: The embedded bash script below is for illustration only. Workspace isolation verification is fully covered by Test 4 in `test-integration.sh` (Milestone 4.6). This standalone script should NOT be created to avoid test duplication and maintenance overhead. The logic shown here will be integrated into `test-integration.sh` instead.

   **Illustrative Script (DO NOT CREATE - integrate into test-integration.sh)**:
   ```bash
   #!/bin/bash
   # Verify workspace isolation by creating two workspaces and checking data separation
   
   set -e
   
   WORKSPACE_A="/tmp/cognee_test_workspace_a"
   WORKSPACE_B="/tmp/cognee_test_workspace_b"
   
   # Create test workspaces
   mkdir -p "$WORKSPACE_A" "$WORKSPACE_B"
   cp .env "$WORKSPACE_A/" || echo "OPENAI_API_KEY=test" > "$WORKSPACE_A/.env"
   cp .env "$WORKSPACE_B/" || echo "OPENAI_API_KEY=test" > "$WORKSPACE_B/.env"
   
   # Check if global Cognee directory exists (for comparison)
   GLOBAL_COGNEE="$HOME/.local/share/cognee"
   if [ -d "$GLOBAL_COGNEE" ]; then
       INITIAL_SIZE=$(du -s "$GLOBAL_COGNEE" | cut -f1)
       echo "Global Cognee directory exists (initial size: ${INITIAL_SIZE}K)"
   fi
   
   # Initialize both workspaces
   echo "=== Initializing Workspace A ==="
   python3 init.py "$WORKSPACE_A"
   
   echo "=== Initializing Workspace B ==="
   python3 init.py "$WORKSPACE_B"
   
   # Ingest different conversations
   echo "=== Ingesting to Workspace A ==="
   python3 ingest.py "$WORKSPACE_A" "What is Python?" "Python is a programming language" 0.5
   
   echo "=== Ingesting to Workspace B ==="
   python3 ingest.py "$WORKSPACE_B" "What is JavaScript?" "JavaScript is a programming language" 0.5
   
   # Wait for cognify() to complete
   echo "Waiting for entity extraction (30 seconds)..."
   sleep 30
   
   # Retrieve from each workspace
   echo "=== Retrieving from Workspace A ==="
   RESULT_A=$(python3 retrieve.py "$WORKSPACE_A" "Python" 3 2000 0.3 0.2)
   echo "$RESULT_A"
   
   echo "=== Retrieving from Workspace B ==="
   RESULT_B=$(python3 retrieve.py "$WORKSPACE_B" "JavaScript" 3 2000 0.3 0.2)
   echo "$RESULT_B"
   
   # Verify isolation
   echo "=== Verifying Isolation ==="
   if echo "$RESULT_A" | grep -q "JavaScript"; then
       echo "❌ FAILED: Workspace A leaked data from Workspace B"
       exit 1
   fi
   
   if echo "$RESULT_B" | grep -q "Python"; then
       echo "❌ FAILED: Workspace B leaked data from Workspace A"
       exit 1
   fi
   
   echo "✅ PASSED: Workspace isolation verified"
   
   # Check separate .cognee directories exist
   if [ ! -d "$WORKSPACE_A/.cognee" ]; then
       echo "❌ FAILED: Workspace A .cognee directory not created"
       exit 1
   fi
   
   if [ ! -d "$WORKSPACE_B/.cognee" ]; then
       echo "❌ FAILED: Workspace B .cognee directory not created"
       exit 1
   fi
   
   echo "✅ PASSED: Separate .cognee directories exist"
   
   # Verify global Cognee directory not used
   if [ -d "$GLOBAL_COGNEE" ]; then
       FINAL_SIZE=$(du -s "$GLOBAL_COGNEE" | cut -f1)
       if [ "$FINAL_SIZE" -gt "$INITIAL_SIZE" ]; then
           echo "❌ FAILED: Global Cognee directory grew from ${INITIAL_SIZE}K to ${FINAL_SIZE}K"
           echo "   Workspace isolation is NOT working!"
           exit 1
       fi
       echo "✅ PASSED: Global Cognee directory unchanged"
   fi
   
   # Cleanup
   rm -rf "$WORKSPACE_A" "$WORKSPACE_B"
   echo "✅ ALL TESTS PASSED"
   ```

**Acceptance Criteria**:
- `init.py` generates stable, unique `dataset_name` from workspace path (SHA1 hash)
- `init.py` creates `.cognee/` directory for local marker files (not database storage)
- `init.py` uses GLOBAL marker file in Cognee's data directory to coordinate prune across all workspaces
- `init.py` performs atomic check-and-create of global marker using `os.O_CREAT | os.O_EXCL`
- Only ONE workspace across the entire system performs `prune_system()` (winner of atomic race)
- `init.py` returns dataset name and ontology info in JSON response
- `init.py` creates local `.cognee/.initialized` marker to track this workspace's initialization
- Global marker prevents ANY workspace from ever pruning again (preserves all user data)
- Concurrent initialization of multiple workspaces is safe (no race condition)
- `ingest.py` generates same `dataset_name` and tags all added data with it
- `ingest.py` calls `cognee.cognify(datasets=[dataset_name], config=ontology_config)`
- `ingest.py` ensures ontology is scoped to this workspace's dataset only
- `retrieve.py` generates same `dataset_name` and filters search to `datasets=[dataset_name]`
- Workspace A and Workspace B have different `dataset_name` values
- Searches in Workspace A only return data tagged with Workspace A's dataset
- Entity extraction uses chat ontology (verify "Question", "Answer", "Topic" entities present)
- Tutorial data (different dataset) can use its own ontology without conflict
- Re-initializing existing workspace does NOT wipe data (global marker prevents prune)

---

### Milestone 4.6: Update TypeScript Client and Integration Tests

**Objective**: Update `CogneeClient.ts` and integration tests to handle new initialization response and verify workspace isolation.

**Steps**:

1. **Update `extension/src/cogneeClient.ts`**:

   **Requirements**:
   - In `initialize()` method, log the new ontology metadata from `init.py` response
   - Include: `ontology_loaded`, `ontology_entities`, `ontology_relationships`, `migration_performed`
   - Use defensive defaults (e.g., `??` operator) for optional fields
   - Log a warning if `ontology_loaded !== true`
   - This provides visibility into ontology configuration status

2. **Update `extension/test-integration.sh`**:

   **Add Test 4: Workspace Isolation**
   - Create second test workspace (workspace B)
   - Initialize and ingest different conversation than workspace A
   - Verify retrieval from workspace A only returns workspace A data (no TypeScript from workspace B)
   - Verify retrieval from workspace B only returns workspace B data (no Python from workspace A)
   - Verify `.dataset_migration_complete` marker files exist in both workspaces
   - Verify different `dataset_name` values assigned to each workspace

   **Add Test 5: Ontology Loading**
   - Parse `init.py` JSON response for ontology metadata
   - Verify `ontology_loaded: true`
   - Verify `ontology_entities: 8`
   - Verify `ontology_relationships: 12`

   **Add Test 5b: Re-initialization Safety**
   - Call `init.py` again on same workspace
   - Verify no data reset occurred (marker file prevents prune)
   - Verify marker files still exist

3. **Update `extension/bridge/README.md`**:
   - Add "Workspace Isolation" section explaining how it works
   - Add "Ontology Loading" section with entity/relationship list
   - Add "Troubleshooting" section for common isolation issues
   - Document test scripts and expected outputs

**Acceptance Criteria**:
- `CogneeClient.initialize()` logs ontology information (entity count, relationship count, reset status)
- `CogneeClient.initialize()` shows warning if ontology not loaded
- `test-integration.sh` Test 4 passes (workspace isolation verified)
- `test-integration.sh` Test 5 passes (ontology verification complete)
- `test-integration.sh` Test 5b passes (re-initialization safety verified)
- All 6 integration test cases pass without errors (Tests 1-5 including 5b)
- `extension/bridge/README.md` documents workspace isolation and ontology loading

---

### Milestone 4.7: Git Commit and Validation

**Objective**: Commit fixes, run full test suite, and validate workspace isolation in real VS Code extension.

**Steps**:

1. **Run full test suite**:
   ```bash
   cd extension
   chmod +x test-integration.sh
   ./test-integration.sh
   ```
   
   **Note**: All 6 integration test cases (including workspace isolation) are consolidated in `test-integration.sh`.

2. **Test in real VS Code extension**:
   - Open workspace A in VS Code
   - Verify extension activates and initializes
   - Check Output Channel for ontology loaded message
   - Verify workspace A has `.cognee/` directory
   - Open workspace B in separate VS Code window
   - Verify workspace B has separate `.cognee/` directory
   - Confirm no data sharing between workspaces

3. **Git commit**:
   ```bash
   git add extension/bridge/init.py
   git add extension/bridge/ingest.py
   git add extension/bridge/retrieve.py
   git add extension/bridge/README.md
   git add extension/bridge/COGNEE_API_NOTES.md
   git add extension/src/cogneeClient.ts
   git add extension/test-integration.sh
   
   git commit -m "Fix workspace isolation and ontology loading (Milestones 3.5-4.7)
   
   WORKSPACE ISOLATION:
   - Updated init.py to configure workspace-local data directory
   - Updated ingest.py and retrieve.py to re-apply workspace config
   - Each workspace now has independent .cognee/ storage
   - Verified no data leakage between workspaces
   
   ONTOLOGY LOADING:
   - Updated init.py to load extension/bridge/ontology.json
   - Ontology defines 8 chat-centric entities and 12 relationships
   - Entity extraction now uses User, Question, Answer, Topic, etc.
   - Verified tutorial and extension ontologies don't conflict
   
   TESTING:
   - Added Test 4 to test-integration.sh (workspace isolation)
   - Added Test 5 to test-integration.sh (ontology verification)
   - Added Test 5b to test-integration.sh (re-initialization safety)
   - All 6 integration test cases pass (Tests 1-5 including 5b)
   
   LOGGING:
   - CogneeClient logs ontology info on initialization
   - Logs include entity count and relationship count
   - Warnings shown if ontology loading fails
   
   DOCUMENTATION:
   - Created COGNEE_API_NOTES.md with API research findings
   - Updated bridge/README.md with isolation and ontology sections
   - Added troubleshooting guide for common issues
   
   This fixes critical blocking issues discovered in Milestone 4 review.
   Ready to proceed to Milestone 5 (Chat Participant Implementation)."
   ```

**Acceptance Criteria**:
- All 6 integration test cases pass (Tests 1-5 including 5b)
- Workspace isolation verified in real VS Code extension
- Ontology loading verified in real VS Code extension
- Git commit created with comprehensive message
- Tutorial and extension can run simultaneously without conflicts
- No regression in existing Milestone 1-4 functionality

---

## Updated Milestone 5: Chat Participant Implementation

**Changes from Original Plan 002**:

1. **Initialization Validation Enhanced**:
   ```typescript
   // In extension.ts activate():
   const initialized = await cogneeClient.initialize();
   if (!initialized) {
       // Don't register chat participant if initialization failed
       vscode.window.showErrorMessage(
           'Cognee Memory: Failed to initialize. Check Output Channel for details.'
       );
       return;
   }
   
   // NEW: Verify workspace isolation working
   const workspaceConfig = vscode.workspace.getConfiguration('cogneeMemory');
   if (workspaceConfig.get('logLevel') === 'debug') {
       cogneeClient.log(LogLevel.Debug, 'Workspace isolation active', {
           workspace: workspaceFolder.uri.fsPath,
           cognee_dir: `${workspaceFolder.uri.fsPath}/.cognee`
       });
   }
   ```

2. **Chat Participant Error Handling**:
   ```typescript
   // In chatParticipant.ts handler:
   
   // If retrieval fails, still continue with response (degrade gracefully)
   try {
       const context = await cogneeClient.retrieve(userQuery);
       if (context.length > 0) {
           stream.markdown(`*Retrieved ${context.length} relevant memories*\n\n`);
           enrichedPrompt = formatContextWithQuery(context, userQuery);
       }
   } catch (error) {
       // Log error but don't block response
       console.error('[Cognee] Retrieval failed:', error);
       // Continue with original query (no context)
   }
   ```

3. **Ontology Validation Command** (Optional Enhancement):
   ```typescript
   // Register command to show ontology stats
   context.subscriptions.push(
       vscode.commands.registerCommand('cogneeMemory.showOntology', async () => {
           // Re-read init response to get ontology stats
           // Show info message with entity/relationship counts
           vscode.window.showInformationMessage(
               `Cognee Ontology: 8 entities, 12 relationships (User, Question, Answer, Topic, Concept, Problem, Solution, Decision)`
           );
       })
   );
   ```

**All other Milestone 5 steps remain unchanged from Plan 002.**

---

## Validation

### Workspace Isolation Tests

1. **Test: Two Workspaces, No Leakage (Logical Isolation)**:
   - Create workspace A, ingest "What is Python?"
   - Create workspace B, ingest "What is JavaScript?"
   - Retrieve "programming" in workspace A → should only see Python
   - Retrieve "programming" in workspace B → should only see JavaScript
   - ✅ PASS if no cross-workspace results (datasets filtered correctly)

2. **Test: Unique Dataset Names Generated**:
   - Initialize workspace A, capture `dataset_name` from JSON response
   - Initialize workspace B, capture `dataset_name` from JSON response
   - Verify `dataset_name_A ≠ dataset_name_B`
   - Verify dataset names are stable (re-init produces same name)
   - ✅ PASS if different workspaces get unique, stable dataset identifiers

3. **Test: Marker Files in Local .cognee Directory**:
   - Initialize workspace
   - Verify `.cognee/` directory exists in workspace root
   - Verify `.dataset_migration_complete` marker file exists
   - ✅ PASS if marker file prevents repeated data pruning

4. **Test: Global Database Used (Expected Behavior)**:
   - Acknowledge that all workspaces share global Cognee database (e.g., `~/.local/share/cognee`)
   - Verify database grows when data is ingested (expected)
   - Verify data is logically separated by dataset tags, not physically separated files
   - ✅ PASS if global database is used but searches remain isolated by dataset

### Ontology Loading Tests

1. **Test: Chat Ontology Entities Extracted**:
   - Ingest conversation: "User: What is async? Assistant: Async is..."
   - Check Cognee database or logs for extracted entities
   - Verify entities match chat ontology: User, Question, Answer, Topic, Concept
   - ✅ PASS if chat entities found

2. **Test: Tutorial Ontology Not Mixed**:
   - Run tutorial walkthrough
   - Run extension with different workspace
   - Verify tutorial entities (Developer, API, Framework) NOT in extension database
   - Verify tutorial vector embeddings NOT in extension vector database
   - ✅ PASS if ontologies remain separate

3. **Test: Vector Database Reset Verification**:
   - Check workspace with legacy tutorial data exists
   - Initialize extension (should trigger reset)
   - Verify vector database collections/indices cleared
   - Check vector DB size is minimal (only new ontology schema, no old embeddings)
   - ✅ PASS if vector DB fully reset

4. **Test: Ontology Info Logged**:
   - Check extension Output Channel after initialization
   - Verify log message shows: "ontology_entities: 8, ontology_relationships: 12"
   - ✅ PASS if ontology stats present

### Integration Tests (All Must Pass)

- ✅ Test 1: Initialize (existing)
- ✅ Test 2: Ingest (existing)
- ✅ Test 3: Retrieve (existing)
- ✅ Test 4: Workspace Isolation (new)
- ✅ Test 5: Ontology Loading (new)
- ✅ Test 5b: Re-initialization Safety (new - verifies no data loss on subsequent inits)

---

## Risks and Mitigations

### Risk 1: Dataset Name Collisions (Hash Conflicts)

**Likelihood**: Very Low  
**Impact**: Medium (two different workspaces treated as same)

**Mitigation**:
- Using SHA1 (160-bit hash) with 16 hex characters (64 bits) gives ~18 quintillion unique values
- Birthday paradox: Need ~4 billion workspaces for 50% collision probability
- Extremely unlikely for typical user with <100 workspaces
- If collision detected (future enhancement): Use full SHA1 hash or add random suffix

### Risk 2: Logical Isolation Insufficient for Security Requirements

**Likelihood**: Low (not a concern for local development workspaces)  
**Impact**: Low (data accessible if user has direct database access)

**Mitigation**:
- Logical isolation prevents **accidental** cross-workspace leakage at application level
- Physical database access is already available to user (their local machine)
- For enhanced security: Could encrypt dataset-specific data in future versions
- Current approach sufficient for stated requirement: "no cross-project leakage"

### Risk 3: Ontology Conflicts with Legacy Tutorial Data

**Likelihood**: Low (mitigated by one-time clean slate approach)  
**Impact**: High (mixed entity types in graph + mismatched vector embeddings)

**Mitigation**:
- **Primary strategy**: Call `cognee.prune.prune_system()` during first init.py run if existing data found (one-time only)
- **Critical requirement**: Prune must clear BOTH graph and vector databases (which it does)
- **Global marker file approach**: Create a global marker in Cognee's data directory to ensure only ONE prune across all workspaces (see Risk 4 mitigation)
- **Nuclear option**: Delete entire global Cognee database directory and recreate fresh (manual user action)
- **User data preservation**: After initial prune, subsequent initializations do NOT prune data, preserving chat history
- Cognee 0.3.4 likely has no default ontology; current state is from tutorial walkthrough
- Logical dataset isolation ensures no ontology conflicts between workspaces

### Risk 4: One-Time Global Prune Race Condition

**Likelihood**: Low (mitigated by global marker file)  
**Impact**: High (accidental data loss if multiple workspaces initialize simultaneously)

**Clarification on Prune Behavior**:
- The `prune_system()` call is a **GLOBAL operation** that affects all data in Cognee's database
- Multiple workspaces initializing concurrently could each attempt a prune if using only local markers
- **This creates a race condition where data could be lost between one workspace's ingest and another's prune**

**Robust Mitigation Strategy (Implemented Now)**:
- **Use a GLOBAL marker file**: Create marker in Cognee's data directory (e.g., `~/.local/share/cognee/.migration_complete`)
- **Atomic check-and-set**: Use file creation atomicity to ensure only ONE workspace ever performs the prune
- **Implementation approach**:
  1. Check if global marker exists (`~/.local/share/cognee/.migration_complete`)
  2. If not: Attempt to create it atomically (use `os.O_CREAT | os.O_EXCL` flags)
  3. If creation succeeds: This workspace won the race, perform `prune_system()`, keep marker
  4. If creation fails (file exists): Another workspace already pruned, skip prune operation
  5. Also create local workspace marker for tracking individual workspace initialization
- **Key safety**: Only ONE workspace across the entire system will ever execute the prune
- **User benefit**: No need to serialize workspace initializations; concurrent initialization is safe
- **Fallback**: If user manually deletes global marker, prune runs again (safe idempotent operation for fresh start)

### Risk 5: Dataset Name Generation Inconsistency

**Likelihood**: Low  
**Impact**: High (same workspace gets different dataset names → data fragmentation)

**Mitigation**:
- Use `workspace_dir.absolute()` to ensure consistent path normalization
- SHA1 hash is deterministic - same input always produces same output
- Integration test verifies re-initialization produces identical dataset name
- Potential edge case: Symlinks or relative paths → use `Path.resolve()` to canonicalize

---

## Success Criteria

**Milestone 3.5-4.7 Complete When**:
- ✅ All 6 integration test cases pass (Tests 1-5 including 5b)
- ✅ Workspace isolation verified (no data leakage)
- ✅ Ontology loading verified (8 entities, 12 relationships)
- ✅ Re-initialization safety verified (marker file prevents data loss)
- ✅ CogneeClient logs ontology stats on initialization
- ✅ Tutorial and extension don't interfere with each other
- ✅ Git commit created with fixes
- ✅ Documentation updated (README, COGNEE_API_NOTES with ontology persistence findings)

**Ready for Milestone 5 When**:
- ✅ All above criteria met
- ✅ VS Code extension activates with workspace-local storage
- ✅ No regression in existing functionality
- ✅ Tutorial still works from `tutorial/` directory

---

## Timeline Estimate

- **Milestone 3.5** (Research): 30-60 minutes
- **Milestone 4.5** (Fix Scripts): 60-90 minutes
- **Milestone 4.6** (Update Client): 30-45 minutes
- **Milestone 4.7** (Commit & Validate): 30 minutes

**Total Estimate**: 2.5-4 hours

---

## Next Steps

1. **Immediate**: Begin Milestone 3.5 (Research Cognee API)
2. **After 3.5**: Implement fixes in Milestone 4.5
3. **After 4.7**: Proceed to original Plan 002 Milestone 5 (Chat Participant)

This plan resolves the critical blocking issues before proceeding to user-facing features.
