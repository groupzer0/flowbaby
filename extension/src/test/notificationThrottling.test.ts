import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { BackgroundOperationManager, OperationEntry } from '../background/BackgroundOperationManager';

suite('BackgroundOperationManager - Notification Throttling Removal', () => {
    let workspacePath: string;
    let context: vscode.ExtensionContext;
    let output: vscode.OutputChannel;
    let outputLines: string[];
    let manager: BackgroundOperationManager;
    let infoStub: sinon.SinonStub;
    let warnStub: sinon.SinonStub;
    let configStub: sinon.SinonStub;

    const resetSingleton = () => {
        (BackgroundOperationManager as unknown as { instance?: BackgroundOperationManager }).instance = undefined;
    };

    setup(async () => {
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cognee-notify-'));
        outputLines = [];
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
        infoStub.restore();
        warnStub.restore();
        configStub.restore();
        await manager.shutdown();
        resetSingleton();
        fs.rmSync(workspacePath, { recursive: true, force: true });
    });

    test('success notifications are NOT throttled (user request)', async () => {
        // Configure setting to be true
        configStub.withArgs('flowbaby.notifications').returns({
            get: (key: string, defaultValue: boolean) => {
                if (key === 'showIngestionSuccess') { return true; }
                return defaultValue;
            }
        });
        configStub.withArgs('Flowbaby.llm').returns({ get: () => undefined });

        const spawnStub = sinon.stub(manager as any, 'spawnCognifyProcess').callsFake(async (...args: unknown[]) => {
            const operationId = args[0] as string;
            const entry = manager.getStatus(operationId) as OperationEntry;
            entry.status = 'running';
            entry.pid = 12345;
            entry.lastUpdate = new Date().toISOString();
        });

        const payload = { type: 'summary' as const, summary: { topic: 'test', context: 'test context' } };
        
        // First operation
        const opId1 = await manager.startOperation('test summary 1', workspacePath, '/usr/bin/python3', 'ingest.py', payload);
        await manager.completeOperation(opId1, { elapsedMs: 1000, entityCount: 5 });

        // Second operation (immediately after)
        const opId2 = await manager.startOperation('test summary 2', workspacePath, '/usr/bin/python3', 'ingest.py', payload);
        await manager.completeOperation(opId2, { elapsedMs: 1000, entityCount: 5 });

        // Verify showInformationMessage was called TWICE (no throttling)
        assert.strictEqual(infoStub.callCount, 2, 'Success notifications should NOT be throttled');

        spawnStub.restore();
    });

    test('failure notifications are NOT throttled (user request)', async () => {
        // Configure setting to be true
        configStub.withArgs('flowbaby.notifications').returns({
            get: (key: string, defaultValue: boolean) => {
                if (key === 'showIngestionSuccess') { return true; }
                return defaultValue;
            }
        });
        configStub.withArgs('Flowbaby.llm').returns({ get: () => undefined });

        const spawnStub = sinon.stub(manager as any, 'spawnCognifyProcess').callsFake(async (...args: unknown[]) => {
            const operationId = args[0] as string;
            const entry = manager.getStatus(operationId) as OperationEntry;
            entry.status = 'running';
            entry.pid = 12345;
            entry.lastUpdate = new Date().toISOString();
        });

        const payload = { type: 'summary' as const, summary: { topic: 'test', context: 'test context' } };
        
        // First operation
        const opId1 = await manager.startOperation('test summary 1', workspacePath, '/usr/bin/python3', 'ingest.py', payload);
        await manager.failOperation(opId1, { code: 'ERR', message: 'Fail 1', remediation: 'Fix it' });

        // Second operation (immediately after)
        const opId2 = await manager.startOperation('test summary 2', workspacePath, '/usr/bin/python3', 'ingest.py', payload);
        await manager.failOperation(opId2, { code: 'ERR', message: 'Fail 2', remediation: 'Fix it' });

        // Verify showWarningMessage was called TWICE (no throttling)
        assert.strictEqual(warnStub.callCount, 2, 'Failure notifications should NOT be throttled');

        spawnStub.restore();
    });
});
