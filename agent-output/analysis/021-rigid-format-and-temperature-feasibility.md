# 021-rigid-format-and-temperature-feasibility.md

## Changelog

- **2025-11-23**: Created by Analyst Agent. Investigated `cognee` SDK internals to determine feasibility of rigid message formatting and temperature control.

## Value Statement and Business Objective

**As a developer using RecallFlow,**
**I want to enforce strict message formatting and deterministic LLM outputs (Temperature=0),**
**So that I can prevent hallucinations and ensure the AI adheres to specific protocol constraints without "creative" deviation.**

## Objective

Determine if `cognee`'s current SDK (`v0.3.4`) supports:

1. **Rigid Message Formatting**: Separating "Context" and "Question" into distinct message blocks or strict prompt sections.
2. **Temperature Control**: Setting `temperature=0` for deterministic outputs.
3. **Feasibility**: Can this be done via configuration/arguments, or does it require decoupling retrieval from generation?

## Architectural Context

- **Current Implementation**: `extension/bridge/retrieve.py` calls `cognee.search(query_type=SearchType.GRAPH_COMPLETION, ...)` which handles both retrieval and generation in one black-box step.
- **Constraint**: The user wants to avoid "forking" `cognee` logic or creating maintenance debt that breaks with future updates.

## Root Cause Analysis

The current `cognee.search` function encapsulates the entire RAG pipeline:

1. Vector/Graph Search
2. Context Assembly
3. LLM Generation

To control step 2 (Formatting) and step 3 (Temperature), we need access to the internal logic or arguments that control them.

## Methodology

- **Tooling**: Created `tmp/inspect_cognee.py` to inspect `cognee` library internals via Python's `inspect` module.
- **Targets**:
  - `cognee.search` function signature.
  - `cognee.config` global settings.
  - `cognee.infrastructure.llm` module.

## Findings

### 1. `cognee.search` Signature

The `cognee.search` function signature is:

```python
def search(
    query_text: str,
    query_type: SearchType = SearchType.GRAPH_COMPLETION,
    system_prompt: Optional[str] = None,
    # ... other params ...
    only_context: bool = False,  # <--- KEY FINDING
    # ...
)
```

- **Missing**: There are **no parameters** for `temperature`, `max_tokens`, or `message_format`.
- **Present**: `only_context=True` is available.

### 2. `cognee.config` Capabilities

- The configuration allows setting providers (`set_llm_provider`) and models (`set_llm_model`), but does **not** expose a simple global setting for `temperature` that applies to the `search` function's internal generation step.
- Modifying the global config for a single request is risky and not thread-safe.

### 3. The `only_context` Solution

The presence of `only_context=True` strongly suggests that `cognee` is designed to support a "Retrieval Only" mode.

- **Behavior**: When `True`, `search` likely returns the retrieved `SearchResult` objects (nodes/chunks) without invoking the LLM.
- **Implication**: This allows us to "Decouple" retrieval from generation cleanly.

## Strategic Considerations

- **Alignment**: Decoupling aligns with the "Zero-Hallucination" goal. By taking control of the generation step, we can enforce strict validation before the LLM even sees the prompt.
- **Future Proofing**: Using `only_context=True` is a standard API feature. We are not hacking internals; we are using the library as intended for a "Headless RAG" pattern.

## Recommendations

### Recommended Approach: "Decoupled RAG Controller"

We should refactor `extension/bridge/retrieve.py` to implement the following pipeline:

1. **Retrieve (via Cognee)**:

   ```python
   # Fetch raw context only
   results = await cognee.search(
       query_text=query,
       query_type=SearchType.GRAPH_COMPLETION,
       only_context=True  # <--- Use this
   )
   ```

2. **Filter & Format (Custom Logic)**:
   - Apply our `score <= 0.01` filtering here.
   - Construct the "Rigid Message Format":

     ```python
     messages = [
         {"role": "system", "content": "You are a memory assistant..."},
         {"role": "user", "content": f"### CONTEXT\n{formatted_results}\n\n### QUESTION\n{query}"}
     ]
     ```

3. **Generate (Direct LLM Call)**:
   - Use `cognee`'s LLM client or a standard `openai`/`litellm` client.
   - **Set Temperature=0** explicitly here.

   ```python
   response = await llm_client.acreate(
       messages=messages,
       temperature=0,
       # ...
   )
   ```

### Benefits

1. **Full Control**: We can enforce any prompt structure we want.
2. **Determinism**: We can guarantee `temperature=0`.
3. **Transparency**: We can log exactly what context was sent to the LLM.
4. **Safety**: We can abort the generation step entirely if the retrieval score is too low (saving tokens and preventing hallucinations).

## Scope Considerations

- **New Dependency**: We may need to instantiate an LLM client directly. We should try to reuse `cognee.infrastructure.llm.get_llm_client()` if possible to respect the user's existing config.

## References

- `cognee` SDK v0.3.4 Source Code (via Inspection)
