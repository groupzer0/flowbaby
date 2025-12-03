
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as child_process from 'child_process';
import * as path from 'path';
import { FlowbabyClient } from '../flowbabyClient';

suite('FlowbabyClient Python Validation Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let client: FlowbabyClient;
    let execFileSyncStub: sinon.SinonStub;
    let originalPlatform: string;
    let mockContext: vscode.ExtensionContext;

    const testWorkspacePath = '/test/workspace';

    setup(() => {
        sandbox = sinon.createSandbox();
        originalPlatform = process.platform;

        // Mock VS Code configuration
        const mockConfig = {
            get: sandbox.stub().returns('')
        };
        sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

        // Mock Output Channel
        const mockOutputChannel = {
            appendLine: sandbox.stub(),
            append: sandbox.stub(),
            show: sandbox.stub(),
            dispose: sandbox.stub()
        };
        sandbox.stub(vscode.window, 'createOutputChannel').returns(mockOutputChannel as any);

        // Mock child_process.execFileSync - Stub prototype since it's called in constructor
        execFileSyncStub = sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync');

        // Mock ExtensionContext
        mockContext = {
            secrets: {
                get: sandbox.stub().resolves(undefined),
                store: sandbox.stub().resolves(),
                delete: sandbox.stub().resolves(),
                onDidChange: new vscode.EventEmitter().event
            },
            subscriptions: [],
            extensionUri: vscode.Uri.file('/mock/extension'),
            asAbsolutePath: (p: string) => path.join('/mock/extension', p)
        } as any;

        // Instantiate client
        // Note: The constructor calls detectPythonInterpreter and validatePythonVersion.
        // We might need to control what they return/throw during instantiation, 
        // or we can just instantiate it and then test the private method directly if we can access it.
        // However, since validatePythonVersion is called in constructor, we need to make sure it doesn't throw 
        // during setup unless we want it to.
        
        // For setup, let's make execFileSync return a valid version so constructor succeeds
        execFileSyncStub.returns('Python 3.11.0');
        
        client = new FlowbabyClient(testWorkspacePath, mockContext);
        
        // Reset stub history after constructor
        execFileSyncStub.resetHistory();
    });

    teardown(() => {
        sandbox.restore();
        Object.defineProperty(process, 'platform', {
            value: originalPlatform,
            writable: true
        });
    });

    suite('validatePythonVersion', () => {
        test('Windows: prefers python if available', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            execFileSyncStub.withArgs('python', ['--version']).returns('Python 3.11.0');

            const result = (client as any).validatePythonVersion('python');
            assert.strictEqual(result, 'python');
        });

        test('Windows: falls back to py if python fails', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            execFileSyncStub.withArgs('python', ['--version']).throws(new Error('Not found'));
            execFileSyncStub.withArgs('py', ['--version']).returns('Python 3.11.0');

            const result = (client as any).validatePythonVersion('python');
            assert.strictEqual(result, 'py');
        });

        test('Windows: throws if both fail', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            execFileSyncStub.withArgs('python', ['--version']).throws(new Error('Not found'));
            execFileSyncStub.withArgs('py', ['--version']).throws(new Error('Not found'));

            assert.throws(() => {
                (client as any).validatePythonVersion('python');
            }, /Flowbaby could not run a Python interpreter/);
        });

        test('Unix: prefers python3 if available', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            execFileSyncStub.withArgs('python3', ['--version']).returns('Python 3.11.0');

            const result = (client as any).validatePythonVersion('python3');
            assert.strictEqual(result, 'python3');
        });

        test('Unix: falls back to python if python3 fails', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            execFileSyncStub.withArgs('python3', ['--version']).throws(new Error('Not found'));
            execFileSyncStub.withArgs('python', ['--version']).returns('Python 3.11.0');

            const result = (client as any).validatePythonVersion('python3');
            assert.strictEqual(result, 'python');
        });

        test('Unix: throws if both fail', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            execFileSyncStub.withArgs('python3', ['--version']).throws(new Error('Not found'));
            execFileSyncStub.withArgs('python', ['--version']).throws(new Error('Not found'));

            assert.throws(() => {
                (client as any).validatePythonVersion('python3');
            }, /Flowbaby could not run a Python interpreter/);
        });

        test('Validates Python 3.10', () => {
            execFileSyncStub.returns('Python 3.10.5');
            const result = (client as any).validatePythonVersion('python');
            assert.strictEqual(result, 'python');
        });

        test('Validates Python 3.12', () => {
            execFileSyncStub.returns('Python 3.12.1');
            const result = (client as any).validatePythonVersion('python');
            assert.strictEqual(result, 'python');
        });

        test('Rejects Python 3.9', () => {
            execFileSyncStub.returns('Python 3.9.10');
            assert.throws(() => {
                (client as any).validatePythonVersion('python');
            }, /Detected Python 3.9.10/);
        });

        test('Rejects Python 3.13', () => {
            execFileSyncStub.returns('Python 3.13.0');
            assert.throws(() => {
                (client as any).validatePythonVersion('python');
            }, /Detected Python 3.13.0/);
        });
    });
});
