# Flowbaby

> Memory that actually remembers. For Copilot chats that don't suddenly develop amnesia.

Flowbaby grabs the smart stuff from your Copilot sessions and surfaces it when it matters. No more re-explaining the same decision like it's Groundhog Day. No more "wait, what was I doing?" spirals that end with you staring at your own code like it's written in ancient Sumerian.

Each workspace gets its own brain. Your code stays on your machine. Nobody's reading your TODO comments. Relax.

## What It Does

### Auto-Search: Context Without the Ask

Ask Copilot something. Flowbaby checks if you've hit this before and drops the context straight into the chat. Zero effort on your end.

It's like having a coworker who actually remembers what you said in standup.

![Automatic Search](https://raw.githubusercontent.com/groupzer0/flowbaby-issues/main/media/auto-search.png)

### Auto-Store: Captures What Counts

Hit a decision? Debug something nasty? Flowbaby spots it and saves a clean summary. You keep moving.

No manual journaling. No "I should probably write this down." Flowbaby's got it.

![Automatic Store](https://raw.githubusercontent.com/groupzer0/flowbaby-issues/main/media/auto-store.png)

### @flowbaby: Your Personal Historian

Type `@flowbaby` in chat. Ask about past work. Get real answers from your own sessions, not some generic Stack Overflow answer from 2012 that doesn't even apply to your framework.

It's your history. Not someone else's Medium post.

![Interactive Chat Participant](https://raw.githubusercontent.com/groupzer0/flowbaby-issues/main/media/interactive-chat-participant.png)

### Everything Else

- **Keyboard shortcuts** — Ctrl+Alt+F when you need to lock something down now
- **Workspace isolation** — Each project gets its own brain. No bleed-over. Your side project's chaos won't contaminate your day job.
- **Hybrid search** — Graph + vector. Smarter than embeddings alone.
- **Privacy-first** — Everything local. Only chat content (already sent to Copilot anyway) gets summarized. No repo files. No external LLM reading your embarrassing variable names.

## What You Need

- VS Code 1.106.0+
- Python 3.10–3.12
- Windows: [Microsoft Visual C++ Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe)

Flowbaby handles its own Python setup (`.flowbaby/venv`). You don't touch it.

## Install

1. Extensions (`Ctrl+Shift+X`)
2. Search **"Flowbaby"**
3. Install
4. Reload

Done. Not hard.

## Setup

### 1. Initialize

Command Palette (`Ctrl+Shift+P`) → **"Flowbaby: Initialize Workspace"**

Flowbaby checks Python, spins up `.flowbaby/venv`, installs what it needs, confirms everything's solid.

### 2. Drop Your API Key

Command Palette → **"Flowbaby: Set API Key"**

Paste your key. Stored securely via VS Code SecretStorage. Works across all workspaces.

### 3. Check the Status Bar

Look for **"Flowbaby"** with a checkmark.

Yellow warning? Click it and run setup.

Want logs? **View → Output** → **"Flowbaby"**.

### 4. .gitignore (Optional)

Throw `.flowbaby/` in your `.gitignore` if you don't want local data committed. Or version it. Up to you.

## Configure Copilot (Recommended)

Flowbaby works solo, but you get more juice if Copilot knows how to use it. Think of this as teaching your AI to stop forgetting things mid-conversation like a goldfish with a CS degree.

Create `.agent.md`, `.chatmode.md`, or `.copilot-instructions.md` in your workspace. Paste this:

```markdown
---
name: Memory-Aware Code Assistant
description: Copilot assistant with workspace memory
tools: ['search', 'flowbabyStoreSummary', 'flowbabyRetrieveMemory']
---

You are a code assistant with workspace memory powered by Flowbaby.

## Retrieval (start of turn)

At the start of any turn where past work might matter:

1. Call #flowbabyRetrieveMemory before deep planning.
2. Use a natural-language query describing the current task, area of codebase, and what you're looking for (decisions, constraints, patterns).
3. Prefer 3 high-value memories over many low-signal results.

You can do at most one follow-up retrieval per turn if the first returned nothing useful.

## Using Retrieved Memory

- Reveal historical decisions, constraints, tradeoffs.
- Check for prior attempts and repeated failures.
- Call out conflicts between current plans and old decisions.
- Treat current docs as source of truth; memory is historical context.

## Summarization (end of work)

Use #flowbabyStoreSummary when:

- You complete meaningful work
- You make or refine important decisions
- You discover constraints, risks, assumptions
- Conversation branches into new work

Each summary: 300–1500 characters, semantically dense. Capture goal, findings, decisions, reasoning, tradeoffs, rejected options, constraints, risks, status.

Fields:
- `topic`: 3–7 word title
- `context`: rich summary
- `decisions`: list of decisions
- `rationale`: reasons and tradeoffs
- `metadata.status`: Active, Superseded, or DecisionRecord

After storing, tell the user you saved progress to Flowbaby.

## Rules

- Start each turn asking: "Could prior work matter?" If yes, retrieve.
- Never let memory override current specs.
- Reference memory explicitly when it shapes recommendations.
- At most one follow-up retrieval per turn.
- Store summaries regularly so future work builds on structured context, not raw logs.
- Record both chosen and rejected paths with rationale.
```

## How to Use It

### 1. Auto-Search

Flowbaby watches your chats. When something smells like prior work, it searches memory and injects context.

You'll see **"📚 Retrieved memories"** in chat. Copilot uses them.

### 2. Auto-Store

Flowbaby catches decision points, debugging wins, key explanations. Generates a summary. Stores it.

You build memory without lifting a finger. Finally, something that documents itself.

### 3. @flowbaby Participant

Open Copilot Chat. Type `@flowbaby`. Ask about past work.

Examples:
- `@flowbaby How did I implement caching?`
- `@flowbaby What did we decide about auth?`
- `@flowbaby What's open about the database design?`

### 4. Keyboard Shortcut

See something worth keeping? **Ctrl+Alt+F** (Mac: **Cmd+Alt+F**).

Confirm. Enter. Done.

Or: Command Palette → **"Flowbaby: Capture to Memory"**.

Either way, you just saved yourself from forgetting that brilliant thing you figured out at 2am.

### 5. Background Processing

Captures run async. Confirmation: ~5–10 sec. Full processing: ~1–2 min. Notification when done.

### 6. View Background Ops

Command Palette → **"Flowbaby: View Background Operations"**

See pending, running, completed, failed.

### 7. Summaries (Automatic)

Flowbaby builds summaries. You don't manage them unless you want to.

Want control?
- `@flowbaby summarize this conversation`
- `@flowbaby remember this session`

### 8. Retrieval

Query `@flowbaby` or let auto-search run. Flowbaby searches raw captures + summaries. Shows **"📚 Retrieved memories"** with top matches.

### 9. Memory Management

**Toggle**: Command Palette → "Flowbaby: Toggle Memory"

**Clear**: Command Palette → "Flowbaby: Clear Workspace Memory" (confirmation required)

## Settings

**File → Preferences → Settings → Extensions → Flowbaby**

| Setting | What It Does | Default |
|---------|-------------|---------|
| `Flowbaby.enabled` | Turn memory on/off | `true` |
| `Flowbaby.maxContextResults` | How many memories to inject | `3` |
| `Flowbaby.maxContextTokens` | Token budget for context | `32000` |
| `Flowbaby.searchTopK` | Candidates before ranking | `10` |
| `Flowbaby.ranking.halfLifeDays` | Recency decay (older = lower rank) | `7` |
| `flowbaby.notifications.showIngestionSuccess` | Toast on successful capture | `true` |
| `Flowbaby.pythonPath` | Python interpreter path | `python3` |
| `Flowbaby.logLevel` | Log verbosity | `info` |
| `Flowbaby.debugLogging` | Detailed debug channel | `false` |

### LLM Config

| Setting | What It Does | Default |
|---------|-------------|---------|
| `Flowbaby.llm.provider` | Provider (openai, anthropic, azure, ollama, custom) | `openai` |
| `Flowbaby.llm.model` | Model name | `gpt-4o-mini` |
| `Flowbaby.llm.endpoint` | Custom endpoint for Azure, Ollama, self-hosted | *(empty)* |

**Examples**:
- **OpenAI**: Leave as-is
- **Anthropic**: Set provider to `anthropic`, model to `claude-3-opus-20240229`
- **Local Ollama**: Set provider to `ollama`, model to your model, endpoint to `http://localhost:11434`

## Flowbaby Tools for Custom Agents

Flowbaby exposes Language Model Tools so Copilot and custom agents can access workspace memory autonomously.

### Quick Start

1. Open Copilot chat → Tools icon → Configure Tools
2. Find "Flowbaby" section
3. Toggle "Store Memory in Flowbaby" and "Retrieve Flowbaby Memory"

### Available Tools

**Store Memory** (`#flowbabyStoreSummary`)

Params:
- `topic` (required)
- `context` (required)
- `decisions`, `rationale`, `metadata` (optional)

**Retrieve Memory** (`#flowbabyRetrieveMemory`)

Params:
- `query` (required)
- `maxResults` (optional, default 3, max 10)

Returns markdown + structured JSON.

### Transparency

All tool invocations are logged in Output channel ("Flowbaby Agent Activity"). Tools only appear when enabled. Workspace logs live under `.flowbaby/logs`.

## Troubleshooting

### Extension Won't Wake Up

1. **View → Output** → **"Flowbaby Memory"**
2. Look for errors

Need more detail? Enable `Flowbaby.debugLogging` → Command Palette → "Flowbaby: Show Debug Logs"

### "LLM_API_KEY not found"

Command Palette → **"Flowbaby: Set API Key"**

Reload: `Ctrl+Shift+P` → **"Reload Window"**

### "Python not found" or "cognee module not found"

Run **"Flowbaby: Initialize Workspace"**

Or point `Flowbaby.pythonPath` at your Python.

### "No workspace folder open"

**File → Open Folder**

Or: `code /path/to/project`

### Slow Performance

- Set `Flowbaby.logLevel` to `info` (never `debug`)
- Drop `maxContextResults` to 1–2
- Drop `maxContextTokens` to 1000

If you left debug logging on, that's on you. That thing's chatty.

### Capture or Retrieval Not Working

**Capture**:
- Keyboard shortcut (Ctrl+Alt+F) conflicting? Try Command Palette → "Flowbaby: Capture to Memory"
- Look for "✅ Captured to memory" toast
- Check Output Channel logs

**Retrieval**:
- Confirm `Flowbaby.enabled` is `true`
- Type `@flowbaby` explicitly
- Check Output Channel for retrieval logs
- Remember: first convo in a fresh workspace has zero context
- Each workspace = separate memory

### Clear Memory

Command Palette → **"Flowbaby: Clear Workspace Memory"**

Moves everything to `.flowbaby/.trash`. Nuke it later if you want. Or keep it. Flowbaby's not your dad.

## Privacy

- **Local-only** — Data never leaves your machine
- **No telemetry** — Extension collects zero analytics
- **Workspace isolation** — Each project separate
- **API key security** — Never logged, only sent to your LLM
- **Data location** — `.flowbaby/system/` and `.flowbaby/data/`

Nuke it:

```bash
rm -rf .flowbaby/
```

## Known Limits

- Workspace required (single-file mode won't cut it)
- Python 3.8+ required (if you're still on 2.7, we need to talk)
- Tested mostly on macOS/Linux; Windows might need tweaking

## Unsupported Right Now

- Remote (SSH, WSL, Dev Containers)
- Multi-root workspaces
- Multi-user setups

Maybe later.

## Contributing

[Discussions](https://github.com/groupzer0/flowbaby-issues/discussions)

## License

PolyForm Strict 1.0.0. See [LICENSE](LICENSE).

Uses [Cognee](https://github.com/topoteretes/cognee) (Apache 2.0). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Support

- [Bugs](https://github.com/groupzer0/flowbaby-issues/issues)
- [Requests](https://github.com/groupzer0/flowbaby-issues/discussions)

## Changelog

[CHANGELOG.md](CHANGELOG.md)

---

**Built with** [Cognee](https://github.com/topoteretes/cognee)
