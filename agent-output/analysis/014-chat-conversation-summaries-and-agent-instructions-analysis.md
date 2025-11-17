# 014-chat-conversation-summaries-and-agent-instructions-analysis

## Value Statement and Business Objective

As a developer collaborating with Copilot Chat and @cognee-memory,
I want my conversations to be periodically summarized and stored in Cognee using a format optimized for retrieval,
So that future chat sessions can automatically rediscover relevant context, decisions, and rationale without me manually re-reading or re-ingesting old threads.

## Objective

Define:

- A concrete summary schema for chat conversations that maximizes Cognee retrieval quality and context awareness.
- Recommended instructions for the *authoring* agent (during live conversations) on when and how to create these summaries.
- Recommended instructions for the *retrieval* agent (when answering questions) on when and how to query Cognee and incorporate results.
- Optional but aligned commands/flows for the `@cognee-memory` participant (e.g., "Summarize & store last N turns").

This analysis assumes the current VS Code and extension constraints: participants do not passively monitor all chats, but they do see `request.prompt` and `request.history` when invoked.

## Architectural Context

- VS Code Chat participants (including `@cognee-memory`) only see the current chat session when explicitly invoked; there is no global hook into *all* Copilot chats.
- The Cognee-memory extension exposes Python bridge scripts (`ingest.py`, `retrieve.py`) that accept arbitrary text and metadata for ingestion/retrieval.
- Cognee’s strength is in connecting semantically related chunks and preserving structure (entities, relationships, topics), not in raw transcript storage.
- Therefore, we should:
  - Ingest *structured summaries* of conversation segments rather than raw message logs.
  - Use consistent schemas so retrieval queries can reliably surface the right memories.

## Root Question

What summary structure and agent behavior will:

1. Preserve the *essence* of a conversation (topic, decisions, open questions, references), and
2. Make it easy for a future agent to retrieve the right memories with simple natural language queries?

## Proposed Summary Schema for Chat Conversations

### Design Goals

- Stable across sessions and workspaces.
- Compact enough to be ingested frequently.
- Explicitly separates:
  - Topic / context
  - Decisions
  - Open questions / risks
  - References (files, plans, branches, issues)
- Easy for an LLM to both *write* and *read*.

### Recommended Schema

Each summary chunk should follow this markdown/text structure:

```text
Topic: <short title capturing the main focus>

Context:
- <1–3 bullets summarizing what we were working on and why>

Decisions:
- <0–5 bullets, each a single decision or conclusion>

Rationale:
- <0–3 bullets explaining *why* key decisions were made>

OpenQuestions:
- <0–5 bullets capturing unresolved questions, risks, or follow-ups>

NextSteps:
- <0–5 bullets with concrete next actions, owners if known>

References:
- Files: <comma-separated file paths>
- Plans: <plan IDs or names, e.g., 012-fix-initialization-regression>
- Branches: <branch names if relevant>
- Issues: <issue IDs/URLs if relevant>

TimeScope:
- SessionStart: <ISO datetime or human-readable>
- SessionEnd: <ISO datetime or human-readable>
```

### Notes

- Sections with no content can be omitted or left with `- None`.
- `Topic` and `Context` give Cognee good anchor text for high-level semantic search.
- `Decisions` and `OpenQuestions` are especially valuable for future queries like "Why did we choose X?" or "What was still unresolved about Y?".
- `References` connect chat memories to code and artifacts, improving cross-modal retrieval.

## Authoring Agent Instructions (Ingestion Side)

These instructions are intended for the *active Copilot agent* that is chatting with the user.

### When to Summarize and Store

Recommended heuristics:

- Every 8–12 turns *or* when:
  - A significant decision has been made (design choice, API contract, architecture change).
  - A complex debugging or design thread reaches a natural stopping point.
  - The user explicitly asks: "Summarize what we did" or "Remember this".

### How to Summarize

Instruction template for the agent:

```text
When the conversation reaches a significant milestone (every ~10 turns or when a major decision is made):
1. Create a concise summary of the recent conversation segment using the following schema:

   Topic: <short title>

   Context:
   - <1–3 bullets>

   Decisions:
   - <0–5 bullets>

   Rationale:
   - <0–3 bullets>

   OpenQuestions:
   - <0–5 bullets>

   NextSteps:
   - <0–5 bullets>

   References:
   - Files: <paths or None>
   - Plans: <IDs or None>
   - Branches: <names or None>
   - Issues: <IDs/URLs or None>

   TimeScope:
   - SessionStart: <approximate>
   - SessionEnd: <now>

2. Keep the entire summary under ~400–600 tokens.
3. Explicitly show the summary to the user and ask: "Should I store this summary in Cognee memory for future retrieval?".
4. Only proceed to store if the user confirms.
```

### How to Store (Conceptual Flow)

- If the user says "yes" to storing:
  - The agent either:
    - Calls the `@cognee-memory` participant with the summary as the content to ingest, or
    - Instructs the user (or a future automated hook) to run the existing `ingest.py` bridge with:
      - `user_message` = short description (e.g., "Summary of conversation about <Topic>")
      - `assistant_message` = the full structured summary.

## Retrieval Agent Instructions (Answering Questions)

These instructions are for the agent when it is answering a new question in a workspace that has Cognee memories.

### When to Query Cognee

Heuristics for when a question should trigger a Cognee retrieval attempt:

- The user references past work, e.g.:
  - "last time", "previously", "earlier we decided", "remind me"
  - Specific plan IDs or topics (e.g., "Plan 012", "memory truncation")
- The question clearly depends on design rationale or history:
  - "Why did we choose X?"
  - "What were the tradeoffs we discussed for Y?"
  - "What open questions did we leave around Z?"
- The user explicitly asks to use memory:
  - "Check Cognee memory for this."
  - "Search our previous conversations about this topic."

### How to Query Cognee

Instruction template:

```text
When you detect that a question depends on past conversations, decisions, or rationale in this workspace:
1. Formulate a concise retrieval query that captures the user’s intent, including key entities, features, and plan IDs.
2. Use that query to call Cognee (via the available integration) to retrieve relevant memories.
3. Prefer memories whose Topic, Context, Decisions, and References fields match the current question.
4. Limit retrieval to a reasonable number of memories (e.g., top 3–5).
5. For each retrieved memory, read the summary fields and integrate them into your reasoning.
6. When responding to the user, briefly indicate when your answer is informed by Cognee memories, e.g., "Based on a previous session where we decided X, ...".
```

### How to Present Retrieved Context

- Avoid dumping raw summaries verbatim unless the user asks.
- By default:
  - Synthesize a short recap: "Previously, we decided A, B, and C about this topic".
  - Offer an option: "I can show the full stored summary if you’d like.".
- If the user opts in, present the underlying structured summary chunk(s) in the same schema so they can see exactly what was stored.

## Optional `@cognee-memory` Commands and Flows

These are extension-level affordances that align with the schema and instructions above. They are optional but recommended for usability.

### 1. "Summarize & Store Last N Turns" Command

Behavior:

- Input: invoked in a chat session with `request.history` available.
- Steps:
  1. Take the last N turns (e.g., 10–20) from `request.history`.
  2. Ask the model to generate a summary in the schema defined above.
  3. Show the summary to the user.
  4. On confirmation, call `ingest.py` (or an internal ingest helper) to store:
     - `user_message` = short description of the topic.
     - `assistant_message` = the full structured summary text.
- This provides an explicit, one-shot way to convert a chat segment into a Cognee memory.

### 2. "Retrieve for This Question" Command

Behavior:

- Input: the current user question / last message.
- Steps:
  1. Use the last user message as the base retrieval query.
  2. Optionally enrich the query with file paths or plan IDs mentioned in `request.history`.
  3. Call `retrieve.py` via the bridge.
  4. Present the most relevant summaries to the user, with an indication that they come from Cognee.
- This can be invoked directly via `@cognee-memory` or a command palette entry.

## Strategic Considerations

- **Noise control**: By summarizing and storing only at milestones (and with user confirmation), Cognee remains focused and high-signal.
- **Transparency**: The user always sees what is stored, in a consistent schema, and can recognize it when it comes back later.
- **Alignment with product goals**: This pattern supports short-, medium-, and long-term context without requiring the agent to read entire transcripts in every session.

## Recommendations

- Adopt the proposed summary schema for all conversation-derived memories.
- Update agent instructions to:
  - Periodically produce summaries in this schema.
  - Ask before storing in Cognee.
  - Proactively query Cognee when a question clearly depends on past decisions or context.
- Optionally extend the `@cognee-memory` participant with:
  - A "Summarize & store last N turns" command implementing the same schema.
  - A "Retrieve for this question" command that uses the current prompt as a query.

These patterns give you a concrete, repeatable way to make chat interactions progressively more context-aware using Cognee without requiring global monitoring or non-standard VS Code capabilities.

## Potential Risks and Failure Modes

- Summary quality drift: summaries become too verbose, shallow, or inconsistent, reducing retrieval usefulness.
- Over-summarization / loss of nuance: important technical details are collapsed into vague bullets.
- Brittle triggers: simple "every N turns" rules either miss key moments or create noisy, low-value summaries.
- User consent fatigue: frequent "should I store this?" prompts become annoying.
- Misaligned query vs schema: retrieval questions don’t line up with how summaries are structured.
- Index bloat / noisy graph: many overlapping summaries accumulate, including obsolete or conflicting decisions.
- Session/topic ambiguity: different threads about the same theme (e.g., logging, Plan 013) get conflated.
- Cognitive mismatch: the rigid schema doesn’t fit exploratory or research-heavy conversations.
- VS Code UX friction: summaries clutter the main chat with no dedicated memory view.
- Privacy/sensitivity: summaries accidentally capture secrets or sensitive internal data.

## Mitigation Strategies (Within the Current Approach)

- Prefer semantic triggers over fixed N turns (e.g., “we decided”, “we should”, plan IDs, postmortems).
- Separate raw snapshots and distilled summaries, linking them explicitly.
- Introduce quality levels or statuses on memories (Draft/Working/Final decision).
- Include topic and session identifiers (`TopicId`, `SessionId`) in the schema.
- Periodically merge multiple small summaries into curated "decision records" and mark old ones as superseded.
- Add a redaction/safety pass before storing, with explicit removal of secrets and sensitive URLs.
- Keep summaries intentionally short (e.g., ≤300 tokens) and layer detail into optional sections.

## Further Research and Tooling Directions

- Explore Cognee’s support for metadata fields (topics, statuses, timestamps) to:
  - Tag memories with `TopicId`, `SessionId`, and `Status`.
  - Scope retrieval queries by these tags when a plan ID or topic slug is present.
- Review Cognee ingestion/retrieval APIs for:
  - Explicit deprecation or soft-delete of outdated memories.
  - Bulk update/merge operations to consolidate noisy memories into cleaner records.
- Consult VS Code Chat and extension APIs for:
  - Commands or views that can host summaries outside the main chat stream.
  - Persistent state per workspace to track `SessionId` and summarization cadence.
  - Contribution points for quick actions (e.g., "Summarize & store this" buttons) to reduce prompt fatigue.

In addition to in-extension mitigations, consider plan-centric memory (anchoring summaries on plans/ADRs/tickets), task-graph structures, daily session recaps, and an “offline analyst” mode where Cognee is fed curated artifacts periodically rather than continuously ingesting live chat.

## Cognee Metadata Support – Evidence and Implications

From the Cognee docs on DataPoints:

- DataPoints are Pydantic models with standard fields and **metadata for indexing**.
- `metadata.index_fields` determines which fields are embedded and used for semantic search.
- Fields that are not indexed remain as **regular properties** on the node.

Implications for metadata:

- Cognee clearly distinguishes between:
  - Indexed fields (participate in embeddings and semantic search).
  - Non-indexed fields (stored as node properties, usable for filtering and graph reasoning).
- This means we can safely treat `TopicId`, `SessionId`, `Status`, and similar attributes as **structured metadata fields** on DataPoints or ingested records.
- The docs also state that metadata such as source, creation date, and format is preserved at add-time, confirming that Cognee stores additional context alongside the raw text.

Structured vs unstructured:

- Cognee’s ingestion (`.add`) normalizes input into **plain text** and preserves file-level metadata; this is inherently unstructured content plus structured metadata.
- DataPoints, as Pydantic models, can carry arbitrarily structured fields (strings, enums, lists) in addition to the main content.
- For our use case, we should treat:
  - The conversation summary itself as unstructured text content.
  - `TopicId`, `SessionId`, `PlanId`, `Status`, timestamps, and references as **structured metadata fields**.
- These structured fields can then be:
  - Included in `metadata.index_fields` when we want them to affect similarity search.
  - Left non-indexed when they are only used for filtering or grouping.

Limitations and assumptions:

- Public docs focus on file-level metadata and DataPoint `metadata.index_fields`; they do not spell out a separate "arbitrary JSON blob" at the `.add` surface.
- However, the combination of:
  - DataPoints as Pydantic models with arbitrary fields.
  - Metadata preservation at add-time.
  - Indexed vs non-indexed field semantics.
  strongly supports the pattern of attaching structured metadata to conversation summaries for retrieval.
- Where exact API signatures are needed (e.g., adding custom DataPoints via Python), we should verify against the Python API docs or source before implementation, but the conceptual model is clearly metadata-friendly.

## Illustrative Compaction Pipeline Design (for Downstream Agents)

The following design is **illustrative** and intended to guide planners/implementers when building a Cognee-based compaction mechanism. Names and exact APIs should be adapted once the concrete Python SDK surface is confirmed.

### Goal

- Periodically compact many small conversation summaries about a topic into a single, higher-level decision record.
- Mark older summaries as `Status = Superseded` instead of deleting them outright.
- Provide a simple recency-aware scoring function that can be used in `retrieve.py` to combine semantic relevance with freshness.

### ConversationSummary DataPoint (Illustrative)

```python
from datetime import datetime
from pydantic import BaseModel


class ConversationSummary(BaseModel):
  topic_id: str           # e.g., "plan-013-memory-truncation"
  session_id: str         # e.g., "2025-11-16-session-1"
  plan_id: str | None = None

  status: str = "Draft"   # "Draft" | "Final" | "Superseded"

  created_at: datetime
  updated_at: datetime

  summary_text: str       # main unstructured summary content

  decisions: list[str] = []
  rationale: list[str] = []
  open_questions: list[str] = []
  next_steps: list[str] = []

  references_files: list[str] = []
  references_plans: list[str] = []
  references_branches: list[str] = []
  references_issues: list[str] = []

  # metadata.index_fields could include: ["topic_id", "plan_id", "summary_text", "decisions"]
```

Key points:

- `summary_text` + `decisions` form the main semantic content.
- `topic_id`, `plan_id`, `status`, and timestamps are structured metadata.
- Only a subset of fields need to be indexed for vectors; others remain as node properties for filtering and compaction logic.

### DecisionRecord DataPoint (Illustrative)

```python
class DecisionRecord(BaseModel):
  topic_id: str
  plan_id: str | None = None

  status: str = "Final"   # explicitly the committed decision

  created_at: datetime
  updated_at: datetime

  consolidated_decisions: list[str]
  consolidated_rationale: list[str]
  key_open_questions: list[str]
  key_references_files: list[str]
  key_references_plans: list[str]
  key_references_branches: list[str]
  key_references_issues: list[str]

  summary_text: str  # short narrative capturing the final state

  # metadata.index_fields might prioritize: ["topic_id", "plan_id", "summary_text", "consolidated_decisions"]
```

This DataPoint represents the compacted, high-signal memory for a topic/plan.

### Compaction Task (Illustrative Logic)

High-level behavior for a `CompactConversationSummariesTask`:

1. Select all `ConversationSummary` DataPoints where:
   - `topic_id` matches a target topic.
   - `status` is `"Draft"` or `"Working"`.
   - `created_at` is older than some threshold (e.g., more than 1 week ago) **or** there are more than N summaries for this topic.
2. Aggregate fields:
   - `consolidated_decisions` = union of all non-empty `decisions`.
   - `consolidated_rationale` = union of all non-empty `rationale`.
   - `key_open_questions` = union of non-resolved `open_questions`.
   - `key_*references` = union of all referenced files/plans/branches/issues.
   - `summary_text` = short narrative summarizing the combined history.
3. Create or update a `DecisionRecord` for this `topic_id`/`plan_id`.
4. Mark all included `ConversationSummary` DataPoints as `status = "Superseded"` and optionally add a link to the `DecisionRecord`.

This can be implemented as a Cognee pipeline task that runs periodically or on demand.

### Recency-Aware Scoring Function (Illustrative)

The aim is to combine semantic relevance (from Cognee search) with recency. A simple approach for use in `retrieve.py`:

```python
import math
from datetime import datetime, timezone


def recency_score(created_at: datetime, half_life_days: float = 30.0) -> float:
  """Compute a recency score in (0, 1], decaying over time.

  half_life_days controls how quickly older items lose influence.
  """
  now = datetime.now(timezone.utc)
  age_days = max((now - created_at).days, 0)
  # Exponential decay: score = 0.5 ** (age / half_life)
  return 0.5 ** (age_days / half_life_days)


def combined_score(semantic_score: float, created_at: datetime,
           alpha: float = 0.8, half_life_days: float = 30.0) -> float:
  """Combine semantic similarity with recency.

  semantic_score is assumed to be in [0, 1].
  alpha weights semantic relevance vs. recency (0 < alpha < 1).
  """
  r = recency_score(created_at, half_life_days=half_life_days)
  return alpha * semantic_score + (1.0 - alpha) * r
```

Usage in `retrieve.py` (conceptually):

1. Call `cognee.search(...)` to obtain candidate nodes with their semantic scores and metadata, including `created_at`.
2. For each candidate, compute `combined_score(semantic_score, created_at)`.
3. Sort candidates by `combined_score` descending.
4. Return the top K memories to the extension.

This keeps the core Cognee search purely semantic/graph-based while letting the bridge layer bias towards more recent decisions when scores are similar.

### How This Addresses Index Bloat and Noise

- Compaction reduces many small, overlapping summaries into a single `DecisionRecord` per topic/plan.
- Older, superseded summaries remain available for audit but are:
  - Tagged with `status = "Superseded"`.
  - De-prioritized in retrieval and ranking.
- Recency-aware scoring ensures that, among similarly relevant memories, the more recent decision or summary is favored.

These patterns give downstream agents a concrete, metadata-driven way to keep the memory graph clean and focused over time without losing historical traceability.

## Technical Unknowns Requiring Further Investigation

Before the architectural decisions in this analysis are treated as final, several technical unknowns must be resolved:

1. **Cognee DataPoint & Pipeline Capabilities**

- Exact Python API surface for defining custom DataPoints (e.g., `ConversationSummary`, `DecisionRecord`) and using them in pipelines.
- How `metadata.index_fields` is configured for custom models in the SDK version used by this extension.
- Whether Cognee supports soft-deletion/deprecation semantics natively or whether compaction must be expressed purely as “add new nodes and ignore old ones”.

1. **Retrieval API Shape and Ranking Hook**

- Concrete structure of `cognee.search(...)` results in the current environment.
  - Availability of timestamps and arbitrary node properties (e.g., `created_at`, `status`).
  - Presence, range, and stability of a numeric similarity/score field.
- Whether Cognee exposes any built-in recency or ranking parameters beyond raw similarity.

1. **Metadata Propagation End-to-End**

- How much control `ingest.py` currently has over per-record metadata (topic, plan, session, timestamps).
- Whether these metadata fields survive through `.add` → `.cognify` → `.search` and are visible at retrieval time.

1. **Pipeline Execution Model and Cost**

- How expensive it is to run periodic compaction tasks over growing datasets.
- Whether Cognee provides incremental or scoped pipelines (e.g., by topic/dataset) suitable for lightweight maintenance.

1. **VS Code Chat Participant Performance Limits**

- Practical limits on markdown size per `stream.markdown` call and total response size.
- Any soft limits or UX issues when returning multiple long memories (e.g., 3–5 × 1000–2000 chars).

1. **Long-Term Storage Growth and Dataset Strategy**

- Expected scale of conversation summaries per workspace and how that relates to Cognee’s performance characteristics.
- Thresholds (if any) in Cognee beyond which queries or maintenance jobs degrade.

These unknowns must be probed through targeted experiments and SDK/API review before planners treat the compaction and ranking design as a hard architectural constraint.

## Bridge Implications Summary (From Ingest/Retrieve Analysis)

Recent inspection of the Python bridge scripts shows that Plan 014’s assumptions are **not yet implemented** in the current extension:

- `ingest.py`:
  - Ingests each captured interaction as a single plain-text blob combining user + assistant messages and a `Metadata:` line with inline `timestamp` and `importance`.
  - Calls `cognee.add(data=[conversation], dataset_name=dataset_name)` followed by `cognee.cognify(datasets=[dataset_name])`.
  - Does not define DataPoints or attach structured metadata fields (e.g., `topic_id`, `plan_id`, `status`, `created_at`).

- `retrieve.py`:
  - Calls `cognee.search` with `SearchType.GRAPH_COMPLETION` scoped to the workspace dataset.
  - Treats results as opaque text and attempts to parse `[Timestamp: ...]` and `[Importance: ...]` via regex.
  - Computes a recency score from parsed timestamps and combines it with a fixed base score and optional importance into a `final_score`.
  - Enforces a token budget via word counting and returns JSON `{ success, results, result_count, total_tokens }` to the TS layer.

Because `ingest.py` never emits the bracketed tags expected by `retrieve.py`, the regex-based recency/importance logic is effectively a **stub**: most memories default to the same base score, and Cognee’s intrinsic similarity dominates ranking. There is no compaction or status-aware behavior; all captured conversations remain as independent raw-text nodes.

Plan 014’s structured summaries, metadata-driven retrieval, and compaction pipeline therefore require a **bridge-level migration**:

- Update ingestion to accept Plan-014-style summaries and attach first-class metadata fields (topic/session/plan/status/timestamps) via Cognee’s DataPoint or metadata APIs.
- Update retrieval to consume metadata-rich search results, implement recency-aware scoring using real timestamps, and respect `status` (e.g., prefer `DecisionRecord` over `Superseded` summaries).
- Extend bridge responses so the TS layer can honor Plan 013’s transparency policy by showing full `summary_text` (up to limits) and exposing ranking rationale when needed.

The separate `014-bridge-focused-addendum-analysis` file elaborates these bridge responsibilities in more detail for planners and implementers.
