# Cognee Chat Memory

> Automatic memory for GitHub Copilot chat using Cognee knowledge graphs

Cognee Chat Memory is a VS Code extension that automatically captures your GitHub Copilot chat conversations and retrieves relevant context from previous interactions. Each workspace maintains its own isolated memory, creating a personalized knowledge graph that grows with your project.

## Features

- **Automatic Conversation Capture** - No manual commands needed; conversations are captured automatically after each response
- **Intelligent Context Retrieval** - Retrieves relevant memories before responding, improving response quality
- **Workspace Isolation** - Each workspace has its own separate memory—no cross-project leakage
- **Hybrid Graph-Vector Search** - Combines relationship traversal with semantic similarity for superior context relevance
- **Configurable Behavior** - Tune recency weight, importance scoring, token budget, and result limits
- **Privacy-First Design** - All data stays on your local machine; no cloud services or telemetry

## Prerequisites

Before installing the extension, ensure you have:

- **VS Code** 1.85.0 or higher
- **Python** 3.8+ installed and available in PATH
- **Cognee Library** 0.3.4 installed: `pip install cognee==0.3.4`
- **OpenAI API Key** (or compatible LLM provider) set in your environment or workspace `.env` file

## Installation

### Method 1: Install from VSIX (Recommended)

1. Download the latest `.vsix` file from [GitHub Releases](https://github.com/lsalsich/cognee/releases)
2. Open VS Code
3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
4. Type **"Install from VSIX"** and select the command
5. Navigate to the downloaded `.vsix` file and select it
6. Reload VS Code when prompted

### Method 2: Build from Source

See [CONTRIBUTING.md](../CONTRIBUTING.md) for developer setup instructions.

## Setup

After installation, configure your workspace:

### 1. Verify Python and Cognee Installation

```bash
python3 --version  # Should be 3.8 or higher
python3 -c "import cognee; print(cognee.__version__)"  # Should print "0.3.4"
```

If Cognee is not installed:

```bash
pip install cognee==0.3.4
```

### 2. Configure API Key

Create a `.env` file in your workspace root:

```env
OPENAI_API_KEY=sk-your-key-here
```

Or set as an environment variable before launching VS Code:

```bash
export OPENAI_API_KEY=sk-your-key-here
code .
```

### 3. Open a Workspace

The extension requires a workspace folder (doesn't work in single-file mode). Open any folder in VS Code to create a workspace.

### 4. Verify Extension Activation

1. Open the Output panel: **View → Output**
2. Select **"Cognee Memory"** from the dropdown
3. You should see **"Cognee initialized successfully"** message

If you see errors, check the [Troubleshooting](#troubleshooting) section below.

## Usage

### Basic Usage

1. Open GitHub Copilot Chat (`Ctrl+Alt+I` or click the chat icon)
2. Start typing your question or request
3. The extension automatically:
   - Retrieves relevant context from past conversations
   - Injects context before Copilot responds
   - Captures the conversation after the response completes

### Memory is Automatic

- **No special commands needed** - Memory works transparently in the background
- **Workspace-specific** - Each workspace has its own isolated memory
- **Accumulates over time** - Context becomes richer as you use Copilot more

## Python Environment

The extension requires Python 3.8+ with the following packages:
- `cognee` (version 0.3.4 or compatible)
- `python-dotenv`

### Automatic Detection

The extension automatically detects your Python interpreter in this order:
1. **Explicit Setting**: `cogneeMemory.pythonPath` if configured (highest priority)
2. **Workspace Virtual Environment**: `.venv/bin/python` (Linux/macOS) or `.venv/Scripts/python.exe` (Windows)
3. **System Python**: `python3` as fallback

### When to Configure Manually

Set `cogneeMemory.pythonPath` explicitly if:
- Virtual environment is outside workspace directory
- Virtual environment uses non-standard name (not `.venv`)
- Multiple Python versions installed and specific one required
- Using conda or pyenv environments (not auto-detected in v0.2.0)

Example configuration in VS Code settings:

```json
{
  "cogneeMemory.pythonPath": "/path/to/your/.venv/bin/python"
}
```

**Platform-specific examples**:
- Linux/macOS: `/home/user/project/.venv/bin/python`
- Windows: `C:\\Users\\user\\project\\.venv\\Scripts\\python.exe`

### Unsupported Contexts (v0.2.0)

The following contexts are **not validated or supported** in this release:
- **Remote Development**: VS Code Remote-SSH, WSL, Dev Containers
- **Multi-root Workspaces**: Workspaces with multiple folder roots
- **Conda Environments**: Automatic detection not implemented (use explicit config)
- **Pyenv Environments**: Automatic detection not implemented (use explicit config)

Support for these contexts may be added in future releases.

### Configuration

Access settings via **File → Preferences → Settings → Extensions → Cognee Memory**:

| Setting | Description | Default |
|---------|-------------|---------|
| `cogneeMemory.enabled` | Toggle memory capture and retrieval on/off | `true` |
| `cogneeMemory.maxContextResults` | Maximum number of memory results to retrieve | `3` |
| `cogneeMemory.maxContextTokens` | Token budget for retrieved context | `2000` |
| `cogneeMemory.recencyWeight` | Weight for prioritizing recent conversations (0-1) | `0.3` |
| `cogneeMemory.importanceWeight` | Weight for prioritizing marked conversations (0-1) | `0.2` |
| `cogneeMemory.pythonPath` | Path to Python interpreter (must have Cognee installed) | `python3` |
| `cogneeMemory.logLevel` | Logging verbosity: error, warn, info, debug | `info` |

**Example**: To disable memory temporarily, set `cogneeMemory.enabled` to `false` in settings.

## Troubleshooting

### Extension Not Activating

**Check the Output Channel**:

1. Go to **View → Output**
2. Select **"Cognee Memory"** from the dropdown
3. Look for initialization errors

**Common Issues**:

#### 1. "OPENAI_API_KEY not found"

**Solution**: Create a `.env` file in your workspace root with:

```env
OPENAI_API_KEY=your_key_here
```

Then reload VS Code: `Ctrl+Shift+P` → **"Reload Window"**

#### 2. "Python not found" or "cognee module not found"

**Solution**: 

- Verify Python installation: `python3 --version`
- Install Cognee: `pip install cognee==0.3.4`
- If using a virtual environment, set `cogneeMemory.pythonPath` to your venv Python path (e.g., `/path/to/venv/bin/python3`)

#### 3. "No workspace folder open"

**Solution**: The extension requires a workspace (not single-file mode). Open a folder:

- **File → Open Folder**
- Or use the command: `code /path/to/your/project`

#### 4. Slow Performance

**Solutions**:

- Check that `cogneeMemory.logLevel` is not set to `"debug"` (this slows down operations)
- Reduce `maxContextResults` to 1-2 for faster retrieval
- Reduce `maxContextTokens` to 1000 for lighter processing

#### 5. Memory Not Working

**Checklist**:

1. Verify `cogneeMemory.enabled` is `true` in settings
2. Check Output Channel logs for retrieval attempts
3. Remember: The first conversation in a new workspace has no context (memory starts empty)
4. Each workspace has separate memory—switching workspaces means different context

### Common Error Patterns

| Symptom | Likely Cause | Recommended Action |
|---------|--------------|-------------------|
| "Python script exited with code 1" (empty stderr) | Interpreter mismatch: `cognee` or `python-dotenv` not installed in detected Python environment | Set `cogneeMemory.pythonPath` in VS Code settings to correct interpreter (Linux/macOS: `.venv/bin/python`, Windows: `.venv\Scripts\python.exe`) |
| "No module named 'cognee'" | Missing `cognee` package in Python environment | Install with: `pip install cognee==0.3.4` (or activate virtual environment first) |
| "OPENAI_API_KEY not found" | Missing API key in `.env` file or environment | Create `.env` file in workspace root with valid `OPENAI_API_KEY`, then reload window |
| Script timeout (10 seconds) | Network issues, slow LLM provider, or filesystem delay | Check network connectivity, verify LLM provider status, check Output Channel for specific operation that timed out |
| JSON parse error in logs | Script produced non-JSON output | Report as bug. Check for conflicting print statements in bridge scripts. |

**Note**: Auto-detection works for standard `.venv` setups on Linux, macOS, and Windows. For remote contexts (Remote-SSH, WSL, Dev Containers), conda, or pyenv, use explicit `cogneeMemory.pythonPath` configuration.

### Clearing Memory

To reset your workspace memory (e.g., to start fresh or clear sensitive data):

```bash
rm -rf .cognee/
```

The extension will reinitialize on next activation, creating a fresh knowledge graph.

## Architecture

**How It Works**:

- **TypeScript Extension** communicates with Python bridge scripts via subprocess calls
- **Python Bridge Scripts** use the Cognee library for knowledge graph operations
- **Workspace Isolation** is achieved through unique dataset identifiers (SHA1 hash of workspace path)
- **Data Storage** is in Cognee's global database (typically `~/.local/share/cognee`), logically isolated by dataset
- **Ontology** defines chat-specific entities: User, Question, Answer, Topic, Concept, Problem, Solution, Decision

**Data Flow**:

1. User asks a question in Copilot Chat
2. Extension retrieves relevant context from Cognee memory (Python subprocess)
3. Context is injected into Copilot's prompt
4. Copilot responds with enhanced context awareness
5. Extension captures the conversation (question + response) and stores it in Cognee

## Privacy and Data Storage

- **Local-Only Operation** - All data stays on your local machine; no cloud services involved
- **No Telemetry** - The extension does not collect analytics or usage data
- **Workspace Isolation** - Each workspace has isolated memory; no cross-project data leakage
- **API Key Security** - Your API key is never logged or transmitted except to your configured LLM provider
- **Data Location** - Memory is stored in Cognee's database (typically `~/.local/share/cognee`)

To completely remove all extension data:

```bash
rm -rf ~/.local/share/cognee
rm -rf .cognee/  # In each workspace
```

## Known Limitations

- **Workspace Required** - Extension doesn't work in single-file mode
- **Python Dependency** - Python and Cognee must be installed separately (not bundled)
- **First Conversation** - The first conversation in a new workspace has no context (memory starts empty)
- **Chat Only** - Currently captures Copilot chat conversations; inline completions are not captured
- **Platform Support** - Primarily tested on macOS and Linux; Windows support may require additional configuration

## Screenshots

### Automatic Context Retrieval

![Context Retrieval](media/screenshot-retrieval.png)

*Example: The extension automatically retrieves relevant memories before responding*

### Configuration Options

![Settings](media/screenshot-settings.png)

*Configure memory behavior through VS Code settings*

### Initialization Logs

![Output Channel](media/screenshot-output.png)

*Monitor extension activity through the Output Channel*

**Note**: Screenshots will be added before the initial release.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](../CONTRIBUTING.md) for:

- Development setup instructions
- How to run tests
- Code style guidelines
- Pull request process

## License

This extension is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Support

- **Report Bugs**: [GitHub Issues](https://github.com/lsalsich/cognee/issues)
- **Feature Requests**: [GitHub Discussions](https://github.com/lsalsich/cognee/discussions)
- **Documentation**: [Cognee Docs](https://docs.cognee.ai)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

---

**Built with** [Cognee](https://github.com/topoteretes/cognee) - A knowledge graph library for LLM applications.
