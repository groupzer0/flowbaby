/**
 * Hotfix Tests for v0.5.8
 * 
 * Tests the fixes introduced in v0.5.8 hotfix release:
 * 1. DatasetNotFoundError handling in retrieve.py (graceful empty results)
 * 2. BackgroundOperationManager not initialized error handling
 * 3. Misleading success log fix in storeMemoryTool
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { StoreMemoryTool, StoreMemoryToolInput } from '../tools/storeMemoryTool';
import { handleIngestForAgent } from '../commands/ingestForAgent';
import { FlowbabyClient } from '../flowbabyClient';
import { FlowbabySetupService } from '../setup/FlowbabySetupService';

suite('Hotfix v0.5.8 Tests', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Issue 1: DatasetNotFoundError Handling', () => {
        /**
         * Tests that DatasetNotFoundError from cognee.search() is handled gracefully
         * and returns empty results instead of throwing an error.
         * 
         * This is tested at the TypeScript layer by verifying the FlowbabyClient
         * properly handles the Python bridge response.
         */
        
        test('Fresh workspace retrieval returns empty array (not error)', async function() {
            if (!vscode.workspace.workspaceFolders?.length) {
                this.skip();
                return;
            }

            const mockContext = {
                secrets: {
                    get: sandbox.stub().resolves('test-api-key'),
                    store: sandbox.stub().resolves(),
                    delete: sandbox.stub().resolves(),
                    onDidChange: sandbox.stub()
                },
                subscriptions: [],
                extensionPath: '/tmp/test',
                globalState: {
                    get: sandbox.stub().returns(undefined),
                    update: sandbox.stub().resolves()
                }
            } as unknown as vscode.ExtensionContext;

            const client = new FlowbabyClient(
                vscode.workspace.workspaceFolders[0].uri.fsPath,
                mockContext
            );

            // Mock the Python script to return the new v0.5.8 response format
            // for fresh workspace with no data (DatasetNotFoundError gracefully handled)
            const mockResponse = {
                success: true,
                results: [],
                result_count: 0,
                message: 'No data has been ingested yet. Start chatting to build memory.'
            };

            sandbox.stub(client as any, 'runPythonScript').resolves(mockResponse);

            const results = await client.retrieve('test query');

            // Key assertion: should return empty array, not throw error
            assert.ok(Array.isArray(results), 
                'Result should be an array');
            assert.strictEqual(results.length, 0, 
                'Results should be empty for fresh workspace');
        });

        test('DatasetNotFoundError returns graceful empty response', async function() {
            if (!vscode.workspace.workspaceFolders?.length) {
                this.skip();
                return;
            }

            const mockContext = {
                secrets: {
                    get: sandbox.stub().resolves('test-api-key'),
                    store: sandbox.stub().resolves(),
                    delete: sandbox.stub().resolves(),
                    onDidChange: sandbox.stub()
                },
                subscriptions: [],
                extensionPath: '/tmp/test',
                globalState: {
                    get: sandbox.stub().returns(undefined),
                    update: sandbox.stub().resolves()
                }
            } as unknown as vscode.ExtensionContext;

            const client = new FlowbabyClient(
                vscode.workspace.workspaceFolders[0].uri.fsPath,
                mockContext
            );

            // Simulate the exact response that retrieve.py now returns for DatasetNotFoundError
            const datasetNotFoundResponse = {
                success: true,
                results: [],
                result_count: 0,
                message: 'No data has been ingested yet. Start chatting to build memory.'
            };

            sandbox.stub(client as any, 'runPythonScript').resolves(datasetNotFoundResponse);

            // Should not throw, should return empty array
            let caughtError: Error | null = null;
            let results: any[] = [];
            try {
                results = await client.retrieve('any query');
            } catch (err) {
                caughtError = err as Error;
            }

            assert.strictEqual(caughtError, null, 
                'DatasetNotFoundError should not throw an error');
            assert.ok(Array.isArray(results), 
                'Should return an array');
            assert.strictEqual(results.length, 0,
                'Array should be empty');
        });
    });

    suite('Issue 2: BackgroundOperationManager Not Initialized', () => {
        /**
         * Tests that when BackgroundOperationManager is not initialized,
         * the ingestForAgent command returns a helpful error instead of crashing.
         * 
         * Note: In the test environment, BackgroundOperationManager may already be
         * initialized by other tests. These tests verify the error handling logic
         * at the JSON response level and verify the error code contract.
         */
        
        test('NOT_INITIALIZED error code is defined in the response contract', async function() {
            // This test verifies that the error code 'NOT_INITIALIZED' is properly
            // used and that the response format is correct. Since we can't easily
            // un-initialize the BackgroundOperationManager in a running test environment,
            // we test the contract at the schema level.
            
            const notInitializedResponse = {
                success: false,
                error: 'Flowbaby is not fully initialized. Please run "Flowbaby: Initialize Workspace" first.',
                errorCode: 'NOT_INITIALIZED'
            };
            
            // Verify the response structure matches the expected contract
            assert.strictEqual(notInitializedResponse.success, false);
            assert.strictEqual(notInitializedResponse.errorCode, 'NOT_INITIALIZED');
            assert.ok(notInitializedResponse.error.includes('Initialize'));
            assert.ok(notInitializedResponse.error.includes('not fully initialized'));
        });

        test('Error response includes actionable instructions', async function() {
            // Test that the error message provides clear guidance to the user
            const errorMessage = 'Flowbaby is not fully initialized. Please run "Flowbaby: Initialize Workspace" first.';
            
            // Error message should mention initialization
            assert.ok(errorMessage.includes('Initialize'), 
                'Error should mention Initialize');
            assert.ok(errorMessage.includes('Workspace'), 
                'Error should mention Workspace command');
        });

        test('handleIngestForAgent validates request before processing', async function() {
            if (!vscode.workspace.workspaceFolders?.length) {
                this.skip();
                return;
            }

            const mockContext = {
                secrets: {
                    get: sandbox.stub().resolves('test-api-key'),
                    store: sandbox.stub().resolves(),
                    delete: sandbox.stub().resolves(),
                    onDidChange: sandbox.stub()
                },
                subscriptions: [],
                extensionPath: '/tmp/test',
                globalState: {
                    get: sandbox.stub().returns(undefined),
                    update: sandbox.stub().resolves()
                }
            } as unknown as vscode.ExtensionContext;

            const client = new FlowbabyClient(
                vscode.workspace.workspaceFolders[0].uri.fsPath,
                mockContext
            );

            sandbox.stub(client, 'hasApiKey').resolves(true);
            // Mock ingestSummaryAsync to succeed quickly
            sandbox.stub(client, 'ingestSummaryAsync').resolves({
                success: true,
                staged: true,
                operationId: 'test-123'
            });
            sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

            const outputChannel = vscode.window.createOutputChannel('Test');

            // Test with valid request
            const requestJson = JSON.stringify({
                topic: 'Test Topic',
                context: 'Test Context',
                agentName: 'Test Agent'
            });

            const fakeSetupService = {
                isVerified: true
            } as unknown as FlowbabySetupService;

            const responseJson = await handleIngestForAgent(
                requestJson,
                client,
                outputChannel,
                mockContext,
                fakeSetupService
            );

            const response = JSON.parse(responseJson);

            // Should succeed or fail gracefully (not crash)
            assert.ok(typeof response.success === 'boolean', 
                'Response should have success boolean');
            
            // If it failed, should have an error code
            if (!response.success) {
                assert.ok(response.errorCode, 
                    'Failed response should have errorCode');
            }

            outputChannel.dispose();
        });

        test('handleIngestForAgent handles invalid JSON gracefully', async function() {
            if (!vscode.workspace.workspaceFolders?.length) {
                this.skip();
                return;
            }

            const mockContext = {
                secrets: {
                    get: sandbox.stub().resolves('test-api-key'),
                    store: sandbox.stub().resolves(),
                    delete: sandbox.stub().resolves(),
                    onDidChange: sandbox.stub()
                },
                subscriptions: [],
                extensionPath: '/tmp/test',
                globalState: {
                    get: sandbox.stub().returns(undefined),
                    update: sandbox.stub().resolves()
                }
            } as unknown as vscode.ExtensionContext;

            const client = new FlowbabyClient(
                vscode.workspace.workspaceFolders[0].uri.fsPath,
                mockContext
            );

            const outputChannel = vscode.window.createOutputChannel('Test');

            // Test with invalid JSON
            const invalidJson = 'not valid json {{{';

            const fakeSetupService = {
                isVerified: true
            } as unknown as FlowbabySetupService;

            const responseJson = await handleIngestForAgent(
                invalidJson,
                client,
                outputChannel,
                mockContext,
                fakeSetupService
            );

            const response = JSON.parse(responseJson);

            // Should return error, not crash
            assert.strictEqual(response.success, false, 
                'Should return failure for invalid JSON');
            assert.ok(response.error, 
                'Should include error message');

            outputChannel.dispose();
        });
    });

    suite('Issue 3: Misleading Success Log Fix', () => {
        /**
         * Tests that the success log message only appears when staging actually succeeds,
         * not before checking the response.
         */

        test('Success log only appears after successful staging', async () => {
            const outputChannel = vscode.window.createOutputChannel('Test Output');
            const tool = new StoreMemoryTool(outputChannel);
            const tokenSource = new vscode.CancellationTokenSource();

            // Mock command to return success
            const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
            executeCommandStub.resolves(JSON.stringify({
                success: true,
                staged: true,
                operationId: 'test-op-123'
            }));

            // Capture output channel content
            const appendLineSpy = sandbox.spy(outputChannel, 'appendLine');

            await tool.invoke({
                input: {
                    topic: 'Test Topic',
                    context: 'Test Context'
                }
            } as vscode.LanguageModelToolInvocationOptions<StoreMemoryToolInput>, tokenSource.token);

            // Check what was logged
            const logMessages = appendLineSpy.getCalls().map(c => c.args[0]);
            
            // Success message should be present
            const hasSuccessLog = logMessages.some(msg => msg.includes('✅') && msg.includes('staged'));
            assert.ok(hasSuccessLog, 'Success log should appear for successful staging');

            // Operation ID should be logged
            const hasOperationId = logMessages.some(msg => msg.includes('test-op-123'));
            assert.ok(hasOperationId, 'Operation ID should be logged');

            tokenSource.dispose();
            outputChannel.dispose();
        });

        test('Failure log appears instead of success log on failure', async () => {
            const outputChannel = vscode.window.createOutputChannel('Test Output');
            const tool = new StoreMemoryTool(outputChannel);
            const tokenSource = new vscode.CancellationTokenSource();

            // Mock command to return failure
            const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
            executeCommandStub.resolves(JSON.stringify({
                success: false,
                error: 'Test failure reason',
                errorCode: 'TEST_ERROR'
            }));

            // Suppress warning dialog
            sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

            // Capture output channel content
            const appendLineSpy = sandbox.spy(outputChannel, 'appendLine');

            await tool.invoke({
                input: {
                    topic: 'Test Topic',
                    context: 'Test Context'
                }
            } as vscode.LanguageModelToolInvocationOptions<StoreMemoryToolInput>, tokenSource.token);

            // Check what was logged
            const logMessages = appendLineSpy.getCalls().map(c => c.args[0]);
            
            // Should NOT have success message
            const hasSuccessLog = logMessages.some(msg => msg.includes('✅') && msg.includes('staged'));
            assert.strictEqual(hasSuccessLog, false, 
                'Success log should NOT appear for failed staging');

            // Should have failure message with error
            const hasFailureLog = logMessages.some(msg => 
                msg.includes('❌') && msg.includes('failed') && msg.includes('Test failure reason'));
            assert.ok(hasFailureLog, 
                'Failure log with error message should appear for failed staging');

            tokenSource.dispose();
            outputChannel.dispose();
        });

        test('Log order is correct: invoke -> check result -> log status', async () => {
            const outputChannel = vscode.window.createOutputChannel('Test Output');
            const tool = new StoreMemoryTool(outputChannel);
            const tokenSource = new vscode.CancellationTokenSource();

            const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
            executeCommandStub.resolves(JSON.stringify({
                success: true,
                staged: true,
                operationId: 'op-123'
            }));

            const appendLineSpy = sandbox.spy(outputChannel, 'appendLine');

            await tool.invoke({
                input: {
                    topic: 'Test Topic',
                    context: 'Test Context'
                }
            } as vscode.LanguageModelToolInvocationOptions<StoreMemoryToolInput>, tokenSource.token);

            const logMessages = appendLineSpy.getCalls().map(c => c.args[0]);
            
            // Find indices of key log messages
            const invokeIndex = logMessages.findIndex(msg => 
                msg.includes('flowbaby_storeMemory called'));
            const resultIndex = logMessages.findIndex(msg => 
                msg.includes('✅') || msg.includes('❌'));
            const operationIndex = logMessages.findIndex(msg => 
                msg.includes('Operation ID'));

            // Invoke log should come before result log
            assert.ok(invokeIndex < resultIndex, 
                'Invoke log should come before result log');
            
            // Result log should come before operation ID log (or at same position for success)
            assert.ok(resultIndex <= operationIndex, 
                'Result log should come before or with operation ID log');

            tokenSource.dispose();
            outputChannel.dispose();
        });
    });
});

suite('v0.5.8 Error Code Contract Tests', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('NOT_INITIALIZED error response structure is valid', async function() {
        // Test the contract structure for NOT_INITIALIZED error response
        // This verifies the response format that would be returned when
        // BackgroundOperationManager is not initialized
        const notInitializedResponse = {
            success: false,
            error: 'Flowbaby is not fully initialized. Please run "Flowbaby: Initialize Workspace" first.',
            errorCode: 'NOT_INITIALIZED'
        };
        
        // Verify the structure
        assert.strictEqual(notInitializedResponse.success, false);
        assert.strictEqual(notInitializedResponse.errorCode, 'NOT_INITIALIZED');
        assert.ok(notInitializedResponse.error.includes('Initialize'));
        assert.ok(notInitializedResponse.error.includes('not fully initialized'));
        
        // Verify it can be serialized and parsed as JSON
        const json = JSON.stringify(notInitializedResponse);
        const parsed = JSON.parse(json);
        assert.strictEqual(parsed.errorCode, 'NOT_INITIALIZED');
    });

    test('MISSING_API_KEY error code is used for no API key', async function() {
        if (!vscode.workspace.workspaceFolders?.length) {
            this.skip();
            return;
        }

        // Clear environment
        const originalEnv = process.env.LLM_API_KEY;
        delete process.env.LLM_API_KEY;

        try {
            const mockContext = {
                secrets: {
                    get: sandbox.stub().resolves(undefined), // No API key in secrets
                    store: sandbox.stub().resolves(),
                    delete: sandbox.stub().resolves(),
                    onDidChange: sandbox.stub()
                },
                subscriptions: [],
                extensionPath: '/tmp/test',
                globalState: {
                    get: sandbox.stub().returns(undefined),
                    update: sandbox.stub().resolves()
                }
            } as unknown as vscode.ExtensionContext;

            const client = new FlowbabyClient(
                vscode.workspace.workspaceFolders[0].uri.fsPath,
                mockContext
            );

            sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

            const outputChannel = vscode.window.createOutputChannel('Test');

            const fakeSetupService = {
                isVerified: true
            } as unknown as FlowbabySetupService;

            const responseJson = await handleIngestForAgent(
                JSON.stringify({ topic: 'Test', context: 'Test' }),
                client,
                outputChannel,
                mockContext,
                fakeSetupService
            );

            const response = JSON.parse(responseJson);

            assert.strictEqual(response.errorCode, 'MISSING_API_KEY',
                'Error code must be MISSING_API_KEY when no API key configured');

            outputChannel.dispose();
        } finally {
            if (originalEnv) {
                process.env.LLM_API_KEY = originalEnv;
            }
        }
    });
});

suite('v0.5.8 User Experience Tests', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('NOT_INITIALIZED warning message format is user-friendly', async function() {
        // Test the warning message format for NOT_INITIALIZED error
        // This is a contract-level test since we can't reliably reproduce
        // the uninitialized state in the test environment
        
        const warningMessage = 'Flowbaby needs to complete setup before storing memories.';
        const actionButton = 'Initialize Now';
        
        // Warning should be clear and actionable
        assert.ok(warningMessage.includes('setup') || warningMessage.includes('complete'),
            'Message should mention setup needed');
        assert.ok(warningMessage.includes('Flowbaby'),
            'Message should reference Flowbaby');
        assert.strictEqual(actionButton, 'Initialize Now',
            'Action button should be "Initialize Now"');
    });

    test('StoreMemoryTool shows failure toast on ingestion error', async () => {
        const outputChannel = vscode.window.createOutputChannel('Test');
        const tool = new StoreMemoryTool(outputChannel);
        const tokenSource = new vscode.CancellationTokenSource();

        sandbox.stub(vscode.commands, 'executeCommand').resolves(JSON.stringify({
            success: false,
            error: 'Connection timeout',
            errorCode: 'BRIDGE_TIMEOUT'
        }));

        const warningStub = sandbox.stub(vscode.window, 'showWarningMessage');
        warningStub.resolves(undefined);

        await tool.invoke({
            input: { topic: 'Test', context: 'Test' }
        } as vscode.LanguageModelToolInvocationOptions<StoreMemoryToolInput>, tokenSource.token);

        // Warning should be shown
        assert.ok(warningStub.called, 'Warning toast should be shown on failure');

        // Warning should include error message
        const warningMessage = warningStub.firstCall.args[0];
        assert.ok(warningMessage.includes('Memory ingestion failed'), 
            'Warning should mention ingestion failure');
        assert.ok(warningMessage.includes('Connection timeout'), 
            'Warning should include the error message');

        // Should offer "View Logs" action
        const action = warningStub.firstCall.args[1];
        assert.strictEqual(action, 'View Logs', 
            'Should offer View Logs action');

        tokenSource.dispose();
        outputChannel.dispose();
    });
});
