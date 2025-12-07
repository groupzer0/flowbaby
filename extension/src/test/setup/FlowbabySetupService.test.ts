
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import { FlowbabySetupService, BridgeEnvMetadata } from '../../setup/FlowbabySetupService';
import { BackgroundOperationManager } from '../../background/BackgroundOperationManager';
import { FlowbabyStatusBar, FlowbabyStatus } from '../../statusBar/FlowbabyStatusBar';
import { EventEmitter } from 'events';

suite('FlowbabySetupService Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let outputChannel: vscode.OutputChannel;
    let service: FlowbabySetupService;
    let mockConfig: any;
    let spawnStub: sinon.SinonStub;
    let mockFs: { existsSync: sinon.SinonStub };
    let bgManagerStub: any;
    let statusBar: FlowbabyStatusBar;

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
            name: 'Flowbaby',
            replace: sandbox.stub()
        } as any;

        // Mock configuration
        mockConfig = {
            get: sandbox.stub()
        };
        sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig);

        // Mock fs.promises
        sandbox.stub(fs.promises, 'readFile');
        sandbox.stub(fs.promises, 'writeFile');
        sandbox.stub(fs.promises, 'mkdir');
        sandbox.stub(fs.promises, 'rm');
        sandbox.stub(fs.promises, 'rename');

        // Mock fs.existsSync (passed via constructor)
        mockFs = {
            existsSync: sandbox.stub()
        };

        // Mock spawn
        spawnStub = sandbox.stub();

        // Mock BackgroundOperationManager
        bgManagerStub = {
            pause: sandbox.stub().resolves(true),
            resume: sandbox.stub()
        };
        sandbox.stub(BackgroundOperationManager, 'getInstance').returns(bgManagerStub);

        // Mock vscode.window
        sandbox.stub(vscode.window, 'showInformationMessage');
        sandbox.stub(vscode.window, 'showWarningMessage');
        sandbox.stub(vscode.window, 'showErrorMessage');
        sandbox.stub(vscode.window, 'withProgress').callsFake(async (options, task) => {
            return task({ report: sandbox.stub() }, new vscode.CancellationTokenSource().token);
        });
        sandbox.stub(vscode.commands, 'executeCommand');

        statusBar = Object.create(FlowbabyStatusBar.prototype) as FlowbabyStatusBar;
        const statusStub = sandbox.stub(statusBar, 'setStatus');

        service = new FlowbabySetupService(
            { extensionPath: '/ext' } as any, 
            workspacePath, 
            outputChannel,
            mockFs,
            spawnStub as any,
            statusBar
        );
        
        // Stub computeRequirementsHash to return a fixed hash by default
        sandbox.stub(service, 'computeRequirementsHash').resolves('fixed-hash');
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
            if (stdout) {processMock.stdout.emit('data', stdout);}
            if (stderr) {processMock.stderr.emit('data', stderr);}
            processMock.emit('close', exitCode);
        }, 10);

        return processMock;
    }

    suite('checkRequirementsUpToDate', () => {
        test('returns mismatch and marks environment unverified on hash mismatch', async () => {
            const metadata: BridgeEnvMetadata = {
                pythonPath: '/test/workspace/.venv/bin/python',
                ownership: 'managed',
                requirementsHash: 'stale-hash',
                createdAt: '2025-01-01T00:00:00Z',
                platform: 'linux'
            };

            sandbox.stub(service as any, 'readBridgeEnv').resolves(metadata);
            (vscode.commands.executeCommand as sinon.SinonStub).resetHistory();

            const result = await service.checkRequirementsUpToDate();

            assert.strictEqual(result, 'mismatch');
            assert.ok((vscode.commands.executeCommand as sinon.SinonStub).calledWith('setContext', 'Flowbaby.environmentVerified', false));
            const statusBarStub = statusBar.setStatus as sinon.SinonStub;
            assert.ok(statusBarStub.calledWith(FlowbabyStatus.SetupRequired, 'Update Required'));
        });

        test('returns match and marks environment verified when hashes align', async () => {
            const metadata: BridgeEnvMetadata = {
                pythonPath: '/test/workspace/.venv/bin/python',
                ownership: 'managed',
                requirementsHash: 'fixed-hash',
                createdAt: '2025-01-01T00:00:00Z',
                platform: 'linux'
            };

            sandbox.stub(service as any, 'readBridgeEnv').resolves(metadata);
            (vscode.commands.executeCommand as sinon.SinonStub).resetHistory();

            const result = await service.checkRequirementsUpToDate();

            assert.strictEqual(result, 'match');
            assert.ok((vscode.commands.executeCommand as sinon.SinonStub).calledWith('setContext', 'Flowbaby.environmentVerified', true));
        });

        test('returns unknown when metadata is missing', async () => {
            sandbox.stub(service as any, 'readBridgeEnv').resolves(null);
            (vscode.commands.executeCommand as sinon.SinonStub).resetHistory();

            const result = await service.checkRequirementsUpToDate();

            assert.strictEqual(result, 'unknown');
            assert.ok((vscode.commands.executeCommand as sinon.SinonStub).calledWith('setContext', 'Flowbaby.environmentVerified', false));
        });
    });

    test('initializeWorkspace: Managed environment healthy', async () => {
        // Setup: bridge-env.json exists and is managed
        const metadata: BridgeEnvMetadata = {
            pythonPath: '/test/workspace/.venv/bin/python',
            ownership: 'managed',
            requirementsHash: 'fixed-hash',
            createdAt: '2025-01-01T00:00:00Z',
            platform: 'linux'
        };
        
        mockFs.existsSync.withArgs(sinon.match(/bridge-env.json/)).returns(true);
        (fs.promises.readFile as sinon.SinonStub).resolves(JSON.stringify(metadata));
        
        // Mock verification success
        const verifyMock = createMockProcess(0, JSON.stringify({ status: 'ok', details: {} }));
        spawnStub.returns(verifyMock);

        await service.initializeWorkspace();

        assert.ok((vscode.commands.executeCommand as sinon.SinonStub).calledWith('setContext', 'Flowbaby.environmentVerified', true));
        assert.ok((outputChannel.appendLine as sinon.SinonStub).calledWith(sinon.match(/Found managed environment/)));
    });

    test('initializeWorkspace: Managed environment outdated hash', async () => {
        // Setup: bridge-env.json exists but hash mismatch
        const metadata: BridgeEnvMetadata = {
            pythonPath: '/test/workspace/.venv/bin/python',
            ownership: 'managed',
            requirementsHash: 'old-hash',
            createdAt: '2025-01-01T00:00:00Z',
            platform: 'linux'
        };
        
        mockFs.existsSync.withArgs(sinon.match(/bridge-env.json/)).returns(true);
        (fs.promises.readFile as sinon.SinonStub).resolves(JSON.stringify(metadata));
        
        // Mock verification success (env is valid, just outdated deps)
        const verifyMock = createMockProcess(0, JSON.stringify({ status: 'ok', details: {} }));
        spawnStub.returns(verifyMock);

        // Mock showWarningMessage to return undefined (user ignores)
        (vscode.window.showWarningMessage as sinon.SinonStub).resolves(undefined);

        await service.initializeWorkspace();

        assert.ok((vscode.window.showWarningMessage as sinon.SinonStub).calledWith(sinon.match(/updated/)));
        // Plan 049: Strict enforcement - if user ignores update, environment remains unverified
        assert.ok((vscode.commands.executeCommand as sinon.SinonStub).calledWith('setContext', 'Flowbaby.environmentVerified', false));
        assert.ok((vscode.commands.executeCommand as sinon.SinonStub).neverCalledWith('setContext', 'Flowbaby.environmentVerified', true));
    });

    test('initializeWorkspace: No metadata, offers setup', async () => {
        mockFs.existsSync.returns(false); // No metadata
        mockConfig.get.withArgs('pythonPath').returns('python3'); // Default
        
        (vscode.window.showInformationMessage as sinon.SinonStub).resolves('Initialize Workspace');
        
        // Mock createEnvironment flow
        // 1. Check version
        const versionMock = createMockProcess(0, 'Python 3.10.0');
        // 2. Create venv
        const venvMock = createMockProcess(0);
        // 3. Install deps
        const pipMock = createMockProcess(0);
        // 4. Verify
        const verifyMock = createMockProcess(0, JSON.stringify({ status: 'ok' }));
        
        spawnStub.onCall(0).returns(versionMock);
        spawnStub.onCall(1).returns(venvMock);
        spawnStub.onCall(2).returns(pipMock);
        spawnStub.onCall(3).returns(verifyMock);

        await service.initializeWorkspace();

        assert.ok((vscode.window.showInformationMessage as sinon.SinonStub).calledWith(sinon.match(/Flowbaby requires a Python environment/)));
        assert.ok(spawnStub.callCount >= 4);
        assert.ok((fs.promises.writeFile as sinon.SinonStub).calledWith(sinon.match(/bridge-env.json/)));
    });

    test('refreshDependencies: Pauses background ops and refreshes', async () => {
        // Setup: managed env
        const metadata: BridgeEnvMetadata = {
            pythonPath: '/test/workspace/.venv/bin/python',
            ownership: 'managed',
            requirementsHash: 'old-hash',
            createdAt: '2025-01-01T00:00:00Z',
            platform: 'linux'
        };
        mockFs.existsSync.withArgs(sinon.match(/bridge-env.json/)).returns(true);
        (fs.promises.readFile as sinon.SinonStub).resolves(JSON.stringify(metadata));
        mockFs.existsSync.withArgs(sinon.match(/\.venv/)).returns(true);

        // Mock processes
        const venvMock = createMockProcess(0);
        const pipMock = createMockProcess(0);
        const verifyMock = createMockProcess(0, JSON.stringify({ status: 'ok' }));
        
        spawnStub.onCall(0).returns(venvMock);
        spawnStub.onCall(1).returns(pipMock);
        spawnStub.onCall(2).returns(verifyMock);

        await service.refreshDependencies();

        assert.ok(bgManagerStub.pause.called);
        assert.ok((fs.promises.rename as sinon.SinonStub).called); // Backup
        assert.ok(spawnStub.calledThrice);
        assert.ok(bgManagerStub.resume.called);
        assert.ok((vscode.window.showInformationMessage as sinon.SinonStub).calledWith(sinon.match(/refreshed successfully/)));
    });

    test('runCommand: Uses shell: false and does not quote args', async () => {
        const cmd = '/path with spaces/python';
        const args = ['arg with spaces', 'normal_arg'];
        
        // Mock process
        const procMock = createMockProcess(0);
        spawnStub.returns(procMock);

        // Call private method via any cast
        await (service as any).runCommand(cmd, args, workspacePath);

        assert.ok(spawnStub.calledOnce);
        const call = spawnStub.firstCall;
        
        // Plan 046: Verify shell: false and NO manual quoting
        assert.strictEqual(call.args[0], cmd); // Command passed raw
        assert.deepStrictEqual(call.args[1], args); // Args passed raw
        assert.strictEqual(call.args[2].shell, false); // shell: false
    });
});
