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

- **Success** (ℹ️ Info): "✅ Cognify finished" with workspace name, summary digest, elapsed time, and entity count. Click "View Status" to see all background operations.
- **Failure** (⚠️ Warning): "⚠️ Cognify failed" with workspace name, summary digest, and remediation guidance. Click "Retry" to re-process or "View Logs" for error details.

**Why Async?**

Previously, memory capture blocked for 60-90 seconds while the knowledge graph was being built. This made agents unresponsive and disrupted your workflow. With async ingestion:
- Agents return responses in <10 seconds
- You can store multiple memories without waiting
- Background processing doesn't interrupt your work
- You're only notified if there's an error

**Background Status**:

To check all in-flight operations:
1. Press `Cmd+Shift+P` (or `Ctrl+Shift+P` on Linux/Windows)
2. Type "Cognee: Background Status"
3. View pending, running, completed, and failed operations

### Capturing Conversations

**Keyboard Shortcut (Primary Method)**:
1. View a valuable chat message (from any participant: @workspace, @terminal, GitHub Copilot, etc.)
2. Press **Ctrl+Alt+C** (or **Cmd+Alt+C** on macOS)
3. Paste the message content in the input box (or leave empty to use clipboard)
4. Press Enter to capture
5. See "Memory staged – processing will finish in ~1–2 minutes. You'll get a notification when it's done." confirmation
6. Continue working—you'll receive a completion notification when ready

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

**Summary Schema**:

Each summary follows this structured format:

```markdown
Summary: [Short title]

Topic: [Main focus of the conversation]
Context: [1-3 sentences explaining what you were working on and why]
Decisions:
- [Key decision 1]
- [Key decision 2]
Rationale:
- [Why decision 1 was made]
Open Questions:
- [Unresolved question 1]
Next Steps:
- [Action item 1]
References:
- [File path, plan ID, or other reference]
Time Scope: [Time range, e.g., "Nov 17 14:00-16:30"]
```

**Example Summary**:

```markdown
Summary: Plan 013 - Memory Display Transparency

Topic: Plan 013 - Memory Display Transparency
Context: Discussed removing the 150-char truncation in chat participant to improve user trust and align with transparency goals.
Decisions:
- Remove hardcoded 150-char limit in participant preview
- Show full memory content up to 2000 chars with explicit truncation indicator
- Update logging to show full query or clearly annotate preview length
Rationale:
- Users need to see what context the LLM is using to trust the system
- Truncated previews create mistrust despite LLM receiving full text
Open Questions:
- Should we add pagination for very long memories?
Next Steps:
- Implement transparency changes in TypeScript layer
- Update tests to verify full content display
References:
- Plan 013 documentation
- System architecture §4.3
Time Scope: Nov 16 10:00-12:30
```

**How to Create a Summary**:

1. **Open GitHub Copilot Chat** (`Ctrl+Alt+I` / `Cmd+Alt+I`)
2. **Start a conversation with @cognee-memory** and type:
   - `@cognee-memory summarize this conversation`
   - Or: `@cognee-memory remember this session`
   - Or: `@cognee-memory create summary`

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
   - Extension asks: "Should I store this summary in Cognee memory?"
   - Reply `yes`, `store it`, or `save` to confirm
   - Reply `no` or `cancel` to discard
   - Summary is only stored after explicit confirmation

**Turn Count Guidance**:

- **Short sessions (5-15 turns)**: Good for focused discussions, bug fixes, quick decisions
- **Medium sessions (15-30 turns)**: Typical for feature planning, architecture discussions
- **Long sessions (30-50 turns)**: Complex multi-topic conversations; consider breaking into multiple summaries
- **Very long (>50 turns)**: May include multiple unrelated topics; review scope carefully

**Best Practices**:

- **Create summaries at natural breakpoints**: After reaching a decision, completing a design, or resolving an issue
- **Keep summaries focused**: One main topic per summary for better retrieval precision
- **Review before storing**: Check that LLM correctly identified key points; adjust turn count if summary misses context
- **Include explicit references**: Mention plan IDs (e.g., "Plan 014"), file paths, or issue numbers in conversation for automatic extraction
- **Balance detail and brevity**: Aim for 300-600 tokens total; focus on decisions and rationale, not verbatim conversation

### Retrieving Summaries

When you query `@cognee-memory`, the extension searches both raw captured conversations and structured summaries. Summaries display with rich metadata when available.

**What You'll See in Retrieval Results**:

For enriched summaries (created via Plan 014):

- **Metadata badges**: 📋 Status | 📅 Created timestamp | 🏷️ Plan ID
- **Structured sections**: Topic, Key Decisions, Open Questions, Next Steps
- **Full transparency**: Up to 2000 characters shown with explicit truncation indicator if longer

For legacy memories (captured before Plan 014):

- **Plain text format**: Raw conversation content as originally captured
- **No metadata**: Legacy memories don't include structured fields

**Example Retrieval Queries**:

- `@cognee-memory What did we decide about Plan 013?` → Retrieves relevant summaries with decisions highlighted
- `@cognee-memory What questions are still open about memory transparency?` → Finds Open Questions sections from summaries
- `@cognee-memory What are the next steps for the authentication system?` → Retrieves Next Steps from related summaries
- `@cognee-memory Show me the rationale for using enriched text format` → Finds Rationale sections explaining design choices

**Retrieval Benefits**:

- **Faster answers**: Structured summaries surface key points without reading full conversations
- **Better context**: LLM sees organized decisions/rationale instead of scattered chat logs
- **Temporal awareness**: Timestamps help distinguish recent vs historical decisions
- **Status tracking**: Know if decisions are still Active or have been Superseded

### Memory Management Commands

**Toggle Memory On/Off**:
- Command Palette → "Cognee: Toggle Memory"
- Flips `cogneeMemory.enabled` setting

**Clear Workspace Memory**:
- Command Palette → "Cognee: Clear Workspace Memory"
- Deletes all captured conversations for current workspace (requires confirmation)

## For Agent Developers

Cognee Chat Memory provides an API for GitHub Copilot agents and third-party VS Code extensions to store and retrieve structured summaries programmatically.

### Use Cases

- **Agent Continuity**: Agents can maintain context across sessions without requiring manual capture
- **Multi-Agent Collaboration**: Different agents can share memory via a common knowledge base
- **Custom Workflows**: Extensions can build custom agent memory patterns

### Agent Ingestion API

The `cogneeMemory.ingestForAgent` command allows agents to write structured summaries to Cognee:

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
  'cogneeMemory.ingestForAgent',
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

Cognee tools are controlled exclusively through VS Code's **Configure Tools** UI (see Quick Start below). No additional workspace settings are required for authorization.

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

## Using Cognee Tools with Custom Agents

Cognee Chat Memory provides **Language Model Tools** that allow GitHub Copilot and custom agents to autonomously access workspace memory. These tools appear in VS Code's "Configure Tools" dialog and can be referenced in custom agent configurations.

### Quick Start

1. **Enable Tools via Configure Tools UI**:
   - Open Copilot chat → Click "Tools" (⚙️ icon) → "Configure Tools"
   - Find "Store Memory in Cognee" and "Retrieve Cognee Memory"
   - Toggle tools on/off individually (disabled by default for privacy)

2. **Use in Chat**:
   - Type `#cognee` to see autocomplete suggestions
   - Select `#cogneeStoreSummary` or `#cogneeRetrieveMemory`
   - Tools appear only when enabled via Configure Tools

3. **Transparency**:
   - All tool invocations logged in Output channel ("Cognee Agent Activity")
   - Configure Tools UI provides visual feedback for tool state

### Custom Agent Example

Create a `.agent.md` file in your workspace to define a memory-aware agent:

```markdown
---
name: Memory-Aware Code Assistant
description: Copilot assistant with access to workspace memory
tools: ['search', 'cogneeStoreSummary', 'cogneeRetrieveMemory']
---

You are a code assistant with access to workspace-specific memory.

When the user asks about past decisions or implementations:
1. Use #cogneeRetrieveMemory to search for relevant context
2. Ground your answer in the retrieved memories
3. If no memories exist, use your training data but clarify it's not workspace-specific

When the user completes an important implementation or makes a decision:
1. Offer to store a summary using #cogneeStoreSummary
2. Include topic, context, and key decisions in the summary
```

### Available Tools

#### Store Memory Tool (`#cogneeStoreSummary`)

Stores conversation summaries in Cognee knowledge graph.

**Parameters**:
- `topic` (required): Summary title
- `context` (required): Summary description
- `decisions` (optional): Key decisions made
- `rationale` (optional): Reasoning behind decisions
- `metadata` (optional): Plan ID, status, etc.

#### Retrieve Memory Tool (`#cogneeRetrieveMemory`)

Searches Cognee knowledge graph for relevant memories.

**Parameters**:
- `query` (required): Natural language search query
- `maxResults` (optional): Max results to return (default: 3, max: 10)

**Returns**: Both narrative markdown and structured JSON for agent parsing.

### Agent Integration Settings

### Transparency

When agents use Cognee, you see:

- **Output Channel**: All tool invocations logged in "Cognee Agent Activity"
- **Configure Tools UI**: Visual feedback for which tools are enabled/disabled
- **Chat Autocomplete**: `#cognee*` commands only appear when tools are enabled

### For Extension Developers

See [AGENT_INTEGRATION.md](./AGENT_INTEGRATION.md) for:
- Complete API documentation with TypeScript examples
- Command signatures (`cogneeMemory.ingestForAgent`, `cogneeMemory.retrieveForAgent`)
- Error codes and handling strategies
- Request/response schemas
- Testing and troubleshooting guides

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
