# Analysis Report: Workspace Isolation and Ontology Loading in Cognee 0.3.4

**Analysis ID**: 003-fix-workspace-isolation-and-ontology-analysis  
**Plan ID**: 003  
**Created**: November 10, 2025  
**Status**: Completed

---

## 1. Objective

This analysis investigates solutions to the critical workspace isolation and ontology loading issues identified in Plan 003. The initial implementation failed due to incorrect assumptions about the Cognee 0.3.4 API.

The goals are:
1.  Identify a reliable mechanism for workspace data isolation.
2.  Determine the correct API for loading a custom ontology file (`extension/bridge/ontology.json`).

This report explores two main topics:
1.  **Data Isolation**: Physical (file-based) vs. Logical (dataset-based) isolation.
2.  **Ontology Loading**: Investigating the `cognify` API and its configuration for custom schemas.

---

## 2. Methodology

The analysis was conducted through the following steps:
1.  **Initial Code Review**: Inspected the `cognee` library's source code on GitHub to understand its configuration lifecycle.
2.  **API Analysis**: Examined function signatures for `cognee.add`, `cognee.search`, and `cognee.config`.
3.  **Keyword Search**: Searched the repository for configuration and filtering capabilities.
4.  **Source Code Analysis (post-`ImportError`)**: After the initial implementation failed with an `ImportError`, performed deep `grep` and `read_file` analysis of the installed `cognee==0.3.4` package source (`cognify.py`, `ontology_config.py`, etc.) to trace the correct ontology loading mechanism.

---

## 3. Findings

### Finding 1: Logical Data Isolation via Datasets is the Correct Approach

The initial idea of physical isolation by setting `cognee.config.data_root_directory()` is not feasible as the database is initialized on module import. The correct, supported method is logical isolation.

-   **`cognee.add(data, dataset_name="...")`**: Tags ingested data with a unique workspace identifier.
-   **`cognee.search(query, datasets=["..."])`**: Filters search results to one or more specified datasets.
-   **`cognee.cognify(datasets=["..."])`**: Scopes the expensive graph creation process to specific datasets.

**Conclusion**: A unique `dataset_name` (e.g., SHA1 hash of the workspace path) should be generated for each workspace and used in all `add`, `search`, and `cognify` calls to ensure data is properly segregated.

### Finding 2: No Environment Variable for Data Root Path

A thorough search of the Cognee 0.3.4 source code revealed **no evidence** of an environment variable (like `COGNEE_DATA_DIR`) for configuring the data directory path. This confirms that logical isolation is the intended multi-tenancy model.

### Finding 3: Arbitrary Metadata Filtering is Not Directly Supported

The `add` and `search` APIs do not support filtering on arbitrary key-value metadata. The `datasets` parameter is the primary filtering mechanism.

### Finding 4: Stateless Ontology Configuration via `cognify`

The `ImportError` from the initial implementation attempt was caused by referencing incorrect classes (`RDFLibOntologyResolver` and `Config` from `cognee.infrastructure.engine`). Source code analysis of `cognee==0.3.4` revealed the correct, stateless mechanism.

-   **`cognify` is Stateless**: The `cognify` function is stateless and does not retain configuration between calls. Ontology configuration must be passed on every call via its `config` parameter.
-   **`Config` TypedDict**: The correct `Config` object is a `TypedDict` defined in `cognee.modules.ontology.ontology_config`.
-   **`DefaultOntologyResolver`**: The correct class to use is `DefaultOntologyResolver` from `cognee.modules.ontology.get_default_ontology_resolver`. It takes the file path to the `ontology.json` file in its constructor.

**Correct Implementation Pattern**:
```python
# In ingest.py

import json
from pathlib import Path
from cognee.modules.ontology.ontology_config import Config
from cognee.modules.ontology.get_default_ontology_resolver import DefaultOntologyResolver

# 1. Define the path to the ontology file
ontology_file_path = str(Path(__file__).parent / "ontology.json")

# 2. Create the ontology resolver instance
default_ontology_resolver = DefaultOntologyResolver(ontology_file_path)

# 3. Create the configuration object
ontology_config: Config = {
    "ontology_engine": {
        "ontology_resolver": default_ontology_resolver,
    }
}

# 4. Pass the config to cognify for the relevant dataset
await cognee.cognify(
    datasets=[dataset_name],
    config=ontology_config,
)
```

**Conclusion**: This pattern correctly loads the specified ontology for the target dataset on each ingestion, ensuring the chat-specific schema is used without relying on any persistent or global configuration state.

---

## 4. Recommendations

Based on the findings, the following recommendations are made:

1.  **Adopt Logical Data Isolation using Datasets.**
    -   Generate a stable, unique `dataset_name` from the workspace path (e.g., SHA1 hash).
    -   Pass this `dataset_name` to all `cognee.add()`, `cognee.search()`, and `cognee.cognify()` calls.

2.  **Implement Stateless Ontology Configuration in `ingest.py`.**
    -   In `ingest.py`, construct the `Config` object on every execution, as shown in "Finding 4".
    -   Instantiate `DefaultOntologyResolver` with the absolute path to `extension/bridge/ontology.json`.
    -   Pass this `config` object to `cognee.cognify()` to ensure the correct ontology is applied to the workspace's dataset.

3.  **Perform a One-Time Global Prune.**
    -   To clear out any untagged legacy data (from tutorial runs or previous failed attempts), `cognee.prune.prune_system()` should be called.
    -   This is a global, destructive operation. It should be controlled by a marker file (e.g., `.cognee/.dataset_migration_complete` in the workspace) to ensure it runs only once per workspace's first initialization, preventing accidental data loss on subsequent runs.

---

## 5. Open Questions

-   **Data Deletion**: How can an entire dataset be pruned or deleted? This is not immediately clear from the API and requires further research for implementing a "reset workspace" feature in the future.

---

## 6. References

-   Cognee GitHub Repository: `https://github.com/topoteretes/cognee`
-   `cognee.api.v1.add.add.py`
-   `cognee.api.v1.search.search.py`
-   `cognee.api.v1.cognify.cognify.py`
-   `cognee.modules.ontology.ontology_config.py`
-   `cognee.modules.ontology.get_default_ontology_resolver.py`
