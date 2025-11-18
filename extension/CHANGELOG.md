# Changelog

All notable changes to the Cognee Chat Memory extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2025-11-18

### Added - Plan 014: Structured Conversation Summaries

- **Conversation Summary Generation**: Create structured summaries via `@cognee-memory summarize this conversation`
  - Adjustable turn count scope (default: last 15 turns)
  - Interactive scope adjustment before generation
  - LLM-powered summary extraction with Plan 014 schema
  - User confirmation required before storage
- **Enriched Summary Schema**: Structured format with Topic, Context, Decisions, Rationale, Open Questions, Next Steps, References, and Time Scope
- **Metadata-Rich Retrieval**: Summaries include status badges (📋 Status, 📅 Created, 🏷️ Plan ID), structured content sections, and temporal awareness
- **Mixed-Mode Support**: Seamless handling of both enriched summaries (Plan 014+) and legacy raw-text memories
- **In-Chat Help**: Type `@cognee-memory help` or invoke with no query to see usage guide
- **Bridge Contract Documentation**: `DATAPOINT_SCHEMA.md` and `RETRIEVE_CONTRACT.md` define stable schemas for downstream consumers

### Changed

- **Retrieval Display**: Now shows structured metadata badges and organized content sections for enriched summaries
- **Python Bridge**: `retrieve.py` returns structured JSON with parsed metadata instead of raw text
- **CogneeClient**: `retrieve()` method returns `RetrievalResult[]` with typed fields (topicId, status, createdAt, decisions, etc.)

### Improved

- **Summary Quality**: Structured format improves retrieval precision by surfacing key decisions and rationale
- **Temporal Context**: Created timestamps enable recency-aware reasoning (foundation for Plan 015 ranking)
- **Status Tracking**: Active/Superseded status field enables decision lifecycle tracking (foundation for Plan 015 compaction)
- **User Control**: Explicit summary creation and confirmation flow ensures intentional memory capture
- **Backward Compatibility**: All legacy raw-text memories remain accessible; retrieval transparently handles both formats

### Technical

- **Enriched Text Storage**: Summaries stored as markdown with embedded metadata per §4.4.1 (Cognee 0.3.4 constraint)
- **Template Versioning**: `<!-- Template: v1.0 -->` tag enables future format migrations
- **Regex-Based Parsing**: Deterministic section heading patterns for metadata extraction
- **TypeScript Tests**: 59/59 passing with updated RetrievalResult mocks
- **Python Tests**: 16/16 passing with enriched text formatting and contract validation

## [0.2.3] - 2025-11-17

### Fixed

- Display truncation in chat participant - users can now see full retrieved memory content (up to 2000 chars)
- Query logging truncation increased from 50 to 200+ characters for better debugging
- Ingestion timeout increased from 30s to 120s to reduce false-positive failures
- Error messages now distinguish timeout (may still succeed) from true ingestion failure
- Added comprehensive ingestion performance metrics (Python-side duration, step-level timing)
- Added process exit vs timeout logging for diagnosing bridge-level latency

### Improved

- Transparent memory display with character count indicators aligns with discoverability goals (Epic 0.2.2.3)
- Clear truncation indication when memories exceed 2000 chars (shows "showing X of Y chars")
- Query length now shown in debug logs when queries exceed 200 chars
- Ingestion timeout errors now explain background processing may still succeed
- Extension logs include both Node-side and Python-side duration metrics for correlation
- Step-level metrics (load_env, init_cognee, config_llm, dataset_ontology, add, cognify) enable bottleneck identification

## [0.2.2] - 2025-11-17

### Fixed

- Display truncation in chat participant - users can now see full retrieved memory content (up to 2000 chars)
- Query logging truncation increased from 50 to 200+ characters for better debugging

### Improved

- Transparent memory display with character count indicators aligns with discoverability goals (Epic 0.2.2.3)
- Clear truncation indication when memories exceed 2000 chars (shows "showing X of Y chars")
- Query length now shown in debug logs when queries exceed 200 chars

## [0.2.1] - 2025-11-14

### Breaking Changes

- **Environment**: `LLM_API_KEY` is now required in workspace `.env`. Previously supported `OPENAI_API_KEY` fallback removed to align with Cognee 0.4.0 conventions.

### Fixed

- Ingestion failures and 30s timeouts caused by Cognee using site-packages storage instead of workspace-local directories
- Silent parameter fallback code that masked configuration errors
- File-not-found errors during ingestion due to cross-context storage mismatches

### Changed

- All Cognee system and data directories now scoped to workspace (`.cognee_system/`, `.cognee_data/`)
- Removed fallback parameter retries; signature mismatches now surface as clear errors
- Enhanced error logging with structured details (exception type, parameters, context)

## [0.2.0] - 2025-11-13

### Added

- **Debug Configuration**: VS Code launch.json for F5 Extension Development Host debugging
- **Visible Build Logging**: esbuild now shows compilation progress and errors (logLevel: 'info')
- **Developer Documentation**: Enhanced SETUP.md and README.md with debugging workflow and troubleshooting guidance

### Fixed

- **Extension Activation Failure**: Missing .vscode/launch.json prevented Extension Development Host from loading the extension
- **Silent Build Errors**: Build failures were hidden with logLevel: 'silent', now visible for rapid debugging

### Implementation 008 Features (from v0.1.0 foundation)

#### Added

- **Keyboard Shortcut Capture (Ctrl+Alt+C / Cmd+Alt+C)**: Selective conversation capture via keyboard shortcut + input box workflow
- **@cognee-memory Chat Participant**: Explicit memory-augmented chat participant for context retrieval and informed responses
- **Command Palette Capture**: Alternative capture method via "Cognee: Capture to Memory" command
- **Toggle Memory Command**: Quick on/off toggle via "Cognee: Toggle Memory" command
- **Clear Memory Command**: Delete workspace memory via "Cognee: Clear Workspace Memory" command (with confirmation)
- **OWL/Turtle Ontology**: Chat-specific ontology file (`ontology.ttl`) with 8 classes and 12 object properties for grounded entity extraction
- **Conversational Ingestion Format**: Simplified natural prose format for better LLM extraction quality
- **Step 6 Feedback Loop (Experimental)**: Optional automatic capture of @cognee-memory conversations (disabled by default due to Cognee 0.4.0 bug)
- **Graceful Degradation**: Retrieval failures show warning but participant continues without context
- **Configuration Setting**: `cogneeMemory.autoIngestConversations` for experimental feedback loop control

### Changed

- **User Workflow**: Shifted from automatic global capture to selective, user-controlled keyboard shortcut capture
- **Participant Model**: `@cognee-memory` requires explicit invocation; no passive injection into other participants
- **Ontology Integration**: Updated `ingest.py` to use `ontology_file_path` parameter with RDFLib validation and graceful fallback
- **Ingestion Format**: Changed from bracketed metadata format to conversational prose for improved extraction

### Improved

- **Automatic Python Interpreter Detection**: Extension now auto-detects workspace `.venv` virtual environment, eliminating need for manual `cogneeMemory.pythonPath` configuration in most cases
- **Enhanced Error Messages**: Python errors (missing packages, API key issues) now visible in Output Channel with actionable troubleshooting hints
- **Workspace-Relative Execution**: Bridge scripts run from workspace context for reliable path resolution
- **Context Display**: Retrieved memories formatted with clear markdown previews ("📚 Retrieved N memories")
- **Performance Logging**: Retrieval timing logged to Output Channel for monitoring (<1000ms P95 target)
- Error logs sanitize sensitive data (API keys, tokens) before display
- Configuration documentation clarifies when manual Python path setting is needed
- Structured error extraction from Python subprocess stdout
- Better diagnostics for missing dependencies and environment issues

### Fixed

- Generic "exit code 1" errors replaced with specific failure reasons
- Missing `cognee` package now clearly diagnosed instead of silent failure
- Python interpreter mismatch no longer requires manual configuration for standard `.venv` setups
- Keyboard shortcut comment typo in code (Ctrl+Shift+M → Ctrl+Alt+C)

### Known Issues

- **Cognee 0.4.0 File Hashing Bug**: Intermittent ingestion failures for repeated identical content affect Step 6 auto-ingestion; workaround via `cogneeMemory.autoIngestConversations=false` (default)
- **Manual Capture Workflow**: Keyboard shortcut requires copy-paste; cannot extract message from chat UI directly (VS Code API limitation)
- **Explicit Participant Invocation**: Must type `@cognee-memory`; cannot inject context into other participants (API limitation)

### Technical Implementation

- 6-step participant flow: retrieval → format display → augment prompt → generate response → capture conversation (conditional)
- RDFLib ontology parsing with graceful fallback to no-ontology mode
- Asynchronous fire-and-forget ingestion (non-blocking)
- Comprehensive integration test suite (27 passing tests)
- VS Code Chat API v1.105+ compatibility

## [0.1.0] - 2025-11-10

### Added

- Initial release of Cognee Chat Memory extension
- Automatic capture of GitHub Copilot chat conversations  
- Automatic context retrieval from Cognee memory before responses
- Workspace-isolated memory with separate knowledge graphs per workspace
- Chat-specific ontology defining User, Question, Answer, Topic, Concept, Problem, Solution, and Decision entities
- Hybrid graph-vector search combining relationship traversal with semantic similarity
- Recency and importance weighting for intelligent context relevance scoring
- Configurable settings:
  - `cogneeMemory.enabled` - Toggle memory on/off
  - `cogneeMemory.maxContextResults` - Maximum results to retrieve (1-10)
  - `cogneeMemory.maxContextTokens` - Token budget for context (100-10000)
  - `cogneeMemory.recencyWeight` - Prioritize recent conversations (0-1)
  - `cogneeMemory.importanceWeight` - Prioritize marked conversations (0-1)
  - `cogneeMemory.pythonPath` - Custom Python interpreter path
  - `cogneeMemory.logLevel` - Debug verbosity (error/warn/info/debug)
- Comprehensive integration test suite with 6 test cases
- Python bridge scripts for Cognee library communication
- Output Channel logging for debugging and monitoring

### Technical Implementation

- Uses Cognee 0.3.4 with dataset-based logical isolation
- SHA1-hashed workspace identifiers for stable and unique dataset naming
- Global marker file pattern prevents data loss during concurrent initialization
- Stateless ontology configuration applied per ingestion operation
- TypeScript extension with Python subprocess bridge architecture
- esbuild-based compilation for optimized bundle size

### Known Limitations

- Requires workspace folder (doesn't work in single-file mode)
- Currently captures conversations through Chat Participant API
- Python and Cognee must be installed separately (not bundled)
- First conversation in new workspace has no context (memory starts empty)
- macOS and Linux tested; Windows support may require additional configuration

[0.1.0]: https://github.com/lsalsich/cognee/releases/tag/v0.1.0
