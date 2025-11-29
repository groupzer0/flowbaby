# Flowbaby Chat Memory

> Memory-augmented Copilot chat for VS Code

Flowbaby automatically captures and summarizes key moments from your GitHub Copilot chats, then surfaces them as context in future conversations to reduce drift in long-running work. Each workspace gets its own isolated memory and Python environment, and no code from your repository ever leaves your machine—only the chat content already sent to Copilot is summarized and reused, under your control.

## Features

- **Context aware automatic memory search** - Flowbaby is configured to use chat conversation cues to search memory and add that memory context to the chat - keeping your Copilot agent from drifting and saving you from having to explain what happened all over again. 
![Screenshot](media/auto-search.png)
- **Context aware automatic memory storage** - Flowbaby knows when it's a good time to summarize and store memories based on the chat context. 
![Screenshot](media/auto-store.png)
- **@flowbaby chat participant** – A dedicated Copilot participant that recalls past conversations and surfaces relevant memories into new chats to reduce drift over long sessions.
![Screenshot](media/interactive-chat-participant.png)
- **Configurable memory behavior via stored prompts** – Guide Flowbaby with stored natural-language instructions (e.g., what to store, what to ignore, how aggressively to retrieve) so each workspace can have its own memory style.
- **Agent tools for storage and retrieval** – Exposes two standard Copilot tools (for storing and retrieving memories) that are available to GitHub Copilot just like any other tool, so agents can autonomously call them when helpful.
- **Keyboard Shortcut Workflow** – Press Ctrl+Alt+F / Cmd+Alt+F to capture important snippets from chat or code with a quick confirmation flow.
- **Command Palette Alternative** – Run “Flowbaby: Capture to Memory” if you prefer command-palette based capture.
![Screenshot](media/manual-store-summary.png)
- **Workspace Isolation** – Each workspace has its own separate memory and Python environment—no cross-project leakage.
- **Hybrid Graph-Vector Search** – Combines knowledge-graph structure with vector similarity for higher-quality, controllable retrieval.
- **Privacy-First Design** – All data stays on your machine; only chat content already sent to GitHub Copilot is summarized, and no repository files or file content are sent to any external LLM.

## Prerequisites

Before installing the extension, ensure you have:

- **VS Code** 1.106.0 or higher
- **Python** 3.8+ installed on your system

Flowbaby automatically creates and manages its own isolated Python environment (`.flowbaby/venv`) in each workspace. You do not need to install any Python packages manually.

## Installation

### Method 1: Install from VS Code Marketplace (Recommended)

1. Open VS Code
2. Go to the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for **"Flowbaby"**
4. Click **Install**
5. Reload VS Code when prompted

### Method 2: Install from VSIX

1. Download the latest `.vsix` file from [GitHub Releases](https://github.com/lsalsich/flowbaby/releases)
2. Open VS Code
3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
4. Type **"Install from VSIX"** and select the command
5. Navigate to the downloaded `.vsix` file and select it
6. Reload VS Code when prompted

## Setup

After installation, configure your workspace:

### 1. Initialize Workspace (Automated)

Flowbaby now manages its own Python environment automatically.

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **"Flowbaby: Initialize Workspace"**
3. The extension will:
   - Check for Python 3.8+
   - Create a dedicated `.flowbaby/venv` in your workspace (isolated from project venvs)
   - Install `cognee` and dependencies
   - Verify the environment is ready

### 2. Configure API Key

**Global API Key (Stored Securely)**

Use the built-in command to set your API key once, securely stored via VS Code's SecretStorage:

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **"Flowbaby: Set API Key"**
3. Enter your API key when prompted

This stores the key securely and applies to all workspaces automatically.

### 3. Verify Extension Activation

1. Check the status bar for **"Flowbaby"** (checkmark)
2. If you see **"Flowbaby: Setup Required"** (yellow warning), click it to run setup
3. Optional: Open the Output panel (**View → Output**) and select **"Flowbaby"** to see logs

## Usage

### Environment Management (v0.3.14+)

Flowbaby includes tools to keep your environment healthy:

- **Status Bar**: Shows real-time health (Ready, Setup Required, Refreshing, Error)
- **Refresh Dependencies**: If you encounter issues, run **"Flowbaby: Refresh Bridge Dependencies"** to safely reinstall the environment without losing data.
- **Background Safety**: Refresh operations automatically pause background tasks to prevent conflicts.

### Async Ingestion Behavior (v0.3.3+)

Starting in v0.3.3, memory ingestion operates asynchronously to prevent blocking your workflow. Here's what to expect:

**Timing Expectations**:
- **Capture Response**: 5-10 seconds—you can continue working immediately after capture
- **Background Processing**: 60-90 seconds—knowledge graph construction happens in the background
- **Total Time**: ~1-2 minutes from capture to searchable memory

**Staged Messaging**:

When you capture a memory (via keyboard shortcut, command palette, or agent tools), you'll see:

> **"Memory staged – processing will finish in ~1–2 minutes. You'll get a notification when it's done."**

This means:
- ✅ Your content has been safely staged for processing
- ✅ You can continue working without waiting
- ⏳ Knowledge graph construction is running in the background
- 🔔 You'll receive a notification when processing completes

**Completion Notifications**:

After background processing finishes, you'll receive one of two notifications:

- **Success** (ℹ️ Info): "✅ Flowbaby finished" with workspace name, summary digest, elapsed time, and entity count. Click "View Status" to see all background operations.
- **Failure** (⚠️ Warning): "⚠️ Flowbaby failed" with workspace name, summary digest, and remediation guidance. Click "Retry" to re-process or "View Logs" for error details.

**Why Async?**

Previously, memory capture blocked for 60-90 seconds while the knowledge graph was being built. This made agents unresponsive and disrupted your workflow. With async ingestion:
- Agents return responses in <10 seconds
- You can store multiple memories without waiting
- Background processing doesn't interrupt your work
- You're only notified if there's an error

**Background Status**:

To check all in-flight operations:
1. Press `Cmd+Shift+P` (or `Ctrl+Shift+P` on Linux/Windows)
2. Type "Flowbaby: View Background Operations"
3. View pending, running, completed, and failed operations

### Capturing Conversations

**Keyboard Shortcut (Primary Method)**:
1. View a valuable chat message (from any participant: @workspace, @terminal, GitHub Copilot, etc.)
2. Press **Ctrl+Alt+F** (or **Cmd+Alt+F** on macOS)
3. Paste the message content in the input box (or leave empty to use clipboard)
4. Press Enter to capture
5. See "Memory staged – processing will finish in ~1–2 minutes. You'll get a notification when it's done." confirmation
6. Continue working—you'll receive a completion notification when ready

**Command Palette (Alternative)**:
1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type "Flowbaby: Capture to Memory"
3. Follow the same workflow as keyboard shortcut

**What Gets Captured**:
- Chat conversations from ANY participant (@workspace, @terminal, GitHub Copilot, etc.)
- Manual notes and observations you type
- Code explanations and discussions
- Only content YOU choose to capture (selective, user-controlled)

### Retrieving Context with @flowbaby

**How to Use**:
1. Open GitHub Copilot Chat (`Ctrl+Alt+I` or click chat icon)
2. Type: `@flowbaby How did I implement caching?`
3. The participant:
   - Retrieves relevant memories from your workspace knowledge graph
   - Shows previews: "📚 Retrieved memories"
   - Augments your question with retrieved context
   - Generates a contextually-aware response
   - Optionally captures the conversation for future retrieval (if enabled via config)

**Example Queries**:
- `@flowbaby What problems did we discuss about the authentication system?`
- `@flowbaby What solutions did we consider for rate limiting?`
- `@flowbaby Summarize our decisions about database architecture`

### Creating Conversation Summaries (Plan 014)

**What are Conversation Summaries?**

Conversation summaries are structured records that capture the essence of a chat session, including:
- Main topic and context
- Key decisions made
- Rationale behind decisions
- Open questions still unresolved
- Next steps to take
- References to files, plans, or other resources

Summaries are more valuable than raw chat logs because they're organized, searchable, and focus on what matters most.

**When to Create Summaries**:

Create a summary when you've:
- Completed a design discussion with important decisions
- Resolved a complex debugging issue with lessons learned
- Made architectural choices that should be remembered
- Discussed tradeoffs between different approaches
- Reached conclusions about implementation direction

**How to Create a Summary**:

1. **Open GitHub Copilot Chat** (`Ctrl+Alt+I` / `Cmd+Alt+I`)
2. **Start a conversation with @flowbaby** and type:
   - `@flowbaby summarize this conversation`
   - Or: `@flowbaby remember this session`
   - Or: `@flowbaby create summary`

3. **Review the scope preview**:
   - Extension shows: "I'll summarize the last 15 turns (from 5 mins ago)."
   - Default is last 15 conversation turns

4. **Adjust turn count (optional)**:
   - Type a number to change scope: `30` → "I'll summarize the last 30 turns..."
   - Repeat to iteratively adjust: `20` → "I'll summarize the last 20 turns..."
   - Say `confirm` when ready to proceed

5. **Review the generated summary**:
   - Extension uses LLM to analyze conversation history
   - Displays structured summary with all sections (Topic, Context, Decisions, etc.)
   - Shows metadata: Status, timestamps, plan IDs if detected

6. **Confirm storage**:
   - Extension asks: "Should I store this summary in Flowbaby memory?"
   - Reply `yes`, `store it`, or `save` to confirm
   - Reply `no` or `cancel` to discard
   - Summary is only stored after explicit confirmation

### Retrieving Summaries

When you query `@flowbaby`, the extension searches both raw captured conversations and structured summaries. Summaries display with rich metadata when available.

**What You'll See in Retrieval Results**:

Enriched summaries:

- **Structured sections**: Topic, Key Decisions, Open Questions, Next Steps
- **Full transparency**: Up to 32000 characters shown with explicit truncation indicator if longer

**Example Retrieval Queries**:

- `@flowbaby What did we decide about Plan 013?` → Retrieves relevant summaries with decisions highlighted
- `@flowbaby What questions are still open about memory transparency?` → Finds Open Questions sections from summaries
- `@flowbaby What are the next steps for the authentication system?` → Retrieves Next Steps from related summaries
- `@flowbaby Show me the rationale for using enriched text format` → Finds Rationale sections explaining design choices

**Retrieval Benefits**:

- **Faster answers**: Structured summaries surface key points without reading full conversations
- **Better context**: LLM sees organized decisions/rationale instead of scattered chat logs
- **Temporal awareness**: Timestamps help distinguish recent vs historical decisions
- **Status tracking**: Know if decisions are still Active or have been Superseded

### Memory Management Commands

**Toggle Memory On/Off**:
- Command Palette → "Flowbaby: Toggle Memory"
- Flips `Flowbaby.enabled` setting

**Clear Workspace Memory**:
- Command Palette → "Flowbaby: Clear Workspace Memory"
- Deletes all captured conversations for current workspace (requires confirmation)

## For Agent Developers

Flowbaby Chat Memory provides an API for GitHub Copilot agents and third-party VS Code extensions to store and retrieve structured summaries programmatically.

### Use Cases

- **Agent Continuity**: Agents can maintain context across sessions without requiring manual redirection
- **Multi-Agent Collaboration**: Different agents can share memory via a common knowledge base per workspace

### Agent Ingestion API

The `Flowbaby.ingestForAgent` command allows agents to write structured summaries to Flowbaby:

```typescript
const payload = {
  topic: "Plan 015 Implementation Discussion",
  context: "User discussed agent ingestion command design with architect.",
  decisions: ["Use VS Code commands as primary surface", "Implement workspace-global access model"],
  rationale: ["Commands are accessible to Copilot agents", "VS Code doesn't expose caller identity"],
  metadata: {
    topicId: "plan-015-implementation",
    sessionId: "session-2025-11-19-001",
    planId: "015",
    status: "Active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
};

const responseJson = await vscode.commands.executeCommand<string>(
  'Flowbaby.ingestForAgent',
  JSON.stringify(payload)
);

const response = JSON.parse(responseJson);

if (response.success) {
  console.log(`✅ Ingested ${response.ingested_chars} characters`);
} else {
  console.error(`❌ Error: ${response.error} (${response.errorCode})`);
}
```

### Configuration

Flowbaby tools are controlled exclusively through VS Code's **Configure Tools** UI (see Quick Start below). No additional workspace settings are required for authorization.

### Documentation

- **Complete API Guide**: [AGENT_INTEGRATION.md](./AGENT_INTEGRATION.md)
  - TypeScript examples and error handling
  - Security model and best practices
  - Troubleshooting guide
- **Bridge Contract**: [bridge/INGEST_CONTRACT.md](./bridge/INGEST_CONTRACT.md)
  - JSON schema specification
  - Error codes reference
  - Performance characteristics
- **Test Agent**: [test-agent/](../test-agent/)
  - Reference implementation validating all scenarios
  - Can be used as template for custom agents

### Automatic Detection

**`.flowbaby/venv`?** This location prevents conflicts with project virtual environments (e.g., Python Jedi language server overwriting Flowbaby's dependencies). The `.flowbaby/` directory is also automatically added to `.gitignore`.

### When to Configure Manually

Set `Flowbaby.pythonPath` explicitly if:
- Virtual environment is outside workspace directory
- Using conda or pyenv environments (not auto-detected)
- Want to share a Python environment across multiple workspaces

Example configuration in VS Code settings:

```json
{
  "Flowbaby.pythonPath": "/path/to/your/.flowbaby/venv/bin/python"
}
```

**Platform-specific examples**:
- Linux/macOS: `/home/user/project/.flowbaby/venv/bin/python`
- Windows: `C:\Users\user\project\.flowbaby\venv\Scripts\python.exe`

### Unsupported Contexts (v0.2.0)

The following contexts are **not validated or supported** in this release:
- **Remote Development**: VS Code Remote-SSH, WSL, Dev Containers
- **Multi-root Workspaces**: Workspaces with multiple folder roots
- **Conda Environments**: Automatic detection not implemented (use explicit config)
- **Pyenv Environments**: Automatic detection not implemented (use explicit config)

Support for these contexts may be added in future releases.

### Configuration

Access settings via **File → Preferences → Settings → Extensions → Flowbaby Memory**:

| Setting | Description | Default |
|---------|-------------|---------|
| `Flowbaby.enabled` | Toggle memory capture and retrieval on/off | `true` |
| `Flowbaby.maxContextResults` | Maximum number of memory results to retrieve | `3` |
| `Flowbaby.maxContextTokens` | Token budget for retrieved context | `32000` |
| `Flowbaby.searchTopK` | Maximum candidates to request from search engine before ranking | `10` |
| `Flowbaby.ranking.halfLifeDays` | Half-life (in days) for recency-aware ranking | `7` |
| `Flowbaby.autoIngestConversations` | **Experimental**: Auto-capture @flowbaby conversations | `false` |
| `flowbaby.notifications.showIngestionSuccess` | Show success notifications for memory ingestion | `true` |
| `Flowbaby.pythonPath` | Path to Python interpreter | `python3` |
| `Flowbaby.logLevel` | Logging verbosity: error, warn, info, debug | `info` |
| `Flowbaby.debugLogging` | Show debug output channel (for troubleshooting) | `false` |

### LLM Configuration

Configure your LLM provider via **File → Preferences → Settings → Extensions → Flowbaby Memory**:

| Setting | Description | Default |
|---------|-------------|---------|
| `Flowbaby.llm.provider` | LLM provider (openai, anthropic, ollama, etc.) | `openai` |
| `Flowbaby.llm.model` | Model name (e.g., gpt-4o-mini, claude-3-opus) | `gpt-4o-mini` |
| `Flowbaby.llm.endpoint` | Custom API endpoint (for self-hosted models) | *(empty)* |

**Provider Examples**:
- **OpenAI (default)**: Leave provider as `openai`, model as `gpt-4o-mini`
- **Anthropic Claude**: Set provider to `anthropic`, model to `claude-3-opus-20240229`
- **Local Ollama**: Set provider to `ollama`, model to your model name, endpoint to `http://localhost:11434`

**Additional Examples**:
- To disable memory temporarily, set `Flowbaby.enabled` to `false` in settings
- To enable experimental auto-capture of @flowbaby conversations (feedback loop), set `Flowbaby.autoIngestConversations` to `true`

## Using Flowbaby Tools with Custom Agents

Flowbaby Chat Memory provides **Language Model Tools** that allow GitHub Copilot and custom agents to autonomously access workspace memory. These tools appear in VS Code's "Configure Tools" dialog and can be referenced in custom agent configurations.

### Quick Start

1. **Enable Tools via Configure Tools UI**:
   - Open Copilot chat → Click "Tools" (⚙️ icon) → "Configure Tools"
   - Find "Store Memory in Flowbaby" and "Retrieve Flowbaby Memory"
   - Toggle tools on/off individually (disabled by default for privacy)

2. **Use in Chat**:
   - Type `#flowbaby` to see autocomplete suggestions
   - Select `#flowbabyStoreSummary` or `#flowbabyRetrieveMemory`
   - Tools appear only when enabled via Configure Tools

3. **Transparency**:
   - All tool invocations logged in Output channel ("Flowbaby Agent Activity")
   - Configure Tools UI provides visual feedback for tool state

### Custom Agent Example

Create a `.agent.md` file in your workspace to define a memory-aware agent:

```markdown
---
name: Memory-Aware Code Assistant
description: Copilot assistant with access to workspace memory
tools: ['search', 'flowbabyStoreSummary', 'flowbabyRetrieveMemory']
---

You are a code assistant with access to workspace-specific memory.

When the user asks about past decisions or implementations:
1. Use #flowbabyRetrieveMemory to search for relevant context
2. Ground your answer in the retrieved memories
3. If no memories exist, use your training data but clarify it's not workspace-specific

When the user completes an important implementation or makes a decision:
1. Offer to store a summary using #flowbabyStoreSummary
2. Include topic, context, and key decisions in the summary
```

### Available Tools

#### Store Memory Tool (`#flowbabyStoreSummary`)

Stores conversation summaries in Flowbaby knowledge graph.

**Parameters**:
- `topic` (required): Summary title
- `context` (required): Summary description
- `decisions` (optional): Key decisions made
- `rationale` (optional): Reasoning behind decisions
- `metadata` (optional): Plan ID, status, etc.

#### Retrieve Memory Tool (`#flowbabyRetrieveMemory`)

Searches Flowbaby knowledge graph for relevant memories.

**Parameters**:
- `query` (required): Natural language search query
- `maxResults` (optional): Max results to return (default: 3, max: 10)

**Returns**: Both narrative markdown and structured JSON for agent parsing.

### Agent Integration Settings

### Transparency

When agents use Flowbaby, you see:

- **Output Channel**: All tool invocations logged in "Flowbaby Agent Activity"
- **Configure Tools UI**: Visual feedback for which tools are enabled/disabled
- **Chat Autocomplete**: `#flowbaby*` commands only appear when tools are enabled

### For Extension Developers

See [AGENT_INTEGRATION.md](./AGENT_INTEGRATION.md) for:
- Complete API documentation with TypeScript examples
- Command signatures (`Flowbaby.ingestForAgent`, `Flowbaby.retrieveForAgent`)
- Error codes and handling strategies
- Request/response schemas
- Testing and troubleshooting guides

## Troubleshooting

### Extension Not Activating

**Check the Output Channel**:

1. Go to **View → Output**
2. Select **"Flowbaby Memory"** from the dropdown
3. Look for initialization errors

**Enable Debug Logging**: If you need more detailed information, enable `Flowbaby.debugLogging` in settings and use **"Flowbaby: Show Debug Logs"** command.

**Common Issues**:

#### 1. "LLM_API_KEY not found"

**Solution**: Use the **"Flowbaby: Set API Key"** command

Then reload VS Code: `Ctrl+Shift+P` → **"Reload Window"**

#### 2. "Python not found" or "cognee module not found"

**Solution**: 

- Run **"Flowbaby: Initialize Workspace"** to set up the environment automatically
- If using a custom Python environment, set `Flowbaby.pythonPath` to your Python path

#### 3. "No workspace folder open"

**Solution**: The extension requires a workspace (not single-file mode). Open a folder:

- **File → Open Folder**
- Or use the command: `code /path/to/your/project`

#### 4. Slow Performance

**Solutions**:

- Check that `Flowbaby.logLevel` is not set to `"debug"` (this slows down operations)
- Reduce `maxContextResults` to 1-2 for faster retrieval
- Reduce `maxContextTokens` to 1000 for lighter processing

#### 5. Capture or Retrieval Not Working

**Capture Issues**:

1. Verify keyboard shortcut (Ctrl+Alt+F / Cmd+Alt+F) is not conflicting with other extensions
2. Check Command Palette for "Flowbaby: Capture to Memory" as alternative
3. Ensure you see confirmation message after capture ("✅ Captured to memory")
4. Check Output Channel logs for ingestion errors

**Retrieval Issues**:

1. Verify `Flowbaby.enabled` is `true` in settings
2. Type `@flowbaby` in chat to invoke the participant explicitly
3. Check Output Channel logs for retrieval attempts and timing
4. Remember: The first conversation in a new workspace has no context (memory starts empty)
5. Each workspace has separate memory—switching workspaces means different context
6. If retrieval fails, you'll see "⚠️ Memory retrieval unavailable" but participant continues without context

### Common Error Patterns

| Symptom | Likely Cause | Recommended Action |
|---------|--------------|-------------------|
| "Python script exited with code 1" (empty stderr) | Interpreter mismatch: `cognee` or `python-dotenv` not installed in detected Python environment | Set `Flowbaby.pythonPath` in VS Code settings to correct interpreter (Linux/macOS: `.venv/bin/python`, Windows: `.venv\Scripts\python.exe`) |
| "No module named 'cognee'" | Missing `cognee` package in Python environment | Run **"Flowbaby: Initialize Workspace"** to set up environment automatically |
| "LLM_API_KEY not found" | Missing API key in `.env` file or environment | Create `.env` file in workspace root with valid `LLM_API_KEY`, then reload window |
| Script timeout (retrieval: 15s, ingestion: 120s) | Network issues, slow LLM provider, or filesystem delay | Ingestion timeout is generous (120s); if timeout occurs but data appears via @flowbaby, ingestion succeeded in background. Check Output Channel for timing metrics. |
| JSON parse error in logs | Script produced non-JSON output | Report as bug. Check for conflicting print statements in bridge scripts. |

**Note**: Auto-detection works for standard `.venv` setups on Linux, macOS, and Windows. For remote contexts (Remote-SSH, WSL, Dev Containers), conda, or pyenv, use explicit `Flowbaby.pythonPath` configuration.

### Clearing Memory

To reset your workspace memory (e.g., to start fresh or clear sensitive data):

Use `Flowbaby: Clear Workspace Memory` command from the command pallette. This moves your current data to .flowbaby/.trash until you decide to delete it permanently. 

The extension will reinitialize on next activation, creating a fresh knowledge graph.

## Privacy and Data Storage

- **Local-Only Operation** - All data stays on your local machine; no cloud services involved
- **No Telemetry** - The extension does not collect analytics or usage data
- **Workspace Isolation** - Each workspace has isolated memory in its own directories; no cross-project data leakage
- **API Key Security** - Your API key is never logged or transmitted except to your configured LLM provider
- **Data Location** - Memory is stored in workspace-local directories: `.flowbaby/system/` (system data) and `.flowbaby/data/` (knowledge graph data)

To completely remove all extension data from a workspace:

```bash
rm -rf .flowbaby/ .flowbaby/system/ .flowbaby/data/  # In workspace root
```

## Known Limitations

- **Workspace Required** - Extension doesn't work in single-file mode
- **Python Dependency** - Requires Python 3.8+ on your system; Cognee and dependencies are installed automatically in an isolated environment
- **Platform Support** - Primarily tested on macOS and Linux; Windows support may require additional configuration

## Screenshots

### Automatic Context Search

![Automatic Search](media/auto-search.png)

*Flowbaby automatically searches memory based on chat context*

### Automatic Memory Storage

![Automatic Store](media/auto-store.png)

*Flowbaby knows when to store memories based on conversation cues*

### Interactive Chat Participant

![Interactive Chat](media/interactive-chat-participant.png)

*Use @flowbaby to query your workspace memory*

### Manual Memory Storage

![Manual Store](media/manual-store-summary.png)

*Capture important context with keyboard shortcuts*

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
- **Output Channel**: FlowbabyClient bridge operations—select "Flowbaby Memory" from dropdown (View → Output)
- **Developer Tools**: Extension Host errors—open with Help → Toggle Developer Tools

#### Test Changes

After modifying code:

- **Rebuild**: Run `npm run compile` in the `extension/` directory
- **Reload**: Press **Ctrl+R** (or **Cmd+R** on Mac) in the Extension Development Host window
- **Auto-compile**: The `preLaunchTask` in `.vscode/launch.json` auto-compiles when pressing F5

## License

This extension is licensed under the PolyForm Strict License 1.0.0. See [LICENSE](LICENSE) for details.

This extension uses [Cognee](https://github.com/topoteretes/cognee) under the Apache 2.0 license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.

## Support

- **Report Bugs**: [GitHub Issues](https://github.com/lsalsich/flowbaby-issues/issues)
- **Feature Requests**: [GitHub Discussions](https://github.com/lsalsich/flowbaby-issues/discussions)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

---

**Built with** [Cognee](https://github.com/topoteretes/cognee) for knowledge graph operations.
