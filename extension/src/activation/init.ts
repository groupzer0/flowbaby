/**
 * Workspace Initialization and State Management
 * 
 * Handles workspace health checks, client initialization, state tracking,
 * and setup/configuration command registration.
 * 
 * @module activation/init
 */

import * as vscode from 'vscode';
import { FlowbabyClient, InitializeResult } from '../flowbabyClient';
import { FlowbabySetupService } from '../setup/FlowbabySetupService';
import { FlowbabyStatusBar, FlowbabyStatus } from '../statusBar/FlowbabyStatusBar';
import { FlowbabyContextProvider } from '../flowbabyContextProvider';
import { SessionManager } from '../sessionManager';
import { getFlowbabyOutputChannel, debugLog } from '../outputChannels';
// Plan 108: Import DiagnoseEnvironmentService for environment diagnostics command
import { DiagnoseEnvironmentService } from '../setup/DiagnoseEnvironmentService';
import { InterpreterSelectionService } from '../setup/InterpreterSelectionService';
import { PreflightVerificationService } from '../setup/PreflightVerificationService';
// Plan 083 M4: getAuditLogger import removed - was only used by legacy API key commands
// Plan 087: Import readiness service for prompt gating
import { getReadinessService } from '../flowbaby-cloud';
import {
    recordActivationCompletion,
    areToolsRegistered,
    isParticipantRegistered
} from '../lifecycle/registrationHelper';
import { registerIngestForAgentCommand } from '../commands/ingestForAgent';
import { registerRetrieveForAgentCommand } from '../commands/retrieveForAgent';
import { registerVisualizeGraphCommand } from '../commands/graphVisualization';
import {
    registerLanguageModelTools,
    registerBackgroundStatusCommand,
    registerCaptureCommands,
    registerValidationCommands,
    LMToolRegistrationResult
} from './registrations';

// ============================================================================
// Types
// ============================================================================

/**
 * Workspace initialization state
 */
export interface WorkspaceInitState {
    initialized: boolean;
    initFailed: boolean;
}

/**
 * Result of client initialization
 */
export interface ClientInitResult {
    success: boolean;
    toolResult?: LMToolRegistrationResult;
    error?: string;
}

/**
 * Dependencies for workspace initialization
 */
export interface WorkspaceInitDeps {
    context: vscode.ExtensionContext;
    workspacePath: string;
    client: FlowbabyClient;
    setupService: FlowbabySetupService;
    statusBar: FlowbabyStatusBar;
    agentOutputChannel: vscode.OutputChannel;
    sessionManager?: SessionManager;
    activationStart: number;
    setFlowbabyClient: (client: FlowbabyClient | undefined) => void;
    setFlowbabyContextProvider: (provider: FlowbabyContextProvider | undefined) => void;
    setToolDisposables: (store?: vscode.Disposable, retrieve?: vscode.Disposable) => void;
    /** Plan 092 M1: Optional CredentialRefreshManager for daemon coordination */
    credentialRefreshManager?: { registerDaemonController(controller: { restart(): Promise<void>; isRunning(): boolean; getPendingRequestCount(): number }): void };
}

// ============================================================================
// State Management
// ============================================================================

const workspaceInitState = new Map<string, WorkspaceInitState>();

/**
 * Get the active workspace path from editor or first workspace folder
 */
export function getActiveWorkspacePath(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (folder) {
            return folder.uri.fsPath;
        }
    }
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

/**
 * Get initialization state for a workspace
 */
export function getInitState(workspacePath: string): WorkspaceInitState {
    if (!workspaceInitState.has(workspacePath)) {
        workspaceInitState.set(workspacePath, { initialized: false, initFailed: false });
    }
    return workspaceInitState.get(workspacePath)!;
}

/**
 * Update initialization state for a workspace
 */
export function setInitState(workspacePath: string, updates: Partial<WorkspaceInitState>): WorkspaceInitState {
    const current = getInitState(workspacePath);
    const next = { ...current, ...updates };
    workspaceInitState.set(workspacePath, next);
    return next;
}

/**
 * Clear all workspace state (for testing)
 */
export function clearWorkspaceState(): void {
    workspaceInitState.clear();
}

// ============================================================================
// Health Check Handling
// ============================================================================

export type HealthStatus = 'FRESH' | 'BROKEN' | 'VALID';

/**
 * Handle FRESH workspace state (no .flowbaby directory)
 */
export function handleFreshWorkspace(
    workspacePath: string,
    statusBar: FlowbabyStatusBar,
    healthStatus: HealthStatus
): void {
    console.log('Flowbaby workspace not initialized');
    statusBar.setStatus(FlowbabyStatus.SetupRequired);
    setInitState(workspacePath, { initialized: false, initFailed: true });

    // Non-blocking prompt for initialization
    vscode.window.showInformationMessage(
        'Flowbaby needs to be set up. Initialize now?',
        'Initialize',
        'Later'
    ).then(action => {
        if (action === 'Initialize') {
            vscode.commands.executeCommand('Flowbaby.initializeWorkspace');
        }
    });

    recordActivationCompletion({
        healthStatus,
        initResult: { success: false, error: 'workspace_fresh' }
    });
}

/**
 * Handle BROKEN workspace state (corrupted environment)
 */
export function handleBrokenWorkspace(
    workspacePath: string,
    statusBar: FlowbabyStatusBar,
    healthStatus: HealthStatus
): void {
    console.warn('Flowbaby workspace environment needs repair');
    statusBar.setStatus(FlowbabyStatus.Error);
    setInitState(workspacePath, { initialized: false, initFailed: true });

    const outputChannel = getFlowbabyOutputChannel();
    outputChannel.appendLine('Flowbaby workspace environment needs repair.');
    outputChannel.appendLine('The Python environment may be missing or corrupted.');
    outputChannel.appendLine('Use "Flowbaby: Initialize Workspace" to repair.');

    // Non-blocking prompt for repair with warning styling
    vscode.window.showWarningMessage(
        'Flowbaby environment needs repair.',
        'Repair Environment',
        'Later'
    ).then(action => {
        if (action === 'Repair Environment') {
            vscode.commands.executeCommand('Flowbaby.initializeWorkspace');
        }
    });

    recordActivationCompletion({
        healthStatus,
        initResult: { success: false, error: 'workspace_broken' }
    });
}

/**
 * Handle requirements mismatch
 */
export function handleRequirementsMismatch(
    workspacePath: string,
    healthStatus: HealthStatus,
    requirementsStatus: string
): void {
    setInitState(workspacePath, { initialized: false, initFailed: true });
    
    vscode.window.showWarningMessage(
        'Flowbaby dependencies are out of date for this workspace. Refresh now?',
        'Refresh Dependencies',
        'Later'
    ).then(action => {
        if (action === 'Refresh Dependencies') {
            vscode.commands.executeCommand('Flowbaby.refreshDependencies');
        }
    });
    
    recordActivationCompletion({
        healthStatus,
        requirementsStatus,
        initResult: { success: false, error: 'requirements_mismatch' }
    });
}

// ============================================================================
// Client Initialization
// ============================================================================

/**
 * Initialize the Flowbaby client with timeout
 * 
 * Uses 60s timeout to handle first-run database creation
 */
export async function initializeClientWithTimeout(
    client: FlowbabyClient,
    timeoutMs: number = 60000
): Promise<InitializeResult> {
    const initPromise = client.initialize();

    const timeoutPromise = new Promise<InitializeResult>((resolve) => {
        setTimeout(() => {
            console.warn(`Flowbaby initialization timed out after ${timeoutMs / 1000}s`);
            resolve({
                success: false,
                apiKeyState: {
                    pythonConfigured: false,
                    typescriptConfigured: false,
                    llmReady: false,
                    statusMessage: 'Initialization timed out'
                },
                error: `Initialization timed out after ${timeoutMs / 1000}s`
            });
        }, timeoutMs);
    });

    return Promise.race([initPromise, timeoutPromise]);
}

/**
 * Handle successful client initialization
 */
export async function handleInitSuccess(
    deps: WorkspaceInitDeps,
    initResult: InitializeResult,
    healthStatus: HealthStatus,
    requirementsStatus: string
): Promise<ClientInitResult> {
    const {
        context, workspacePath, client, setupService, statusBar,
        agentOutputChannel, sessionManager, activationStart,
        setFlowbabyContextProvider, setToolDisposables
    } = deps;

    const initDuration = Date.now() - activationStart;
    console.log('Flowbaby client initialized successfully');
    debugLog('Client initialization successful', { duration_ms: initDuration });

    // Plan 087: Set status bar based on Cloud readiness state (not legacy API key)
    const readinessService = getReadinessService();
    if (readinessService) {
        // Evaluate readiness (skip bridge check during bootstrap per Plan 084)
        const state = await readinessService.evaluateReadiness({ skipBridgeCheck: true });
        debugLog('Plan 087: Initial readiness evaluation', {
            auth: state.auth,
            vend: state.vend,
            overall: state.overall,
        });

        switch (state.overall) {
            case 'ready':
                statusBar.setStatus(FlowbabyStatus.Ready);
                break;
            case 'login_required':
                statusBar.setStatus(FlowbabyStatus.NeedsCloudLogin);
                break;
            case 'degraded':
            case 'error':
                statusBar.setStatus(FlowbabyStatus.Error, state.lastError?.message || 'Cloud service issue');
                break;
        }
    } else {
        // Fallback to legacy logic if readiness service not available
        if (initResult.apiKeyState.llmReady) {
            statusBar.setStatus(FlowbabyStatus.Ready);
        } else {
            statusBar.setStatus(FlowbabyStatus.NeedsCloudLogin);
        }
    }

    // Mark client as initialized for graceful degradation
    setInitState(workspacePath, { initialized: true, initFailed: false });

    // Register capture commands
    registerCaptureCommands(context, client);

    // Register agent ingestion command
    registerIngestForAgentCommand(context, client, agentOutputChannel, setupService);

    // Initialize BackgroundOperationManager
    try {
        const { BackgroundOperationManager } = await import('../background/BackgroundOperationManager');
        const manager = BackgroundOperationManager.initialize(context, agentOutputChannel);
        await manager.initializeForWorkspace(workspacePath);
        
        // Wire up daemon manager
        const daemonManager = client.getDaemonManager();
        if (daemonManager) {
            manager.setDaemonManager(daemonManager);
            
            // Plan 092 M1.4: Register daemon manager with CredentialRefreshManager
            // This enables coordinated restart when credentials are refreshed.
            if (deps.credentialRefreshManager) {
                deps.credentialRefreshManager.registerDaemonController(daemonManager);
                debugLog('Plan 092: Daemon controller registered with CredentialRefreshManager');
            }
        }
        
        console.log('BackgroundOperationManager initialized successfully');
    } catch (error) {
        console.error('Failed to initialize BackgroundOperationManager:', error);
    }

    // Register backgroundStatus command
    registerBackgroundStatusCommand(context);

    // Register validation commands
    registerValidationCommands(context, client);

    // Register graph visualization command (Plan 067)
    registerVisualizeGraphCommand(context, () => client, agentOutputChannel);

    // Initialize FlowbabyContextProvider
    const { FlowbabyContextProvider } = await import('../flowbabyContextProvider');
    const contextProvider = new FlowbabyContextProvider(client, agentOutputChannel, setupService, sessionManager);
    setFlowbabyContextProvider(contextProvider);
    console.log('FlowbabyContextProvider initialized successfully');

    // Register agent retrieval command
    registerRetrieveForAgentCommand(context, contextProvider, agentOutputChannel);

    // Register language model tools
    const toolResult = await registerLanguageModelTools({
        context,
        outputChannel: agentOutputChannel,
        contextProvider
    });
    setToolDisposables(toolResult.storeToolDisposable, toolResult.retrieveToolDisposable);

    recordActivationCompletion({
        healthStatus,
        requirementsStatus,
        initResult: { success: true },
        toolsRegistered: areToolsRegistered(),
        participantRegistered: isParticipantRegistered()
    });

    // Show post-init prompts
    await showPostInitPrompts(context, initResult);

    return { success: true, toolResult };
}

/**
 * Handle failed client initialization
 * 
 * Plan 109: Gate cloud-login prompts on local environment health.
 * Only offer "Login to Cloud" when local preflight is healthy but auth is missing.
 * When local environment is broken, guide users to "Refresh Bridge Dependencies" first.
 */
export function handleInitFailure(
    deps: WorkspaceInitDeps,
    initResult: InitializeResult,
    healthStatus: HealthStatus,
    requirementsStatus: string
): ClientInitResult {
    const { workspacePath, statusBar, activationStart } = deps;

    const initDuration = Date.now() - activationStart;
    console.warn('Flowbaby client initialization failed (see Output Channel)');
    debugLog('Client initialization failed', { duration_ms: initDuration });
    statusBar.setStatus(FlowbabyStatus.SetupRequired);

    setInitState(workspacePath, { initialized: false, initFailed: true });

    // Plan 109: Determine if local environment is healthy or broken
    // If healthStatus is BROKEN or FRESH, the local environment needs repair first
    const isLocalEnvHealthy = healthStatus === 'VALID';
    const needsLocalRepair = healthStatus === 'BROKEN' || requirementsStatus === 'mismatch';

    // Show helpful guidance
    // Plan 083 M5: Updated guidance for Cloud-only v0.7.0+
    // Plan 109: Prioritize local repair guidance when environment is broken
    const outputChannel = getFlowbabyOutputChannel();
    outputChannel.appendLine('Failed to initialize Flowbaby. Common issues:');
    outputChannel.appendLine('');
    
    if (needsLocalRepair) {
        outputChannel.appendLine('1. Missing or outdated Python dependencies:');
        outputChannel.appendLine('   - Use "Flowbaby: Refresh Bridge Dependencies" to repair');
        outputChannel.appendLine('   - Or use "Flowbaby: Initialize Workspace" to set up the environment');
        outputChannel.appendLine('');
        outputChannel.appendLine('2. Not logged in to Flowbaby Cloud (after fixing dependencies):');
        outputChannel.appendLine('   - Use "Flowbaby Cloud: Login" command to authenticate');
    } else {
        outputChannel.appendLine('1. Not logged in to Flowbaby Cloud:');
        outputChannel.appendLine('   - Use "Flowbaby Cloud: Login" command to authenticate');
        outputChannel.appendLine('   - Cloud login is required for LLM memory operations');
        outputChannel.appendLine('');
        outputChannel.appendLine('2. Missing Python dependencies:');
        outputChannel.appendLine('   - Use "Flowbaby: Initialize Workspace" to set up the environment');
        outputChannel.appendLine('   - Or use "Flowbaby: Refresh Bridge Dependencies" to repair');
    }
    outputChannel.show();

    recordActivationCompletion({
        healthStatus,
        requirementsStatus,
        initResult: { success: false, error: initResult.error }
    });

    // Plan 109: Non-blocking warning with context-appropriate actions
    // When local env is broken, offer Refresh Dependencies first (not Login to Cloud)
    if (needsLocalRepair) {
        debugLog('Plan 109: Init failure - local environment needs repair first', {
            healthStatus,
            requirementsStatus
        });
        vscode.window.showWarningMessage(
            'Flowbaby initialization failed. Local environment needs repair.',
            'Refresh Dependencies',
            'Open Output',
            'Dismiss'
        ).then(action => {
            if (action === 'Refresh Dependencies') {
                vscode.commands.executeCommand('Flowbaby.refreshDependencies');
            } else if (action === 'Open Output') {
                outputChannel.show();
            }
        });
    } else {
        // Local env appears healthy - likely a cloud auth issue
        debugLog('Plan 109: Init failure - likely cloud auth issue', {
            healthStatus,
            requirementsStatus,
            isLocalEnvHealthy
        });
        vscode.window.showWarningMessage(
            'Flowbaby initialization failed. Check Output > Flowbaby for setup instructions.',
            'Open Output',
            'Login to Cloud',
            'Dismiss'
        ).then(action => {
            if (action === 'Open Output') {
                outputChannel.show();
            } else if (action === 'Login to Cloud') {
                vscode.commands.executeCommand('flowbaby.cloud.login');
            }
        });
    }

    return { success: false, error: initResult.error };
}

// ============================================================================
// Post-Init UI
// ============================================================================

/**
 * Show post-initialization prompts (API key or walkthrough)
 * 
 * Plan 087: Uses CloudReadinessService for prompt gating instead of legacy llmReady.
 * This ensures prompts reflect actual Cloud auth state, not legacy API key state.
 */
async function showPostInitPrompts(
    context: vscode.ExtensionContext,
    initResult: InitializeResult
): Promise<void> {
    // Plan 087: Use readiness service for truthful Cloud state
    const readinessService = getReadinessService();
    const needsLogin = readinessService?.needsLogin() ?? !initResult.apiKeyState.llmReady;

    if (needsLogin) {
        // Plan 087: Prompt for Cloud login only when not authenticated
        // Uses readiness service to avoid prompting when already logged in but vend failing
        debugLog('Plan 087: Post-init prompt - login required', {
            readinessServiceAvailable: !!readinessService,
            needsLogin,
        });

        const prompt = vscode.window.showWarningMessage(
            'Flowbaby initialized successfully! Login to Flowbaby Cloud to enable memory operations.',
            { modal: true },
            'Login to Cloud',
            'Later'
        );

        if (prompt && typeof (prompt as Thenable<string | undefined>).then === 'function') {
            prompt.then(action => {
                if (action === 'Login to Cloud') {
                    // Plan 085: Use canonical command ID
                    vscode.commands.executeCommand('flowbaby.cloud.login');
                }
            }, error => {
                debugLog('Init Cloud login prompt suppressed', {
                    error: error instanceof Error ? error.message : String(error)
                });
            });
        }

        // Show Agent Team recommendation even when login is required
        // Users can see the recommendation and dismiss it independently of login flow
        await showAgentTeamRecommendation(context);
    } else {
        // Already authenticated - check if we should show degraded state message
        const isFullyReady = readinessService?.isFullyReady() ?? initResult.apiKeyState.llmReady;

        if (!isFullyReady && readinessService) {
            // Plan 087: User is authenticated but vend/bridge has issues - show degraded guidance
            const remediation = readinessService.getRemediation();
            debugLog('Plan 087: Post-init prompt - degraded state', { message: remediation.message });

            vscode.window.showWarningMessage(
                remediation.message,
                remediation.primaryAction?.label || 'Check Status',
                'Dismiss'
            ).then(action => {
                if (action === remediation.primaryAction?.label) {
                    vscode.commands.executeCommand(remediation.primaryAction!.commandId);
                } else if (action === 'Check Status') {
                    vscode.commands.executeCommand('flowbaby.cloud.status');
                }
            });

            // Show Agent Team recommendation in degraded state too
            await showAgentTeamRecommendation(context);
        } else {
            // Offer walkthrough for users who are fully set up
            const hasGlobalState = !!context.globalState;
            const canReadGlobalState = hasGlobalState && typeof context.globalState.get === 'function';
            const canWriteGlobalState = hasGlobalState && typeof context.globalState.update === 'function';

            const walkthroughPromptDismissed = canReadGlobalState
                ? context.globalState.get<boolean>('flowbaby.walkthroughPromptDismissed', false)
                : false;

            if (!walkthroughPromptDismissed) {
                const info = vscode.window.showInformationMessage(
                    'Flowbaby is ready! View the Getting Started guide?',
                    'View Guide',
                    'Don\'t Show Again'
                );

                if (info && typeof (info as Thenable<string | undefined>).then === 'function') {
                    info.then(action => {
                        if (action === 'View Guide') {
                            vscode.commands.executeCommand('workbench.action.openWalkthrough', 'Flowbaby.flowbabySetup');
                        } else if (action === 'Don\'t Show Again' && canWriteGlobalState) {
                            context.globalState.update('flowbaby.walkthroughPromptDismissed', true);
                        }
                    }, error => {
                        debugLog('Walkthrough prompt suppressed', {
                            error: error instanceof Error ? error.message : String(error)
                        });
                    });
                }
            }

            // Show Agent Team recommendation (separate from walkthrough, has own dismiss state)
            await showAgentTeamRecommendation(context);
        }
    }
}

/**
 * Show a recommendation to use Flowbaby with the Agent Team.
 * 
 * This prompt appears after successful initialization for new users or
 * users who upgraded to 0.7.0. It can be permanently dismissed.
 * 
 * The recommendation is shown independently of the walkthrough prompt
 * to ensure users see it even if they dismissed the walkthrough.
 * 
 * Can be called from handleInitSuccess or other activation paths where
 * the extension is operational (even if login is required).
 */
export async function showAgentTeamRecommendation(
    context: vscode.ExtensionContext
): Promise<void> {
    const hasGlobalState = !!context.globalState;
    const canReadGlobalState = hasGlobalState && typeof context.globalState.get === 'function';
    const canWriteGlobalState = hasGlobalState && typeof context.globalState.update === 'function';

    const agentTeamPromptDismissed = canReadGlobalState
        ? context.globalState.get<boolean>('flowbaby.agentTeamPromptDismissed', false)
        : false;

    if (agentTeamPromptDismissed) {
        debugLog('Agent Team recommendation already dismissed');
        return;
    }

    try {
        const action = await vscode.window.showInformationMessage(
            'For the intended experience, we recommend using Flowbaby together with the Flowbaby Agent Team.',
            'View Agent Team',
            'Don\'t Show Again'
        );

        if (action === 'View Agent Team') {
            // Open the Agent Team repository in browser
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/groupzer0/vs-code-agents'));
        } else if (action === 'Don\'t Show Again' && canWriteGlobalState) {
            await context.globalState.update('flowbaby.agentTeamPromptDismissed', true);
            debugLog('Agent Team recommendation dismissed permanently');
        }
    } catch (error) {
        debugLog('Agent Team recommendation prompt suppressed', {
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

// ============================================================================
// API Key Commands (DEPRECATED - Plan 083 M4: Cloud-only in v0.7.0)
// ============================================================================

/**
 * Register API key management commands
 * 
 * @deprecated Plan 083 M4: Legacy API key commands removed in v0.7.0.
 * Users should use flowbaby.cloud.login instead (Plan 085: canonical command ID).
 * This function is preserved for backward compatibility but is no longer
 * called from extension.ts. Will be removed in a future version.
 */
export function registerApiKeyCommands(
    _context: vscode.ExtensionContext,
    _workspacePath: string,
    _statusBar: FlowbabyStatusBar
): void {
    // Plan 083 M4: All legacy API key commands removed in v0.7.0
    // Commands removed from package.json:
    // - Flowbaby.configureApiKey
    // - Flowbaby.setApiKey  
    // - Flowbaby.clearApiKey
    //
    // Users should use flowbaby.cloud.login for authentication (Plan 085).
    // This function body intentionally left empty to maintain export signature
    // for any external callers during transition period.
    debugLog('registerApiKeyCommands called but is deprecated - Cloud-only in v0.7.0');
}

// ============================================================================
// Setup Commands
// ============================================================================

/**
 * Register setup and environment commands
 */
export function registerSetupCommands(
    context: vscode.ExtensionContext,
    workspacePath: string,
    setupService: FlowbabySetupService,
    statusBar: FlowbabyStatusBar,
    agentOutputChannel: vscode.OutputChannel,
    sessionManager: SessionManager | undefined,
    getClient: () => FlowbabyClient | undefined,
    setClient: (client: FlowbabyClient | undefined) => void,
    getContextProvider: () => FlowbabyContextProvider | undefined,
    setContextProvider: (provider: FlowbabyContextProvider | undefined) => void,
    setToolDisposables: (store?: vscode.Disposable, retrieve?: vscode.Disposable) => void
): void {
    // Setup Environment command
    const setupEnvironmentCommand = vscode.commands.registerCommand(
        'Flowbaby.setupEnvironment',
        async () => {
            await setupService.createEnvironment();
        }
    );
    context.subscriptions.push(setupEnvironmentCommand);

    // Initialize Workspace command (main entry point)
    const initializeWorkspaceCommand = vscode.commands.registerCommand(
        'Flowbaby.initializeWorkspace',
        async () => {
            const outputChannel = getFlowbabyOutputChannel();
            outputChannel.appendLine('[Init] Starting workspace initialization...');

            const success = await setupService.createEnvironment();

            if (!success) {
                outputChannel.appendLine('[Init] ❌ Environment creation failed');
                return;
            }

            outputChannel.appendLine('[Init] ✅ Environment created successfully');

            const currentClient = getClient();
            if (success && currentClient) {
                outputChannel.appendLine('[Init] Preparing to initialize Flowbaby client...');

                // Recreate FlowbabyClient to pick up the new venv Python path
                outputChannel.appendLine('[Init] Recreating FlowbabyClient with new environment...');
                debugLog('Recreating FlowbabyClient after environment setup');
                const newClient = new FlowbabyClient(workspacePath, context);
                setClient(newClient);

                try {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: "Initializing Flowbaby databases...",
                        cancellable: false
                    }, async () => {
                        const initResult = await newClient.initialize();

                        if (initResult.success) {
                            setInitState(workspacePath, { initialized: true, initFailed: false });

                            // Plan 087: Use readiness service for status bar state (not legacy llmReady)
                            const readinessService = getReadinessService();
                            if (readinessService) {
                                const state = await readinessService.evaluateReadiness({ skipBridgeCheck: true });
                                switch (state.overall) {
                                    case 'ready':
                                        statusBar.setStatus(FlowbabyStatus.Ready);
                                        break;
                                    case 'login_required':
                                        statusBar.setStatus(FlowbabyStatus.NeedsCloudLogin);
                                        break;
                                    case 'degraded':
                                    case 'error':
                                        statusBar.setStatus(FlowbabyStatus.Error, state.lastError?.message || 'Cloud service issue');
                                        break;
                                }
                            } else if (initResult.apiKeyState.llmReady) {
                                statusBar.setStatus(FlowbabyStatus.Ready);
                            } else {
                                statusBar.setStatus(FlowbabyStatus.NeedsCloudLogin);
                            }

                            // Initialize BackgroundOperationManager
                            try {
                                const { BackgroundOperationManager } = await import('../background/BackgroundOperationManager');
                                const manager = BackgroundOperationManager.initialize(context, agentOutputChannel);
                                await manager.initializeForWorkspace(workspacePath);
                                
                                const daemonManager = newClient.getDaemonManager();
                                if (daemonManager) {
                                    manager.setDaemonManager(daemonManager);
                                }
                                
                                console.log('BackgroundOperationManager initialized after workspace setup');
                                registerBackgroundStatusCommand(context);
                            } catch (error) {
                                console.error('Failed to initialize BackgroundOperationManager:', error);
                            }

                            // Initialize FlowbabyContextProvider if not already done
                            if (!getContextProvider()) {
                                const { FlowbabyContextProvider } = await import('../flowbabyContextProvider');
                                const provider = new FlowbabyContextProvider(newClient, agentOutputChannel, setupService, sessionManager);
                                setContextProvider(provider);
                                console.log('FlowbabyContextProvider initialized after workspace setup');

                                registerIngestForAgentCommand(context, newClient, agentOutputChannel, setupService);
                                registerRetrieveForAgentCommand(context, provider, agentOutputChannel);

                                const toolResult = await registerLanguageModelTools({
                                    context,
                                    outputChannel: agentOutputChannel,
                                    contextProvider: provider
                                });
                                setToolDisposables(toolResult.storeToolDisposable, toolResult.retrieveToolDisposable);
                            }

                            outputChannel.appendLine('[Init] ✅ Flowbaby client initialized successfully');
                        } else {
                            throw new Error(initResult.error || 'Client initialization failed');
                        }
                    });

                    // Plan 087: Use readiness service for post-init prompt gating
                    const readinessService = getReadinessService();
                    const needsLogin = readinessService?.needsLogin() ?? !getClient()?.getApiKeyState()?.llmReady;

                    if (needsLogin) {
                        debugLog('Plan 087: Post-init prompt (setup command) - login required');
                        const prompt = vscode.window.showWarningMessage(
                            'Flowbaby initialized successfully! Login to Flowbaby Cloud to enable memory operations.',
                            { modal: true },
                            'Login to Cloud',
                            'Later'
                        );

                        if (prompt && typeof (prompt as Thenable<string | undefined>).then === 'function') {
                            prompt.then(action => {
                                if (action === 'Login to Cloud') {
                                    // Plan 085: Use canonical command ID
                                    vscode.commands.executeCommand('flowbaby.cloud.login');
                                }
                            }, error => {
                                debugLog('Init Cloud login prompt suppressed', {
                                    error: error instanceof Error ? error.message : String(error)
                                });
                            });
                        }
                    } else {
                        await showWalkthroughPrompt(context);
                    }
                } catch (error) {
                    setInitState(workspacePath, { initialized: false, initFailed: true });
                    statusBar.setStatus(FlowbabyStatus.Error);

                    const errorMessage = error instanceof Error ? error.message : String(error);
                    outputChannel.appendLine('[Init] ❌ Flowbaby client initialization failed');
                    outputChannel.appendLine(JSON.stringify({
                        error_code: 'INIT_FAILED',
                        message: errorMessage,
                        remediation: 'Check Output > Flowbaby for details. Try "Flowbaby: Refresh Bridge Dependencies" or reload the window.',
                        timestamp: new Date().toISOString()
                    }, null, 2));
                    outputChannel.show();

                    vscode.window.showErrorMessage(
                        'Flowbaby initialization failed. Check Output for details.',
                        'Open Output',
                        'Refresh Dependencies'
                    ).then(action => {
                        if (action === 'Open Output') {
                            outputChannel.show();
                        } else if (action === 'Refresh Dependencies') {
                            vscode.commands.executeCommand('Flowbaby.refreshDependencies');
                        }
                    });
                }
            }
        }
    );
    context.subscriptions.push(initializeWorkspaceCommand);

    // Refresh Dependencies command
    const refreshDependenciesCommand = vscode.commands.registerCommand(
        'Flowbaby.refreshDependencies',
        async () => {
            await setupService.refreshDependencies();
        }
    );
    context.subscriptions.push(refreshDependenciesCommand);

    // Plan 108 Milestone 4: Diagnose Environment command
    const diagnoseEnvironmentCommand = vscode.commands.registerCommand(
        'Flowbaby.diagnoseEnvironment',
        async () => {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Diagnosing Flowbaby Environment...",
                cancellable: false
            }, async () => {
                try {
                    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.';
                    const bridgePath = require('path').join(__dirname, '..', 'bridge');
                    
                    // Create services for diagnostics
                    const config = vscode.workspace.getConfiguration('Flowbaby');
                    const interpreterService = new InterpreterSelectionService(
                        workspacePath,
                        undefined,
                        {
                            get: <T>(key: string, defaultValue: T): T => 
                                config.get<T>(key, defaultValue) ?? defaultValue
                        }
                    );
                    const preflightService = new PreflightVerificationService(
                        workspacePath,
                        bridgePath,
                        interpreterService
                    );
                    const diagnoseService = new DiagnoseEnvironmentService(
                        workspacePath,
                        bridgePath,
                        interpreterService,
                        preflightService
                    );
                    
                    const report = await diagnoseService.generateReport();
                    
                    // Show report in editor
                    const doc = await vscode.workspace.openTextDocument({
                        content: report.markdown,
                        language: 'markdown'
                    });
                    await vscode.window.showTextDocument(doc);
                    
                    // Also log to output channel
                    const outputChannel = getFlowbabyOutputChannel();
                    outputChannel.appendLine('--- Environment Diagnostics Report ---');
                    outputChannel.appendLine(report.markdown);
                    
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Failed to diagnose environment: ${errorMsg}`);
                    debugLog('Diagnose environment failed', { error: errorMsg });
                }
            });
        }
    );
    context.subscriptions.push(diagnoseEnvironmentCommand);
}

/**
 * Show walkthrough prompt after successful initialization
 */
async function showWalkthroughPrompt(context: vscode.ExtensionContext): Promise<void> {
    const hasGlobalState = !!context.globalState;
    const canReadGlobalState = hasGlobalState && typeof context.globalState.get === 'function';
    const canWriteGlobalState = hasGlobalState && typeof context.globalState.update === 'function';

    const walkthroughPromptDismissed = canReadGlobalState
        ? context.globalState.get<boolean>('flowbaby.walkthroughPromptDismissed', false)
        : false;

    if (!walkthroughPromptDismissed) {
        const info = vscode.window.showInformationMessage(
            'Flowbaby is ready! View the Getting Started guide?',
            'View Guide',
            'Don\'t Show Again'
        );

        if (info && typeof (info as Thenable<string | undefined>).then === 'function') {
            info.then(action => {
                if (action === 'View Guide') {
                    vscode.commands.executeCommand('workbench.action.openWalkthrough', 'Flowbaby.flowbabySetup');
                } else if (action === 'Don\'t Show Again' && canWriteGlobalState) {
                    context.globalState.update('flowbaby.walkthroughPromptDismissed', true);
                }
            }, error => {
                debugLog('Walkthrough prompt suppressed', {
                    error: error instanceof Error ? error.message : String(error)
                });
            });
        }
    } else {
        const info = vscode.window.showInformationMessage('Flowbaby is ready!');
        if (info && typeof (info as Thenable<string | undefined>).then === 'function') {
            info.then(undefined, error => {
                debugLog('Ready notification suppressed', {
                    error: error instanceof Error ? error.message : String(error)
                });
            });
        }
    }
}

// ============================================================================
// Debug Commands
// ============================================================================

/**
 * Register debug-related commands
 */
export function registerDebugCommands(context: vscode.ExtensionContext): void {
    const showDebugLogsCommand = vscode.commands.registerCommand(
        'Flowbaby.showDebugLogs',
        () => {
            const { getFlowbabyDebugChannel } = require('../outputChannels');
            const debugChannel = getFlowbabyDebugChannel();
            if (debugChannel) {
                debugChannel.show();
            } else {
                vscode.window.showInformationMessage(
                    'Debug logging is disabled. Enable it in settings: Flowbaby.debugLogging',
                    'Enable Debug Logging'
                ).then(selection => {
                    if (selection === 'Enable Debug Logging') {
                        vscode.workspace.getConfiguration('Flowbaby')
                            .update('debugLogging', true, vscode.ConfigurationTarget.Workspace);
                    }
                });
            }
        }
    );
    context.subscriptions.push(showDebugLogsCommand);
}
