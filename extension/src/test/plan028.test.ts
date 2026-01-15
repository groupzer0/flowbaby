
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';
import mock = require('mock-fs');
import { FlowbabyClient } from '../flowbabyClient';
import { FlowbabySetupService } from '../setup/FlowbabySetupService';
import { BackgroundOperationManager } from '../background/BackgroundOperationManager';
import { EventEmitter } from 'events';
import * as cloudProvider from '../flowbaby-cloud/provider';

suite('Plan 028: Extension Isolation & Global Config', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    const testWorkspacePath = '/tmp/test-workspace-plan028';

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Plan 081: Stub Cloud provider to avoid auth requirement in tests
        // Return mock credentials to exercise the Cloud code path
        sandbox.stub(cloudProvider, 'isProviderInitialized').returns(true);
        sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
            AWS_ACCESS_KEY_ID: 'test-access-key',
            AWS_SECRET_ACCESS_KEY: 'test-secret-key',
            AWS_SESSION_TOKEN: 'test-session-token',
            AWS_REGION: 'us-east-1',
            FLOWBABY_CLOUD_MODE: 'true'
        });
        
        // Mock SecretStorage
        const secretStorage = {
            get: sandbox.stub().resolves(undefined),
            store: sandbox.stub().resolves(),
            delete: sandbox.stub().resolves(),
            keys: sandbox.stub().resolves([]),
            onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
        };

        mockContext = {
            secrets: secretStorage,
            extensionPath: '/mock/extension',
            subscriptions: [],
            workspaceState: {} as any,
            globalState: {} as any,
            extensionUri: vscode.Uri.file('/mock/extension'),
            storagePath: '/mock/storage',
            globalStoragePath: '/mock/global-storage',
            logPath: '/mock/logs',
            extensionMode: vscode.ExtensionMode.Test,
            asAbsolutePath: (p: string) => p
        } as any;

        // Mock OutputChannel
        sandbox.stub(vscode.window, 'createOutputChannel').returns({
            name: 'Flowbaby',
            appendLine: sandbox.stub(),
            append: sandbox.stub(),
            replace: sandbox.stub(),
            clear: sandbox.stub(),
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub()
        } as any);

        // Mock Configuration
        const configStub = sandbox.stub(vscode.workspace, 'getConfiguration');
        configStub.returns({
            get: (_key: string, defaultValue?: any) => defaultValue
        } as any);
    });

    teardown(() => {
        sandbox.restore();
        mock.restore();
    });

    suite('FlowbabyClient API Key Resolution (Plan 083 Cloud-only)', () => {
        // Plan 083: Cloud-only mode - resolveApiKey only checks process.env.LLM_API_KEY for CI fallback
        test('Priority 1: Cloud credentials from provider (tested in Cloud-only tests)', async () => {
            // Note: Cloud credentials are verified via hasApiKey() and getLLMEnvironment()
            // resolveApiKey() is now deprecated and only for CI fallback
            mock({
                [testWorkspacePath]: {}
            });

            const client = new FlowbabyClient(testWorkspacePath, mockContext);
            
            // Plan 083: hasApiKey() should return true when Cloud provider is initialized
            const hasKey = await client.hasApiKey();
            assert.strictEqual(hasKey, true, 'Should have credentials when Cloud provider is initialized');
        });

        test('Priority 2: resolveApiKey returns undefined in Cloud-only mode (Plan 083)', async () => {
            // No .env (empty workspace)
            mock({
                [testWorkspacePath]: {}
            });
            
            // SecretStorage is no longer used for API keys in Plan 083
            (mockContext.secrets.get as sinon.SinonStub).resolves(undefined);
            
            // Even with process.env.LLM_API_KEY set, Cloud-only mode ignores it
            process.env.LLM_API_KEY = 'process-key';

            const client = new FlowbabyClient(testWorkspacePath, mockContext);
            const apiKey = await (client as any).resolveApiKey();

            // Plan 083: resolveApiKey always returns undefined - Cloud credentials are handled via provider
            assert.strictEqual(apiKey, undefined);
        });

        test('Priority 3: resolveApiKey ignores process.env in Cloud-only mode (Plan 083)', async () => {
            // No .env
            mock({
                [testWorkspacePath]: {}
            });
            
            // No Secret
            (mockContext.secrets.get as sinon.SinonStub).resolves(undefined);
            
            // Setup Process Env - should be ignored in Cloud-only mode
            process.env.LLM_API_KEY = 'process-key';

            const client = new FlowbabyClient(testWorkspacePath, mockContext);
            const apiKey = await (client as any).resolveApiKey();

            // Plan 083: resolveApiKey always returns undefined - use hasApiKey() + Cloud provider instead
            assert.strictEqual(apiKey, undefined);
        });
    });

    suite('FlowbabyClient LLM Environment Injection (Plan 083 Cloud-only)', () => {
        test('Injects Cloud credentials from provider', async () => {
            // Mock Config - not used for Cloud credentials
            const configMock = {
                get: (key: string, defaultValue?: any) => defaultValue
            };
            (vscode.workspace.getConfiguration as sinon.SinonStub).returns(configMock as any);

            const client = new FlowbabyClient(testWorkspacePath, mockContext);
            const env = await (client as any).getLLMEnvironment();

            // Plan 083: Cloud credentials should be injected from provider
            assert.strictEqual(env['AWS_ACCESS_KEY_ID'], 'test-access-key');
            assert.strictEqual(env['AWS_SECRET_ACCESS_KEY'], 'test-secret-key');
            assert.strictEqual(env['AWS_SESSION_TOKEN'], 'test-session-token');
            assert.strictEqual(env['FLOWBABY_CLOUD_MODE'], 'true');
        });
    });

    suite('FlowbabySetupService Isolation', () => {
        test('createEnvironment uses .flowbaby/venv', async () => {
            const outputChannel = { 
                appendLine: sandbox.stub(), 
                append: sandbox.stub(),
                show: sandbox.stub() 
            } as any;
            const mockFs = { existsSync: sandbox.stub().returns(false) };
            const spawnStub = sandbox.stub();
            
            // Mock BackgroundOperationManager
            const bgManagerStub = {
                getStatus: sandbox.stub().returns([])
            };
            sandbox.stub(BackgroundOperationManager, 'getInstance').returns(bgManagerStub as any);

            // Mock mkdir and writeFile (Plan 107 REQ-5 adds early marker write)
            sandbox.stub(fs.promises, 'mkdir').resolves();
            sandbox.stub(fs.promises, 'writeFile').resolves();
            
            // Helper to create mock process with stdout
            const createMockProcess = (stdout: string = '') => {
                const proc = new EventEmitter() as any;
                proc.stdout = new EventEmitter();
                proc.stderr = new EventEmitter();
                setTimeout(() => {
                    if (stdout) {proc.stdout.emit('data', stdout);}
                    proc.emit('close', 0);
                }, 10);
                return proc;
            };

            // Mock successful setup flow
            spawnStub.onCall(0).returns(createMockProcess('Python 3.10.0')); // Python check
            spawnStub.onCall(1).returns(createMockProcess()); // venv create
            spawnStub.onCall(2).returns(createMockProcess()); // pip install
            spawnStub.onCall(3).returns(createMockProcess(JSON.stringify({ status: 'ok' }))); // verify

            // Mock window.withProgress to execute immediately
            sandbox.stub(vscode.window, 'withProgress').callsFake(async (_opts, task) => {
                return task({ report: () => {} }, new vscode.CancellationTokenSource().token);
            });

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                mockFs as any,
                spawnStub as any
            );
            
            // Stub computeRequirementsHash
            sandbox.stub(service, 'computeRequirementsHash').resolves('hash');
            // Stub writeBridgeEnv
            sandbox.stub(service, 'writeBridgeEnv').resolves();
            // Stub verifyEnvironment to return true (though we mocked spawn for it too)
            // But verifyEnvironment calls runCommand which uses spawn.
            // Let's let it run through runCommand to verify the flow.

            await service.createEnvironment();

            // Verify venv creation path
            const venvCall = spawnStub.getCalls().find(call => call.args[1] && call.args[1].includes('venv'));
            assert.ok(venvCall, 'Should call venv creation');
            
            // Check that the path argument contains .flowbaby/venv
            const venvPathArg = venvCall.args[1][2]; // ['-m', 'venv', path]
            const expectedPath = path.join('.flowbaby', 'venv');
            assert.ok(venvPathArg.includes(expectedPath), `Expected ${expectedPath} in path, got ${venvPathArg}`);
        });
    });
});

