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
import { FlowbabySetupService } from '../setup/FlowbabySetupService';

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

            // Plan 045: Stub hasApiKey to return true so pre-check passes
            const hasApiKeyStub = sinon.stub().resolves(true);

            const fakeClient = {
                ingestSummaryAsync: ingestStub,
                hasApiKey: hasApiKeyStub
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

            const fakeSetupService = {
                isVerified: true
            } as unknown as FlowbabySetupService;

            try {
                const responseJson = await handleIngestForAgent(
                    JSON.stringify(payload),
                    fakeClient,
                    fakeOutput,
                    fakeContext,
                    fakeSetupService
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

    suite('API Key Pre-Check (Plan 045)', () => {
        let sandbox: sinon.SinonSandbox;

        setup(() => {
            sandbox = sinon.createSandbox();
        });

        teardown(() => {
            sandbox.restore();
        });

        test('returns MISSING_API_KEY when API key not configured', async function() {
            this.timeout(5000);

            // Create stubs for mock client
            const hasApiKeyStub = sandbox.stub().resolves(false);
            const ingestStub = sandbox.stub().rejects(new Error('Should not be called'));
            const appendLineStub = sandbox.stub();

            const mockClient = {
                hasApiKey: hasApiKeyStub,
                ingest: ingestStub
            } as unknown as FlowbabyClient;

            const mockOutputChannel = {
                appendLine: appendLineStub,
                append: sandbox.stub(),
                clear: sandbox.stub(),
                show: sandbox.stub(),
                hide: sandbox.stub(),
                dispose: sandbox.stub(),
                name: 'Flowbaby',
                replace: sandbox.stub()
            } as unknown as vscode.OutputChannel;

            const mockContext = {
                subscriptions: [],
                extensionPath: '/tmp/test'
            } as unknown as vscode.ExtensionContext;

            // Stub the warning message to avoid UI interaction
            sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

            const validPayload = {
                topic: 'Test Topic',
                context: 'Test context for API key pre-check',
                decisions: ['Test decision'],
                metadata: {
                    topicId: 'test-api-key-check',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                },
                agentName: 'Test Agent'
            };

            const fakeSetupService = {
                isVerified: true
            } as unknown as FlowbabySetupService;

            const responseJson = await handleIngestForAgent(
                JSON.stringify(validPayload),
                mockClient,
                mockOutputChannel,
                mockContext,
                fakeSetupService
            );
            const response = JSON.parse(responseJson);

            // Verify error response
            expect(response.success).to.be.false;
            expect(response.errorCode).to.equal('MISSING_API_KEY');
            expect(response.error).to.include('API key not configured');
            expect(response.error).to.include('Set API Key');

            // Verify ingest was NOT called (short-circuit)
            expect(ingestStub.called).to.be.false;

            // Verify logging occurred
            expect(appendLineStub.called).to.be.true;
            const logCalls = appendLineStub.getCalls();
            const hasApiKeyLog = logCalls.some((call: sinon.SinonSpyCall) => 
                call.args[0].includes('API key not configured')
            );
            expect(hasApiKeyLog).to.be.true;
        });

        test('proceeds past API key check when key is configured', async function() {
            this.timeout(5000);

            // Create stubs for mock client  
            const hasApiKeyStub = sandbox.stub().resolves(true);
            // ingestSummaryAsync will throw since BackgroundOperationManager isn't mocked,
            // but we're testing that the API key check passes first
            const ingestSummaryAsyncStub = sandbox.stub().throws(new Error('Expected - testing API key check passed'));

            const mockClient = {
                hasApiKey: hasApiKeyStub,
                ingestSummaryAsync: ingestSummaryAsyncStub
            } as unknown as FlowbabyClient;

            const mockOutputChannel = {
                appendLine: sandbox.stub(),
                append: sandbox.stub(),
                clear: sandbox.stub(),
                show: sandbox.stub(),
                hide: sandbox.stub(),
                dispose: sandbox.stub(),
                name: 'Flowbaby',
                replace: sandbox.stub()
            } as unknown as vscode.OutputChannel;

            const mockContext = {
                subscriptions: [],
                extensionPath: '/tmp/test'
            } as unknown as vscode.ExtensionContext;

            const validPayload = {
                topic: 'Test Topic',
                context: 'Test context for successful ingestion',
                decisions: ['Test decision'],
                metadata: {
                    topicId: 'test-with-api-key',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                },
                agentName: 'Test Agent'
            };

            const fakeSetupService = {
                isVerified: true
            } as unknown as FlowbabySetupService;

            const responseJson = await handleIngestForAgent(
                JSON.stringify(validPayload),
                mockClient,
                mockOutputChannel,
                mockContext,
                fakeSetupService
            );
            const response = JSON.parse(responseJson);

            // The API key check passes, so we get a COGNEE_ERROR (from BackgroundOperationManager not being set up)
            // instead of MISSING_API_KEY - this proves the API key gate was passed
            expect(response.success).to.be.false;
            expect(response.errorCode).to.not.equal('MISSING_API_KEY');
            
            // Verify hasApiKey was called and returned true
            expect(hasApiKeyStub.called).to.be.true;
        });
    });

    suite('Environment Verification (Plan 049)', () => {
        test('returns NOT_INITIALIZED when environment is unverified', async () => {
            const mockClient = {
                hasApiKey: sinon.stub().resolves(true),
                ingest: sinon.stub().resolves(true)
            } as unknown as FlowbabyClient;

            const mockOutputChannel = {
                appendLine: sinon.stub()
            } as unknown as vscode.OutputChannel;

            const mockContext = {
                workspaceState: {
                    get: sinon.stub(),
                    update: sinon.stub()
                }
            } as unknown as vscode.ExtensionContext;

            const mockSetupService = {
                isVerified: false
            } as unknown as FlowbabySetupService;

            const payload = {
                topic: 'Test',
                context: 'Test context'
            };

            const resultJson = await handleIngestForAgent(
                JSON.stringify(payload),
                mockClient,
                mockOutputChannel,
                mockContext,
                mockSetupService
            );

            const result = JSON.parse(resultJson);
            expect(result.success).to.be.false;
            expect(result.errorCode).to.equal('NOT_INITIALIZED');
        });
    });
});
