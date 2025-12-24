import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

// Import activate so we can register commands without depending on compiled dist
import { activate, deactivate } from '../extension';

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
    let ingestSummaryStub: sinon.SinonStub;
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
                if (key === 'enabled') { return true; } // default enabled
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
        infoMsgStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
        warnMsgStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

        // FlowbabyClient behavior stubs
        // Avoid real Python calls during activation and ingestion/clear
        const FlowbabyClientMod = await import('../flowbabyClient');
        // Plan 045: initialize() now returns InitializeResult instead of boolean
        sandbox.stub(FlowbabyClientMod.FlowbabyClient.prototype, 'initialize').resolves({
            success: true,
            apiKeyState: {
                pythonConfigured: true,
                typescriptConfigured: true,
                llmReady: true,
                statusMessage: 'API key configured'
            }
        });
        ingestSummaryStub = sandbox.stub(FlowbabyClientMod.FlowbabyClient.prototype, 'ingestSummary').resolves(true);
        clearMemoryStub = sandbox.stub(FlowbabyClientMod.FlowbabyClient.prototype, 'clearMemory').resolves(true);
        // Plan 045: Stub hasApiKey to return true so API key checks pass
        sandbox.stub(FlowbabyClientMod.FlowbabyClient.prototype, 'hasApiKey').resolves(true);

        // Plan 039 M3: Stub health check to return VALID so tests can proceed with initialization
        const FlowbabySetupMod = await import('../setup/FlowbabySetupService');
        sandbox.stub(FlowbabySetupMod.FlowbabySetupService.prototype, 'checkWorkspaceHealth').resolves('VALID');

        // Prevent chat participant registration side-effects in this suite
        sandbox.stub(vscode.chat, 'createChatParticipant').callsFake((_id: string, _handler: any) => {
            return { dispose: () => void 0 } as vscode.ChatParticipant;
        });

        // Activate extension to register commands using our stubs
        await activate({ subscriptions: [], extensionPath: '/tmp/vscode-cognee-test-ext' } as any);

        // Reset clipboard to empty state before each test to ensure isolation
        await vscode.env.clipboard.writeText('');
    });

    teardown(async () => {
        sandbox.restore();
        // Cleanup captured commands
        for (const key of Object.keys(registered)) { delete registered[key]; }
        lastEnabledValue = undefined;
        await deactivate();
    });

    test('Capture command uses user input when provided and ingests', async () => {
        const cb = registered['Flowbaby.captureMessage'];
        assert.ok(cb, 'capture command not registered');

        inputBoxStub.resolves('Discussed Redis caching with TTL=900s');

        await cb();

        assert.ok(ingestSummaryStub.calledOnce, 'ingestSummary should be called once');
        const [summary] = ingestSummaryStub.firstCall.args;
        assert.strictEqual(summary.context, 'Discussed Redis caching with TTL=900s');
        assert.ok(infoMsgStub.called, 'success info message should be shown');
    });

    test('Capture command exits silently when Escape pressed (undefined)', async () => {
        const cb = registered['Flowbaby.captureMessage'];
        assert.ok(cb, 'capture command not registered');

        inputBoxStub.resolves(undefined); // Simulate Escape/cancel

        await cb();

        assert.ok(ingestSummaryStub.notCalled, 'ingestSummary should NOT be called on cancel');
        // Current implementation exits silently without showing message
    });

    // SKIP: Current implementation requires 10+ chars and has no clipboard fallback
    test.skip('Capture command falls back to clipboard when input is empty string', async () => {
        const cb = registered['Flowbaby.captureMessage'];
        assert.ok(cb, 'capture command not registered');

        inputBoxStub.resolves(''); // Empty string = explicit submit
        await vscode.env.clipboard.writeText('Clipboard content to capture');

        await cb();

        assert.ok(ingestSummaryStub.calledOnce, 'ingestSummary should be called once on clipboard fallback');
        assert.ok(infoMsgStub.called, 'success info message should be shown');
    });

    // SKIP: This test requires mocking vscode.env.clipboard.readText which is non-writable.
    // The VS Code test environment does not reliably clear clipboard via writeText('').
    // See comment on line 64 - clipboard.readText cannot be stubbed.
    // Additionally, current implementation has no clipboard fallback.
    test.skip('Capture command shows nothing to capture when empty input and empty clipboard', async () => {
        const cb = registered['Flowbaby.captureMessage'];
        assert.ok(cb, 'capture command not registered');

        // Reset stub histories to ensure isolation from previous clipboard fallback test
        ingestSummaryStub.resetHistory();
        infoMsgStub.resetHistory();

        inputBoxStub.resolves(''); // Empty string = explicit submit

        // Clear clipboard - use a space then empty to ensure it's actually cleared
        // Some VS Code test environments may cache clipboard content
        await vscode.env.clipboard.writeText(' ');
        await vscode.env.clipboard.writeText('');

        await cb();

        assert.ok(ingestSummaryStub.notCalled, 'ingestSummary should not be called when no content');
        assert.ok(infoMsgStub.calledWith('Nothing to capture'), 'nothing to capture info message should be shown');
    });

    test('Capture command works with no active editor (global shortcut context)', async () => {
        const cb = registered['Flowbaby.captureMessage'];
        assert.ok(cb, 'capture command not registered');

        // Simulate invocation from a non-editor context (no activeTextEditor)
        sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);

        inputBoxStub.resolves('Note from non-editor context - long enough message');

        await cb();

        assert.ok(ingestSummaryStub.calledOnce, 'ingestSummary should be called once even without active editor');
        assert.ok(infoMsgStub.called, 'success info message should be shown');
    });

    const viewScenarios: Array<{ label: string; prep: () => void }> = [
        {
            label: 'Explorer',
            prep: () => {
                sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
            }
        },
        {
            label: 'Problems',
            prep: () => {
                sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
            }
        },
        {
            label: 'Search',
            prep: () => {
                sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
            }
        },
        {
            label: 'Terminal',
            prep: () => {
                sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
                sandbox.stub(vscode.window, 'activeTerminal').value({ name: 'Mock Terminal' } as vscode.Terminal);
            }
        }
    ];

    for (const scenario of viewScenarios) {
        test(`Capture command works from ${scenario.label} view context`, async () => {
            const cb = registered['Flowbaby.captureMessage'];
            assert.ok(cb, 'capture command not registered');

            ingestSummaryStub.resetHistory();
            infoMsgStub.resetHistory();
            scenario.prep();
            inputBoxStub.resolves(`Note from ${scenario.label} view - long enough message`);

            await cb();

            assert.ok(ingestSummaryStub.calledOnce, 'ingestSummary should be called once');
            assert.ok(infoMsgStub.called, 'success info message should be shown');
        });
    }

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
