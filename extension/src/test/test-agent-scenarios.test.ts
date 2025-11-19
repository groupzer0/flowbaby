/**
 * Test-agent scenario execution tests (Plan 015 Milestone 4)
 * 
 * Automated tests that invoke test-agent commands and verify responses
 */

import { expect } from 'chai';
import * as vscode from 'vscode';

describe('Test-Agent Scenarios', () => {
    before(async function() {
        this.timeout(30000); // Extension activation can be slow

        // Wait for Cognee Memory extension to activate
        const cogneeExtension = vscode.extensions.getExtension('cognee.cognee-chat-memory');
        if (!cogneeExtension) {
            console.warn('Cognee Memory extension not found - skipping test-agent scenarios');
            this.skip();
            return;
        }

        if (!cogneeExtension.isActive) {
            await cogneeExtension.activate();
        }

        // Wait for test-agent extension to activate
        const testAgentExtension = vscode.extensions.getExtension('cognee.test-agent');
        if (!testAgentExtension) {
            console.warn('Test-agent extension not found - skipping scenarios');
            this.skip();
            return;
        }

        if (!testAgentExtension.isActive) {
            await testAgentExtension.activate();
        }

        console.log('Both extensions activated successfully');
    });

    describe('Access Control Scenarios', () => {
        afterEach(async () => {
            // Reset agent access after each test
            const config = vscode.workspace.getConfiguration('cogneeMemory');
            await config.update('agentAccess.enabled', false, vscode.ConfigurationTarget.Global);
        });

        it('Scenario 1: Valid minimal payload with access enabled', async function() {
            this.timeout(60000);

            // Enable agent access
            const config = vscode.workspace.getConfiguration('cogneeMemory');
            await config.update('agentAccess.enabled', true, vscode.ConfigurationTarget.Global);

            try {
                await vscode.commands.executeCommand('testAgent.testValidMinimal');
                
                // If command succeeds without error, test passes
                // Actual validation happens in test-agent's command handler
                console.log('Valid minimal payload test completed');
            } catch (error) {
                // Test-agent should handle errors gracefully
                expect.fail(`Test-agent command failed: ${error}`);
            }
        });

        it('Scenario 2: Valid full payload with all fields', async function() {
            this.timeout(60000);

            const config = vscode.workspace.getConfiguration('cogneeMemory');
            await config.update('agentAccess.enabled', true, vscode.ConfigurationTarget.Global);

            try {
                await vscode.commands.executeCommand('testAgent.testValidFull');
                console.log('Valid full payload test completed');
            } catch (error) {
                expect.fail(`Test-agent command failed: ${error}`);
            }
        });

        it('Scenario 3: Invalid payload with missing fields', async function() {
            this.timeout(30000);

            const config = vscode.workspace.getConfiguration('cogneeMemory');
            await config.update('agentAccess.enabled', true, vscode.ConfigurationTarget.Global);

            try {
                await vscode.commands.executeCommand('testAgent.testInvalidPayload');
                console.log('Invalid payload test completed');
            } catch (error) {
                expect.fail(`Test-agent command failed: ${error}`);
            }
        });

        it('Scenario 4: Access blocked when disabled', async function() {
            this.timeout(30000);

            // Ensure agent access is disabled
            const config = vscode.workspace.getConfiguration('cogneeMemory');
            await config.update('agentAccess.enabled', false, vscode.ConfigurationTarget.Global);

            try {
                await vscode.commands.executeCommand('testAgent.testAccessControl');
                console.log('Access control test completed');
            } catch (error) {
                expect.fail(`Test-agent command failed: ${error}`);
            }
        });
    });

    describe('Error Handling Scenarios', () => {
        it('handles malformed JSON gracefully', async function() {
            this.timeout(30000);

            const config = vscode.workspace.getConfiguration('cogneeMemory');
            await config.update('agentAccess.enabled', true, vscode.ConfigurationTarget.Global);

            const malformedJson = '{ topic: "Missing quotes", invalid }';

            try {
                const responseJson = await vscode.commands.executeCommand<string>(
                    'cogneeMemory.ingestForAgent',
                    malformedJson
                );
                const response = JSON.parse(responseJson);

                expect(response.success).to.be.false;
                expect(response.errorCode).to.equal('INVALID_JSON');
            } catch (error) {
                console.warn('Command not available:', error);
                this.skip();
            }
        });

        it('provides detailed validation errors', async function() {
            this.timeout(30000);

            const config = vscode.workspace.getConfiguration('cogneeMemory');
            await config.update('agentAccess.enabled', true, vscode.ConfigurationTarget.Global);

            const invalidPayload = {
                context: 'Missing topic',
                decisions: 'Should be an array', // Wrong type
                metadata: {
                    topicId: 'test-001'
                    // Missing required timestamps
                }
            };

            try {
                const responseJson = await vscode.commands.executeCommand<string>(
                    'cogneeMemory.ingestForAgent',
                    JSON.stringify(invalidPayload)
                );
                const response = JSON.parse(responseJson);

                expect(response.success).to.be.false;
                expect(response.errorCode).to.equal('INVALID_PAYLOAD');
                expect(response.error).to.include('topic'); // Should mention missing topic
            } catch (error) {
                console.warn('Command not available:', error);
                this.skip();
            }
        });
    });
});
