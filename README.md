# Flowbaby Project (formerly RecallFlow/Cognee)

This repository contains both a **Flowbaby learning tutorial** and a **VS Code extension** for automatic chat memory integration with GitHub Copilot.

## Contents

### 📚 Tutorial (Learning Materials)
Interactive examples demonstrating Flowbaby's knowledge graph capabilities. Perfect for understanding how Flowbaby works before diving into the extension.

**Location**: [`tutorial/`](tutorial/)  
**See**: [Tutorial README](tutorial/README.md) for setup and usage

### 🔌 Extension (VS Code Integration)
A VS Code extension that automatically captures GitHub Copilot chat conversations and retrieves relevant context from Flowbaby memory.

**Location**: [`extension/`](extension/)  
**See**: [Extension README](extension/README.md) for installation and configuration  
**Status**: v0.3.9 Released - [Download VSIX](https://github.com/lsalsich/flowbaby/releases)  
**Features**: Automatic memory capture, context retrieval, workspace isolation, hybrid search, custom ontology

## Prerequisites

- **Python 3.8+** with pip
- **Node.js 18+** with npm (for extension development)
- **VS Code 1.85+** (for extension usage)
- **LLM API key** (required for Flowbaby operations)

## Quick Start

### Option 1: Learn Flowbaby (Tutorial)

```bash
cd tutorial/
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env  # Add your LLM API key
python examples/cognee_walkthrough.py
```

### Option 2: Install Extension

1. Download latest `.vsix` from [GitHub Releases](https://github.com/lsalsich/flowbaby/releases)
2. Install: `code --install-extension cognee-chat-memory-X.Y.Z.vsix`
3. Configure API key in VS Code Settings
4. See [Extension README](extension/README.md) for full setup guide

## Repository Structure

```text
cognee/
├── tutorial/              # Flowbaby learning materials
│   ├── examples/          # Walkthrough scripts
│   ├── data/              # Sample data files
│   ├── artifacts/         # Generated visualizations
│   └── README.md          # Tutorial documentation
├── extension/             # VS Code extension (in development)
│   ├── src/               # TypeScript source code
│   ├── bridge/            # Python bridge scripts
│   └── README.md          # Extension documentation
├── Planning/              # Implementation plans
└── .github/               # Chatmode definitions
```

## Development Workflow

1. **Start with Tutorial**: Learn Flowbaby basics by running `tutorial/examples/cognee_walkthrough.py`
2. **Review Plan 002**: Read [Planning/002-automatic-context-retrieval.md](Planning/002-automatic-context-retrieval.md) for extension design
3. **Develop Extension**: Follow extension README for development setup
4. **Test Integration**: Use extension with real GitHub Copilot chats

## Documentation

- [Tutorial README](tutorial/README.md) - Setup and usage instructions
- [Extension README](extension/README.md) - Installation and configuration guide
- [CONTRIBUTING.md](CONTRIBUTING.md) - Development setup and contribution guidelines
- [Extension CHANGELOG](extension/CHANGELOG.md) - Version history and release notes
- [Extension Distribution Guide](extension/DISTRIBUTION.md) - Release and packaging process
- [Planning Documents](planning/) - Implementation plans and architecture decisions
- [Official Flowbaby Docs](https://docs.flowbaby.ai)
- [Flowbaby VS Code Extension Docs](https://docs.flowbaby.ai)

## License

See individual component READMEs for license information.
