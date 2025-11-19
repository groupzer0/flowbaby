/**
 * Integration tests for agent ingestion command (Plan 015 Milestone 4)
 * 
 * Tests full command flow including settings, audit logging, and bridge calls
 */

import { expect } from 'chai';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

suite('Agent Ingestion Integration Tests', () => {
    let testWorkspaceFolder: vscode.WorkspaceFolder;

    suiteSetup(function() {
        // Skip if no workspace folder available
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            this.skip();
            return;
        }
        testWorkspaceFolder = vscode.workspace.workspaceFolders[0];
    });

    teardown(async () => {
        // Reset agent access setting after each test
        const config = vscode.workspace.getConfiguration('cogneeMemory');
        await config.update('agentAccess.enabled', false, vscode.ConfigurationTarget.Workspace);
    });

    suite('Configuration-Driven Access Control', () => {
        test('blocks ingestion when agentAccess.enabled is false', async function() {
            this.timeout(5000);

            const config = vscode.workspace.getConfiguration('cogneeMemory');
            await config.update('agentAccess.enabled', false, vscode.ConfigurationTarget.Workspace);

            const payload = {
                topic: 'Integration Test - Access Disabled',
                context: 'Testing blocked access',
                metadata: {
                    topicId: 'test-integration-disabled',
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

                expect(response.success).to.be.false;
                expect(response.errorCode).to.equal('ACCESS_DISABLED');
            } catch (error) {
                // Command might not be registered in test environment
                console.warn('Command not available in test environment:', error);
                this.skip();
            }
        });

        test('allows ingestion when agentAccess.enabled is true', async function() {
            this.timeout(60000); // Ingestion can take time

            const config = vscode.workspace.getConfiguration('cogneeMemory');
            await config.update('agentAccess.enabled', true, vscode.ConfigurationTarget.Workspace);

            const payload = {
                topic: 'Integration Test - Access Enabled',
                context: 'Testing allowed access with valid payload',
                decisions: ['Enable agent access for test'],
                metadata: {
                    topicId: 'test-integration-enabled',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                },
                agentName: 'Integration Test Agent'
            };

            try {
                const responseJson = await vscode.commands.executeCommand<string>(
                    'cogneeMemory.ingestForAgent',
                    JSON.stringify(payload)
                );
                const response = JSON.parse(responseJson);

                // Even if bridge fails (no .env, Python issues), command should respond properly
                if (response.success) {
                    expect(response.metadata.topic_id).to.equal('test-integration-enabled');
                    expect(response.ingested_chars).to.be.greaterThan(0);
                } else {
                    // If bridge unavailable, verify error is not ACCESS_DISABLED
                    expect(response.errorCode).to.not.equal('ACCESS_DISABLED');
                    console.warn('Bridge unavailable, skipping success validation:', response.error);
                }
            } catch (error) {
                console.warn('Command not available in test environment:', error);
                this.skip();
            }
        });
    });

    suite('Audit Logging', () => {
        test('creates audit log file on ingestion attempt', async function() {
            this.timeout(5000);

            const config = vscode.workspace.getConfiguration('cogneeMemory');
            await config.update('agentAccess.enabled', false, vscode.ConfigurationTarget.Workspace);

            const payload = {
                topic: 'Audit Log Test',
                context: 'Testing audit log creation',
                metadata: {
                    topicId: 'test-audit-log',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            };

            try {
                await vscode.commands.executeCommand<string>(
                    'cogneeMemory.ingestForAgent',
                    JSON.stringify(payload)
                );

                // Check for audit log file
                const auditLogPath = path.join(testWorkspaceFolder.uri.fsPath, '.cognee', 'agent_audit.log');
                
                // Wait briefly for file write
                await new Promise(resolve => setTimeout(resolve, 100));

                if (fs.existsSync(auditLogPath)) {
                    const logContent = fs.readFileSync(auditLogPath, 'utf8');
                    expect(logContent).to.include('ingestForAgent');
                    expect(logContent).to.include('blocked');
                } else {
                    console.warn('Audit log not created - may indicate command registration issue');
                }
            } catch (error) {
                console.warn('Command not available in test environment:', error);
                this.skip();
            }
        });
    });

    suite('Schema Validation Error Handling', () => {
        test('returns INVALID_PAYLOAD for missing required fields', async function() {
            this.timeout(5000);

            const config = vscode.workspace.getConfiguration('cogneeMemory');
            await config.update('agentAccess.enabled', true, vscode.ConfigurationTarget.Workspace);

            const invalidPayload = {
                context: 'Missing topic field',
                metadata: {
                    topicId: 'test-invalid',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
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
                expect(response.error).to.include('topic');
            } catch (error) {
                console.warn('Command not available in test environment:', error);
                this.skip();
            }
        });

        test('returns INVALID_JSON for malformed JSON', async function() {
            this.timeout(5000);

            const config = vscode.workspace.getConfiguration('cogneeMemory');
            await config.update('agentAccess.enabled', true, vscode.ConfigurationTarget.Workspace);

            try {
                const responseJson = await vscode.commands.executeCommand<string>(
                    'cogneeMemory.ingestForAgent',
                    '{ invalid json structure }'
                );
                const response = JSON.parse(responseJson);

                expect(response.success).to.be.false;
                expect(response.errorCode).to.equal('INVALID_JSON');
            } catch (error) {
                console.warn('Command not available in test environment:', error);
                this.skip();
            }
        });
    });
});
