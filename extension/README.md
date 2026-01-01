# Flowbaby Chat Memory

> Memory-augmented Copilot chat for VS Code

Flowbaby captures and summarizes key moments from your GitHub Copilot chats, then surfaces them as context in future conversations to reduce drift in long-running work. Each workspace gets its own isolated memory and Python environment, and no code from your repository ever leaves your machine - only the chat content already sent to Copilot is summarized and reused, under your control.

## Features

### Context aware automatic memory search

Flowbaby is configured to use chat conversation cues to search memory and add that memory context to the chat - keeping your Copilot agent from drifting and saving you from having to explain what happened all over again.

![Automatic Search](https://raw.githubusercontent.com/groupzer0/flowbaby/main/media/retrieval.gif)

### Context aware automatic memory storage

Flowbaby knows when it's a good time to summarize and store memories based on the chat context.

![Automatic Store](https://raw.githubusercontent.com/groupzer0/flowbaby/main/media/memory-store.gif)

### @flowbaby chat participant

A dedicated Copilot participant that recalls past conversations and surfaces relevant memories into new chats to reduce drift over long sessions.

![Interactive Chat Participant](https://raw.githubusercontent.com/groupzer0/flowbaby/main/media/what-were-we-working-on.gif)

### Configurable memory behavior via stored prompts

Guide Flowbaby with stored natural-language instructions (e.g., what to store, what to ignore, how aggressively to retrieve) so each workspace can have its own memory style.

### Agent tools for storage and retrieval

Exposes two standard Copilot tools (for storing and retrieving memories) that are available to GitHub Copilot just like any other tool, so agents can autonomously call them when helpful.

### Keyboard Shortcut Workflow

Press Ctrl+Alt+F / Cmd+Alt+F to capture important snippets from chat or code with a quick confirmation flow.

### Command Palette Alternative

Run "Flowbaby: Capture to Memory" if you prefer command-palette based capture.

![Manual Store](https://raw.githubusercontent.com/groupzer0/flowbaby/main/media/manual-store-summary.png)

### Workspace Isolation

Each workspace has its own separate memory and Python environment - no cross-project leakage.

### Hybrid Graph-Vector Search

Combines knowledge-graph structure with vector similarity for higher-quality, controllable retrieval.

### Unified Session Context

Flowbaby maintains conversational continuity by tracking session IDs across chat threads. This ensures that:
- **Context Awareness**: Memory operations are scoped to the current conversation thread.
- **Privacy**: Session IDs are redacted in logs to prevent leakage.
- **Persistence**: Session context is maintained even if you restart VS Code, as long as the chat thread remains active.

### Privacy-First Design

All data stays on your machine; only chat content already sent to GitHub Copilot is summarized, and no repository files or file content are sent to any external LLM.

## Quick Start

> 💰 **Low Cost**: With default settings (OpenAI gpt-4o-mini), typical usage costs **$0.02–$0.06 per day** (~2-6 US cents). You can change providers and models in Settings → Flowbaby.

1. **Install** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Flowbaby.flowbaby)
2. **Initialize** — Run `Flowbaby: Initialize Workspace` from the Command Palette
3. **Login to Cloud** — Run `Flowbaby Cloud: Login` to authenticate with Flowbaby Cloud
4. **Use** — Type `@flowbaby` in Copilot Chat to start using memory

📖 **Need help?** [View the Getting Started guide](command:workbench.action.openWalkthrough?%22Flowbaby.flowbabySetup%22) · [Ask questions on GitHub Discussions](https://github.com/groupzer0/flowbaby/discussions)

## Prerequisites

Before installing the extension, ensure you have:

- **VS Code** 1.106.0 or higher
- **Python** 3.10–3.12 installed on your system
- **Microsoft Visual C++ Redistributable** (Windows only) - [Download here](https://aka.ms/vs/17/release/vc_redist.x64.exe)

Flowbaby automatically creates and manages its own isolated Python environment (`.flowbaby/venv`) in each workspace. You do not need to install any Python packages manually.

## Installation

### Install from VS Code Marketplace

1. Open VS Code
2. Go to the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for **"Flowbaby"**
4. Click **Install**
5. Reload VS Code when prompted

## Setup

After installation, configure your workspace:

> Optional but recommended: Add `.flowbaby/` to your workspace `.gitignore` if you don't want Flowbaby's local data and virtual environment committed to your repository. You can always keep it versioned if you prefer.

### 1. Initialize Workspace (Automated)

Flowbaby now manages its own Python environment automatically.

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **"Flowbaby: Initialize Workspace"**
3. The extension will:
   - Check for Python 3.10-3.12
   - Create a dedicated `.flowbaby/venv` in your workspace (isolated from project venvs)
   - Install `cognee` and dependencies
   - Verify the environment is ready

### 2. Configure API Key

### 2. Authenticate with Flowbaby Cloud

Flowbaby v0.7.0+ uses **Flowbaby Cloud** for LLM operations:

| What Flowbaby Cloud provides | What it does NOT do |
|----------------------|--------------------||
| ✅ Embed memories into searchable vectors | ❌ No telemetry or analytics |
| ✅ Retrieve relevant context via semantic search | ❌ No code analysis |
| ✅ Summarize conversations for long-term storage | ❌ Your data stays on your machine |

**Login to Flowbaby Cloud:**

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **"Flowbaby Cloud: Login"**
3. Complete authentication in your browser

Your Cloud session applies to all workspaces automatically.

### 3. Verify Extension Activation

1. Check the status bar for **"Flowbaby"** (checkmark)
2. If you see **"Flowbaby: Setup Required"** (yellow warning), click it to run setup
3. Optional: Open the Output panel (**View → Output**) and select **"Flowbaby"** to see logs

## Windows Troubleshooting

### Refresh dependencies fails with EPERM (rename `.flowbaby\\venv`)

If **"Flowbaby: Refresh Bridge Dependencies"** fails with an `EPERM` rename error on Windows, a Python process is usually still running and holding a lock inside `.flowbaby\\venv` (often the bridge daemon).

- Reload the window (**Developer: Reload Window**) and retry
- Close VS Code fully (all windows), wait a moment, then retry
- As a last resort, stop the `python.exe` process that references `.flowbaby\\venv` in its command line

## Memory-Aware Copilot Instructions (Strong Defaults)

> ⚠️ **Important**: Without explicit instructions, Copilot may not use memory tools in the way you desire. Adding a memory contract to your workspace ensures Copilot proactively stores and retrieves memories.
>
> 📄 **Quick option**: Copy the [memory contract example](https://github.com/groupzer0/vs-code-agents/blob/main/vs-code-agents/reference/memory-contract-example.md) to your workspace as `.copilot-instructions.md`

Flowbaby already nudges GitHub Copilot to store and retrieve memory when it makes sense. However, strong Copilot instructions are important if you want Copilot-initiated memory storage and retrieval to match your workflow (what to remember, what to ignore, how aggressive to be). The template below is a recommended starting point you can customize.

Create or modify an `.agent.md`, `.chatmode.md` or `.copilot-instructions.md` file in your workspace and add something like the example below, or use it exactly as-is.

**Example Copilot instructions:**

```markdown
---
name: Memory-Aware Code Assistant
description: Copilot assistant with access to workspace memory
tools: ['search', 'flowbabyStoreSummary', 'flowbabyRetrieveMemory']
---

You are a code assistant with access to workspace-specific memory powered by Flowbaby.

# 1. Retrieval (start of turn)

Treat the user’s current request and open documents as the primary source of truth. Use Flowbaby memory to augment and cross-check, not to override active specs.

At the start of any turn where past work might matter (prior plans, decisions, constraints, patterns):

1. Call #flowbabyRetrieveMemory **before** deep planning or multi-step reasoning.
2. Use a natural-language query that:
   - Describes the current task, question, or challenge
   - Mentions the area of the codebase or system involved
   - States what you are looking for (e.g., prior decisions, constraints, risks, patterns, open questions)
3. Prefer a small set of high-value memories (default: 3) rather than many low-signal items.

You MAY make at most one follow-up retrieval in the same turn, but only if:

- The first call returned nothing useful and a slightly more general query is warranted, or
- You have a clear new question (e.g., "Have we already decided how to handle this exact edge case?").

Do NOT chain multiple retrievals just to explore history. If more context seems useful, summarize what you know, note uncertainties, and say what you would ask the user for.

# 2. Using Retrieved Memory

When memory is available:

- Use it to reveal historical decisions, constraints, and tradeoffs.
- Check for prior attempts and repeated failures before proposing new work.
- Call out when current plans might conflict with older decisions.

If memory conflicts with current instructions or docs:

- Treat current instructions, specs, and architecture docs as the source of truth.
- Treat memory as historical context unless the user explicitly says otherwise.
- Briefly surface only material conflicts that would change risk, scope, or recommendations.

# 3. Summarization (end of work / milestones)

Use #flowbabyStoreSummary to maintain accurate long-term memory. Store a summary when:

- You complete meaningful work or a plan milestone
- You make or refine important decisions
- You discover new constraints, risks, or assumptions
- A conversation branches into a new line of work

Each summary should be 300–1500 characters and semantically dense. Capture:

- Goal or question
- Key findings and decisions
- Important reasoning and tradeoffs
- Rejected options and why they were rejected
- Notable constraints, risks, and assumptions
- Current status (ongoing, blocked, or complete)

Use fields like:

- `topic`: short 3–7 word title
- `context`: rich narrative summary
- `decisions`: list of important decisions
- `rationale`: reasons and tradeoffs
- `metadata.status`: e.g., `Active`, `Superseded`, or `DecisionRecord`

After storing, explicitly tell the user that you saved progress to Flowbaby memory.

# 4. Behavioral Requirements

- Begin each turn by asking: "Could prior work matter here?" If yes, retrieve.
- Never let memory silently override current specs, plans, or architecture.
- Reference memory explicitly when it shapes your recommendations.
- Avoid retrieval rabbit holes: at most one follow-up retrieval per turn.
- Regularly create summaries so future work can build on stable, well-structured context instead of raw chat logs.
- When multiple options are discussed, record both chosen and rejected paths (with rationale) in summaries.
```

## Usage

### 1. Context-Aware Automatic Memory Search

Flowbaby can automatically search your workspace memory and surface relevant context into GitHub Copilot chats.

**How it works**:
- Flowbaby watches for conversation cues (e.g., "How did I implement…?", "What did we decide about…?").
- When it detects a good opportunity, it runs a background search against your knowledge graph.
- Retrieved memories are added to the Copilot request as additional context so you don't have to restate prior work.

**What you'll see**:
- In Copilot Chat, Flowbaby shows a section like **"📚 Retrieved memories"** with short previews.
- Copilot's answer incorporates those memories directly into its response.

### 2. Context-Aware Automatic Memory Storage

Flowbaby can also decide when to summarize and store parts of the conversation as long-term memory.

**How it works**:
- Flowbaby looks for moments where you've reached a decision, finished a debugging session, or explained an important concept.
- It generates a structured summary and stores it in your workspace knowledge graph (after any required confirmation, depending on settings).

**Benefits**:
- You build up high-value memory over time with minimal manual effort.
- Later queries can retrieve these summaries instead of raw, noisy chat logs.

### 3. Using the @flowbaby Chat Participant

The `@flowbaby` participant lets you directly query your workspace memory.

**How to use**:
1. Open GitHub Copilot Chat (`Ctrl+Alt+I` or click the chat icon).
2. Address Flowbaby explicitly: `@flowbaby How did I implement caching?`
3. Flowbaby:
   - Retrieves relevant memories from your knowledge graph.
   - Shows previews under **"📚 Retrieved memories"**.
   - Augments your question with that context.
   - Generates a context-aware response.

**Example queries**:
- `@flowbaby What problems did we discuss about the authentication system?`
- `@flowbaby What solutions did we consider for rate limiting?`
- `@flowbaby Summarize our decisions about database architecture`

### 4. Keyboard Shortcut and Command Palette Capture

Use these flows when you want to explicitly capture important information.

**Keyboard shortcut**:
1. View a valuable chat message (from any participant: @workspace, @terminal, GitHub Copilot, etc.).
2. Press **Ctrl+Alt+F** (or **Cmd+Alt+F** on macOS).
3. Paste or confirm the content in the capture input.
4. Press Enter to capture.
5. You'll see a staged message (e.g., "Memory staged - processing will finish in ~1–2 minutes").

**Command Palette**:
1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **"Flowbaby: Capture to Memory"**.
3. Follow the same flow as the keyboard shortcut.

### 5. Background Async Ingestion

Flowbaby processes captured memories asynchronously so your editor stays responsive.

**Timeline**:
- Capture confirmation: ~5–10 seconds.
- Background processing and graph construction: ~60–90 seconds.
- Total time from capture to searchable memory: ~1–2 minutes.

You'll receive a notification when ingestion finishes (success or failure), including a brief digest and basic metrics in the logs.

### 6. Viewing Background Operations

To inspect everything Flowbaby is doing in the background:
1. Open Command Palette.
2. Run **"Flowbaby: View Background Operations"**.
3. Review pending, running, completed, and failed ingestion tasks.

### 7. How Flowbaby Stores Summaries

In normal use, Flowbaby creates and maintains summaries for you automatically.

**Automatic summary creation**:
- When you reach an important conclusion, finish a debugging session, or make a design decision, Flowbaby may create a structured summary in the background.
- These summaries capture topic, key decisions, rationale, open questions, and next steps.
- They are stored in your workspace knowledge graph and later used by automatic search and the `@flowbaby` participant.

**Manual and agent-driven summaries (optional)**:
- You can still ask Flowbaby to create a summary explicitly if you want tighter control.
- In Copilot Chat, you can say things like:
  - `@flowbaby summarize this conversation`
  - `@flowbaby remember this session`
  - `@flowbaby create summary for this plan`
- Custom agents can also store summaries directly using Flowbaby's tools and APIs (see the Flowbaby docs at [docs.flowbaby.ai](https://docs.flowbaby.ai)).

The key idea: you don't need to manage summaries manually unless you want to - Flowbaby's automatic storage is usually enough.

### 8. How Flowbaby Retrieves Summaries

Flowbaby uses summaries as a primary source of truth when answering questions about past work.

**Automatic retrieval**:
- When context-aware search (Section 1) or the `@flowbaby` participant runs a query, Flowbaby searches both raw captured conversations and structured summaries.
- When a good match is found, you'll see a **"📚 Retrieved memories"** section with previews of the most relevant items.

**What summaries look like**:
- Organized sections: topic, key decisions, open questions, next steps, rationale.
- Rich, human-readable text designed to be useful both to you and to the LLM.

**How to prompt for past work**:
- `@flowbaby What did we decide about Plan 013?`
- `@flowbaby What questions are still open about memory transparency?`
- `@flowbaby What are the next steps for the authentication system?`
- `@flowbaby Show me the rationale for using enriched text format`

You don't need a separate "retrieve summary" command-just ask `@flowbaby` questions about previous sessions or decisions, and Flowbaby will use summaries automatically when available.

### 9. Memory Management Commands

**Toggle Memory On/Off**:
- Command Palette → "Flowbaby: Toggle Memory"
- Flips `Flowbaby.enabled` setting

**Clear Workspace Memory**:
- Command Palette → "Flowbaby: Clear Workspace Memory"
- Deletes all captured conversations for current workspace (requires confirmation)

### Automatic Detection

**`.flowbaby/venv`** This location prevents conflicts with project virtual environments (e.g., Python Jedi language server overwriting Flowbaby's dependencies).

### Unsupported Contexts

The following contexts are **not validated or supported** in this release:
- **Remote Development**: VS Code Remote-SSH, WSL, Dev Containers
- **Multi-root Workspaces**: Workspaces with multiple folder roots
- **Multi-user Workstations**: Memories are stored per workspace, not per user

Support for these contexts may be added in future releases.

### Configuration

Access settings via **File → Preferences → Settings → Extensions → Flowbaby**:

| Setting | Description | Default |
|---------|-------------|---------|
| `Flowbaby.enabled` | Enable/disable automatic memory capture and retrieval | `true` |
| `Flowbaby.maxContextResults` | Maximum number of memory results to inject into Copilot context | `3` |
| `Flowbaby.maxContextTokens` | Maximum token budget for retrieved context (higher values may increase latency and memory usage) | `32000` |
| `Flowbaby.searchTopK` | Maximum number of candidates to request from the Flowbaby search engine before ranking (normalized to be ≥ `maxContextResults`, hard-capped at 100) | `10` |
| `Flowbaby.ranking.halfLifeDays` | Recency half-life (in days) used for ranking; older memories past this window have their relevance score halved | `7` |
| `Flowbaby.bridgeMode` | Bridge execution mode: `daemon` (default, long-lived Python process for faster requests) or `spawn` (legacy per-request process; useful for troubleshooting daemon issues) | `daemon` |
| `Flowbaby.daemonIdleTimeoutMinutes` | Minutes of inactivity before the bridge daemon exits; lower values save memory, higher values keep the daemon warm at the cost of a long-lived process | `30` |
| `flowbaby.notifications.showIngestionSuccess` | Show toast notifications when memory ingestion completes successfully (errors are always shown) | `true` |
| `flowbaby.showRetrievalNotifications` | Show a notification when Flowbaby retrieves relevant memories | `true` |
| `Flowbaby.pythonPath` | Path to Python interpreter. Leave empty for auto-detection (uses `.flowbaby/venv` if present, otherwise system Python). Set an explicit path to override auto-detection. | *(empty)* |
| `Flowbaby.logLevel` | Logging verbosity level: `error`, `warn`, `info`, or `debug` | `info` |
| `Flowbaby.debugLogging` | Enable a dedicated debug output channel with detailed bridge and extension diagnostics | `false` |
| `Flowbaby.synthesis.modelId` | **Copilot synthesis model** used to synthesize answers from retrieved memory context (does not affect the Python bridge LLM) | `gpt-5-mini` |

### LLM Configuration

Configure your LLM provider via **File → Preferences → Settings → Extensions → Flowbaby**:

| Setting | Description | Default |
|---------|-------------|---------|
| `Flowbaby.llm.provider` | LLM provider (e.g., `openai`, `anthropic`, `azure`, `ollama`, `custom`) | `openai` |
| `Flowbaby.llm.model` | LLM model name (e.g., `gpt-4o-mini`, `claude-3-haiku-20240307`, `llama2`) | `gpt-4o-mini` |
| `Flowbaby.llm.endpoint` | Custom LLM endpoint URL for Azure, Ollama, or self-hosted deployments; leave empty for provider defaults | *(empty)* |

**Provider Examples**:
- **OpenAI (default)**: Leave provider as `openai`, model as `gpt-4o-mini`
- **Anthropic Claude**: Set provider to `anthropic`, model to `claude-3-opus-20240229`
- **Local Ollama**: Set provider to `ollama`, model to your model name, endpoint to `http://localhost:11434`

**Additional Examples**:
- To disable memory temporarily, set `Flowbaby.enabled` to `false` in settings

## Using Flowbaby Tools with Custom Agents

Flowbaby Chat Memory provides **Language Model Tools** that allow GitHub Copilot and custom agents to autonomously access workspace memory. These tools appear in VS Code's "Configure Tools" dialog and can be referenced in custom agent configurations.

### Quick Start

1. **Enable Tools via Configure Tools UI**:
   - Open Copilot chat → Click "Tools" icon → "Configure Tools"
   - Find the "Flowbaby" section
   - Toggle "Store Memory in Flowbaby" and "Retrieve Flowbaby Memory"
   - Toggle tools on/off individually (disabled by default for privacy)

2. **Use in Chat**:
   - Type `#flowbaby` to see autocomplete suggestions
   - Select `#flowbabyStoreSummary` or `#flowbabyRetrieveMemory`
   - Tools appear only when enabled via Configure Tools

3. **Transparency**:
   - All tool invocations logged in Output channel ("Flowbaby Agent Activity")
   - Configure Tools UI provides visual feedback for tool state

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

### Transparency

When agents use Flowbaby, you see:

- **Output Channel**: All tool invocations logged in "Flowbaby Agent Activity"
- **Configure Tools UI**: Visual feedback for which tools are enabled/disabled
- **Chat Autocomplete**: `#flowbaby*` commands only appear when tools are enabled
- **Workspace Logs**: Detailed bridge and ingestion logs are stored under `.flowbaby/logs` in each workspace

## Troubleshooting

### Extension Not Activating

**Check the Output Channel**:

1. Go to **View → Output**
2. Select **"Flowbaby Memory"** from the dropdown
3. Look for initialization errors

**Enable Debug Logging**: If you need more detailed information, enable `Flowbaby.debugLogging` in settings and use **"Flowbaby: Show Debug Logs"** command.

**Common Issues**:

#### 1. "Cloud credentials not found" or "NOT_AUTHENTICATED"

**Solution**: Run **"Flowbaby Cloud: Login"** command

Then reload VS Code: `Ctrl+Shift+P` → **"Reload Window"****

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
- If the Python bridge daemon is unstable in your environment, switch `Flowbaby.bridgeMode` to `"spawn"` to fall back to the legacy per-request process model.

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
5. Each workspace has separate memory-switching workspaces means different context
6. If retrieval fails, you'll see "⚠️ Memory retrieval unavailable" but participant continues without context

**Note**: Auto-detection prefers a workspace-managed `.flowbaby/venv` when present. For remote contexts (Remote-SSH, WSL, Dev Containers), conda, pyenv, or other non-standard setups, use an explicit `Flowbaby.pythonPath`.

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
- **Python Dependency** - Requires Python 3.10-3.12 on your system; Cognee and dependencies are installed automatically in an isolated environment
- **Platform Support** - Primarily tested on macOS and Linux; Windows support may require additional configuration

## Screenshots

### Automatic Context Search

![Automatic Search](https://raw.githubusercontent.com/groupzer0/flowbaby/main/media/retrieval.gif)

*Flowbaby automatically searches memory based on chat context*

### Automatic Memory Storage

![Automatic Store](https://raw.githubusercontent.com/groupzer0/flowbaby/main/media/memory-store.gif)
*Flowbaby knows when to store memories based on conversation cues*

### Interactive Chat Participant

![Interactive Chat Participant](https://raw.githubusercontent.com/groupzer0/flowbaby/main/media/what-were-we-working-on.gif)

*Use @flowbaby to query your workspace memory*

### Manual Memory Storage

![Manual Store](https://raw.githubusercontent.com/groupzer0/flowbaby/main/media/manual-store-summary.png)

*Capture important context with keyboard shortcuts*

## Contributing

We welcome contributions! See [discussions](https://github.com/groupzer0/flowbaby/discussions)

## License

This extension is licensed under the MIT License. See [LICENSE](LICENSE) for details.

This extension uses [Cognee](https://github.com/topoteretes/cognee) under the Apache 2.0 license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.

## Support

- **Ask Questions**: [GitHub Discussions](https://github.com/groupzer0/flowbaby/discussions)
- **Report Bugs**: [GitHub Issues](https://github.com/groupzer0/flowbaby/issues)
- **Feature Requests**: [GitHub Discussions](https://github.com/groupzer0/flowbaby/discussions)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

---

**Built with** [Cognee](https://github.com/topoteretes/cognee) for knowledge graph operations.
