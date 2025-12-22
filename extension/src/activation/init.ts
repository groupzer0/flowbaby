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
import { getAuditLogger } from '../audit/AuditLogger';
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

    // Set status bar based on API key state
    if (initResult.apiKeyState.llmReady) {
        statusBar.setStatus(FlowbabyStatus.Ready);
    } else {
        statusBar.setStatus(FlowbabyStatus.NeedsApiKey);
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

    // Show helpful guidance
    const outputChannel = getFlowbabyOutputChannel();
    outputChannel.appendLine('Failed to initialize Flowbaby. Common issues:');
    outputChannel.appendLine('');
    outputChannel.appendLine('1. Missing LLM API Key:');
    outputChannel.appendLine('   - Use "Flowbaby: Set API Key" command for secure storage');
    outputChannel.appendLine('   - Or set LLM_API_KEY environment variable for CI/automated environments');
    outputChannel.appendLine('');
    outputChannel.appendLine('2. Missing Python dependencies:');
    outputChannel.appendLine('   - Use "Flowbaby: Initialize Workspace" to set up the environment');
    outputChannel.appendLine('   - Or use "Flowbaby: Refresh Bridge Dependencies" to repair');
    outputChannel.show();

    recordActivationCompletion({
        healthStatus,
        requirementsStatus,
        initResult: { success: false, error: initResult.error }
    });

    // Non-blocking warning message
    vscode.window.showWarningMessage(
        'Flowbaby initialization failed. Check Output > Flowbaby for setup instructions.',
        'Open Output',
        'Set API Key',
        'Dismiss'
    ).then(action => {
        if (action === 'Open Output') {
            outputChannel.show();
        } else if (action === 'Set API Key') {
            vscode.commands.executeCommand('Flowbaby.setApiKey');
        }
    });

    return { success: false, error: initResult.error };
}

// ============================================================================
// Post-Init UI
// ============================================================================

/**
 * Show post-initialization prompts (API key or walkthrough)
 */
async function showPostInitPrompts(
    context: vscode.ExtensionContext,
    initResult: InitializeResult
): Promise<void> {
    if (!initResult.apiKeyState.llmReady) {
        // Modal prompt for API key
        const prompt = vscode.window.showWarningMessage(
            'Flowbaby initialized successfully! Configure your API key to enable memory operations.',
            { modal: true },
            'Set API Key',
            'Later'
        );

        if (prompt && typeof (prompt as Thenable<string | undefined>).then === 'function') {
            prompt.then(action => {
                if (action === 'Set API Key') {
                    vscode.commands.executeCommand('Flowbaby.setApiKey');
                }
            }, error => {
                debugLog('Init API key prompt suppressed', {
                    error: error instanceof Error ? error.message : String(error)
                });
            });
        }
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
    }
}

// ============================================================================
// API Key Commands
// ============================================================================

/**
 * Register API key management commands
 */
export function registerApiKeyCommands(
    context: vscode.ExtensionContext,
    workspacePath: string,
    statusBar: FlowbabyStatusBar
): void {
    // Set API Key command
    const setApiKeyCommand = vscode.commands.registerCommand(
        'Flowbaby.setApiKey',
        async () => {
            const apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your LLM API Key (e.g., OpenAI, Anthropic)',
                placeHolder: 'sk-...',
                password: true,
                ignoreFocusOut: true,
                validateInput: (value) => {
                    if (!value || value.trim().length < 10) {
                        return 'API key appears too short. Please enter a valid key.';
                    }
                    return null;
                }
            });

            if (apiKey) {
                try {
                    await context.secrets.store('flowbaby.llmApiKey', apiKey.trim());
                    vscode.window.showInformationMessage(
                        'API key stored securely. It will be used for all workspaces.'
                    );
                    debugLog('API key stored via SecretStorage');
                    getAuditLogger().logApiKeySet(true, 'command');

                    // Update status bar if workspace is initialized
                    const activeWorkspace = getActiveWorkspacePath() || workspacePath;
                    if (statusBar && activeWorkspace && getInitState(activeWorkspace).initialized) {
                        statusBar.setStatus(FlowbabyStatus.Ready);
                        debugLog('Status bar updated to Ready after API key configuration');
                    }
                } catch (error) {
                    getAuditLogger().logApiKeySet(false, 'command');
                    throw error;
                }
            }
        }
    );
    context.subscriptions.push(setApiKeyCommand);

    // Configure API Key command (alias)
    const configureApiKeyCommand = vscode.commands.registerCommand(
        'Flowbaby.configureApiKey',
        async () => {
            await vscode.commands.executeCommand('Flowbaby.setApiKey');
        }
    );
    context.subscriptions.push(configureApiKeyCommand);

    // Clear API Key command
    const clearApiKeyCommand = vscode.commands.registerCommand(
        'Flowbaby.clearApiKey',
        async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Clear the stored API key? You will need to set the key again.',
                { modal: true },
                'Clear Key'
            );

            if (confirm === 'Clear Key') {
                try {
                    await context.secrets.delete('flowbaby.llmApiKey');
                    vscode.window.showInformationMessage('API key cleared.');
                    debugLog('API key cleared from SecretStorage');
                    getAuditLogger().logApiKeyClear(true);
                } catch (error) {
                    getAuditLogger().logApiKeyClear(false);
                    throw error;
                }
            }
        }
    );
    context.subscriptions.push(clearApiKeyCommand);
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

                            if (initResult.apiKeyState.llmReady) {
                                statusBar.setStatus(FlowbabyStatus.Ready);
                            } else {
                                statusBar.setStatus(FlowbabyStatus.NeedsApiKey);
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

                    // Post-init prompts
                    const currentClientAfterInit = getClient();
                    if (!currentClientAfterInit?.getApiKeyState()?.llmReady) {
                        const prompt = vscode.window.showWarningMessage(
                            'Flowbaby initialized successfully! Configure your API key to enable memory operations.',
                            { modal: true },
                            'Set API Key',
                            'Later'
                        );

                        if (prompt && typeof (prompt as Thenable<string | undefined>).then === 'function') {
                            prompt.then(action => {
                                if (action === 'Set API Key') {
                                    vscode.commands.executeCommand('Flowbaby.setApiKey');
                                }
                            }, error => {
                                debugLog('Init API key prompt suppressed', {
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
