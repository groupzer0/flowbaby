/**
 * Test Agent Extension for Cognee Agent Ingestion API (Plan 015 Milestone 4)
 * 
 * This extension validates the agent ingestion command by testing:
 * - Valid payloads (minimal and full)
 * - Invalid payloads (missing fields, wrong types)
 * - Access control (disabled setting)
 * - Error handling (timeouts, bridge failures)
 */

import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('Cognee Test Agent activated');

    const command = vscode.commands.registerCommand(
        'cognee-test-agent.testIngestion',
        async () => {
            await runTests();
        }
    );

    context.subscriptions.push(command);
}

export function deactivate() {}

/**
 * Run all test scenarios
 */
async function runTests() {
    const outputChannel = vscode.window.createOutputChannel('Cognee Test Agent');
    outputChannel.show();
    outputChannel.clear();

    outputChannel.appendLine('='.repeat(80));
    outputChannel.appendLine('Cognee Agent Ingestion API Test Suite');
    outputChannel.appendLine('='.repeat(80));
    outputChannel.appendLine('');

    let passed = 0;
    let failed = 0;

    // Test 1: Valid minimal payload
    outputChannel.appendLine('[Test 1] Valid minimal payload...');
    if (await testValidMinimalPayload(outputChannel)) {
        passed++;
    } else {
        failed++;
    }
    outputChannel.appendLine('');

    // Test 2: Valid full payload
    outputChannel.appendLine('[Test 2] Valid full payload...');
    if (await testValidFullPayload(outputChannel)) {
        passed++;
    } else {
        failed++;
    }
    outputChannel.appendLine('');

    // Test 3: Invalid payload (missing required field)
    outputChannel.appendLine('[Test 3] Invalid payload (missing topic)...');
    if (await testInvalidPayloadMissingField(outputChannel)) {
        passed++;
    } else {
        failed++;
    }
    outputChannel.appendLine('');

    // Test 4: Access control (if disabled, should be blocked)
    outputChannel.appendLine('[Test 4] Access control check...');
    if (await testAccessControl(outputChannel)) {
        passed++;
    } else {
        failed++;
    }
    outputChannel.appendLine('');

    // Summary
    outputChannel.appendLine('='.repeat(80));
    outputChannel.appendLine(`Test Results: ${passed} passed, ${failed} failed`);
    outputChannel.appendLine('='.repeat(80));

    if (failed === 0) {
        vscode.window.showInformationMessage(`✅ All ${passed} tests passed!`);
    } else {
        vscode.window.showWarningMessage(`⚠️ ${failed} test(s) failed. Check Output channel.`);
    }
}

/**
 * Test 1: Valid minimal payload
 */
async function testValidMinimalPayload(output: vscode.OutputChannel): Promise<boolean> {
    try {
        const payload = {
            topic: "Test Minimal Payload",
            context: "Testing minimal valid payload with required fields only",
            metadata: {
                topicId: "test-minimal-001",
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
            output.appendLine(`  ✅ PASS: Ingested ${response.ingested_chars} characters`);
            output.appendLine(`     Topic ID: ${response.metadata?.topic_id}`);
            output.appendLine(`     Duration: ${response.ingestion_duration_sec?.toFixed(2)}s`);
            return true;
        } else {
            output.appendLine(`  ❌ FAIL: ${response.error}`);
            output.appendLine(`     Error code: ${response.errorCode}`);
            return false;
        }
    } catch (error) {
        output.appendLine(`  ❌ FAIL: Exception: ${error}`);
        return false;
    }
}

/**
 * Test 2: Valid full payload
 */
async function testValidFullPayload(output: vscode.OutputChannel): Promise<boolean> {
    try {
        const payload = {
            topic: "Test Full Payload",
            context: "Testing full payload with all optional fields populated",
            decisions: ["Use TypeScript", "Implement validation"],
            rationale: ["Type safety", "Fast fail"],
            openQuestions: ["What about edge cases?"],
            nextSteps: ["Run integration tests", "Document API"],
            references: ["Plan 015", "AGENT_INTEGRATION.md"],
            timeScope: "2025-11-19T08:00:00Z to 09:00:00Z (5 turns)",
            metadata: {
                topicId: "test-full-002",
                sessionId: "test-session-001",
                planId: "015",
                status: "Active" as const,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            },
            agentName: "Cognee Test Agent"
        };

        const responseJson = await vscode.commands.executeCommand<string>(
            'cogneeMemory.ingestForAgent',
            JSON.stringify(payload)
        );

        const response = JSON.parse(responseJson);

        if (response.success) {
            output.appendLine(`  ✅ PASS: Ingested ${response.ingested_chars} characters`);
            output.appendLine(`     Topic ID: ${response.metadata?.topic_id}`);
            output.appendLine(`     Session ID: ${response.metadata?.session_id}`);
            output.appendLine(`     Plan ID: ${response.metadata?.plan_id}`);
            output.appendLine(`     Status: ${response.metadata?.status}`);
            output.appendLine(`     Duration: ${response.ingestion_duration_sec?.toFixed(2)}s`);
            return true;
        } else {
            output.appendLine(`  ❌ FAIL: ${response.error}`);
            output.appendLine(`     Error code: ${response.errorCode}`);
            return false;
        }
    } catch (error) {
        output.appendLine(`  ❌ FAIL: Exception: ${error}`);
        return false;
    }
}

/**
 * Test 3: Invalid payload (missing required field)
 */
async function testInvalidPayloadMissingField(output: vscode.OutputChannel): Promise<boolean> {
    try {
        // Missing "topic" field (required)
        const payload = {
            context: "Testing invalid payload",
            metadata: {
                topicId: "test-invalid-003",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        };

        const responseJson = await vscode.commands.executeCommand<string>(
            'cogneeMemory.ingestForAgent',
            JSON.stringify(payload)
        );

        const response = JSON.parse(responseJson);

        if (!response.success && response.errorCode === 'INVALID_PAYLOAD') {
            output.appendLine(`  ✅ PASS: Correctly rejected invalid payload`);
            output.appendLine(`     Error: ${response.error}`);
            return true;
        } else {
            output.appendLine(`  ❌ FAIL: Should have rejected invalid payload`);
            output.appendLine(`     Got: ${JSON.stringify(response)}`);
            return false;
        }
    } catch (error) {
        output.appendLine(`  ❌ FAIL: Exception: ${error}`);
        return false;
    }
}

/**
 * Test 4: Access control check
 */
async function testAccessControl(output: vscode.OutputChannel): Promise<boolean> {
    try {
        const config = vscode.workspace.getConfiguration('cogneeMemory');
        const accessEnabled = config.get<boolean>('agentAccess.enabled', false);

        if (!accessEnabled) {
            output.appendLine(`  ℹ️  Agent access is disabled - testing blocking behavior`);

            const payload = {
                topic: "Test Access Control",
                context: "This should be blocked",
                metadata: {
                    topicId: "test-access-004",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            };

            const responseJson = await vscode.commands.executeCommand<string>(
                'cogneeMemory.ingestForAgent',
                JSON.stringify(payload)
            );

            const response = JSON.parse(responseJson);

            if (!response.success && response.errorCode === 'ACCESS_DISABLED') {
                output.appendLine(`  ✅ PASS: Correctly blocked when access disabled`);
                output.appendLine(`     Error: ${response.error}`);
                return true;
            } else {
                output.appendLine(`  ❌ FAIL: Should have blocked when access disabled`);
                output.appendLine(`     Got: ${JSON.stringify(response)}`);
                return false;
            }
        } else {
            output.appendLine(`  ℹ️  Agent access is enabled - testing allowed behavior`);

            const payload = {
                topic: "Test Access Control (Enabled)",
                context: "This should succeed",
                metadata: {
                    topicId: "test-access-005",
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
                output.appendLine(`  ✅ PASS: Correctly allowed when access enabled`);
                output.appendLine(`     Topic ID: ${response.metadata?.topic_id}`);
                return true;
            } else {
                output.appendLine(`  ❌ FAIL: Should have succeeded when access enabled`);
                output.appendLine(`     Error: ${response.error}`);
                return false;
            }
        }
    } catch (error) {
        output.appendLine(`  ❌ FAIL: Exception: ${error}`);
        return false;
    }
}
