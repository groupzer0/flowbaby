# 015-metadata-ranking-and-compaction-placeholder-analysis

## Value Statement and Business Objective

As an architect maintaining the Cognee Chat Memory planning corpus,
I want the relationship between analyses and plans around metadata, ranking, and compaction to be clearly documented,
So that we avoid accidentally creating a second, conflicting "015" analysis and preserve a single source of truth for context intelligence work.

## Objective

Document that **Plan 014** and **Plan 015** both derive from the original **014 analysis** work, and that there is **no separate, independent 015 analysis stream**. This file exists purely as a guardrail to prevent future agents from creating a duplicate 015 analysis.

## Relationship Between Analyses and Plans

- `agent-output/analysis/014-chat-conversation-summaries-and-agent-instructions-analysis.md`
  - Defines the structured chat summary schema and agent behaviors for creating and retrieving summaries.
  - Motivates the need for better long-term memory, compaction, and metadata.
- `agent-output/analysis/014-bridge-focused-addendum-analysis.md`
  - Specifies how the Python bridge (`ingest.py`, `retrieve.py`) must change to support structured summaries, metadata, and recency-aware retrieval.

These **two 014 analysis documents** together provide the architectural foundation for **both** of the following plans:

- `agent-output/planning/014-chat-summary-creation-and-retrieval.md`
  - Implements structured content-only summaries and retrieval UX.
- `agent-output/planning/015-metadata-ranking-and-compaction.md`
  - Builds on Plan 014 to introduce metadata infrastructure, recency-aware ranking, and compaction.

There is **no additional, distinct Plan 015 analysis** beyond what is captured in the two 014 analyses above.

## Guidance for Future Agents

- When planning or implementing work for **Plan 014** or **Plan 015**:
  - First consult:
    - `014-chat-conversation-summaries-and-agent-instructions-analysis.md`, and
    - `014-bridge-focused-addendum-analysis.md`.
  - Treat those documents as the canonical analysis inputs for both plans.
- Do **not** create a new `015-*.md` analysis file for metadata/ranking/compaction unless there is an explicit product decision to spin up a new epic or major redesign.
- If new research is required around ranking algorithms, compaction strategies, or metadata models, prefer naming it with a more specific suffix (e.g., `015-ranking-algorithm-deep-dive-analysis.md`) and clearly reference this placeholder to maintain traceability.

## Scope Considerations

- This placeholder does **not** introduce new technical requirements or architecture; it only documents provenance and guardrails.
- All substantive technical guidance for Plans 014 and 015 remains in the 014 analysis files.

## References

- `agent-output/analysis/014-chat-conversation-summaries-and-agent-instructions-analysis.md`
- `agent-output/analysis/014-bridge-focused-addendum-analysis.md`
- `agent-output/planning/014-chat-summary-creation-and-retrieval.md`
- `agent-output/planning/015-metadata-ranking-and-compaction.md`
