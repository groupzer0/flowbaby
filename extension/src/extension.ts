import * as vscode from 'vscode';
import * as path from 'path';
import { FlowbabyClient, RetrievalResult, InitializeResult } from './flowbabyClient';
import { ConversationSummary } from './summaryTemplate';
import { parseSummaryFromText } from './summaryParser';
import { registerIngestForAgentCommand } from './commands/ingestForAgent';
import { registerRetrieveForAgentCommand } from './commands/retrieveForAgent';
import { StoreMemoryTool } from './tools/storeMemoryTool';
import { RetrieveMemoryTool } from './tools/retrieveMemoryTool';
import { FlowbabyContextProvider } from './flowbabyContextProvider';
import { FlowbabySetupService } from './setup/FlowbabySetupService';
import { FlowbabyStatusBar, FlowbabyStatus } from './statusBar/FlowbabyStatusBar';
import { getFlowbabyOutputChannel, getFlowbabyDebugChannel, disposeOutputChannels, debugLog } from './outputChannels';
import { getAuditLogger } from './audit/AuditLogger';
import { SessionManager } from './sessionManager';
import {
    areToolsRegistered,
    createHostToolSnapshot,
    disposeFallbackRegistrations,
    getActiveContextDiagnostics,
    isActive as isExtensionCurrentlyActive,
    isKnownDuplicateToolError,
    isKnownDuplicateParticipantError,
    markActiveContextDisposed,
    recordActivationCompletion,
    recordActivationMetadata,
    recordRegistrationGuardEvent,
    resetRegistrationGuards,
    safePush,
    setActiveContext,
    setExtensionActive,
    setParticipantRegistered,
    setToolsRegistered,
    isParticipantRegistered
} from './lifecycle/registrationHelper';

// Re-exported for focused tests (Plan 052) so they can exercise
// the host-aware participant guard without re-running full
// activation. VS Code still uses activate() as the entry point.
export { registerFlowbabyParticipant };

// Module-level variable to store client instance
let flowbabyClient: FlowbabyClient | undefined;
let flowbabyContextProvider: FlowbabyContextProvider | undefined; // Plan 016 Milestone 1
let sessionManager: SessionManager | undefined; // Plan 001: Session Manager
let storeMemoryToolDisposable: vscode.Disposable | undefined;
let retrieveMemoryToolDisposable: vscode.Disposable | undefined; // Plan 016 Milestone 5
// Plan 050: Track initialization per workspace to avoid cross-workspace contamination
interface WorkspaceInitState {
    initialized: boolean;
    initFailed: boolean;
}

const workspaceInitState = new Map<string, WorkspaceInitState>();

function getActiveWorkspacePath(): string | undefined {
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

function getInitState(workspacePath: string): WorkspaceInitState {
    if (!workspaceInitState.has(workspacePath)) {
        workspaceInitState.set(workspacePath, { initialized: false, initFailed: false });
    }
    return workspaceInitState.get(workspacePath)!;
}

function setInitState(workspacePath: string, updates: Partial<WorkspaceInitState>): WorkspaceInitState {
    const current = getInitState(workspacePath);
    const next = { ...current, ...updates };
    workspaceInitState.set(workspacePath, next);
    return next;
}

// Module-level storage for pending summary confirmations (Plan 014 Milestone 2)
interface PendingSummary {
    summary: ConversationSummary;
    timestamp: number;
    threadId?: string; // Plan 001: Track session context
}
const pendingSummaries = new Map<string, PendingSummary>();

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
    
    // Plan 028 M2: Debug logging for activation lifecycle
    debugLog('Extension activation started', { timestamp: new Date().toISOString() });
    
    // Plan 001: Initialize SessionManager
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

    // Plan 039 M6: Initialize AuditLogger early for security event tracking
    getAuditLogger().initialize(workspacePath);

    // Initialize Flowbaby client
    try {
        flowbabyClient = new FlowbabyClient(workspacePath, _context, sessionManager);
        
        // Plan 015: Create output channel early
        const agentOutputChannel = vscode.window.createOutputChannel('Flowbaby Agent Activity');
        
        // Plan 025 Milestone 6: Initialize Status Bar EARLY
        const statusBar = new FlowbabyStatusBar(_context);
        
        // Plan 028 M2: Register Show Debug Logs command
        const showDebugLogsCommand = vscode.commands.registerCommand(
            'Flowbaby.showDebugLogs',
            () => {
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
        _context.subscriptions.push(showDebugLogsCommand);
        
        // Plan 028 M5: Register Set API Key command
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
                        await _context.secrets.store('flowbaby.llmApiKey', apiKey.trim());
                        vscode.window.showInformationMessage(
                            'API key stored securely. It will be used for all workspaces.'
                        );
                        debugLog('API key stored via SecretStorage');
                        // Plan 039 M6: Audit log API key set
                        getAuditLogger().logApiKeySet(true, 'command');
                        
                        // Issue 5 (v0.5.7): After setting API key, update status bar to Ready
                        // if we have a working environment
                        const activeWorkspace = getActiveWorkspacePath() || workspacePath;
                        if (statusBar && activeWorkspace && getInitState(activeWorkspace).initialized) {
                            statusBar.setStatus(FlowbabyStatus.Ready);
                            debugLog('Status bar updated to Ready after API key configuration');
                        }
                    } catch (error) {
                        // Plan 039 M6: Audit log failure
                        getAuditLogger().logApiKeySet(false, 'command');
                        throw error;
                    }
                }
            }
        );
        _context.subscriptions.push(setApiKeyCommand);
        
        // Plan 045 Hotfix: Register Configure API Key command as alias
        // package.json defines Flowbaby.configureApiKey - make it work too
        const configureApiKeyCommand = vscode.commands.registerCommand(
            'Flowbaby.configureApiKey',
            async () => {
                // Delegate to setApiKey
                await vscode.commands.executeCommand('Flowbaby.setApiKey');
            }
        );
        _context.subscriptions.push(configureApiKeyCommand);
        
        // Plan 028 M5: Register Clear API Key command
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
                        await _context.secrets.delete('flowbaby.llmApiKey');
                        vscode.window.showInformationMessage('API key cleared.');
                        debugLog('API key cleared from SecretStorage');
                        // Plan 039 M6: Audit log API key clear
                        getAuditLogger().logApiKeyClear(true);
                    } catch (error) {
                        // Plan 039 M6: Audit log failure
                        getAuditLogger().logApiKeyClear(false);
                        throw error;
                    }
                }
            }
        );
        _context.subscriptions.push(clearApiKeyCommand);

        // Plan 021 Milestone 4: Initialize Setup Service EARLY
        const setupService = new FlowbabySetupService(_context, workspacePath, agentOutputChannel, undefined, undefined, statusBar);
        
        // Register setup environment command (Plan 021 Milestone 4)
        const setupEnvironmentCommand = vscode.commands.registerCommand(
            'Flowbaby.setupEnvironment',
            async () => {
                await setupService.createEnvironment();
            }
        );
        _context.subscriptions.push(setupEnvironmentCommand);

        // Plan 039 M2: Register initializeWorkspace command with consistent Flowbaby namespace
        // This is the canonical command for workspace initialization
        // setupEnvironment is retained as an alias for backward compatibility
        // Plan 040 M2: Chain flowbabyClient.initialize() after environment setup so user can
        // immediately use @flowbaby without reloading the window
        const initializeWorkspaceCommand = vscode.commands.registerCommand(
            'Flowbaby.initializeWorkspace',
            async () => {
                const outputChannel = getFlowbabyOutputChannel();
                outputChannel.appendLine('[Plan 040] Starting workspace initialization...');
                
                // Delegate to setupService.createEnvironment() for unified behavior
                const success = await setupService.createEnvironment();
                
                if (!success) {
                    outputChannel.appendLine('[Plan 040] ❌ Environment creation failed');
                    return;
                }
                
                outputChannel.appendLine('[Plan 040] ✅ Environment created successfully');
                
                // Plan 040 M2: If environment creation succeeded, chain client initialization
                if (success && flowbabyClient) {
                    outputChannel.appendLine('[Plan 040] Preparing to initialize Flowbaby client...');
                    
                    // CRITICAL FIX: Recreate FlowbabyClient to pick up the new .flowbaby/venv Python path
                    // The client was created at activation time with system Python (python3) before
                    // the venv existed. Now that createEnvironment() has successfully created the venv
                    // and installed dependencies, we must recreate the client so it detects and uses
                    // the new Python interpreter with cognee installed.
                    outputChannel.appendLine('[Plan 040] Recreating FlowbabyClient with new environment...');
                    debugLog('Recreating FlowbabyClient after environment setup');
                    flowbabyClient = new FlowbabyClient(workspacePath, _context);
                    
                    try {
                        // Show progress during initialization
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: "Initializing Flowbaby databases...",
                            cancellable: false
                        }, async () => {
                            const initResult = await flowbabyClient!.initialize();
                            
                            if (initResult.success) {
                                setInitState(workspacePath, { initialized: true, initFailed: false });
                                
                                // Plan 045: Set status bar based on API key state
                                if (initResult.apiKeyState.llmReady) {
                                    statusBar.setStatus(FlowbabyStatus.Ready);
                                } else {
                                    statusBar.setStatus(FlowbabyStatus.NeedsApiKey);
                                }

                                // FIX: Initialize BackgroundOperationManager for fresh workspaces (Plan 017)
                                // This is required because activate() returns early for FRESH/BROKEN workspaces,
                                // skipping the default initialization block.
                                try {
                                    const { BackgroundOperationManager } = await import('./background/BackgroundOperationManager');
                                    const manager = BackgroundOperationManager.initialize(_context, agentOutputChannel);
                                    await manager.initializeForWorkspace(workspacePath);
                                    console.log('BackgroundOperationManager initialized after workspace setup');
                                    
                                    // Register background status command if not already registered
                                    // (Safe to re-register as it overwrites the handler)
                                    registerBackgroundStatusCommand(_context);
                                } catch (error) {
                                    console.error('Failed to initialize BackgroundOperationManager:', error);
                                }
                                
                                // Initialize FlowbabyContextProvider if not already done
                                if (!flowbabyContextProvider) {
                                    const { FlowbabyContextProvider } = await import('./flowbabyContextProvider');
                                    flowbabyContextProvider = new FlowbabyContextProvider(flowbabyClient!, agentOutputChannel, setupService, sessionManager);
                                    console.log('FlowbabyContextProvider initialized after workspace setup');
                                    
                                    // Register agent commands
                                    registerIngestForAgentCommand(_context, flowbabyClient!, agentOutputChannel, setupService);
                                    registerRetrieveForAgentCommand(_context, flowbabyContextProvider, agentOutputChannel);
                                    
                                    // Register language model tools
                                    await registerLanguageModelTool(_context, agentOutputChannel);
                                }
                                
                                outputChannel.appendLine('[Plan 040] ✅ Flowbaby client initialized successfully');
                                
                                // Plan 045: Store init result for post-progress prompt
                                // Don't show prompt inside withProgress - it blocks the progress indicator
                            } else {
                                throw new Error(initResult.error || 'Client initialization failed');
                            }
                        });
                        
                        // Plan 045 Fix: Show post-init prompt AFTER withProgress completes
                        // This ensures progress notification dismisses immediately
                        // Issue 4 (v0.5.7): Use modal warning that stays until dismissed
                        if (!flowbabyClient!.getApiKeyState()?.llmReady) {
                            // Modal prompt ensures user sees it - won't auto-dismiss
                            vscode.window.showWarningMessage(
                                'Flowbaby initialized successfully! Configure your API key to enable memory operations.',
                                { modal: true },
                                'Set API Key',
                                'Later'
                            ).then(action => {
                                if (action === 'Set API Key') {
                                    vscode.commands.executeCommand('Flowbaby.setApiKey');
                                }
                            });
                        } else {
                            vscode.window.showInformationMessage('Flowbaby is ready!');
                        }
                    } catch (error) {
                        // Plan 040 M2: Handle initialization failures gracefully
                        setInitState(workspacePath, { initialized: false, initFailed: true });
                        statusBar.setStatus(FlowbabyStatus.Error);
                        
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        
                        // Structured error logging per system-architecture.md §10.2
                        outputChannel.appendLine('[Plan 040] ❌ Flowbaby client initialization failed');
                        outputChannel.appendLine(JSON.stringify({
                            error_code: 'INIT_FAILED',
                            message: errorMessage,
                            remediation: 'Check Output > Flowbaby for details. Try "Flowbaby: Refresh Bridge Dependencies" or reload the window.',
                            timestamp: new Date().toISOString()
                        }, null, 2));
                        outputChannel.show();
                        
                        // User-facing notification per Plan 040 acceptance criteria
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
        _context.subscriptions.push(initializeWorkspaceCommand);

        // Register refresh dependencies command
        const refreshDependenciesCommand = vscode.commands.registerCommand(
            'Flowbaby.refreshDependencies',
            async () => {
                await setupService.refreshDependencies();
            }
        );
        _context.subscriptions.push(refreshDependenciesCommand);

        // Plan 032 M1: Register @flowbaby chat participant EARLY (before initialization)
        // This ensures the participant shows in the chat UI immediately, with graceful
        // degradation when the backend is still initializing
        registerFlowbabyParticipant(_context);
        console.log('@flowbaby chat participant registered (pending initialization)');

        // Plan 039 M3: Proactive Health Check before client initialization
        // This provides targeted UX guidance based on actual workspace state
        const healthStatus = await setupService.checkWorkspaceHealth();
        debugLog('Workspace health check result', { healthStatus });
        
        if (healthStatus === 'FRESH') {
            // No .flowbaby directory or missing bridge-env.json - user needs to initialize
            // Plan 040 M3: Unified messaging for fresh workspaces
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
            
            // Skip client initialization attempt - environment not ready
            recordActivationCompletion({
                healthStatus,
                initResult: { success: false, error: 'workspace_fresh' }
            });
            setExtensionActive(false);
            return;
        }
        
        if (healthStatus === 'BROKEN') {
            // .flowbaby exists with bridge-env.json but environment is corrupt - user needs to repair
            // Plan 040 M3: Distinguished messaging for broken workspaces (not just "needs setup")
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
            
            // Skip client initialization attempt - environment broken
            recordActivationCompletion({
                healthStatus,
                initResult: { success: false, error: 'workspace_broken' }
            });
            setExtensionActive(false);
            return;
        }
        
        // healthStatus === 'VALID' - proceed with client initialization

        // Plan 050: Early dependency hash check to surface mismatches before initialization
        const requirementsStatus = await setupService.checkRequirementsUpToDate();
        if (requirementsStatus === 'mismatch') {
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
            setExtensionActive(false);
            return;
        }
        recordActivationMetadata({ healthStatus, requirementsStatus });

        // Add timeout to initialization to prevent extension activation hang (Issue 1)
        // Plan 040 M4: Increase timeout from 15s to 60s to handle first-run database creation
        // (creating SQLite, Kuzu, and LanceDB databases can exceed 15s on slower machines)
        const initPromise = flowbabyClient.initialize();
        
        // Plan 045: Timeout now returns a failed InitializeResult instead of false
        const timeoutPromise = new Promise<InitializeResult>((resolve) => {
            setTimeout(() => {
                console.warn('Flowbaby initialization timed out after 60s');
                resolve({
                    success: false,
                    apiKeyState: {
                        pythonConfigured: false,
                        typescriptConfigured: false,
                        llmReady: false,
                        statusMessage: 'Initialization timed out'
                    },
                    error: 'Initialization timed out after 60s'
                });
            }, 60000);
        });

        const initResult = await Promise.race([initPromise, timeoutPromise]);

        if (initResult.success) {
            const initDuration = Date.now() - activationStart;
            console.log('Flowbaby client initialized successfully');
            debugLog('Client initialization successful', { duration_ms: initDuration });
            
            // Plan 045: Set status bar based on API key state
            if (initResult.apiKeyState.llmReady) {
                statusBar.setStatus(FlowbabyStatus.Ready);
            } else {
                statusBar.setStatus(FlowbabyStatus.NeedsApiKey);
            }
            
            // Plan 032 M1: Mark client as initialized for graceful degradation
            setInitState(workspacePath, { initialized: true, initFailed: false });
            
            // Register commands for Milestone 1: Context Menu Capture
            registerCaptureCommands(_context, flowbabyClient);
            
            // Plan 015: Register agent ingestion command
            registerIngestForAgentCommand(_context, flowbabyClient, agentOutputChannel, setupService);

            // Plan 017: Initialize BackgroundOperationManager AFTER output channel creation
            try {
                const { BackgroundOperationManager } = await import('./background/BackgroundOperationManager');
                const manager = BackgroundOperationManager.initialize(_context, agentOutputChannel);
                await manager.initializeForWorkspace(workspacePath);
                console.log('BackgroundOperationManager initialized successfully');
            } catch (error) {
                console.error('Failed to initialize BackgroundOperationManager:', error);
                // Continue activation - sync mode will still work
            }
            
            // Plan 017: Register backgroundStatus command
            registerBackgroundStatusCommand(_context);

            // Plan 021 Milestone 3: Register validation and listing commands
            registerValidationCommands(_context, flowbabyClient);
            
            // Plan 016 Milestone 1: Initialize FlowbabyContextProvider (now that client is ready)
            const { FlowbabyContextProvider } = await import('./flowbabyContextProvider');
            flowbabyContextProvider = new FlowbabyContextProvider(flowbabyClient, agentOutputChannel, setupService, sessionManager);
            console.log('FlowbabyContextProvider initialized successfully');
            
            // Plan 016 Milestone 2: Register agent retrieval command
            registerRetrieveForAgentCommand(_context, flowbabyContextProvider, agentOutputChannel);
            
            // Plan 016.1: Register languageModelTools unconditionally (Configure Tools is sole opt-in)
            await registerLanguageModelTool(_context, agentOutputChannel);
            recordActivationCompletion({
                healthStatus,
                requirementsStatus,
                initResult: { success: true },
                toolsRegistered: areToolsRegistered(),
                participantRegistered: isParticipantRegistered()
            });
            
            // Plan 045: Show post-init API key prompt if needed
            // Issue 4 (v0.5.7): Use modal warning that stays until dismissed
            if (!initResult.apiKeyState.llmReady) {
                // Modal prompt ensures user sees it - won't auto-dismiss
                vscode.window.showWarningMessage(
                    'Flowbaby initialized successfully! Configure your API key to enable memory operations.',
                    { modal: true },
                    'Set API Key',
                    'Later'
                ).then(action => {
                    if (action === 'Set API Key') {
                        vscode.commands.executeCommand('Flowbaby.setApiKey');
                    }
                });
            }
        } else {
            const initDuration = Date.now() - activationStart;
            console.warn('Flowbaby client initialization failed (see Output Channel)');
            debugLog('Client initialization failed', { duration_ms: initDuration });
            statusBar.setStatus(FlowbabyStatus.SetupRequired);
            
            setInitState(workspacePath, { initialized: false, initFailed: true });
            
            // Check if it's an API key issue and provide helpful guidance
            // Use singleton output channel (Plan 028 M1)
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
            setExtensionActive(false);
            
            // Plan 039 M1: Non-blocking warning message to prevent activation hang
            // Use .then() instead of await to allow activate() to return immediately
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
 * Register languageModelTools for Copilot agent integration (Plan 016.1 Milestone 1)
 * 
 * Plan 056 - Evidence-Only Guard Semantics:
 * - Guard state (areToolsRegistered) is set ONLY on concrete evidence:
 *   (a) All tools registered successfully, or
 *   (b) Host throws well-understood duplicate-registration errors for all tools
 * - vscode.lm.tools inventory is used for diagnostics only, never as guard input
 * - All-or-nothing: setToolsRegistered(true) only if EVERY required tool succeeds or duplicates
 * - Invariant 4.1.3: This function is invoked at most once per activation; no retries on failure
 */
async function registerLanguageModelTool(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    // Pre-condition: context provider must exist
    if (!flowbabyContextProvider) {
        recordRegistrationGuardEvent('tool', { reason: 'missing-context-provider' });
        return;
    }

    // Capture host inventory snapshot for diagnostics only (Invariant 4.3.1-4.3.3)
    let hostToolSnapshot: ReturnType<typeof createHostToolSnapshot> | { error: string };
    try {
        const tools = await vscode.lm.tools;
        hostToolSnapshot = createHostToolSnapshot(tools);
    } catch (error) {
        hostToolSnapshot = { error: error instanceof Error ? error.message : String(error) };
    }

    // Guard check: If already registered in this activation, skip (Invariant 4.1.3)
    if (areToolsRegistered()) {
        recordRegistrationGuardEvent('tool', {
            reason: 'guard-skip',
            hostToolSnapshot,
            note: 'Tools already registered in this activation'
        });
        return;
    }

    // Attempt registration of all required Flowbaby tools
    // Track individual outcomes for all-or-nothing semantics
    const toolResults: Array<{
        id: string;
        success: boolean;
        duplicate: boolean;
        error?: string;
        disposable?: vscode.Disposable;
    }> = [];

    // Tool 1: flowbaby_storeMemory
    try {
        const storeTool = new StoreMemoryTool(outputChannel);
        const disposable = vscode.lm.registerTool('flowbaby_storeMemory', storeTool);
        storeMemoryToolDisposable = disposable;
        toolResults.push({ id: 'flowbaby_storeMemory', success: true, duplicate: false, disposable });
    } catch (error) {
        if (isKnownDuplicateToolError(error)) {
            toolResults.push({
                id: 'flowbaby_storeMemory',
                success: true,
                duplicate: true,
                error: error instanceof Error ? error.message : String(error)
            });
        } else {
            toolResults.push({
                id: 'flowbaby_storeMemory',
                success: false,
                duplicate: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // Tool 2: flowbaby_retrieveMemory
    try {
        const retrieveTool = new RetrieveMemoryTool(flowbabyContextProvider, outputChannel);
        const disposable = vscode.lm.registerTool('flowbaby_retrieveMemory', retrieveTool);
        retrieveMemoryToolDisposable = disposable;
        toolResults.push({ id: 'flowbaby_retrieveMemory', success: true, duplicate: false, disposable });
    } catch (error) {
        if (isKnownDuplicateToolError(error)) {
            toolResults.push({
                id: 'flowbaby_retrieveMemory',
                success: true,
                duplicate: true,
                error: error instanceof Error ? error.message : String(error)
            });
        } else {
            toolResults.push({
                id: 'flowbaby_retrieveMemory',
                success: false,
                duplicate: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // Evaluate all-or-nothing outcome
    const allSucceeded = toolResults.every(r => r.success);
    const anyDuplicate = toolResults.some(r => r.duplicate);
    const failures = toolResults.filter(r => !r.success);

    if (allSucceeded) {
        // Set guard to true only on concrete evidence (Invariant 4.2.2)
        setToolsRegistered(true);

        // Register disposables via safePush for lifecycle management
        for (const result of toolResults) {
            if (result.disposable) {
                safePush(context, result.disposable, {
                    intent: { kind: 'tool', id: result.id },
                    hostTools: 'error' in hostToolSnapshot ? { error: hostToolSnapshot.error } : {
                        names: hostToolSnapshot.flowbabyTools.map(t => t.name),
                        hasFlowbabyTools: hostToolSnapshot.flowbabyTools.length > 0
                    }
                });
            }
        }

        const reason = anyDuplicate ? 'duplicate-accepted' : 'registered';
        recordRegistrationGuardEvent('tool', {
            reason,
            hostToolSnapshot,
            toolResults: toolResults.map(r => ({ id: r.id, success: r.success, duplicate: r.duplicate }))
        });

        outputChannel.appendLine('=== Plan 016.1: Language Model Tools Registered ===');
        if (anyDuplicate) {
            outputChannel.appendLine('ℹ️  Some tools were already registered in host (duplicate-accepted)');
        }
        outputChannel.appendLine('✅ flowbaby_storeMemory registered - Copilot agents can store memories');
        outputChannel.appendLine('✅ flowbaby_retrieveMemory registered - Copilot agents can retrieve memories');
        outputChannel.appendLine('ℹ️  Enable/disable tools via Configure Tools UI in GitHub Copilot Chat');
    } else {
        // Registration failed for at least one tool - do NOT set guard to true
        // Per Invariant 4.1.3: no retry within this activation
        recordRegistrationGuardEvent('tool', {
            reason: 'registration-failed',
            hostToolSnapshot,
            toolResults: toolResults.map(r => ({ id: r.id, success: r.success, duplicate: r.duplicate, error: r.error })),
            failures: failures.map(f => ({ id: f.id, error: f.error }))
        });

        // Clean up any disposables that were created before the failure
        for (const result of toolResults) {
            if (result.disposable) {
                try {
                    result.disposable.dispose();
                } catch {
                    // Ignore disposal errors
                }
            }
        }
        storeMemoryToolDisposable = undefined;
        retrieveMemoryToolDisposable = undefined;

        outputChannel.appendLine('=== Plan 016.1: Language Model Tools Registration FAILED ===');
        for (const failure of failures) {
            outputChannel.appendLine(`❌ ${failure.id}: ${failure.error}`);
        }
    }
}

/**
 * Register backgroundStatus command for Plan 017 Milestone 5
 */
function registerBackgroundStatusCommand(context: vscode.ExtensionContext) {
    const command = vscode.commands.registerCommand(
        'Flowbaby.backgroundStatus',
        async () => {
            try {
                const { BackgroundOperationManager } = await import('./background/BackgroundOperationManager');
                const manager = BackgroundOperationManager.getInstance();
                const result = manager.getStatus();
                
                // getStatus() returns OperationEntry[] when no operationId provided
                const operations = Array.isArray(result) ? result : [result];
                
                if (operations.length === 0) {
                    vscode.window.showInformationMessage('No background operations');
                    return;
                }
                
                // Status icons per operation status
                const statusIcons: Record<string, string> = {
                    'pending': '⏸️',
                    'running': '⏳',
                    'completed': '✅',
                    'failed': '❌',
                    'terminated': '⏹️',
                    'unknown': '❓'
                };
                
                // Create quick pick items
                interface QuickPickItemWithOperation extends vscode.QuickPickItem {
                    operation: import('./background/BackgroundOperationManager').OperationEntry;
                }
                
                const items: QuickPickItemWithOperation[] = operations.map(op => {
                    const icon = statusIcons[op.status] || '•';
                    const elapsed = op.elapsedMs ? `${(op.elapsedMs / 1000).toFixed(1)}s` : 'N/A';
                    const workspace = op.datasetPath.split('/').pop() || 'unknown';
                    const digest = op.summaryDigest || 'N/A';
                    
                    // Format start time (e.g., "14:32:21")
                    const startTime = new Date(op.startTime).toLocaleTimeString();
                    
                    return {
                        label: `${icon} ${op.status.toUpperCase()} - ${workspace}`,
                        description: `${startTime} - ${elapsed} - ${digest.substring(0, 40)}`,
                        detail: op.errorMessage || (op.entityCount ? `${op.entityCount} entities` : undefined),
                        operation: op
                    };
                });
                
                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select operation for details'
                });
                
                if (selected) {
                    const op = selected.operation;
                    const details = [
                        `Operation ID: ${op.operationId}`,
                        `Status: ${op.status}`,
                        `Workspace: ${op.datasetPath}`,
                        `Summary: ${op.summaryDigest || 'N/A'}`,
                        `Started: ${op.startTime}`,
                        op.elapsedMs ? `Elapsed: ${(op.elapsedMs / 1000).toFixed(1)}s` : null,
                        op.entityCount ? `Entities: ${op.entityCount}` : null,
                        op.errorCode ? `Error Code: ${op.errorCode}` : null,
                        op.errorMessage ? `Error: ${op.errorMessage}` : null
                    ].filter(Boolean).join('\n');
                    
                    vscode.window.showInformationMessage(details, { modal: true });
                }
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to get operation status: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );
    
    context.subscriptions.push(command);
    console.log('✅ Flowbaby.backgroundStatus command registered');
}

/**
 * Extension deactivation entry point
 * Called when VS Code deactivates the extension
 */
export async function deactivate() {
    console.log('Flowbaby extension deactivated');
    markActiveContextDisposed();
    setExtensionActive(false);
    
    // Plan 017: Shutdown BackgroundOperationManager (sends SIGTERM to running processes)
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
    
    // Plan 028 M1: Dispose singleton output channels
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

/**
 * Register capture commands for Milestone 1: Keyboard Shortcut Capture
 * VALIDATION: Testing command palette + keyboard shortcut approach (fallback after context menu API failure)
 */
function registerCaptureCommands(
    context: vscode.ExtensionContext,
    client: FlowbabyClient
) {
    // Capture command for keyboard shortcut (Ctrl+Alt+C / Cmd+Alt+C)
    // Plan 041: Refactored to prioritize editor selection, fix cancellation, and log content source
    const captureCommand = vscode.commands.registerCommand(
        'Flowbaby.captureMessage',
        async () => {
            console.log('=== Flowbaby Capture Command ===');
            
            try {
                // Step 1: Check for editor selection to pre-fill the input box
                let initialValue = '';
                const editor = vscode.window.activeTextEditor;
                if (editor && !editor.selection.isEmpty) {
                    initialValue = editor.document.getText(editor.selection);
                    console.log(`Pre-filling with editor selection (${initialValue.length} chars)`);
                }
                
                // Plan 055: Status bar cue to improve capture input visibility
                // This non-modal message draws attention to the input box at the top of the window
                const statusMessage = vscode.window.setStatusBarMessage(
                    '$(edit) Flowbaby capture: input box open at top — Enter to save, Esc to cancel',
                    5000 // Auto-dismiss after 5 seconds
                );
                
                // Plan 055: One-time onboarding toast for first-time users
                // Defensive check for globalState availability (may be undefined in test contexts)
                if (context?.globalState) {
                    const captureHintShown = context.globalState.get<boolean>('flowbaby.captureHintShown', false);
                    if (!captureHintShown) {
                        vscode.window.showInformationMessage(
                            'Flowbaby capture is waiting in the input box at the top. Type, then Enter to save, Esc to cancel.'
                        );
                        await context.globalState.update('flowbaby.captureHintShown', true);
                    }
                }
                
                // Step 2: Show input box with pre-filled selection (if any)
                const options: vscode.InputBoxOptions = {
                    value: initialValue,
                    prompt: 'Flowbaby capture: type in the top input box (Esc cancels)',
                    placeHolder: initialValue ? undefined : 'e.g., Captured API design notes for checkout flow',
                    ignoreFocusOut: true
                };
                
                const userInput = await vscode.window.showInputBox(options);
                
                // Dispose status bar message once input is closed
                statusMessage.dispose();
                
                // Step 3: Handle cancellation (Escape pressed) - userInput is undefined
                if (userInput === undefined) {
                    vscode.window.showInformationMessage('Capture cancelled');
                    console.log('Capture cancelled by user (Escape pressed)');
                    return;
                }
                
                // Step 4: Determine content and source
                let content: string;
                let contentSource: string;
                
                if (userInput.trim().length > 0) {
                    // User provided/edited text
                    content = userInput;
                    // Distinguish between unmodified selection and user-typed input
                    if (initialValue && userInput === initialValue) {
                        contentSource = 'Editor Selection';
                    } else if (initialValue) {
                        contentSource = 'User Input (edited selection)';
                    } else {
                        contentSource = 'User Input';
                    }
                } else {
                    // Empty string submitted - clipboard fallback (power user feature)
                    content = await vscode.env.clipboard.readText();
                    if (!content || content.trim().length === 0) {
                        // Empty-all-sources case: no selection, no input, no clipboard
                        vscode.window.showInformationMessage('Nothing to capture');
                        console.log('Nothing to capture: no selection, no input, and empty clipboard');
                        return;
                    }
                    contentSource = 'Clipboard';
                }
                
                // Step 5: Log content source to Output channel
                const outputChannel = vscode.window.createOutputChannel('Flowbaby');
                outputChannel.appendLine(`Capturing from ${contentSource} (${content.length} chars)`);
                console.log(`Capturing from ${contentSource} (${content.length} chars)`);
                
                // Step 6: Ingest the content
                try {
                    // For manual capture, treat as user note
                    const userMsg = 'Manual note: ' + content;
                    const assistantMsg = 'Captured via Ctrl+Alt+C (Cmd+Alt+C on Mac) shortcut';
                    
                    // Get BackgroundOperationManager instance
                    const { BackgroundOperationManager } = await import('./background/BackgroundOperationManager');
                    const manager = BackgroundOperationManager.getInstance();
                    
                    // Use async ingestion
                    const result = await client.ingestAsync(userMsg, assistantMsg, manager);
                    
                    if (result.success && result.staged) {
                        // Plan 043: Check if success notifications are enabled
                        const showSuccessNotifications = vscode.workspace.getConfiguration('flowbaby.notifications').get<boolean>('showIngestionSuccess', true);
                        if (showSuccessNotifications) {
                            // Show staged messaging per Plan 017
                            vscode.window.showInformationMessage(
                                "Memory staged – processing will finish in ~1–2 minutes. You'll get a notification when it's done."
                            );
                        }
                        outputChannel.appendLine('Memory staged successfully');
                    } else {
                        vscode.window.showWarningMessage(
                            `⚠️ Capture failed: ${result.error || 'Unknown error'}`
                        );
                        outputChannel.appendLine(`Capture failed: ${result.error || 'Unknown error'}`);
                    }
                } catch (error) {
                    vscode.window.showWarningMessage(
                        `⚠️ Ingestion error: ${error instanceof Error ? error.message : String(error)}`
                    );
                    outputChannel.appendLine(`Ingestion error: ${error instanceof Error ? error.message : String(error)}`);
                }
                
            } catch (error) {
                console.error('Capture error:', error);
                vscode.window.showErrorMessage(
                    `❌ Capture error: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );
    
    // Toggle memory command (Milestone 4)
    const toggleCommand = vscode.commands.registerCommand(
        'Flowbaby.toggleMemory',
        async () => {
            const config = vscode.workspace.getConfiguration('Flowbaby');
            const currentState = config.get<boolean>('enabled', true);
            await config.update('enabled', !currentState, vscode.ConfigurationTarget.Workspace);
            vscode.window.showInformationMessage(
                `Flowbaby ${!currentState ? 'enabled' : 'disabled'}`
            );
        }
    );
    
    // Clear memory command (Milestone 4)
    const clearCommand = vscode.commands.registerCommand(
        'Flowbaby.clearMemory',
        async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Delete all Flowbaby memories for this workspace?',
                { modal: true },
                'Delete'
            );
            
            if (confirm === 'Delete') {
                try {
                    await client.clearMemory();
                    vscode.window.showInformationMessage('✅ Workspace memory cleared');
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to clear memory: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        }
    );
    
    // Open Documentation command
    const openDocsCommand = vscode.commands.registerCommand(
        'Flowbaby.openDocs',
        async () => {
            vscode.env.openExternal(vscode.Uri.parse('https://docs.flowbaby.ai'));
        }
    );
    
    context.subscriptions.push(captureCommand, toggleCommand, clearCommand, openDocsCommand);
}

/**
 * Register validation and listing commands for Plan 021 Milestone 3
 */
function registerValidationCommands(context: vscode.ExtensionContext, client: FlowbabyClient) {
    // Validate Memories
    const validateCommand = vscode.commands.registerCommand('Flowbaby.validateMemories', async () => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Validating Flowbaby System...",
            cancellable: false
        }, async (_progress) => {
            try {
                const result = await client.validateMemories();
                
                const outputChannel = vscode.window.createOutputChannel('Flowbaby Validation');
                outputChannel.clear();
                outputChannel.appendLine('=== Flowbaby Validation ===');
                outputChannel.appendLine(`Status: ${result.status.toUpperCase()}`);
                outputChannel.appendLine('');
                
                const checks = result.checks || {};
                outputChannel.appendLine('Checks:');
                outputChannel.appendLine(`- Environment (.env): ${checks.env_file ? '✅ PASS' : '❌ FAIL'}`);
                outputChannel.appendLine(`- API Key: ${checks.api_key ? '✅ PASS' : '❌ FAIL'}`);
                outputChannel.appendLine(`- Ontology File: ${checks.ontology_file ? '✅ PASS' : '❌ FAIL'}`);
                outputChannel.appendLine(`- Graph Connection: ${checks.graph_connection ? '✅ PASS' : '❌ FAIL'}`);
                outputChannel.appendLine(`- Retrieval Smoke Test: ${checks.retrieval_smoke_test ? '✅ PASS' : '❌ FAIL'}`);
                outputChannel.appendLine(`- Memory Structure: ${checks.memory_structure}`);
                
                if (!result.success) {
                    outputChannel.appendLine('');
                    outputChannel.appendLine(`Error: ${result.error}`);
                    vscode.window.showErrorMessage(`Validation Failed: ${result.status}. See output for details.`);
                } else {
                    vscode.window.showInformationMessage(`Validation Passed: System is ${result.status}`);
                }
                
                outputChannel.show();
            } catch (error) {
                vscode.window.showErrorMessage(`Validation failed to run: ${error}`);
            }
        });
    });

    // List Memories
    const listCommand = vscode.commands.registerCommand('Flowbaby.listMemories', async () => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Fetching memories...",
            cancellable: false
        }, async () => {
            try {
                const result = await client.listMemories(20); // Limit 20
                
                if (!result.success) {
                    vscode.window.showErrorMessage(`Failed to list memories: ${result.error}`);
                    return;
                }
                
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const memories = result.memories || [];
                if (memories.length === 0) {
                    vscode.window.showInformationMessage("No memories found.");
                    return;
                }
                
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const items = memories.map((m: any) => ({
                    label: `$(book) ${m.topic}`,
                    description: `${m.date} - ${m.status}`,
                    detail: m.preview,
                    memory: m
                }));
                
                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: "Select a memory to view details"
                });
                
                if (selected) {
                    const m = selected.memory;
                    const outputChannel = vscode.window.createOutputChannel('Flowbaby Details');
                    outputChannel.clear();
                    outputChannel.appendLine(`Topic: ${m.topic}`);
                    outputChannel.appendLine(`Status: ${m.status}`);
                    outputChannel.appendLine(`Date: ${m.date}`);
                    outputChannel.appendLine('');
                    outputChannel.appendLine('--- Preview ---');
                    outputChannel.appendLine(m.preview); // In a real app we'd fetch full content
                    outputChannel.show();
                }
                
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to list memories: ${error}`);
            }
        });
    });

    // Show Diagnostics (Plan 021 Milestone 5)
    const diagnosticsCommand = vscode.commands.registerCommand('Flowbaby.showDiagnostics', async () => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Running Flowbaby Diagnostics...",
            cancellable: false
        }, async () => {
            try {
                const validation = await client.validateMemories();
                const config = await client.validateConfiguration();
                
                const docContent = [
                    '# Flowbaby Diagnostics Report',
                    `Date: ${new Date().toISOString()}`,
                    '',
                    '## System Status',
                    `Overall Status: ${validation.status.toUpperCase()}`,
                    `Configuration Valid: ${config.valid ? 'Yes' : 'No'}`,
                    '',
                    '## Environment Checks',
                    `- .env File: ${validation.checks?.env_file ? '✅ Found' : '❌ Missing'}`,
                    `- API Key: ${validation.checks?.api_key ? '✅ Configured' : '❌ Missing'}`,
                    `- Ontology: ${validation.checks?.ontology_file ? '✅ Found' : '❌ Missing'}`,
                    '',
                    '## Connection Checks',
                    `- Graph Database: ${validation.checks?.graph_connection ? '✅ Connected' : '❌ Failed'}`,
                    `- Retrieval Test: ${validation.checks?.retrieval_smoke_test ? '✅ Passed' : '❌ Failed'}`,
                    '',
                    '## Configuration Errors',
                    ...(config.errors.length > 0 ? config.errors.map(e => `- ${e}`) : ['None']),
                    '',
                    '## Raw Validation Output',
                    '```json',
                    JSON.stringify(validation, null, 2),
                    '```'
                ].join('\n');

                const doc = await vscode.workspace.openTextDocument({
                    content: docContent,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(doc);
                
            } catch (error) {
                vscode.window.showErrorMessage(`Diagnostics failed: ${error}`);
            }
        });
    });

    context.subscriptions.push(validateCommand, listCommand, diagnosticsCommand);
}

/**
 * Handle summary generation request (Plan 014 Milestone 2)
 * Implements turn count adjustment, LLM-based generation, and user confirmation flow
 */
async function handleSummaryGeneration(
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    _client: FlowbabyClient,
    threadId?: string // Plan 001: Pass session context
): Promise<vscode.ChatResult> {
    console.log('=== PLAN 014: Handling summary generation request ===');
    
    // Default turn count per plan
    const DEFAULT_TURN_COUNT = 15;
    let turnCount = DEFAULT_TURN_COUNT;
    
    // Extract requested turn count from prompt (e.g., "summarize last 30 turns")
    const turnCountMatch = request.prompt.match(/(?:last\s+)?(\d+)\s+turns?/i);
    if (turnCountMatch) {
        const requestedCount = parseInt(turnCountMatch[1]);
        if (requestedCount > 0 && requestedCount <= 100) {
            turnCount = requestedCount;
        }
    }
    
    // Extract chat history
    const history = chatContext.history || [];
    const availableTurns = history.filter(h => h instanceof vscode.ChatRequestTurn || h instanceof vscode.ChatResponseTurn);
    const actualTurnCount = Math.min(turnCount, availableTurns.length);
    
    if (availableTurns.length === 0) {
        stream.markdown('⚠️ **No conversation history available to summarize**\n\n');
        stream.markdown('Chat with me first, then ask me to summarize the conversation.');
        return { metadata: { error: 'no_history' } };
    }
    
    // Calculate time range (use current time as fallback since turn timestamps aren't directly accessible)
    const oldestTime = new Date(Date.now() - (actualTurnCount * 60000)); // Estimate 1 min per turn
    const timeAgo = getTimeAgoString(oldestTime);
    
    // Show scope preview with adjustment option
    stream.markdown(`📝 **Summary Scope**\n\n`);
    stream.markdown(`I'll summarize the last **${actualTurnCount} turns** (from ${timeAgo}).\n\n`);
    
    if (availableTurns.length > actualTurnCount) {
        stream.markdown(`💡 *Tip: You can adjust this by saying "summarize last 30 turns" or any number up to ${availableTurns.length}.*\n\n`);
    }
    
    stream.markdown('Generating summary...\n\n');
    stream.markdown('---\n\n');
    
    // Build conversation context for LLM
    const recentTurns = availableTurns.slice(-actualTurnCount);
    const conversationText = recentTurns.map((turn, index) => {
        if (turn instanceof vscode.ChatRequestTurn) {
            return `[Turn ${index + 1} - User]: ${turn.prompt}`;
        } else if (turn instanceof vscode.ChatResponseTurn) {
            // Extract text from response (may be markdown or plain text)
            const responseText = turn.response.map(part => {
                if (part instanceof vscode.ChatResponseMarkdownPart) {
                    return part.value.value;
                } else {
                    return String(part);
                }
            }).join('');
            return `[Turn ${index + 1} - Assistant]: ${responseText.substring(0, 500)}${responseText.length > 500 ? '...' : ''}`;
        }
        return '';
    }).filter(Boolean).join('\n\n');
    
    // Generate summary using LLM with Plan 014 schema
    const summaryPrompt = `You are a helpful assistant that creates structured summaries of conversations.

Analyze the following conversation and create a structured summary following this exact format:

# Conversation Summary: [Short Title]

## Context
[1-3 sentences summarizing what was being worked on and why]

## Key Decisions
[List key decisions or conclusions, one per line with "- " prefix, or write "(none)" if no decisions were made]

## Rationale
[Explain why key decisions were made, one per line with "- " prefix, or write "(none)" if no rationale provided]

## Open Questions
[List unresolved questions or risks, one per line with "- " prefix, or write "(none)" if no open questions]

## Next Steps
[List concrete next actions, one per line with "- " prefix, or write "(none)" if no next steps]

## References
[List relevant files, plan IDs, or links, one per line with "- " prefix, or write "(none)" if no references]

## Time Scope
[Human-readable time range, e.g., "Nov 18 10:00-11:30" or "Recent session"]

---

**Conversation to summarize (${actualTurnCount} turns):**

${conversationText}

---

Create the summary now, following the format exactly. Use markdown formatting.`;
    
    try {
        const messages = [vscode.LanguageModelChatMessage.User(summaryPrompt)];
        const chatResponse = await request.model.sendRequest(messages, {}, token);
        
        let generatedSummary = '';
        for await (const fragment of chatResponse.text) {
            if (token.isCancellationRequested) {
                return { metadata: { cancelled: true } };
            }
            stream.markdown(fragment);
            generatedSummary += fragment;
        }
        
        stream.markdown('\n\n---\n\n');
        
        // Try to parse the generated summary
        const parsedSummary = parseSummaryFromText(generatedSummary);
        
        if (!parsedSummary) {
            stream.markdown('⚠️ **Failed to parse generated summary**\n\n');
            stream.markdown('The summary was generated but could not be parsed into the structured format. ');
            stream.markdown('You can still read it above, but it won\'t be stored in memory.\n\n');
            return { metadata: { error: 'parse_failed' } };
        }
        
        // Enrich metadata fields for storage
        parsedSummary.sessionId = threadId || null; // Plan 001: Use threadId as sessionId
        parsedSummary.planId = extractPlanIdFromConversation(conversationText);
        parsedSummary.status = 'Active';
        parsedSummary.createdAt = new Date();
        parsedSummary.updatedAt = new Date();
        
        // Store pending summary for confirmation in next message
        const summaryKey = `summary-${Date.now()}`;
        pendingSummaries.set(summaryKey, {
            summary: parsedSummary,
            timestamp: Date.now(),
            threadId // Plan 001
        });
        
        // Clean up old pending summaries (>5 minutes)
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        for (const [key, pending] of pendingSummaries.entries()) {
            if (pending.timestamp < fiveMinutesAgo) {
                pendingSummaries.delete(key);
            }
        }
        
        // Ask user for confirmation
        stream.markdown('✅ **Summary generated successfully!**\n\n');
        stream.markdown('Should I store this summary in Flowbaby memory? Reply with:\n');
        stream.markdown('- `yes` or `store it` to save\n');
        stream.markdown('- `no` or `cancel` to discard\n\n');
        stream.markdown('💡 *Stored summaries can be retrieved later when you ask related questions.*');
        
        return {
            metadata: {
                summaryGenerated: true,
                turnCount: actualTurnCount,
                topic: parsedSummary.topic,
                requiresConfirmation: true,
                pendingSummaryKey: summaryKey
            }
        };
        
    } catch (error) {
        console.error('Summary generation failed:', error);
        stream.markdown(`\n\n❌ **Summary generation failed:** ${error instanceof Error ? error.message : String(error)}\n\n`);
        return { metadata: { error: error instanceof Error ? error.message : String(error) } };
    }
}

/**
 * Get human-readable time ago string
 */
function getTimeAgoString(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) {return 'just now';}
    if (diffMins < 60) {return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;}
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;}
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
}

/**
 * Extract plan ID from conversation text (e.g., "Plan 014", "plan-015")
 */
function extractPlanIdFromConversation(text: string): string | null {
    const planMatch = text.match(/[Pp]lan[- ]?(\d{3})/);
    return planMatch ? planMatch[1] : null;
}

/**
 * Register @flowbaby chat participant for Milestone 2
 * Implements 6-step flow: retrieval → format display → augment prompt → generate response → capture conversation
 * Plan 016 Milestone 6: Refactored to use FlowbabyContextProvider instead of direct client.retrieve
 * Plan 032 M1: Refactored to use module-level state and graceful degradation during initialization
 */
function registerFlowbabyParticipant(
    context: vscode.ExtensionContext
) {
    console.log('=== MILESTONE 2: Registering @flowbaby Chat Participant ===');

    if (isParticipantRegistered()) {
        recordRegistrationGuardEvent('participant', { reason: 'already-registered' });
        return;
    }

    // Host-aware participant guard (Plan 052 Milestone 3): we do not have a
    // public chat participant inventory, so we rely on registration outcomes
    // and host errors as signals while still emitting a structured snapshot.
    const hostParticipantSnapshot: { hasFlowbabyParticipant?: boolean; error?: string } = {
        hasFlowbabyParticipant: false
    };

    // Register chat participant with ID matching package.json
    let participant: vscode.ChatParticipant | undefined;
    try {
        participant = vscode.chat.createChatParticipant(
            'flowbaby',
            async (
                request: vscode.ChatRequest,
                _chatContext: vscode.ChatContext,
                stream: vscode.ChatResponseStream,
                token: vscode.CancellationToken
            ): Promise<vscode.ChatResult> => {
            console.log('=== @flowbaby participant invoked ===');
            console.log('User query:', request.prompt);

            try {
                // Plan 032 M1: Graceful degradation if client not yet initialized
                const activeWorkspace = getActiveWorkspacePath();
                const initState = activeWorkspace ? getInitState(activeWorkspace) : { initialized: false, initFailed: false };

                if (!initState.initialized || !flowbabyClient || !flowbabyContextProvider) {
                    if (initState.initFailed) {
                        stream.markdown('❌ **Flowbaby initialization failed**\n\n');
                        stream.markdown('Please check the Output channel for details and try reloading the window.\n\n');
                        return { metadata: { error: 'initialization_failed' } };
                    }

                    stream.markdown('⏳ **Flowbaby is still initializing...**\n\n');
                    stream.markdown('The memory system is starting up. Please wait a moment and try again.\n\n');
                    stream.markdown('💡 *This usually takes just a few seconds on first use.*');
                    return { metadata: { initializing: true } };
                }
                
                // Check if memory is enabled
                const config = vscode.workspace.getConfiguration('Flowbaby');
                const memoryEnabled = config.get<boolean>('enabled', true);

                if (!memoryEnabled) {
                    stream.markdown('⚠️ **Flowbaby is disabled**\n\nEnable it in settings: `Flowbaby.enabled`');
                    return { metadata: { disabled: true } };
                }

                // Issue 3 (v0.5.7): Check API key status before proceeding
                // If no API key configured, show helpful error instead of hanging on "working..."
                const hasApiKey = await flowbabyClient.hasApiKey();
                if (!hasApiKey) {
                    stream.markdown('🔑 **LLM API Key Required**\n\n');
                    stream.markdown('Flowbaby needs an LLM API key (OpenAI by default) to process memory operations.\n\n');
                    stream.markdown('**Quick Fix:**\n');
                    stream.markdown('1. Run command: `Flowbaby: Set API Key`\n');
                    stream.markdown('2. Enter your OpenAI API key (or Anthropic, Azure, Ollama if configured)\n\n');
                    stream.markdown('[Set API Key Now](command:Flowbaby.setApiKey)');
                    return { metadata: { error: 'api_key_required' } };
                }

                // PLAN 014 MILESTONE 5: Show help text for empty queries or explicit help requests
                const trimmedPrompt = request.prompt.trim().toLowerCase();
                const isHelpRequest = trimmedPrompt === '' || 
                                     trimmedPrompt === 'help' || 
                                     trimmedPrompt === '?' ||
                                     trimmedPrompt.includes('how to use') ||
                                     trimmedPrompt.includes('what can you do');

                if (isHelpRequest) {
                    stream.markdown('# 📚 Flowbaby Help\n\n');
                    stream.markdown('## Query for Context\n\n');
                    stream.markdown('Ask a question to retrieve relevant memories from your workspace:\n\n');
                    stream.markdown('- `@flowbaby How did I implement caching?`\n');
                    stream.markdown('- `@flowbaby What did we decide about Plan 013?`\n');
                    stream.markdown('- `@flowbaby What are the next steps for authentication?`\n\n');
                    stream.markdown('## Create Summaries\n\n');
                    stream.markdown('Capture structured summaries of your conversations:\n\n');
                    stream.markdown('- `@flowbaby summarize this conversation` - Create a summary of recent chat history\n');
                    stream.markdown('- `@flowbaby remember this session` - Same as above\n\n');
                    stream.markdown('Summaries include: Topic, Context, Decisions, Rationale, Open Questions, Next Steps, References\n\n');
                    stream.markdown('## Tips\n\n');
                    stream.markdown('- **Summaries are optional** - Create them after important discussions or decisions\n');
                    stream.markdown('- **Adjust scope** - When creating summaries, you can adjust the number of turns to include\n');
                    stream.markdown('- **Review before storing** - Summaries require explicit confirmation before saving\n\n');
                    stream.markdown('📖 For more details, see the [extension README](command:markdown.showPreview?%5B%22extension%2FREADME.md%22%5D)\n');
                    
                    return { metadata: { help: true } };
                }

                // PLAN 014: Check for pending summary confirmation first
                const promptLower = request.prompt.toLowerCase().trim();
                const isConfirmation = ['yes', 'y', 'store it', 'save', 'save it', 'confirm'].includes(promptLower);
                const isDeclination = ['no', 'n', 'cancel', 'discard', 'don\'t save', 'dont save'].includes(promptLower);
                
                if ((isConfirmation || isDeclination) && pendingSummaries.size > 0) {
                    // Get most recent pending summary
                    const entries = Array.from(pendingSummaries.entries());
                    const mostRecent = entries.sort((a, b) => b[1].timestamp - a[1].timestamp)[0];
                    
                    if (mostRecent) {
                        const [key, pending] = mostRecent;
                        
                        if (isConfirmation) {
                            stream.markdown('📝 **Storing summary...**\n\n');
                            
                            try {
                                const success = await flowbabyClient.ingestSummary(pending.summary, pending.threadId);
                                
                                if (success) {
                                    stream.markdown(`✅ **Summary stored successfully!**\n\n`);
                                    stream.markdown(`Topic: **${pending.summary.topic}**\n\n`);
                                    stream.markdown('You can retrieve this summary later by asking questions related to this topic.');
                                    pendingSummaries.delete(key);
                                    
                                    return {
                                        metadata: {
                                            summaryStored: true,
                                            topic: pending.summary.topic
                                        }
                                    };
                                } else {
                                    stream.markdown('⚠️ **Failed to store summary**\n\n');
                                    stream.markdown('There was an error storing the summary. Check the Output channel (Flowbaby) for details.\n\n');
                                    stream.markdown('You can try again by saying "yes" or "store it".');
                                    
                                    return {
                                        metadata: {
                                            error: 'storage_failed'
                                        }
                                    };
                                }
                            } catch (error) {
                                stream.markdown('❌ **Error storing summary**\n\n');
                                stream.markdown(`${error instanceof Error ? error.message : String(error)}\n\n`);
                                stream.markdown('You can try again by saying "yes" or "store it".');
                                
                                return {
                                    metadata: {
                                        error: error instanceof Error ? error.message : String(error)
                                    }
                                };
                            }
                        } else {
                            // User declined
                            stream.markdown('ℹ️ **Summary discarded**\n\n');
                            stream.markdown('The summary was not stored. You can generate a new summary anytime by asking me to "summarize this conversation".');
                            pendingSummaries.delete(key);
                            
                            return {
                                metadata: {
                                    summaryDiscarded: true
                                }
                            };
                        }
                    }
                }
                
                // PLAN 014: Detect summary generation requests
                const summaryTriggers = [
                    'summarize this conversation',
                    'summarize the conversation',
                    'remember this session',
                    'create summary',
                    'create a summary',
                    'summarize our discussion'
                ];
                
                const isSummaryRequest = summaryTriggers.some(trigger => 
                    request.prompt.toLowerCase().includes(trigger)
                );

                // Plan 001: Extract thread ID (session context)
                // Use request.sessionId if available (future API), or fallback to workspace-scoped session
                const threadId = (() => {
                    const possibleSessionId = (request as { sessionId?: unknown }).sessionId;
                    if (typeof possibleSessionId === 'string' && possibleSessionId.trim()) {
                        return possibleSessionId;
                    }
                    return 'workspace-session';
                })();

                if (isSummaryRequest) {
                    // PLAN 014 MILESTONE 2: Summary Generation Flow
                    return await handleSummaryGeneration(request, _chatContext, stream, token, flowbabyClient, threadId);
                }

                // Check cancellation before expensive operations
                if (token.isCancellationRequested) {
                    return { metadata: { cancelled: true } };
                }

                // STEP 1-2: Retrieve relevant context from Flowbaby using FlowbabyContextProvider (Plan 016 Milestone 6)
                const retrievalStart = Date.now();
                let retrievedMemories: RetrievalResult[] = [];
                let retrievalFailed = false;

                try {
                    // Use shared FlowbabyContextProvider for concurrency/rate limiting
                    const contextResponse = await flowbabyContextProvider.retrieveContext({
                        query: request.prompt,
                        maxResults: config.get<number>('maxContextResults', 3),
                        maxTokens: config.get<number>('maxContextTokens', 2000),
                        threadId // Plan 001: Pass threadId
                    });
                    
                    // Check if response is an error
                    if ('error' in contextResponse) {
                        throw new Error(contextResponse.message);
                    }
                    
                    // Convert FlowbabyContextEntry[] to RetrievalResult[] format for backward compatibility
                    retrievedMemories = contextResponse.entries.map(entry => ({
                        text: entry.summaryText,
                        summaryText: entry.summaryText,
                        topic: entry.topic,
                        topicId: entry.topicId || undefined,
                        planId: entry.planId || undefined,
                        sessionId: entry.sessionId || undefined,
                        status: entry.status || undefined,
                        createdAt: entry.createdAt ? new Date(entry.createdAt) : undefined,
                        sourceCreatedAt: entry.sourceCreatedAt
                            ? new Date(entry.sourceCreatedAt)
                            : (entry.createdAt ? new Date(entry.createdAt) : undefined),
                        updatedAt: entry.updatedAt ? new Date(entry.updatedAt) : undefined,
                        score: entry.score,
                        decisions: entry.decisions,
                        rationale: entry.rationale,
                        openQuestions: entry.openQuestions,
                        nextSteps: entry.nextSteps,
                        references: entry.references,
                        tokens: entry.tokens ?? Math.ceil(entry.summaryText.length / 4)
                    } as RetrievalResult));
                    
                    const retrievalDuration = Date.now() - retrievalStart;
                    console.log(`Retrieved ${retrievedMemories.length} memories in ${retrievalDuration}ms (via FlowbabyContextProvider)`);
                } catch (error) {
                    retrievalFailed = true;
                    console.error('Retrieval failed:', error);
                    stream.markdown('⚠️ **Memory retrieval unavailable** - continuing without context\n\n');
                }

                // Check cancellation after retrieval
                if (token.isCancellationRequested) {
                    return { metadata: { cancelled: true } };
                }

                // STEP 3: Format and display retrieved context with structured metadata per §4.4.1
                let augmentedPrompt = request.prompt;
                if (!retrievalFailed && retrievedMemories.length > 0) {
                    stream.markdown(`📚 **Retrieved ${retrievedMemories.length} ${retrievedMemories.length === 1 ? 'memory' : 'memories'}**\n\n`);
                    
                    // Show preview of retrieved memories with metadata badges when available (up to 2000 chars for transparency)
                    retrievedMemories.forEach((result, index) => {
                        const memory = result.summaryText || result.text || '';
                        const maxPreviewLength = 2000;
                        const preview = memory.length > maxPreviewLength
                            ? memory.substring(0, maxPreviewLength) + `... (showing ${maxPreviewLength} of ${memory.length} chars)` 
                            : memory;
                        const lengthIndicator = memory.length > 100 ? ` (${memory.length} chars)` : '';
                        
                        // Display structured metadata if available (enriched summaries per §4.4.1)
                        if (result.topicId) {
                            stream.markdown(`**Memory ${index + 1}${lengthIndicator}:**\n`);
                            
                            // Metadata badges
                            const badges: string[] = [];
                            if (result.status) {
                                badges.push(`📋 Status: ${result.status}`);
                            }
                            if (result.createdAt) {
                                const timeAgo = getTimeAgoString(result.createdAt);
                                badges.push(`📅 Created: ${timeAgo}`);
                            }
                            if (result.sourceCreatedAt) {
                                const sourceAgo = getTimeAgoString(result.sourceCreatedAt);
                                badges.push(`🕰️ Source: ${sourceAgo}`);
                            }
                            if (result.updatedAt) {
                                const updatedAgo = getTimeAgoString(result.updatedAt);
                                badges.push(`♻️ Updated: ${updatedAgo}`);
                            }
                            if (result.planId) {
                                badges.push(`🏷️ Plan: ${result.planId}`);
                            }
                            if (badges.length > 0) {
                                stream.markdown(`*${badges.join(' | ')}*\n\n`);
                            }
                            
                            // Display structured content sections
                            if (result.topic) {
                                stream.markdown(`**Topic:** ${result.topic}\n\n`);
                            }
                            if (result.decisions && result.decisions.length > 0) {
                                stream.markdown(`**Key Decisions:**\n${result.decisions.map(d => `- ${d}`).join('\n')}\n\n`);
                            }
                            if (result.openQuestions && result.openQuestions.length > 0) {
                                stream.markdown(`**Open Questions:**\n${result.openQuestions.map(q => `- ${q}`).join('\n')}\n\n`);
                            }
                            if (result.nextSteps && result.nextSteps.length > 0) {
                                stream.markdown(`**Next Steps:**\n${result.nextSteps.map(s => `- ${s}`).join('\n')}\n\n`);
                            }
                            
                            stream.markdown(`> ${preview}\n\n`);
                        } else {
                            // Legacy raw-text memory (no metadata per §4.4.1)
                            stream.markdown(`**Memory ${index + 1}${lengthIndicator}:**\n> ${preview}\n\n`);
                        }
                    });

                    stream.markdown('---\n\n');

                    // STEP 4: Augment prompt with retrieved context
                    const contextSection = retrievedMemories
                        .map((result, i) => `### Memory ${i + 1}\n${result.summaryText || result.text || ''}`)
                        .join('\n\n');

                    augmentedPrompt = `## Relevant Past Conversations\n\n${contextSection}\n\n## Current Question\n\n${request.prompt}`;
                    
                    console.log('Augmented prompt length:', augmentedPrompt.length);
                } else if (!retrievalFailed) {
                    stream.markdown('ℹ️ *No relevant memories found for this query*\n\n---\n\n');
                }

                // Check cancellation before generating response
                if (token.isCancellationRequested) {
                    return { metadata: { cancelled: true } };
                }

                // STEP 5: Generate response using language model with augmented prompt
                let fullResponse = '';
                
                try {
                    const messages = [
                        vscode.LanguageModelChatMessage.User(augmentedPrompt)
                    ];

                    // Use the model from the request (user's selected model)
                    const chatResponse = await request.model.sendRequest(messages, {}, token);

                    // Stream response incrementally (better UX)
                    for await (const fragment of chatResponse.text) {
                        if (token.isCancellationRequested) {
                            return { metadata: { cancelled: true } };
                        }
                        stream.markdown(fragment);
                        fullResponse += fragment;
                    }

                    console.log('Generated response length:', fullResponse.length);

                } catch (error) {
                    console.error('Response generation failed:', error);
                    
                    // Check for LanguageModelError for better error messages
                    if (error instanceof vscode.LanguageModelError) {
                        stream.markdown(`\n\n⚠️ **Language Model Error:** ${error.message} (Code: ${error.code})`);
                    } else {
                        stream.markdown('\n\n⚠️ **Failed to generate response** - Please try again');
                    }
                    
                    return { 
                        metadata: { 
                            error: error instanceof Error ? error.message : String(error)
                        } 
                    };
                }

                // Success - return metadata for telemetry
                return {
                    metadata: {
                        memoriesRetrieved: retrievedMemories.length,
                        responseLength: fullResponse.length
                    }
                };

            } catch (error) {
                console.error('Chat participant error:', error);
                stream.markdown(`\n\n❌ **Error:** ${error instanceof Error ? error.message : String(error)}`);
                return { 
                    metadata: { 
                        error: error instanceof Error ? error.message : String(error)
                    } 
                };
            }
        });
    } catch (error) {
        // Plan 056: Use centralized duplicate-error classifier (Invariant 4.2.6)
        // Tool and participant guards are independent (Invariant 4.5.1)
        if (isKnownDuplicateParticipantError(error)) {
            recordRegistrationGuardEvent('participant', {
                reason: 'duplicate-accepted',
                error: error instanceof Error ? error.message : String(error),
                hostParticipantSnapshot
            });
            setParticipantRegistered(true);
            return;
        }

        // Unknown error - do NOT set guard to true, allow future activation to retry
        recordRegistrationGuardEvent('participant', {
            reason: 'registration-failed',
            error: error instanceof Error ? error.message : String(error),
            hostParticipantSnapshot
        });
        return;
    }

    // Registration succeeded - set guard on concrete evidence (Invariant 4.2.2)
    setParticipantRegistered(true);

    // Set participant description (shows in UI)
    // Issue 2 (v0.5.7): Fixed icon path - icon.png doesn't exist, use flowbaby-icon-tightcrop.png
    participant.iconPath = vscode.Uri.file(path.join(__dirname, '..', 'media', 'flowbaby-icon-tightcrop.png'));

    console.log('✅ @flowbaby participant registered successfully');

    // Add to subscriptions for proper cleanup
    safePush(context, participant, {
        intent: { kind: 'participant', id: 'flowbaby' }
    });
    recordRegistrationGuardEvent('participant', {
        reason: 'registered',
        hostParticipantSnapshot
    });
}
