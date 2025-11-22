# Python Bridge for Cognee Chat Memory Extension

This directory contains Python scripts that bridge the TypeScript VS Code extension with the Cognee knowledge graph system. The bridge uses subprocess communication with JSON over stdout for clean, structured data exchange.

```text
TypeScript Extension (src/)

  ↓ spawns subprocess
Python Bridge (bridge/)
  ↓ imports & calls
Cognee Library (installed via pip)

  ↓ stores data in
.cognee/ Directory (workspace root)
```

The extension spawns Python scripts as child processes, passing arguments via command line and receiving JSON-formatted responses via stdout.

## Scripts

### `ontology_provider.py`

**Purpose**: Load and validate the ontology.ttl file for Cognee knowledge graph configuration

**Usage** (as module):

```python
from ontology_provider import load_ontology, OntologyLoadError

try:
    ontology = load_ontology()
    print(f"Loaded {len(ontology['entities'])} entities")
except OntologyLoadError as e:
  print(f"Failed to load ontology: {e}")
```

**Usage** (CLI testing):

```bash
python ontology_provider.py
```

**Behavior**:

1. Locates `ontology.ttl` relative to bridge directory (extension/bridge/ontology.ttl)
1. Validates file exists, is readable, and non-empty
1. Parses TTL (Turtle RDF) format using `rdflib.Graph().parse()`
1. Extracts entity classes (owl:Class instances) and relationships (owl:ObjectProperty)
1. Validates expected RDF/OWL namespaces are present
1. Returns structured ontology data

**Returns**:

```python
    'entities': ['User', 'Question', 'Answer', 'Topic', ...],
    'relationships': ['asks', 'answers', 'relatesTo', ...],

    'triple_count': 124,
    'raw_graph': <rdflib.Graph object>,
    'source_file': '/path/to/ontology.ttl'
}
```

**Error Handling**:

Raises `OntologyLoadError` with descriptive messages for:

- Missing rdflib library
- File not found
- Empty file
- Parse errors (invalid Turtle syntax)
- Empty graph (no triples)
- Missing expected namespaces

**Format Note**: As of v0.2.2, `ontology.ttl` (Turtle RDF) is the canonical format. The legacy `ontology.json` format is deprecated and no longer supported. TTL provides better semantic expressiveness and aligns with RDF/OWL standards.

---

### `init.py`

**Purpose**: Initialize Cognee for a workspace with API key configuration

**Usage**:

```bash
python init.py <workspace_path>
```

**Arguments**:

- `workspace_path`: Absolute path to workspace root (where .env file is located)

**Behavior**:

1. Loads `.env` from workspace_path/.env
1. Validates `LLM_API_KEY` exists (note: `OPENAI_API_KEY` is deprecated as of v0.2.2)
1. Calls `cognee.config.set_llm_api_key(api_key)`
1. Creates `.cognee/` directory in workspace_path if it doesn't exist

**Output** (JSON):

```json
{
  "success": true,
  "cognee_dir": "/absolute/path/to/.cognee"
}
```

**Error Output**:

```json
{
  "success": false,
  "error": "OPENAI_API_KEY not found in .env file"
}
```

**Exit Codes**:

- `0`: Success
- `1`: Error (missing args, missing API key, import failure, etc.)

---

### `ingest.py`

**Purpose**: Store user/assistant conversation in Cognee with temporal and importance metadata

**Usage**:

```bash
python ingest.py <workspace_path> <user_message> <assistant_message> [importance]
```

**Arguments**:

- `workspace_path`: Absolute path to workspace root
- `user_message`: User's question or request (string)
- `assistant_message`: Assistant's response (string)
- `importance`: (Optional) Float between 0.0-1.0, defaults to 0.0

**Behavior**:

1. Loads `.env` and configures Cognee
1. Generates ISO 8601 timestamp: `datetime.now().isoformat()`
1. Formats conversation as:

   ```text
   User: <user_message>
   Assistant: <assistant_message>
   ```

1. Creates metadata:

   ```python
   {
     "timestamp": "2025-11-09T14:32:21.234Z",
     "importance": 0.0,  # 0.0-1.0
     "user_message_length": 42,
     "assistant_message_length": 315,
     "conversation_type": "copilot_chat"
   }
   ```

1. Calls `cognee.add(conversation, dataset_name="copilot_chat", metadata=metadata)`
1. Calls `cognee.cognify()` to build/update knowledge graph with ontology-based entity extraction

**Output** (JSON):

```json
{
  "success": true,
  "ingested_chars": 357,
  "timestamp": "2025-11-09T14:32:21.234567"
}
```

**Error Output**:

```json
{
  "success": false,
  "error": "OPENAI_API_KEY not found in .env file"
}
```

**Exit Codes**:

- `0`: Success
- `1`: Error (missing args, invalid importance value, API key missing, etc.)

---

### `retrieve.py`

**Purpose**: Retrieve relevant context using hybrid graph-vector search with custom weighted scoring

**Usage**:

```bash
python retrieve.py <workspace_path> <query> [max_results] [max_tokens] [half_life_days] [include_superseded]
```

**Arguments**:

- `workspace_path`: Absolute path to workspace root
- `query`: Search query string (user's question or topic)
- `max_results`: (Optional) Maximum number of results, defaults to 3 (clamped 1-50)
- `max_tokens`: (Optional) Maximum total tokens across results, defaults to 2000 (minimum 100)
- `half_life_days`: (Optional) Recency half-life (days) controlling decay rate, defaults to 7 (clamped 0.5-90)
- `include_superseded`: (Optional) Whether to include Superseded summaries (`true`/`false`), defaults to `false`

**Behavior**:

1. Loads `.env` and configures Cognee

1. Executes hybrid search:

   ```python
   cognee.search(
     query_text=query,
     search_type=SearchType.GRAPH_COMPLETION  # Hybrid graph + vector
   )
   ```

1. Calculates recency-aware final score for each result:

   ```python
   semantic_score = result.score or 0.7
   recency_multiplier = exp(-ln(2) / half_life_days * days_since_source_created)
   status_multiplier = {
     'DecisionRecord': 1.1,
     'Active': 1.0,
     'Superseded': 0.4
   }.get(status, 1.0)

   final_score = semantic_score * recency_multiplier * status_multiplier
   ```

1. Sorts results by `final_score` (descending) with tie-break favoring `DecisionRecord` entries

1. Applies dual limits: stops at `max_results` results or when `total_tokens > max_tokens`, whichever happens first

1. Estimates tokens using `len(text.split())` as a rough word-based count

**Output** (JSON):

```json
{
  "success": true,
  "results": [
    {
      "text": "User: How do I use async in Python?\nAssistant: You can use...",
      "topic": "Plan 014 – Structured Summaries",
      "topic_id": "3e3e4f26-7c02-4b3c-8b9d-8f1f9b3e2a10",
      "status": "Active",
      "created_at": "2025-11-21T16:30:00Z",
      "source_created_at": "2025-11-21T14:00:00Z",
      "score": 0.87,
      "final_score": 0.87,
      "semantic_score": 0.94,
      "recency_multiplier": 0.92,
      "status_multiplier": 1.0,
      "tokens": 185
    }
  ],
  "result_count": 1,
  "total_results": 1,
  "total_tokens": 185,
  "half_life_days": 7.0,
  "include_superseded": false
}
```

**Error Output**:

```json
{
  "success": false,
  "error": "OPENAI_API_KEY not found in .env file"
}
```

**Exit Codes**:

- `0`: Success (including empty results)
- `1`: Error (missing args, invalid types, API key missing, etc.)

---

## Ontology Schema (`ontology.json`)

Defines 8 chat-centric entities and 12 relationship types for Cognee's LLM-powered extraction during `cognify()`.

### Entities (8)

1. **User**: Person asking questions
1. **Question**: User's query or request
1. **Answer**: Assistant's response
1. **Topic**: Subject area (e.g., "async programming", "API design")
1. **Concept**: Technical concept (e.g., "event loop", "dependency injection")
1. **Problem**: Issue described by user
1. **Solution**: Proposed solution or approach
1. **Decision**: Decision made (e.g., "use FastAPI", "avoid threads")

### Relationships (12)

1. **ASKS**: User → Question
1. **HAS_TOPIC**: Question → Topic
1. **MENTIONS**: Question → Concept
1. **DESCRIBES**: Question → Problem
1. **ADDRESSES**: Answer → Question
1. **PROPOSES**: Answer → Solution
1. **EXPLAINS**: Answer → Concept
1. **SOLVES**: Solution → Problem
1. **RELATED_TO**: Topic ↔ Topic
1. **FOLLOWS_UP**: Question → Question (conversation threads)
1. **IMPACTS**: Decision → Topic
1. **PREREQUISITE_FOR**: Concept → Concept (dependencies)

### Extraction Strategy

- **Method**: Automatic LLM-powered extraction during `cognify()`
- **No manual tagging required**: Cognee's LLM understands natural language and identifies entities/relationships automatically
- **Adaptive**: Scales to different conversation styles and topics without human annotation

### Retrieval Benefits

- **Multi-path traversal**: Find related content through relationship chains (e.g., Question → HAS_TOPIC → Topic → RELATED_TO → Topic → HAS_TOPIC → Past Question)
- **Semantic + structural**: Hybrid GRAPH_COMPLETION combines vector similarity with graph relationships for higher quality context
- **Conversation continuity**: FOLLOWS_UP relationships track discussion threads
- **Concept dependencies**: PREREQUISITE_FOR surfaces foundational concepts
- **Problem-solution matching**: Direct SOLVES relationships enable finding past solutions
- **Topic clustering**: RELATED_TO groups conversations by subject
- **Decision tracking**: IMPACTS links decisions to affected topics

---

## Installation

From the extension root:

```bash
pip install -r bridge/requirements.txt
```

This installs:

- `cognee==0.3.4`: Core knowledge graph library
- `python-dotenv>=1.0.0`: .env file loading

---

## Configuration

1. Create `.env` file in workspace root:

  ```bash
  OPENAI_API_KEY=sk-...
  ```

1. Initialize Cognee for workspace:

  ```bash
  python bridge/init.py /path/to/workspace
  ```

1. Cognee stores data in `workspace/.cognee/` directory (created automatically)

---

## Testing Scripts Manually

### Test Initialization

```bash
python bridge/init.py /home/luke/Documents/Github-projects/cognee
```

Expected output:

```json
{"success": true, "cognee_dir": "/home/luke/Documents/Github-projects/cognee/.cognee"}
```

### Test Ingestion

```bash
python bridge/ingest.py \
  /home/luke/Documents/Github-projects/cognee \
  "How do I use async in Python?" \
  "You can use async/await with asyncio. Here's an example: async def main(): await asyncio.sleep(1)" \
  0.5
```

Expected output:

```json
{"success": true, "ingested_chars": 123, "timestamp": "2025-11-09T14:32:21.234567"}
```

### Test Retrieval

```bash
python bridge/retrieve.py \
  /home/luke/Documents/Github-projects/cognee \
  "async programming" \
  3 \
  2000 \
  0.3 \
  0.2
```

Expected output:

```json
{
  "success": true,
  "results": [
    {
      "text": "User: How do I use async in Python?\nAssistant: You can use...",
      "metadata": {...},
      "score": 0.85,
      "base_score": 0.80,
      "recency_score": 0.95,
      "importance_score": 0.5
    }
  ],
  "result_count": 1,
  "total_tokens": 487
}
```

### Test Error Handling

```bash
# Missing API key
rm /home/luke/Documents/Github-projects/cognee/.env
python bridge/init.py /home/luke/Documents/Github-projects/cognee
```

Expected output:

```json
{"success": false, "error_code": "MISSING_API_KEY", "user_message": "LLM_API_KEY not found. Please add it to your workspace .env file.", "remediation": "Create .env in workspace root with: LLM_API_KEY=your_key_here", "error": "LLM_API_KEY environment variable is required but not set"}
```

All scripts follow these conventions:

- Exit code `0` indicates success
- Exit code `1` indicates a validation or runtime failure

---

## TypeScript Integration (Next Milestone)

The TypeScript extension (Milestone 4) will spawn these scripts as child processes:

```typescript
import { spawn } from 'child_process';

class CogneeClient {
  async initialize(workspacePath: string): Promise<void> {
    const python = spawn('python3', [
      path.join(__dirname, '../bridge/init.py'),
      workspacePath
    ]);
    
    const output = await this.collectOutput(python);
    const result = JSON.parse(output);
    
    if (!result.success) {
      throw new Error(result.error);
    }
  }
  
  // Similar methods for ingest() and retrieve()
}
```

See Milestone 4 in Plan 002 for full implementation details.

---

## Data Flow

```text
User asks question in @cognee-memory chat
        ↓
TypeScript ChatParticipant captures question
        ↓
TypeScript CogneeClient.retrieve(query) spawns retrieve.py
        ↓
Python retrieve.py performs hybrid graph-vector search
        ↓
Returns JSON with relevant past conversations
        ↓
TypeScript prepends context to prompt
        ↓
LLM generates response with context awareness
        ↓
TypeScript CogneeClient.ingest(user_msg, assistant_msg) spawns ingest.py
        ↓
Python ingest.py stores conversation with metadata
        ↓
Python cognify() builds/updates knowledge graph with ontology
        ↓
Next query can retrieve this conversation
```

---

## Performance Considerations

- **Subprocess overhead**: ~100-200ms per spawn on modern systems
- **Cognify latency**: 2-5 seconds for LLM-powered entity extraction during ingestion
- **Retrieval latency**: 500-1500ms for hybrid graph-vector search
- **Token limits**: Prevents excessive context from overwhelming LLM
- **Result limits**: Prevents returning hundreds of irrelevant results

**Optimization Strategies**:

- Extension caches initialization (only spawns init.py once per workspace)
- Ingestion happens asynchronously (doesn't block user's next question)
- Retrieval uses dual limits (max_results AND max_tokens) for fast, focused results

---

## Troubleshooting

### `ImportError: No module named 'cognee'`

**Solution**: Install dependencies:

```bash
pip install -r bridge/requirements.txt
```

### `OPENAI_API_KEY not found in .env file`

**Solution**: Create `.env` in workspace root:

```bash
echo "OPENAI_API_KEY=sk-..." > .env
```

### Scripts output nothing (exit code 0)

**Issue**: Scripts print JSON to stdout, errors to stderr

**Solution**: Check if you're capturing stdout correctly:

```bash
python bridge/init.py /path/to/workspace 2>&1
```

### Permission denied when executing scripts

**Solution**: Make scripts executable:

```bash
chmod +x bridge/*.py
```

### Cognify takes too long (>10 seconds)

**Issue**: LLM-powered entity extraction is computationally expensive

**Solution**:

- Use faster OpenAI model (gpt-3.5-turbo instead of gpt-4)
- Consider batching ingestions
- Run ingestion asynchronously in background

---

## Next Steps

After completing Milestone 3 (Python Bridge):

1. **Milestone 4**: TypeScript-Python Integration
   - Create `src/cogneeClient.ts` with subprocess spawning
   - Implement JSON parsing and error handling
   - Update `extension.ts` to instantiate client on activation

2. **Milestone 5**: Chat Participant Implementation
   - Create `src/chatParticipant.ts` with @cognee-memory registration
   - Implement automatic retrieval before response
   - Implement automatic capture after response

3. **Milestone 6**: Testing, Documentation, and Packaging
   - Integration tests
   - Manual testing
   - Update extension/README.md
   - Package to .vsix

---

## References

- **Cognee Documentation**: [https://docs.cognee.ai](https://docs.cognee.ai)
- **Plan 002**: `Planning/002-automatic-context-retrieval.md`
- **VS Code Chat Participant API**: [https://code.visualstudio.com/api/extension-guides/chat](https://code.visualstudio.com/api/extension-guides/chat)
