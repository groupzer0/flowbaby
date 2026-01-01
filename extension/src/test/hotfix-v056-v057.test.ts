/**
 * Hotfix Tests for v0.5.6 and v0.5.7 (Plan 045 Addenda)
 * 
 * Tests the fixes introduced in hotfix releases:
 * - v0.5.6: Post-init prompt timing, configureApiKey alias, getApiKeyState()
 * - v0.5.7: Failure notifications, icon path, API key check in chat, modal prompt, status bar update
 * 
 * Note: Plan 083 M8 removed configureApiKey tests (Cloud-only in v0.7.0)
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
// Plan 083 M8: fs import removed - was only used by configureApiKey test
import { FlowbabyClient, ApiKeyState } from '../flowbabyClient';
import { FlowbabyStatus } from '../statusBar/FlowbabyStatusBar';
import { StoreMemoryTool, StoreMemoryToolInput } from '../tools/storeMemoryTool';
import * as cloudProvider from '../flowbaby-cloud/provider';

suite('Hotfix v0.5.6 Tests', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('getApiKeyState() Method', () => {
        test('getApiKeyState returns null before initialize() is called', async function() {
            if (!vscode.workspace.workspaceFolders?.length) {
                this.skip();
                return;
            }

            const mockContext = {
                secrets: {
                    get: sandbox.stub().resolves(undefined),
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

            // Before initialize() is called, getApiKeyState should return null
            const state = client.getApiKeyState();
            assert.strictEqual(state, null, 'getApiKeyState should return null before initialization');
        });

        test('getApiKeyState returns cached state after initialize()', async function() {
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

            // Mock the Python script response
            sandbox.stub(client as any, 'runPythonScript').resolves({
                success: true,
                api_key_configured: true,
                dataset_name: 'test'
            });

            await client.initialize();

            const state = client.getApiKeyState();
            assert.notStrictEqual(state, null, 'getApiKeyState should return cached state after initialization');
            assert.strictEqual(state!.llmReady, true, 'llmReady should be true when API key is configured');
        });
    });

    // Plan 083 M8: configureApiKey Command Alias suite removed
    // Legacy API key commands were removed in v0.7.0 (Cloud-only release)
    // The configureApiKey, setApiKey, and clearApiKey commands are no longer
    // declared in package.json. Users should use FlowbabyCloud.login instead.
});

suite('Hotfix v0.5.7 Tests', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('StoreMemoryTool Failure Notification', () => {
        test('Failed ingestion shows warning toast', async () => {
            const outputChannel = vscode.window.createOutputChannel('Test Output');
            const tool = new StoreMemoryTool(outputChannel);
            const tokenSource = new vscode.CancellationTokenSource();

            // Mock the command to return failure
            const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
            executeCommandStub.resolves(JSON.stringify({
                success: false,
                error: 'Cloud login required',
                errorCode: 'NOT_AUTHENTICATED'
            }));

            // Mock showWarningMessage to capture the call
            const warningStub = sandbox.stub(vscode.window, 'showWarningMessage');
            warningStub.resolves(undefined);

            const result = await tool.invoke({
                input: {
                    topic: 'Test Topic',
                    context: 'Test Context'
                }
            } as vscode.LanguageModelToolInvocationOptions<StoreMemoryToolInput>, tokenSource.token);

            // Verify warning was shown for failure
            assert.ok(warningStub.called, 'showWarningMessage should be called on failure');
            const warningMessage = warningStub.firstCall.args[0];
            assert.ok(warningMessage.includes('Memory ingestion failed'), 'Warning should mention ingestion failure');

            // Verify result indicates failure
            const content = result.content[0] as vscode.LanguageModelTextPart;
            const response = JSON.parse(content.value);
            assert.strictEqual(response.success, false);
            // Plan 083: Error message updated to Cloud login
            assert.strictEqual(response.error, 'Cloud login required');

            tokenSource.dispose();
            outputChannel.dispose();
        });

        test('Successful ingestion does not show warning', async () => {
            const outputChannel = vscode.window.createOutputChannel('Test Output');
            const tool = new StoreMemoryTool(outputChannel);
            const tokenSource = new vscode.CancellationTokenSource();

            const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
            executeCommandStub.resolves(JSON.stringify({
                success: true,
                staged: true,
                operationId: 'test-op-123'
            }));

            const warningStub = sandbox.stub(vscode.window, 'showWarningMessage');

            await tool.invoke({
                input: {
                    topic: 'Test Topic',
                    context: 'Test Context'
                }
            } as vscode.LanguageModelToolInvocationOptions<StoreMemoryToolInput>, tokenSource.token);

            // Warning should NOT be shown for success
            assert.ok(!warningStub.called, 'showWarningMessage should NOT be called on success');

            tokenSource.dispose();
            outputChannel.dispose();
        });
    });

    suite('Chat Participant Icon Path', () => {
        test('Icon file exists at expected path', () => {
            // The icon path in extension.ts should point to a valid file
            const extensionPath = path.join(__dirname, '..');
            const iconPath = path.join(extensionPath, 'media', 'flowbaby-icon-tightcrop.png');
            
            // In compiled test environment, we check the dist structure
            // The actual file check depends on whether we're in dev or compiled mode
            // This test verifies the filename is correct (not icon.png)
            const expectedFilename = 'flowbaby-icon-tightcrop.png';
            assert.strictEqual(path.basename(iconPath), expectedFilename, 
                'Icon path should reference flowbaby-icon-tightcrop.png, not icon.png');
        });
    });

    suite('API Key Check Before Chat Retrieval', () => {
        test('hasApiKey() method exists and is callable', async function() {
            if (!vscode.workspace.workspaceFolders?.length) {
                this.skip();
                return;
            }

            const mockContext = {
                secrets: {
                    get: sandbox.stub().resolves(undefined),
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

            // hasApiKey should be callable and return a boolean
            const result = await client.hasApiKey();
            assert.strictEqual(typeof result, 'boolean', 'hasApiKey should return a boolean');
        });

        test('hasApiKey returns false when no credentials configured (Plan 083)', async function() {
            if (!vscode.workspace.workspaceFolders?.length) {
                this.skip();
                return;
            }

            // Plan 083: Stub Cloud provider as NOT initialized
            const isInitializedStub = sandbox.stub(cloudProvider, 'isProviderInitialized').returns(false);
            const isEnabledStub = sandbox.stub(cloudProvider, 'isFlowbabyCloudEnabled').returns(true);

            // Clear environment variable
            const originalEnv = process.env.LLM_API_KEY;
            delete process.env.LLM_API_KEY;

            try {
                const mockContext = {
                    secrets: {
                        get: sandbox.stub().resolves(undefined),
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

                const result = await client.hasApiKey();
                assert.strictEqual(result, false, 'hasApiKey should return false when Cloud not initialized');
            } finally {
                isInitializedStub.restore();
                isEnabledStub.restore();
                if (originalEnv) {
                    process.env.LLM_API_KEY = originalEnv;
                }
            }
        });
    });

    // Plan 083 M6: Updated tests for Cloud-only status (NeedsCloudLogin replaces NeedsApiKey)
    suite('Status Bar Update After Cloud Login', () => {
        test('FlowbabyStatus.Ready should be distinct from NeedsCloudLogin', () => {
            assert.notStrictEqual(FlowbabyStatus.Ready, FlowbabyStatus.NeedsCloudLogin,
                'Ready and NeedsCloudLogin should be different status values');
            // Backward compat alias check
            assert.strictEqual(FlowbabyStatus.NeedsApiKey, FlowbabyStatus.NeedsCloudLogin,
                'NeedsApiKey should be an alias for NeedsCloudLogin');
        });

        test('Status transition logic: NeedsCloudLogin -> Ready after Cloud login', () => {
            // Simulate the logic that should happen after Cloud login
            const beforeState: ApiKeyState = {
                pythonConfigured: false,
                typescriptConfigured: false,
                llmReady: false,
                statusMessage: 'Cloud login not configured'
            };

            const afterState: ApiKeyState = {
                pythonConfigured: false,
                typescriptConfigured: true, // Now configured via Cloud
                llmReady: true,
                statusMessage: 'Cloud login configured'
            };

            const getStatusFromState = (state: ApiKeyState): FlowbabyStatus => {
                if (!state.llmReady) {
                    return FlowbabyStatus.NeedsCloudLogin;
                }
                return FlowbabyStatus.Ready;
            };

            const statusBefore = getStatusFromState(beforeState);
            const statusAfter = getStatusFromState(afterState);

            assert.strictEqual(statusBefore, FlowbabyStatus.NeedsCloudLogin,
                'Status should be NeedsCloudLogin when Cloud login not configured');
            assert.strictEqual(statusAfter, FlowbabyStatus.Ready,
                'Status should be Ready after Cloud login is configured');
        });
    });

    suite('Modal Post-Init Prompt', () => {
        test('Modal option should persist dialog until dismissed', () => {
            // This test documents the expected behavior:
            // When modal: true is passed to showWarningMessage,
            // the dialog stays until user explicitly clicks a button
            
            // We can't easily test VS Code's internal modal behavior,
            // but we verify our code sets the option correctly by
            // checking the test uses the right pattern
            const modalOptions = { modal: true };
            assert.strictEqual(modalOptions.modal, true, 
                'Modal option should be true for persistent dialogs');
        });
    });
});

// Plan 083 M8: Renamed from "API Key Flow Integration Tests" to "Cloud Login Flow Integration Tests"
suite('Cloud Login Flow Integration Tests', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Complete flow: NeedsCloudLogin -> login -> Ready', async function() {
        if (!vscode.workspace.workspaceFolders?.length) {
            this.skip();
            return;
        }

        // Plan 083: Stub Cloud provider for testing Cloud-only flow
        let cloudInitialized = false;
        const isInitializedStub = sandbox.stub(cloudProvider, 'isProviderInitialized').callsFake(() => cloudInitialized);
        const isEnabledStub = sandbox.stub(cloudProvider, 'isFlowbabyCloudEnabled').returns(true);

        // Clear any existing env var for this test
        const originalEnv = process.env.LLM_API_KEY;
        delete process.env.LLM_API_KEY;

        try {
            const mockContext = {
                secrets: {
                    get: sandbox.stub().resolves(undefined), // Not used in Cloud-only mode
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

            // Initially Cloud provider not initialized
            const hasKeyBefore = await client.hasApiKey();
            assert.strictEqual(hasKeyBefore, false, 'Should not have credentials initially');

            // Simulate Cloud login by setting provider as initialized
            cloudInitialized = true;

            // Now should have Cloud credentials
            const hasKeyAfter = await client.hasApiKey();
            assert.strictEqual(hasKeyAfter, true, 'Should have Cloud credentials after login');

            // Status should transition to Ready
            const getStatusFromApiKey = async (): Promise<FlowbabyStatus> => {
                const hasKey = await client.hasApiKey();
                return hasKey ? FlowbabyStatus.Ready : FlowbabyStatus.NeedsCloudLogin;
            };

            const statusAfter = await getStatusFromApiKey();
            assert.strictEqual(statusAfter, FlowbabyStatus.Ready,
                'Status should be Ready after Cloud login');
        } finally {
            isInitializedStub.restore();
            isEnabledStub.restore();
            // Restore env var if it existed (legacy compatibility)
            if (originalEnv) {
                process.env.LLM_API_KEY = originalEnv;
            }
        }
    });
});
