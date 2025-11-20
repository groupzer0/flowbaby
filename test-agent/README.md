# Cognee Test Agent

Test extension for validating the Cognee agent ingestion API (Plan 015 Milestone 4).

## Purpose

This extension demonstrates and validates:

1. **Valid payloads**: Minimal and full payloads with all fields
2. **Invalid payloads**: Missing required fields, wrong types
3. **Access control**: Workspace-global access model enforcement
4. **Error handling**: Structured error responses with error codes

## Installation

1. Install dependencies:
   ```bash
   cd test-agent
   npm install
   ```

2. Compile TypeScript:
   ```bash
   npm run compile
   ```

3. Open this workspace in VS Code:
   ```bash
   code ..
   ```

4. Press `F5` to launch Extension Development Host with both extensions loaded

## Usage

1. In the Extension Development Host, open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)

2. Run command: **"Test Cognee Agent Ingestion"**

3. View test results in Output panel:
   - Select `Cognee Test Agent` from dropdown
   - Check for ✅ PASS / ❌ FAIL indicators

4. Inspect agent activity logs:
   - Select `Cognee Agent Activity` from dropdown
   - See real-time ingestion attempts

5. Check audit log:
   ```bash
   cat .cognee/agent_audit.log
   ```

## Test Scenarios

### Test 1: Valid Minimal Payload

Tests ingestion with only required fields:
- `topic` (string)
- `context` (string)
- `metadata.topicId` (string)
- `metadata.createdAt` (ISO 8601)
- `metadata.updatedAt` (ISO 8601)

**Expected**: Success response with `ingested_chars`, `timestamp`, `metadata`

### Test 2: Valid Full Payload

Tests ingestion with all optional fields:
- `decisions` (array)
- `rationale` (array)
- `openQuestions` (array)
- `nextSteps` (array)
- `references` (array)
- `timeScope` (string)
- `metadata.sessionId` (string)
- `metadata.planId` (string)
- `metadata.status` (enum)
- `agentName` (string)

**Expected**: Success response with all metadata fields populated

### Test 3: Invalid Payload (Missing Required Field)

Tests validation by omitting `topic` field.

**Expected**: Error response with `errorCode: 'INVALID_PAYLOAD'`

### Test 4: Access Control

Tests workspace-global access model:
- If `cogneeMemory.agentAccess.enabled = false`: Expect `ACCESS_DISABLED` error
- If `cogneeMemory.agentAccess.enabled = true`: Expect success

**Expected**: Correct behavior based on setting

## Configuration

Before running tests, configure Cognee Chat Memory:

1. Enable agent access (required for Tests 1, 2):
   ```json
   {
     "cogneeMemory.agentAccess.enabled": true
   }
   ```

2. Ensure workspace has `.env` with LLM API key:
   ```env
   LLM_API_KEY=sk-...
   ```

3. (Optional) Disable agent access to test blocking (Test 4):
   ```json
   {
     "cogneeMemory.agentAccess.enabled": false
   }
   ```

## Expected Output

```
================================================================================
Cognee Agent Ingestion API Test Suite
================================================================================

[Test 1] Valid minimal payload...
  ✅ PASS: Ingested 67 characters
     Topic ID: test-minimal-001
     Duration: 35.42s

[Test 2] Valid full payload...
  ✅ PASS: Ingested 289 characters
     Topic ID: test-full-002
     Session ID: test-session-001
     Plan ID: 015
     Status: Active
     Duration: 36.15s

[Test 3] Invalid payload (missing topic)...
  ✅ PASS: Correctly rejected invalid payload
     Error: Payload validation failed: Field "topic" is required and must be a non-empty string

[Test 4] Access control check...
  ℹ️  Agent access is enabled - testing allowed behavior
  ✅ PASS: Correctly allowed when access enabled
     Topic ID: test-access-005

================================================================================
Test Results: 4 passed, 0 failed
================================================================================
```

## Manual Testing

You can also test individual scenarios programmatically:

```typescript
import * as vscode from 'vscode';

const payload = {
  topic: "My Custom Test",
  context: "Testing from custom code",
  metadata: {
    topicId: "custom-test-001",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
};

const responseJson = await vscode.commands.executeCommand<string>(
  'cogneeMemory.ingestForAgent',
  JSON.stringify(payload)
);

const response = JSON.parse(responseJson);

if (response.success) {
  console.log(`✅ Success: ${response.metadata.topic_id}`);
} else {
  console.error(`❌ Error: ${response.error} (${response.errorCode})`);
}
```

## Integration with CI

To run tests in CI, use the VS Code Extension Test Runner:

```bash
npm test
```

(Note: Requires VS Code Extension Testing infrastructure - see `extension/src/test/` for examples)

## References

- **Plan 015**: `agent-output/planning/015-agent-ingestion-command.md`
- **Agent Integration Guide**: `extension/AGENT_INTEGRATION.md`
- **Bridge Contract**: `extension/bridge/INGEST_CONTRACT.md`
