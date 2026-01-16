/**
 * Plan 109: Managed Venv Defaults + Dashboard Init Tests
 * 
 * TDD tests for:
 * - Removing .venv choice modal (always use managed .flowbaby/venv)
 * - Dashboard setup command wiring (Flowbaby.initializeWorkspace)
 * - External ownership migration path
 * 
 * @see Plan 109 - Managed Venv Default + Dashboard Setup Fix
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import { FlowbabySetupService, BridgeEnvMetadata } from '../setup/FlowbabySetupService';
import { BackgroundOperationManager } from '../background/BackgroundOperationManager';
import { FlowbabyStatusBar, FlowbabyStatus } from '../statusBar/FlowbabyStatusBar';
import { EventEmitter } from 'events';
import * as cloudProvider from '../flowbaby-cloud/provider';

suite('Plan 109: Managed Venv Defaults + Dashboard Init', () => {
    let sandbox: sinon.SinonSandbox;
    let outputChannel: vscode.OutputChannel;
    let service: FlowbabySetupService;
    let mockFs: { existsSync: sinon.SinonStub };
    let spawnStub: sinon.SinonStub;
    let bgManagerStub: any;
    let statusBar: FlowbabyStatusBar;
    let showInfoMessageStub: sinon.SinonStub;
    let showWarningMessageStub: sinon.SinonStub;
    let executeCommandStub: sinon.SinonStub;

    const workspacePath = '/test/workspace';

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Stub Cloud provider to avoid auth requirement in tests
        sandbox.stub(cloudProvider, 'isProviderInitialized').returns(true);
        sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
            AWS_ACCESS_KEY_ID: 'test-access-key',
            AWS_SECRET_ACCESS_KEY: 'test-secret-key',
            AWS_SESSION_TOKEN: 'test-session-token',
            AWS_REGION: 'us-east-1',
            FLOWBABY_CLOUD_MODE: 'true'
        });
        
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
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: sandbox.stub()
        } as any);

        // Mock fs.promises
        sandbox.stub(fs.promises, 'readFile');
        sandbox.stub(fs.promises, 'writeFile');
        sandbox.stub(fs.promises, 'mkdir');
        sandbox.stub(fs.promises, 'rm');
        sandbox.stub(fs.promises, 'rename');

        // Mock fs.existsSync (passed via constructor)
        mockFs = {
            existsSync: sandbox.stub().returns(false)
        };

        // Mock spawn
        spawnStub = sandbox.stub();

        // Mock BackgroundOperationManager
        bgManagerStub = {
            pause: sandbox.stub().resolves(true),
            resume: sandbox.stub(),
            getInstance: sandbox.stub(),
            getStatus: sandbox.stub().returns([])
        };
        sandbox.stub(BackgroundOperationManager, 'getInstance').returns(bgManagerStub);

        // Mock vscode.window
        showInfoMessageStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as any);
        showWarningMessageStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined as any);
        sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as any);
        sandbox.stub(vscode.window, 'withProgress').callsFake(async (options, task) => {
            return task({ report: sandbox.stub() }, new vscode.CancellationTokenSource().token);
        });
        executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();

        // Create a proper mock statusBar
        statusBar = Object.create(FlowbabyStatusBar.prototype) as FlowbabyStatusBar;
        (statusBar as any).statusBarItem = {
            text: '',
            tooltip: '',
            backgroundColor: undefined,
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub()
        };
        sandbox.stub(statusBar, 'setStatus');

        service = new FlowbabySetupService(
            { extensionPath: '/ext', globalStorageUri: vscode.Uri.file('/global-storage') } as any, 
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
        
        setTimeout(() => {
            if (stdout) { processMock.stdout.emit('data', stdout); }
            if (stderr) { processMock.stderr.emit('data', stderr); }
            processMock.emit('close', exitCode);
        }, 10);

        return processMock;
    }

    suite('Managed Venv Defaults (Work Item 1)', () => {
        test('createEnvironment does NOT show modal when workspace .venv exists', async () => {
            // Arrange: workspace has existing .venv
            mockFs.existsSync.withArgs('/test/workspace/.venv').returns(true);
            
            // Mock Python version check to succeed
            spawnStub.onFirstCall().returns(createMockProcess(0, 'Python 3.11.0'));
            // Mock venv creation
            spawnStub.onSecondCall().returns(createMockProcess(0));
            // Mock pip install
            spawnStub.onThirdCall().returns(createMockProcess(0));
            // Mock verification
            spawnStub.returns(createMockProcess(0, JSON.stringify({ status: 'ok', details: {} })));

            // Act
            await service.createEnvironment();

            // Assert: No modal was shown for venv choice
            // The old behavior showed a modal with 'Use .flowbaby/venv (Recommended)' and 'Use existing .venv (Advanced)'
            const infoMessageCalls = showInfoMessageStub.getCalls();
            const modalCalls = infoMessageCalls.filter(call => 
                call.args[0]?.includes?.('existing .venv') || 
                call.args[1]?.modal === true
            );
            
            assert.strictEqual(modalCalls.length, 0, 
                'Should NOT show modal asking about existing .venv - always use managed .flowbaby/venv');
        });

        test('createEnvironment always targets .flowbaby/venv path', async () => {
            // Arrange: workspace has existing .venv
            mockFs.existsSync.withArgs('/test/workspace/.venv').returns(true);
            mockFs.existsSync.withArgs('/test/workspace/.flowbaby').returns(false);
            
            // Mock successful environment creation
            spawnStub.onFirstCall().returns(createMockProcess(0, 'Python 3.11.0'));
            spawnStub.onSecondCall().returns(createMockProcess(0));
            spawnStub.onThirdCall().returns(createMockProcess(0));
            spawnStub.returns(createMockProcess(0, JSON.stringify({ status: 'ok', details: {} })));

            // Act
            await service.createEnvironment();

            // Assert: venv creation command targets .flowbaby/venv, not .venv
            const venvCreationCall = spawnStub.getCalls().find(call => 
                call.args[1]?.includes?.('-m') && call.args[1]?.includes?.('venv')
            );
            
            assert.ok(venvCreationCall, 'Should call python -m venv');
            const venvPath = venvCreationCall.args[1][venvCreationCall.args[1].length - 1];
            assert.ok(venvPath.includes('.flowbaby/venv'), 
                `venv path should be .flowbaby/venv, got: ${venvPath}`);
            assert.ok(!venvPath.endsWith('/.venv'), 
                'venv path should NOT be workspace .venv');
        });

        test('createEnvironment offers migration when ownership is external', async () => {
            // Arrange: external ownership in metadata
            const externalMetadata: BridgeEnvMetadata = {
                pythonPath: '/some/external/python',
                ownership: 'external',
                requirementsHash: 'some-hash',
                createdAt: '2025-01-01T00:00:00Z',
                platform: 'linux'
            };
            
            mockFs.existsSync.withArgs(sinon.match(/bridge-env.json/)).returns(true);
            (fs.promises.readFile as sinon.SinonStub).resolves(JSON.stringify(externalMetadata));
            
            // User chooses to migrate
            showInfoMessageStub.resolves('Initialize Managed Environment');
            
            // Mock environment creation
            spawnStub.onFirstCall().returns(createMockProcess(0, 'Python 3.11.0'));
            spawnStub.onSecondCall().returns(createMockProcess(0));
            spawnStub.returns(createMockProcess(0, JSON.stringify({ status: 'ok', details: {} })));

            // Act
            await service.initializeWorkspace();

            // Assert: Should offer migration, not mutate external
            const messageCall = showInfoMessageStub.getCalls().find(call =>
                call.args[0]?.includes?.('external') || 
                call.args[0]?.includes?.('managed') ||
                call.args[0]?.includes?.('Initialize Managed Environment') ||
                call.args.includes?.('Initialize Managed Environment')
            );
            
            // The test validates that external ownership is respected with migration option
            assert.ok(messageCall || showWarningMessageStub.called, 
                'Should show message about external ownership with migration option');
        });

        test('createEnvironment quiesces BackgroundOperationManager before venv mutation', async () => {
            // Arrange: pending background operations
            bgManagerStub.getStatus.returns([
                { id: 'op1', status: 'running' }
            ]);
            
            // User declines to proceed (to avoid waiting for full environment creation)
            showWarningMessageStub.resolves('Wait for Completion');

            // Act
            const result = await service.createEnvironment();

            // Assert: Should check background operations and return false when user declines
            assert.ok(showWarningMessageStub.called,
                'Should warn about pending operations');
            assert.strictEqual(result, false, 
                'Should return false when user chooses to wait for completion');
        });
    });

    suite('Dashboard Setup Wiring (Work Item 2)', () => {
        test('dashboard setupEnvironment message invokes Flowbaby.initializeWorkspace command', async () => {
            // This test verifies the wiring in DashboardViewProvider
            // The dashboard should invoke Flowbaby.initializeWorkspace, not Flowbaby.setup
            
            const { DashboardViewProvider } = await import('../flowbaby-cloud/dashboard/DashboardViewProvider');
            
            const mockExtensionUri = vscode.Uri.file('/test/extension');
            const mockAuth = {
                getSessionToken: sandbox.stub().resolves('test-token'),
                isAuthenticated: sandbox.stub().resolves(true),
                onDidChangeAuthState: new vscode.EventEmitter().event,
            };
            const mockClient = {
                getUserProfile: sandbox.stub().resolves({ email: 'test@test.com' }),
                getUserUsage: sandbox.stub().resolves({ used: 0, limit: 100 }),
            };
            
            const provider = new DashboardViewProvider(
                mockExtensionUri,
                mockAuth as any,
                mockClient as any
            );
            
            // Create mock webview
            const mockWebview = {
                options: {},
                html: '',
                onDidReceiveMessage: new vscode.EventEmitter<any>().event,
                postMessage: sandbox.stub().resolves(true),
                asWebviewUri: (uri: vscode.Uri) => uri,
            };
            
            const mockWebviewView = {
                webview: mockWebview,
                visible: true,
                onDidChangeVisibility: new vscode.EventEmitter<void>().event,
                onDidDispose: new vscode.EventEmitter<void>().event,
                show: sandbox.stub(),
            };
            
            // Resolve the view
            provider.resolveWebviewView(
                mockWebviewView as any,
                {} as any,
                new vscode.CancellationTokenSource().token
            );
            
            // Simulate setupEnvironment message from webview
            // Get the message handler that was registered
            const messageEmitter = new vscode.EventEmitter<any>();
            (mockWebviewView.webview as any).onDidReceiveMessage = messageEmitter.event;
            
            // Re-resolve to register the new handler
            provider.resolveWebviewView(
                mockWebviewView as any,
                {} as any,
                new vscode.CancellationTokenSource().token
            );
            
            // Fire setupEnvironment message
            messageEmitter.fire({ command: 'setupEnvironment' });
            
            // Wait for async command execution
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Assert: Should invoke Flowbaby.initializeWorkspace, not Flowbaby.setup
            const initializeWorkspaceCalls = executeCommandStub.getCalls().filter(call =>
                call.args[0] === 'Flowbaby.initializeWorkspace'
            );
            const legacySetupCalls = executeCommandStub.getCalls().filter(call =>
                call.args[0] === 'Flowbaby.setup'
            );

            assert.strictEqual(
                legacySetupCalls.length,
                0,
                `Should NOT invoke legacy Flowbaby.setup. Found calls: ${legacySetupCalls.length}`
            );
            assert.ok(
                initializeWorkspaceCalls.length > 0,
                'Should invoke Flowbaby.initializeWorkspace when dashboard sends setupEnvironment'
            );
        });
    });

    suite('Cloud Login Prompt Gating (Work Item 3)', () => {
        test('handleInitFailure offers Refresh Dependencies when local env is broken', async () => {
            // This test validates that init failure UX guides users appropriately
            // When healthStatus=BROKEN, should offer Refresh Dependencies, not Login to Cloud
            
            const { handleInitFailure } = await import('../activation/init');
            
            // Create minimal mock deps
            const mockDeps = {
                workspacePath: '/test/workspace',
                statusBar: {
                    setStatus: sandbox.stub()
                },
                activationStart: Date.now() - 1000,
            };
            
            // Mock init result
            const mockInitResult = {
                success: false,
                apiKeyState: {
                    pythonConfigured: false,
                    typescriptConfigured: false,
                    llmReady: false,
                    statusMessage: 'Failed'
                },
                error: 'Environment verification failed'
            };
            
            // Call with BROKEN health status
            handleInitFailure(
                mockDeps as any,
                mockInitResult,
                'BROKEN',
                'unknown'
            );
            
            // Assert: Should show "Refresh Dependencies" as primary action
            const warningCalls = showWarningMessageStub.getCalls();
            const brokenEnvCall = warningCalls.find(call => 
                call.args[0]?.includes?.('needs repair') ||
                call.args.includes?.('Refresh Dependencies')
            );
            
            assert.ok(brokenEnvCall, 
                'When health is BROKEN, should offer Refresh Dependencies action');
            
            const loginOffered = warningCalls.some(call => call.args.includes('Login to Cloud'));
            assert.strictEqual(
                loginOffered,
                false,
                'When health is BROKEN, should NOT offer Login to Cloud (local repair must come first)'
            );
        });
    });
});
