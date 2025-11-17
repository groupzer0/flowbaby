# Cognee Chat Memory

> Memory-augmented chat for VS Code using Cognee knowledge graphs

Cognee Chat Memory is a VS Code extension that lets you selectively capture important chat conversations and retrieve them as context through the `@cognee-memory` participant. Each workspace maintains its own isolated memory, creating a personalized knowledge graph that grows with your project.

## Features

- **Selective Capture** - Use keyboard shortcut (Ctrl+Alt+C / Cmd+Alt+C) to capture valuable conversations worth remembering
- **@cognee-memory Participant** - Retrieves relevant context and generates informed responses when you explicitly invoke it
- **Keyboard Shortcut Workflow** - Press Ctrl+Alt+C, paste or type content, instant capture with confirmation
- **Command Palette Alternative** - Run "Cognee: Capture to Memory" for the same capture workflow
- **Workspace Isolation** - Each workspace has its own separate memory—no cross-project leakage
- **Hybrid Graph-Vector Search** - Combines relationship traversal with semantic similarity for superior context relevance
- **User Control** - You decide what gets captured; explicit memory actions put you in full control
- **Privacy-First Design** - All data stays on your local machine; no cloud services or telemetry

## Prerequisites

Before installing the extension, ensure you have:

- **VS Code** 1.85.0 or higher
- **Python** 3.8+ installed and available in PATH
- **Cognee Library** 0.3.4 installed: `pip install cognee==0.3.4`
- **OpenAI API Key** (or compatible LLM provider) set as `LLM_API_KEY` in your workspace `.env` file

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
LLM_API_KEY=sk-your-key-here
```

Or set as an environment variable before launching VS Code:

```bash
export LLM_API_KEY=sk-your-key-here
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

### Capturing Conversations

**Keyboard Shortcut (Primary Method)**:
1. View a valuable chat message (from any participant: @workspace, @terminal, GitHub Copilot, etc.)
2. Press **Ctrl+Alt+C** (or **Cmd+Alt+C** on macOS)
3. Paste the message content in the input box (or leave empty to use clipboard)
4. Press Enter to capture
5. See "✅ Captured to memory" confirmation

**Command Palette (Alternative)**:
1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type "Cognee: Capture to Memory"
3. Follow the same workflow as keyboard shortcut

**What Gets Captured**:
- Chat conversations from ANY participant (@workspace, @terminal, GitHub Copilot, etc.)
- Manual notes and observations you type
- Code explanations and discussions
- Only content YOU choose to capture (selective, user-controlled)

### Retrieving Context with @cognee-memory

**How to Use**:
1. Open GitHub Copilot Chat (`Ctrl+Alt+I` or click chat icon)
2. Type: `@cognee-memory How did I implement caching?`
3. The participant:
   - Retrieves relevant memories from your workspace knowledge graph
   - Shows previews: "📚 Retrieved 3 memories"
   - Augments your question with retrieved context
   - Generates a contextually-aware response
   - Optionally captures the conversation for future retrieval (if enabled via config)

**Example Queries**:
- `@cognee-memory What problems did we discuss about the authentication system?`
- `@cognee-memory What solutions did we consider for rate limiting?`
- `@cognee-memory Summarize our decisions about database architecture`

### Memory Management Commands

**Toggle Memory On/Off**:
- Command Palette → "Cognee: Toggle Memory"
- Flips `cogneeMemory.enabled` setting

**Clear Workspace Memory**:
- Command Palette → "Cognee: Clear Workspace Memory"
- Deletes all captured conversations for current workspace (requires confirmation)

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
| `cogneeMemory.autoIngestConversations` | **Experimental**: Auto-capture @cognee-memory conversations (disabled due to Cognee 0.4.0 bug) | `false` |
| `cogneeMemory.pythonPath` | Path to Python interpreter (must have Cognee installed) | `python3` |
| `cogneeMemory.logLevel` | Logging verbosity: error, warn, info, debug | `info` |

**Examples**:
- To disable memory temporarily, set `cogneeMemory.enabled` to `false` in settings
- To enable experimental auto-capture of @cognee-memory conversations (feedback loop), set `cogneeMemory.autoIngestConversations` to `true` (may fail intermittently due to known Cognee bug)

## Troubleshooting

### Extension Not Activating

**Check the Output Channel**:

1. Go to **View → Output**
2. Select **"Cognee Memory"** from the dropdown
3. Look for initialization errors

**Common Issues**:

#### 1. "LLM_API_KEY not found"

**Solution**: Create a `.env` file in your workspace root with:

```env
LLM_API_KEY=sk-your-key-here
```

Then reload VS Code: `Ctrl+Shift+P` → **"Reload Window"**

**Note**: As of v0.2.1, `OPENAI_API_KEY` is no longer supported. Use `LLM_API_KEY` to align with Cognee 0.4.0.

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

#### 5. Capture or Retrieval Not Working

**Capture Issues**:

1. Verify keyboard shortcut (Ctrl+Alt+C / Cmd+Alt+C) is not conflicting with other extensions
2. Check Command Palette for "Cognee: Capture to Memory" as alternative
3. Ensure you see confirmation message after capture ("✅ Captured to memory")
4. Check Output Channel logs for ingestion errors

**Retrieval Issues**:

1. Verify `cogneeMemory.enabled` is `true` in settings
2. Type `@cognee-memory` in chat to invoke the participant explicitly
3. Check Output Channel logs for retrieval attempts and timing
4. Remember: The first conversation in a new workspace has no context (memory starts empty)
5. Each workspace has separate memory—switching workspaces means different context
6. If retrieval fails, you'll see "⚠️ Memory retrieval unavailable" but participant continues without context

### Common Error Patterns

| Symptom | Likely Cause | Recommended Action |
|---------|--------------|-------------------|
| "Python script exited with code 1" (empty stderr) | Interpreter mismatch: `cognee` or `python-dotenv` not installed in detected Python environment | Set `cogneeMemory.pythonPath` in VS Code settings to correct interpreter (Linux/macOS: `.venv/bin/python`, Windows: `.venv\Scripts\python.exe`) |
| "No module named 'cognee'" | Missing `cognee` package in Python environment | Install with: `pip install cognee==0.3.4` (or activate virtual environment first) |
| "LLM_API_KEY not found" | Missing API key in `.env` file or environment | Create `.env` file in workspace root with valid `LLM_API_KEY`, then reload window |
| Script timeout (retrieval: 15s, ingestion: 120s) | Network issues, slow LLM provider, or filesystem delay | Ingestion timeout is generous (120s); if timeout occurs but data appears via @cognee-memory, ingestion succeeded in background. Check Output Channel for timing metrics. |
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
- **Workspace Isolation** is achieved through unique dataset identifiers (SHA1 hash of workspace path) and workspace-local storage directories
- **Data Storage** is in workspace-local directories (`.cognee_system/` and `.cognee_data/`) created in each workspace root (v0.2.1+)
- **Ontology** defines chat-specific entities: User, Question, Answer, Topic, Concept, Problem, Solution, Decision

**Data Flow**:

**Capture Flow**:
1. User presses Ctrl+Alt+C (or uses Command Palette)
2. Extension shows input box for content
3. User pastes chat message or types manually
4. Extension calls Python bridge (`ingest.py`) via subprocess
5. Cognee stores conversation in workspace-specific knowledge graph

**Retrieval Flow**:
1. User types `@cognee-memory [question]` in chat
2. Extension calls Python bridge (`retrieve.py`) via subprocess
3. Cognee searches knowledge graph using hybrid graph-vector search
4. Extension formats retrieved context with previews
5. Extension augments user's question with context
6. Extension sends augmented prompt to language model
7. Response streams back to user
8. (Optional) Extension captures Q&A conversation for future retrieval (if `autoIngestConversations` enabled)

## Privacy and Data Storage

- **Local-Only Operation** - All data stays on your local machine; no cloud services involved
- **No Telemetry** - The extension does not collect analytics or usage data
- **Workspace Isolation** - Each workspace has isolated memory in its own directories; no cross-project data leakage
- **API Key Security** - Your API key is never logged or transmitted except to your configured LLM provider
- **Data Location** - Memory is stored in workspace-local directories: `.cognee_system/` (system data) and `.cognee_data/` (knowledge graph data)

To completely remove all extension data from a workspace:

```bash
rm -rf .cognee/ .cognee_system/ .cognee_data/  # In workspace root
```

## Known Limitations

- **Workspace Required** - Extension doesn't work in single-file mode
- **Python Dependency** - Python and Cognee must be installed separately (not bundled)
- **Manual Capture** - Keyboard shortcut requires copy-paste workflow; cannot extract message from chat UI directly (VS Code API limitation)
- **Explicit Participant Invocation** - Must type `@cognee-memory` to trigger retrieval; cannot inject context into other participants (@workspace, GitHub Copilot, etc.)
- **First Conversation** - The first conversation in a new workspace has no context (memory starts empty)
- **Step 6 Auto-Ingestion Disabled by Default** - Automatic capture of @cognee-memory conversations (feedback loop) is experimental due to Cognee 0.4.0 file hashing bug; enable via `cogneeMemory.autoIngestConversations` for testing
- **Platform Support** - Primarily tested on macOS and Linux; Windows support may require additional configuration

## Known Issues

### Cognee 0.4.0 File Hashing Bug (Auto-Ingestion)

**Issue**: Cognee v0.4.0 has an intermittent file hashing bug that causes ingestion to fail unpredictably when the same conversation is ingested multiple times. This affects automatic capture of @cognee-memory conversations (Step 6 feedback loop).

**Symptoms**:
- Conversations fail to ingest with hash mismatch errors
- Intermittent failures (some ingests succeed, others fail for identical content)
- Errors logged in Output Channel: "File not found" or hash-related issues

**Workaround**:
- **Default**: `cogneeMemory.autoIngestConversations` is set to `false` (auto-ingestion disabled)
- **Manual Capture**: Use keyboard shortcut (Ctrl+Alt+C) to capture conversations manually—this does NOT trigger the bug
- **Experimental Testing**: Set `cogneeMemory.autoIngestConversations` to `true` to test feedback loop (may experience intermittent failures)
- **Graceful Degradation**: Ingestion failures are logged to Output Channel but do NOT crash the extension or interrupt chat participant functionality

**Status**: Monitoring Cognee updates for bug fix; will enable auto-ingestion by default when resolved.

**Reference**: See implementation documentation in `implementation/008-chat-participant-memory-integration-implementation.md` for detailed validation findings and error logs.

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

### Debugging

For extension developers:

#### Launch Extension Development Host

1. Open the `extension/` folder in VS Code (not the repository root)
2. Press **F5** in VS Code
3. New window opens with extension loaded
4. Check Debug Console for activation logs (View → Debug Console)

#### Set Breakpoints

- Click left margin in TypeScript files to set breakpoints
- Breakpoints pause execution in Extension Host
- Source maps enable debugging original TypeScript code

#### View Logs

The extension outputs logs to different locations:

- **Debug Console**: Extension activation and runtime logs (View → Debug Console)
- **Output Channel**: CogneeClient bridge operations—select "Cognee Memory" from dropdown (View → Output)
- **Developer Tools**: Extension Host errors—open with Help → Toggle Developer Tools

#### Test Changes

After modifying code:

- **Rebuild**: Run `npm run compile` in the `extension/` directory
- **Reload**: Press **Ctrl+R** (or **Cmd+R** on Mac) in the Extension Development Host window
- **Auto-compile**: The `preLaunchTask` in `.vscode/launch.json` auto-compiles when pressing F5

See [SETUP.md](SETUP.md) for complete development environment setup.

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
