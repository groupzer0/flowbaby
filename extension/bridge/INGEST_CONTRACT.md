# Cognee Summary Ingestion Contract

**Version**: 1.0  
**Last Updated**: 2025-11-19  
**Owner**: Plan 015 - Agent Ingestion Command  

---

## Overview

This document defines the contract for structured summary ingestion via `ingest.py --summary` mode. This contract is used by:

1. **Plan 015**: Agent Ingestion Command (TypeScript → Python bridge)
2. **Plan 016**: Agent Retrieval Command (Python → TypeScript parsing)
3. **Third-party extensions**: Any extension that wants to store structured summaries in Cognee

The contract uses **enriched-text fallback** (§4.4.1) where metadata is embedded in markdown format because Cognee 0.3.4 doesn't expose the DataPoint class for direct structured storage.

---

## Command Interface

### Usage

```bash
python ingest.py --summary --summary-json '<json_string>'
```

### Arguments

- `--summary`: Flag to enable summary mode (vs conversation mode)
- `--summary-json '<json>'`: JSON string containing summary payload

### Exit Codes

- `0`: Success
- `1`: Error (see error codes below)

### Output Format

All responses are printed to stdout as JSON. Logs and warnings go to stderr.

**Success Response**:
```json
{
  "success": true,
  "ingested_chars": 634,
  "timestamp": "2025-11-19T08:12:44.734334Z",
  "metadata": {
    "topic_id": "test-summary-ingestion",
    "session_id": "test-session-001",
    "plan_id": "014",
    "status": "Active",
    "created_at": "2025-11-19T08:12:44.734334Z",
    "updated_at": "2025-11-19T08:12:44.734341Z"
  },
  "ingestion_duration_sec": 36.39,
  "ingestion_metrics": {
    "load_env_sec": 0.003,
    "init_cognee_sec": 2.937,
    "config_llm_sec": 0.00001,
    "dataset_sec": 0.00005,
    "create_summary_text_sec": 0.00001,
    "add_sec": 8.466,
    "cognify_sec": 24.984,
    "total_ingest_sec": 36.392
  }
}
```

**Error Response**:
```json
{
  "success": false,
  "error": "Error message describing what went wrong",
  "error_code": "ERROR_CODE"
}
```

---

## JSON Payload Schema

### Required Fields

The JSON payload MUST include:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `workspace_path` | string | Absolute path to VS Code workspace root | `"/home/user/project"` |
| `topic` | string | Summary title/topic (non-empty) | `"Plan 015 Implementation Strategy"` |
| `context` | string | Summary context/description (non-empty) | `"Discussed agent ingestion with architect..."` |
| `topicId` | string | Unique identifier for this topic | `"plan-015-implementation"` |
| `createdAt` | string | ISO 8601 timestamp | `"2025-11-19T08:12:44.734334Z"` |
| `updatedAt` | string | ISO 8601 timestamp | `"2025-11-19T08:12:44.734341Z"` |

### Optional Fields

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `sessionId` | string | Session identifier | `null` |
| `planId` | string | Plan/project identifier | `null` |
| `status` | string | Status enum: `"Active"`, `"Superseded"`, `"DecisionRecord"` | `"Active"` |
| `decisions` | string[] | List of key decisions | `[]` |
| `rationale` | string[] | List of rationale items | `[]` |
| `openQuestions` | string[] | List of open questions | `[]` |
| `nextSteps` | string[] | List of next steps | `[]` |
| `references` | string[] | List of references/links | `[]` |
| `timeScope` | string | Time scope description | `null` |

### Field Naming Convention

**CRITICAL**: All field names use **camelCase** (matching TypeScript conventions), NOT snake_case.

- ✅ Correct: `topicId`, `sessionId`, `createdAt`, `updatedAt`, `openQuestions`, `nextSteps`
- ❌ Wrong: `topic_id`, `session_id`, `created_at`, `updated_at`, `open_questions`, `next_steps`

The bridge converts camelCase to snake_case internally for Python conventions in the response metadata.

---

## Example Payloads

### Minimal Valid Payload

```json
{
  "workspace_path": "/home/user/project",
  "topic": "Test Summary",
  "context": "Testing summary ingestion",
  "topicId": "test-001",
  "createdAt": "2025-11-19T08:00:00Z",
  "updatedAt": "2025-11-19T08:00:00Z"
}
```

### Full Payload with All Fields

```json
{
  "workspace_path": "/home/user/project",
  "topic": "Plan 015 Implementation Strategy",
  "context": "User discussed agent ingestion command design with architect. Covered TypeScript schema, validation, and access control.",
  "topicId": "plan-015-implementation",
  "sessionId": "session-2025-11-19-001",
  "planId": "015",
  "status": "Active",
  "decisions": [
    "Use VS Code commands as primary surface",
    "Implement workspace-global access model",
    "Embed metadata in enriched text"
  ],
  "rationale": [
    "Commands are accessible to Copilot agents",
    "VS Code doesn't expose caller identity",
    "Cognee 0.3.4 doesn't expose DataPoint class"
  ],
  "openQuestions": [
    "Should topic_id be hash-based or UUID?",
    "How to handle cross-workspace memory sync?"
  ],
  "nextSteps": [
    "Implement TypeScript validation",
    "Create test agent extension",
    "Add audit logging"
  ],
  "references": [
    "Plan 015 documentation",
    "VS Code Extension API docs"
  ],
  "timeScope": "2025-11-19T08:00:00Z to 2025-11-19T09:30:00Z (15 turns)",
  "createdAt": "2025-11-19T08:00:00Z",
  "updatedAt": "2025-11-19T09:30:00Z"
}
```

---

## Error Codes

| Error Code | Description | HTTP Equivalent | Remediation |
|------------|-------------|-----------------|-------------|
| `MISSING_WORKSPACE_PATH` | `workspace_path` field missing from JSON | 400 | Include `workspace_path` in payload |
| `INVALID_WORKSPACE_PATH` | `workspace_path` directory doesn't exist | 404 | Verify workspace path is absolute and exists |
| `MISSING_CREATED_AT` | `createdAt` field missing | 400 | Include ISO 8601 timestamp in `createdAt` |
| `MISSING_UPDATED_AT` | `updatedAt` field missing | 400 | Include ISO 8601 timestamp in `updatedAt` |
| `MISSING_REQUIRED_FIELD` | Required field missing (topic, context, topicId) | 400 | Include all required fields per schema |
| `INVALID_JSON` | JSON parsing failed | 400 | Verify JSON is valid and properly escaped |
| `MISSING_API_KEY` | `LLM_API_KEY` not found in workspace .env | 401 | Add `LLM_API_KEY=sk-...` to workspace .env |
| `IMPORT_ERROR` | Failed to import cognee library | 500 | Run `pip install -r bridge/requirements.txt` |
| `COGNEE_ERROR` | Cognee library threw exception | 500 | Check stderr logs for details |
| `BRIDGE_TIMEOUT` | Script exceeded timeout limit | 504 | Increase timeout or reduce payload size |

---

## Enriched Text Format

The bridge converts structured JSON into enriched markdown text with embedded metadata (§4.4.1):

```markdown
<!-- Template: v1.0 -->
# Conversation Summary: Plan 015 Implementation Strategy

**Metadata:**
- Topic ID: plan-015-implementation
- Session ID: session-2025-11-19-001
- Plan ID: 015
- Status: Active
- Created: 2025-11-19T08:00:00Z
- Updated: 2025-11-19T09:30:00Z

## Context
User discussed agent ingestion command design with architect. Covered TypeScript schema, validation, and access control.

## Key Decisions
- Use VS Code commands as primary surface
- Implement workspace-global access model
- Embed metadata in enriched text

## Rationale
- Commands are accessible to Copilot agents
- VS Code doesn't expose caller identity
- Cognee 0.3.4 doesn't expose DataPoint class

## Open Questions
- Should topic_id be hash-based or UUID?
- How to handle cross-workspace memory sync?

## Next Steps
- Implement TypeScript validation
- Create test agent extension
- Add audit logging

## References
- Plan 015 documentation
- VS Code Extension API docs

## Time Scope
2025-11-19T08:00:00Z to 2025-11-19T09:30:00Z (15 turns)
```

This enriched text is stored as a string in Cognee, with metadata extractable via regex patterns (see `retrieve.py` and Plan 016 for parsing logic).

---

## Performance Characteristics

### Typical Durations (on modern hardware)

| Step | Duration | Notes |
|------|----------|-------|
| Load .env | 0.003s | Fast file I/O |
| Init Cognee | 2.9s | One-time setup per process |
| Configure LLM | 0.00001s | In-memory config |
| Generate dataset name | 0.00005s | Hash computation |
| Create summary text | 0.00001s | String formatting |
| Add to dataset | 8.5s | Cognee internal processing |
| Cognify (LLM extraction) | 25s | **Slowest step** - LLM API calls |
| **Total** | **36.4s** | Average for ~600 char summary |

### Optimization Notes

- **Cognify latency**: 25s is typical for LLM-powered entity extraction. Cannot be optimized without changing Cognee internals.
- **Batch ingestion**: If ingesting multiple summaries, consider batching to amortize Cognee init overhead.
- **Async processing**: Ingestion should happen in background (non-blocking) in extension.

---

## Validation Strategy

### Bridge-Side Validation (Python)

The bridge validates:
1. ✅ Required fields exist (`workspace_path`, `topicId`, `createdAt`, `updatedAt`)
2. ✅ Workspace path is a valid directory
3. ✅ LLM_API_KEY exists in workspace .env
4. ✅ JSON is parseable

The bridge does **NOT** validate:
- Field types (assumes TypeScript validated)
- Field lengths or content
- ISO 8601 timestamp format (Cognee handles this)

### TypeScript-Side Validation (Extension)

The extension (Plan 015) validates:
1. ✅ Required fields: `topic`, `context` (non-empty strings)
2. ✅ Optional fields: arrays of strings (decisions, rationale, etc.)
3. ✅ Metadata: valid status enum, ISO 8601 timestamps
4. ✅ Field types match schema

See `extension/src/validation/summaryValidator.ts` for implementation.

---

## Testing

### Manual Test

```bash
cd /home/luke/Documents/Github-projects/cognee
python extension/bridge/test_summary_ingestion.py "$PWD"
```

Expected output:
```
✅ Test PASSED:
   - Ingested 634 characters
   - Timestamp: 2025-11-19T08:12:44.734334Z
   - Duration: 36.39 seconds
```

### Automated Test (pytest)

```bash
cd extension/bridge
pytest test_summary_ingestion.py::test_summary_ingestion -v
```

### Integration Test (from TypeScript)

```typescript
import { spawn } from 'child_process';

const payload = {
  workspace_path: vscode.workspace.workspaceFolders[0].uri.fsPath,
  topic: "Test Summary",
  context: "Testing from TypeScript",
  topicId: "test-001",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const python = spawn('python3', [
  path.join(__dirname, '../bridge/ingest.py'),
  '--summary',
  '--summary-json',
  JSON.stringify(payload)
]);

const stdout = await collectOutput(python);
const result = JSON.parse(stdout);

if (!result.success) {
  throw new Error(result.error);
}

console.log(`Ingested ${result.ingested_chars} characters`);
```

---

## Migration Path (Future)

When Cognee exposes DataPoint class in a future version:

1. Update `ingest.py` to use `cognee.add(DataPoint(...))` instead of enriched text
2. Update `retrieve.py` to parse native DataPoint fields instead of regex
3. Maintain backward compatibility for enriched-text summaries already stored
4. Add template version detection to choose parsing strategy

Template version tag (`<!-- Template: v1.0 -->`) enables this future migration.

---

## References

- `extension/bridge/ingest.py` - Implementation
- `extension/bridge/test_summary_ingestion.py` - Integration test
- `agent-output/planning/015-agent-ingestion-command.md` - Plan 015
- `agent-output/planning/014-chat-summary-creation-and-retrieval.md` - Summary schema origin
- `agent-output/architecture/system-architecture.md` §4.4.1 - Enriched-text fallback strategy
