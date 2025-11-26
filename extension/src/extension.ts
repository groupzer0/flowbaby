import * as vscode from 'vscode';
import * as path from 'path';
import { FlowbabyClient, RetrievalResult } from './flowbabyClient';
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

// Module-level variable to store client instance
let flowbabyClient: FlowbabyClient | undefined;
let flowbabyContextProvider: FlowbabyContextProvider | undefined; // Plan 016 Milestone 1
let storeMemoryToolDisposable: vscode.Disposable | undefined;
let retrieveMemoryToolDisposable: vscode.Disposable | undefined; // Plan 016 Milestone 5

// Module-level storage for pending summary confirmations (Plan 014 Milestone 2)
interface PendingSummary {
    summary: ConversationSummary;
    timestamp: number;
}
const pendingSummaries = new Map<string, PendingSummary>();

/**
 * Extension activation entry point
 * Called when VS Code activates the extension (onStartupFinished)
 */
export async function activate(_context: vscode.ExtensionContext) {
    const activationStart = Date.now();
    console.log('Flowbaby extension activated');
    
    // Plan 028 M2: Debug logging for activation lifecycle
    debugLog('Extension activation started', { timestamp: new Date().toISOString() });
    
    // Get workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage(
            'Flowbaby requires an open workspace folder'
        );
        return;
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;

    // Initialize Flowbaby client
    try {
        flowbabyClient = new FlowbabyClient(workspacePath, _context);
        
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
                    await _context.secrets.store('flowbaby.llmApiKey', apiKey.trim());
                    vscode.window.showInformationMessage(
                        'API key stored securely. It will be used for all workspaces without a .env file.'
                    );
                    debugLog('API key stored via SecretStorage');
                }
            }
        );
        _context.subscriptions.push(setApiKeyCommand);
        
        // Plan 028 M5: Register Clear API Key command
        const clearApiKeyCommand = vscode.commands.registerCommand(
            'Flowbaby.clearApiKey',
            async () => {
                const confirm = await vscode.window.showWarningMessage(
                    'Clear the stored API key? You will need to create a .env file or set the key again.',
                    { modal: true },
                    'Clear Key'
                );
                
                if (confirm === 'Clear Key') {
                    await _context.secrets.delete('flowbaby.llmApiKey');
                    vscode.window.showInformationMessage('API key cleared.');
                    debugLog('API key cleared from SecretStorage');
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

        // Register refresh dependencies command
        const refreshDependenciesCommand = vscode.commands.registerCommand(
            'Flowbaby.refreshDependencies',
            async () => {
                await setupService.refreshDependencies();
            }
        );
        _context.subscriptions.push(refreshDependenciesCommand);

        const initialized = await flowbabyClient.initialize();

        if (initialized) {
            const initDuration = Date.now() - activationStart;
            console.log('Flowbaby client initialized successfully');
            debugLog('Client initialization successful', { duration_ms: initDuration });
            statusBar.setStatus(FlowbabyStatus.Ready);
            
            // Register commands for Milestone 1: Context Menu Capture
            registerCaptureCommands(_context, flowbabyClient);
            
            // Plan 015: Register agent ingestion command
            registerIngestForAgentCommand(_context, flowbabyClient, agentOutputChannel);

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
            
            // Plan 016 Milestone 1: Initialize FlowbabyContextProvider
            const { FlowbabyContextProvider } = await import('./flowbabyContextProvider');
            flowbabyContextProvider = new FlowbabyContextProvider(flowbabyClient, agentOutputChannel);
            
            // Milestone 2: Register @flowbaby chat participant (Plan 016 Milestone 6: now uses provider)
            registerFlowbabyParticipant(_context, flowbabyClient, flowbabyContextProvider);
            console.log('FlowbabyContextProvider initialized successfully');
            
            // Plan 016 Milestone 2: Register agent retrieval command
            registerRetrieveForAgentCommand(_context, flowbabyContextProvider, agentOutputChannel);
            
            // Plan 016.1: Register languageModelTools unconditionally (Configure Tools is sole opt-in)
            registerLanguageModelTool(_context, agentOutputChannel);
        } else {
            const initDuration = Date.now() - activationStart;
            console.warn('Flowbaby client initialization failed (see Output Channel)');
            debugLog('Client initialization failed', { duration_ms: initDuration });
            statusBar.setStatus(FlowbabyStatus.SetupRequired);
            
            // Check if it's an API key issue and provide helpful guidance
            // Use singleton output channel (Plan 028 M1)
            const outputChannel = getFlowbabyOutputChannel();
            outputChannel.appendLine('Failed to initialize Flowbaby. Common issues:');
            outputChannel.appendLine('');
            outputChannel.appendLine('1. Missing LLM API Key:');
            outputChannel.appendLine('   - Create a .env file in your workspace root');
            outputChannel.appendLine('   - Add: LLM_API_KEY=your_key_here');
            outputChannel.appendLine('   - Or use "Flowbaby: Set API Key" command for global setup');
            outputChannel.appendLine('');
            outputChannel.appendLine('2. Missing Python dependencies:');
            outputChannel.appendLine('   - Ensure flowbaby dependencies are installed');
            outputChannel.appendLine('   - Run: pip install flowbaby python-dotenv');
            outputChannel.show();
            
            const action = await vscode.window.showWarningMessage(
                'Flowbaby initialization failed. Check Output > Flowbaby for setup instructions.',
                'Open Output',
                'Set API Key',
                'Dismiss'
            );
            
            if (action === 'Open Output') {
                outputChannel.show();
            } else if (action === 'Set API Key') {
                vscode.commands.executeCommand('Flowbaby.setApiKey');
            }
        }
    } catch (error) {
        console.error('Failed to create Flowbaby client:', error);
        vscode.window.showErrorMessage(
            `Flowbaby initialization error: ${error}`
        );
    }
}

/**
 * Register languageModelTools for Copilot agent integration (Plan 016.1 Milestone 1)
 * Tools register unconditionally at activation; VS Code's Configure Tools UI is the sole opt-in control
 * Both tools (storeMemory and retrieveMemory) register atomically
 */
function registerLanguageModelTool(_context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    // Register BOTH tools unconditionally (Configure Tools controls enablement)
    if (flowbabyContextProvider) {
        const storeTool = new StoreMemoryTool(outputChannel);
        storeMemoryToolDisposable = vscode.lm.registerTool('flowbaby_storeMemory', storeTool);
        
        const retrieveTool = new RetrieveMemoryTool(flowbabyContextProvider, outputChannel);
        retrieveMemoryToolDisposable = vscode.lm.registerTool('flowbaby_retrieveMemory', retrieveTool);
        
        outputChannel.appendLine('=== Plan 016.1: Language Model Tools Registered ===');
        outputChannel.appendLine('✅ flowbaby_storeMemory registered - Copilot agents can store memories');
        outputChannel.appendLine('✅ flowbaby_retrieveMemory registered - Copilot agents can retrieve memories');
        outputChannel.appendLine('ℹ️  Enable/disable tools via Configure Tools UI in GitHub Copilot Chat');
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
    // VALIDATION 1: Test capture command with keyboard shortcut
    // NOTE: Context menu API (chat/message/context) does not exist - using fallback approach
    const captureCommand = vscode.commands.registerCommand(
        'Flowbaby.captureMessage',
        async () => {
            console.log('=== VALIDATION 1: Capture Command Test (Fallback Approach) ===');
            console.log('Command triggered via keyboard shortcut or command palette');
            
            // Fallback: Show input box to capture user text or use clipboard
            try {
                const options: vscode.InputBoxOptions = {
                    prompt: 'Enter text to capture to Flowbaby (or leave empty to capture from clipboard)',
                    placeHolder: 'Example: Discussed Redis caching with 15-minute TTL',
                    ignoreFocusOut: true
                };
                
                const userInput = await vscode.window.showInputBox(options);
                
                // If user cancels, check clipboard as fallback
                let content: string;
                if (!userInput) {
                    content = await vscode.env.clipboard.readText();
                    if (!content || content.trim().length === 0) {
                        vscode.window.showWarningMessage('No content to capture. Please enter text or copy content to clipboard.');
                        return;
                    }
                    console.log('Using clipboard content:', content.substring(0, 100) + (content.length > 100 ? '...' : ''));
                } else {
                    content = userInput;
                    console.log('Using user input:', content.substring(0, 100) + (content.length > 100 ? '...' : ''));
                }
                
                // VALIDATION SUCCESS: If we got here with content
                if (content && content.trim().length > 0) {
                    vscode.window.showInformationMessage(
                        `✅ VALIDATION PASS: Capture command works! Got ${content.length} chars`
                    );
                    
                    // Test ingestion with async mode per Plan 017
                    console.log('Testing async ingestion...');
                    
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
                            // Show staged messaging per Plan 017
                            vscode.window.showInformationMessage(
                                "Memory staged – processing will finish in ~1–2 minutes. You'll get a notification when it's done."
                            );
                        } else {
                            vscode.window.showWarningMessage(
                                `⚠️ Capture failed: ${result.error || 'Unknown error'}`
                            );
                        }
                    } catch (error) {
                        vscode.window.showWarningMessage(
                            `⚠️ Ingestion error: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                } else {
                    vscode.window.showWarningMessage(
                        '⚠️ No content provided - cancelling capture'
                    );
                }
                
            } catch (error) {
                console.error('Capture error:', error);
                vscode.window.showErrorMessage(
                    `❌ VALIDATION ERROR: ${error instanceof Error ? error.message : String(error)}`
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
    
    context.subscriptions.push(captureCommand, toggleCommand, clearCommand);
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
    _client: FlowbabyClient
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
        parsedSummary.sessionId = null; // Could extract from workspace session if available
        parsedSummary.planId = extractPlanIdFromConversation(conversationText);
        parsedSummary.status = 'Active';
        parsedSummary.createdAt = new Date();
        parsedSummary.updatedAt = new Date();
        
        // Store pending summary for confirmation in next message
        const summaryKey = `summary-${Date.now()}`;
        pendingSummaries.set(summaryKey, {
            summary: parsedSummary,
            timestamp: Date.now()
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
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    
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
 */
function registerFlowbabyParticipant(
    context: vscode.ExtensionContext,
    client: FlowbabyClient,
    provider: FlowbabyContextProvider
) {
    console.log('=== MILESTONE 2: Registering @flowbaby Chat Participant ===');

    // Register chat participant with ID matching package.json
    const participant = vscode.chat.createChatParticipant(
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
                // Check if memory is enabled
                const config = vscode.workspace.getConfiguration('Flowbaby');
                const memoryEnabled = config.get<boolean>('enabled', true);

                if (!memoryEnabled) {
                    stream.markdown('⚠️ **Flowbaby is disabled**\n\nEnable it in settings: `Flowbaby.enabled`');
                    return { metadata: { disabled: true } };
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
                                const success = await client.ingestSummary(pending.summary);
                                
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

                if (isSummaryRequest) {
                    // PLAN 014 MILESTONE 2: Summary Generation Flow
                    return await handleSummaryGeneration(request, _chatContext, stream, token, client);
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
                    const contextResponse = await provider.retrieveContext({
                        query: request.prompt,
                        maxResults: config.get<number>('maxContextResults', 3),
                        maxTokens: config.get<number>('maxContextTokens', 2000)
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

                // STEP 6: Capture conversation for feedback loop (async fire-and-forget)
                // This is CRITICAL - enables self-improving memory
                // NOTE: Cognee 0.4.0 has an intermittent file hashing bug that may cause ingestion failures
                // We silently handle these failures to avoid disrupting user experience
                if (memoryEnabled && fullResponse.length > 0) {
                    console.log('=== STEP 6: Capturing conversation for feedback loop ===');
                    
                    const userMessage = `User query: ${request.prompt}`;
                    const assistantMessage = `Retrieved context: ${retrievedMemories.length} memories\n\nGenerated response:\n${fullResponse}`;

                    // Step 6: Conversation Capture (Feedback Loop)
                    // DISABLED BY DEFAULT due to Cognee 0.4.0 file storage bug
                    // Enable via Flowbaby.autoIngestConversations setting for experimental testing
                    const autoIngest = config.get<boolean>('autoIngestConversations', false);
                    
                    if (autoIngest) {
                        // Fire-and-forget ingestion (don't block return)
                        client.ingest(userMessage, assistantMessage)
                            .then((success) => {
                                if (success) {
                                    console.log('✅ Conversation captured for feedback loop');
                                } else {
                                    // Known issue: Cognee 0.4.0 file hashing inconsistency
                                    // This is non-blocking - retrieval still works with manually captured conversations
                                    console.warn('⚠️ Step 6 ingestion failed (known Cognee bug, non-blocking)');
                                }
                            })
                            .catch((error) => {
                                // Known issue: Cognee 0.4.0 file storage bug
                                // Log for debugging but don't surface to user (retrieval still works)
                                const errorMsg = error instanceof Error ? error.message : String(error);
                                if (errorMsg.includes('File not found')) {
                                    console.warn('⚠️ Step 6 failed due to Cognee file storage bug (non-blocking)');
                                } else {
                                    console.error('Step 6 ingestion error (non-blocking):', error);
                                }
                            });
                    } else {
                        console.log('ℹ️ Step 6 automatic ingestion disabled (enable via Flowbaby.autoIngestConversations)');
                    }
                }

                // Success - return metadata for telemetry
                return {
                    metadata: {
                        memoriesRetrieved: retrievedMemories.length,
                        responseLength: fullResponse.length,
                        feedbackLoopEnabled: memoryEnabled
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
        }
    );

    // Set participant description (shows in UI)
    participant.iconPath = vscode.Uri.file(path.join(__dirname, '..', 'media', 'icon.png'));

    console.log('✅ @flowbaby participant registered successfully');

    // Add to subscriptions for proper cleanup
    context.subscriptions.push(participant);
}
