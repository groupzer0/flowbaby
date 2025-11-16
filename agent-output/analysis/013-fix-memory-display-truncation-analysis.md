# 013-fix-memory-display-truncation-analysis

## Value Statement and Business Objective

As a developer using @cognee-memory chat participant,
I want to see the full retrieved memory content in the chat window and know that my complete query text is being sent to Cognee for search,
So that I can understand what context the system found, trust the information being used to answer my questions, and get the most relevant results.

## Objective

Investigate technical limits and truncation behavior affecting:

- Display of retrieved memories in the VS Code chat participant
- Transmission and logging of user query text from VS Code to Cognee
- Stdout buffering of Python bridge responses in `CogneeClient`

This analysis supports Plan 013 by clarifying whether current truncation is purely a UX choice, a safety guard, or a deeper architectural constraint.

## Architectural Context

Based on `agent-output/architecture/system-architecture.md` and the current code:

- VS Code interaction layer (`extension/src/extension.ts`) owns chat participant UX and markdown rendering.
- `CogneeClient` (`extension/src/cogneeClient.ts`) manages subprocesses, logging, and stdout/stderr buffering.
- Python bridge scripts (`extension/bridge/retrieve.py`) receive full query text via `sys.argv[2]` and return JSON over stdout.
- Cognee SDK performs search and returns results that are serialized as JSON and consumed by `CogneeClient`.

This means truncation can occur in three places:

1. Chat participant formatting (preview vs full memory)
2. Logging and telemetry (query previews, sanitized stdout/stderr)
3. Subprocess I/O (stdout buffer limits, JSON size)

## Root Cause Analysis

### 1. Query Transmission vs Logging

**Finding (confirmed)**: The full user query is sent to Cognee; truncation only affects logs.

- `CogneeClient.retrieve(query)` logs `query_preview: query.substring(0, 50)` but passes the full `query` as an argument to `runPythonScript`:
	- `args = [workspacePath, query, maxResults, maxTokens, recencyWeight, importanceWeight]`
- In `extension/bridge/retrieve.py`, `main()` reads `workspace_path = sys.argv[1]` and `query = sys.argv[2]` with no imposed length limit.
- `retrieve_context()` then calls `cognee.search(..., query_text=query, ...)`, again with no truncation.

**Conclusion**: Query truncation is cosmetic and limited to Output channel logging. There is no evidence of truncation in the path from VS Code to Python to Cognee.

### 2. Memory Display Truncation in Chat Participant

**Finding (confirmed)**: Retrieved memories are intentionally truncated to 150 characters in the chat window.

- In `extension/src/extension.ts`, the chat participant formats retrieved memories as follows:
	- `const preview = memory.length > 150 ? memory.substring(0, 150) + '...' : memory;`
	- It then renders `preview` inside a markdown block for each memory.
- However, when constructing the augmented prompt sent to the LLM, it uses the **full** `memory` text:
	- `contextSection = retrievedMemories.map((memory, i) => `### Memory ${i + 1}\n${memory}).join('\n\n');`
- This means the LLM sees full context, but the user only sees a 150-character preview.

**Conclusion**: The truncation you observed in the chat window is a deliberate UX choice, not a technical limit. It directly conflicts with the need for transparency and trust in retrieved context.

### 3. Stdout Buffer Truncation in `CogneeClient`

**Finding (confirmed)**: stdout and stderr from Python bridge scripts are truncated to 2KB during collection.

- In `runPythonScript`:
	- `stdout` is accumulated and truncated if `stdout.length > 2048`.
	- `stderr` is similarly truncated at 2048 characters.
- On success, `stdout` is parsed as JSON and returned as `CogneeResult`.
- On error, sanitized previews of stdout/stderr are logged.

**Impact on Retrieval**:

- Typical retrieval responses (3–5 results, each ~200–500 chars) likely fall below 2KB JSON size.
- However, as `maxContextResults` increases, or if each memory becomes longer (e.g., 1000+ chars), total JSON size can approach or exceed 2KB.
- If the JSON string is truncated before parsing, `JSON.parse(stdout)` will fail, causing a generic "JSON parse failed" error and no results.
- The current code does not log when truncation actually happens; it silently enforces the buffer limit.

**Conclusion**: For current defaults, 2KB is probably safe, but it is close to the threshold when displaying multiple long memories. This is a latent reliability risk rather than the cause of the current UI truncation.

### 4. VS Code Chat Participant Limits (Unknowns)

**Current behavior in code**:

- Memories are rendered with `stream.markdown(...)` calls.
- There is no explicit size limit or pagination.

**Unknowns**:

- VS Code Chat API may have implicit limits on message size, total tokens, or rendering performance for large markdown blocks.
- There is no local instrumentation to track latency or rendering issues tied to memory length.

**Conclusion**: We cannot yet quantify the maximum safe length for a single memory or the combined size of all memories; this requires targeted experimentation or API guidance.

## Methodology

1. Reviewed roadmap (`agent-output/roadmap/product-roadmap.md`) to ensure alignment with Epic 0.2.2.3 and operational reliability goals.
2. Reviewed system architecture (`agent-output/architecture/system-architecture.md`) to map where truncation could occur across TS ↔ Python ↔ Cognee.
3. Inspected TypeScript code in `extension/src/cogneeClient.ts` and `extension/src/extension.ts` for:
	 - Query handling
	 - Memory display logic
	 - Subprocess stdout/stderr buffering
4. Inspected Python bridge script `extension/bridge/retrieve.py` for argument parsing and query passing.
5. Cross-referenced behaviors with Plan 013 to validate assumptions and identify remaining unknowns.

## Findings

### Confirmed Facts

- Full query text is passed from VS Code to Python and into `cognee.search()` without truncation.
- Memory truncation in the chat window is enforced by a 150-character preview in `extension.ts`.
- Augmented prompts sent to the LLM use full memory contents, not the truncated previews.
- Stdout and stderr from Python scripts are truncated at 2KB for both success and error paths, with no explicit logging when truncation occurs.

### Hypotheses

- **Hypothesis 1**: Increasing memory preview length to ~500–2000 characters will not cause performance or rendering issues for typical usage (3–5 memories), but this must be validated.
- **Hypothesis 2**: Raising the stdout buffer limit from 2KB to 8–16KB would eliminate most risk of truncating retrieval JSON without materially affecting memory usage.
- **Hypothesis 3**: VS Code Chat API can handle several kilobytes of markdown per response without issue, but extremely long memories (e.g., >5000 chars) might degrade UX and warrant a "Show more" pattern.

## Strategic Considerations

### Alignment with Master Product Objective

- The current 150-character truncation conflicts with "Zero Cognitive Overhead" because it hides context that users rely on to build trust.
- Ensuring full (or clearly bounded) memory display supports natural language retrieval by making the system's reasoning inputs visible.
- Verifying full query transmission (already true) and making logs more informative aligns with operational transparency goals in v0.2.3.

### Non-Obvious but Better-Aligned Options

1. **Configurable Preview Length**: Instead of a hardcoded preview, offer `cogneeMemory.maxMemoryPreviewLength` with a high default (e.g., 2000). This keeps UX flexible and lets power users tune behavior.
2. **Progressive Disclosure**: Render a shorter preview (e.g., 300–500 chars) with an inline "Show full memory" expansion, balancing readability and transparency.
3. **Annotated Truncation**: If truncation is necessary (due to size limits or user preference), show an explicit indicator with total length: "(showing 2000 of 3500 chars)".
4. **Adaptive Buffering**: Increase stdout buffer size and add warnings when responses approach the limit, preventing silent data loss while keeping memory usage bounded.

## Recommendations

### 1. Memory Display Behavior

- Replace the fixed 150-character preview with either:
	- Full memory display up to a generous limit (e.g., 2000 chars), or
	- A configurable `maxMemoryPreviewLength` (default >= 1000) plus explicit truncation indicator.
- Ensure that the UI makes it clear when content is truncated and, if possible, provide a way to view the full text.

### 2. Query Logging Improvements

- Increase `query_preview` length to around 200 characters or log full queries by default.
- When truncation occurs, include total query length in the log entry.
- Consider a configuration toggle for logging full queries vs previews for users concerned about log verbosity.

### 3. Stdout Buffer Sizing

- Increase stdout/stderr buffer limit from 2KB to at least 8KB, with a conservative upper bound (e.g., 16KB) to avoid unbounded growth.
- Add a log field (e.g., `stdout_truncated: true`) when truncation actually happens, to avoid silent failure modes.
- Optionally make buffer size configurable via `cogneeMemory` settings for advanced users.

### 4. VS Code Chat API Constraints (Follow-Up Research)

- Run small experiments or consult documentation to determine safe response sizes and patterns:
	- Measure latency and rendering behavior for responses containing 1–5 memories at 500, 1000, and 2000 chars each.
	- Verify that `stream.markdown` calls remain responsive under these conditions.
- If limits are discovered, encode them as explicit constraints in Plan 013 and surface them as configuration defaults.

## Scope Considerations

- **In-Scope for Plan 013**:
	- Memory display truncation logic in `extension.ts`.
	- Query preview logging length in `cogneeClient.ts`.
	- Stdout buffer tuning in `cogneeClient.ts` if confirmed safe.
- **Out-of-Scope but Related**:
	- Adding a full-blown "Show more" UI component or pagination.
	- Redesigning retrieval ranking or context selection logic.
	- Telemetry/analytics on usage (belongs to future reliability/UX epics).

## Open Questions

1. What are the concrete performance characteristics (latency, responsiveness) when rendering several kilobytes of markdown in the chat participant?
2. How large can retrieval JSON responses realistically get with current Cognee configurations (max results, typical memory size)?
3. Do we need per-memory size limits, or is a global per-response cap sufficient?

## References

- Roadmap: `agent-output/roadmap/product-roadmap.md` (Master Product Objective, Epics 0.2.2.3 and 0.2.3.1)
- Architecture: `agent-output/architecture/system-architecture.md` (Section 4.3 Retrieval / Chat Participant Flow)
- Plan: `agent-output/planning/013-fix-memory-display-truncation.md`
- Code:
	- `extension/src/extension.ts` (chat participant and memory preview)
	- `extension/src/cogneeClient.ts` (retrieve, logging, stdout buffering)
	- `extension/bridge/retrieve.py` (query parsing, Cognee search)
