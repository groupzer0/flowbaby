# Cognee Chat Memory Extension

A VS Code extension that automatically captures GitHub Copilot chat conversations and retrieves relevant context from Cognee memory.

## Status

**In Development** - See [Plan 002](../Planning/002-automatic-context-retrieval.md) for implementation details.

## Features (Planned)

- 🔄 **Automatic Capture**: Store all chat conversations in Cognee as they occur
- 🔍 **Automatic Retrieval**: Inject relevant context before each Copilot response
- 🔒 **Workspace Isolation**: Each workspace maintains separate memory context
- ⚡ **Fast Performance**: <1000ms retrieval latency target
- 🎯 **Chat-Only Focus**: Memory for conversations, not code repository

## Prerequisites

- VS Code 1.85+
- Python 3.8+ with Cognee 0.3.4 installed
- Node.js 18+ (for development)
- OpenAI API key

## Installation (Coming Soon)

1. Download `.vsix` file from releases
2. Install: `code --install-extension cognee-chat-memory-0.1.0.vsix`
3. Configure API key in workspace `.env` file
4. Extension activates automatically

## Configuration

Settings available in VS Code settings (`cogneeMemory.*`):

- `enabled` (boolean): Toggle memory on/off
- `maxContextResults` (number): Limit retrieved results (default: 3)
- `maxContextTokens` (number): Token budget for context (default: 2000)
- `recencyWeight` (number): Recency scoring weight (default: 0.3)
- `importanceWeight` (number): Importance scoring weight (default: 0.2)
- `pythonPath` (string): Python interpreter path (default: "python3")
- `logLevel` (enum): Log verbosity (default: "info")

## Development Setup

```bash
cd extension/
npm install
npm run compile
# Press F5 to launch Extension Development Host
```

## Architecture

```
TypeScript Extension (VS Code)
  ↓
Python Bridge (subprocess)
  ↓
Cognee (knowledge graph + vector search)
  ↓
Local Databases (.cognee/ directory)
```

## Documentation

- [Implementation Plan](../Planning/002-automatic-context-retrieval.md)
- [Tutorial](../tutorial/README.md) - Learn Cognee basics first
- [Official Cognee Docs](https://docs.cognee.ai)

## License

MIT (to be confirmed)
