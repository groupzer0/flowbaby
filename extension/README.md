# Flowbaby Chat Memory

> Most "memory" systems flood context windows with everything. Flowbaby does the opposite.

Persistent memory for GitHub Copilot in VS Code — captures summaries at natural breakpoints, stores them efficiently, and reconstructs only what's relevant (~1000 tokens of high-signal context).

This is retrieval and synthesis — not accumulation. It's not flashy. It's architected correctly. And it works.

*(Best experienced with the [Flowbaby Agent Team](https://github.com/groupzer0/vs-code-agents).)*

## Why This Matters

- **Agents stay sharply focused** — no context window bloat
- **Reasoning quality goes up** — relevant signals, not noise
- **Less latency, less confusion** — lean context, faster inference
- **Long-running projects stay coherent** — across days and weeks

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
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ Chat Participant│  │  LM Tools       │  │ Status Bar   │ │
│  │   @flowbaby     │  │  store/retrieve │  │ Cloud Status │ │
│  └────────┬────────┘  └────────┬────────┘  └──────────────┘ │
│           │                    │                             │
│           └────────────┬───────┘                             │
│                        ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Python Bridge (daemon mode)                 │ │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────────────┐   │ │
│  │  │  Cognee   │  │  LanceDB  │  │     Kuzu Graph    │   │ │
│  │  │  (SDK)    │  │ (vectors) │  │   (relationships) │   │ │
│  │  └───────────┘  └───────────┘  └───────────────────┘   │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    Flowbaby Cloud                            │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │  GitHub OAuth  │  │  STS Vending   │  │  AWS Bedrock  │  │
│  │  (auth only)   │  │  (credentials) │  │  (inference)  │  │
│  └────────────────┘  └────────────────┘  └───────────────┘  │
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

Flowbaby provides the substrate for these behaviors without requiring changes to existing AI tools.

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

| Setting | Description | Default |
|---------|-------------|---------|
| `Flowbaby.enabled` | Enable/disable automatic context operations | `true` |
| `flowbaby.cloud.preferredZone` | Geographic zone: `us`, `eu`, `apac` | Backend default |

Full settings available in VS Code under Extensions → Flowbaby.

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
