# Implementation Plan: VS Code Chat Memory Extension with Automatic Context Retrieval

**Plan ID**: 002  
**Created**: November 9, 2025  
**Status**: Draft  
**Depends On**: Plan 001 (Cognee Walkthrough Implementation)

---

## Objective

Transform this repository into a VS Code extension that automatically captures GitHub Copilot chat conversations and retrieves relevant context from Cognee memory without requiring manual user prompts. The extension will:

1. **Automatic Capture**: Store all user/assistant chat exchanges in Cognee as they occur
2. **Automatic Retrieval**: Query Cognee before each Copilot response to inject relevant context
3. **Transparent Operation**: Memory capture and retrieval happen invisibly to the user
4. **Workspace Isolation**: Each VS Code workspace maintains separate memory context
5. **Chat-Only Focus**: Ingest ONLY chat conversations, NOT code repository files

---

## Assumptions

1. **Repository Restructure**: Current repository will be reorganized to separate learning materials from extension code
2. **TypeScript Development**: VS Code extension will be written in TypeScript with standard tooling (vscode, esbuild)
3. **Python Bridge**: Extension will communicate with Cognee via Python subprocess calls
4. **Cognee Installation**: User will have Python 3.8+ and Cognee 0.3.4 installed locally (reuse existing setup)
5. **VS Code API**: Extension will use official Chat Participant API (`vscode.chat.createChatParticipant`)
6. **Storage Location**: Cognee data stored in workspace `.cognee/` directory (gitignored, workspace-local)
7. **No External Server**: All processing happens locally (extension → Python → Cognee → local databases)
8. **Latency Target**: Context retrieval completes in <1000ms to avoid degrading chat responsiveness (stretch goal: <500ms after optimization)
9. **Memory Scope**: Extension captures only GitHub Copilot chat interactions, not inline completions or other editor activity

---

## Open Questions

**RESOLVED**: Configuration via VS Code settings (no custom UI needed); per-workspace settings supported via `.vscode/settings.json`  
**RESOLVED**: Dual limits - `maxContextResults` (default 3) AND `maxContextTokens` (default 2000) to prevent prompt bloat  
**RESOLVED**: Start with single generic chat ontology; support for custom ontologies deferred to future enhancement  
**RESOLVED**: Initialization failures logged to Output Channel ("Cognee Memory") with actionable error messages; warnings shown via `vscode.window.showWarningMessage()` for critical failures (missing API key); terminal integration via Output Channel API  
**RESOLVED**: Strict workspace isolation - each workspace has independent `.cognee/` directory, no memory sharing across workspaces  
**RESOLVED**: Debug logging includes: retrieval latency (ms), result count, token count, API errors, ingestion success/failure, Cognee operation timing, Python subprocess errors  
**NEW REQUIREMENT**: Implement recency and importance weighting for retrieved context (prioritize recent + high-importance memories)  
**NEW REQUIREMENT**: Configure hybrid graph-vector retrievers (combine graph relationships + vector similarity for better context quality)

---

## Plan

### Milestone 1: Repository Restructure and Cleanup

**Objective**: Reorganize current repository to separate Cognee learning materials from VS Code extension development, creating clear boundaries between tutorial content and production extension code.

**Deliverables**:
- New directory structure with `extension/` for VS Code code and `tutorial/` for learning materials
- Updated documentation reflecting new structure
- Migration guide for existing setup

**Steps**:

1. **Create new directory structure**:

   ```text
   cognee/
   ├── extension/               # VS Code extension (new)
   │   ├── src/
   │   │   ├── extension.ts     # Main extension entry point
   │   │   ├── chatParticipant.ts
   │   │   └── cogneeClient.ts
   │   ├── bridge/              # Python bridge scripts
   │   │   ├── ingest.py
   │   │   ├── retrieve.py
   │   │   └── init.py
   │   ├── package.json
   │   ├── tsconfig.json
   │   ├── esbuild.js
   │   └── README.md
   ├── tutorial/                # Cognee learning materials (moved)
   │   ├── examples/            # from root examples/
   │   ├── data/                # from root data/
   │   ├── artifacts/           # from root artifacts/
   │   ├── utils/               # from root utils/
   │   ├── requirements.txt     # from root requirements.txt
   │   ├── .env.example         # from root .env.example
   │   └── README.md            # adapted from root README.md
   ├── Planning/                # stays at root
   ├── .github/                 # stays at root
   ├── .vscode/                 # stays at root (updated tasks)
   ├── .gitignore               # updated with extension patterns
   └── README.md                # new root README explaining both tutorial and extension
   ```

2. **Move tutorial files using git mv to preserve history**:
   - Create `tutorial/` directory: `mkdir tutorial`
   - Move directories: `git mv examples tutorial/`, `git mv data tutorial/`, `git mv artifacts tutorial/`, `git mv utils tutorial/`
   - Copy `requirements.txt` to `tutorial/requirements.txt` (keep root for extension Python deps)
   - Copy `.env.example` to `tutorial/.env.example`
   - Move remaining files: `git mv download_data.py tutorial/`, `git mv test_setup.py tutorial/`
   - Commit moves before proceeding: `git commit -m "Restructure: move tutorial files to tutorial/ subdirectory"`

3. **Update `.gitignore`** with extension-specific patterns:

   ```gitignore
   # Python (existing)
   __pycache__/
   *.py[cod]
   *$py.class
   .venv/
   venv/
   ENV/
   .env
   
   # Cognee data (existing)
   .cognee/
   
   # Tutorial artifacts (existing)
   tutorial/artifacts/*.html
   tutorial/artifacts/*.json
   tutorial/artifacts/*.png
   !tutorial/artifacts/.gitkeep
   !tutorial/artifacts/README.md
   
   # Extension build artifacts (new)
   extension/out/
   extension/dist/
   extension/node_modules/
   extension/*.vsix
   
   # TypeScript (new)
   *.js.map
   *.d.ts.map
   
   # VS Code workspace (new)
   .cognee/  # workspace-local Cognee storage
   ```

4. **Create new root `README.md`**:
   - Section 1: Project overview (tutorial + extension)
   - Section 2: Quick links to `tutorial/README.md` and `extension/README.md`
   - Section 3: Prerequisites (Python 3.8+, Node.js 18+, VS Code 1.85+)
   - Section 4: Directory structure explanation
   - Section 5: Development workflow (tutorial first, then extension)

5. **Update `.vscode/tasks.json`**:
   - Update existing "Run Cognee Walkthrough" task path to `tutorial/examples/cognee_walkthrough.py`
   - Add new tasks: "Build Extension", "Watch Extension", "Package Extension"

6. **Create `extension/README.md`**:
   - Extension overview and features
   - Installation instructions (from VSIX)
   - Development setup instructions
   - Architecture overview (TypeScript → Python bridge → Cognee)
   - Configuration options

7. **Update Planning documents**:
   - Update Plan 001 file paths to reference `tutorial/` subdirectory
   - Add migration note explaining restructure rationale

**Acceptance Criteria**:

- All tutorial files moved to `tutorial/` subdirectory without loss
- `tutorial/examples/cognee_walkthrough.py` still runs successfully from new location
- Root `README.md` clearly separates tutorial from extension documentation
- `.gitignore` covers both Python tutorial and TypeScript extension artifacts
- `.vscode/tasks.json` tasks work from new file locations
- `extension/` directory created with placeholder structure (empty files OK for Milestone 1)
- No broken relative imports or path references in moved Python files
- Git history preserved for moved files (use `git mv` commands)

---

### Milestone 2: VS Code Extension Scaffolding

**Objective**: Set up TypeScript extension project with proper build tooling, VS Code API integration, and basic extension activation.

**Deliverables**:
- Complete TypeScript extension project structure
- Build and packaging configuration
- Extension manifest with Chat Participant contribution
- Development tooling (linting, debugging)

**Steps**:

1. **Initialize Node.js project** in `extension/`:

   ```bash
   cd extension/
   npm init -y
   ```

2. **Install dependencies**:
   - TypeScript tooling: `typescript@^5.3.0`, `@types/vscode@^1.85.0`, `@types/node@^20.0.0`
   - Build tools: `esbuild@^0.19.0`
   - Testing: `@vscode/test-electron@^2.3.0`
   - Linting: `eslint@^8.55.0`, `@typescript-eslint` packages

3. **Create `extension/package.json`** manifest with required fields:
   - **Identity**: Name "cognee-chat-memory", display name, version 0.1.0
   - **VS Code Requirements**: Engine `^1.85.0` (for Chat Participant API)
   - **Activation**: `onStartupFinished` event
   - **Entry Point**: `./dist/extension.js`
   - **Chat Participant Contribution**: Register participant with ID "cognee-memory"
   - **Configuration Properties** (7 settings):
     - `cogneeMemory.enabled` (boolean, default true): Toggle memory on/off
     - `cogneeMemory.maxContextResults` (number, default 3): Limit retrieved results
     - `cogneeMemory.maxContextTokens` (number, default 2000): Token budget for context
     - `cogneeMemory.recencyWeight` (number, default 0.3): Recency scoring weight
     - `cogneeMemory.importanceWeight` (number, default 0.2): Importance scoring weight
     - `cogneeMemory.pythonPath` (string, default "python3"): Python interpreter path
     - `cogneeMemory.logLevel` (enum ["error", "warn", "info", "debug"], default "info"): Log verbosity
   - **Scripts**: compile (esbuild production), watch (esbuild watch mode), lint (eslint), package (vsce)

4. **Create `extension/tsconfig.json`** with TypeScript configuration:
   - Target ES2022, module commonjs
   - Strict mode enabled
   - Source maps enabled for debugging
   - Root directory `./src`, output directory `./out`
   - Exclude node_modules, .vscode-test, build artifacts

5. **Create `extension/esbuild.js`** build script:
   - Entry point: `src/extension.ts`
   - Bundle format: CommonJS
   - Output: `dist/extension.js`
   - External: Mark 'vscode' as external (provided by VS Code runtime)
   - Production mode: Minify code
   - Development mode: Include source maps
   - Watch mode: Rebuild on file changes

6. **Create stub `extension/src/extension.ts`**:
   - Export `activate(context)` function that logs activation message
   - Export `deactivate()` function for cleanup
   - Leave placeholder comment for Milestone 5 chat participant registration

7. **Create `.vscode/launch.json`** debug configuration:
   - Configuration name: "Run Extension"
   - Type: `extensionHost` (VS Code extension debugging)
   - Extension development path: `${workspaceFolder}/extension`
   - Output files pattern: `${workspaceFolder}/extension/dist/**/*.js`
   - Pre-launch task: Run "npm: watch" to build extension

8. **Update `.vscode/tasks.json`** with extension build tasks:
   - Add "npm: watch" task running `npm run watch` in `extension/` directory
   - Configure as background task (isBackground: true)
   - Set up esbuild problem matcher for error reporting
   - Define background patterns: "[watch] build started" / "[watch] build finished"
   - Keep existing tutorial task unchanged

**Acceptance Criteria**:

- `npm install` completes without errors in `extension/` directory
- `npm run compile` produces `extension/dist/extension.js` bundle
- `npm run watch` rebuilds on TypeScript file changes
- Extension activates when launched via F5 (Run Extension debug configuration)
- Console log "Cognee Chat Memory extension activated" appears in Extension Host output
- `extension/package.json` declares Chat Participant contribution point
- TypeScript compiler reports no errors
- ESLint runs without errors (after creating `.eslintrc.json` config)

---

### Milestone 3: Python Bridge Implementation

**Objective**: Implement Python scripts that handle Cognee interactions (initialization, ingestion, retrieval) and provide clean subprocess interface for TypeScript extension.

**Deliverables**:
- Python bridge scripts for Cognee operations
- Subprocess communication protocol (JSON over stdout)
- Error handling and logging
- Chat-specific ontology definition

**Steps**:

1. **Create `extension/bridge/init.py`** for Cognee initialization:
   
   **Purpose**: Initialize Cognee for a workspace with proper API key configuration
   
   **Usage**: `python init.py <workspace_path>`
   
   **Expected Behavior**:
   - Load environment variables from `<workspace_path>/.env` if exists
   - Check for `OPENAI_API_KEY` environment variable
   - Call `await cognee.config.set_llm_api_key(api_key)` to configure Cognee
   - Create workspace-local `.cognee/` directory for data storage
   - Return success/failure status via JSON
   
   **JSON Output Contract**:
   ```json
   // Success case:
   {"success": true, "cognee_dir": "/path/to/workspace/.cognee"}
   
   // Failure case:
   {"success": false, "error": "OPENAI_API_KEY not found"}
   ```
   
   **Error Handling**:
   - Missing command-line arguments → Exit code 1 with error JSON
   - Missing API key → Return error JSON with descriptive message
   - Cognee import failures → Catch exception, return error JSON
   
   **Implementation Notes**:
   - Use `asyncio.run()` to execute async Cognee functions
   - Use `pathlib.Path` for cross-platform path handling
   - Exit with code 0 on success, 1 on failure

2. **Create `extension/bridge/ingest.py`** for chat message ingestion with timestamp and importance metadata:
   
   **Purpose**: Store user/assistant conversation pair in Cognee with metadata for recency/importance scoring
   
   **Usage**: `python ingest.py <workspace_path> <user_message> <assistant_message> <importance>`
   
   **Expected Behavior**:
   - Initialize Cognee with API key from workspace `.env`
   - Generate ISO 8601 timestamp for conversation
   - Format conversation as `"User: {msg}\nAssistant: {msg}"`
   - Create metadata dict with: timestamp, importance (0-1 scale), message lengths
   - Call `await cognee.add(conversation, dataset_name="copilot_chat", metadata=metadata)`
   - Call `await cognee.cognify()` to build/update knowledge graph
   - Return ingestion success with character count and timestamp
   
   **JSON Output Contract**:
   ```json
   // Success case:
   {"success": true, "ingested_chars": 357, "timestamp": "2025-11-09T14:32:21.234Z"}
   
   // Failure case:
   {"success": false, "error": "OPENAI_API_KEY not found"}
   ```
   
   **Arguments**:
   - `workspace_path`: Path to workspace root (for .env loading)
   - `user_message`: User's question/prompt
   - `assistant_message`: Assistant's response
   - `importance`: Optional float (0-1), defaults to 0.0
   
   **Implementation Notes**:
   - Use `datetime.now().isoformat()` for timestamp generation
   - Dataset name "copilot_chat" groups all chat conversations
   - Metadata enables recency/importance weighting in retrieval
   - Handle missing arguments (min 3 required)

3. **Create `extension/bridge/retrieve.py`** for context retrieval with hybrid graph-vector search and recency/importance weighting:
   
   **Purpose**: Search Cognee memory for relevant context using hybrid graph-vector approach with custom scoring
   
   **Usage**: `python retrieve.py <workspace_path> <query> <max_results> <max_tokens> <recency_weight> <importance_weight>`
   
   **Expected Behavior**:
   - Initialize Cognee with API key
   - Execute hybrid search: `await cognee.search(query_text=query, search_type=SearchType.GRAPH_COMPLETION)`
   - For each result, calculate weighted final score combining:
     - Base relevance score from Cognee (graph + vector similarity)
     - Recency score: `max(0, 1 - (age_days / 30))` (linear decay over 30 days)
     - Importance score: From metadata (0-1 scale)
     - Formula: `final_score = base_score * (1 - recency_weight - importance_weight) + recency_score * recency_weight + importance * importance_weight`
   - Sort results by final score (descending)
   - Apply dual limits: Return top `max_results` items OR stop when `total_tokens` exceeds `max_tokens` (whichever comes first)
   - Estimate tokens using word count: `len(text.split())`
   
   **JSON Output Contract**:
   ```json
   // Success case:
   {
     "success": true,
     "results": [
       {"text": "...", "metadata": {...}, "score": 0.85},
       {"text": "...", "metadata": {...}, "score": 0.72}
     ],
     "result_count": 2,
     "total_tokens": 487
   }
   
   // Failure case:
   {"success": false, "error": "OPENAI_API_KEY not found"}
   ```
   
   **Arguments**:
   - `workspace_path`: Path to workspace root
   - `query`: User's search query
   - `max_results`: Maximum number of results to return (default 3)
   - `max_tokens`: Token budget limit (default 2000)
   - `recency_weight`: Weight for recency scoring 0-1 (default 0.3)
   - `importance_weight`: Weight for importance scoring 0-1 (default 0.2)
   
   **Scoring Algorithm Pseudocode**:
   ```
   for each search_result:
     base_score = result.score  // from Cognee
     recency_score = calculate_recency(result.metadata.timestamp, now)
     importance_score = result.metadata.importance
     
     final_score = (base_score * base_weight) + 
                   (recency_score * recency_weight) +
                   (importance_score * importance_weight)
     
     where base_weight = 1 - recency_weight - importance_weight
   ```
   
   **Implementation Notes**:
   - Use `SearchType.GRAPH_COMPLETION` for hybrid graph-vector search
   - Handle timestamp parsing errors gracefully (default recency_score = 0.5)
   - Stop adding results when token limit reached (prevents prompt bloat)

4. **Create `extension/bridge/ontology.json`** for chat-centric entity/relationship schema:

   ```json
   {
     "entities": [
       {
         "name": "User",
         "type": "Person",
         "attributes": ["name", "role"],
         "description": "Person asking questions in chat"
       },
       {
         "name": "Question",
         "type": "Message",
         "attributes": ["text", "timestamp", "intent"],
         "description": "User's question or request"
       },
       {
         "name": "Answer",
         "type": "Message",
         "attributes": ["text", "timestamp", "confidence"],
         "description": "Assistant's response"
       },
       {
         "name": "Topic",
         "type": "Category",
         "attributes": ["name", "domain"],
         "description": "Subject area or theme (e.g., 'async programming', 'API design')"
       },
       {
         "name": "Concept",
         "type": "Knowledge",
         "attributes": ["term", "definition", "difficulty"],
         "description": "Technical concept explained (e.g., 'event loop', 'dependency injection')"
       },
       {
         "name": "Problem",
         "type": "Issue",
         "attributes": ["description", "severity"],
         "description": "Issue or challenge described by user"
       },
       {
         "name": "Solution",
         "type": "Approach",
         "attributes": ["description", "complexity"],
         "description": "Proposed solution or approach"
       },
       {
         "name": "Decision",
         "type": "Choice",
         "attributes": ["description", "rationale", "importance"],
         "description": "Decision made during conversation (e.g., 'use FastAPI', 'avoid threads')"
       }
     ],
     "relationships": [
       {
         "source": "User",
         "target": "Question",
         "type": "ASKS",
         "description": "User poses a question"
       },
       {
         "source": "Question",
         "target": "Topic",
         "type": "HAS_TOPIC",
         "description": "Question relates to a topic"
       },
       {
         "source": "Question",
         "target": "Concept",
         "type": "MENTIONS",
         "description": "Question references a concept"
       },
       {
         "source": "Question",
         "target": "Problem",
         "type": "DESCRIBES",
         "description": "Question describes a problem"
       },
       {
         "source": "Answer",
         "target": "Question",
         "type": "ADDRESSES",
         "description": "Answer responds to question"
       },
       {
         "source": "Answer",
         "target": "Solution",
         "type": "PROPOSES",
         "description": "Answer suggests a solution"
       },
       {
         "source": "Answer",
         "target": "Concept",
         "type": "EXPLAINS",
         "description": "Answer explains a concept"
       },
       {
         "source": "Solution",
         "target": "Problem",
         "type": "SOLVES",
         "description": "Solution addresses problem"
       },
       {
         "source": "Topic",
         "target": "Topic",
         "type": "RELATED_TO",
         "description": "Topics are related (e.g., 'async' related to 'concurrency')"
       },
       {
         "source": "Question",
         "target": "Question",
         "type": "FOLLOWS_UP",
         "description": "Question continues previous discussion"
       },
       {
         "source": "Decision",
         "target": "Topic",
         "type": "IMPACTS",
         "description": "Decision affects a topic area"
       },
       {
         "source": "Concept",
         "target": "Concept",
         "type": "PREREQUISITE_FOR",
         "description": "Concept builds on another concept"
       }
     ],
     "extraction_strategy": {
       "method": "automatic",
       "description": "Cognee's LLM-powered extraction during cognify() automatically identifies entities and relationships from conversation text without manual annotation",
       "benefits": [
         "No manual entity tagging required",
         "Consistent extraction across conversations",
         "Adapts to conversation context automatically"
       ]
     },
     "retrieval_benefits": {
       "multi_path_traversal": "Graph enables finding related content through multiple relationship paths (e.g., Question → HAS_TOPIC → Topic → RELATED_TO → Topic → HAS_TOPIC → Past Question)",
       "semantic_plus_structural": "Combines vector similarity (semantic meaning) with graph relationships (structural connections) for higher quality context",
       "example_query": {
         "query": "Should I use asyncio or threading for my API?",
         "retrieval_paths": [
           "Vector: Direct semantic match to past async/threading discussion",
           "Graph: Decision 'use FastAPI' → IMPACTS → Topic 'API design' → RELATED_TO → Topic 'async patterns'",
           "Graph: Concept 'asyncio' ← PREREQUISITE_FOR ← Concept 'async API patterns'"
         ],
         "result_quality": "Retrieves not just semantically similar text, but also contextually related decisions and prerequisite concepts"
       }
     },
     "metrics_to_track": [
       "Entity counts per type (User, Question, Answer, Topic, Concept, Problem, Solution, Decision)",
       "Relationship counts per type",
       "Graph traversal depth during retrieval (how many hops to find context)",
       "Topic distribution (most discussed topics)",
       "Decision count (important conversation outcomes)"
     ]
   }
   ```

   **Ontology Usage Notes**:
   - Cognee will automatically extract these entities/relationships during `cognify()` using LLM-powered analysis
   - No manual entity tagging required from users
   - Graph structure enables multi-path retrieval (semantic + structural relevance)
   - Metrics help monitor memory quality and coverage over time
   - Schema focuses on chat interaction patterns (questions, answers, topics) rather than code artifacts

5. **Create `extension/bridge/requirements.txt`**:

   ```txt
   cognee==0.3.4
   python-dotenv>=1.0.0
   ```

6. **Create `extension/bridge/README.md`** documenting:
   - Bridge architecture (TypeScript spawns Python subprocesses)
   - Script usage examples with expected JSON outputs
   - Error codes and troubleshooting
   - Performance characteristics (typical latency ranges)
   - Hybrid graph-vector search explanation (how GRAPH_COMPLETION combines graph relationships + vector similarity)
   - Recency/importance weighting algorithm details
   - Token counting methodology (rough word-based estimate)
   - Ontology structure and extraction strategy

7. **Make scripts executable**:

   ```bash
   chmod +x extension/bridge/*.py
   ```

**Acceptance Criteria**:

- All three Python scripts (`init.py`, `ingest.py`, `retrieve.py`) execute without errors when called directly
- Scripts output valid JSON to stdout
- Error cases return `{"success": false, "error": "..."}` format
- `init.py` successfully initializes Cognee with API key from workspace `.env`
- `ingest.py` successfully adds conversation to Cognee with timestamp and importance metadata
- `retrieve.py` successfully performs hybrid graph-vector search with recency/importance weighting
- `retrieve.py` respects both `max_results` AND `max_tokens` limits (returns whichever is reached first)
- Scripts handle missing arguments gracefully (exit code 1, error JSON)
- Scripts handle missing API key gracefully (error JSON, no stack trace)
- All scripts use workspace-local `.cognee/` directory for Cognee data
- Bridge dependencies installed via `pip install -r extension/bridge/requirements.txt`
- Hybrid search combines graph relationships (ontology-based) with vector similarity (embeddings)
- Recency scoring decays linearly over 30 days (age_days / 30)
- Importance scoring uses 0-1 scale from metadata
- `ontology.json` defines 8 chat-centric entities (User, Question, Answer, Topic, Concept, Problem, Solution, Decision)
- `ontology.json` defines 12 relationship types supporting multi-path retrieval
- Ontology extraction strategy documented (Cognee's automatic LLM-powered extraction)
- Retrieval benefits documented (semantic + structural relevance, multi-path graph traversal)
- Ontology validation: After first `cognify()`, log entity/relationship counts to verify extraction is working (should extract at least 1 entity per conversation)

---

### Debug Logging Strategy

**Log Levels** (configurable via `cogneeMemory.logLevel`):

- **error**: Critical failures (missing API key, Python spawn errors, database errors)
- **warn**: Performance issues (latency >500ms), fallback behaviors, configuration warnings
- **info**: Normal operations (init success, conversation ingested, context retrieved, operation timing)
- **debug**: Detailed diagnostics (query parameters, result scores, token counts, subprocess communication)

**Logged Metrics** (all operations):

1. **Initialization**:
   - Workspace path
   - Initialization duration (ms)
   - Cognee directory path
   - Success/failure status
   - Error messages if failed

2. **Ingestion**:
   - User message length (chars)
   - Assistant message length (chars)
   - Importance score (0-1)
   - Total ingested characters
   - Timestamp (ISO 8601)
   - Ingestion duration (ms)
   - `cognify()` success/failure

3. **Retrieval**:
   - Query length (chars)
   - Query preview (first 50 chars, debug level)
   - Max results configured
   - Max tokens configured
   - Recency weight
   - Importance weight
   - Result count returned
   - Total tokens returned
   - Retrieval duration (ms)
   - Latency warning if >500ms
   - Top result scores (debug level)

4. **Python Subprocess**:
   - Script name executed
   - Arguments passed (sanitized, no API keys)
   - Exit code
   - Stdout/stderr output (error level only)
   - Subprocess spawn errors
   - Timeout events

5. **Configuration Changes**:
   - Settings updated (which settings changed)
   - Extension enabled/disabled events
   - Workspace changes

**Output Channel Best Practices** (VS Code standards):

- Use `vscode.window.createOutputChannel('Cognee Memory')` for all logs
- Include ISO 8601 timestamps on every log line
- Format: `[timestamp] [LEVEL] message {json_data}`
- Critical errors also shown via `vscode.window.showWarningMessage()` for user visibility
- Output Channel automatically available in "Output" panel dropdown
- Users can toggle visibility without restarting extension
- Logs persist across VS Code sessions (Output Channel buffer)

**Example Log Output**:

```text
[2025-11-09T14:32:15.123Z] [INFO] Initializing Cognee {"workspace":"/home/user/project"}
[2025-11-09T14:32:15.456Z] [INFO] Cognee initialized successfully {"duration":333,"cognee_dir":"/home/user/project/.cognee"}
[2025-11-09T14:32:20.789Z] [DEBUG] Retrieving context {"query_length":45,"max_results":3,"max_tokens":2000,"recency_weight":0.3,"importance_weight":0.2}
[2025-11-09T14:32:21.012Z] [INFO] Context retrieved {"result_count":2,"total_tokens":487,"duration":223}
[2025-11-09T14:32:21.234Z] [DEBUG] Ingesting conversation {"user_length":45,"assistant_length":312,"importance":0.0}
[2025-11-09T14:32:21.678Z] [INFO] Conversation ingested {"chars":357,"timestamp":"2025-11-09T14:32:21.234Z","duration":444}
[2025-11-09T14:33:05.901Z] [WARN] Retrieval latency exceeded target {"duration":723,"target":500,"query_preview":"How do I implement async patterns in Python?"}
[2025-11-09T14:33:10.123Z] [ERROR] Cognee initialization failed {"error":"OPENAI_API_KEY not found","duration":15}
```

---

### Milestone 4: TypeScript-Python Integration

**Objective**: Implement TypeScript client for spawning Python bridge scripts, handling subprocess communication, parsing JSON responses, and managing errors.

**Deliverables**:
- TypeScript `CogneeClient` class wrapping Python bridge calls
- Subprocess management with timeout and error handling
- Configuration loading and validation
- Unit tests for client methods

**Steps**:

1. **Create `extension/src/cogneeClient.ts`** TypeScript client class:
   
   **Purpose**: Provide high-level TypeScript API for spawning Python bridge scripts and handling subprocess communication
   
   **Class Structure**:
   ```typescript
   interface CogneeResult {
     success: boolean;
     error?: string;
     [key: string]: any;  // Additional fields from Python scripts
   }
   
   export class CogneeClient {
     // Private fields
     private readonly workspacePath: string;
     private readonly pythonPath: string;
     private readonly bridgePath: string;
     private readonly maxContextResults: number;
     private readonly maxContextTokens: number;
     private readonly recencyWeight: number;
     private readonly importanceWeight: number;
     private readonly logLevel: string;
     private readonly outputChannel: vscode.OutputChannel;
     
     // Public methods
     constructor(workspacePath: string);
     async initialize(): Promise<boolean>;
     async ingest(userMessage: string, assistantMessage: string, importance?: number): Promise<boolean>;
     async retrieve(query: string): Promise<string[]>;
     
     // Private helpers
     private log(level: string, message: string, data?: any): void;
     private runPythonScript(scriptName: string, args: string[]): Promise<CogneeResult>;
   }
   ```
   
   **Constructor Implementation**:
   - Accept `workspacePath` parameter
   - Load configuration from `vscode.workspace.getConfiguration('cogneeMemory')`
   - Read all 7 settings: pythonPath, maxContextResults, maxContextTokens, recencyWeight, importanceWeight, logLevel
   - Create Output Channel: `vscode.window.createOutputChannel('Cognee Memory')`
   - Resolve bridge path: `path.join(__dirname, '..', 'bridge')`
   
   **initialize() Method**:
   - Call `runPythonScript('init.py', [workspacePath])`
   - Measure duration with `Date.now()`
   - Log "Initializing Cognee" (info level) before call
   - Log "Cognee initialized successfully" (info level) on success
   - Show warning message via `vscode.window.showWarningMessage()` on failure
   - Return `boolean` (true if initialized, false otherwise)
   
   **ingest() Method**:
   - Call `runPythonScript('ingest.py', [workspacePath, userMessage, assistantMessage, importance.toString()])`
   - Log "Ingesting conversation" (debug level) with message lengths
   - Log "Conversation ingested" (info level) with character count and timestamp
   - Return `boolean` (true if ingested, false otherwise)
   - Catch errors and return false (don't throw)
   
   **retrieve() Method**:
   - Call `runPythonScript('retrieve.py', [workspacePath, query, maxContextResults, maxContextTokens, recencyWeight, importanceWeight])`
   - All numeric config values converted to strings for command-line args
   - Extract text from results array: `results.map(r => r.text)`
   - Log "Context retrieved" (info level) with result count, tokens, and duration
   - Log warning if duration > 1000ms: "Retrieval latency exceeded target"
   - Log info if duration > 500ms: "Retrieval latency above stretch goal"
   - Return `string[]` (array of context texts, empty array on error)
   
   **log() Private Method**:
   - Compare log levels (error=0, warn=1, info=2, debug=3)
   - Only append to Output Channel if message level <= current log level setting
   - Format: `[ISO8601_timestamp] [LEVEL] message {json_data}`
   - Use `outputChannel.appendLine()` for output
   
   **runPythonScript() Private Method**:
   - Use Node.js `spawn()` from 'child_process' module
   - Spawn process: `spawn(pythonPath, [scriptPath, ...args])`
   - Collect stdout and stderr via event listeners
   - On process 'close' event:
     - If exit code !== 0: Reject with error including stderr
     - If exit code === 0: Parse stdout as JSON and resolve
     - If JSON parse fails: Reject with parse error
   - On process 'error' event: Reject with spawn error
   - Set 10-second timeout: Kill process and reject if not completed
   - Return `Promise<CogneeResult>`

2. **Update `extension/src/extension.ts`** to instantiate client on activation:
   - Import CogneeClient class
   - In `activate()` function:
     - Get workspace folder from `vscode.workspace.workspaceFolders[0]`
     - If no workspace folder, show warning and return early
     - Create client: `cogneeClient = new CogneeClient(workspaceFolder.uri.fsPath)`
     - Call `await cogneeClient.initialize()`
     - If initialization fails, warning already shown by client
   - Store client in module-level variable for use by chat participant (Milestone 5)

3. **Add error handling helpers** to `extension/src/cogneeClient.ts`:
   - `isEnabled()` method: Return `vscode.workspace.getConfiguration('cogneeMemory').get('enabled')`
   - `validateConfiguration()` method: Check if Python path exists and API key is configured
   - Optional: `getStatusBarItem()` method to create status bar indicator showing memory status

4. **Create `extension/src/test/cogneeClient.test.ts`** with unit tests:
   - Test `initialize()` with valid workspace path (requires mock Python subprocess)
   - Test `initialize()` with invalid workspace path (should return false)
   - Test `ingest()` with valid conversation pair
   - Test `retrieve()` with query string
   - Test error handling: Missing Python executable, invalid JSON output, subprocess timeout
   - Use VS Code testing framework: `@vscode/test-electron`

**Acceptance Criteria**:

- `CogneeClient` successfully spawns Python subprocess and parses JSON response
- `initialize()` method completes without errors when API key is configured
- `ingest()` method successfully stores conversation in Cognee
- `retrieve()` method returns array of context strings
- Client handles missing API key gracefully (returns error, doesn't crash)
- Client handles Python spawn errors gracefully (timeout, invalid path)
- Client respects `cogneeMemory.enabled` configuration setting
- Client respects `cogneeMemory.maxContextResults` configuration setting
- Client logs diagnostic information to console (not user-visible errors)
- Extension activates and initializes `CogneeClient` on workspace open

---

### Milestone 5: Chat Participant Implementation with Automatic Context Retrieval

**Objective**: Register VS Code Chat Participant that automatically retrieves context from Cognee before each response and captures conversations after completion.

**Deliverables**:
- Chat Participant registered with VS Code Chat API
- Automatic context retrieval before Copilot invocation
- Automatic conversation capture after assistant response
- User-visible memory status indicators

**Steps**:

1. **Create `extension/src/chatParticipant.ts`** for automatic memory integration:
   
   **Purpose**: Register VS Code Chat Participant that automatically retrieves context before responding and captures conversations after completion
   
   **Function Signature**:
   ```typescript
   export function registerChatParticipant(
     context: vscode.ExtensionContext,
     cogneeClient: CogneeClient
   ): vscode.Disposable
   ```
   
   **Chat Request Handler Workflow**:
   
   1. **Check if Memory Enabled**:
      - Read `cogneeMemory.enabled` configuration
      - If disabled: Stream markdown "*Cognee memory disabled*" and return early
   
   2. **AUTOMATIC RETRIEVAL** (before Copilot invocation):
      - Extract user query from `request.prompt`
      - Call `await cogneeClient.retrieve(userQuery)`
      - If results found:
        - Format context as numbered list: `"1. {context}\n2. {context}"`
        - Create enriched prompt: `"[CONTEXT FROM PAST CONVERSATIONS]\n{contexts}\n\n[CURRENT QUESTION]\n{query}"`
        - Stream indicator to user: `"*Retrieved N relevant memories*"`
      - If no results: Use original query unchanged
   
   3. **Forward to Language Model**:
      - Select Copilot model: `await vscode.lm.selectChatModels({vendor: 'copilot', family: 'gpt-4'})`
      - Create message: `vscode.LanguageModelChatMessage.User(enrichedPrompt)`
      - Send request: `await model.sendRequest(messages, {}, token)`
      - Stream response fragments to `stream.markdown()` as they arrive
      - Accumulate full assistant response in string variable
   
   4. **AUTOMATIC CAPTURE** (after response completion):
      - Call `await cogneeClient.ingest(userQuery, assistantResponse)`
      - Log success/failure (ingestion errors don't block user response)
   
   5. **Return Result Metadata**:
      - Success: `{metadata: {memoryUsed: true, contextCount: N}}`
      - Error: `{metadata: {error: string}}`
   
   **Error Handling**:
   - Wrap handler in try-catch block
   - Log errors to console with `console.error()`
   - Stream error message to user via `stream.markdown()`
   - Return error metadata (don't crash extension)
   
   **Registration**:
   - Create participant: `vscode.chat.createChatParticipant('cognee-memory', handler)`
   - Set icon path: `participant.iconPath = vscode.Uri.file(context.asAbsolutePath('media/icon.png'))`
   - Add to context subscriptions for cleanup
   - Return disposable for lifecycle management

2. **Update `extension/src/extension.ts`** to register participant after Cognee initialization:
   - Import `registerChatParticipant` function
   - After successful `cogneeClient.initialize()`:
     - Call `registerChatParticipant(context, cogneeClient)`
     - Show info message: "Cognee Chat Memory is active"
   - If initialization fails, don't register participant (user sees warning already)

3. **Add status bar indicator** (optional enhancement):
   - Create `StatusBarManager` class in new file `extension/src/statusBar.ts`
   - Display: Icon + text "$(database) Cognee: N memories"
   - Update count after each ingestion
   - Show warning icon if initialization failed
   - Allow clicking to toggle enabled/disabled

4. **Add configuration commands** (optional enhancement):
   - Register command `cogneeMemory.toggle` to toggle enabled/disabled setting
   - Register command `cogneeMemory.clearMemory` to delete workspace `.cognee/` directory
   - Register command `cogneeMemory.showStats` to display memory statistics via info message

5. **Create extension icon** at `extension/media/icon.png`:
   - 128x128 PNG icon representing memory/brain/graph concept
   - Used in Chat Participant UI (appears next to participant name in chat interface)

**Acceptance Criteria**:

- Chat Participant appears in VS Code Chat interface as "@cognee-memory"
- When user sends message to Chat Participant, context is automatically retrieved from Cognee before response
- Assistant response is automatically captured and stored in Cognee after completion
- User can see indicator that context was used (e.g., "Retrieved 2 relevant memories")
- Conversation capture happens silently without user prompt
- Extension respects `cogneeMemory.enabled` setting (no retrieval/capture when disabled)
- Status bar shows "Cognee: Active" when working correctly
- Extension handles errors gracefully (missing API key, Python errors) without crashing Chat Participant
- Chat Participant works in multi-turn conversations (history maintained)
- Latency for context retrieval is <500ms (measured in console logs)

---

### Milestone 6: Testing, Documentation, and Packaging

**Objective**: Comprehensive testing of automatic context retrieval workflow, user-facing documentation, and VSIX packaging for distribution.

**Deliverables**:
- Integration tests for full workflow
- User documentation with screenshots
- Extension packaging and installation instructions
- Performance benchmarks and optimization

**Steps**:

1. **Create integration tests** in `extension/src/test/integration.test.ts`:
   - Test end-to-end: User message → Retrieve context → Copilot response → Capture conversation
   - Test memory persistence across VS Code restarts
   - Test workspace isolation (different workspaces have separate memories)
   - Test configuration changes (disable/enable, max results)
   - Test error recovery (missing API key, Python errors)

2. **Create manual test plan** in `extension/TESTING.md`:
   - Step-by-step walkthrough for manual testing
   - Test cases: First conversation (no context), Follow-up conversation (with context), Disable memory, Clear memory
   - Expected outcomes for each test case
   - Performance benchmarks (retrieval latency, ingestion time)

3. **Update `extension/README.md`** with comprehensive user guide:
   - **Overview**: Automatic memory for GitHub Copilot chat
   - **Installation**: Download VSIX, install via Extensions panel
   - **Setup**: Configure API key in workspace `.env`, verify extension activation
   - **Usage**: Use Chat Participant `@cognee-memory` for memory-enhanced conversations
   - **Features**: Automatic context retrieval, automatic capture, workspace isolation
   - **Configuration**: Document all settings (`enabled`, `maxContextResults`, `pythonPath`)
   - **Troubleshooting**: Common issues (missing API key, Python not found, slow retrieval)
   - **Architecture**: High-level diagram (TypeScript → Python → Cognee → Databases)
   - **Privacy**: Explain that all data stays local (workspace `.cognee/` directory)

4. **Add screenshots and demo GIF**:
   - Screenshot: Chat Participant in VS Code Chat interface showing "@cognee-memory"
   - Screenshot: "Retrieved 2 relevant memories" indicator
   - GIF: Full workflow (ask question → context retrieved → answer → follow-up with context)

5. **Create `extension/CHANGELOG.md`**:
   - Document version 0.1.0 features (initial release)
   - List all implemented features from Milestone 5
   - Known limitations (only works with GitHub Copilot, requires Python 3.8+)

6. **Performance optimization**:
   - Cache recent retrieval results (5-minute TTL) to avoid redundant queries
   - Debounce ingestion calls (batch multiple rapid conversations)
   - Add timeout configuration for Python scripts
   - Profile Python script startup time (consider process pooling if slow)

7. **Package extension**:
   - Install VSCE: `npm install -g @vscode/vsce`
   - Run `vsce package` to create `.vsix` file
   - Test installation: `code --install-extension cognee-chat-memory-0.1.0.vsix`
   - Verify extension loads and works in clean VS Code instance

8. **Create distribution guide** in `extension/DISTRIBUTION.md`:
   - How to install from VSIX (local testing)
   - How to publish to VS Code Marketplace (future)
   - Prerequisites for end users (Python 3.8+, Cognee installation)
   - License information (MIT recommended)

**Acceptance Criteria**:

- Integration tests pass for all workflow scenarios
- Manual test plan completed successfully with all test cases passing
- `extension/README.md` provides clear setup and usage instructions
- Screenshots demonstrate key features (Chat Participant UI, memory indicator)
- Performance metrics documented (retrieval <500ms, ingestion <1s)
- Extension packages successfully into `.vsix` file
- VSIX installs and activates in clean VS Code instance
- Extension works correctly after installation from VSIX
- No hardcoded paths or secrets in packaged extension
- `CHANGELOG.md` documents all features in v0.1.0

---

## Validation

### Pre-Implementation Checklist

- [ ] Plan 001 (Cognee Walkthrough) completed and validated
- [ ] Verify Plan 001 completion: Run `python -c "import cognee; print(cognee.__version__)"` (should output "0.3.4")
- [ ] Verify Plan 001 completion: Run `tutorial/examples/cognee_walkthrough.py` (should complete without errors)
- [ ] VS Code 1.85+ installed for extension development
- [ ] Node.js 18+ and npm installed
- [ ] Python 3.8+ with Cognee 0.3.4 installed and working
- [ ] OpenAI API key available for testing (verify with `echo $OPENAI_API_KEY` or check `.env` file)
- [ ] Git installed for file restructure (`git mv` commands)

### Implementation Validation

**Milestone 1 (Repository Restructure)**:

- [ ] All tutorial files successfully moved to `tutorial/` subdirectory
- [ ] `tutorial/examples/cognee_walkthrough.py` still runs without errors
- [ ] Root `README.md` clearly explains tutorial vs extension separation
- [ ] `.gitignore` updated with extension-specific patterns
- [ ] `.vscode/tasks.json` tasks work from new locations
- [ ] `extension/` directory created with proper subdirectories
- [ ] Git history preserved for moved files
- [ ] No broken imports or path references in moved Python files

**Milestone 2 (Extension Scaffolding)**:

- [ ] `npm install` completes without errors in `extension/`
- [ ] `npm run compile` produces `extension/dist/extension.js`
- [ ] `npm run watch` rebuilds on file changes
- [ ] Extension activates via F5 debug launch
- [ ] "Cognee Chat Memory extension activated" appears in console
- [ ] `package.json` declares Chat Participant contribution
- [ ] TypeScript compiler reports no errors
- [ ] ESLint runs without errors

**Milestone 3 (Python Bridge)**:

- [ ] `init.py` successfully initializes Cognee with API key
- [ ] `ingest.py` successfully adds conversation to Cognee
- [ ] `retrieve.py` successfully searches and returns results
- [ ] All scripts output valid JSON to stdout
- [ ] Error cases return proper JSON error format
- [ ] Scripts use workspace-local `.cognee/` directory
- [ ] Scripts handle missing API key gracefully
- [ ] Bridge scripts executable (`chmod +x`)

**Milestone 4 (TypeScript-Python Integration)**:

- [ ] `CogneeClient` spawns Python subprocess successfully
- [ ] `initialize()` completes without errors
- [ ] `ingest()` stores conversation in Cognee
- [ ] `retrieve()` returns context array
- [ ] Client handles missing API key gracefully
- [ ] Client handles Python spawn errors gracefully
- [ ] Client respects configuration settings
- [ ] Extension initializes `CogneeClient` on activation

**Milestone 5 (Chat Participant)**:

- [ ] Chat Participant appears as "@cognee-memory" in VS Code Chat
- [ ] Context automatically retrieved before Copilot response
- [ ] Conversation automatically captured after assistant response
- [ ] User sees "Retrieved N memories" indicator
- [ ] Extension respects `cogneeMemory.enabled` setting
- [ ] Status bar shows "Cognee: Active" when working
- [ ] Errors handled gracefully without crashing
- [ ] Multi-turn conversations work correctly
- [ ] Retrieval latency <1000ms target met (logged in console); stretch goal <500ms noted if achieved

**Milestone 6 (Testing and Packaging)**:

- [ ] Integration tests pass for all workflow scenarios
- [ ] Manual test plan completed successfully
- [ ] `extension/README.md` provides clear instructions
- [ ] Screenshots demonstrate key features
- [ ] Performance metrics documented
- [ ] Extension packages into `.vsix` file
- [ ] VSIX installs in clean VS Code instance
- [ ] Extension works correctly after VSIX installation
- [ ] No secrets or hardcoded paths in packaged extension
- [ ] `CHANGELOG.md` documents v0.1.0 features

### Automated Tests

**Unit Tests** (Milestone 4):
- `CogneeClient.initialize()` with valid/invalid paths
- `CogneeClient.ingest()` with various message formats
- `CogneeClient.retrieve()` with different queries
- Error handling for subprocess failures
- Configuration loading and validation

**Integration Tests** (Milestone 6):
- Full workflow: User message → Retrieve → Respond → Capture
- Memory persistence across restarts
- Workspace isolation
- Configuration changes (enable/disable)
- Error recovery scenarios

### Manual Tests

1. **First Conversation Test**:
   - Open workspace with Cognee configured
   - Activate extension (verify status bar)
   - Send first message to `@cognee-memory`
   - Verify no context retrieved (empty memory)
   - Verify conversation captured after response

2. **Follow-Up Conversation Test**:
   - Continue conversation from Test 1
   - Ask related follow-up question
   - Verify context retrieved (see "Retrieved N memories")
   - Verify answer references past conversation
   - Verify new conversation captured

3. **Disable Memory Test**:
   - Disable via setting: `cogneeMemory.enabled: false`
   - Send message to `@cognee-memory`
   - Verify no context retrieved
   - Verify no conversation captured
   - Re-enable and verify working again

4. **Clear Memory Test**:
   - Run command: "Cognee: Clear Memory"
   - Send message after clearing
   - Verify no context retrieved (memory empty)
   - Verify new conversations still captured

5. **Workspace Isolation Test**:
   - Open Workspace A, have conversations
   - Open Workspace B (different folder)
   - Verify Workspace B has empty memory
   - Verify Workspace A memories still present when reopened

6. **Performance Test**:
   - Measure retrieval latency (check console logs)
   - Verify <500ms for typical queries
   - Test with 100+ stored conversations (check scaling)

---

## Risks

### High Severity

1. **VS Code API Compatibility**: Chat Participant API is relatively new (VS Code 1.85+), may have bugs or change behavior
   - **Mitigation**: Pin minimum VS Code version in `package.json` engines field; test on multiple VS Code versions (1.85, 1.86, 1.87)

2. **Python Subprocess Latency**: Spawning Python process for each operation may be slow (cold start ~100-500ms), combined with OpenAI API latency (200-500ms) may exceed 1000ms occasionally
   - **Mitigation**: Set realistic <1000ms target (not <500ms); profile startup time in Milestone 6; consider process pooling or persistent Python daemon if latency consistently exceeds 1000ms; implement caching for retrieval; <500ms treated as stretch goal for post-launch optimization

3. **OpenAI API Rate Limits**: Extension makes 1-2 API calls per conversation (cognify + search), may hit rate limits with heavy usage
   - **Mitigation**: Document expected API usage; implement exponential backoff; consider local embedding models for search

4. **Context Quality**: Retrieved context may not be relevant, leading to confused or incorrect responses
   - **Mitigation**: Use `SearchType.GRAPH_COMPLETION` for best results; limit to top 3 results; allow user to disable memory if quality poor

5. **Extension Size**: Bundling Python dependencies may make extension too large for Marketplace
   - **Mitigation**: Require users to install Cognee separately (don't bundle); document installation steps clearly

6. **Workspace-Local Storage Conflicts**: Multiple VS Code windows on same workspace may conflict on `.cognee/` directory access
   - **Mitigation**: Document as known limitation; consider file locking or process-based synchronization

7. **Memory Leak**: Storing all conversations indefinitely may consume excessive disk space
   - **Mitigation**: Implement "Clear Old Memories" command (prune conversations older than 30 days); document manual cleanup

8. **Chat Participant API Limitations**: API may not provide hooks needed for automatic capture/retrieval
   - **Mitigation**: Test API capabilities early in Milestone 5; fallback to manual commands if automatic flow not possible

### Medium Severity

1. **Cross-Platform Python Path**: Default `python3` path may not work on Windows
   - **Mitigation**: Make `pythonPath` configurable; auto-detect Python on extension activation

2. **Repository Restructure Complexity**: Moving files may break existing workflows or scripts
   - **Mitigation**: Document migration steps clearly; use `git mv` to preserve history; test all scripts after move

3. **Documentation Maintenance**: User docs may become outdated as VS Code API evolves
   - **Mitigation**: Include "Last tested with VS Code X.Y" disclaimer; link to official VS Code docs

---

## Rollback Considerations

**If Milestone 1 (Restructure) fails**:
- Revert all `git mv` operations to restore original structure
- Tutorial should still work from root directory
- No functionality lost, just organizational change

**If Milestone 2-4 (Extension Scaffolding/Bridge) fail**:
- Delete `extension/` directory entirely
- Tutorial remains functional in `tutorial/` directory
- No impact on Plan 001 implementation

**If Milestone 5 (Chat Participant) fails due to API limitations**:
- Fallback to manual command approach: User runs "Retrieve Context" command before asking Copilot
- Simplify to status bar button for manual retrieval
- Document as "semi-automatic" rather than "automatic"

**If performance is unacceptable (<500ms latency goal)**:
- Implement caching layer (store last N retrievals in memory)
- Consider persistent Python daemon instead of subprocess per call
- Reduce max context results from 3 to 1

**Database Considerations**:
- Workspace `.cognee/` directory can be deleted safely to reset memory
- No migrations needed (Cognee handles schema internally)
- Backup recommendation: Copy `.cognee/` directory before major upgrades

---

## Handoff Notes

**For Implementer**:

1. **Start with Milestone 1 (Restructure)**: Use `git mv` commands to preserve file history; test tutorial after move
2. **Milestone 2 must complete before 3**: Extension scaffolding (TypeScript project) required before Python bridge work
3. **Test Python scripts independently**: Run `init.py`, `ingest.py`, `retrieve.py` directly before integrating with TypeScript
4. **Use console logs liberally**: Log all Cognee operations (init, ingest, retrieve) to Extension Host console for debugging
5. **Handle errors gracefully**: Never crash extension; show user-friendly errors via `vscode.window.showErrorMessage()`
6. **Keep Python bridge simple**: Avoid complex logic in bridge scripts; they should be thin wrappers around Cognee API
7. **Test workspace isolation early**: Open multiple VS Code windows on different folders to verify separate memories
8. **Performance profiling**: Use `console.time()` / `console.timeEnd()` to measure retrieval latency in Milestone 5
9. **Package early and often**: Test VSIX installation frequently to catch packaging issues early
10. **Document all assumptions**: If VS Code API behavior is unclear, document assumptions and validate with tests

**For Reviewer**:

1. **Verify Plan 001 completion**: Check that `cognee==0.3.4` is installed and `tutorial/examples/cognee_walkthrough.py` runs successfully before starting Plan 002
2. **Verify tutorial still works**: After Milestone 1, run `python tutorial/examples/cognee_walkthrough.py` to confirm no breakage
3. **Check file history preservation**: Use `git log --follow tutorial/examples/cognee_walkthrough.py` to ensure git history preserved after move
3. **Validate JSON output format**: Test all Python bridge scripts directly and verify JSON structure matches specification
4. **Validate ontology extraction**: After ingesting first conversation, check logs for entity/relationship counts (should be >0)
5. **Test automatic capture/retrieval flow**: Most critical validation - ensure no manual user action required
6. **Measure latency**: Check console logs for retrieval timing; should meet <1000ms target for typical queries; note if <500ms stretch goal achieved
7. **Test error scenarios**: Missing API key, invalid Python path, network errors - extension should not crash
8. **Verify workspace isolation**: Open two different workspaces, verify memories don't leak between them
9. **Check VSIX installation**: Install from `.vsix` in clean VS Code instance, verify extension activates and works
10. **Review user documentation**: Ensure `extension/README.md` provides complete setup instructions
11. **Validate configuration**: Test all settings (`enabled`, `maxContextResults`, `pythonPath`) work as documented

**For Critic**:

- **Validate Plan 001 dependency**: Confirm that all Plan 001 artifacts (Cognee installation, API key setup, working tutorial) are verified before implementation begins
- **Assess restructure complexity**: Is separating tutorial and extension worth the migration effort? Could they coexist in root?
- **Evaluate subprocess approach**: Is spawning Python per operation acceptable? Should we use persistent daemon or HTTP server?
- **Review automatic capture UX**: Should users be notified of every capture, or is silent operation better?
- **Consider context injection strategy**: Is prepending context to prompt the best approach? Alternative: Use system message or user message prefix
- **Assess workspace isolation design**: Should users be able to share memories across workspaces? Is strict isolation too limiting?
- **Evaluate configuration complexity**: Are 3 settings sufficient? Should we add ontology customization, cache TTL, max memory size?
- **Review error handling philosophy**: Is fail-gracefully approach correct, or should extension be more aggressive with warnings?
- **Consider alternative architectures**: Should extension be Python-first (with TypeScript wrapper) rather than TypeScript-first?
- **Assess testing coverage**: Are manual tests sufficient, or should we require automated integration tests before release?
- **Evaluate performance targets**: Is <1000ms target achievable with subprocess overhead? Should stretch goal <500ms be documented as post-launch optimization?
- **Assess ontology validation**: Is logging entity counts sufficient to verify Cognee uses ontology.json? Should we require more detailed extraction metrics?

---

## Additional Context

**Design Decisions**:

1. **Why Restructure Repository?**
   - Separation of concerns: Tutorial is learning material, extension is production code
   - Clearer entry points: Users want either tutorial OR extension, not both simultaneously
   - Easier maintenance: Extension can be updated without affecting tutorial stability

2. **Why TypeScript → Python Bridge?**
   - Reuse existing Cognee Python implementation (no TypeScript port needed)
   - VS Code extensions require TypeScript/JavaScript
   - Subprocess overhead acceptable for chat use case (not high-frequency like completions)

3. **Why Workspace-Local Storage?**
   - Privacy: Each project has separate context (don't leak proprietary code discussions)
   - Portability: `.cognee/` can be gitignored or shared with team via `.cognee.backup/`
   - Simplicity: No global database or sync complexity

4. **Why Automatic Capture/Retrieval?**
   - Better UX: User doesn't need to remember to query memory manually
   - Consistent behavior: Every conversation is captured, no gaps
   - Transparency: Memory "just works" like human memory

5. **Why Chat Participant API?**
   - Official extension point for chat features
   - Provides proper streaming response interface
   - Integrates with GitHub Copilot UI seamlessly

**Alternative Approaches Considered**:

- **Python Extension with TypeScript Wrapper**: Rejected due to VS Code extension packaging complexity
- **HTTP Server for Cognee**: Rejected due to added deployment complexity (users must run server)
- **Global Memory Across Workspaces**: Rejected due to privacy concerns and context confusion
- **Manual Commands Only**: Rejected as less user-friendly than automatic operation
- **Code Repository Ingestion**: Explicitly out of scope per user clarification (chat-only memory)

**Future Enhancements** (Not in Plan 002):

- Support for custom ontologies (different memory structures per project type)
- Memory analytics dashboard (visualize knowledge graph growth)
- Memory export/import (share team knowledge)
- Integration with other chat providers (Claude, local models)
- Inline completion context (not just chat)
- Collaborative memory (shared across team members)

**Dependencies on Plan 001**:

- Cognee installation and API key configuration from Plan 001 tutorial setup
- Understanding of Cognee operations (`add`, `cognify`, `search`) from tutorial
- Sample ontology structure as reference for chat-specific ontology
- Performance expectations (~15-20 API calls, <5 min execution) as baseline

---

## Clarifications and Resolutions

**Configuration Approach** (Resolved):
- Use VS Code settings via `vscode.workspace.getConfiguration('cogneeMemory')` instead of custom UI
- Per-workspace configuration supported via `.vscode/settings.json` in each workspace
- Settings include: `enabled`, `maxContextResults`, `maxContextTokens`, `recencyWeight`, `importanceWeight`, `pythonPath`, `logLevel`
- No additional UI controls needed - VS Code settings UI is sufficient

**Context Window Limits** (Resolved):
- Dual-limit strategy: BOTH `maxContextResults` (default 3) AND `maxContextTokens` (default 2000)
- Retrieval stops when either limit is reached (whichever comes first)
- Prevents prompt bloat from excessive context injection
- Token counting uses rough word-based estimate (`len(text.split())`) for performance
- Users can tune both settings independently based on their model's context window

**Initialization Error Handling** (Resolved):
- Critical errors (missing API key, Python spawn failures) logged to Output Channel at ERROR level
- User-facing warnings shown via `vscode.window.showWarningMessage()` for actionable errors
- Output Channel named "Cognee Memory" accessible from VS Code Output panel dropdown
- All logs include ISO 8601 timestamps and structured JSON data
- Terminal integration via Output Channel API (users can view logs without code changes)
- Non-critical errors (empty results, slow queries) logged at WARN level without user interruption

**Workspace Isolation** (Resolved):
- **STRICT isolation**: Each workspace has independent `.cognee/` directory
- No memory sharing across workspaces under any circumstances
- Each workspace can have different configuration (via `.vscode/settings.json`)
- Memory persists per workspace across VS Code restarts
- Prevents cross-project context leakage (privacy/security requirement)

**Debug Logging Metrics** (Resolved):
- **Initialization**: workspace path, duration, cognee directory, success/failure, errors
- **Ingestion**: message lengths, importance score, total chars, timestamp, duration, cognify status
- **Retrieval**: query length, max results/tokens, weights, result count, total tokens, duration, latency warnings (>500ms)
- **Subprocess**: script name, arguments (sanitized), exit codes, spawn errors, timeouts
- **Configuration**: setting changes, enable/disable events, workspace changes
- Log levels: error (critical), warn (performance/fallback), info (normal ops), debug (diagnostics)

**New Requirements**:

1. **Recency Weighting**:
   - Configurable via `recencyWeight` setting (default 0.3, range 0-1)
   - Linear decay over 30 days: `recency_score = max(0, 1 - (age_days / 30))`
   - Timestamp added to all ingested conversations via ISO 8601 format
   - Combined with base relevance score: `final_score = base * (1 - recency_w - importance_w) + recency * recency_w + importance * importance_w`

2. **Importance Weighting**:
   - Configurable via `importanceWeight` setting (default 0.2, range 0-1)
   - User can mark conversations as important (0-1 scale, stored in metadata)
   - Default importance is 0.0 (normal priority)
   - Future enhancement: Allow users to mark messages as important via command/UI

3. **Hybrid Graph-Vector Retrieval**:
   - Use `SearchType.GRAPH_COMPLETION` (Cognee's hybrid mode)
   - Combines graph relationships (ontology-based entity connections) with vector similarity (embedding-based semantic search)
   - Graph component: Traverses relationships defined in ontology (e.g., User → Question → Answer)
   - Vector component: Finds semantically similar content via embeddings
   - Cognee merges both signals into unified relevance score
   - No additional configuration needed - GRAPH_COMPLETION handles hybrid search internally

**VS Code Best Practices Applied**:

- Output Channel for all logging (persistent, user-accessible, standard VS Code pattern)
- Warning messages for actionable user errors (missing config, initialization failures)
- Configuration via VS Code settings (no custom UI needed)
- Workspace-local storage (`.cognee/` directory, gitignored)
- Extension activates on `onStartupFinished` (non-blocking)
- Chat Participant API for chat integration (official extension point)
- Subprocess communication with timeouts (10s max, prevents hangs)
- Error recovery without crashes (graceful degradation)

The plan is complete and ready for implementation after Plan 001 is validated.
