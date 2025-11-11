# Changelog

All notable changes to the Cognee Chat Memory extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - TBD

### Added

- **Automatic Python Interpreter Detection**: Extension now auto-detects workspace `.venv` virtual environment, eliminating need for manual `cogneeMemory.pythonPath` configuration in most cases
- **Enhanced Error Messages**: Python errors (missing packages, API key issues) now visible in Output Channel with actionable troubleshooting hints
- **Workspace-Relative Execution**: Bridge scripts run from workspace context for reliable path resolution

### Improved

- Error logs sanitize sensitive data (API keys, tokens) before display
- Configuration documentation clarifies when manual Python path setting is needed
- Structured error extraction from Python subprocess stdout
- Better diagnostics for missing dependencies and environment issues

### Fixed

- Generic "exit code 1" errors replaced with specific failure reasons
- Missing `cognee` package now clearly diagnosed instead of silent failure
- Python interpreter mismatch no longer requires manual configuration for standard `.venv` setups

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
