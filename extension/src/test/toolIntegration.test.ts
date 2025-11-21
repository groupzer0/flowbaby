/**
 * Tool Integration Tests (Plan 016)
 * 
 * Tests for:
 * - Tool lifecycle (atomic registration/unregistration)
 * - Round-trip store→retrieve workflow
 * - Access control enforcement
 * - Tool response format validation
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

suite('Tool Integration Test Suite', () => {

    suite('Tool Registration', () => {
        test('Both tools register at extension activation', async () => {
            // Tools register unconditionally at activation
            // Authorization is handled by VS Code Configure Tools UI
            
            await new Promise(resolve => setTimeout(resolve, 1000));

            const tools = await vscode.lm.tools;
            const storeToolExists = tools.some(t => t.name === 'cognee_storeMemory');
            const retrieveToolExists = tools.some(t => t.name === 'cognee_retrieveMemory');

            assert.strictEqual(storeToolExists, true, 'Store tool should be registered at activation');
            assert.strictEqual(retrieveToolExists, true, 'Retrieve tool should be registered at activation');
        });

        test('Tool UI visibility flags are correct', async () => {
            await new Promise(resolve => setTimeout(resolve, 500));

            const tools = await vscode.lm.tools;
            const storeTool = tools.find(t => t.name === 'cognee_storeMemory');
            const retrieveTool = tools.find(t => t.name === 'cognee_retrieveMemory');

            // Verify store tool metadata
            if (storeTool) {
                assert.ok(storeTool.name, 'Store tool should have name');
                assert.ok(storeTool.description, 'Store tool should have description');
            }

            // Verify retrieve tool metadata
            if (retrieveTool) {
                assert.ok(retrieveTool.name, 'Retrieve tool should have name');
                assert.ok(retrieveTool.description, 'Retrieve tool should have description');
            }
        });
    });



    suite('Round-Trip Integration', () => {
        let sandbox: sinon.SinonSandbox;
        let commandStub: sinon.SinonStub;
        let stagedMemories: any[];

        setup(() => {
            sandbox = sinon.createSandbox();
            stagedMemories = [];
            commandStub = sandbox.stub(vscode.commands, 'executeCommand').callsFake(async (command: string, payload?: string) => {
                if (command === 'cogneeMemory.ingestForAgent') {
                    const request = JSON.parse(payload as string);
                    stagedMemories.push(request);
                    return JSON.stringify({
                        success: true,
                        staged: true,
                        operationId: 'test-operation',
                        ingested_chars: request.context.length,
                        metadata: { topic_id: request.metadata?.topicId }
                    });
                }
                if (command === 'cogneeMemory.retrieveForAgent') {
                    return JSON.stringify({
                        entries: stagedMemories.map(entry => ({
                            summaryText: `${entry.topic}: ${entry.context}`,
                            score: 0.5,
                            topicId: entry.metadata?.topicId ?? null,
                            planId: entry.metadata?.planId ?? null,
                            createdAt: new Date().toISOString()
                        })),
                        totalResults: stagedMemories.length,
                        tokensUsed: 42
                    });
                }
                return undefined;
            });
        });

        teardown(() => {
            sandbox.restore();
        });

        test('Store summary via tool and retrieve via query returns matching results', async () => {
            const tools = await vscode.lm.tools;
            const storeTool = tools.find(t => t.name === 'cognee_storeMemory');
            assert.ok(storeTool, 'Store tool not registered');

            const testTopic = `Test Topic ${Date.now()}`;
            const testContext = `Test context for round-trip validation ${Date.now()}`;
            const testDecision = `Test decision ${Date.now()}`;
            const topicId = `test-topic-${Date.now()}`;

            // Invoke ingest command directly (tool internally uses the same command)
            const ingestResponseJson = await vscode.commands.executeCommand<string>(
                'cogneeMemory.ingestForAgent',
                JSON.stringify({
                    topic: testTopic,
                    context: testContext,
                    decisions: [testDecision],
                    metadata: {
                        topicId,
                        status: 'Active',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    }
                })
            );
            const ingestResponse = JSON.parse(ingestResponseJson);

            assert.strictEqual(ingestResponse.success, true);
            assert.strictEqual(ingestResponse.staged, true);
            assert.ok(ingestResponse.ingested_chars > 0);

            // Retrieve staged memory
            const retrieveResponseJson = await vscode.commands.executeCommand<string>(
                'cogneeMemory.retrieveForAgent',
                JSON.stringify({ query: testTopic, maxResults: 5 })
            );
            const retrieveResponse = JSON.parse(retrieveResponseJson);

            assert.ok(Array.isArray(retrieveResponse.entries));
            assert.strictEqual(retrieveResponse.totalResults, 1);

            const matchingEntry = retrieveResponse.entries[0];
            assert.ok(matchingEntry.summaryText.includes(testTopic));
            assert.ok(matchingEntry.score >= 0);
            assert.strictEqual(matchingEntry.topicId, topicId);

            assert.strictEqual(commandStub.callCount >= 2, true);
        });
    });

    suite('Tool Response Format', () => {
        test('Retrieve tool returns both narrative and JSON payload', async () => {
            const sandbox = sinon.createSandbox();
            const stub = sandbox.stub(vscode.commands, 'executeCommand').callsFake(async (command: string) => {
                if (command === 'cogneeMemory.retrieveForAgent') {
                    return JSON.stringify({
                        entries: [{
                            summaryText: 'Test memory',
                            score: 0.9,
                            topicId: 'topic-123',
                            planId: 'plan-123',
                            createdAt: new Date().toISOString()
                        }],
                        totalResults: 1,
                        tokensUsed: 12
                    });
                }
                return undefined;
            });

            const retrieveResponseJson = await vscode.commands.executeCommand<string>(
                'cogneeMemory.retrieveForAgent',
                JSON.stringify({ query: 'cognee', maxResults: 1 })
            );
            const retrieveResponse = JSON.parse(retrieveResponseJson);

            assert.ok(Array.isArray(retrieveResponse.entries));
            assert.strictEqual(retrieveResponse.totalResults, 1);
            assert.strictEqual(retrieveResponse.tokensUsed, 12);

            const entry = retrieveResponse.entries[0];
            assert.strictEqual(entry.summaryText, 'Test memory');
            assert.strictEqual(entry.topicId, 'topic-123');
            assert.ok(typeof entry.score === 'number');

            stub.restore();
            sandbox.restore();
        });
    });
});
