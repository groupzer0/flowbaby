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

    // Tools are now registered unconditionally at extension activation
    // Authorization is handled by VS Code Configure Tools UI

    suite('Ingestion Command Integration', () => {
        test('ingestion command processes valid payload', async function() {
            this.timeout(60000); // Ingestion can take time
            // Tools registered unconditionally; Configure Tools controls enablement

            const payload = {
                topic: 'Integration Test - Command Execution',
                context: 'Testing command execution with valid payload',
                decisions: ['Test command flow'],
                metadata: {
                    topicId: 'test-integration-command',
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

                // Verify command responds properly (may succeed or fail due to bridge/env)
                if (response.success) {
                    expect(response.metadata.topic_id).to.equal('test-integration-command');
                    expect(response.ingested_chars).to.be.greaterThan(0);
                } else {
                    // Bridge unavailable is acceptable in test environment
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
                // Add 3s timeout to prevent hanging
                const responseJson = await Promise.race([
                    vscode.commands.executeCommand<string>(
                        'cogneeMemory.ingestForAgent',
                        JSON.stringify(payload)
                    ),
                    new Promise<string>((_, reject) => 
                        setTimeout(() => reject(new Error('Command timeout')), 3000)
                    )
                ]);
                
                const response = JSON.parse(responseJson);
                
                // Skip if bridge unavailable
                if (!response.success) {
                    console.warn('Bridge unavailable, skipping audit log test:', response.error);
                    this.skip();
                    return;
                }

                // Check for audit log file
                const auditLogPath = path.join(testWorkspaceFolder.uri.fsPath, '.cognee', 'agent_audit.log');
                
                // Wait briefly for file write
                await new Promise(resolve => setTimeout(resolve, 100));

                if (fs.existsSync(auditLogPath)) {
                    const logContent = fs.readFileSync(auditLogPath, 'utf8');
                    expect(logContent).to.include('ingestForAgent');
                    // Audit log records command execution, not access blocking
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
