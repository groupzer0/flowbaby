# 014-bridge-focused-addendum-analysis

## Value Statement and Business Objective

As a developer using Cognee Chat Memory in VS Code,
I want the Python bridge (`ingest.py`, `retrieve.py`) to store and retrieve conversation summaries using structured metadata aligned with Plan 014,
So that long-term chat memories are accurate, compact, and ranked by both relevance and recency without brittle text parsing or hidden behavior.

## Objective

Document the bridge-specific implications of Plan 014:

- How ingestion must evolve (from raw text to structured summaries + metadata).
- How retrieval must evolve (from regex-based recency scoring to metadata-driven ranking).
- How these changes align with the existing three-layer architecture and system-architecture decisions.

This addendum is focused on the Python bridge layer and is intended to complement the existing 014 analysis and system architecture document.

## Architectural Context (Bridge-Focused)

- The VS Code extension delegates all knowledge operations to Python bridge scripts via `CogneeClient`.
- `ingest.py` currently ingests conversation pairs as a single formatted text string using `cognee.add` followed by `cognee.cognify`.
- `retrieve.py` currently calls `cognee.search` (with `SearchType.GRAPH_COMPLETION`) and then applies a custom recency/importance heuristic in Python.
- No custom DataPoints or structured metadata fields are defined today for conversation summaries; metadata such as timestamps and importance are embedded in plain text.

Plan 014’s structured summaries and compaction assumptions therefore require a **bridge-level migration** from raw text ingestion and regex-based retrieval to a metadata-aware design.

## Current Bridge Behavior (From Recent Analysis)

### Ingestion (`ingest.py`)

- Collects `user_message` and `assistant_message` from the TS layer.
- Builds a single text blob of the form:

  ```text
  User asked: {user_message}

  Assistant answered: {assistant_message}

  Metadata: timestamp={timestamp}, importance={importance}
  ```

- Calls `await cognee.add(data=[conversation], dataset_name=dataset_name)`.
- Immediately runs `await cognee.cognify(datasets=[dataset_name])` on the workspace dataset.
- Does **not**:
  - Define or use custom DataPoints (`ConversationSummary`, `DecisionRecord`, etc.).
  - Attach structured metadata fields (topic, plan, session, status) visible to Cognee as properties.
  - Persist timestamps or importance as first-class fields; they only exist inside the plain text `Metadata:` line.

### Retrieval (`retrieve.py`)

- Configures Cognee using workspace-local dataset name and LLM provider.
- Calls `await cognee.search(query_type=SearchType.GRAPH_COMPLETION, query_text=query, datasets=[dataset_name], top_k=max_results)`.
- Treats each search result as either a tuple `(text, ...)` or an object with `.text`.
- Attempts to extract `[Timestamp: ...]` and `[Importance: ...]` patterns from the text via regex.
- Computes a `recency_score` using a linear decay over 30 days, then combines:
  - `base_score` (fixed constant, e.g., 0.7),
  - `recency_score`,
  - parsed `importance` (if any),
  into a `final_score` using fixed weights.
- Applies a rough token budget by counting words and truncates results when `max_tokens` is exceeded.
- Returns JSON with `{ success, results, result_count, total_tokens }` to the TS layer.

Key finding: the regex patterns in `retrieve.py` expect bracketed tags like `[Timestamp: ...]` and `[Importance: ...]`, but `ingest.py` does **not** emit such tags. As a result, recency and importance scoring are effectively **no-ops** in most cases; retrieval ranking is dominated by Cognee’s base similarity and the bridge’s constant `base_score`.

## Bridge-Focused Addendum to Plan 014

### Ingestion: From Raw Text to Structured Summaries

To align with Plan 014’s structured summary and compaction design, `ingest.py` must evolve to:

1. **Ingest Structured Summary Text Instead of Arbitrary Conversation Pairs**

- Accept a pre-formatted summary in the Plan 014 schema (Topic, Context, Decisions, Rationale, OpenQuestions, NextSteps, References, TimeScope).
- Use a consistent textual wrapper that preserves this structure for human inspection but treats it as the primary content for Cognee.

1. **Attach First-Class Metadata Fields**

- Derive and pass structured metadata such as:
  - `topic_id` (stable slug per topic/plan).
  - `session_id` (per-day or per-chat-session identifier).
  - `plan_id` (e.g., `014-chat-conversation-summaries`), when applicable.
  - `status` (`Draft`, `Final`, `Superseded`).
  - `created_at` / `updated_at` timestamps.
- Ensure these fields are stored as node properties or DataPoint fields, not just embedded in text.

1. **Prepare for DataPoint-Based Ingestion**

- Introduce a `ConversationSummary` DataPoint model (as outlined in the main 014 analysis) and use it when calling Cognee’s Python APIs.
- Configure `metadata.index_fields` so that `summary_text`, `decisions`, and key identifiers (`topic_id`, `plan_id`) participate in semantic search, while other fields can be used for filtering and compaction.

1. **Preserve Backward Compatibility Where Needed**

- For existing workspaces with legacy raw-text memories, maintain a fallback ingestion path or a migration strategy that gradually transitions to structured summaries.

### Retrieval: From Regex Heuristics to Metadata-Aware Ranking

Plan 014’s retrieval behavior requires `retrieve.py` to:

1. **Consume Metadata-Rich Search Results**

- Switch from treating results as opaque text to reading structured fields (e.g., `created_at`, `status`, `topic_id`, `plan_id`).
- Verify Cognee’s `search` result structure in the current SDK and adjust parsing accordingly.

1. **Implement Recency-Aware Scoring Using Timestamps**

- Replace regex-based timestamp parsing with direct use of `created_at` (or equivalent) from the search results.
- Implement an exponential or configurable decay function (as sketched in the main 014 analysis) to compute recency scores.
- Combine semantic similarity from Cognee with recency via a transparent, documented formula.

1. **Incorporate Status and Compaction Semantics**

- De-prioritize or filter out `ConversationSummary` records with `status = "Superseded"` in favor of `DecisionRecord` entries marked as `Final`.
- When both are present for the same `topic_id`/`plan_id`, prefer the `DecisionRecord` for answer synthesis and only surface superseded summaries when the user explicitly asks for history.

1. **Return Transparent, Inspectable Payloads to TypeScript**

- Extend the JSON response structure to include:
  - `topic_id`, `plan_id`, `status`, `created_at`, and `final_score` per result.
  - The raw `summary_text` and key `decisions` for each memory.
	- This enables the TS layer (and Chat participant) to honor Plan 013’s transparency policy (show full context up to limits, include explicit truncation markers) and to optionally display ranking details.

### Bridge-Level Support for Compaction

Although compaction may ultimately be implemented as a Cognee pipeline, the bridge must:

- Expose a way to trigger compaction tasks (e.g., a `compact.py` script or a mode in `ingest.py`/`init.py`).
- Respect `status` fields when querying, so that retrieval behavior reflects post-compaction semantics.
- Log compaction actions in a way that QA and users can inspect (e.g., number of summaries merged, topics affected).

These responsibilities ensure that the bridge layer becomes an active participant in managing memory graph growth and noise, rather than a thin pass-through for raw text.

## Alignment with System Architecture Decisions

- **Three-Layer Architecture**: All changes remain confined to the Python bridge and Cognee SDK usage; the TS layer still communicates via JSON over stdout/stderr.
- **Memory Transparency & Preview Policy (Plan 013)**: By returning richer metadata and full `summary_text`, the bridge enables TS to display more faithful previews and expose ranking rationale.
- **Structured Summaries & Compaction (Plan 014)**: The bridge addendum operationalizes the architectural decision by specifying concrete ingestion and retrieval changes.

Implementers should treat this addendum as the bridge-specific counterpart to the main Plan 014 analysis, ensuring all ingestion/retrieval changes are consistent with the system-architecture document and future ranking/compaction tasks.
