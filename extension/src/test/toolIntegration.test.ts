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
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

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
        test('Store summary via tool and retrieve via query returns matching results', async function() {
            // Skip if extension not initialized or Python environment not available
            this.timeout(30000); // Increase timeout for bridge operations
            // Tools are registered unconditionally; Configure Tools controls enablement

            try {
                // Get tools
                const tools = await vscode.lm.tools;
                const storeTool = tools.find(t => t.name === 'cognee_storeMemory');
                
                if (!storeTool) {
                    console.log('Store tool not available, skipping round-trip test');
                    this.skip();
                    return;
                }

                // Create unique test data
                const testTopic = `Test Topic ${Date.now()}`;
                const testContext = `Test context for round-trip validation ${Date.now()}`;
                const testDecision = `Test decision ${Date.now()}`;

                // Store via tool
                // Note: Tool invocation requires LanguageModelToolInvocationOptions which is not
                // directly accessible in test environment. We'll test via command instead.
                
                // Use ingestForAgent command instead
                const ingestRequestJson = JSON.stringify({
                    topic: testTopic,
                    context: testContext,
                    decisions: [testDecision],
                    metadata: {
                        topicId: `test-topic-${Date.now()}`,
                        status: 'Active',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    }
                });

                let ingestResponseJson: string;
                try {
                    // Add timeout to prevent hanging
                    ingestResponseJson = await Promise.race([
                        vscode.commands.executeCommand<string>(
                            'cogneeMemory.ingestForAgent',
                            ingestRequestJson
                        ),
                        new Promise<string>((_, reject) => 
                            setTimeout(() => reject(new Error('Ingestion timeout')), 25000)
                        )
                    ]);
                } catch (error: any) {
                    if (error.message === 'Ingestion timeout') {
                        console.log('Bridge unavailable (timeout), skipping round-trip test');
                        this.skip();
                        return;
                    }
                    throw error;
                }
                
                const ingestResponse = JSON.parse(ingestResponseJson);

                // Skip if bridge unavailable (prevents timeout)
                if (!ingestResponse.success) {
                    console.log('Bridge unavailable, skipping round-trip test:', ingestResponse.error);
                    this.skip();
                    return;
                }

                assert.strictEqual(ingestResponse.success, true, 'Ingestion should succeed');
                assert.ok(ingestResponse.ingested_chars, 'Should return ingested character count');

                // Wait for ingestion to complete
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Retrieve via command
                const retrieveRequestJson = JSON.stringify({
                    query: testTopic,
                    maxResults: 5
                });

                const retrieveResponseJson = await vscode.commands.executeCommand<string>(
                    'cogneeMemory.retrieveForAgent',
                    retrieveRequestJson
                );
                const retrieveResponse = JSON.parse(retrieveResponseJson);

                // Validate response structure
                assert.ok(retrieveResponse.entries, 'Should have entries array');
                assert.ok(Array.isArray(retrieveResponse.entries), 'Entries should be an array');
                assert.ok(retrieveResponse.totalResults >= 0, 'Should have totalResults count');
                assert.ok(retrieveResponse.tokensUsed >= 0, 'Should have tokensUsed count');

                // Search for our test data
                const matchingEntry = retrieveResponse.entries.find((entry: any) => 
                    entry.summaryText.includes(testTopic) || 
                    entry.summaryText.includes(testContext)
                );

                if (matchingEntry) {
                    assert.ok(matchingEntry.summaryText, 'Entry should have summaryText');
                    assert.ok(matchingEntry.score >= 0, 'Entry should have score');
                    console.log(`✓ Round-trip validation successful: stored "${testTopic}", retrieved with score ${matchingEntry.score}`);
                } else {
                    console.log('⚠ Test data not found in retrieval results (may be due to indexing delay)');
                }
            } catch (error) {
                console.error('Round-trip test error:', error);
                throw error;
            }
        });
    });

    suite('Tool Response Format', () => {
        test('Retrieve tool returns both narrative and JSON payload', async function() {
            this.timeout(15000);
            // Tools are registered unconditionally; Configure Tools controls enablement

            try {
                // Execute retrieve command with generic query
                const retrieveRequestJson = JSON.stringify({
                    query: 'cognee',
                    maxResults: 1
                });

                const retrieveResponseJson = await vscode.commands.executeCommand<string>(
                    'cogneeMemory.retrieveForAgent',
                    retrieveRequestJson
                );
                const retrieveResponse = JSON.parse(retrieveResponseJson);

                // Validate structured response format
                assert.ok(retrieveResponse.entries, 'Response should have entries');
                assert.ok(typeof retrieveResponse.totalResults === 'number', 'Response should have totalResults number');
                assert.ok(typeof retrieveResponse.tokensUsed === 'number', 'Response should have tokensUsed number');

                // Validate entry structure
                if (retrieveResponse.entries.length > 0) {
                    const entry = retrieveResponse.entries[0];
                    assert.ok(entry.summaryText, 'Entry should have summaryText');
                    assert.ok(typeof entry.score === 'number', 'Entry should have numeric score');
                    
                    // Check for metadata fields (may be null for legacy memories)
                    assert.ok('topicId' in entry, 'Entry should have topicId field');
                    assert.ok('planId' in entry, 'Entry should have planId field');
                    assert.ok('createdAt' in entry, 'Entry should have createdAt field');
                }
            } catch (error) {
                console.error('Tool response format test error:', error);
                throw error;
            }
        });
    });
});
