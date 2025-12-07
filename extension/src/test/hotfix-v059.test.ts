
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { FlowbabyClient } from '../flowbabyClient';

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
        sandbox.stub(client as unknown as { runPythonScript: typeof client['runPythonScript'] }, 'runPythonScript').resolves({
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
        sandbox.stub(client as unknown as { runPythonScript: typeof client['runPythonScript'] }, 'runPythonScript').resolves({
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
