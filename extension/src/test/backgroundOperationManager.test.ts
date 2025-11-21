import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { BackgroundOperationManager, OperationEntry } from '../background/BackgroundOperationManager';

suite('BackgroundOperationManager', () => {
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
            /429_COGNIFY_BACKLOG/
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
