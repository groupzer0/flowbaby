import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { BackgroundOperationManager, OperationEntry } from '../background/BackgroundOperationManager';

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
 * Plan 031 - API Key Resolution and LLM Environment Tests
 * 
 * Tests for the new resolveApiKey() and getLLMEnvironment() methods
 * that implement the priority chain: .env > SecretStorage > process.env
 */
suite('BackgroundOperationManager - API Key Resolution (Plan 031)', () => {
    let workspacePath: string;
    let context: vscode.ExtensionContext;
    let output: vscode.OutputChannel;
    let manager: BackgroundOperationManager;
    let secretsStub: sinon.SinonStubbedInstance<vscode.SecretStorage>;

    const resetSingleton = () => {
        (BackgroundOperationManager as unknown as { instance?: BackgroundOperationManager }).instance = undefined;
    };

    setup(async () => {
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cognee-apikey-'));
        
        // Create mock secrets storage
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
        await manager.shutdown();
        resetSingleton();
        fs.rmSync(workspacePath, { recursive: true, force: true });
        // Restore any process.env changes
        delete process.env.LLM_API_KEY;
    });

    // Plan 039 M5: Removed .env support - SecretStorage is now Priority 1
    test('resolveApiKey uses SecretStorage as primary source (Plan 039 M5)', async () => {
        // Create .env file with API key (should be IGNORED per Plan 039 M5)
        const envContent = 'LLM_API_KEY=env-file-key-123\nOTHER_VAR=value';
        fs.writeFileSync(path.join(workspacePath, '.env'), envContent);
        
        // Set SecretStorage to return a different key
        secretsStub.get.resolves('secret-storage-key-456');
        
        // Set process.env to a third key
        process.env.LLM_API_KEY = 'process-env-key-789';
        
        // Call resolveApiKey (private method, access via prototype)
        const apiKey = await (manager as any).resolveApiKey(workspacePath);
        
        // SecretStorage should be used (not .env) per Plan 039 M5
        assert.strictEqual(apiKey, 'secret-storage-key-456', 'SecretStorage should have highest priority (Plan 039 M5 removed .env support)');
    });

    test('resolveApiKey uses SecretStorage when no .env file exists', async () => {
        // No .env file created
        
        // Set SecretStorage to return a key
        secretsStub.get.resolves('secret-storage-key-456');
        
        // Set process.env as fallback
        process.env.LLM_API_KEY = 'process-env-key-789';
        
        const apiKey = await (manager as any).resolveApiKey(workspacePath);
        
        assert.strictEqual(apiKey, 'secret-storage-key-456', 'SecretStorage should be used when .env missing');
        sinon.assert.calledWith(secretsStub.get, 'flowbaby.llmApiKey');
    });

    test('resolveApiKey uses process.env when .env and SecretStorage are empty', async () => {
        // No .env file
        
        // SecretStorage returns undefined
        secretsStub.get.resolves(undefined);
        
        // Set process.env
        process.env.LLM_API_KEY = 'process-env-key-789';
        
        const apiKey = await (manager as any).resolveApiKey(workspacePath);
        
        assert.strictEqual(apiKey, 'process-env-key-789', 'process.env should be final fallback');
    });

    test('resolveApiKey returns undefined when no key is available', async () => {
        // No .env file
        // SecretStorage empty
        secretsStub.get.resolves(undefined);
        // process.env empty
        delete process.env.LLM_API_KEY;
        
        const apiKey = await (manager as any).resolveApiKey(workspacePath);
        
        assert.strictEqual(apiKey, undefined, 'Should return undefined when no key available');
    });

    test('resolveApiKey handles malformed .env file gracefully', async () => {
        // Create malformed .env file
        fs.writeFileSync(path.join(workspacePath, '.env'), 'NOT_VALID_FORMAT\n===broken');
        
        // SecretStorage has a key
        secretsStub.get.resolves('secret-storage-key-456');
        
        const apiKey = await (manager as any).resolveApiKey(workspacePath);
        
        // Should fall through to SecretStorage since .env has no LLM_API_KEY
        assert.strictEqual(apiKey, 'secret-storage-key-456', 'Should fall back to SecretStorage on malformed .env');
    });

    test('resolveApiKey ignores .env without LLM_API_KEY', async () => {
        // Create .env file without the key we need
        fs.writeFileSync(path.join(workspacePath, '.env'), 'OTHER_KEY=value\nANOTHER=123');
        
        // SecretStorage has the key
        secretsStub.get.resolves('secret-storage-key-456');
        
        const apiKey = await (manager as any).resolveApiKey(workspacePath);
        
        assert.strictEqual(apiKey, 'secret-storage-key-456', 'Should use SecretStorage when .env lacks LLM_API_KEY');
    });
});

suite('BackgroundOperationManager - getLLMEnvironment (Plan 031)', () => {
    let workspacePath: string;
    let context: vscode.ExtensionContext;
    let output: vscode.OutputChannel;
    let manager: BackgroundOperationManager;
    let secretsStub: sinon.SinonStubbedInstance<vscode.SecretStorage>;
    let configStub: sinon.SinonStub;

    const resetSingleton = () => {
        (BackgroundOperationManager as unknown as { instance?: BackgroundOperationManager }).instance = undefined;
    };

    setup(async () => {
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cognee-llmenv-'));
        
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
        configStub.restore();
        await manager.shutdown();
        resetSingleton();
        fs.rmSync(workspacePath, { recursive: true, force: true });
        delete process.env.LLM_API_KEY;
    });

    test('getLLMEnvironment returns complete LLM config', async () => {
        // Plan 039 M5: Use SecretStorage instead of .env file
        secretsStub.get.resolves('test-key-xyz');
        
        // Mock VS Code configuration
        const mockConfig = {
            get: (key: string) => {
                switch (key) {
                    case 'provider': return 'openai';
                    case 'model': return 'gpt-4';
                    case 'endpoint': return 'https://api.openai.com/v1';
                    default: return undefined;
                }
            }
        };
        configStub.withArgs('Flowbaby.llm').returns(mockConfig);
        
        const env = await (manager as any).getLLMEnvironment(workspacePath);
        
        assert.strictEqual(env.LLM_API_KEY, 'test-key-xyz');
        assert.strictEqual(env.LLM_PROVIDER, 'openai');
        assert.strictEqual(env.LLM_MODEL, 'gpt-4');
        assert.strictEqual(env.LLM_ENDPOINT, 'https://api.openai.com/v1');
    });

    test('getLLMEnvironment omits missing config values', async () => {
        // No .env file
        secretsStub.get.resolves(undefined);
        
        // Mock config with only provider set
        const mockConfig = {
            get: (key: string) => {
                if (key === 'provider') { return 'anthropic'; }
                return undefined;
            }
        };
        configStub.withArgs('Flowbaby.llm').returns(mockConfig);
        
        const env = await (manager as any).getLLMEnvironment(workspacePath);
        
        assert.strictEqual(env.LLM_API_KEY, undefined, 'No key should be set');
        assert.strictEqual(env.LLM_PROVIDER, 'anthropic');
        assert.strictEqual(env.LLM_MODEL, undefined, 'Unset config should not appear');
        assert.strictEqual(env.LLM_ENDPOINT, undefined, 'Unset config should not appear');
    });

    test('getLLMEnvironment returns empty object when no config', async () => {
        // No API key anywhere
        secretsStub.get.resolves(undefined);
        
        // Empty config
        const mockConfig = { get: () => undefined };
        configStub.withArgs('Flowbaby.llm').returns(mockConfig);
        
        const env = await (manager as any).getLLMEnvironment(workspacePath);
        
        assert.deepStrictEqual(env, {}, 'Should return empty object when no config');
    });
});

suite('BackgroundOperationManager - runPythonJson Env Injection (Plan 031)', () => {
    let workspacePath: string;
    let context: vscode.ExtensionContext;
    let output: vscode.OutputChannel;
    let manager: BackgroundOperationManager;
    let secretsStub: sinon.SinonStubbedInstance<vscode.SecretStorage>;
    let configStub: sinon.SinonStub;
    let spawnStub: sinon.SinonStub;

    const resetSingleton = () => {
        (BackgroundOperationManager as unknown as { instance?: BackgroundOperationManager }).instance = undefined;
    };

    setup(async () => {
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cognee-runjson-'));
        
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
        configStub.restore();
        if (spawnStub) { spawnStub.restore(); }
        await manager.shutdown();
        resetSingleton();
        fs.rmSync(workspacePath, { recursive: true, force: true });
        delete process.env.LLM_API_KEY;
    });

    test('runPythonJson injects LLM environment when workspacePath provided', async () => {
        // Plan 039 M5: Use SecretStorage instead of .env file
        secretsStub.get.resolves('injected-key-abc');
        
        // Mock config
        const mockConfig = { get: (key: string) => key === 'provider' ? 'openai' : undefined };
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
        assert.strictEqual(capturedEnv!.LLM_API_KEY, 'injected-key-abc', 'LLM_API_KEY should be injected');
        assert.strictEqual(capturedEnv!.LLM_PROVIDER, 'openai', 'LLM_PROVIDER should be injected');
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
