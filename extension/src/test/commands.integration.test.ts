import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

// Import activate so we can register commands without depending on compiled dist
import { activate } from '../extension';

suite('Commands Integration (no production changes)', () => {
    let sandbox: sinon.SinonSandbox;

    // Captured command callbacks by ID
    const registered: Record<string, (...args: any[]) => any> = {};

    // Track config updates from toggle command
    let lastEnabledValue: boolean | undefined;

    // Common stubs
    // Keep references only when assertions need them; otherwise, avoid unused vars
    let inputBoxStub: sinon.SinonStub;
    let infoMsgStub: sinon.SinonStub;
    let warnMsgStub: sinon.SinonStub;

    // FlowbabyClient method stubs on prototype (affects instance created within activate)
    // initialize is stubbed but not asserted on explicitly
    let ingestAsyncStub: sinon.SinonStub;
    let clearMemoryStub: sinon.SinonStub;

    // Provide a fake workspace folder
    const workspacePath = '/tmp/vscode-cognee-test-ws';

    setup(async () => {
        sandbox = sinon.createSandbox();

        // Ensure fake workspace folder exists in API
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file(workspacePath), name: 'ws', index: 0 } as vscode.WorkspaceFolder
        ]);

        // Capture command registrations
        sandbox.stub(vscode.commands, 'registerCommand').callsFake((id: string, cb: (...args: any[]) => any) => {
            registered[id] = cb;
            return { dispose: () => void 0 } as vscode.Disposable;
        });

        // Stub configuration API used by toggle/commands
        const fakeConfig: vscode.WorkspaceConfiguration = {
            get: ((key: string, defaultValue?: any) => {
                if (key === 'enabled') {return true;} // default enabled
                return defaultValue;
            }) as any,
            has: (() => true) as any,
            inspect: (() => undefined) as any,
            update: ((section: string, value: any) => {
                if (section === 'enabled') {
                    lastEnabledValue = value as boolean;
                }
                return Promise.resolve();
            }) as any
        };
    sandbox.stub(vscode.workspace, 'getConfiguration').returns(fakeConfig);

        // UI stubs
        inputBoxStub = sandbox.stub(vscode.window, 'showInputBox');
    // Do not stub clipboard.readText (non-writable); use writeText to set deterministic content when needed
        infoMsgStub = sandbox.stub(vscode.window, 'showInformationMessage');
        warnMsgStub = sandbox.stub(vscode.window, 'showWarningMessage');

        // FlowbabyClient behavior stubs
        // Avoid real Python calls during activation and ingestion/clear
        const FlowbabyClientMod = await import('../flowbabyClient');
    sandbox.stub(FlowbabyClientMod.FlowbabyClient.prototype, 'initialize').resolves(true);
        ingestAsyncStub = sandbox.stub(FlowbabyClientMod.FlowbabyClient.prototype, 'ingestAsync').resolves({ success: true, staged: true, operationId: 'test-operation' });
        clearMemoryStub = sandbox.stub(FlowbabyClientMod.FlowbabyClient.prototype, 'clearMemory').resolves(true);

        // Plan 039 M3: Stub health check to return VALID so tests can proceed with initialization
        const FlowbabySetupMod = await import('../setup/FlowbabySetupService');
        sandbox.stub(FlowbabySetupMod.FlowbabySetupService.prototype, 'checkWorkspaceHealth').resolves('VALID');

        // Prevent chat participant registration side-effects in this suite
        sandbox.stub(vscode.chat, 'createChatParticipant').callsFake((_id: string, _handler: any) => {
            return { dispose: () => void 0 } as vscode.ChatParticipant;
        });

        // Activate extension to register commands using our stubs
        await activate({ subscriptions: [], extensionPath: '/tmp/vscode-cognee-test-ext' } as any);
    });

    teardown(() => {
        sandbox.restore();
        // Cleanup captured commands
        for (const key of Object.keys(registered)) {delete registered[key];}
        lastEnabledValue = undefined;
    });

    test('Capture command uses user input when provided and ingests', async () => {
        const cb = registered['Flowbaby.captureMessage'];
        assert.ok(cb, 'capture command not registered');

        inputBoxStub.resolves('Discussed Redis caching with TTL=900s');

        await cb();

        assert.ok(ingestAsyncStub.calledOnce, 'ingestAsync should be called once');
        const [userMsg, assistantMsg] = ingestAsyncStub.firstCall.args;
        assert.match(String(userMsg), /Manual note:/);
        assert.match(String(assistantMsg), /Captured via Ctrl\+Alt\+C/);
        assert.ok(infoMsgStub.called, 'success info message should be shown');
    });

    test('Capture command shows cancel message when Escape pressed (undefined)', async () => {
        const cb = registered['Flowbaby.captureMessage'];
        assert.ok(cb, 'capture command not registered');

        inputBoxStub.resolves(undefined); // Simulate Escape/cancel

        await cb();

        assert.ok(ingestAsyncStub.notCalled, 'ingestAsync should NOT be called on cancel');
        assert.ok(infoMsgStub.calledWith('Capture cancelled'), 'cancel info message should be shown');
    });

    test('Capture command falls back to clipboard when input is empty string', async () => {
        const cb = registered['Flowbaby.captureMessage'];
        assert.ok(cb, 'capture command not registered');

        inputBoxStub.resolves(''); // Empty string = explicit submit
        await vscode.env.clipboard.writeText('Clipboard content to capture');

        await cb();

        assert.ok(ingestAsyncStub.calledOnce, 'ingestAsync should be called once on clipboard fallback');
        assert.ok(infoMsgStub.called, 'success info message should be shown');
    });

    test('Capture command shows nothing to capture when empty input and empty clipboard', async () => {
        const cb = registered['Flowbaby.captureMessage'];
        assert.ok(cb, 'capture command not registered');

        inputBoxStub.resolves(''); // Empty string = explicit submit
        await vscode.env.clipboard.writeText('');

        await cb();

        assert.ok(ingestAsyncStub.notCalled, 'ingestAsync should not be called when no content');
        assert.ok(infoMsgStub.calledWith('Nothing to capture'), 'nothing to capture info message should be shown');
    });

    test('Toggle command flips enabled flag in workspace configuration', async () => {
        const cb = registered['Flowbaby.toggleMemory'];
        assert.ok(cb, 'toggle command not registered');

        await cb();
        assert.strictEqual(lastEnabledValue, false, 'enabled should toggle to false');
    });

    test('Clear command confirms and clears memory', async () => {
        const cb = registered['Flowbaby.clearMemory'];
        assert.ok(cb, 'clear command not registered');

        // Modal confirmation path
        warnMsgStub.resolves('Delete');

        await cb();

        assert.ok(clearMemoryStub.calledOnce, 'clearMemory should be called once');
        assert.ok(infoMsgStub.called, 'success info message should be shown');
    });
});
