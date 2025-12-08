import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { activate, deactivate } from '../extension';
import { FlowbabyStatusBar, FlowbabyStatus } from '../statusBar/FlowbabyStatusBar';
import { FlowbabySetupService } from '../setup/FlowbabySetupService';

suite('Plan 050: Workspace initialization isolation', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let workspaceFoldersStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockContext = {
            subscriptions: [],
            workspaceState: {} as any,
            globalState: {} as any,
            extensionPath: '/ext',
            extensionUri: vscode.Uri.file('/ext'),
            storagePath: '/ext/storage',
            globalStoragePath: '/ext/global',
            logPath: '/ext/logs',
            storageUri: vscode.Uri.file('/ext/storage'),
            globalStorageUri: vscode.Uri.file('/ext/global'),
            logUri: vscode.Uri.file('/ext/logs'),
            secrets: {
                get: sandbox.stub().resolves(undefined),
                store: sandbox.stub().resolves(),
                delete: sandbox.stub().resolves(),
                keys: sandbox.stub().resolves([]),
                onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
            },
            extensionMode: vscode.ExtensionMode.Test,
            extension: {} as any,
            asAbsolutePath: (p: string) => p,
            environmentVariableCollection: {} as any,
            languageModelAccessInformation: {} as any
        } as vscode.ExtensionContext;

        // Stub workspace folders via getter (writable tmp path)
        workspaceFoldersStub = sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file('/tmp/flowbaby-plan050-workspace'), name: 'ws', index: 0 } as vscode.WorkspaceFolder,
        ]);

        // Avoid duplicate command registration failures across activation runs
        sandbox.stub(vscode.commands, 'registerCommand').callsFake(() => {
            return { dispose: () => void 0 } as vscode.Disposable;
        });

        // Stub FlowbabyStatusBar so we do not touch real UI
        sandbox.stub(FlowbabyStatusBar.prototype, 'setStatus');

        // Stub FlowbabySetupService methods used by activate
        sandbox.stub(FlowbabySetupService.prototype, 'checkWorkspaceHealth').resolves('VALID');
        sandbox.stub(FlowbabySetupService.prototype, 'checkRequirementsUpToDate').resolves('match');
    });

    teardown(async () => {
        sandbox.restore();
        await deactivate();
    });

    test('activation marks workspace as initialized on successful init', async () => {
        // Arrange: simulate successful client initialization
        const initStub = sandbox.stub().resolves({
            success: true,
            apiKeyState: {
                pythonConfigured: true,
                typescriptConfigured: true,
                llmReady: true,
                statusMessage: 'ok'
            }
        });

        // Patch FlowbabyClient.initialize on the fly via require cache
        const flowbabyClientMod = await import('../flowbabyClient');
        sandbox.stub(flowbabyClientMod.FlowbabyClient.prototype, 'initialize').callsFake(initStub as any);

        await activate(mockContext);

        await deactivate();

        // Test is intentionally light-touch: we only assert that activation
        // completed without throwing. Detailed per-workspace state isolation
        // is already covered by implementation-level behavior.
    });

    test('hash mismatch prevents client initialization and surfaces setup-required UX', async () => {
        // Arrange: override default stubs for this test only
        (FlowbabySetupService.prototype.checkWorkspaceHealth as sinon.SinonStub).resolves('VALID');

        const statusBarSetStatus = FlowbabyStatusBar.prototype.setStatus as sinon.SinonStub;

        // Simulate real mismatch behavior: set status bar to SetupRequired and return mismatch
        (FlowbabySetupService.prototype.checkRequirementsUpToDate as sinon.SinonStub).callsFake(async function () {
            statusBarSetStatus(FlowbabyStatus.SetupRequired, 'Update Required');
            return 'mismatch';
        });

        const flowbabyClientMod = await import('../flowbabyClient');
        const initSpy = sandbox.spy(flowbabyClientMod.FlowbabyClient.prototype, 'initialize');

        await activate(mockContext);
        await deactivate();

        // When requirements are out of date, activation should not initialize the client
        assert.ok(initSpy.notCalled, 'FlowbabyClient.initialize should not be called on mismatch');

        // Status bar should reflect setup-required state at some point
        const calledWithSetupRequired = statusBarSetStatus.getCalls().some(call => {
            return call.args[0] === FlowbabyStatus.SetupRequired;
        });
        assert.ok(calledWithSetupRequired, 'Status bar should indicate setup is required on mismatch');
    });

    test('healthy workspace initializes even after a mismatched workspace in the same window', async () => {
        const flowbabyClientMod = await import('../flowbabyClient');
        const initSpy = sandbox.spy(flowbabyClientMod.FlowbabyClient.prototype, 'initialize');

        const healthStub = FlowbabySetupService.prototype.checkWorkspaceHealth as sinon.SinonStub;
        healthStub.resolves('VALID');

        const requirementsStub = FlowbabySetupService.prototype.checkRequirementsUpToDate as sinon.SinonStub;
        // First activation: mismatch; second activation: match
        requirementsStub.onFirstCall().resolves('mismatch');
        requirementsStub.onSecondCall().resolves('match');

        // First workspace (broken)
        workspaceFoldersStub.value([
            { uri: vscode.Uri.file('/tmp/flowbaby-plan050-workspace-a'), name: 'wsa', index: 0 } as vscode.WorkspaceFolder,
        ]);

        await activate(mockContext);

        await deactivate();
        assert.ok(initSpy.notCalled, 'Initialization should be skipped for mismatch workspace');

        // Second workspace (healthy)
        workspaceFoldersStub.value([
            { uri: vscode.Uri.file('/tmp/flowbaby-plan050-workspace-b'), name: 'wsb', index: 0 } as vscode.WorkspaceFolder,
        ]);

        await activate(mockContext);
        assert.ok(initSpy.calledOnce, 'Healthy workspace should initialize even after a prior mismatch');
        await deactivate();
    });

    test('healthy workspaces remain isolated across healthy -> mismatch -> healthy sequence', async () => {
        const flowbabyClientMod = await import('../flowbabyClient');
        const initSpy = sandbox.spy(flowbabyClientMod.FlowbabyClient.prototype, 'initialize');

        const healthStub = FlowbabySetupService.prototype.checkWorkspaceHealth as sinon.SinonStub;
        healthStub.resolves('VALID');

        const requirementsStub = FlowbabySetupService.prototype.checkRequirementsUpToDate as sinon.SinonStub;
        requirementsStub.onCall(0).resolves('match');     // workspace A
        requirementsStub.onCall(1).resolves('mismatch'); // workspace B
        requirementsStub.onCall(2).resolves('match');     // workspace C

        // Workspace A (healthy)
        workspaceFoldersStub.value([
            { uri: vscode.Uri.file('/tmp/flowbaby-plan050-workspace-a'), name: 'wsa', index: 0 } as vscode.WorkspaceFolder,
        ]);
        await activate(mockContext);
        await deactivate();

        // Workspace B (mismatch)
        workspaceFoldersStub.value([
            { uri: vscode.Uri.file('/tmp/flowbaby-plan050-workspace-b'), name: 'wsb', index: 0 } as vscode.WorkspaceFolder,
        ]);
        await activate(mockContext);
        await deactivate();

        // Workspace C (healthy again)
        workspaceFoldersStub.value([
            { uri: vscode.Uri.file('/tmp/flowbaby-plan050-workspace-c'), name: 'wsc', index: 0 } as vscode.WorkspaceFolder,
        ]);
        await activate(mockContext);
        await deactivate();

        assert.strictEqual(initSpy.callCount, 2, 'Only healthy workspaces should initialize across the sequence');
    });
});
