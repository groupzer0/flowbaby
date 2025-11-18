# Architectural Findings – Plan 014: Chat Summary Creation and Retrieval

**Date**: 2025-11-17 13:15
**Architect**: GitHub Copilot (GPT-5.1-Codex Preview)
**Reviewed Artifacts**:

- `agent-output/planning/014-chat-summary-creation-and-retrieval.md`
- `agent-output/analysis/014-chat-conversation-summaries-and-agent-instructions-analysis.md`
- `agent-output/analysis/014-bridge-focused-addendum-analysis.md`
- `agent-output/architecture/system-architecture.md`

**Verdict**: **REJECTED (Requires Architectural Rework)**

Plan 014, as currently drafted, no longer aligns with the architectural decisions captured in `system-architecture.md` §4.4 and §9 ("Structured Conversation Summaries & Compaction" and "Bridge Migration for Structured Summaries"). The plan explicitly defers metadata, DataPoint ingestion, and structured retrieval outputs to a later plan, but those items are the *core* of the Plan 014 architectural mandate. Shipping only text-formatted summaries would perpetuate the existing transparency and ranking problems and block Plans 015–016.

## Critical Findings (Must Resolve Before Planning Resumes)

1. **Metadata & DataPoint Migration Deferred (Violates Plan 014 Decision)**
   - Architecture Decision "Bridge Migration for Structured Summaries" requires Plan 014 to ingest summaries as Cognee DataPoints with indexed metadata (`topic_id`, `session_id`, `plan_id`, `status`, timestamps) so that retrieval can reason about freshness, provenance, and compaction status. The current plan instead stores plain-text summaries and postpones metadata to Plan 015.
   - *Why this is a blocker*: Without metadata, we cannot (a) express DecisionRecord status, (b) perform recency-aware ranking, (c) support compaction hooks, or (d) deliver the structured payloads required by Plan 016 agent integrations. Pushing metadata to Plan 015 contradicts the architectural sequencing and leaves Plan 016 without the structured bridge schema it depends on.
   - *Required change*: Re-scope Plan 014 to include DataPoint-based ingestion immediately. `ingest.py` must emit Cognee DataPoints that include the Plan 014 schema fields plus metadata indexes. Plan 015 can then focus on ranking logic and compaction, but the structured storage foundation must land here.

2. **Retrieval Path Still Text-Only (No Structured Output Contract)**
   - Current plan leaves `retrieve.py` unchanged and has the TypeScript participant detect summaries by searching for a `"Summary:"` header. This contradicts the architectural requirement that the bridge return structured metadata (TopicId, PlanId, Status, CreatedAt, Scores) so downstream consumers do not parse free-form text.
   - *Impact*: Plan 016 cannot build the `CogneeContextProvider` contract on top of Plan 014 if retrieval continues to output ad-hoc text blobs. It also undermines transparency, since TS cannot reliably show metadata, recency, or status badges.
   - *Required change*: Update Plan 014 to define the `retrieve.py` output schema (JSON array with structured fields) and document the contract (e.g., `RETRIEVE_CONTRACT.md`). TypeScript surfaces (participant, future providers) must consume this schema instead of heuristics.

3. **No Milestone Gating on Bridge Contract Readiness**
   - Plan 014 currently has no equivalent of Milestone 0 from Plan 016 to verify that the bridge schema is implemented and tested. Because Plan 014 is the source of truth for the structured contract, it must include:
     - Bridge-level unit/integration tests proving DataPoint ingestion and structured retrieval results.
     - Documentation of the JSON schema that Plan 016 (and other consumers) can rely on.
   - *Required change*: Add an early milestone that defines, tests, and documents the bridge contract before TypeScript/UI work proceeds. Implementation work for Plan 016 (and any future agent integration) must not begin until this milestone is complete.

4. **TypeScript Fallback Parsing Conflicts with Long-Term Architecture**
   - Milestone 4 directs the participant to parse summaries via `summaryParser` when `retrieve.py` returns raw text. While acceptable as a temporary diagnostic, it risks becoming entrenched and contradicts the architectural push to keep semantic understanding in the bridge layer. Once metadata is present, the participant should only render structured payloads supplied by the bridge.
   - *Required change*: Rewrite Milestone 4 to consume structured metadata returned from the bridge. Any text-based heuristics should be explicitly marked as transitional and removed before Plan 014 completes.

## Integration Requirements / Constraints

- **Ingestion Path**: Plan must describe how `ingest.py` converts Plan 014 summaries into Cognee DataPoints with metadata fields. Include storage of timestamps, session IDs, plan IDs (where available), and status values so later compaction can supersede old summaries.
- **Retrieval Path**: Define the JSON structure returned by `retrieve.py` (e.g., `summary_text`, `topic_id`, `plan_id`, `status`, `created_at`, `score`). Plan should include tasks for modifying `retrieve.py`, updating tests, and documenting the schema for downstream consumers.
- **Transparency & Logging**: TypeScript surfaces should log structured metadata (topic, status, timestamps) rather than plain-text guesses. Plan should describe how the Output channel and participant display will change once structured fields exist.
- **Migration Strategy**: If the plan still intends to temporarily store plain text before migrating to DataPoints, it must include a concrete, tested migration path within the same plan (not deferred). Otherwise, the plan should adopt DataPoints immediately.

## Preconditions for Planner / Implementer

1. **Revise Milestones** to include DataPoint ingestion, structured retrieval outputs, contract documentation, and associated tests. Plain-text-only ingestion is not acceptable for Plan 014.
2. **Add Bridge Contract Validation** similar to Plan 016 Milestone 0 so that architect/QA can confirm the schema before any downstream consumers rely on it.
3. **Update Documentation** (`system-architecture.md` references, new contract files) once the structured schema is defined. Planner should outline who updates the architecture doc and Mermaid diagram when the bridge migration ships.

## Questions Back to Planner

1. What is the proposed DataPoint schema (field names, indexable metadata) for structured summaries, and how will it be serialized in `ingest.py`?
2. How will `retrieve.py` expose structured metadata (JSON, protobuf, etc.) to TypeScript callers, and what happens if legacy raw-text memories are still in the store?
3. What migration or backfill strategy will convert previously ingested plain-text summaries (if any) into DataPoints so future ranking/compaction logic does not need to support two formats indefinitely?
4. Which milestone owns the contract tests that prove `retrieve.py` returns the schema required by Plan 016’s `CogneeContextProvider`?

## Verdict Summary

- **Status**: REJECTED until the plan is revised to implement the DataPoint-based ingestion and structured retrieval outputs mandated by the Plan 014 architecture decisions.
- **Blocking Issues**: Lack of metadata/DataPoint migration, absence of structured retrieval contract, missing bridge contract gating/tests, and heavy reliance on TypeScript text parsing.
- **Next Steps**: Planner must produce a revised Plan 014 that fulfills the architectural scope. Implementation cannot proceed until the architect re-reviews and approves the updated plan.
