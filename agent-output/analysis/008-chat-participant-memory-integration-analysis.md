# Value Statement and Business Objective

As a developer using GitHub Copilot in VS Code, I want @cognee-memory to reliably create and leverage a knowledge graph from my captured chats without me writing special dialog formats, so that I get high-quality, context-aware answers with minimal friction.

## Objective

Identify why recent tests show “no graph triples/nodes” despite successful retrievals, determine what Cognee actually expects for graph creation and search results, and specify concrete, minimal changes in our extension to align with Cognee’s behavior—without requiring users to write complex, structured prompts.

## Methodology

- Examined our bridge scripts and ontology asset:
  - `extension/bridge/ingest.py`
  - `extension/bridge/retrieve.py`
  - `extension/bridge/ontology.json`
- Reviewed TypeScript client behavior `extension/src/cogneeClient.ts` and participant flow in `extension/src/extension.ts`.
- Consulted Cognee official docs and PyPI pages for authoritative behavior and API patterns:
  - Search Basics (GRAPH_COMPLETION default)
  - Add and Cognify operations
  - Ontology Quickstart and Ontologies reference
  - Dataset Graph API
- Correlated our implementation with documented expectations and highlighted divergences.

## Findings

### Finding 1: Search results do not contain graph nodes/edges by default (working as designed)

- Cognee docs state that `cognee.search()` defaults to `SearchType.GRAPH_COMPLETION` and returns LLM-backed answers with supporting context as a list of results. It does not return a graph structure (nodes/edges) in-line.
- Graph visualization data (nodes/edges) is accessible via a dedicated “Get Dataset Graph” API endpoint, not as part of search results.
- Implication: Our retrieval pipeline that maps results to `text` is consistent with documented behavior. Expecting “triples/nodes” in the search response is a mismatch with Cognee’s API contract.

### Finding 2: Our shipped ontology file format is incompatible with the configured resolver

- Our code uses `RDFLibOntologyResolver(ontology_file=...)` inside `ingest.py` and passes it in `config` to `cognify()`.
- The bundled file `extension/bridge/ontology.json` is a custom JSON schema (entity/relationship list), whereas `RDFLibOntologyResolver` expects an RDF/OWL/Turtle file parsable by RDFLib.
- Cognee docs: You can either pass `config` with a valid resolver, or—more simply—use `cognify(ontology_file_path=...)` with a `.owl/.rdf/.ttl` ontology. If no ontology is provided, Cognee still builds a generic knowledge graph.
- Likely outcome today: our resolver receives an invalid file; ontology grounding silently fails or is ignored. Graph extraction may still occur, but without ontology alignment—and with no structured return in the search results, it appears as “no graph triples.”

### Finding 3: Plain text ingestion is acceptable; artificial markup may reduce extraction signal

- Cognee’s `.add(...)` normalizes content and `.cognify(...)` performs chunking + extraction. Plain text with natural sentences (entities/relations implied by prose) is sufficient to create a graph.
- Our current conversation envelope embeds bracketed metadata (e.g., `[Timestamp: ...] [Importance: ...] [Type: copilot_chat]`). While not fatal, this noise can dilute entity/relation extraction and reduce the likelihood of high-quality graph edges on small samples.
- The docs emphasize that extraction works without ontologies and without manual labels; clearer, declarative sentences typically produce better entity/edge results in `cognify()`.

### Finding 4: If we want nodes/edges for UI/debug, we must call the graph endpoint explicitly

- To display or verify triples, use the “Get Dataset Graph” API (or its Python equivalent if exposed). Search does not carry nodes/edges. This is separate from making search answers better.

### Finding 5: Our usage of GRAPH_COMPLETION is correct

- Scoping to the workspace dataset and requesting GRAPH_COMPLETION aligns with the docs. The remaining gap is ontology misuse and ingestion formatting choices.

## Recommendations

Enable graph creation without special dialog structure by aligning to Cognee’s contracts and simplifying ingestion. Changes are ordered from lowest effort/highest impact.

### Recommendation 1: Remove or fix the ontology configuration immediately

- Short-term (safest): Stop passing a resolver against `ontology.json`. Call `await cognee.cognify(datasets=[dataset_name])` without `config` so the default extraction produces a graph from plain text.
- Medium-term (optional): Ship a valid, minimal OWL/Turtle ontology and pass it correctly:
  - Bundle `ontology.owl` in RDF/XML or Turtle.
  - Use `await cognee.cognify(datasets=[dataset_name], ontology_file_path=str(ontology_path))` (preferred per docs), or construct a `Config` with `RDFLibOntologyResolver(ontology_file=ontology_path)` that points to a real OWL/TTL file.
- Rationale: A mismatched resolver-file pair prevents ontology grounding and may cause confusing results. Default graphs (no ontology) are supported and often good enough initially.

### Recommendation 2: Simplify the conversation ingestion envelope for clearer extraction

- Replace bracketed metadata with natural sentences and minimal headings:
  - Title: “Conversation on `topic`” (optional)
  - “User asked: `question`.”
  - “Assistant answered: `key points`.”
  - Optionally: “We decided to `decision` regarding `topic`.”
- Keep timestamps/importance out of the main prose (or append them in a trailing “Metadata:” line). The goal is to maximize clean, declarative sentences that the extractor can turn into entities/edges.
- Rationale: Clear natural language increases the chance for useful triples without forcing users into complex structures.

### Recommendation 3: Adjust expectations and expose an optional “Show Graph” action for verification

- Retrieval: Keep using GRAPH_COMPLETION; do not expect graph nodes/edges in the search response.
- Debug/UX (optional): Add a command or dev-only toggle to fetch and print a small sample of the dataset graph (nodes/edges) for the current workspace. This confirms that `cognify()` produced a graph even if the search result is textual.
- Rationale: Separates correctness (graph exists) from presentation (search response format).

### Recommendation 4: Consider DataPoints later (optional)

- As we mature, we can migrate ingestion to `add_data_points()` using built-in types (e.g., `Document`, `DocumentChunk`, `Entity`, `Edge`) or a simple custom DataPoint for “ChatTurn.” This yields more predictable structure without burdening the user’s dialog format.
- Not required to fix the current issue; listed as a future enhancement for stronger control over graph quality.

### Recommendation 5: Keep search mode but ensure dataset scoping and timeouts are tuned

- Our current dataset scoping and `SearchType.GRAPH_COMPLETION` are correct. Continue to collect latency metrics and consider a persistent Python worker later for performance (separate concern).

## Concrete Extension Changes (proposed)

Minimal, targeted edits to support Cognee’s expectations without changing user-facing behavior:

- In `extension/bridge/ingest.py`:
  - Replace the resolver-based `config` with a simple cognify call:
    - Immediate fix: `await cognee.cognify(datasets=[dataset_name])`
    - Or, if we add a valid OWL/TTL: `await cognee.cognify(datasets=[dataset_name], ontology_file_path=str(ontology_path))`
  - Adjust the conversation formatting to reduce bracketed metadata noise. Suggested format:
    - `Conversation: <short topic>` (optional)
    - `User asked: <question>`
    - `Assistant answered: <short, declarative summary>`
    - `Decision: <if any>`
    - `Metadata: timestamp=<iso8601>; importance=<0-1>` (optional trailing line)

- In `extension/bridge/retrieve.py`:
  - No functional change required for search. If we want to display triples in debug, add an optional codepath to fetch a small graph sample (nodes/edges) for diagnostics (behind a flag or env var).

Notes:
- These edits avoid forcing users to craft complex dialog formats. They align ingestion with Cognee’s default expectations and remove the ontology format mismatch.

## Edge Cases and Validation

- Empty/sparse texts: Very short or list-like notes may still yield few edges. Adding a one-line “User asked … Assistant answered …” wrapper often helps the extractor.
- Ontology availability: If we later ship an OWL/TTL file, validate parser success explicitly and log it. If parsing fails, fall back to no-ontology mode and warn.
- Large datasets: No change to current scoping. Performance tuning (timeouts, persistent worker) is orthogonal.

## Open Questions

- Python helper for “Get Dataset Graph”: The REST API exposes it clearly. For Python OSS, we may need to call a lower-level function or build a tiny REST call against the local server if running the REST container. We’ll verify availability when we implement the optional graph debug feature.
- Search result object shape: Docs emphasize textual answers. If Cognee exposes richer Python model fields (e.g., context snippets), we can surface them; otherwise, keep mapping to `text`.

## References

- Cognee Search Basics (GRAPH_COMPLETION default):
  - [Search Basics](https://docs.cognee.ai/guides/search-basics)
- Add operation (ingestion expectations):
  - [Add](https://docs.cognee.ai/core-concepts/main-operations/add)
- Ontology Quickstart and Ontologies reference (correct file formats and API usage):
  - [Ontology Quickstart](https://docs.cognee.ai/guides/ontology-support)
  - [Ontologies](https://docs.cognee.ai/core-concepts/further-concepts/ontologies)
- Dataset Graph API (nodes/edges via dedicated endpoint):
  - [Get Dataset Graph](https://docs.cognee.ai/api-reference/datasets/get-dataset-graph)

## Recommendations Summary (enables delivery of the value statement)

- Remove the incompatible `ontology.json` usage and cognify without ontology (or replace it with a valid OWL/TTL and pass `ontology_file_path`). This directly enables graph creation from plain text without requiring structured dialogs.
- Simplify ingestion formatting to clean, declarative sentences (“User asked … Assistant answered …”), keeping technical metadata out of the main prose.
- Stop expecting search to return nodes/edges; if graph visualization is desired, add an optional “Show Graph” diagnostic command that calls the graph endpoint or its Python equivalent.

These changes align our extension with Cognee’s documented behavior, avoid fragile assumptions, and improve the likelihood of useful graph edges from normal conversations—fulfilling the core value without increasing user effort.

## How to convert our current ontology to a Cognee-compatible OWL/Turtle ontology

Cognee’s ontology support expects an RDF/OWL/Turtle file that RDFLib can parse. Our current `ontology.json` (custom entity/relationship list) must be converted into OWL classes and object properties.

What to produce

- A small, curated OWL (RDF/XML) or Turtle (`.ttl`) file.
- Classes for each entity concept (e.g., `User`, `Question`, `Answer`, `Topic`, `Concept`, `Problem`, `Solution`, `Decision`).
- Object properties for each relationship with proper domain and range (e.g., `ASKS`, `HAS_TOPIC`, `MENTIONS`, `DESCRIBES`, `ADDRESSES`, `PROPOSES`, `EXPLAINS`, `SOLVES`, `RELATED_TO`, `FOLLOWS_UP`, `IMPACTS`, `PREREQUISITE_FOR`).
- Optional: An abstract superclass `ChatEntity` to organize the hierarchy (entities subclass it). This is not required but can be helpful.

Mapping from our JSON to OWL/Turtle

- Entities array → OWL Classes
  - Use `name` as the class name/IRI (e.g., `:Question`).
  - Store `description` as `rdfs:comment`.
  - If `type` denotes a category, use `rdfs:subClassOf :ChatEntity` or ignore it if ambiguous.
- Relationships array → OWL Object Properties
  - Use `type` as property name/IRI (e.g., `:HAS_TOPIC`).
  - Set `rdfs:domain` to the `source` class and `rdfs:range` to the `target` class.
  - Store `description` as `rdfs:comment`.

Minimal Turtle example (sufficient to start)

```ttl
@prefix : <http://example.org/cognee-chat#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .

:ChatEntity a owl:Class ; rdfs:label "Chat Entity" .

:User a owl:Class ; rdfs:subClassOf :ChatEntity ; rdfs:label "User" ; rdfs:comment "Person asking questions in chat" .
:Question a owl:Class ; rdfs:subClassOf :ChatEntity ; rdfs:label "Question" ; rdfs:comment "User's question or request" .
:Answer a owl:Class ; rdfs:subClassOf :ChatEntity ; rdfs:label "Answer" ; rdfs:comment "Assistant's response" .
:Topic a owl:Class ; rdfs:subClassOf :ChatEntity ; rdfs:label "Topic" ; rdfs:comment "Subject area or theme" .
:Concept a owl:Class ; rdfs:subClassOf :ChatEntity ; rdfs:label "Concept" ; rdfs:comment "Technical concept explained" .
:Problem a owl:Class ; rdfs:subClassOf :ChatEntity ; rdfs:label "Problem" ; rdfs:comment "Issue or challenge" .
:Solution a owl:Class ; rdfs:subClassOf :ChatEntity ; rdfs:label "Solution" ; rdfs:comment "Proposed solution or approach" .
:Decision a owl:Class ; rdfs:subClassOf :ChatEntity ; rdfs:label "Decision" ; rdfs:comment "Decision made during conversation" .

:ASKS a owl:ObjectProperty ; rdfs:domain :User ; rdfs:range :Question ; rdfs:label "ASKS" ; rdfs:comment "User poses a question" .
:HAS_TOPIC a owl:ObjectProperty ; rdfs:domain :Question ; rdfs:range :Topic ; rdfs:label "HAS_TOPIC" ; rdfs:comment "Question relates to a topic" .
:MENTIONS a owl:ObjectProperty ; rdfs:domain :Question ; rdfs:range :Concept ; rdfs:label "MENTIONS" ; rdfs:comment "Question references a concept" .
:DESCRIBES a owl:ObjectProperty ; rdfs:domain :Question ; rdfs:range :Problem ; rdfs:label "DESCRIBES" ; rdfs:comment "Question describes a problem" .
:ADDRESSES a owl:ObjectProperty ; rdfs:domain :Answer ; rdfs:range :Question ; rdfs:label "ADDRESSES" ; rdfs:comment "Answer responds to question" .
:PROPOSES a owl:ObjectProperty ; rdfs:domain :Answer ; rdfs:range :Solution ; rdfs:label "PROPOSES" ; rdfs:comment "Answer suggests a solution" .
:EXPLAINS a owl:ObjectProperty ; rdfs:domain :Answer ; rdfs:range :Concept ; rdfs:label "EXPLAINS" ; rdfs:comment "Answer explains a concept" .
:SOLVES a owl:ObjectProperty ; rdfs:domain :Solution ; rdfs:range :Problem ; rdfs:label "SOLVES" ; rdfs:comment "Solution addresses problem" .
:RELATED_TO a owl:ObjectProperty ; rdfs:domain :Topic ; rdfs:range :Topic ; rdfs:label "RELATED_TO" ; rdfs:comment "Topics are related" .
:FOLLOWS_UP a owl:ObjectProperty ; rdfs:domain :Question ; rdfs:range :Question ; rdfs:label "FOLLOWS_UP" ; rdfs:comment "Question continues previous discussion" .
:IMPACTS a owl:ObjectProperty ; rdfs:domain :Decision ; rdfs:range :Topic ; rdfs:label "IMPACTS" ; rdfs:comment "Decision affects a topic area" .
:PREREQUISITE_FOR a owl:ObjectProperty ; rdfs:domain :Concept ; rdfs:range :Concept ; rdfs:label "PREREQUISITE_FOR" ; rdfs:comment "Concept builds on another concept" .
```

How to use it in our bridge

- Place the generated file next to the bridge scripts, e.g., `extension/bridge/ontology.ttl`.
- Update ingestion to call: `await cognee.cognify(datasets=[dataset_name], ontology_file_path=str(ontology_path))`.
- Keep the dataset filter to maintain workspace isolation.

Pitfalls to avoid

- Overly large or generic ontologies slow down matching and reduce precision. Keep it small and relevant.
- Class/property names should align with terms likely to appear in the text (“Question”, “Answer”, “Topic”, …) so fuzzy matching has anchors.
- Validate the file parses with RDFLib (any syntax error will cause parsing failures). If a parse fails, fall back to “no ontology” mode with a clear warning.

## Will passing a valid ontology still cause cognify() problems?

In general, no—if the ontology file is syntactically valid and semantically modest.

What normally goes wrong

- Parse errors: invalid RDF/XML/Turtle → RDFLib exceptions. Fix by validating the file with a linter or simple RDFLib load test.
- Mismatch: ontology predicates/classes that never appear in text → less grounding than expected. Mitigate by keeping classes close to natural language used in chats.
- Scale: very large ontologies (thousands of classes) → slower cognify. Keep a curated subset.
- File access: wrong path or missing file. Ensure we compute `ontology_path` relative to the script directory, as we do today.

Safe configuration

- Prefer `ontology_file_path=` over custom resolver wiring; it’s the path recommended in the docs and keeps our code lean.
- Start with a minimal ontology (like the Turtle above). If grounding is good and performance stable, iterate.

## Why adjust expectations about “nodes/triples” and how we benefit from the graph

How Cognee uses the graph for answers

- GRAPH_COMPLETION uses the knowledge graph internally (plus vectors) to assemble supporting context and generate a natural-language answer. You already benefit from relationships and structure—even if the immediate return is text.

When to view nodes/edges

- Mostly diagnostics and visualization: to confirm extraction quality, validate ontology grounding, or present a graph UI. Search responses themselves aren’t raw triples.
- If we want to operationalize graph analytics (e.g., trend analysis over relationships), then a separate graph read path is appropriate. For chat UX, textual answers are sufficient.

Bottom line

- You benefit from graph structure during retrieval without directly handling triples in the chat flow. Keep retrieval text-first; use a “Show Graph” diagnostic when needed.

## ChatTurn DataPoint: stronger structure without burdening users

Concept

- Define a custom DataPoint (e.g., `ChatTurn`) with fields: `user_text` (str), `assistant_text` (str), `timestamp` (datetime), `importance` (float), optional `topic` (str).
- Set `metadata.index_fields = ["user_text", "assistant_text"]` to embed only the conversational content.
- Optionally emit `Edge` DataPoints to model explicit links (e.g., `ADDRESSES`, `HAS_TOPIC`) between turns, or rely on `cognify()` to extract links.

Why it helps

- Predictable structure: We control what gets indexed, embedded, and related.
- Better signals: Separate metadata from content; ensures embeddings are clean.
- Easier evolution: Add fields (tags, doc links) without changing ingestion prose.

Why not implement immediately

- Integration work: Switch from `add()` to `add_data_points()` plus defining/serializing the Pydantic model and optional tasks. This widens the change surface area during current validation.
- Validation focus: Our immediate blocker is ontology/resolver mismatch. Fixing that and simplifying ingestion prose likely resolves “empty graph feel” without a new ingestion path.
- Low-risk next step: Once baseline is solid, introducing `ChatTurn` is a straightforward incremental enhancement that we can validate with a small A/B.

What implementation would look like (sketch)

- Define `ChatTurn` Pydantic model with `metadata.index_fields` as above.
- Use `cognee.add_data_points([chat_turn_instances], dataset_name=dataset)`.
- Optionally generate `Edge` DataPoints for known links (e.g., `User` ASKS `Question`, `Answer` ADDRESSES `Question`) to reinforce structure.

