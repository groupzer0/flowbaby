
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import mock = require('mock-fs');
import { CogneeClient } from '../cogneeClient';
import { RecallFlowSetupService } from '../setup/RecallFlowSetupService';
import { BackgroundOperationManager } from '../background/BackgroundOperationManager';
import { EventEmitter } from 'events';

suite('Plan 028: Extension Isolation & Global Config', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    const testWorkspacePath = '/tmp/test-workspace-plan028';

    setup(() => {
        sandbox = sinon.createSandbox();
        
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
            name: 'RecallFlow Memory',
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

    suite('CogneeClient API Key Resolution', () => {
        test('Priority 1: Workspace .env overrides everything', async () => {
            // Setup .env using mock-fs
            mock({
                [testWorkspacePath]: {
                    '.env': 'LLM_API_KEY=env-key'
                }
            });
            
            // Setup SecretStorage
            (mockContext.secrets.get as sinon.SinonStub).resolves('secret-key');
            
            // Setup Process Env
            process.env.LLM_API_KEY = 'process-key';

            const client = new CogneeClient(testWorkspacePath, mockContext);
            const apiKey = await (client as any).resolveApiKey();

            assert.strictEqual(apiKey, 'env-key');
        });

        test('Priority 2: SecretStorage used if no .env', async () => {
            // No .env (empty workspace)
            mock({
                [testWorkspacePath]: {}
            });
            
            // Setup SecretStorage
            (mockContext.secrets.get as sinon.SinonStub).resolves('secret-key');
            
            // Setup Process Env
            process.env.LLM_API_KEY = 'process-key';

            const client = new CogneeClient(testWorkspacePath, mockContext);
            const apiKey = await (client as any).resolveApiKey();

            assert.strictEqual(apiKey, 'secret-key');
        });

        test('Priority 3: Process Env used if no .env and no Secret', async () => {
            // No .env
            mock({
                [testWorkspacePath]: {}
            });
            
            // No Secret
            (mockContext.secrets.get as sinon.SinonStub).resolves(undefined);
            
            // Setup Process Env
            process.env.LLM_API_KEY = 'process-key';

            const client = new CogneeClient(testWorkspacePath, mockContext);
            const apiKey = await (client as any).resolveApiKey();

            assert.strictEqual(apiKey, 'process-key');
        });
    });

    suite('CogneeClient LLM Environment Injection', () => {
        test('Injects LLM settings into environment', async () => {
            // Mock Config
            const configMock = {
                get: (key: string, defaultValue?: any) => {
                    if (key === 'llm.provider') return 'anthropic';
                    if (key === 'llm.model') return 'claude-3-opus';
                    if (key === 'llm.endpoint') return 'https://api.anthropic.com';
                    return defaultValue;
                }
            };
            (vscode.workspace.getConfiguration as sinon.SinonStub).returns(configMock as any);

            const client = new CogneeClient(testWorkspacePath, mockContext);
            const env = await (client as any).getLLMEnvironment();

            assert.strictEqual(env['LLM_PROVIDER'], 'anthropic');
            assert.strictEqual(env['LLM_MODEL'], 'claude-3-opus');
            assert.strictEqual(env['LLM_ENDPOINT'], 'https://api.anthropic.com');
        });
    });

    suite('RecallFlowSetupService Isolation', () => {
        test('createEnvironment uses .cognee/venv', async () => {
            const outputChannel = { appendLine: sandbox.stub(), append: sandbox.stub() } as any;
            const mockFs = { existsSync: sandbox.stub().returns(false) };
            const spawnStub = sandbox.stub();
            
            // Mock BackgroundOperationManager
            const bgManagerStub = {
                getStatus: sandbox.stub().returns([])
            };
            sandbox.stub(BackgroundOperationManager, 'getInstance').returns(bgManagerStub as any);

            // Mock mkdir
            sandbox.stub(fs.promises, 'mkdir').resolves();
            
            // Helper to create mock process with stdout
            const createMockProcess = (stdout: string = '') => {
                const proc = new EventEmitter() as any;
                proc.stdout = new EventEmitter();
                proc.stderr = new EventEmitter();
                setTimeout(() => {
                    if (stdout) proc.stdout.emit('data', stdout);
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

            const service = new RecallFlowSetupService(
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
            
            // Check that the path argument contains .cognee/venv
            const venvPathArg = venvCall.args[1][2]; // ['-m', 'venv', path]
            assert.ok(venvPathArg.includes('.cognee/venv'), `Expected .cognee/venv in path, got ${venvPathArg}`);
        });
    });
});

