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
    getActiveWorkspacePath,
    getInitState,
    setInitState,
    handleFreshWorkspace,
    handleBrokenWorkspace,
    handleRequirementsMismatch,
    initializeClientWithTimeout,
    handleInitSuccess,
    handleInitFailure,
    registerApiKeyCommands,
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
        
        registerApiKeyCommands(_context, workspacePath, statusBar);
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
            }
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
