
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { FlowbabySetupService } from '../../setup/FlowbabySetupService';
import { BackgroundOperationManager } from '../../background/BackgroundOperationManager';

suite('FlowbabySetupService Python Detection Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let outputChannel: vscode.OutputChannel;
    let service: FlowbabySetupService;
    let mockConfig: vscode.WorkspaceConfiguration;
    let spawnStub: sinon.SinonStub;
    let execFileSyncStub: sinon.SinonStub;
    let mockFs: { existsSync: sinon.SinonStub };
    let originalPlatform: string;

    const workspacePath = '/test/workspace';

    setup(() => {
        sandbox = sinon.createSandbox();
        originalPlatform = process.platform;

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
            get: sandbox.stub().returns('')
        } as unknown as vscode.WorkspaceConfiguration;
        sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig);

        // Mock fs
        mockFs = {
            existsSync: sandbox.stub()
        };

        // Mock child_process
        spawnStub = sandbox.stub();
        // execFileSyncStub will be created on the instance

        // Mock BackgroundOperationManager
        const bgManagerStub = {
            pause: sandbox.stub().resolves(true),
            resume: sandbox.stub()
        };
        sandbox.stub(BackgroundOperationManager, 'getInstance').returns(bgManagerStub as any);

        service = new FlowbabySetupService(
            { extensionPath: '/ext' } as any, 
            workspacePath, 
            outputChannel,
            mockFs,
            spawnStub as any
        );

        // Stub execFileSync on the instance
        execFileSyncStub = sandbox.stub(service as any, 'execFileSync');
    });

    teardown(() => {
        sandbox.restore();
        Object.defineProperty(process, 'platform', {
            value: originalPlatform,
            writable: true
        });
    });

    suite('getSystemPythonCommand', () => {
        test('Windows: prefers python if available', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            execFileSyncStub.withArgs('python', ['--version']).returns('Python 3.11.0');

            const cmd = (service as any).getSystemPythonCommand();
            assert.strictEqual(cmd, 'python');
        });

        test('Windows: falls back to py if python fails', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            execFileSyncStub.withArgs('python', ['--version']).throws(new Error('Not found'));
            execFileSyncStub.withArgs('py', ['--version']).returns('Python 3.11.0');

            const cmd = (service as any).getSystemPythonCommand();
            assert.strictEqual(cmd, 'py');
        });

        test('Windows: defaults to python if both fail', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            execFileSyncStub.withArgs('python', ['--version']).throws(new Error('Not found'));
            execFileSyncStub.withArgs('py', ['--version']).throws(new Error('Not found'));

            const cmd = (service as any).getSystemPythonCommand();
            assert.strictEqual(cmd, 'python');
        });

        test('Unix: prefers python3 if available', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            execFileSyncStub.withArgs('python3', ['--version']).returns('Python 3.11.0');

            const cmd = (service as any).getSystemPythonCommand();
            assert.strictEqual(cmd, 'python3');
        });

        test('Unix: falls back to python if python3 fails', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            execFileSyncStub.withArgs('python3', ['--version']).throws(new Error('Not found'));
            execFileSyncStub.withArgs('python', ['--version']).returns('Python 3.11.0');

            const cmd = (service as any).getSystemPythonCommand();
            assert.strictEqual(cmd, 'python');
        });

        test('Unix: defaults to python3 if both fail', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            execFileSyncStub.withArgs('python3', ['--version']).throws(new Error('Not found'));
            execFileSyncStub.withArgs('python', ['--version']).throws(new Error('Not found'));

            const cmd = (service as any).getSystemPythonCommand();
            assert.strictEqual(cmd, 'python3');
        });

        test('Respects explicit configuration', () => {
            (mockConfig.get as sinon.SinonStub).withArgs('pythonPath', '').returns('/custom/python');
            const cmd = (service as any).getSystemPythonCommand();
            assert.strictEqual(cmd, '/custom/python');
        });
    });

    suite('checkPythonVersion', () => {
        test('Validates Python 3.10', async () => {
            // Mock runCommand (which uses spawn)
            // Since runCommand is private and calls spawn, we need to mock runCommand or spawn.
            // runCommand is private, so we can't easily stub it with sinon on the instance without casting.
            // But we can stub the spawn function passed to the constructor? 
            // Wait, the service uses `this.spawnFn` which is passed in constructor.
            // But `checkPythonVersion` calls `runCommand`.
            
            // Let's stub `runCommand` directly on the instance for simplicity
            const runCommandStub = sandbox.stub(service as any, 'runCommand');
            runCommandStub.resolves('Python 3.10.5');

            const isValid = await (service as any).checkPythonVersion('python');
            assert.strictEqual(isValid, true);
        });

        test('Validates Python 3.11', async () => {
            const runCommandStub = sandbox.stub(service as any, 'runCommand');
            runCommandStub.resolves('Python 3.11.9');

            const isValid = await (service as any).checkPythonVersion('python');
            assert.strictEqual(isValid, true);
        });

        test('Validates Python 3.12', async () => {
            const runCommandStub = sandbox.stub(service as any, 'runCommand');
            runCommandStub.resolves('Python 3.12.1');

            const isValid = await (service as any).checkPythonVersion('python');
            assert.strictEqual(isValid, true);
        });

        test('Rejects Python 3.9', async () => {
            const runCommandStub = sandbox.stub(service as any, 'runCommand');
            runCommandStub.resolves('Python 3.9.10');

            const isValid = await (service as any).checkPythonVersion('python');
            assert.strictEqual(isValid, false);
        });

        test('Rejects Python 3.13', async () => {
            const runCommandStub = sandbox.stub(service as any, 'runCommand');
            runCommandStub.resolves('Python 3.13.0');

            const isValid = await (service as any).checkPythonVersion('python');
            assert.strictEqual(isValid, false);
        });

        test('Rejects Python 2.7', async () => {
            const runCommandStub = sandbox.stub(service as any, 'runCommand');
            runCommandStub.resolves('Python 2.7.18');

            const isValid = await (service as any).checkPythonVersion('python');
            assert.strictEqual(isValid, false);
        });

        test('Handles execution errors gracefully', async () => {
            const runCommandStub = sandbox.stub(service as any, 'runCommand');
            runCommandStub.rejects(new Error('Command failed'));

            const isValid = await (service as any).checkPythonVersion('python');
            assert.strictEqual(isValid, false);
        });
    });
});
