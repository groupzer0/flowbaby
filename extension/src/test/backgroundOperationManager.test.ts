import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { BackgroundOperationManager, OperationEntry } from '../background/BackgroundOperationManager';
import * as cloudProvider from '../flowbaby-cloud/provider';
import * as usageMeter from '../flowbaby-cloud/usageMeter';

suite('BackgroundOperationManager - Concurrency and Queue', () => {
    let workspacePath: string;
    let context: vscode.ExtensionContext;
    let output: vscode.OutputChannel;
    let manager: BackgroundOperationManager;
    let infoStub: sinon.SinonStub;
    let warnStub: sinon.SinonStub;
    let commandStub: sinon.SinonStub;

    const resetSingleton = () => {
        (BackgroundOperationManager as unknown as { instance?: BackgroundOperationManager }).instance = undefined;
    };

    setup(async () => {
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cognee-bom-'));
        context = {
            subscriptions: [],
            globalState: {
                get: sinon.stub().returns(undefined),
                update: sinon.stub().resolves()
            }
        } as unknown as vscode.ExtensionContext;
        output = {
            appendLine: sinon.stub()
        } as unknown as vscode.OutputChannel;

        resetSingleton();
        manager = BackgroundOperationManager.initialize(context, output);
        await manager.initializeForWorkspace(workspacePath);

        infoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined as any);
        warnStub = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined as any);
        commandStub = sinon.stub(vscode.commands, 'executeCommand').resolves();
    });

    teardown(async () => {
        infoStub.restore();
        warnStub.restore();
        commandStub.restore();
        await manager.shutdown();
        resetSingleton();
        fs.rmSync(workspacePath, { recursive: true, force: true });
    });

    test('enforces concurrency limits and dequeues pending operations FIFO', async () => {
        const spawnStub = sinon.stub(manager as any, 'spawnCognifyProcess').callsFake(async (...args: unknown[]) => {
            const operationId = args[0] as string;
            const entry = manager.getStatus(operationId) as OperationEntry;
            entry.status = 'running';
            entry.pid = 1000 + spawnStub.callCount;
            entry.queueIndex = undefined;
            entry.lastUpdate = new Date().toISOString();
            (manager as any).reassignQueueIndexes();
        });

        const payload = {
            type: 'summary' as const,
            summary: { topic: 't', context: 'c' }
        };

        const ids: string[] = [];
        for (let i = 0; i < 5; i++) {
            ids.push(await manager.startOperation(`summary text ${i}`, workspacePath, '/usr/bin/python3', path.join(workspacePath, 'bridge', 'ingest.py'), payload));
        }

        assert.strictEqual(spawnStub.callCount, 2, 'only two operations should start immediately');

        const firstEntry = manager.getStatus(ids[0]) as OperationEntry;
        const secondEntry = manager.getStatus(ids[1]) as OperationEntry;
        const pendingEntries = ids.slice(2).map(id => manager.getStatus(id) as OperationEntry);

        assert.strictEqual(firstEntry.status, 'running');
        assert.strictEqual(secondEntry.status, 'running');
        assert.deepStrictEqual(pendingEntries.map(entry => entry.status), ['pending', 'pending', 'pending']);

        await assert.rejects(
            () => manager.startOperation('overflow summary', workspacePath, '/usr/bin/python3', path.join(workspacePath, 'bridge', 'ingest.py'), payload),
            /429_FLOWBABY_BACKLOG/
        );

        await manager.completeOperation(ids[0], { elapsedMs: 1500 });
        await (manager as any).resumePendingOperations();

        assert.strictEqual(spawnStub.callCount, 3, 'next pending operation should start after completion');

        const dequeued = manager.getStatus(ids[2]) as OperationEntry;
        assert.strictEqual(dequeued.status, 'running', 'oldest pending entry should be promoted first');
        assert.strictEqual(dequeued.queueIndex, undefined);

        const remainingQueue = [ids[3], ids[4]].map(id => manager.getStatus(id) as OperationEntry);
        remainingQueue.forEach(entry => assert.strictEqual(entry.status, 'pending', 'remaining operations should stay queued'));
        assert.strictEqual((manager as any).getRunningCount(), 2, 'running count should stay capped at two');
        assert.strictEqual((manager as any).getQueuedCount(), 2, 'queue should retain the remaining two operations');

        spawnStub.restore();
    });

    test('cleanup removes expired ledger entries while retaining recent ones', async () => {
        const operations = (manager as any).operations as Map<string, OperationEntry>;
        operations.clear();

        const now = Date.now();
        const mkEntry = (id: string, status: OperationEntry['status'], ageMs: number): OperationEntry => ({
            operationId: id,
            datasetPath: workspacePath,
            summaryDigest: id,
            pid: null,
            startTime: new Date(now - ageMs).toISOString(),
            status
        });

        operations.set('recent-success', mkEntry('recent-success', 'completed', 23 * 60 * 60 * 1000));
        operations.set('old-success', mkEntry('old-success', 'completed', 25 * 60 * 60 * 1000));
        operations.set('recent-failure', mkEntry('recent-failure', 'failed', 6 * 24 * 60 * 60 * 1000));
        operations.set('old-failure', mkEntry('old-failure', 'failed', 8 * 24 * 60 * 60 * 1000));
        operations.set('old-terminated', mkEntry('old-terminated', 'terminated', 8 * 24 * 60 * 60 * 1000));

        const deletePayloadStub = sinon.stub(manager as any, 'deletePayloadFile').resolves();

        await (manager as any).cleanupOldEntries();

        assert.ok(operations.has('recent-success'), 'recent successes should be kept');
        assert.ok(operations.has('recent-failure'), 'recent failures should be kept');
        assert.ok(!operations.has('old-success'), 'success entries older than 24h should be pruned');
        assert.ok(!operations.has('old-failure'), 'failure entries older than 7d should be pruned');
        assert.ok(!operations.has('old-terminated'), 'terminated entries older than 7d should be pruned');

        assert.strictEqual(deletePayloadStub.callCount, 3, 'cleanup should delete payloads for removed entries');
        deletePayloadStub.restore();
    });
});

/**
 * Plan 083 M5 - Cloud-only API Key Resolution and LLM Environment Tests
 * 
 * Tests for resolveApiKey() and getLLMEnvironment() methods
 * Plan 083 M5: v0.7.0 is Cloud-only - resolveApiKey always returns undefined, 
 * Cloud credentials come via getLLMEnvironment from cloudProvider
 */
suite('BackgroundOperationManager - API Key Resolution (Plan 083 M5 Cloud-only)', () => {
    let workspacePath: string;
    let context: vscode.ExtensionContext;
    let output: vscode.OutputChannel;
    let manager: BackgroundOperationManager;
    let secretsStub: sinon.SinonStubbedInstance<vscode.SecretStorage>;
    let cloudProviderStub: sinon.SinonStub;
    let cloudEnvStub: sinon.SinonStub;

    const resetSingleton = () => {
        (BackgroundOperationManager as unknown as { instance?: BackgroundOperationManager }).instance = undefined;
    };

    setup(async () => {
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cognee-apikey-'));
        
        // Plan 086: Stub Cloud provider as the primary credential source with model config
        cloudProviderStub = sinon.stub(cloudProvider, 'isProviderInitialized').returns(true);
        cloudEnvStub = sinon.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
            AWS_ACCESS_KEY_ID: 'cloud-access-key',
            AWS_SECRET_ACCESS_KEY: 'cloud-secret-key',
            AWS_SESSION_TOKEN: 'cloud-session-token',
            AWS_REGION: 'us-east-1',
            FLOWBABY_CLOUD_MODE: 'true',
            LLM_PROVIDER: 'bedrock',
            EMBEDDING_PROVIDER: 'bedrock',
            LLM_MODEL: 'anthropic.claude-3-haiku-20240307-v1:0',
            EMBEDDING_MODEL: 'bedrock/amazon.titan-embed-text-v2:0',
            EMBEDDING_DIMENSIONS: '1024',
        });
        
        // Create mock secrets storage (no longer used for API keys in Plan 083)
        secretsStub = {
            get: sinon.stub(),
            store: sinon.stub(),
            delete: sinon.stub(),
            onDidChange: sinon.stub()
        } as unknown as sinon.SinonStubbedInstance<vscode.SecretStorage>;
        
        context = {
            subscriptions: [],
            globalState: {
                get: sinon.stub().returns(undefined),
                update: sinon.stub().resolves()
            },
            secrets: secretsStub
        } as unknown as vscode.ExtensionContext;
        
        output = {
            appendLine: sinon.stub()
        } as unknown as vscode.OutputChannel;

        resetSingleton();
        manager = BackgroundOperationManager.initialize(context, output);
        await manager.initializeForWorkspace(workspacePath);
    });

    teardown(async () => {
        cloudProviderStub.restore();
        cloudEnvStub.restore();
        await manager.shutdown();
        resetSingleton();
        fs.rmSync(workspacePath, { recursive: true, force: true });
    });

    // Plan 083 M5: resolveApiKey always returns undefined - Cloud-only mode
    test('resolveApiKey always returns undefined (Plan 083 M5)', async () => {
        // v0.7.0 is Cloud-only - resolveApiKey no longer checks process.env
        // Cloud credentials are obtained via getLLMEnvironment instead
        
        const apiKey = await (manager as any).resolveApiKey(workspacePath);
        
        assert.strictEqual(apiKey, undefined, 'Should always return undefined in Cloud-only mode');
    });

    test('resolveApiKey returns undefined even with process.env set (Plan 083 M5)', async () => {
        // This test verifies that resolveApiKey ignores process.env.LLM_API_KEY
        // even if it's set - v0.7.0 is Cloud-only
        process.env.LLM_API_KEY = 'should-be-ignored';
        
        try {
            const apiKey = await (manager as any).resolveApiKey(workspacePath);
            
            assert.strictEqual(apiKey, undefined, 'Should return undefined (Cloud-only mode ignores process.env)');
        } finally {
            delete process.env.LLM_API_KEY;
        }
    });

    test('resolveApiKey returns undefined even with .env file (Plan 083 M5)', async () => {
        // Create .env file - should be completely ignored in Cloud-only mode
        fs.writeFileSync(path.join(workspacePath, '.env'), 'LLM_API_KEY=env-key');
        
        const apiKey = await (manager as any).resolveApiKey(workspacePath);
        
        // Should return undefined - .env is ignored in Cloud-only mode
        assert.strictEqual(apiKey, undefined, 'Should ignore .env files in Cloud-only mode');
    });
});

suite('BackgroundOperationManager - getLLMEnvironment (Plan 083 M5 Cloud-only)', () => {
    let workspacePath: string;
    let context: vscode.ExtensionContext;
    let output: vscode.OutputChannel;
    let manager: BackgroundOperationManager;
    let secretsStub: sinon.SinonStubbedInstance<vscode.SecretStorage>;
    let configStub: sinon.SinonStub;
    let cloudProviderStub: sinon.SinonStub;
    let cloudEnvStub: sinon.SinonStub;

    const resetSingleton = () => {
        (BackgroundOperationManager as unknown as { instance?: BackgroundOperationManager }).instance = undefined;
    };

    setup(async () => {
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cognee-llmenv-'));
        
        // Plan 086: Stub Cloud provider with model configuration
        cloudProviderStub = sinon.stub(cloudProvider, 'isProviderInitialized').returns(true);
        cloudEnvStub = sinon.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
            AWS_ACCESS_KEY_ID: 'test-access-key',
            AWS_SECRET_ACCESS_KEY: 'test-secret-key',
            AWS_SESSION_TOKEN: 'test-session-token',
            AWS_REGION: 'us-east-1',
            FLOWBABY_CLOUD_MODE: 'true',
            LLM_PROVIDER: 'bedrock',
            EMBEDDING_PROVIDER: 'bedrock',
            LLM_MODEL: 'anthropic.claude-3-haiku-20240307-v1:0',
            EMBEDDING_MODEL: 'bedrock/amazon.titan-embed-text-v2:0',
            EMBEDDING_DIMENSIONS: '1024',
        });
        
        secretsStub = {
            get: sinon.stub(),
            store: sinon.stub(),
            delete: sinon.stub(),
            onDidChange: sinon.stub()
        } as unknown as sinon.SinonStubbedInstance<vscode.SecretStorage>;
        
        context = {
            subscriptions: [],
            globalState: {
                get: sinon.stub().returns(undefined),
                update: sinon.stub().resolves()
            },
            secrets: secretsStub
        } as unknown as vscode.ExtensionContext;
        
        output = {
            appendLine: sinon.stub()
        } as unknown as vscode.OutputChannel;

        resetSingleton();
        manager = BackgroundOperationManager.initialize(context, output);
        await manager.initializeForWorkspace(workspacePath);
        
        // Stub vscode.workspace.getConfiguration
        configStub = sinon.stub(vscode.workspace, 'getConfiguration');
    });

    teardown(async () => {
        cloudProviderStub.restore();
        cloudEnvStub.restore();
        configStub.restore();
        await manager.shutdown();
        resetSingleton();
        fs.rmSync(workspacePath, { recursive: true, force: true });
        delete process.env.LLM_API_KEY;
    });

    test('getLLMEnvironment returns Cloud credentials (Plan 083)', async () => {
        // SecretStorage not used for credentials in Cloud-only mode
        secretsStub.get.resolves(undefined);
        
        // Mock VS Code configuration - not used for Cloud credentials
        const mockConfig = {
            get: (_key: string) => undefined
        };
        configStub.withArgs('Flowbaby.llm').returns(mockConfig);
        
        const env = await (manager as any).getLLMEnvironment(workspacePath);
        
        // Plan 083: Cloud credentials should be injected
        assert.strictEqual(env.AWS_ACCESS_KEY_ID, 'test-access-key');
        assert.strictEqual(env.AWS_SECRET_ACCESS_KEY, 'test-secret-key');
        assert.strictEqual(env.AWS_SESSION_TOKEN, 'test-session-token');
        assert.strictEqual(env.AWS_REGION, 'us-east-1');
        assert.strictEqual(env.FLOWBABY_CLOUD_MODE, 'true');
        // Plan 086: Provider and model configuration
        assert.strictEqual(env.LLM_PROVIDER, 'bedrock', 'LLM_PROVIDER should be bedrock');
        assert.strictEqual(env.EMBEDDING_PROVIDER, 'bedrock', 'EMBEDDING_PROVIDER should be bedrock');
        assert.strictEqual(env.LLM_MODEL, 'anthropic.claude-3-haiku-20240307-v1:0', 'LLM_MODEL should be set');
        assert.strictEqual(env.EMBEDDING_MODEL, 'bedrock/amazon.titan-embed-text-v2:0', 'EMBEDDING_MODEL should be set');
        assert.strictEqual(env.EMBEDDING_DIMENSIONS, '1024', 'EMBEDDING_DIMENSIONS should be set');
    });

    test('getLLMEnvironment omits legacy config values (Plan 086 update)', async () => {
        // No .env file
        secretsStub.get.resolves(undefined);
        
        // Mock config with only provider set - ignored in Cloud-only mode
        const mockConfig = {
            get: (key: string) => {
                if (key === 'provider') { return 'anthropic'; }
                return undefined;
            }
        };
        configStub.withArgs('Flowbaby.llm').returns(mockConfig);
        
        const env = await (manager as any).getLLMEnvironment(workspacePath);
        
        // Plan 083 M5: LLM_API_KEY is never set - Cloud-only mode
        assert.strictEqual(env.LLM_API_KEY, undefined, 'LLM_API_KEY should never be set in Cloud-only mode');
        // Plan 086: LLM_PROVIDER is now 'bedrock' (backend-controlled), not from local config
        assert.strictEqual(env.LLM_PROVIDER, 'bedrock', 'LLM_PROVIDER should be bedrock in Cloud-only mode');
        // Plan 086: LLM_MODEL is now backend-controlled
        assert.strictEqual(env.LLM_MODEL, 'anthropic.claude-3-haiku-20240307-v1:0', 'LLM_MODEL should be from Cloud');
        // Legacy config is not used
        assert.strictEqual(env.LLM_ENDPOINT, undefined, 'LLM_ENDPOINT should not be set in Cloud-only mode');
    });

    test('getLLMEnvironment returns Cloud credentials when no local config (Plan 081)', async () => {
        // No API key anywhere (local config empty)
        secretsStub.get.resolves(undefined);
        
        // Empty local config
        const mockConfig = { get: () => undefined };
        configStub.withArgs('Flowbaby.llm').returns(mockConfig);
        
        const env = await (manager as any).getLLMEnvironment(workspacePath);
        
        // Plan 081: In Cloud-only mode, Cloud credentials are always injected
        assert.strictEqual(env.FLOWBABY_CLOUD_MODE, 'true', 'Cloud mode flag should be set');
        assert.strictEqual(env.AWS_REGION, 'us-east-1', 'AWS region should be set');
        assert.ok(env.AWS_ACCESS_KEY_ID, 'AWS access key should be set');
        assert.ok(env.AWS_SECRET_ACCESS_KEY, 'AWS secret should be set');
        assert.ok(env.AWS_SESSION_TOKEN, 'AWS session token should be set');
    });
});

suite('BackgroundOperationManager - runPythonJson Env Injection (Plan 083 Cloud-only)', () => {
    let workspacePath: string;
    let context: vscode.ExtensionContext;
    let output: vscode.OutputChannel;
    let manager: BackgroundOperationManager;
    let secretsStub: sinon.SinonStubbedInstance<vscode.SecretStorage>;
    let configStub: sinon.SinonStub;
    let spawnStub: sinon.SinonStub;
    let cloudProviderStub: sinon.SinonStub;
    let cloudEnvStub: sinon.SinonStub;

    const resetSingleton = () => {
        (BackgroundOperationManager as unknown as { instance?: BackgroundOperationManager }).instance = undefined;
    };

    setup(async () => {
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cognee-runjson-'));
        
        // Plan 086: Stub Cloud provider with model configuration
        cloudProviderStub = sinon.stub(cloudProvider, 'isProviderInitialized').returns(true);
        cloudEnvStub = sinon.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
            AWS_ACCESS_KEY_ID: 'test-access-key',
            AWS_SECRET_ACCESS_KEY: 'test-secret-key',
            AWS_SESSION_TOKEN: 'test-session-token',
            AWS_REGION: 'us-east-1',
            FLOWBABY_CLOUD_MODE: 'true',
            LLM_PROVIDER: 'bedrock',
            EMBEDDING_PROVIDER: 'bedrock',
            LLM_MODEL: 'anthropic.claude-3-haiku-20240307-v1:0',
            EMBEDDING_MODEL: 'bedrock/amazon.titan-embed-text-v2:0',
            EMBEDDING_DIMENSIONS: '1024',
        });
        
        secretsStub = {
            get: sinon.stub(),
            store: sinon.stub(),
            delete: sinon.stub(),
            onDidChange: sinon.stub()
        } as unknown as sinon.SinonStubbedInstance<vscode.SecretStorage>;
        
        context = {
            subscriptions: [],
            globalState: {
                get: sinon.stub().returns(undefined),
                update: sinon.stub().resolves()
            },
            secrets: secretsStub
        } as unknown as vscode.ExtensionContext;
        
        output = {
            appendLine: sinon.stub()
        } as unknown as vscode.OutputChannel;

        resetSingleton();
        manager = BackgroundOperationManager.initialize(context, output);
        await manager.initializeForWorkspace(workspacePath);
        
        configStub = sinon.stub(vscode.workspace, 'getConfiguration');
    });

    teardown(async () => {
        cloudProviderStub.restore();
        cloudEnvStub.restore();
        configStub.restore();
        if (spawnStub) { spawnStub.restore(); }
        await manager.shutdown();
        resetSingleton();
        fs.rmSync(workspacePath, { recursive: true, force: true });
        delete process.env.LLM_API_KEY;
    });

    test('runPythonJson injects Cloud environment when workspacePath provided (Plan 083)', async () => {
        // SecretStorage not used in Cloud-only mode
        secretsStub.get.resolves(undefined);
        
        // Mock config
        const mockConfig = { get: (_key: string) => undefined };
        configStub.withArgs('Flowbaby.llm').returns(mockConfig);
        
        let capturedEnv: NodeJS.ProcessEnv | undefined;
        
        // We need to stub the spawn function to capture the env
        const childProcess = require('child_process');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        spawnStub = sinon.stub(childProcess, 'spawn').callsFake((...args: any[]) => {
            const options = args[2] as { env?: NodeJS.ProcessEnv } | undefined;
            capturedEnv = options?.env;
            // Return a mock child process that immediately succeeds
            const mockChild = {
                stdout: { on: (event: string, cb: (data: Buffer) => void) => {
                    if (event === 'data') { cb(Buffer.from('{"success": true}')); }
                }},
                stderr: { on: sinon.stub() },
                on: (event: string, cb: (code: number) => void) => {
                    if (event === 'close') { setTimeout(() => cb(0), 0); }
                }
            };
            return mockChild;
        });
        
        // Call runPythonJson with workspacePath
        await (manager as any).runPythonJson('/usr/bin/python3', ['test.py'], workspacePath, workspacePath);
        
        assert.ok(capturedEnv, 'Env should be passed to spawn');
        // Plan 083: Cloud credentials should be injected, not LLM_API_KEY
        assert.strictEqual(capturedEnv!.AWS_ACCESS_KEY_ID, 'test-access-key', 'AWS_ACCESS_KEY_ID should be injected');
        assert.strictEqual(capturedEnv!.FLOWBABY_CLOUD_MODE, 'true', 'FLOWBABY_CLOUD_MODE should be injected');
        assert.strictEqual(capturedEnv!.PYTHONUNBUFFERED, '1', 'PYTHONUNBUFFERED should always be set');
    });

    test('runPythonJson only sets PYTHONUNBUFFERED when no workspacePath', async () => {
        let capturedEnv: NodeJS.ProcessEnv | undefined;
        
        const childProcess = require('child_process');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        spawnStub = sinon.stub(childProcess, 'spawn').callsFake((...args: any[]) => {
            const options = args[2] as { env?: NodeJS.ProcessEnv } | undefined;
            capturedEnv = options?.env;
            const mockChild = {
                stdout: { on: (event: string, cb: (data: Buffer) => void) => {
                    if (event === 'data') { cb(Buffer.from('{"success": true}')); }
                }},
                stderr: { on: sinon.stub() },
                on: (event: string, cb: (code: number) => void) => {
                    if (event === 'close') { setTimeout(() => cb(0), 0); }
                }
            };
            return mockChild;
        });
        
        // Call without workspacePath (4th arg undefined)
        await (manager as any).runPythonJson('/usr/bin/python3', ['test.py'], workspacePath);
        
        assert.ok(capturedEnv, 'Env should be passed to spawn');
        assert.strictEqual(capturedEnv!.PYTHONUNBUFFERED, '1', 'PYTHONUNBUFFERED should always be set');
        // LLM vars should come from process.env, not injected
    });
});

/**
 * Plan 043 - Notification Setting Tests
 * 
 * Tests for the flowbaby.notifications.showIngestionSuccess setting
 * that controls whether success notifications are shown.
 */
suite('BackgroundOperationManager - Notification Setting (Plan 043)', () => {
    let workspacePath: string;
    let context: vscode.ExtensionContext;
    let output: vscode.OutputChannel;
    let outputLines: string[];
    let manager: BackgroundOperationManager;
    let infoStub: sinon.SinonStub;
    let warnStub: sinon.SinonStub;
    let configStub: sinon.SinonStub;
    let cloudProviderStub: sinon.SinonStub;
    let cloudEnvStub: sinon.SinonStub;

    const resetSingleton = () => {
        (BackgroundOperationManager as unknown as { instance?: BackgroundOperationManager }).instance = undefined;
    };

    setup(async () => {
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cognee-notify-'));
        outputLines = [];
        
        // Plan 086: Stub Cloud provider to avoid auth requirement in tests
        cloudProviderStub = sinon.stub(cloudProvider, 'isProviderInitialized').returns(true);
        cloudEnvStub = sinon.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
            AWS_ACCESS_KEY_ID: 'test-access-key',
            AWS_SECRET_ACCESS_KEY: 'test-secret-key',
            AWS_SESSION_TOKEN: 'test-session-token',
            AWS_REGION: 'us-east-1',
            FLOWBABY_CLOUD_MODE: 'true',
            LLM_PROVIDER: 'bedrock',
            EMBEDDING_PROVIDER: 'bedrock',
            LLM_MODEL: 'anthropic.claude-3-haiku-20240307-v1:0',
            EMBEDDING_MODEL: 'bedrock/amazon.titan-embed-text-v2:0',
            EMBEDDING_DIMENSIONS: '1024',
        });
        
        context = {
            subscriptions: [],
            globalState: {
                get: sinon.stub().returns(undefined),
                update: sinon.stub().resolves()
            },
            secrets: {
                get: sinon.stub().resolves(undefined),
                store: sinon.stub().resolves(),
                delete: sinon.stub().resolves(),
                onDidChange: sinon.stub()
            }
        } as unknown as vscode.ExtensionContext;
        output = {
            appendLine: (line: string) => { outputLines.push(line); }
        } as unknown as vscode.OutputChannel;

        resetSingleton();
        manager = BackgroundOperationManager.initialize(context, output);
        await manager.initializeForWorkspace(workspacePath);

        infoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined as any);
        warnStub = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined as any);
        configStub = sinon.stub(vscode.workspace, 'getConfiguration');
    });

    teardown(async () => {
        cloudProviderStub.restore();
        cloudEnvStub.restore();
        infoStub.restore();
        warnStub.restore();
        configStub.restore();
        await manager.shutdown();
        resetSingleton();
        fs.rmSync(workspacePath, { recursive: true, force: true });
    });

    test('success notification is shown when showIngestionSuccess is true (default)', async () => {
        // Configure setting to be true (default behavior)
        configStub.withArgs('flowbaby.notifications').returns({
            get: (key: string, defaultValue: boolean) => {
                if (key === 'showIngestionSuccess') { return true; }
                return defaultValue;
            }
        });
        // Need to return empty object for other config calls
        configStub.withArgs('Flowbaby.llm').returns({ get: () => undefined });

        // Create and start an operation
        const spawnStub = sinon.stub(manager as any, 'spawnCognifyProcess').callsFake(async (...args: unknown[]) => {
            const operationId = args[0] as string;
            const entry = manager.getStatus(operationId) as OperationEntry;
            entry.status = 'running';
            entry.pid = 12345;
            entry.lastUpdate = new Date().toISOString();
        });

        const payload = { type: 'summary' as const, summary: { topic: 'test', context: 'test context' } };
        const opId = await manager.startOperation('test summary', workspacePath, '/usr/bin/python3', 'ingest.py', payload);
        
        // Complete the operation with success
        await manager.completeOperation(opId, { elapsedMs: 1000, entityCount: 5 });

        // Verify showInformationMessage was called (success notification shown)
        assert.ok(infoStub.called, 'showInformationMessage should be called when setting is true');
        assert.ok(infoStub.calledWith('✅ Flowbaby processing finished'), 'Should show correct success message');

        spawnStub.restore();
    });

    test('records usage metering on successful cognify completion (status stub path)', async () => {
        configStub.withArgs('flowbaby.notifications').returns({
            get: (_key: string, defaultValue: boolean) => defaultValue
        });
        configStub.withArgs('Flowbaby.llm').returns({ get: () => undefined });

        const recordOperationStub = sinon.stub().resolves({
            success: true,
            skipped: true,
            reason: 'test'
        });
        const getMeterStub = sinon.stub(usageMeter, 'getUsageMeter').returns({
            recordOperation: recordOperationStub
        } as unknown as usageMeter.IUsageMeter);

        const spawnStub = sinon.stub(manager as any, 'spawnCognifyProcess').callsFake(async (...args: unknown[]) => {
            const operationId = args[0] as string;
            const entry = manager.getStatus(operationId) as OperationEntry;
            entry.status = 'running';
            entry.pid = 12345;
            entry.lastUpdate = new Date().toISOString();
        });

        try {
            const payload = { type: 'summary' as const, summary: { topic: 'test', context: 'test context' } };
            const opId = await manager.startOperation('test summary', workspacePath, '/usr/bin/python3', 'ingest.py', payload);

            const stubDir = path.join(workspacePath, '.flowbaby', 'background_ops');
            fs.mkdirSync(stubDir, { recursive: true });
            fs.writeFileSync(
                path.join(stubDir, `${opId}.json`),
                JSON.stringify({
                    success: true,
                    entity_count: 5,
                    elapsed_ms: 1000
                })
            );

            await (manager as any).processStatusStub(opId, workspacePath, false);

            assert.ok(recordOperationStub.calledOnce, 'background cognify completion should record usage metering');
            assert.strictEqual(recordOperationStub.firstCall.args[0], 'embed');
            assert.match(
                recordOperationStub.firstCall.args[1] as string,
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            );
        } finally {
            spawnStub.restore();
            getMeterStub.restore();
        }
    });

    test('success notification is suppressed when showIngestionSuccess is false', async () => {
        // Configure setting to be false
        configStub.withArgs('flowbaby.notifications').returns({
            get: (key: string, defaultValue: boolean) => {
                if (key === 'showIngestionSuccess') { return false; }
                return defaultValue;
            }
        });
        configStub.withArgs('Flowbaby.llm').returns({ get: () => undefined });

        // Create and start an operation
        const spawnStub = sinon.stub(manager as any, 'spawnCognifyProcess').callsFake(async (...args: unknown[]) => {
            const operationId = args[0] as string;
            const entry = manager.getStatus(operationId) as OperationEntry;
            entry.status = 'running';
            entry.pid = 12345;
            entry.lastUpdate = new Date().toISOString();
        });

        const payload = { type: 'summary' as const, summary: { topic: 'test', context: 'test context' } };
        const opId = await manager.startOperation('test summary', workspacePath, '/usr/bin/python3', 'ingest.py', payload);
        
        // Complete the operation with success
        await manager.completeOperation(opId, { elapsedMs: 1000, entityCount: 5 });

        // Verify showInformationMessage was NOT called (success notification suppressed)
        assert.ok(!infoStub.called, 'showInformationMessage should NOT be called when setting is false');
        
        // Verify log message indicates suppression
        const suppressionLog = outputLines.find(line => line.includes('Success notification suppressed'));
        assert.ok(suppressionLog, 'Should log that success notification was suppressed');
        assert.ok(suppressionLog!.includes('flowbaby.notifications.showIngestionSuccess=false'), 'Log should mention the setting');

        spawnStub.restore();
    });

    test('failure notification is ALWAYS shown regardless of showIngestionSuccess setting', async () => {
        // Configure showIngestionSuccess to false
        configStub.withArgs('flowbaby.notifications').returns({
            get: (key: string, defaultValue: boolean) => {
                if (key === 'showIngestionSuccess') { return false; }
                return defaultValue;
            }
        });
        configStub.withArgs('Flowbaby.llm').returns({ get: () => undefined });

        // Create and start an operation
        const spawnStub = sinon.stub(manager as any, 'spawnCognifyProcess').callsFake(async (...args: unknown[]) => {
            const operationId = args[0] as string;
            const entry = manager.getStatus(operationId) as OperationEntry;
            entry.status = 'running';
            entry.pid = 12345;
            entry.lastUpdate = new Date().toISOString();
        });

        const payload = { type: 'summary' as const, summary: { topic: 'test', context: 'test context' } };
        const opId = await manager.startOperation('test summary', workspacePath, '/usr/bin/python3', 'ingest.py', payload);
        
        // Mark operation as failed
        await manager.failOperation(opId, {
            code: 'COGNEE_INTERNAL_ERROR',
            message: 'Test failure',
            remediation: 'Check the logs'
        });

        // Verify warning message WAS called (failure notification always shown)
        assert.ok(warnStub.called, 'showWarningMessage should ALWAYS be called for failures');
        assert.ok(warnStub.calledWith('⚠️ Flowbaby processing failed'), 'Should show correct failure message');

        spawnStub.restore();
    });

    test('success notification respects default value of true when setting is undefined', async () => {
        // Configure setting to return undefined (should default to true)
        configStub.withArgs('flowbaby.notifications').returns({
            get: (key: string, defaultValue: boolean) => {
                if (key === 'showIngestionSuccess') { return defaultValue; } // Returns the default (true)
                return defaultValue;
            }
        });
        configStub.withArgs('Flowbaby.llm').returns({ get: () => undefined });

        // Create and start an operation
        const spawnStub = sinon.stub(manager as any, 'spawnCognifyProcess').callsFake(async (...args: unknown[]) => {
            const operationId = args[0] as string;
            const entry = manager.getStatus(operationId) as OperationEntry;
            entry.status = 'running';
            entry.pid = 12345;
            entry.lastUpdate = new Date().toISOString();
        });

        const payload = { type: 'summary' as const, summary: { topic: 'test', context: 'test context' } };
        const opId = await manager.startOperation('test summary', workspacePath, '/usr/bin/python3', 'ingest.py', payload);
        
        // Complete the operation with success
        await manager.completeOperation(opId, { elapsedMs: 1000, entityCount: 5 });

        // Verify showInformationMessage was called (default is true)
        assert.ok(infoStub.called, 'showInformationMessage should be called when setting defaults to true');

        spawnStub.restore();
    });
});

/**
 * Plan 092 M5 - Auto-Retry for Cognify Daemon Failures
 * 
 * Tests for automatic retry of cognify operations when daemon fails,
 * using explicit subprocess path instead of daemon.
 */
suite('BackgroundOperationManager - Cognify Daemon Auto-Retry (Plan 092)', () => {
    let workspacePath: string;
    let context: vscode.ExtensionContext;
    let output: vscode.OutputChannel;
    let manager: BackgroundOperationManager;
    let sandbox: sinon.SinonSandbox;
    let outputLines: string[];
    let cloudProviderStub: sinon.SinonStub;
    let cloudEnvStub: sinon.SinonStub;
    let meteringStub: sinon.SinonStub;
    let warnStub: sinon.SinonStub;

    const resetSingleton = () => {
        (BackgroundOperationManager as unknown as { instance?: BackgroundOperationManager }).instance = undefined;
    };

    setup(async () => {
        sandbox = sinon.createSandbox();
        outputLines = [];
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cognee-retry-'));
        
        // Stub Cloud provider
        cloudProviderStub = sandbox.stub(cloudProvider, 'isProviderInitialized').returns(true);
        cloudEnvStub = sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
            AWS_ACCESS_KEY_ID: 'test-access-key',
            AWS_SECRET_ACCESS_KEY: 'test-secret-key',
            AWS_SESSION_TOKEN: 'test-session-token',
            AWS_REGION: 'us-east-1',
            FLOWBABY_CLOUD_MODE: 'true'
        });
        
        // Stub usage meter
        meteringStub = sandbox.stub(usageMeter, 'getUsageMeter').returns({
            recordOperation: sandbox.stub().resolves({ success: true, skipped: false, usedCredits: 1, remaining: 99 })
        } as unknown as ReturnType<typeof usageMeter.getUsageMeter>);
        
        warnStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined as any);
        sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as any);
        
        context = {
            subscriptions: [],
            globalState: {
                get: sandbox.stub().returns(undefined),
                update: sandbox.stub().resolves()
            }
        } as unknown as vscode.ExtensionContext;
        
        output = {
            appendLine: (line: string) => outputLines.push(line)
        } as unknown as vscode.OutputChannel;

        resetSingleton();
        manager = BackgroundOperationManager.initialize(context, output);
        await manager.initializeForWorkspace(workspacePath);
    });

    teardown(async () => {
        sandbox.restore();
        await manager.shutdown();
        resetSingleton();
        if (fs.existsSync(workspacePath)) {
            fs.rmSync(workspacePath, { recursive: true, force: true });
        }
    });

    test('AUTO_RETRY_COUNT constant is defined', () => {
        // The constant should be accessible as a private field
        const anyManager = manager as any;
        assert.strictEqual(typeof anyManager.AUTO_RETRY_COUNT, 'number', 'AUTO_RETRY_COUNT should be defined');
        assert.strictEqual(anyManager.AUTO_RETRY_COUNT, 1, 'AUTO_RETRY_COUNT should be 1');
    });

    test('AUTO_RETRY_DELAY_MS constant is defined', () => {
        const anyManager = manager as any;
        assert.strictEqual(typeof anyManager.AUTO_RETRY_DELAY_MS, 'number', 'AUTO_RETRY_DELAY_MS should be defined');
        assert.ok(anyManager.AUTO_RETRY_DELAY_MS >= 1000, 'AUTO_RETRY_DELAY_MS should be at least 1000ms');
        assert.ok(anyManager.AUTO_RETRY_DELAY_MS <= 5000, 'AUTO_RETRY_DELAY_MS should not exceed 5000ms');
    });

    test('OperationEntry has retryCount field', async () => {
        const spawnStub = sandbox.stub(manager as any, 'spawnCognifyProcess').callsFake(async (...args: unknown[]) => {
            const operationId = args[0] as string;
            const entry = manager.getStatus(operationId) as OperationEntry;
            entry.status = 'running';
            entry.pid = 12345;
        });

        const payload = { type: 'summary' as const, summary: { topic: 'test', context: 'context' } };
        const opId = await manager.startOperation('test summary', workspacePath, '/usr/bin/python3', 'ingest.py', payload);
        
        const entry = manager.getStatus(opId) as OperationEntry;
        assert.strictEqual(typeof (entry as any).retryCount, 'number', 'Entry should have retryCount field');
        assert.strictEqual((entry as any).retryCount, 0, 'Initial retryCount should be 0');
        
        spawnStub.restore();
    });

    test('daemon failure triggers auto-retry via subprocess', async () => {
        // Set up a fake daemon manager that will fail
        const fakeDaemonManager = {
            isDaemonEnabled: () => true,
            isHealthy: () => true,
            sendRequest: sandbox.stub().rejects(new Error('Daemon connection lost'))
        };
        manager.setDaemonManager(fakeDaemonManager as any);

        // Stub the spawnCognifyProcess but let it call through for the initial call
        // then track when it's called with forceSubprocess=true
        let retryCallCount = 0;
        const originalSpawnCognify = (manager as any).spawnCognifyProcess.bind(manager);
        const spawnStub = sandbox.stub(manager as any, 'spawnCognifyProcess').callsFake(async (...args: unknown[]) => {
            const operationId = args[0] as string;
            const forceSubprocess = args[4] as boolean;
            
            if (forceSubprocess) {
                // This is the retry call - mark it
                retryCallCount++;
                const entry = manager.getStatus(operationId) as OperationEntry;
                entry.status = 'completed';
                entry.lastUpdate = new Date().toISOString();
                return;
            }
            
            // Let original run for daemon path
            return originalSpawnCognify(...args);
        });

        const payload = { type: 'summary' as const, summary: { topic: 'test', context: 'context' } };
        await manager.startOperation('test summary', workspacePath, '/usr/bin/python3', 'ingest.py', payload);

        // Wait for async daemon call to complete and trigger retry
        await new Promise(resolve => setTimeout(resolve, 4000));

        // Verify daemon was attempted first
        assert.ok(fakeDaemonManager.sendRequest.calledOnce, 'Daemon should be attempted first');
        
        // Verify subprocess was called as retry (with forceSubprocess=true)
        assert.strictEqual(retryCallCount, 1, 'Subprocess should be spawned after daemon failure with forceSubprocess=true');
        
        // Verify log contains auto-retry message
        const retryLog = outputLines.find(line => line.includes('Auto-retrying with subprocess'));
        assert.ok(retryLog, 'Should log auto-retry message');
    });

    test('auto-retry logs include attempt number', async () => {
        const fakeDaemonManager = {
            isDaemonEnabled: () => true,
            isHealthy: () => true,
            sendRequest: sandbox.stub().rejects(new Error('Daemon timeout'))
        };
        manager.setDaemonManager(fakeDaemonManager as any);

        const originalSpawnCognify = (manager as any).spawnCognifyProcess.bind(manager);
        const spawnStub = sandbox.stub(manager as any, 'spawnCognifyProcess').callsFake(async (...args: unknown[]) => {
            const operationId = args[0] as string;
            const forceSubprocess = args[4] as boolean;
            
            if (forceSubprocess) {
                const entry = manager.getStatus(operationId) as OperationEntry;
                entry.status = 'completed';
                return;
            }
            return originalSpawnCognify(...args);
        });

        const payload = { type: 'summary' as const, summary: { topic: 'test', context: 'context' } };
        await manager.startOperation('test summary', workspacePath, '/usr/bin/python3', 'ingest.py', payload);

        await new Promise(resolve => setTimeout(resolve, 4000));

        // Verify log includes attempt number
        const retryLog = outputLines.find(line => line.includes('attempt 1'));
        assert.ok(retryLog, 'Auto-retry log should include attempt number');
    });

    test('auto-retry exhausted shows failure notification', async () => {
        const fakeDaemonManager = {
            isDaemonEnabled: () => true,
            isHealthy: () => true,
            sendRequest: sandbox.stub().rejects(new Error('Daemon crashed'))
        };
        manager.setDaemonManager(fakeDaemonManager as any);

        // Make subprocess also fail
        const spawnStub = sandbox.stub(manager as any, 'spawnCognifyProcess').callsFake(async (...args: unknown[]) => {
            const operationId = args[0] as string;
            await manager.failOperation(operationId, {
                code: 'COGNEE_INTERNAL_ERROR',
                message: 'Subprocess also failed',
                remediation: 'Check logs'
            });
        });

        const payload = { type: 'summary' as const, summary: { topic: 'test', context: 'context' } };
        await manager.startOperation('test summary', workspacePath, '/usr/bin/python3', 'ingest.py', payload);

        await new Promise(resolve => setTimeout(resolve, 3000));

        // Verify warning notification was shown (failure after retry exhausted)
        assert.ok(warnStub.called, 'Warning should be shown when auto-retry fails');
    });

    test('retryCount is incremented on auto-retry', async () => {
        const fakeDaemonManager = {
            isDaemonEnabled: () => true,
            isHealthy: () => true,
            sendRequest: sandbox.stub().rejects(new Error('Daemon error'))
        };
        manager.setDaemonManager(fakeDaemonManager as any);

        let capturedEntry: OperationEntry | null = null;
        const originalSpawnCognify = (manager as any).spawnCognifyProcess.bind(manager);
        const spawnStub = sandbox.stub(manager as any, 'spawnCognifyProcess').callsFake(async (...args: unknown[]) => {
            const operationId = args[0] as string;
            const forceSubprocess = args[4] as boolean;
            
            if (forceSubprocess) {
                // Capture the entry when retry is called
                capturedEntry = manager.getStatus(operationId) as OperationEntry;
                capturedEntry.status = 'completed';
                return;
            }
            return originalSpawnCognify(...args);
        });

        const payload = { type: 'summary' as const, summary: { topic: 'test', context: 'context' } };
        await manager.startOperation('test summary', workspacePath, '/usr/bin/python3', 'ingest.py', payload);

        await new Promise(resolve => setTimeout(resolve, 4000));

        // Verify retryCount was incremented
        assert.ok(capturedEntry, 'Entry should be captured');
        assert.strictEqual((capturedEntry as any).retryCount, 1, 'retryCount should be 1 after auto-retry');
    });
});
