# Changelog

All notable changes to the Cognee Chat Memory extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.5] - 2025-11-21

### Added - Plan 018: Metadata Infrastructure and Ranking

**Intelligent Ranking & Filtering** - Retrieval now prioritizes memories based on recency and status:
- **Recency-Aware Ranking**: New exponential decay algorithm prioritizes fresh memories. Configurable via `cogneeMemory.ranking.halfLifeDays` (default: 7 days).
- **Status Filtering**: Memories can be marked as `Active`, `Superseded`, or `DecisionRecord`.
  - `Superseded` memories are hidden by default to reduce noise.
  - `DecisionRecord` memories receive a relevance boost.
- **Metadata-Rich Storage**: Summaries now embed structured metadata (topicId, status, timestamps) directly in the text, enabling robust tracking even without graph metadata support.

**Technical Implementation**:
- **Enriched Text Fallback**: Implemented "Enriched Text" pattern to store metadata within summary text, bypassing Cognee 0.3.4 DataPoint limitations.
- **Migration Script**: New `migrate_summaries.py` script automatically upgrades legacy memories to the new schema.
- **Safe Migration**: Uses file locking (`.cognee/maintenance.lock`) to pause background operations during migration.
- **Updated Tool Definitions**: `cognee_storeMemory` and `cognee_retrieveMemory` tools updated with clearer descriptions and privacy guarantees ("Data stays in this workspace").

### Fixed
- **Ranking Quality**: Addressed issue where old, less relevant memories cluttered retrieval results.
- **Status Visibility**: Superseded plans and decisions no longer confuse agents.

## [0.3.4] - 2025-11-21

### Release

This release packages the async cognify() optimization (Plan 017) with no functional changes from v0.3.3. Version bumped to v0.3.4 for clean release tracking.

All features, improvements, and technical details remain as documented in v0.3.3 below. This is a packaging-only release to formalize the deployment.

## [0.3.3] - 2025-11-20

### Added - Plan 017: Async cognify() Optimization

**Universal Async Memory Ingestion** - ALL ingestion flows (agent tools, manual capture, headless commands) now return in <10 seconds:

- **Staged Messaging**: Every ingestion surface shows: "Memory staged – processing will finish in ~1–2 minutes. You'll get a notification when it's done."
- **Background Processing**: Knowledge graph construction (`cognee.cognify()`) runs in detached subprocess while agents continue working
- **Completion Notifications**: 
  - Success (info): "✅ Cognify finished" with workspace name, summary digest, elapsed time, entity count, "View Status" action
  - Failure (warning): "⚠️ Cognify failed" with workspace name, summary digest, remediation guidance, "Retry"/"View Logs" actions
- **Independent Throttling**: Success and failure notifications throttled separately (≤1 per 5 min per workspace per outcome type)
- **Background Status Command**: New `cognee.backgroundStatus` command shows all in-flight/completed operations with quick-pick UI

**Technical Implementation**:

- Split `ingest.py` into 3 modes: `--mode sync` (diagnostic), `--mode add-only` (fast staging <10s), `--mode cognify-only` (background graph construction)
- BackgroundOperationManager service with:
  - Dual-ledger persistence (`.cognee/background_ops.json` + VS Code globalState)
  - Concurrency limits: max 2 concurrent + FIFO queue of 3 pending operations
  - Detached subprocess spawning with PID tracking
  - Activation reconciliation (reattach live PIDs, mark stale entries `unknown`)
  - Deactivation cleanup (SIGTERM with 5s grace + SIGKILL)
  - Atomic status stub writes prevent corruption on crashes
- Updated client methods: `ingestSummaryAsync()` and `ingestAsync()` for summary and conversation ingestion
- Comprehensive bridge test suite (15+ tests) covering all modes, error handling, backward compatibility

**Performance Impact**:

- Agent blocking time: **73s → <10s (86% reduction)**
- Manual capture blocking time: **73s → <10s (86% reduction)**
- Background processing: 60-90s (unchanged, runs asynchronously)
- **Result**: Agents can store 3 memories in 30s instead of 219s

**User Experience Changes**:

- Manual capture (`Ctrl+Alt+C`) now shows staged toast instead of blocking
- Agent tools (`#cogneeStoreSummary`) return immediately with operationId
- All users receive completion notification when background processing finishes
- Output channel shows full audit trail: `[BACKGROUND]` markers for start/success, `[ERROR]` for failures

**Backward Compatibility**:

- Sync mode (`--mode sync`) preserves legacy behavior for diagnostic/test use
- Conversation mode (positional args) continues to work with sync mode
- All existing tests pass unchanged

### Fixed - Plan 016.1: Tool Lifecycle and Bridge Timeouts Hotfix

**Bug Fixes**:

- **Tool Lifecycle UI Desync**: Fixed issue where Configure Tools dialog showed stale enablement state when toggling tools on/off. Tools now register unconditionally at extension activation; VS Code's Configure Tools UI is the sole authorization mechanism (no redundant workspace setting).
- **Bridge Timeout Opacity**: Added comprehensive diagnostic logging to Python bridge scripts (ingest.py, retrieve.py) with `[PROGRESS]`, `[WARNING]`, and `[ERROR]` markers. Users now see step-by-step progress in Output channel when bridge operations are slow or fail.
- **Redundant Authorization**: Removed `cogneeMemory.agentAccess.*` workspace settings entirely. Simplified authorization model: users enable/disable tools via Configure Tools UI only.

**Breaking Changes**:

- Removed settings: `cogneeMemory.agentAccess.enabled`, `cogneeMemory.agentAccess.maxResultsDefault`, `cogneeMemory.agentAccess.maxTokensDefault`, `cogneeMemory.agentAccess.maxConcurrentRequests`, `cogneeMemory.agentAccess.rateLimitPerMinute`
- Status bar "Cognee Agent Access" indicator removed (Configure Tools dialog provides feedback)
- Error code `ACCESS_DISABLED` no longer returned (tools always registered)

**Technical Details**:

- Bridge scripts emit structured error payloads with error codes: `LLM_API_ERROR`, `COGNEE_SDK_ERROR`, `PYTHON_ENV_ERROR`, `ONTOLOGY_LOAD_ERROR`
- TypeScript client (cogneeClient.ts) parses stderr for diagnostic markers and surfaces at appropriate log levels (INFO/ERROR/WARN)
- Fixed sys module import shadowing bug in retrieve.py
- Test suite updated to reflect new authorization model

**User Impact**:

- Simpler authorization: single source of truth (Configure Tools)
- Better debugging: diagnostic logs visible in Output > "Cognee Chat Memory" channel
- Faster resolution of bridge issues: progress markers identify exactly where operations block

## [0.3.2] - 2025-11-19

### Fixed - Plan 016.1: Tool Lifecycle and Bridge Timeouts Hotfix

**Bug Fixes**:

- **Tool Lifecycle UI Desync**: Fixed issue where Configure Tools dialog showed stale enablement state when toggling tools on/off. Tools now register unconditionally at extension activation; VS Code's Configure Tools UI is the sole authorization mechanism (no redundant workspace setting).
- **Bridge Timeout Opacity**: Added comprehensive diagnostic logging to Python bridge scripts (ingest.py, retrieve.py) with `[PROGRESS]`, `[WARNING]`, and `[ERROR]` markers. Users now see step-by-step progress in Output channel when bridge operations are slow or fail.
- **Redundant Authorization**: Removed `cogneeMemory.agentAccess.*` workspace settings entirely. Simplified authorization model: users enable/disable tools via Configure Tools UI only.

**Breaking Changes**:

- Removed settings: `cogneeMemory.agentAccess.enabled`, `cogneeMemory.agentAccess.maxResultsDefault`, `cogneeMemory.agentAccess.maxTokensDefault`, `cogneeMemory.agentAccess.maxConcurrentRequests`, `cogneeMemory.agentAccess.rateLimitPerMinute`
- Status bar "Cognee Agent Access" indicator removed (Configure Tools dialog provides feedback)
- Error code `ACCESS_DISABLED` no longer returned (tools always registered)

**Technical Details**:

- Bridge scripts emit structured error payloads with error codes: `LLM_API_ERROR`, `COGNEE_SDK_ERROR`, `PYTHON_ENV_ERROR`, `ONTOLOGY_LOAD_ERROR`
- TypeScript client (cogneeClient.ts) parses stderr for diagnostic markers and surfaces at appropriate log levels (INFO/ERROR/WARN)
- Fixed sys module import shadowing bug in retrieve.py
- Test suite updated to reflect new authorization model

**User Impact**:

- Simpler authorization: single source of truth (Configure Tools)
- Better debugging: diagnostic logs visible in Output > "Cognee Chat Memory" channel
- Faster resolution of bridge issues: progress markers identify exactly where operations block

## [0.3.1] - 2025-11-19

### Added - Plan 015: Agent Ingestion Command

- **Agent Ingestion API**: `cogneeMemory.ingestForAgent` command enables GitHub Copilot agents and third-party extensions to store structured summaries in Cognee
  - TypeScript schema validation with detailed error messages
  - Workspace-global access model with prominent privacy warnings
  - Structured JSON request/response with camelCase field naming
  - Auto-generation of missing IDs (topicId, timestamps)
  - Fast-fail validation before bridge invocation
- **Agent Access Control**: New `cogneeMemory.agentAccess.enabled` setting (default: false)
  - Workspace-global trust model (all extensions granted access when enabled)
  - Prominent warning in settings UI about privacy implications
  - Access enforcement at command handler level
- **Audit Logging**: Comprehensive logging for all agent ingestion attempts
  - Real-time logs in `Output` > `Cognee Agent Activity` channel
  - Structured JSON audit log at `.cognee/agent_audit.log`
  - Privacy-preserving topic digests (8-char SHA-256 hash)
  - Tracks timestamp, agent name, result, error codes, duration
- **Agent Integration Documentation**: Complete API guide at `extension/AGENT_INTEGRATION.md`
  - TypeScript examples (minimal and full payloads)
  - Error handling patterns with error codes
  - Security model explanation
  - Best practices for topic ID generation and ingestion timing
  - Troubleshooting guide
- **Bridge Contract Documentation**: `extension/bridge/INGEST_CONTRACT.md` defines stable ingestion schema
  - JSON payload specification (required/optional fields)
  - Error codes reference (ACCESS_DISABLED, INVALID_PAYLOAD, etc.)
  - Example payloads (minimal, full, invalid)
  - Performance characteristics
  - Testing instructions
- **Test Agent Extension**: Reference implementation at `test-agent/`
  - Validates all ingestion scenarios (valid, invalid, access control)
  - Automated test suite with pass/fail reporting
  - Can be used as template for custom agent development

### Added - Plan 016: Agent Retrieval and UI-Visible Extension Tools

- **Agent Retrieval API**: `cogneeMemory.retrieveForAgent` command enables agents to query Cognee knowledge graph
  - Structured JSON request/response with `CogneeContextRequest`/`CogneeContextResponse` types
  - Returns metadata-rich entries (topic, topicId, planId, score, decisions, timestamps)
  - Concurrency limiting (max 2 in-flight requests, configurable up to 5)
  - Rate limiting (max 10 requests/minute, configurable up to 30)
  - Graceful degradation for legacy memories (null metadata fields)
- **CogneeContextProvider Service**: Centralized retrieval infrastructure with architectural guardrails
  - FIFO request queueing with concurrency enforcement
  - Per-minute rate limiting with sliding window
  - Structured error responses (ACCESS_DISABLED, RATE_LIMIT_EXCEEDED, QUEUE_FULL, BRIDGE_TIMEOUT, INVALID_REQUEST)
  - Settings clamping with safe upper bounds (prevents misconfiguration)
- **UI-Visible Language Model Tools**: Both tools appear in VS Code's "Configure Tools" dialog
  - `cognee_storeMemory` (`#cogneeStoreSummary`) - Store conversation summaries
  - `cognee_retrieveMemory` (`#cogneeRetrieveMemory`) - Retrieve relevant memories
  - Tools support `#` autocomplete in chat and `.agent.md` front-matter references
  - Atomic lifecycle: both tools register/unregister together when `agentAccess.enabled` toggles
  - Icon support for visual identity (`$(database)` and `$(search)`)
- **Custom Agent Integration**: Full support for custom `.agent.md` files
  - Tools reference name format: `tools: ['cogneeStoreSummary', 'cogneeRetrieveMemory']`
  - Confirmation messages for transparency (optional, depends on user trust settings)
  - Retrieve tool returns BOTH narrative markdown AND verbatim JSON payload
- **@cognee-memory Participant Refactor**: Now uses shared `CogneeContextProvider`
  - Consistent retrieval behavior across participant and tools
  - Leverages centralized concurrency/rate limiting
  - Enhanced metadata display (topicId, planId, score when available)
- **Transparency Indicators**: All agent activity is auditable
  - Output channel logs every retrieval/ingestion with timestamps, query hashes, result counts
  - Status bar indicator shows "Cognee Agent Access: Enabled" with spinner during operations
  - Click behavior opens Output channel for inspection
- **Enhanced Documentation**:
  - `AGENT_INTEGRATION.md` extended with retrieval examples, tool integration guide, error code reference
  - `README.md` includes "Using Cognee Tools with Custom Agents" section with `.agent.md` examples
  - Complete TypeScript interfaces in `types/agentIntegration.ts`
- **Agent Access Settings**: Additional configuration for retrieval behavior
  - `cogneeMemory.agentAccess.maxResultsDefault` (default: 5)
  - `cogneeMemory.agentAccess.maxTokensDefault` (default: 4000)
  - `cogneeMemory.agentAccess.maxConcurrentRequests` (default: 2, max: 5)
  - `cogneeMemory.agentAccess.rateLimitPerMinute` (default: 10, max: 30)

### Changed

- **Minimum VS Code Version**: Requires VS Code 1.106+ for `canBeReferencedInPrompt`/`toolReferenceName` support
- **Extension Activation**: CogneeContextProvider initialization happens after CogneeClient setup
- **Participant Behavior**: @cognee-memory now routes through CogneeContextProvider (no breaking changes to user experience)

### Added - Test Coverage Enhancements (from previous release)

### Added - Test Coverage Enhancements

- **Summary Workflow Integration Tests**: 14 new automated tests in `summaryWorkflow.integration.test.ts`
  - 7 workflow tests validate complete "summarize → generate → store" flow
  - 7 snapshot tests guard against README/template drift
  - Tests cover trigger detection, no-history errors, cancellation, large conversations
- **Template Consistency Validation**: Round-trip preservation tests ensure format → parse cycle stability
- **Mixed-Mode Test Coverage**: Validates enriched vs legacy memory handling in integration context
- **Section Heading Stability**: Tests enforce that headings match DATAPOINT_SCHEMA.md exactly

### Fixed

- **Manual Test Isolation**: Added `@pytest.mark.manual` decorator to manual scripts to prevent CI failures
- **Pytest Configuration**: Registered `manual` marker in `pytest.ini` for proper test filtering
- **QA Documentation**: Updated with environment-specific test execution guidance

### Improved

- **Test Suite Reliability**: Default `pytest` runs now succeed (37 passed, 1 skipped)
- **VS Code Test Coverage**: 77 total tests passing (up from 63), no regressions
- **Documentation Accuracy**: Snapshot tests catch template/README divergence automatically

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
