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

    setup(() => {
        sandbox = sinon.createSandbox();
        __resetRegistrationHelperStateForTests();

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

        const readinessEmitter = new vscode.EventEmitter<any>();
        const evaluateReadiness = sandbox.stub().resolves({
            auth: 'authenticated',
            vend: 'failed',
            bridge: 'not_checked',
            overall: 'degraded',
            evaluatedAt: new Date(),
            lastError: new Error('Vend failed'),
        });

        const readinessService = {
            onDidChangeReadiness: readinessEmitter.event,
            evaluateReadiness,
            needsLogin: sandbox.stub().returns(false),
            isFullyReady: sandbox.stub().returns(false),
            getRemediation: sandbox.stub().returns({
                message: 'Flowbaby Cloud credentials unavailable. Check Cloud status or retry.',
                primaryAction: { label: 'Check Status', commandId: 'flowbaby.cloud.status' },
            }),
            dispose: () => readinessEmitter.dispose(),
        } as any;

        const readinessMod = require('../flowbaby-cloud/readiness') as typeof import('../flowbaby-cloud/readiness');
        sandbox.stub(readinessMod, 'initializeReadinessService').returns(readinessService);
        sandbox.stub(readinessMod, 'getReadinessService').returns(readinessService);
        sandbox.stub(readinessMod, 'resetReadinessService').callsFake(() => undefined);

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

        const readinessEmitter = new vscode.EventEmitter<any>();
        const readinessService = {
            onDidChangeReadiness: readinessEmitter.event,
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
            dispose: () => readinessEmitter.dispose(),
        } as any;

        const readinessMod = require('../flowbaby-cloud/readiness') as typeof import('../flowbaby-cloud/readiness');
        sandbox.stub(readinessMod, 'initializeReadinessService').returns(readinessService);
        sandbox.stub(readinessMod, 'getReadinessService').returns(readinessService);
        sandbox.stub(readinessMod, 'resetReadinessService').callsFake(() => undefined);

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
