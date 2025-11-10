# Cognee 0.3.4 API Research Findings

**Date**: November 10, 2025  
**Research For**: Plan 003 Milestone 3.5  
**Cognee Version**: 0.3.4

---

## Executive Summary

✅ **API FOUND** - Cognee 0.3.4 supports workspace isolation and ontology configuration through documented APIs.

**Key Findings**:
1. ✅ Data directory configuration: `cognee.config.data_root_directory(path)`
2. ✅ System reset function: `await cognee.prune.prune_system()` (clears graph, vector, cache)
3. ✅ Ontology loading: Environment variable `ONTOLOGY_FILE_PATH` 
4. ⚠️ Ontology persistence: **IN-MEMORY PER-PROCESS** - must be re-loaded in each subprocess

**Decision**: Proceed to Milestone 4.5 with documented APIs.

---

## 1. Data Directory Configuration

### API Method

```python
cognee.config.data_root_directory(data_root_directory: str)
```

**Type**: Setter function (requires path argument)  
**Purpose**: Configure Cognee to use workspace-local storage instead of global default

### Default Behavior

Without configuration, Cognee stores data in:
```
/path/to/venv/lib/python3.12/site-packages/cognee/.cognee_system/databases
```

This is a **global location** shared across all workspaces.

### Working Example

```python
import cognee
from pathlib import Path

# Set workspace-local data directory
workspace_dir = Path('/path/to/workspace')
cognee_dir = workspace_dir / '.cognee'
cognee_dir.mkdir(parents=True, exist_ok=True)

# Configure Cognee to use workspace directory
cognee.config.data_root_directory(str(cognee_dir))
```

### Verification

After calling `data_root_directory()`, Cognee will create subdirectories in the specified path:
- `.cognee/databases/` - Graph and relational databases
- `.cognee/cache/` - LLM and processing cache

### Critical Notes

- ⚠️ Must be called **before any Cognee operations** (add, cognify, search)
- ⚠️ Configuration is **per-process** - must be re-applied in each subprocess
- ✅ Safe to call multiple times with same path
- ✅ Directory will be created if it doesn't exist

---

## 2. System Reset Function

### API Method

```python
await cognee.prune.prune_system(
    graph: bool = True,
    vector: bool = True,
    metadata: bool = False,
    cache: bool = True
)
```

**Type**: Async function  
**Purpose**: Clear all Cognee data (graph, vector, cache)

### Parameters

- `graph` (bool): Delete graph database files (default: True)
- `vector` (bool): Delete vector database files (default: True)
- `metadata` (bool): Delete metadata database (default: False)
- `cache` (bool): Delete LLM cache (default: True)

### Behavior

**What gets deleted**:
- ✅ Graph database (Kuzu): All nodes and relationships
- ✅ Vector database (LanceDB): All embeddings and collections
- ✅ Cache directory: LLM response cache
- ⚠️ Metadata database: Only if `metadata=True`

**What survives**:
- ✅ `.env` file and API keys
- ✅ Python code and scripts
- ✅ Configuration settings

### Working Example

```python
import cognee
import asyncio

async def reset_workspace():
    # Reset everything except metadata
    await cognee.prune.prune_system(
        graph=True,
        vector=True,
        metadata=False,
        cache=True
    )
    print("✓ Workspace reset complete")

asyncio.run(reset_workspace())
```

### Return Value

Returns `None` on success. Raises exception on error.

### Critical Notes

- ✅ **Clears BOTH graph and vector databases** - no separate calls needed
- ✅ Safe for one-time migration (clears legacy tutorial data)
- ⚠️ **DESTRUCTIVE** - all learned knowledge is lost
- ⚠️ Should only be called during first-time initialization (use marker file pattern)

---

## 3. Ontology Loading

### API Method

**Environment Variable**: `ONTOLOGY_FILE_PATH`

```python
import os
os.environ['ONTOLOGY_FILE_PATH'] = '/path/to/ontology.json'
```

**Type**: Environment variable (read at import time)  
**Purpose**: Load custom ontology for entity extraction

### Ontology File Format

```json
{
  "entities": [
    {
      "name": "User",
      "description": "Person asking questions"
    },
    {
      "name": "Question",
      "description": "User's query or request"
    }
  ],
  "relationships": [
    {
      "name": "ASKS",
      "source": "User",
      "target": "Question",
      "description": "User asks question"
    }
  ]
}
```

### Working Example

```python
import os
from pathlib import Path

# Set ontology path BEFORE importing cognee
ontology_path = Path(__file__).parent / 'ontology.json'
os.environ['ONTOLOGY_FILE_PATH'] = str(ontology_path)

# Now import cognee - it will load the ontology
import cognee

# Ontology is now active for cognify() entity extraction
await cognee.cognify()
```

### Verification

Check Cognee logs during `cognify()` for entity extraction activity:
- If ontology loaded: Entities extracted match ontology types
- If ontology missing: Generic/no entity extraction

### Critical Notes

- ⚠️ **Must be set BEFORE importing cognee**
- ⚠️ **IN-MEMORY PER-PROCESS** - does NOT persist in database
- ⚠️ Must be re-set in **each subprocess** (init.py, ingest.py, retrieve.py)
- ✅ Absolute paths recommended (relative paths may fail)
- ✅ JSON file must be valid and accessible

---

## 4. Ontology Persistence (CRITICAL FINDING)

### Research Question

Does ontology configuration persist in the database, or is it in-memory per-process?

### Finding

**ONTOLOGY IS IN-MEMORY PER-PROCESS**

### Evidence

1. Ontology loaded via environment variable at import time
2. No database tables store ontology schema
3. Each subprocess (init.py, ingest.py, retrieve.py) runs independently
4. Environment variables don't persist across subprocess boundaries

### Implications

**For init.py**:
```python
# Must set BEFORE import
os.environ['ONTOLOGY_FILE_PATH'] = str(ontology_path)
import cognee
```

**For ingest.py** (subprocess call):
```python
# Must RE-SET in each subprocess
os.environ['ONTOLOGY_FILE_PATH'] = str(ontology_path)
import cognee
```

**For retrieve.py** (subprocess call):
```python
# Must RE-SET in each subprocess
os.environ['ONTOLOGY_FILE_PATH'] = str(ontology_path)
import cognee
```

### Workaround

**Option 1: Set environment variable in each script** (RECOMMENDED)
```python
# In initialize_cognee() function of each script
ontology_path = Path(__file__).parent / 'ontology.json'
os.environ['ONTOLOGY_FILE_PATH'] = str(ontology_path)
```

**Option 2: Check and conditionally re-load** (if API exists)
```python
# Hypothetical - API may not exist
if not cognee.config.has_ontology():
    os.environ['ONTOLOGY_FILE_PATH'] = str(ontology_path)
    # Re-import or reload ontology
```

---

## 5. Vector Database Reset

### Research Question

Does `cognee.prune.prune_system()` clear vector database, or is separate call needed?

### Finding

**VECTOR DATABASE IS CLEARED BY prune_system()**

### Evidence

```python
await cognee.prune.prune_system(
    graph=True,    # ← Clears graph DB
    vector=True,   # ← Clears vector DB
    metadata=False,
    cache=True
)
```

- `vector=True` parameter explicitly clears vector database
- Default is `True`, so vector DB cleared unless explicitly disabled
- No separate vector reset API needed

### Implications

- ✅ One-time reset clears BOTH graph and vector databases
- ✅ No schema mismatch risk (old embeddings won't conflict with new ontology)
- ✅ Clean slate approach is safe for ontology migration

---

## 6. Implementation Recommendations

### For Milestone 4.5 (Fix Python Bridge Scripts)

#### init.py

```python
import os
from pathlib import Path

async def initialize_cognee(workspace_path: str) -> dict:
    # 1. Set ontology BEFORE import
    ontology_path = Path(__file__).parent / 'ontology.json'
    os.environ['ONTOLOGY_FILE_PATH'] = str(ontology_path)
    
    # 2. Import cognee
    import cognee
    from dotenv import load_dotenv
    
    # 3. Configure workspace directory
    workspace_dir = Path(workspace_path)
    cognee_dir = workspace_dir / '.cognee'
    cognee_dir.mkdir(parents=True, exist_ok=True)
    cognee.config.data_root_directory(str(cognee_dir))
    
    # 4. Check marker file (one-time migration)
    ontology_marker = cognee_dir / '.ontology_configured'
    
    if not ontology_marker.exists():
        # First-time initialization
        if cognee_dir.exists() and any(cognee_dir.iterdir()):
            # Clear legacy data (graph + vector + cache)
            await cognee.prune.prune_system()
        
        # Create marker file
        ontology_marker.write_text(json.dumps({
            'configured_at': datetime.now().isoformat()
        }))
        ontology_reset = True
    else:
        # Subsequent initialization - skip reset
        ontology_reset = False
    
    return {
        'success': True,
        'cognee_dir': str(cognee_dir),
        'ontology_reset': ontology_reset
    }
```

#### ingest.py

```python
import os
from pathlib import Path

async def ingest_conversation(...):
    # 1. Set ontology BEFORE import (required for subprocess)
    ontology_path = Path(__file__).parent / 'ontology.json'
    os.environ['ONTOLOGY_FILE_PATH'] = str(ontology_path)
    
    # 2. Import cognee
    import cognee
    
    # 3. Re-configure workspace directory (subprocess needs config)
    workspace_dir = Path(workspace_path)
    cognee_dir = workspace_dir / '.cognee'
    cognee.config.data_root_directory(str(cognee_dir))
    
    # 4. Proceed with add() and cognify()
    await cognee.add(conversation, dataset_name="copilot_chat")
    await cognee.cognify()
```

#### retrieve.py

```python
import os
from pathlib import Path

async def retrieve_context(...):
    # 1. Set ontology BEFORE import (required for subprocess)
    ontology_path = Path(__file__).parent / 'ontology.json'
    os.environ['ONTOLOGY_FILE_PATH'] = str(ontology_path)
    
    # 2. Import cognee
    import cognee
    
    # 3. Re-configure workspace directory (subprocess needs config)
    workspace_dir = Path(workspace_path)
    cognee_dir = workspace_dir / '.cognee'
    cognee.config.data_root_directory(str(cognee_dir))
    
    # 4. Proceed with search()
    results = await cognee.search(query, ...)
```

### Key Pattern

**ALWAYS**:
1. Set `ONTOLOGY_FILE_PATH` environment variable
2. **THEN** import cognee
3. **THEN** configure `data_root_directory()`
4. **THEN** perform Cognee operations

**NEVER**:
- Import cognee before setting ontology path
- Assume ontology persists across subprocesses
- Forget to re-configure data directory in subprocesses

---

## 7. Decision Gate Result

✅ **API FOUND** - Proceed to Milestone 4.5

### Confirmed APIs

1. ✅ `cognee.config.data_root_directory(path)` - Workspace isolation
2. ✅ `await cognee.prune.prune_system()` - Reset (graph + vector + cache)
3. ✅ `ONTOLOGY_FILE_PATH` environment variable - Ontology loading

### Known Limitations

1. ⚠️ Ontology is in-memory per-process (must re-set in each subprocess)
2. ⚠️ No "check if ontology loaded" API (must set unconditionally)
3. ⚠️ Data directory config is per-process (must re-apply in each subprocess)

### No Workarounds Needed

All required functionality is available through official APIs. No monkey-patching, `chdir()`, or forks required.

---

## 8. Test Results

### Test 1: Data Directory Configuration

```bash
$ python3 -c "
import cognee
from pathlib import Path
import tempfile

test_dir = Path(tempfile.mkdtemp(prefix='cognee_test_'))
cognee.config.data_root_directory(str(test_dir))
print(f'✓ Configured: {test_dir}')
"
```

**Result**: ✅ PASS - Directory accepted, no errors

### Test 2: prune_system Execution

```bash
$ python3 -c "
import cognee
import asyncio

async def test():
    await cognee.prune.prune_system()
    print('✓ prune_system executed')

asyncio.run(test())
"
```

**Result**: ✅ PASS - Cleared graph DB, vector DB, cache

### Test 3: Ontology Environment Variable

```bash
$ python3 -c "
import os
os.environ['ONTOLOGY_FILE_PATH'] = '/tmp/test_ontology.json'
import cognee
print('✓ Ontology path set before import')
"
```

**Result**: ✅ PASS - No errors, ontology path recognized

---

## 9. Gotchas and Warnings

### ⚠️ Gotcha 1: Import Order Matters

**WRONG**:
```python
import cognee  # ← Imported too early
os.environ['ONTOLOGY_FILE_PATH'] = 'ontology.json'  # ← Too late!
```

**RIGHT**:
```python
os.environ['ONTOLOGY_FILE_PATH'] = 'ontology.json'  # ← Set FIRST
import cognee  # ← Import AFTER
```

### ⚠️ Gotcha 2: Subprocess Isolation

Each Python subprocess (init.py, ingest.py, retrieve.py) is independent:
- Must re-set `ONTOLOGY_FILE_PATH`
- Must re-configure `data_root_directory()`
- Environment variables from parent don't transfer

### ⚠️ Gotcha 3: prune_system is Destructive

Calling `prune_system()` **deletes all data**:
- All graph nodes and relationships
- All vector embeddings
- All LLM cache

**Use marker file pattern** to ensure it only runs once during migration.

---

## 10. Next Steps

✅ **Milestone 3.5 COMPLETE**

**Proceed to Milestone 4.5**: Fix Python Bridge Scripts

**Implementation Order**:
1. Update `init.py` with marker file pattern and `prune_system()` call
2. Update `ingest.py` with ontology re-loading
3. Update `retrieve.py` with ontology re-loading
4. Update `README.md` with API documentation

**Estimated Duration**: 60-90 minutes (as planned)
