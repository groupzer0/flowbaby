import * as vscode from 'vscode';
import { FlowbabyClient } from './flowbabyClient';
import { FlowbabyContextProvider } from './flowbabyContextProvider';
import { FlowbabySetupService } from './setup/FlowbabySetupService';
import { FlowbabyStatusBar, FlowbabyStatus } from './statusBar/FlowbabyStatusBar';
import { disposeOutputChannels, debugLog } from './outputChannels';
import { getAuditLogger } from './audit/AuditLogger';
import { SessionManager } from './sessionManager';
import {
    disposeFallbackRegistrations,
    getActiveContextDiagnostics,
    isActive as isExtensionCurrentlyActive,
    markActiveContextDisposed,
    recordActivationCompletion,
    recordActivationMetadata,
    resetRegistrationGuards,
    setActiveContext,
    setExtensionActive
} from './lifecycle/registrationHelper';
import { registerFlowbabyParticipant } from './activation/registrations';
import {
    createFlowbabyCloudAuth,
    registerCloudCommands,
    createFlowbabyCloudCredentials,
    initializeProvider,
    initializeReadinessService,
    resetReadinessService,
    getReadinessService,
    initializeUsageMeter,
    getCloudClient,
    createCredentialRefreshManager,
} from './flowbaby-cloud';
import {
    getActiveWorkspacePath,
    getInitState,
    setInitState,
    handleFreshWorkspace,
    handleBrokenWorkspace,
    handleRequirementsMismatch,
    initializeClientWithTimeout,
    handleInitSuccess,
    handleInitFailure,
    // Plan 083 M4: registerApiKeyCommands removed (Cloud-only in v0.7.0)
    registerSetupCommands,
    registerDebugCommands,
    WorkspaceInitDeps
} from './activation/init';

// Re-exported for focused tests - allows exercising participant
// guard without re-running full activation
export { registerFlowbabyParticipant };

// Module-level singleton state
let flowbabyClient: FlowbabyClient | undefined;
let flowbabyContextProvider: FlowbabyContextProvider | undefined;
let sessionManager: SessionManager | undefined;
let storeMemoryToolDisposable: vscode.Disposable | undefined;
let retrieveMemoryToolDisposable: vscode.Disposable | undefined;
let cloudAuthDisposable: vscode.Disposable | undefined;
let cloudCredentialsDisposable: vscode.Disposable | undefined;
let cloudReadinessDisposable: vscode.Disposable | undefined;
let credentialRefreshManagerDisposable: vscode.Disposable | undefined;

/**
 * Plan 083 M7: One-time legacy API key migration
 * 
 * Detects if user has a stored legacy API key (flowbaby.llmApiKey) from v0.6.x
 * and shows a one-time migration message explaining Cloud-only mode.
 * The legacy secret is deleted after showing the message.
 */
async function checkLegacyApiKeyMigration(context: vscode.ExtensionContext): Promise<void> {
    try {
        const legacyApiKey = await context.secrets.get('flowbaby.llmApiKey');

        if (!legacyApiKey) {
            debugLog('No legacy API key found, migration not needed');
            return;
        }

        debugLog('Legacy API key detected, showing migration message');

        // Show one-time migration info message
        const action = await vscode.window.showInformationMessage(
            'Flowbaby v0.7.0+ uses Flowbaby Cloud for LLM access. Your previously stored API key is no longer used and will be removed. Login to Flowbaby Cloud to continue using memory features.',
            'Login to Cloud',
            'Dismiss'
        );

        if (action === 'Login to Cloud') {
            // Plan 085: Use canonical command ID
            await vscode.commands.executeCommand('flowbaby.cloud.login');
        }

        // Delete the legacy secret regardless of user action
        await context.secrets.delete('flowbaby.llmApiKey');
        debugLog('Legacy API key deleted after migration message');

        // Log the migration for audit trail
        getAuditLogger().logApiKeyClear(true);
    } catch (error) {
        debugLog('Error during legacy API key migration check', {
            error: error instanceof Error ? error.message : String(error)
        });
        // Don't block activation on migration errors
    }
}

/**
 * Extension activation entry point
 * Called when VS Code activates the extension (onStartupFinished)
 */
export async function activate(_context: vscode.ExtensionContext) {
    const activationStart = Date.now();
    const wasActive = isExtensionCurrentlyActive();
    const previousContext = getActiveContextDiagnostics();
    setExtensionActive(true);
    setActiveContext(_context);

    // Get workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath = workspaceFolders && workspaceFolders.length > 0
        ? workspaceFolders[0].uri.fsPath
        : undefined;

    if (workspacePath) {
        recordActivationMetadata({ workspacePath });
    }

    if (wasActive && previousContext?.context === _context && !previousContext?.disposed) {
        debugLog('Activation skipped: already active with healthy context', {
            activationId: previousContext.activationId,
            workspacePath,
            activationCountSinceLastDeactivation: previousContext.activationCountSinceLastDeactivation,
            suiteTag: previousContext.suiteTag
        });
        return;
    }

    const contextDiagnostics = getActiveContextDiagnostics();
    if (contextDiagnostics?.disposed) {
        debugLog('Activation aborted: context subscriptions are disposed', {
            activationId: contextDiagnostics.activationId,
            workspacePath,
            suiteTag: contextDiagnostics.suiteTag
        });
        recordActivationCompletion({ initResult: { success: false, error: 'context_disposed' } });
        setExtensionActive(false);
        return;
    }

    console.log('Flowbaby extension activated');
    debugLog('Extension activation started', { timestamp: new Date().toISOString() });

    // Initialize session management for conversation tracking
    sessionManager = new SessionManager(_context);

    if (!workspaceFolders || workspaceFolders.length === 0 || !workspacePath) {
        vscode.window.showWarningMessage(
            'Flowbaby requires an open workspace folder'
        );
        markActiveContextDisposed();
        recordActivationCompletion({ initResult: { success: false, error: 'no_workspace' } });
        setExtensionActive(false);
        return;
    }

    setInitState(workspacePath, { initialized: false, initFailed: false });

    // Initialize security audit logging early
    getAuditLogger().initialize(workspacePath);

    // Initialize Flowbaby client and core services
    try {
        flowbabyClient = new FlowbabyClient(workspacePath, _context, sessionManager);

        // Create output channel for agent activity logging
        const agentOutputChannel = vscode.window.createOutputChannel('Flowbaby Agent Activity');

        // Initialize status bar early for user feedback
        const statusBar = new FlowbabyStatusBar(_context);

        // Initialize setup service for environment management
        // Plan 054: Provide daemon stop hook so refresh can rename venv safely on Windows.
        const setupService = new FlowbabySetupService(
            _context,
            workspacePath,
            agentOutputChannel,
            undefined,
            undefined,
            statusBar,
            async () => {
                if (flowbabyClient) {
                    await flowbabyClient.stopDaemon();
                }
            }
        );

        // Register command groups
        registerDebugCommands(_context);

        // Plan 073: POC-2 commands removed - synthesis is now production (copilotSynthesis.ts)
        // POC evaluation complete, synthesis integrated into retrieve() method

        // Plan 083 M4: Legacy API key commands removed (Cloud-only in v0.7.0)
        // registerApiKeyCommands(_context, workspacePath, statusBar);
        registerSetupCommands(
            _context,
            workspacePath,
            setupService,
            statusBar,
            agentOutputChannel,
            sessionManager,
            () => flowbabyClient,
            (client) => { flowbabyClient = client; },
            () => flowbabyContextProvider,
            (provider) => { flowbabyContextProvider = provider; },
            (store, retrieve) => {
                storeMemoryToolDisposable = store;
                retrieveMemoryToolDisposable = retrieve;
            }
        );

        // Flowbaby Cloud (OAuth + command surface)
        // Commands are contributed in package.json but must be registered at runtime.
        const cloudOutputChannel = vscode.window.createOutputChannel('Flowbaby Cloud');
        const cloudAuth = createFlowbabyCloudAuth(_context.secrets, cloudOutputChannel);
        _context.subscriptions.push(cloudOutputChannel, cloudAuth);
        // Plan 085: Pass output channel for command observability
        // Plan 097: Pass cloud client for dashboard API calls
        registerCloudCommands(_context, cloudAuth, getCloudClient(), cloudOutputChannel);
        cloudAuthDisposable = cloudAuth;

        // Plan 097: Register sidebar dashboard view provider
        const { DashboardViewProvider } = await import('./flowbaby-cloud/dashboard/DashboardViewProvider');
        const dashboardProvider = new DashboardViewProvider(
            _context.extensionUri,
            cloudAuth,
            getCloudClient()
        );
        _context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                DashboardViewProvider.viewType,
                dashboardProvider,
                { webviewOptions: { retainContextWhenHidden: true } }
            )
        );

        // Plan 085: Wire status bar to auth state changes
        // When user logs in/out, update status bar without requiring reload
        _context.subscriptions.push(
            cloudAuth.onDidChangeAuthState(async (event) => {
                const currentWorkspacePath = getActiveWorkspacePath();
                const initState = currentWorkspacePath ? getInitState(currentWorkspacePath) : undefined;
                const clientInitialized = initState?.initialized === true;

                if (event.isAuthenticated) {
                    // User logged in - set Ready if client is initialized
                    if (clientInitialized) {
                        statusBar.setStatus(FlowbabyStatus.Ready);
                        debugLog('Plan 085: Status bar updated to Ready after Cloud login', {
                            tier: event.tier,
                            clientInitialized
                        });
                    } else {
                        // Client not yet initialized - stay in current state
                        // The init flow will set the correct status when it completes
                        debugLog('Plan 085: Cloud login complete but client not initialized', {
                            tier: event.tier,
                            clientInitialized
                        });
                    }
                } else {
                    // User logged out - set NeedsCloudLogin
                    statusBar.setStatus(FlowbabyStatus.NeedsCloudLogin);
                    debugLog('Plan 085: Status bar updated to NeedsCloudLogin after logout');
                }
            })
        );

        // Plan 081: Wire Cloud credentials manager and provider singleton
        // This enables all Python bridge execution paths to receive Cloud env vars.
        const cloudCredentials = createFlowbabyCloudCredentials(cloudAuth, cloudOutputChannel);
        _context.subscriptions.push(cloudCredentials);
        cloudCredentialsDisposable = cloudCredentials;

        // Initialize the provider singleton so downstream components can get Cloud env
        initializeProvider(cloudCredentials);

        // Plan 092 M1: Wire CredentialRefreshManager for daemon coordination
        // This enables graceful daemon restart when credentials are refreshed,
        // preventing "stale credentials" failures after token rotation.
        const credentialRefreshManager = createCredentialRefreshManager(cloudCredentials, cloudOutputChannel);
        _context.subscriptions.push(credentialRefreshManager);
        credentialRefreshManagerDisposable = credentialRefreshManager;
        debugLog('Plan 092: CredentialRefreshManager initialized');

        // Plan 090: Initialize usage metering with Cloud client and session token getter
        // This enables accurate credit consumption tracking after Bedrock operations.
        initializeUsageMeter(
            getCloudClient(),
            async () => (await cloudAuth.getSessionToken()) ?? null
        );
        debugLog('Plan 090: UsageMeter initialized with Cloud dependencies');

        // Plan 087: Initialize Cloud Readiness Service
        // This provides unified readiness state (auth/vend/bridge) and throttled error display.
        // Note: bridgeChecker is undefined during bootstrap - will be wired after daemon init.
        const readinessService = initializeReadinessService(
            cloudAuth,
            cloudCredentials,
            undefined, // Bridge checker wired later after daemon init
            cloudOutputChannel
        );
        _context.subscriptions.push(readinessService);
        cloudReadinessDisposable = readinessService;
        debugLog('Plan 087: CloudReadinessService initialized');

        // Plan 087: Wire status bar updates to readiness state changes
        _context.subscriptions.push(
            readinessService.onDidChangeReadiness((state) => {
                const currentWorkspacePath = getActiveWorkspacePath();
                const initState = currentWorkspacePath ? getInitState(currentWorkspacePath) : undefined;
                const clientInitialized = initState?.initialized === true;

                debugLog('Plan 087: Readiness state changed', {
                    auth: state.auth,
                    vend: state.vend,
                    bridge: state.bridge,
                    overall: state.overall,
                    clientInitialized,
                });

                // Only update status bar if client is initialized (avoid race with bootstrap)
                if (clientInitialized) {
                    switch (state.overall) {
                        case 'ready':
                            statusBar.setStatus(FlowbabyStatus.Ready);
                            break;
                        case 'login_required':
                            statusBar.setStatus(FlowbabyStatus.NeedsCloudLogin);
                            break;
                        case 'degraded':
                        case 'error':
                            statusBar.setStatus(FlowbabyStatus.Error,
                                state.lastError?.message || 'Cloud service issue');
                            break;
                    }
                }
            })
        );

        // Plan 084: Log effective Cloud endpoint for diagnosability
        const { getApiBaseUrl } = await import('./flowbaby-cloud/types');
        const effectiveEndpoint = getApiBaseUrl();
        cloudOutputChannel.appendLine(`[${new Date().toISOString()}] Cloud API endpoint: ${effectiveEndpoint}`);
        debugLog('Flowbaby Cloud credentials manager and provider initialized', { endpoint: effectiveEndpoint });

        // Plan 083 M7: One-time legacy API key migration
        // Detect if user has a stored legacy API key and show migration message
        await checkLegacyApiKeyMigration(_context);

        // Register chat participant early - shows in UI immediately with graceful
        // degradation when backend is still initializing
        registerFlowbabyParticipant({
            context: _context,
            getClient: () => flowbabyClient,
            getContextProvider: () => flowbabyContextProvider,
            getInitState,
            getActiveWorkspacePath
        });
        console.log('@flowbaby chat participant registered (pending initialization)');

        // Proactive health check before client initialization
        const healthStatus = await setupService.checkWorkspaceHealth();
        debugLog('Workspace health check result', { healthStatus });

        // Handle FRESH workspace (no .flowbaby directory)
        if (healthStatus === 'FRESH') {
            handleFreshWorkspace(workspacePath, statusBar, healthStatus);
            setExtensionActive(false);
            return;
        }

        // Handle BROKEN workspace (corrupted environment)
        if (healthStatus === 'BROKEN') {
            handleBrokenWorkspace(workspacePath, statusBar, healthStatus);
            setExtensionActive(false);
            return;
        }

        // healthStatus === 'VALID' - proceed with client initialization
        const requirementsStatus = await setupService.checkRequirementsUpToDate();
        if (requirementsStatus === 'mismatch') {
            handleRequirementsMismatch(workspacePath, healthStatus, requirementsStatus);
            setExtensionActive(false);
            return;
        }
        recordActivationMetadata({ healthStatus, requirementsStatus });

        // Initialize client with timeout protection
        const initResult = await initializeClientWithTimeout(flowbabyClient);

        // Build dependencies for init handlers
        const initDeps: WorkspaceInitDeps = {
            context: _context,
            workspacePath,
            client: flowbabyClient,
            setupService,
            statusBar,
            agentOutputChannel,
            sessionManager,
            activationStart,
            setFlowbabyClient: (client) => { flowbabyClient = client; },
            setFlowbabyContextProvider: (provider) => { flowbabyContextProvider = provider; },
            setToolDisposables: (store, retrieve) => {
                storeMemoryToolDisposable = store;
                retrieveMemoryToolDisposable = retrieve;
            },
            // Plan 092 M1: Pass CredentialRefreshManager for daemon coordination
            credentialRefreshManager
        };

        if (initResult.success) {
            await handleInitSuccess(initDeps, initResult, healthStatus, requirementsStatus);
        } else {
            handleInitFailure(initDeps, initResult, healthStatus, requirementsStatus);
            setExtensionActive(false);
        }
    } catch (error) {
        console.error('Failed to create Flowbaby client:', error);
        recordActivationCompletion({ initResult: { success: false, error: error instanceof Error ? error.message : String(error) } });
        setExtensionActive(false);
        vscode.window.showErrorMessage(
            `Flowbaby initialization error: ${error}`
        );
    }
}

/**
 * Extension deactivation entry point
 * Called when VS Code deactivates the extension
 */
export async function deactivate() {
    console.log('Flowbaby extension deactivated');
    markActiveContextDisposed();
    setExtensionActive(false);

    // Shutdown background operations (sends SIGTERM to running processes)
    try {
        const { BackgroundOperationManager } = await import('./background/BackgroundOperationManager');
        const manager = BackgroundOperationManager.getInstance();
        await manager.shutdown();
        console.log('BackgroundOperationManager shutdown complete');
    } catch (error) {
        console.error('Failed to shutdown BackgroundOperationManager:', error);
    }

    if (storeMemoryToolDisposable) {
        storeMemoryToolDisposable.dispose();
        storeMemoryToolDisposable = undefined;
    }
    if (retrieveMemoryToolDisposable) {
        retrieveMemoryToolDisposable.dispose();
        retrieveMemoryToolDisposable = undefined;
    }

    if (cloudAuthDisposable) {
        cloudAuthDisposable.dispose();
        cloudAuthDisposable = undefined;
    }

    // Plan 081: Dispose Cloud credentials manager (also resets provider singleton)
    if (cloudCredentialsDisposable) {
        cloudCredentialsDisposable.dispose();
        cloudCredentialsDisposable = undefined;
    }

    // Plan 092: Dispose CredentialRefreshManager
    if (credentialRefreshManagerDisposable) {
        credentialRefreshManagerDisposable.dispose();
        credentialRefreshManagerDisposable = undefined;
    }

    // Plan 087: Dispose Cloud readiness service
    if (cloudReadinessDisposable) {
        cloudReadinessDisposable.dispose();
        cloudReadinessDisposable = undefined;
    }
    resetReadinessService();

    // Dispose singleton output channels
    disposeOutputChannels();
    disposeFallbackRegistrations();
    resetRegistrationGuards();

    flowbabyClient = undefined;
    flowbabyContextProvider = undefined;
}

/**
 * Get the active Flowbaby client instance
 * Used by chat participant (Milestone 2)
 */
export function getFlowbabyClient(): FlowbabyClient | undefined {
    return flowbabyClient;
}
