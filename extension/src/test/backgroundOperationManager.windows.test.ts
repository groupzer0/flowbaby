
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { BackgroundOperationManager } from '../background/BackgroundOperationManager';
import { ChildProcess } from 'child_process';
import * as cloudProvider from '../flowbaby-cloud/provider';

suite('BackgroundOperationManager - Windows Specific', () => {
    let workspacePath: string;
    let context: vscode.ExtensionContext;
    let output: vscode.OutputChannel;
    let manager: BackgroundOperationManager;
    let sandbox: sinon.SinonSandbox;
    let originalPlatform: string;

    const resetSingleton = () => {
        (BackgroundOperationManager as unknown as { instance?: BackgroundOperationManager }).instance = undefined;
    };

    setup(async () => {
        sandbox = sinon.createSandbox();
        
        // Plan 081: Stub Cloud provider to avoid auth requirement in tests
        sandbox.stub(cloudProvider, 'isProviderInitialized').returns(true);
        sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
            AWS_ACCESS_KEY_ID: 'test-access-key',
            AWS_SECRET_ACCESS_KEY: 'test-secret-key',
            AWS_SESSION_TOKEN: 'test-session-token',
            AWS_REGION: 'us-east-1',
            FLOWBABY_CLOUD_MODE: 'true'
        });
        
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cognee-bom-win-'));
        context = {
            subscriptions: [],
            secrets: { get: sinon.stub().resolves(undefined) },
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

        // Mock process.platform
        originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', {
            value: 'win32'
        });
    });

    teardown(async () => {
        Object.defineProperty(process, 'platform', {
            value: originalPlatform
        });
        sandbox.restore();
        await manager.shutdown();
        resetSingleton();
        if (fs.existsSync(workspacePath)) {
            fs.rmSync(workspacePath, { recursive: true, force: true });
        }
    });

    test('switches to pythonw.exe on Windows when python.exe is used', async () => {
        const pythonPath = 'C:\\path\\to\\python.exe';
        const pythonwPath = 'C:\\path\\to\\pythonw.exe';
        const bridgePath = path.join(workspacePath, 'bridge', 'ingest.py');

        // Mock checkFileExists to return true for pythonw.exe
        const checkFileExistsStub = sandbox.stub(manager, 'checkFileExists');
        checkFileExistsStub.withArgs(pythonwPath).returns(true);
        checkFileExistsStub.callThrough();

        // Mock spawn to avoid actual process creation
        const spawnStub = sandbox.stub(require('child_process'), 'spawn').returns({
            pid: 12345,
            unref: () => {},
            on: () => {},
            stdout: { on: () => {} },
            stderr: { on: () => {} },
            kill: () => {}
        } as unknown as ChildProcess);

        const payload = {
            type: 'summary' as const,
            summary: { topic: 'test', context: 'context' }
        };

        const opId = await manager.startOperation('test summary', workspacePath, pythonPath, bridgePath, payload);

        // Verify spawn was called with pythonw.exe
        assert.ok(spawnStub.calledOnce, 'spawn should be called once');
        const spawnArgs = spawnStub.firstCall.args;
        assert.strictEqual(spawnArgs[0], pythonwPath, 'Should use pythonw.exe');
        
        // Verify windowsHide option
        const spawnOptions = spawnArgs[2];
        assert.strictEqual(spawnOptions.windowsHide, true, 'Should set windowsHide: true');

        // Verify entry was updated
        const entry = manager.getStatus(opId);
        if (!Array.isArray(entry)) {
            assert.strictEqual(entry.pythonPath, pythonwPath, 'Entry pythonPath should be updated');
        }
    });

    test('does not switch if pythonw.exe does not exist', async () => {
        const pythonPath = 'C:\\path\\to\\python.exe';
        const pythonwPath = 'C:\\path\\to\\pythonw.exe';
        const bridgePath = path.join(workspacePath, 'bridge', 'ingest.py');

        // Mock checkFileExists to return false for pythonw.exe
        const checkFileExistsStub = sandbox.stub(manager, 'checkFileExists');
        checkFileExistsStub.withArgs(pythonwPath).returns(false);
        checkFileExistsStub.callThrough();

        // Mock spawn
        const spawnStub = sandbox.stub(require('child_process'), 'spawn').returns({
            pid: 12345,
            unref: () => {},
            on: () => {},
            stdout: { on: () => {} },
            stderr: { on: () => {} },
            kill: () => {}
        } as unknown as ChildProcess);

        const payload = {
            type: 'summary' as const,
            summary: { topic: 'test', context: 'context' }
        };

        await manager.startOperation('test summary', workspacePath, pythonPath, bridgePath, payload);

        // Verify spawn was called with original python.exe
        assert.ok(spawnStub.calledOnce);
        const spawnArgs = spawnStub.firstCall.args;
        assert.strictEqual(spawnArgs[0], pythonPath, 'Should keep python.exe');
        
        // Verify windowsHide option is still set
        const spawnOptions = spawnArgs[2];
        assert.strictEqual(spawnOptions.windowsHide, true, 'Should set windowsHide: true');
    });
});
