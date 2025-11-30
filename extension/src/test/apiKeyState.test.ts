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
            const state: ApiKeyState = {
                pythonConfigured: false,
                typescriptConfigured: false,
                llmReady: false,
                statusMessage: 'API key not configured - use "Flowbaby: Set API Key" command'
            };

            assert.strictEqual(state.pythonConfigured, false);
            assert.strictEqual(state.typescriptConfigured, false);
            assert.strictEqual(state.llmReady, false);
            assert.ok(state.statusMessage.includes('not configured'));
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
        test('hasApiKey returns true when SecretStorage has key', async function() {
            // Skip if no workspace
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

            const result = await client.hasApiKey();
            assert.strictEqual(result, true);
        });

        test('hasApiKey returns false when no key in any source', async function() {
            // Skip if no workspace
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

            // Clear any existing env var
            const originalEnv = process.env.LLM_API_KEY;
            delete process.env.LLM_API_KEY;

            try {
                const client = new FlowbabyClient(
                    vscode.workspace.workspaceFolders[0].uri.fsPath,
                    mockContext
                );

                const result = await client.hasApiKey();
                assert.strictEqual(result, false);
            } finally {
                // Restore env var if it existed
                if (originalEnv) {
                    process.env.LLM_API_KEY = originalEnv;
                }
            }
        });
    });

    suite('FlowbabyStatus Enum (Plan 045)', () => {
        test('FlowbabyStatus.NeedsApiKey is a distinct state', () => {
            // Verify the NeedsApiKey state exists and is distinct from other states
            assert.strictEqual(FlowbabyStatus.NeedsApiKey, 'NeedsApiKey');
            assert.notStrictEqual(FlowbabyStatus.NeedsApiKey, FlowbabyStatus.Ready);
            assert.notStrictEqual(FlowbabyStatus.NeedsApiKey, FlowbabyStatus.Error);
            assert.notStrictEqual(FlowbabyStatus.NeedsApiKey, FlowbabyStatus.SetupRequired);
        });

        test('All FlowbabyStatus values are defined', () => {
            // Verify all expected states exist
            assert.ok(FlowbabyStatus.Ready);
            assert.ok(FlowbabyStatus.SetupRequired);
            assert.ok(FlowbabyStatus.Refreshing);
            assert.ok(FlowbabyStatus.Error);
            assert.ok(FlowbabyStatus.NeedsApiKey);
        });

        test('NeedsApiKey should be used when init succeeds without API key', () => {
            // Simulate the logic that determines status based on InitializeResult
            const initResultWithoutKey: InitializeResult = {
                success: true,
                apiKeyState: {
                    pythonConfigured: false,
                    typescriptConfigured: false,
                    llmReady: false,
                    statusMessage: 'API key not configured'
                }
            };

            // Status selection logic (mirrors extension.ts)
            const determineStatus = (result: InitializeResult): FlowbabyStatus => {
                if (!result.success) {
                    return FlowbabyStatus.Error;
                }
                if (!result.apiKeyState.llmReady) {
                    return FlowbabyStatus.NeedsApiKey;
                }
                return FlowbabyStatus.Ready;
            };

            const status = determineStatus(initResultWithoutKey);
            assert.strictEqual(status, FlowbabyStatus.NeedsApiKey);
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
