# Flowbaby

> No drift, no drama.

A memory system infrastructure for AI coding agents. Solves context collapse by managing context — not expanding it.

AI coding agents operate inside finite context windows. As conversations grow, files load, and instructions accumulate, agents are forced to compact and discard information — leading to forgotten goals, inconsistent behavior, and repeated explanations.

Most solutions attempt to solve this by injecting large amounts of memory directly into the context window. This worsens the problem.

Flowbaby solves memory drift by managing context, not expanding it. It injects a small amount of highly targeted context (~800–1000 tokens) based on what matters right now — keeping agents coherent across days, weeks, and months without bloating the context window.

*(Best experienced with the [Flowbaby Agent Team](https://github.com/groupzer0/vs-code-agents).)*

Flowbaby is currently in Beta and may change in breaking ways as we move towards a stable release.

## Why This Matters

Context is a scarce, high-value resource. Instead of dumping memory into the agent's working window, Flowbaby:

- Automatically creates compact summaries of conversations and decisions
- Stores them across the lifetime of a workspace
- Injects only a small, relevant slice when needed

The result:

- **Agents stay sharply focused** — no context window bloat
- **Reasoning quality goes up** — relevant signals, not noise
- **Less latency, less confusion** — lean context, faster inference
- **Long-running projects stay coherent** — across days and weeks

## How Flowbaby Is Different

Flowbaby occupies a new layer in the AI developer tooling stack:

- It is not another agent
- It is not another memory plugin
- It is a **context governance system** for agents — primed for integration

This infrastructure keeps agents oriented without the developer managing documents, writing memory files, or manually recording state.

## Evaluation Summary

Flowbaby is a VS Code extension that adds persistent, workspace-scoped memory to GitHub Copilot. It is production-usable today, stores all context locally, and integrates without requiring changes to Copilot itself.

Most users can validate its value within minutes by continuing a prior conversation across sessions and observing preserved decisions and constraints.

Flowbaby currently offers a free tier for evaluation and light usage, with an optional low-cost subscription for higher-volume usage.

## Optimal Results

Flowbaby provides persistent memory as infrastructure. To experience its full impact, it is designed to work alongside agents that actively take advantage of long-term memory.

Flowbaby’s impact is only visible when agents are designed to read from and write to memory consistently.

The Flowbaby Agent Team is the reference implementation built specifically to do this well.

While Flowbaby can be used with other agents, evaluators should note:
- Agents not designed for persistent memory may underutilize Flowbaby
- This can make the impact of memory appear limited

For the intended experience, we recommend using Flowbaby together with the [Flowbaby Agent Team](https://github.com/groupzer0/vs-code-agents).

Advanced users may want to add this [Memory Contract](https://github.com/groupzer0/vs-code-agents/blob/main/vs-code-agents/reference/memory-contract-example.md) to their own agent so that it makes use of Flowbaby, but this is not an officially supported option.

## What It Does

**The problem**: GitHub Copilot has no memory. Each conversation starts fresh. Over multi-day projects, you explain the same things repeatedly.

**The solution**: Flowbaby captures conversation context as structured summaries—not raw text—and resurfaces relevant prior work when it matters. It watches for natural conversation inflection points and provides matching context to Copilot as the agent continues its work.

Under the hood, this is powered by a hybrid knowledge graph (vector + graph structure) per workspace. Inference is handled via managed cloud endpoints, but the inference layer is architecturally swappable—designed to integrate with any LLM backend.

| What Flowbaby does | What it doesn't do |
|---|---|
| Captures summaries from Copilot conversations | Touch or analyze your source code |
| Stores structured context locally per workspace | Store any user data in Flowbaby Cloud |
| Routes summarization to managed cloud inference | Send repository content externally |
| Integrates as a standard Copilot participant | Access files outside the `.flowbaby/` directory |

> **Note**: v0.7.0 requires GitHub login via Flowbaby Cloud for managed inference. All context storage remains local—the cloud handles only inference routing and authentication.

## v0.7.0: Reduced Integration Surface

This release simplifies the operational model. Previously, users managed their own LLM API keys, selected providers, and configured endpoints. Now, one GitHub login provides managed inference.

**What this means for integration**:
- Single authentication surface (GitHub OAuth)
- No per-user API key provisioning or rotation
- Predictable operational behavior across deployments
- Geographic zone selection (`us`, `eu`, `apac`) for latency optimization
- Easier enterprise adoption path

**What stays the same**:
- All context storage remains local to the workspace
- Only chat content (already sent to Copilot) is processed
- Each workspace maintains isolated, separate context
- No telemetry or analytics collection

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     VS Code Extension                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐  │
│  │ Chat Participant│  │  LM Tools       │  │ Status Bar   │  │
│  │   @flowbaby     │  │  store/retrieve │  │ Cloud Status │  │
│  └────────┬────────┘  └────────┬────────┘  └──────────────┘  │
│           │                    │                             │
│           └────────────┬───────┘                             │
│                        ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Python Bridge (daemon mode)                │ │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────────────┐    │ │
│  │  │  Cognee   │  │  LanceDB  │  │     Kuzu Graph    │    │ │
│  │  │  (SDK)    │  │ (vectors) │  │   (relationships) │    │ │
│  │  └───────────┘  └───────────┘  └───────────────────┘    │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    Flowbaby Cloud                            │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐   │
│  │  GitHub OAuth  │  │  STS Vending   │  │  AWS Bedrock  │   │
│  │  (auth only)   │  │  (credentials) │  │  (inference)  │   │
│  └────────────────┘  └────────────────┘  └───────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**Separation of concerns**:
- Extension handles UX, context provision, and lifecycle
- Python bridge owns knowledge graph operations (Cognee SDK)
- Cloud provides managed inference and credential vending—no context data leaves the local machine

---

## What This Enables

Persistent memory unlocks capabilities that are difficult or impossible with stateless chat alone:

- Long-running project continuity across days and weeks
- Preference-aware assistance that remembers constraints
- More reliable multi-step reasoning with preserved decisions
- Reduced repetition and correction overhead

Flowbaby doesn't make AI remember everything. It makes AI stay oriented — across minutes, days, and months. That's what developers actually want.

## Scope and Limits

**Supported environments**:
- VS Code 1.107+
- Python 3.10–3.12 (auto-managed virtual environment per workspace)
- Windows (with Visual C++ Redistributable), macOS, Linux

**Not currently supported**:
- Remote development (SSH, WSL, Dev Containers)
- Multi-root workspaces
- Multi-user workstations (no per-user isolation within a workspace)

**Data boundaries**:
- Context stored in `.flowbaby/` within each workspace root
- No telemetry or analytics collection
- Cloud sees: GitHub identity, zone preference, operation timestamps
- Cloud does not see: context content, chat summaries, workspace data

---

## Quick Start

1. **Install** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Flowbaby.flowbaby)
2. **Initialize workspace**: Command Palette → `Flowbaby: Initialize Workspace`
3. **Login**: Command Palette → `Flowbaby Cloud: Login`
4. **Use**: Type `@flowbaby` in Copilot Chat

First initialization creates `.flowbaby/venv` with Cognee and dependencies. Subsequent activations are fast.

---

## How It Works

### Automatic Context Operations

This is Flowbaby's primary mode of operation—often so seamless that developers don't notice it's working.

**Storage**: Flowbaby monitors conversations for natural inflection points (decisions reached, debugging conclusions, architecture explanations) and creates structured summaries in the background.

**Retrieval**: When conversation cues suggest prior work is relevant, Flowbaby provides matching context to the Copilot agent as it continues its work. No explicit action required.

### Explicit Operations

**`@flowbaby` participant**: Direct queries against workspace context.
- `@flowbaby What did we decide about caching?`
- `@flowbaby What problems did we discuss in the auth system?`

**Capture shortcut**: `Ctrl+Alt+F` / `Cmd+Alt+F` for explicit capture.

**LM Tools**: `#flowbabyStoreSummary` and `#flowbabyRetrieveMemory` available for custom agent workflows.

---

## Configuration

### Core Settings

These settings appear in the primary **Flowbaby** settings group:

| Setting | Description | Default |
|---------|-------------|---------|
| `Flowbaby.enabled` | Enable/disable automatic context operations | `true` |
| `flowbaby.cloud.preferredZone` | Geographic zone for Cloud LLM calls: `us`, `eu`, `apac` | Backend default |
| `Flowbaby.synthesis.modelId` | Copilot synthesis model for memory retrieval | `gpt-5-mini` |
| `Flowbaby.sessionManagement.enabled` | Group interactions into sessions | `true` |
| `Flowbaby.debugLogging` | Enable verbose debug output | `false` |
| `flowbaby.notifications.showIngestionSuccess` | Show toast on successful memory capture | `true` |
| `flowbaby.showRetrievalNotifications` | Show toast when memories are retrieved | `true` |

### Advanced Settings

Additional tuning knobs are available under **Flowbaby (Advanced)** in VS Code Settings. These are intended for power users and support workflows. Most users can safely ignore them.

### Hidden-but-Supported Settings

The following settings are intentionally hidden from the Settings UI but remain fully functional when set via `settings.json`:

| Setting | Purpose |
|---------|---------|
| `Flowbaby.bridgeMode` | Bridge execution mode (`daemon` or `spawn`) |
| `Flowbaby.daemonIdleTimeoutMinutes` | Daemon idle timeout (1–60 minutes) |
| `flowbaby.cloud.apiEndpoint` | Cloud API endpoint override (developer use) |

---

## Troubleshooting

**Status bar shows warning**: Click to see current state. Common states:
- "Cloud Login Required" → Run `Flowbaby Cloud: Login`
- "Setup Required" → Run `Flowbaby: Initialize Workspace`

**Logs**: View → Output → select "Flowbaby" or "Flowbaby Cloud" channel.

**Debug mode**: Enable `Flowbaby.debugLogging` for verbose diagnostics.

**Clear context**: `Flowbaby: Clear Workspace Memory` moves data to `.flowbaby/.trash/` (recoverable).

---

## Privacy

- All context storage is local to the workspace
- Only chat content already sent to GitHub Copilot is summarized
- No source code is analyzed or transmitted
- Cloud authentication uses GitHub OAuth; credentials are short-lived
- Audit log written to `.flowbaby/logs/audit.jsonl`

---

## License

MIT License + Commons Clause. See [LICENSE](LICENSE) for details.

Uses [Cognee](https://github.com/topoteretes/cognee) (Apache 2.0) for knowledge graph operations.

---

## Reference Implementation

- **Flowbaby Agent Team**  
  A set of Copilot agents and skills designed to fully leverage Flowbaby’s persistent memory model.  
  This is the recommended reference implementation for evaluating Flowbaby’s impact. [Flowbaby Agent Team](https://github.com/groupzer0/vs-code-agents)

---

## Links

- [GitHub Repository](https://github.com/groupzer0/flowbaby)
- [Issues & Bug Reports](https://github.com/groupzer0/flowbaby/issues)
- [Discussions](https://github.com/groupzer0/flowbaby/discussions)
- [Changelog](CHANGELOG.md)
