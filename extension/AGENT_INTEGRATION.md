# Agent Integration Guide

**Version**: 1.0  
**Last Updated**: 2025-11-19  
**Plan**: 015 - Agent Ingestion Command  

---

## Overview

The Cognee Chat Memory extension provides commands for GitHub Copilot agents and third-party VS Code extensions to store and retrieve structured conversation summaries. This enables:

- **Agent continuity**: Agents can maintain context across sessions without manual capture
- **Multi-agent collaboration**: Different agents can share memory via a common knowledge base
- **Custom workflows**: Extensions can build custom agent memory patterns

---

## Security and Privacy

### Configure Tools Authorization Model

⚠️ **IMPORTANT**: Cognee tools are controlled exclusively through VS Code's **Configure Tools** UI. When you enable tools there, they become available to GitHub Copilot and all extensions in the workspace.

**Why Configure Tools?**
- VS Code native mechanism for tool authorization
- Users explicitly opt-in via clear UI
- Tools can be enabled/disabled per workspace
- Follows VS Code best practices for Language Model Tools

**Recommendations**:
- ✅ Enable tools only in workspaces with trusted extensions
- ✅ Review installed extensions before enabling
- ✅ Inspect audit logs regularly (`Output` > `Cognee Agent Activity`)
- ❌ Do NOT enable in untrusted or public workspaces
- ❌ Do NOT enable if workspace contains sensitive data

### Audit Logging

All agent ingestion and retrieval attempts are logged:

1. **Output Channel**: `Output` > `Cognee Agent Activity`
   - Real-time log of all agent commands
   - Shows timestamp, agent name (if provided), topic, and result
   - Example: `[Agent Ingest] 2025-11-19T08:12:44Z - Agent: GitHub Copilot - Topic: Plan 015 Implementation - Status: success`

2. **Audit Log File**: `.cognee/agent_audit.log`
   - Structured JSON log for programmatic analysis
   - Format: `{"timestamp": "2025-11-19T08:12:44Z", "command": "ingestForAgent", "agentName": "GitHub Copilot", "topicDigest": "a1b2c3d4", "result": "success", "errorCode": null}`
   - Topic digest: First 8 characters of SHA-256 hash (for privacy)

---

## Configuration

### Tool Authorization

Cognee tools are controlled through VS Code's **Configure Tools** UI:
1. Open Copilot chat → Click "Tools" (⚙️) → "Configure Tools"
2. Find "Store Memory in Cognee" and "Retrieve Cognee Memory"
3. Toggle tools on/off (disabled by default)

No workspace settings required for authorization.

### LLM API Key (Required)

Configure LLM API key in workspace `.env`:

```env
LLM_API_KEY=sk-...
```

Without this, ingestion will fail with error code `MISSING_API_KEY`.

---

## Ingesting Memories from Agents

### Command: `cogneeMemory.ingestForAgent`

**Signature**: `(requestJson: string) => Promise<string>`

- **Input**: JSON string containing `CogneeIngestRequest` payload
- **Output**: JSON string containing `CogneeIngestResponse` result

### TypeScript Example (Minimal)

```typescript
import * as vscode from 'vscode';

// Minimal payload (required fields only)
const payload = {
  topic: "User Question About Async",
  context: "User asked how to use async/await in TypeScript. Agent explained event loop and provided code example.",
  metadata: {
    topicId: "async-question-001",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
};

try {
  const responseJson = await vscode.commands.executeCommand<string>(
    'cogneeMemory.ingestForAgent',
    JSON.stringify(payload)
  );
  
  const response = JSON.parse(responseJson);
  
  if (response.success) {
    console.log(`✅ Ingested ${response.ingested_chars} characters`);
    console.log(`   Topic ID: ${response.metadata.topic_id}`);
    console.log(`   Duration: ${response.ingestion_duration_sec.toFixed(2)}s`);
  } else {
    console.error(`❌ Ingestion failed: ${response.error}`);
    console.error(`   Error code: ${response.errorCode}`);
  }
} catch (error) {
  console.error('Exception during ingestion:', error);
}
```

### TypeScript Example (Full Payload)

```typescript
import * as vscode from 'vscode';

// Full payload with all optional fields
const payload = {
  topic: "Plan 015 Implementation Strategy",
  context: "User discussed agent ingestion command design with architect. Covered TypeScript schema, validation, and access control.",
  decisions: [
    "Use VS Code commands as primary surface",
    "Implement workspace-global access model",
    "Embed metadata in enriched text"
  ],
  rationale: [
    "Commands are accessible to Copilot agents",
    "VS Code doesn't expose caller identity",
    "Cognee 0.3.4 doesn't expose DataPoint class"
  ],
  openQuestions: [
    "Should topic_id be hash-based or UUID?",
    "How to handle cross-workspace memory sync?"
  ],
  nextSteps: [
    "Implement TypeScript validation",
    "Create test agent extension",
    "Add audit logging"
  ],
  references: [
    "Plan 015 documentation",
    "VS Code Extension API docs"
  ],
  timeScope: "2025-11-19T08:00:00Z to 2025-11-19T09:30:00Z (15 turns)",
  metadata: {
    topicId: "plan-015-implementation",
    sessionId: "session-2025-11-19-001",
    planId: "015",
    status: "Active",
    createdAt: "2025-11-19T08:00:00Z",
    updatedAt: "2025-11-19T09:30:00Z"
  },
  agentName: "GitHub Copilot" // Optional, for audit logs
};

const responseJson = await vscode.commands.executeCommand<string>(
  'cogneeMemory.ingestForAgent',
  JSON.stringify(payload)
);

const response = JSON.parse(responseJson);

if (!response.success) {
  throw new Error(`Ingestion failed: ${response.error} (${response.errorCode})`);
}

console.log('Summary ingested successfully:', response.metadata.topic_id);
```

### Error Handling

The command returns structured errors for programmatic handling:

```typescript
const response = JSON.parse(responseJson);

if (!response.success) {
  switch (response.errorCode) {
    case 'INVALID_PAYLOAD':
      console.error('Payload validation failed:', response.error);
      // Fix payload and retry
      break;

    case 'MISSING_API_KEY':
      vscode.window.showErrorMessage(
        'LLM_API_KEY not found. Add it to your workspace .env file.',
        'Open Docs'
      );
      break;

    case 'BRIDGE_TIMEOUT':
      vscode.window.showErrorMessage('Cognee ingestion timed out. Try again later.');
      break;

    default:
      console.error('Unknown error:', response.error);
  }
}
```

### Common Error Codes

| Error Code | Description | Remediation |
|------------|-------------|-------------|
| `INVALID_PAYLOAD` | Payload failed schema validation | Check `response.error` for field details |
| `MISSING_API_KEY` | `LLM_API_KEY` not in workspace `.env` | Add API key to `.env` file |
| `INVALID_WORKSPACE_PATH` | Workspace path invalid or inaccessible | Verify workspace exists |
| `BRIDGE_TIMEOUT` | Python bridge exceeded timeout | Retry; check bridge logs |
| `COGNEE_ERROR` | Cognee library threw exception | Check Output channel for details |

---

## Using Cognee Tools with GitHub Copilot and Custom Agents (Plan 016)

### Overview

Cognee Chat Memory provides two **Language Model Tools** that appear in VS Code's "Configure Tools" dialog:

1. **cognee_storeMemory** (`#cogneeStoreSummary`) - Store conversation summaries
2. **cognee_retrieveMemory** (`#cogneeRetrieveMemory`) - Retrieve relevant memories

These tools allow Copilot and custom agents to autonomously access workspace memory through the standard VS Code tools UI.

### Tool Discovery

**In Configure Tools UI**:
1. Open any Copilot chat
2. Click the "Tools" button (⚙️ icon near input box)
3. Click "Configure Tools"
4. Find "Cognee Memory" tools in the list
5. Toggle tools on/off individually

**In Chat (`#` Autocomplete)**:
- Type `#cognee` in chat to see autocomplete suggestions
- Select `#cogneeStoreSummary` or `#cogneeRetrieveMemory`
- Tool description appears in autocomplete preview

**In Custom Agent `.agent.md` Files**:

```markdown
---
name: Memory-Aware Code Assistant
description: Copilot assistant with access to workspace memory
tools: ['search', 'cogneeStoreSummary', 'cogneeRetrieveMemory']
---

You are a code assistant with access to workspace-specific memory.

When the user asks about past decisions or implementations:
1. Use #cogneeRetrieveMemory to search for relevant context
2. Ground your answer in the retrieved memories
3. If no memories exist, use your training data but clarify it's not workspace-specific

When the user completes an important implementation or makes a decision:
1. Offer to store a summary using #cogneeStoreSummary
2. Include topic, context, and key decisions in the summary
```

### Store Memory Tool

**Tool Name**: `cognee_storeMemory`  
**Reference Name**: `cogneeStoreSummary` (for `#` autocomplete and `.agent.md` files)  
**Icon**: `$(database)`

**Input Schema**:
```typescript
{
  topic: string;           // Required: Summary title
  context: string;         // Required: Summary description
  decisions?: string[];    // Optional: Key decisions
  rationale?: string[];    // Optional: Reasoning
  metadata?: {             // Optional: Metadata (auto-generated if omitted)
    plan_id?: string;
    status?: 'Active' | 'Superseded' | 'DecisionRecord';
  }
}
```

**Example Usage in Chat**:
```
User: "Remember that we decided to use Redis for caching"
Agent: I'll store that decision. #cogneeStoreSummary {
  "topic": "Redis Caching Decision",
  "context": "Team decided to use Redis for session caching to improve performance",
  "decisions": ["Use Redis for session cache", "Deploy as Docker container"],
  "metadata": {"status": "Active"}
}
```

**Tool Response**:
```json
{
  "success": true,
  "summary_id": "redis-caching-decision",
  "ingested_chars": 245,
  "duration_ms": 1234
}
```

### Retrieve Memory Tool

**Tool Name**: `cognee_retrieveMemory`  
**Reference Name**: `cogneeRetrieveMemory` (for `#` autocomplete and `.agent.md` files)  
**Icon**: `$(search)`

**Input Schema**:
```typescript
{
  query: string;           // Required: Natural language search query
  maxResults?: number;     // Optional: Max results (default: 3, max: 10)
}
```

**Example Usage in Chat**:
```
User: "How did we implement caching?"
Agent: Let me check our memory. #cogneeRetrieveMemory {
  "query": "caching implementation",
  "maxResults": 3
}
```

**Tool Response** (Structured + Narrative):

The tool returns BOTH a narrative markdown summary AND verbatim JSON:

````markdown
# Retrieved Memories (1 results)

## 1. Redis Caching Decision

**Context:** Team decided to use Redis for session caching to improve performance

**Decisions:**
- Use Redis for session cache
- Deploy as Docker container

**Metadata:**
- Topic ID: redis-caching-decision
- Plan: 015
- Created: 2025-11-19T08:00:00Z
- Relevance Score: 0.923

---

## Structured Response (JSON)

```json
{
  "entries": [
    {
      "summaryText": "Team decided to use Redis for session caching...",
      "topic": "Redis Caching Decision",
      "topicId": "redis-caching-decision",
      "planId": "015",
      "createdAt": "2025-11-19T08:00:00Z",
      "score": 0.923,
      "decisions": ["Use Redis for session cache", "Deploy as Docker container"]
    }
  ],
  "totalResults": 1,
  "tokensUsed": 142
}
```
````

**Why Both Formats?**
- **Narrative**: Human-readable, agents can quote directly in responses
- **JSON**: Structured data for agent parsing, auditing, and further processing

### Tool Lifecycle

Both tools register at extension activation. VS Code manages tool enablement through Configure Tools UI:

**Tools Enabled (via Configure Tools)** → Tools appear in:
- Configure Tools UI (checkboxes checked)
- `#` autocomplete in chat
- Available for agent invocation

**Tools Disabled (via Configure Tools)** → Tools hidden from:
- `#` autocomplete
- Agent invocation (VS Code won't route calls)
- Configure Tools shows checkboxes unchecked

**Implementation Note**: Tools register unconditionally at activation. VS Code's Configure Tools UI is the sole authorization mechanism.

### Transparency Indicators

When agents use Cognee tools, you see:

1. **Output Channel**: `Output` > `Cognee Agent Activity`
   - Real-time log of all tool invocations
   - Shows timestamp, tool name, query/topic, and result
   - Example: `[Tool Invocation] 2025-11-19T08:12:44Z - cognee_retrieveMemory called`

2. **Configure Tools UI**: Visual feedback for tool state
   - Checkboxes show which tools are enabled/disabled
   - Clear UI for enabling/disabling per workspace

3. **Confirmation Messages** (optional):
   - Tools may show confirmation prompts before execution
   - Depends on user's trust settings for agents
   - Example: "Store this conversation summary in Cognee knowledge graph?"

---

## Retrieving Memories for Agents

### Command: `cogneeMemory.retrieveForAgent`

**Signature**: `(requestJson: string) => Promise<string>`

- **Input**: JSON string containing `CogneeContextRequest` payload
- **Output**: JSON string containing `CogneeContextResponse` or `AgentErrorResponse`

### TypeScript Example

```typescript
import * as vscode from 'vscode';

// Minimal retrieval request
const request = {
  query: "How did we implement caching?",
  maxResults: 3  // Optional, defaults to 3
};

try {
  const responseJson = await vscode.commands.executeCommand<string>(
    'cogneeMemory.retrieveForAgent',
    JSON.stringify(request)
  );
  
  const response = JSON.parse(responseJson);
  
  // Check for error
  if ('error' in response) {
    console.error(`❌ Retrieval failed: ${response.message}`);
    console.error(`   Error code: ${response.error}`);
    return;
  }
  
  // Success - process results
  console.log(`✅ Retrieved ${response.entries.length} memories`);
  console.log(`   Total tokens: ${response.tokensUsed}`);
  
  response.entries.forEach((entry, idx) => {
    console.log(`\n--- Memory ${idx + 1} ---`);
    console.log(`Topic: ${entry.topic || 'Untitled'}`);
    console.log(`Score: ${entry.score.toFixed(3)}`);
    console.log(`Summary:\n${entry.summaryText.substring(0, 200)}...`);
    
    if (entry.decisions && entry.decisions.length > 0) {
      console.log(`Decisions: ${entry.decisions.length}`);
    }
    
    if (entry.topicId) {
      console.log(`Topic ID: ${entry.topicId}`);
    }
  });
} catch (error) {
  console.error('Exception during retrieval:', error);
}
```

### Retrieval Error Codes

| Error Code | Description | Remediation |
|------------|-------------|-------------|
| `INVALID_REQUEST` | Invalid query or malformed JSON | Check request structure |
| `RATE_LIMIT_EXCEEDED` | Too many requests per minute | Wait and retry (max 10/min default) |
| `QUEUE_FULL` | Too many concurrent requests | Wait for in-flight requests to complete |
| `BRIDGE_TIMEOUT` | Python bridge exceeded timeout | Retry; check bridge logs |

---

## Schema Reference

### CogneeIngestRequest

```typescript
interface CogneeIngestRequest {
  // Required fields
  topic: string;                    // Summary title
  context: string;                  // Summary description
  metadata: SummaryMetadata;        // Metadata (see below)

  // Optional fields
  decisions?: string[];             // Key decisions
  rationale?: string[];             // Rationale items
  openQuestions?: string[];         // Open questions
  nextSteps?: string[];             // Next steps
  references?: string[];            // References/links
  timeScope?: string;               // Time scope description
  agentName?: string;               // Caller hint for audit logs
}
```

### SummaryMetadata

```typescript
interface SummaryMetadata {
  // Required fields
  topicId: string;                  // Unique identifier
  createdAt: string;                // ISO 8601 timestamp
  updatedAt: string;                // ISO 8601 timestamp

  // Optional fields
  sessionId?: string;               // Session identifier
  planId?: string;                  // Plan/project identifier
  status?: 'Active' | 'Superseded' | 'DecisionRecord';
}
```

### CogneeIngestResponse

```typescript
interface CogneeIngestResponse {
  success: boolean;

  // On success
  ingested_chars?: number;          // Character count
  timestamp?: string;               // Ingestion timestamp
  metadata?: {                      // Metadata confirmation
    topic_id: string;
    session_id?: string;
    plan_id?: string;
    status: string;
    created_at: string;
    updated_at: string;
  };
  ingestion_duration_sec?: number;  // Duration in seconds
  ingestion_metrics?: Record<string, number>;

  // On failure
  error?: string;                   // Error message
  errorCode?: string;               // Error code
}
```

---

## Audit Logging

All tool invocations are logged for transparency. Check the **Output** channel:

1. Open **View → Output**
2. Select **"Cognee Agent Activity"** from dropdown
3. View real-time logs of all tool calls with timestamps and results

---

## Best Practices

### Topic ID Generation

**Recommendation**: Use descriptive, human-readable topic IDs

```typescript
// ✅ Good: Descriptive and unique
topicId: "plan-015-implementation-2025-11-19"
topicId: "user-question-async-programming-001"

// ❌ Bad: Generic or non-unique
topicId: "summary-1"
topicId: "conversation"
```

**Alternative**: Hash-based IDs for guaranteed uniqueness

```typescript
import * as crypto from 'crypto';

function generateTopicId(topic: string, timestamp: string): string {
  const hash = crypto.createHash('sha256')
    .update(`${topic}-${timestamp}`)
    .digest('hex');
  return hash.substring(0, 16); // First 16 chars
}

const topicId = generateTopicId("Plan 015 Implementation", new Date().toISOString());
// Result: "a1b2c3d4e5f67890"
```

### When to Ingest

**DO ingest**:
- After multi-turn conversations (≥3 turns)
- When key decisions are made
- When user explicitly requests memory storage
- At session end for continuity

**DON'T ingest**:
- After every single turn (too noisy)
- For trivial queries ("What's 2+2?")
- For sensitive/private data without user consent
- When agent access is disabled (check first)

### Batching vs Real-Time

**Real-time ingestion** (after each conversation):
- ✅ Immediate availability for next session
- ❌ Higher latency (30-40s per ingestion)
- ❌ More API calls

**Batch ingestion** (end of session):
- ✅ Lower latency impact on user
- ✅ Can aggregate multiple topics
- ❌ Delayed availability

**Recommendation**: Real-time for important decisions, batch for routine conversations.

---

## Testing Your Integration

### 1. Enable Tools via Configure Tools UI

1. Open Copilot chat
2. Click "Tools" (⚙️) → "Configure Tools"
3. Enable "Store Memory in Cognee" and "Retrieve Cognee Memory"

### 2. Create Test Script

```typescript
// test-agent-ingestion.ts
import * as vscode from 'vscode';

export async function testIngestion() {
  const payload = {
    topic: "Test Agent Ingestion",
    context: "Testing the agent ingestion API",
    metadata: {
      topicId: "test-001",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };

  const responseJson = await vscode.commands.executeCommand<string>(
    'cogneeMemory.ingestForAgent',
    JSON.stringify(payload)
  );

  const response = JSON.parse(responseJson);

  console.log('Ingestion result:', response);
  
  if (response.success) {
    vscode.window.showInformationMessage(`✅ Test passed: Ingested ${response.ingested_chars} chars`);
  } else {
    vscode.window.showErrorMessage(`❌ Test failed: ${response.error}`);
  }
}
```

### 3. Verify in Output Channel

1. Open `Output` panel (`View` > `Output`)
2. Select `Cognee Agent Activity` from dropdown
3. Look for log entry: `[Agent Ingest] <timestamp> - Agent: <your-agent> - Topic: Test Agent Ingestion - Status: success`

### 4. Check Audit Log

```bash
cat .cognee/agent_audit.log | grep test-001
```

Expected output:
```json
{"timestamp": "2025-11-19T08:12:44Z", "command": "ingestForAgent", "agentName": "Test Agent", "topicDigest": "a1b2c3d4", "result": "success", "errorCode": null}
```

---

## Troubleshooting

### Command not found

**Issue**: `vscode.commands.executeCommand` throws "command not found"

**Solution**: Verify Cognee Chat Memory extension is installed and activated
```typescript
const extension = vscode.extensions.getExtension('cognee.cognee-chat-memory');
if (!extension) {
  throw new Error('Cognee Chat Memory extension not installed');
}
await extension.activate();
```

### Tools not appearing in chat

**Issue**: `#cognee*` commands don't appear in autocomplete

**Solution**: Enable tools via Configure Tools UI
1. Open Copilot chat
2. Click "Tools" (⚙️) → "Configure Tools"
3. Find "Store Memory in Cognee" and "Retrieve Cognee Memory"
4. Toggle checkboxes to enable
5. Return to chat and type `#cognee` to verify autocomplete

### Payload validation fails

**Issue**: Error code `INVALID_PAYLOAD`

**Solution**: Check `response.error` for specific field errors
```typescript
if (response.errorCode === 'INVALID_PAYLOAD') {
  console.error('Validation errors:', response.error);
  // Example error: 'Field "topic" is required and must be a non-empty string'
}
```

### Ingestion times out

**Issue**: Error code `BRIDGE_TIMEOUT` or command never returns

**Solution**:
1. Check if LLM API key is valid
2. Check network connectivity
3. Verify Cognee installation: `pip list | grep cognee`
4. Check bridge logs in Output channel

---

## Advanced: Using Validation Helper

The extension exports a validation helper for pre-flight checks:

```typescript
import { validateIngestRequest } from './validation/summaryValidator';

const payload = {
  topic: "Test",
  context: "Testing",
  metadata: {
    topicId: "test-001",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
};

const validation = validateIngestRequest(payload);

if (!validation.valid) {
  console.error('Validation failed:', validation.errors);
  // Don't call command; fix payload first
  return;
}

// Validation passed; proceed with command
const responseJson = await vscode.commands.executeCommand<string>(
  'cogneeMemory.ingestForAgent',
  JSON.stringify(payload)
);
```

---

## References

- **Bridge Contract**: `extension/bridge/INGEST_CONTRACT.md`
- **TypeScript Types**: `extension/src/types/agentIntegration.ts`
- **Validation Helper**: `extension/src/validation/summaryValidator.ts`
- **Plan 015**: `agent-output/planning/015-agent-ingestion-command.md`
- **VS Code Commands API**: https://code.visualstudio.com/api/references/vscode-api#commands
