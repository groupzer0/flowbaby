# Analysis Report: Workspace Isolation Test Failure

**Analysis ID**: 001  
**Plan Related**: 003-fix-workspace-isolation-and-ontology.md, 004-extension-packaging-and-distribution.md  
**Date**: November 10, 2025  
**Author**: GitHub Copilot (Analyst)

---

## 1. Objective

This report analyzes the root cause of the critical integration test failure, "Test 4: Workspace Isolation fails - 'workspace A leaked data from workspace B'". The goal is to provide a clear explanation for the failure and actionable recommendations for a fix.

---

## 2. Methodology

The analysis involved a three-step process:
1.  **Review Test Logic**: Examined `extension/test-integration.sh` to confirm the validity of the test case.
2.  **Compare Plan to Implementation**: Cross-referenced the intended solution in `planning/003-fix-workspace-isolation-and-ontology.md` with the actual code in the Python bridge scripts (`init.py`, `ingest.py`, `retrieve.py`).
3.  **Code Inspection**: Performed a line-by-line review of the bridge scripts to identify discrepancies and bugs.

---

## 3. Findings

The investigation revealed two distinct and critical bugs. The primary bug is the direct cause of the data leakage, while the secondary bug represents a severe race condition that could lead to data loss.

### Finding 1: Logical Isolation Not Implemented (Root Cause of Test Failure)

The workspace isolation failure is due to the `ingest.py` and `retrieve.py` scripts **not implementing the dataset-based logical isolation** as designed in Plan 003.

-   **`init.py`**: Correctly generates a unique `dataset_name` for each workspace (e.g., `ws_a3f5e7d912c4b8f0`).
-   **`ingest.py` (BUG)**: Fails to pass the `dataset_name` to `cognee.add()`. All data is ingested into the default global dataset, completely bypassing the isolation mechanism.
-   **`retrieve.py` (BUG)**: Fails to pass `datasets=[dataset_name]` to `cognee.search()`. All searches are performed against the entire global database, retrieving data from all workspaces.

**Conclusion**: The core logic for data isolation is missing from the ingestion and retrieval steps. This is not a flaw in the design but a direct failure to implement it.

### Finding 2: Global Prune Race Condition

A secondary, unrelated bug was found in `init.py`. The script uses a **local marker file** within each workspace to decide whether to perform a **global data prune**.

-   **The Bug**: If two new, uninitialized workspaces are opened at the same time, both will check for their local marker, find it missing, and execute `cognee.prune.prune_system()`. This is a classic race condition.
-   **The Impact**: This can lead to unpredictable data loss. For example, Workspace A could ingest data, and a millisecond later, Workspace B's initialization could wipe that data before it's ever used.
-   **Plan Violation**: This implementation directly contradicts the robust mitigation strategy specified in Plan 003, which mandated the use of a **single global marker file** and an **atomic check-and-create operation** to prevent this exact scenario.

---

## 4. Recommendations

To fix these critical issues, the following changes must be made to the Python bridge scripts.

### Recommendation 1: Implement Dataset Scoping (Fixes Data Leakage)

The `implementer` must update `ingest.py` and `retrieve.py` to correctly use the `dataset_name` that `init.py` generates.

1.  **In `extension/bridge/ingest.py`**:
    -   Modify the `cognee.add()` call to include the `dataset_name`.
    -   Modify the `cognee.cognify()` call to scope the operation to the correct dataset.

    ```python
    # In ingest.py, inside the main async function:
    # ... generate dataset_name exactly as in init.py ...

    # FIX: Add dataset_name to the add() call
    await cognee.add(
        data,
        dataset_name=dataset_name
    )

    # ... load ontology_config ...

    # FIX: Scope cognify() to the specific dataset
    await cognee.cognify(
        datasets=[dataset_name],
        config=ontology_config
    )
    ```

2.  **In `extension/bridge/retrieve.py`**:
    -   Modify the `cognee.search()` call to filter by the workspace's `dataset_name`.

    ```python
    # In retrieve.py, inside the main async function:
    # ... generate dataset_name exactly as in init.py ...

    # FIX: Add datasets filter to the search() call
    search_results = await cognee.search(
        query,
        datasets=[dataset_name],
        limit=limit
    )
    ```

### Recommendation 2: Fix Pruning Race Condition

The `implementer` must refactor the pruning logic in `init.py` to use a global marker file with an atomic creation operation, as originally specified in Plan 003.

1.  **In `extension/bridge/init.py`**:
    -   Determine Cognee's global data directory.
    -   Define the path for a global marker file (e.g., `<cognee_data_dir>/.migration_v1_complete`).
    -   Use `os.open` with `os.O_CREAT | os.O_EXCL` in a `try...except FileExistsError` block to ensure only one process can create the marker and perform the prune.

    ```python
    # In init.py, replace the current "CRITICAL: Global prune strategy" block:

    # 1. Get Cognee's global data directory
    global_data_dir = Path(cognee.config.get_data_dir())
    global_data_dir.mkdir(parents=True, exist_ok=True)
    global_marker = global_data_dir / ".migration_v1_complete"

    migration_performed = False
    if not global_marker.exists():
        try:
            # 2. Attempt to atomically create the marker file
            fd = os.open(global_marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)

            # 3. If creation succeeds, this process won the race. Perform the prune.
            await cognee.prune.prune_system()
            migration_performed = True
            
            # Write content to the marker for debugging purposes
            global_marker.write_text(json.dumps({
                'migrated_at': datetime.now().isoformat(),
                'note': 'Global prune of untagged data performed by this process.'
            }))

        except FileExistsError:
            # Another process created the file in the meantime. Do nothing.
            pass
    ```

---

## 5. Conclusion

The "Workspace Isolation" test failure is a direct result of an incomplete implementation of the logical isolation design. The fix is straightforward and involves adding the `dataset_name` parameter to the appropriate function calls in `ingest.py` and `retrieve.py`.

Additionally, a severe race condition in the data pruning logic must be fixed to prevent potential data loss during initialization.

Once these two issues are resolved, the integration tests should pass, and the extension will be significantly more stable and reliable.
