import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

import { activate, deactivate } from '../extension';
import { __resetRegistrationHelperStateForTests, isActive } from '../lifecycle/registrationHelper';
import { FlowbabyStatusBar, FlowbabyStatus } from '../statusBar/FlowbabyStatusBar';
import { FlowbabySetupService } from '../setup/FlowbabySetupService';

suite('Plan 087: Cloud readiness wiring (targeted)', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let workspaceFoldersStub: sinon.SinonStub;
    let initializeReadinessServiceStub: sinon.SinonStub;
    let getReadinessServiceStub: sinon.SinonStub;
    let resetReadinessServiceStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        __resetRegistrationHelperStateForTests();

        // Activation awaits the Agent Team recommendation prompt; stub to avoid hanging tests.
        sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

        mockContext = {
            subscriptions: [],
            workspaceState: {} as any,
            globalState: {
                get: sandbox.stub().returns(false),
                update: sandbox.stub().resolves(),
            } as any,
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
                onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
            },
            extensionMode: vscode.ExtensionMode.Test,
            extension: {} as any,
            asAbsolutePath: (p: string) => p,
            environmentVariableCollection: {} as any,
            languageModelAccessInformation: {} as any,
        } as vscode.ExtensionContext;

        workspaceFoldersStub = sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file('/tmp/flowbaby-plan087-workspace'), name: 'ws', index: 0 } as vscode.WorkspaceFolder,
        ]);

        // Avoid duplicate registration failures across activations
        sandbox.stub(vscode.commands, 'registerCommand').callsFake(() => ({ dispose: () => void 0 }) as vscode.Disposable);

        // These tests don't validate chat behavior; avoid VS Code participant lifecycle issues.
        sandbox.stub(vscode.chat, 'createChatParticipant').callsFake(() => {
            return { iconPath: undefined, dispose: () => void 0 } as any;
        });

        // Keep UI interactions in-process and observable.
        sandbox.stub(FlowbabyStatusBar.prototype, 'setStatus');

        // Keep workspace health checks deterministic.
        sandbox.stub(FlowbabySetupService.prototype, 'checkWorkspaceHealth').resolves('VALID');
        sandbox.stub(FlowbabySetupService.prototype, 'checkRequirementsUpToDate').resolves('match');

        // Prevent real Python init; only behavior under test is gating/wiring.
        // NOTE: activation expects `apiKeyState` shape.
        sandbox.stub(require('../flowbabyClient').FlowbabyClient.prototype, 'initialize').resolves({
            success: true,
            apiKeyState: {
                pythonConfigured: true,
                typescriptConfigured: true,
                llmReady: true,
                statusMessage: 'ok',
            },
        });

        // Flowbaby Cloud exports are re-exported via getters from ../flowbaby-cloud.
        // Stub the underlying readiness module so activation uses deterministic readiness.
        const readinessMod = require('../flowbaby-cloud/readiness') as typeof import('../flowbaby-cloud/readiness');

        const defaultEmitter = new vscode.EventEmitter<any>();
        const defaultReadinessService = {
            onDidChangeReadiness: defaultEmitter.event,
            evaluateReadiness: sandbox.stub().resolves({
                auth: 'authenticated',
                vend: 'not_checked',
                bridge: 'not_checked',
                overall: 'ready',
                evaluatedAt: new Date(),
            }),
            needsLogin: sandbox.stub().returns(false),
            isFullyReady: sandbox.stub().returns(true),
            getRemediation: sandbox.stub().returns({
                message: 'ok',
                primaryAction: { label: 'Check Status', commandId: 'flowbaby.cloud.status' },
            }),
            dispose: () => defaultEmitter.dispose(),
        } as any;

        initializeReadinessServiceStub = sandbox.stub(readinessMod, 'initializeReadinessService').returns(defaultReadinessService);
        getReadinessServiceStub = sandbox.stub(readinessMod, 'getReadinessService').returns(defaultReadinessService);
        resetReadinessServiceStub = sandbox.stub(readinessMod, 'resetReadinessService').callsFake(() => undefined);
    });

    teardown(async () => {
        sandbox.restore();
        if (isActive()) {
            await deactivate();
        }
        __resetRegistrationHelperStateForTests();
    });

    test('authenticated + vend failing: does not show login modal; shows degraded remediation', async () => {
        const statusBarSetStatus = FlowbabyStatusBar.prototype.setStatus as sinon.SinonStub;
        const showWarning = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

        const evaluateReadiness = sandbox.stub().resolves({
            auth: 'authenticated',
            vend: 'failed',
            bridge: 'not_checked',
            overall: 'degraded',
            evaluatedAt: new Date(),
            lastError: new Error('Vend failed'),
        });

        const readinessService = {
            onDidChangeReadiness: new vscode.EventEmitter<any>().event,
            evaluateReadiness,
            needsLogin: sandbox.stub().returns(false),
            isFullyReady: sandbox.stub().returns(false),
            getRemediation: sandbox.stub().returns({
                message: 'Flowbaby Cloud credentials unavailable. Check Cloud status or retry.',
                primaryAction: { label: 'Check Status', commandId: 'flowbaby.cloud.status' },
            }),
            dispose: () => void 0,
        } as any;

        // Ensure activation/handleInitSuccess uses this targeted readiness service.
        initializeReadinessServiceStub.returns(readinessService);
        getReadinessServiceStub.returns(readinessService);

        await activate(mockContext);
        await deactivate();

        assert.ok(evaluateReadiness.called, 'Expected readinessService.evaluateReadiness() to be called during activation');

        // Status bar should reflect degraded/error rather than login-required.
        const observedStatuses = statusBarSetStatus.getCalls().map(call => call.args[0]);
        const calledError = observedStatuses.some(status => status === FlowbabyStatus.Error);
        assert.ok(
            calledError,
            `Expected status bar to enter Error state for degraded readiness; observed: ${JSON.stringify(observedStatuses)}`
        );

        // Must NOT show the login-required modal prompt.
        const loginPromptShown = showWarning.getCalls().some(call => {
            const message = String(call.args[0] ?? '');
            return message.includes('Login to Flowbaby Cloud to enable memory operations');
        });
        assert.strictEqual(loginPromptShown, false, 'Should not show login modal when authenticated');

        // Should show degraded remediation message.
        const remediationShown = showWarning.getCalls().some(call => {
            const message = String(call.args[0] ?? '');
            return message.includes('credentials unavailable');
        });
        assert.ok(remediationShown, 'Expected degraded remediation prompt to be shown');
    });

    test('login_required readiness maps to NeedsCloudLogin status and login prompt', async () => {
        const statusBarSetStatus = FlowbabyStatusBar.prototype.setStatus as sinon.SinonStub;
        const showWarning = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

        const readinessService = {
            onDidChangeReadiness: new vscode.EventEmitter<any>().event,
            evaluateReadiness: sandbox.stub().resolves({
                auth: 'not_authenticated',
                vend: 'not_attempted',
                bridge: 'not_checked',
                overall: 'login_required',
                evaluatedAt: new Date(),
            }),
            needsLogin: sandbox.stub().returns(true),
            isFullyReady: sandbox.stub().returns(false),
            getRemediation: sandbox.stub().returns({
                message: 'Login to Flowbaby Cloud to enable memory operations.',
                primaryAction: { label: 'Login to Cloud', commandId: 'flowbaby.cloud.login' },
            }),
            dispose: () => void 0,
        } as any;

        initializeReadinessServiceStub.returns(readinessService);
        getReadinessServiceStub.returns(readinessService);

        await activate(mockContext);
        await deactivate();

        const calledNeedsLogin = statusBarSetStatus.getCalls().some(call => call.args[0] === FlowbabyStatus.NeedsCloudLogin);
        assert.ok(calledNeedsLogin, 'Expected status bar to enter NeedsCloudLogin when readiness is login_required');

        const loginPromptShown = showWarning.getCalls().some(call => {
            const message = String(call.args[0] ?? '');
            return message.includes('Login to Flowbaby Cloud to enable memory operations');
        });
        assert.ok(loginPromptShown, 'Expected login prompt to be shown when login is required');
    });
});
