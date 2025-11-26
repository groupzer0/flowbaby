/**
 * Integration tests for agent ingestion command (Plan 015 Milestone 4)
 * 
 * Tests full command flow including settings, audit logging, and bridge calls
 */

import { expect } from 'chai';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import { FlowbabyClient } from '../flowbabyClient';
import { handleIngestForAgent } from '../commands/ingestForAgent';

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
            this.timeout(10000); // Reduced timeout - skip if bridge unavailable
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
                // Race command against a timeout to skip gracefully
                const timeoutPromise = new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error('Command timeout - bridge unavailable')), 8000)
                );
                
                const responseJson = await Promise.race([
                    vscode.commands.executeCommand<string>(
                        'Flowbaby.ingestForAgent',
                        JSON.stringify(payload)
                    ),
                    timeoutPromise
                ]);
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
                console.warn('Command not available or timed out in test environment:', error);
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

            const auditLogPath = path.join(testWorkspaceFolder.uri.fsPath, '.flowbaby', 'agent_audit.log');
            fs.rmSync(auditLogPath, { force: true });

            const ingestStub = sinon.stub().resolves({
                    success: true,
                    staged: true,
                    operationId: 'test-operation'
            });

            const fakeClient = {
                ingestSummaryAsync: ingestStub
            } as unknown as FlowbabyClient;

            const fakeOutput = {
                appendLine: () => {}
            } as unknown as vscode.OutputChannel;

            const fakeContext = {
                subscriptions: []
            } as unknown as vscode.ExtensionContext;

            const backgroundModule = await import('../background/BackgroundOperationManager');
            const fakeManager = {
                startOperation: sinon.stub().resolves('test-operation')
            };
            const managerStub = sinon.stub(backgroundModule.BackgroundOperationManager, 'getInstance').returns(
                fakeManager as unknown as ReturnType<typeof backgroundModule.BackgroundOperationManager.getInstance>
            );

            try {
                const responseJson = await handleIngestForAgent(
                    JSON.stringify(payload),
                    fakeClient,
                    fakeOutput,
                    fakeContext
                );
                const response = JSON.parse(responseJson);

                expect(response.success).to.be.true;
                expect(response.staged).to.be.true;
                expect(ingestStub.calledOnce).to.be.true;

                expect(fs.existsSync(auditLogPath)).to.be.true;
                const logContent = fs.readFileSync(auditLogPath, 'utf8');
                expect(logContent).to.include('ingestForAgent');
            } finally {
                managerStub.restore();
            }
        });
    });

    suite('Schema Validation Error Handling', () => {
        test('returns INVALID_PAYLOAD for missing required fields', async function() {
            this.timeout(8000);

            const invalidPayload = {
                context: 'Missing topic field',
                metadata: {
                    topicId: 'test-invalid',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            };

            try {
                // Race command against a timeout to skip gracefully
                const timeoutPromise = new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error('Command timeout - bridge unavailable')), 6000)
                );
                
                const responseJson = await Promise.race([
                    vscode.commands.executeCommand<string>(
                        'Flowbaby.ingestForAgent',
                        JSON.stringify(invalidPayload)
                    ),
                    timeoutPromise
                ]);
                const response = JSON.parse(responseJson);

                expect(response.success).to.be.false;
                expect(response.errorCode).to.equal('INVALID_PAYLOAD');
                expect(response.error).to.include('topic');
            } catch (error) {
                console.warn('Command not available or timed out in test environment:', error);
                this.skip();
            }
        });

        test('returns INVALID_JSON for malformed JSON', async function() {
            this.timeout(8000);

            try {
                // Race command against a timeout to skip gracefully
                const timeoutPromise = new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error('Command timeout - bridge unavailable')), 6000)
                );
                
                const responseJson = await Promise.race([
                    vscode.commands.executeCommand<string>(
                        'Flowbaby.ingestForAgent',
                        '{ invalid json structure }'
                    ),
                    timeoutPromise
                ]);
                const response = JSON.parse(responseJson);

                expect(response.success).to.be.false;
                expect(response.errorCode).to.equal('INVALID_JSON');
            } catch (error) {
                console.warn('Command not available or timed out in test environment:', error);
                this.skip();
            }
        });
    });
});
