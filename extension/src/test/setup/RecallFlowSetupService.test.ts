
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { RecallFlowSetupService } from '../../setup/RecallFlowSetupService';
import { EventEmitter } from 'events';

suite('RecallFlowSetupService Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let outputChannel: vscode.OutputChannel;
    let service: RecallFlowSetupService;
    let mockConfig: any;
    let spawnStub: sinon.SinonStub;
    let mockFs: { existsSync: sinon.SinonStub };

    const workspacePath = '/test/workspace';

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock output channel
        outputChannel = {
            appendLine: sandbox.stub(),
            append: sandbox.stub(),
            clear: sandbox.stub(),
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            name: 'RecallFlow Memory',
            replace: sandbox.stub()
        } as any;

        // Mock configuration
        mockConfig = {
            get: sandbox.stub()
        };
        sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig);

        // Mock fs
        mockFs = {
            existsSync: sandbox.stub()
        };

        // Mock spawn
        spawnStub = sandbox.stub();

        // Mock vscode.window
        sandbox.stub(vscode.window, 'showInformationMessage');
        sandbox.stub(vscode.window, 'showWarningMessage');
        sandbox.stub(vscode.window, 'showErrorMessage');
        sandbox.stub(vscode.window, 'withProgress').callsFake(async (options, task) => {
            return task({ report: sandbox.stub() }, new vscode.CancellationTokenSource().token);
        });

        service = new RecallFlowSetupService(
            { extensionPath: '/ext' } as any, 
            workspacePath, 
            outputChannel,
            mockFs,
            spawnStub as any
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    function createMockProcess(exitCode: number = 0, stdout: string = '', stderr: string = '') {
        const processMock = new EventEmitter() as any;
        processMock.stdout = new EventEmitter();
        processMock.stderr = new EventEmitter();
        
        // Emit events after a short delay to allow listeners to be attached
        setTimeout(() => {
            if (stdout) processMock.stdout.emit('data', stdout);
            if (stderr) processMock.stderr.emit('data', stderr);
            processMock.emit('close', exitCode);
        }, 10);

        return processMock;
    }

    test('initializeWorkspace uses configured python path if set', async () => {
        mockConfig.get.withArgs('pythonPath').returns('/custom/python');
        
        await service.initializeWorkspace();

        assert.ok((outputChannel.appendLine as sinon.SinonStub).calledWith(sinon.match(/Using configured Python path/)));
        assert.ok(spawnStub.notCalled);
    });

    test('initializeWorkspace offers to create venv if missing', async () => {
        mockConfig.get.withArgs('pythonPath').returns('python3'); // Default
        mockFs.existsSync.returns(false);
        (vscode.window.showInformationMessage as sinon.SinonStub).resolves('Create Environment');
        
        // Mock spawn for venv creation and pip install
        const venvMock = createMockProcess(0);
        const pipMock = createMockProcess(0);
        
        spawnStub.onCall(0).returns(venvMock);
        spawnStub.onCall(1).returns(pipMock);

        await service.initializeWorkspace();

        assert.ok((vscode.window.showInformationMessage as sinon.SinonStub).calledWith(sinon.match(/RecallFlow requires a Python environment/)));
        assert.ok(spawnStub.calledTwice); // venv + pip
    });

    test('initializeWorkspace verifies existing venv', async () => {
        mockConfig.get.withArgs('pythonPath').returns('python3');
        mockFs.existsSync.returns(true);
        
        // Mock verify_environment.py output
        const verifyMock = createMockProcess(0, JSON.stringify({ status: 'ok', details: {} }));
        spawnStub.returns(verifyMock);

        await service.initializeWorkspace();

        assert.ok((outputChannel.appendLine as sinon.SinonStub).calledWith(sinon.match(/Found existing .venv/)));
        assert.ok(spawnStub.calledOnce); // verify
    });

    test('createEnvironment uses platform specific python command', async () => {
        // Force platform to win32
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32' });

        try {
            const venvMock = createMockProcess(0);
            const pipMock = createMockProcess(0);
            
            spawnStub.onCall(0).returns(venvMock);
            spawnStub.onCall(1).returns(pipMock);

            await service.createEnvironment();

            const venvCall = spawnStub.firstCall;
            assert.strictEqual(venvCall.args[0], 'python');
            assert.deepStrictEqual(venvCall.args[1], ['-m', 'venv', '.venv']);
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        }
    });

    test('createEnvironment uses python3 on non-windows', async () => {
        // Force platform to linux
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux' });

        try {
            const venvMock = createMockProcess(0);
            const pipMock = createMockProcess(0);
            
            spawnStub.onCall(0).returns(venvMock);
            spawnStub.onCall(1).returns(pipMock);

            await service.createEnvironment();

            const venvCall = spawnStub.firstCall;
            assert.strictEqual(venvCall.args[0], 'python3');
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        }
    });
});
