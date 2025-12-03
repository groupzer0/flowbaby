
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import { FlowbabyClient } from '../flowbabyClient';

// Subclass to expose protected methods for testing
class TestableFlowbabyClient extends FlowbabyClient {
    public mockExecOutput: string = '';
    public mockExecError: Error | null = null;

    protected execFileSync(command: string, args: string[], options: any): string {
        if (this.mockExecError) {
            throw this.mockExecError;
        }
        return this.mockExecOutput;
    }
    
    // Expose for testing
    public testValidatePythonVersion(pythonPath: string): string {
        // @ts-ignore - accessing private method via bracket notation or just calling the public constructor logic?
        // The constructor calls validatePythonVersion. We can't easily call private methods.
        // But we can instantiate the class and see if it throws.
        return pythonPath; // Placeholder, actual test will use constructor
    }
}

suite('Hotfix v0.5.9 Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let showErrorMessageStub: sinon.SinonStub;
    let openExternalStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');
        openExternalStub = sandbox.stub(vscode.env, 'openExternal');
    });

    teardown(() => {
        sandbox.restore();
    });

    test('FlowbabyClient.initialize handles Kuzu DLL load error', async () => {
        const context = {
            secrets: { get: () => Promise.resolve(undefined) }
        } as unknown as vscode.ExtensionContext;

        const client = new FlowbabyClient('/tmp/workspace', context);
        
        // Mock runPythonScript to return the specific error
        const runPythonScriptStub = sandbox.stub(client as any, 'runPythonScript').resolves({
            success: false,
            error: 'ImportError: DLL load failed while importing _kuzu. Flowbaby requires the Microsoft Visual C++ Redistributable on Windows.'
        });

        // Mock showErrorMessage to resolve with "Download Redistributable"
        showErrorMessageStub.resolves('Download Redistributable');

        const result = await client.initialize();

        assert.strictEqual(result.success, false);
        assert.ok(showErrorMessageStub.calledOnce);
        assert.ok(showErrorMessageStub.firstCall.args[0].includes('Microsoft Visual C++ Redistributable'));
        
        // Verify the download link was opened
        assert.ok(openExternalStub.calledOnce);
        assert.strictEqual(openExternalStub.firstCall.args[0].toString(), 'https://aka.ms/vs/17/release/vc_redist.x64.exe');
    });

    test('FlowbabyClient.initialize handles generic error', async () => {
        const context = {
            secrets: { get: () => Promise.resolve(undefined) }
        } as unknown as vscode.ExtensionContext;

        const client = new FlowbabyClient('/tmp/workspace', context);
        
        // Mock runPythonScript to return a generic error
        const runPythonScriptStub = sandbox.stub(client as any, 'runPythonScript').resolves({
            success: false,
            error: 'Some other error'
        });

        const showWarningMessageStub = sandbox.stub(vscode.window, 'showWarningMessage');

        const result = await client.initialize();

        assert.strictEqual(result.success, false);
        // Should NOT call showErrorMessage for VC++
        assert.ok(showErrorMessageStub.notCalled);
        // Should call showWarningMessage
        assert.ok(showWarningMessageStub.calledOnce);
    });
});
