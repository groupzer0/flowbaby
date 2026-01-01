/**
 * API Key State Tests (Plan 045)
 * 
 * Tests for the centralized API key state model introduced in Plan 045.
 * Verifies the ApiKeyState interface and related behavior.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { FlowbabyClient, ApiKeyState, InitializeResult } from '../flowbabyClient';
import { FlowbabyStatus } from '../statusBar/FlowbabyStatusBar';
import * as cloudProvider from '../flowbaby-cloud/provider';

suite('API Key State Tests (Plan 045)', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('ApiKeyState Interface', () => {
        test('ApiKeyState with all keys configured', () => {
            const state: ApiKeyState = {
                pythonConfigured: true,
                typescriptConfigured: true,
                llmReady: true,
                statusMessage: 'API key configured - LLM operations ready'
            };

            assert.strictEqual(state.pythonConfigured, true);
            assert.strictEqual(state.typescriptConfigured, true);
            assert.strictEqual(state.llmReady, true);
            assert.ok(state.statusMessage.includes('ready'));
        });

        test('ApiKeyState with no keys configured', () => {
            // Plan 083 M6: Cloud-only messaging (v0.7.0)
            const state: ApiKeyState = {
                pythonConfigured: false,
                typescriptConfigured: false,
                llmReady: false,
                statusMessage: 'Cloud login required - use "Flowbaby Cloud: Login with GitHub" command'
            };

            assert.strictEqual(state.pythonConfigured, false);
            assert.strictEqual(state.typescriptConfigured, false);
            assert.strictEqual(state.llmReady, false);
            // Plan 083: Cloud-only messaging
            assert.ok(state.statusMessage.includes('Cloud login'));
        });

        test('ApiKeyState with only TypeScript key (SecretStorage)', () => {
            const state: ApiKeyState = {
                pythonConfigured: false,
                typescriptConfigured: true,
                llmReady: true, // TypeScript key is sufficient for LLM readiness
                statusMessage: 'API key configured - LLM operations ready'
            };

            assert.strictEqual(state.pythonConfigured, false);
            assert.strictEqual(state.typescriptConfigured, true);
            assert.strictEqual(state.llmReady, true);
        });

        test('ApiKeyState with only Python env key', () => {
            const state: ApiKeyState = {
                pythonConfigured: true,
                typescriptConfigured: false,
                llmReady: true, // Python key is sufficient for LLM readiness
                statusMessage: 'API key configured - LLM operations ready'
            };

            assert.strictEqual(state.pythonConfigured, true);
            assert.strictEqual(state.typescriptConfigured, false);
            assert.strictEqual(state.llmReady, true);
        });
    });

    suite('InitializeResult Interface', () => {
        test('InitializeResult with successful init and API key', () => {
            const result: InitializeResult = {
                success: true,
                apiKeyState: {
                    pythonConfigured: true,
                    typescriptConfigured: true,
                    llmReady: true,
                    statusMessage: 'API key configured'
                }
            };

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.apiKeyState.llmReady, true);
            assert.strictEqual(result.error, undefined);
        });

        test('InitializeResult with successful init but no API key', () => {
            const result: InitializeResult = {
                success: true,
                apiKeyState: {
                    pythonConfigured: false,
                    typescriptConfigured: false,
                    llmReady: false,
                    statusMessage: 'API key not configured'
                }
            };

            // Success is true because init completed (dirs, DB, ontology)
            // But llmReady is false because no API key
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.apiKeyState.llmReady, false);
        });

        test('InitializeResult with failed init', () => {
            const result: InitializeResult = {
                success: false,
                apiKeyState: {
                    pythonConfigured: false,
                    typescriptConfigured: false,
                    llmReady: false,
                    statusMessage: 'Initialization failed'
                },
                error: 'Python bridge failed to start'
            };

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.error, 'Python bridge failed to start');
        });
    });

    suite('FlowbabyClient.hasApiKey()', () => {
        test('hasApiKey returns true when Cloud provider is initialized (Plan 083)', async function() {
            // Skip if no workspace
            if (!vscode.workspace.workspaceFolders?.length) {
                this.skip();
                return;
            }

            // Plan 083: Stub Cloud provider as initialized
            const isInitializedStub = sandbox.stub(cloudProvider, 'isProviderInitialized').returns(true);
            const isEnabledStub = sandbox.stub(cloudProvider, 'isFlowbabyCloudEnabled').returns(true);

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

            try {
                const client = new FlowbabyClient(
                    vscode.workspace.workspaceFolders[0].uri.fsPath,
                    mockContext
                );

                const result = await client.hasApiKey();
                assert.strictEqual(result, true, 'Should have credentials when Cloud provider is initialized');
            } finally {
                isInitializedStub.restore();
                isEnabledStub.restore();
            }
        });

        test('hasApiKey returns false when no credentials in any source', async function() {
            // Skip if no workspace
            if (!vscode.workspace.workspaceFolders?.length) {
                this.skip();
                return;
            }

            // Plan 083: Stub Cloud provider as NOT initialized
            const isInitializedStub = sandbox.stub(cloudProvider, 'isProviderInitialized').returns(false);
            const isEnabledStub = sandbox.stub(cloudProvider, 'isFlowbabyCloudEnabled').returns(true);

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

            // Clear any existing env var
            const originalEnv = process.env.LLM_API_KEY;
            delete process.env.LLM_API_KEY;

            try {
                const client = new FlowbabyClient(
                    vscode.workspace.workspaceFolders[0].uri.fsPath,
                    mockContext
                );

                const result = await client.hasApiKey();
                assert.strictEqual(result, false, 'Should return false when Cloud not initialized and no CI env var');
            } finally {
                isInitializedStub.restore();
                isEnabledStub.restore();
                // Restore env var if it existed
                if (originalEnv) {
                    process.env.LLM_API_KEY = originalEnv;
                }
            }
        });
    });

    // Plan 083 M6: Updated tests for Cloud-only status (NeedsCloudLogin replaces NeedsApiKey)
    suite('FlowbabyStatus Enum (Plan 045, updated Plan 083)', () => {
        test('FlowbabyStatus.NeedsCloudLogin is a distinct state', () => {
            // Plan 083 M6: NeedsApiKey is now an alias for NeedsCloudLogin
            assert.strictEqual(FlowbabyStatus.NeedsCloudLogin, 'NeedsCloudLogin');
            assert.notStrictEqual(FlowbabyStatus.NeedsCloudLogin, FlowbabyStatus.Ready);
            assert.notStrictEqual(FlowbabyStatus.NeedsCloudLogin, FlowbabyStatus.Error);
            assert.notStrictEqual(FlowbabyStatus.NeedsCloudLogin, FlowbabyStatus.SetupRequired);
            // Plan 083 M6: Backward compatibility alias
            assert.strictEqual(FlowbabyStatus.NeedsApiKey, FlowbabyStatus.NeedsCloudLogin);
        });

        test('All FlowbabyStatus values are defined', () => {
            // Verify all expected states exist
            assert.ok(FlowbabyStatus.Ready);
            assert.ok(FlowbabyStatus.SetupRequired);
            assert.ok(FlowbabyStatus.Refreshing);
            assert.ok(FlowbabyStatus.Error);
            assert.ok(FlowbabyStatus.NeedsCloudLogin);
            // Backward compat alias still works
            assert.ok(FlowbabyStatus.NeedsApiKey);
        });

        test('NeedsCloudLogin should be used when init succeeds without Cloud login', () => {
            // Simulate the logic that determines status based on InitializeResult
            const initResultWithoutKey: InitializeResult = {
                success: true,
                apiKeyState: {
                    pythonConfigured: false,
                    typescriptConfigured: false,
                    llmReady: false,
                    statusMessage: 'Cloud login not configured'
                }
            };

            // Status selection logic (mirrors extension.ts)
            const determineStatus = (result: InitializeResult): FlowbabyStatus => {
                if (!result.success) {
                    return FlowbabyStatus.Error;
                }
                if (!result.apiKeyState.llmReady) {
                    return FlowbabyStatus.NeedsCloudLogin;
                }
                return FlowbabyStatus.Ready;
            };

            const status = determineStatus(initResultWithoutKey);
            assert.strictEqual(status, FlowbabyStatus.NeedsCloudLogin);
        });

        test('Ready should be used when init succeeds with API key', () => {
            const initResultWithKey: InitializeResult = {
                success: true,
                apiKeyState: {
                    pythonConfigured: true,
                    typescriptConfigured: true,
                    llmReady: true,
                    statusMessage: 'API key configured'
                }
            };

            const determineStatus = (result: InitializeResult): FlowbabyStatus => {
                if (!result.success) {
                    return FlowbabyStatus.Error;
                }
                if (!result.apiKeyState.llmReady) {
                    return FlowbabyStatus.NeedsApiKey;
                }
                return FlowbabyStatus.Ready;
            };

            const status = determineStatus(initResultWithKey);
            assert.strictEqual(status, FlowbabyStatus.Ready);
        });

        test('Error should be used when init fails', () => {
            const initResultFailed: InitializeResult = {
                success: false,
                apiKeyState: {
                    pythonConfigured: false,
                    typescriptConfigured: false,
                    llmReady: false,
                    statusMessage: 'Initialization failed'
                },
                error: 'Bridge failed'
            };

            const determineStatus = (result: InitializeResult): FlowbabyStatus => {
                if (!result.success) {
                    return FlowbabyStatus.Error;
                }
                if (!result.apiKeyState.llmReady) {
                    return FlowbabyStatus.NeedsApiKey;
                }
                return FlowbabyStatus.Ready;
            };

            const status = determineStatus(initResultFailed);
            assert.strictEqual(status, FlowbabyStatus.Error);
        });
    });
});
