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

### Workspace-Global Access Model

⚠️ **IMPORTANT**: When you enable agent access (`cogneeMemory.agentAccess.enabled = true`), **ALL extensions in the workspace** can write memories to Cognee.

**Why workspace-global?**
- VS Code does not expose extension identity to commands
- Per-extension allow-lists are technically infeasible
- Trust model: If you enable agent access, you trust all installed extensions

**Recommendations**:
- ✅ Enable in workspaces with trusted extensions only
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

### Required Settings

Enable agent access in `.vscode/settings.json`:

```json
{
  "cogneeMemory.agentAccess.enabled": true
}
```

**Default**: `false` (disabled for security)

### Optional Settings

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
    case 'ACCESS_DISABLED':
      vscode.window.showWarningMessage(
        'Cognee agent access is disabled. Enable it in settings to allow memory writes.',
        'Open Settings'
      ).then(choice => {
        if (choice === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'cogneeMemory.agentAccess.enabled');
        }
      });
      break;

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
| `ACCESS_DISABLED` | Agent access not enabled in settings | Enable `cogneeMemory.agentAccess.enabled` |
| `INVALID_PAYLOAD` | Payload failed schema validation | Check `response.error` for field details |
| `MISSING_API_KEY` | `LLM_API_KEY` not in workspace `.env` | Add API key to `.env` file |
| `INVALID_WORKSPACE_PATH` | Workspace path invalid or inaccessible | Verify workspace exists |
| `BRIDGE_TIMEOUT` | Python bridge exceeded timeout | Retry; check bridge logs |
| `COGNEE_ERROR` | Cognee library threw exception | Check Output channel for details |

---

## Retrieving Memories for Agents

**Note**: Retrieval is implemented in Plan 016. See Plan 016 documentation for details.

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

## Status Bar Indicator

When agent access is enabled, a status bar item shows:

- **Idle**: `Cognee Agent Access: Enabled`
- **Active**: `Cognee Agent Access: Ingesting...` (with spinner)
- **Click behavior**: Opens Output channel to show recent activity

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

### 1. Enable Agent Access

In `.vscode/settings.json`:
```json
{
  "cogneeMemory.agentAccess.enabled": true
}
```

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

### Access denied error

**Issue**: Error code `ACCESS_DISABLED`

**Solution**: Enable agent access in settings
```typescript
// Check if enabled programmatically
const config = vscode.workspace.getConfiguration('cogneeMemory');
if (!config.get('agentAccess.enabled')) {
  vscode.window.showWarningMessage('Agent access disabled', 'Enable').then(choice => {
    if (choice === 'Enable') {
      config.update('agentAccess.enabled', true, vscode.ConfigurationTarget.Workspace);
    }
  });
}
```

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
