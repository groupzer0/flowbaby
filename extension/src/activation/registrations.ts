/**
 * Command, LM Tool, and Chat Participant Registration
 * 
 * All registration functions receive dependencies as parameters (no god objects).
 * Maintains singleton ownership and guard invariants for registration lifecycle.
 * 
 * @module activation/registrations
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { FlowbabyClient, RetrievalResult } from '../flowbabyClient';
import { ConversationSummary } from '../summaryTemplate';
import { parseSummaryFromText } from '../summaryParser';
import { StoreMemoryTool } from '../tools/storeMemoryTool';
import { RetrieveMemoryTool } from '../tools/retrieveMemoryTool';
import { FlowbabyContextProvider } from '../flowbabyContextProvider';
import { MEMORY_CONTEXT_INSTRUCTIONS } from '../shared/promptFragments';
import {
    areToolsRegistered,
    createHostToolSnapshot,
    isKnownDuplicateToolError,
    isKnownDuplicateParticipantError,
    isParticipantRegistered,
    recordRegistrationGuardEvent,
    safePush,
    setParticipantRegistered,
    setToolsRegistered
} from '../lifecycle/registrationHelper';

// ============================================================================
// Types
// ============================================================================

/**
 * Dependencies for LM tool registration
 */
export interface LMToolRegistrationDeps {
    context: vscode.ExtensionContext;
    outputChannel: vscode.OutputChannel;
    contextProvider: FlowbabyContextProvider;
}

/**
 * Result of LM tool registration
 */
export interface LMToolRegistrationResult {
    storeToolDisposable?: vscode.Disposable;
    retrieveToolDisposable?: vscode.Disposable;
}

/**
 * Dependencies for chat participant registration
 */
export interface ParticipantRegistrationDeps {
    context: vscode.ExtensionContext;
    getClient: () => FlowbabyClient | undefined;
    getContextProvider: () => FlowbabyContextProvider | undefined;
    getInitState: (workspacePath: string) => { initialized: boolean; initFailed: boolean };
    getActiveWorkspacePath: () => string | undefined;
}

/**
 * Pending summary for confirmation flow
 */
interface PendingSummary {
    summary: ConversationSummary;
    timestamp: number;
    threadId?: string;
}

// Module-level storage for pending summary confirmations
const pendingSummaries = new Map<string, PendingSummary>();

// ============================================================================
// LM Tool Registration
// ============================================================================

/**
 * Register languageModelTools for Copilot agent integration
 * 
 * Evidence-Only Guard Semantics:
 * - Guard state (areToolsRegistered) is set ONLY on concrete evidence
 * - All-or-nothing: setToolsRegistered(true) only if EVERY required tool succeeds or duplicates
 * - This function is invoked at most once per activation; no retries on failure
 */
export async function registerLanguageModelTools(
    deps: LMToolRegistrationDeps
): Promise<LMToolRegistrationResult> {
    const { context, outputChannel, contextProvider } = deps;
    const result: LMToolRegistrationResult = {};

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
        return result;
    }

    // Attempt registration of all required Flowbaby tools
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
        result.storeToolDisposable = disposable;
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
        const retrieveTool = new RetrieveMemoryTool(contextProvider, outputChannel);
        const disposable = vscode.lm.registerTool('flowbaby_retrieveMemory', retrieveTool);
        result.retrieveToolDisposable = disposable;
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
        setToolsRegistered(true);

        for (const toolResult of toolResults) {
            if (toolResult.disposable) {
                safePush(context, toolResult.disposable, {
                    intent: { kind: 'tool', id: toolResult.id },
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

        outputChannel.appendLine('=== Language Model Tools Registered ===');
        if (anyDuplicate) {
            outputChannel.appendLine('ℹ️  Some tools were already registered in host (duplicate-accepted)');
        }
        outputChannel.appendLine('✅ flowbaby_storeMemory registered - Copilot agents can store memories');
        outputChannel.appendLine('✅ flowbaby_retrieveMemory registered - Copilot agents can retrieve memories');
        outputChannel.appendLine('ℹ️  Enable/disable tools via Configure Tools UI in GitHub Copilot Chat');
    } else {
        recordRegistrationGuardEvent('tool', {
            reason: 'registration-failed',
            hostToolSnapshot,
            toolResults: toolResults.map(r => ({ id: r.id, success: r.success, duplicate: r.duplicate, error: r.error })),
            failures: failures.map(f => ({ id: f.id, error: f.error }))
        });

        // Clean up any disposables that were created before the failure
        for (const toolResult of toolResults) {
            if (toolResult.disposable) {
                try {
                    toolResult.disposable.dispose();
                } catch {
                    // Ignore disposal errors
                }
            }
        }
        result.storeToolDisposable = undefined;
        result.retrieveToolDisposable = undefined;

        outputChannel.appendLine('=== Language Model Tools Registration FAILED ===');
        for (const failure of failures) {
            outputChannel.appendLine(`❌ ${failure.id}: ${failure.error}`);
        }
    }

    return result;
}

// ============================================================================
// Background Status Command
// ============================================================================

/**
 * Register backgroundStatus command for background operation monitoring
 */
export function registerBackgroundStatusCommand(context: vscode.ExtensionContext): void {
    const command = vscode.commands.registerCommand(
        'Flowbaby.backgroundStatus',
        async () => {
            try {
                const { BackgroundOperationManager } = await import('../background/BackgroundOperationManager');
                const manager = BackgroundOperationManager.getInstance();
                const result = manager.getStatus();

                const operations = Array.isArray(result) ? result : [result];

                if (operations.length === 0) {
                    vscode.window.showInformationMessage('No background operations');
                    return;
                }

                const statusIcons: Record<string, string> = {
                    'pending': '⏸️',
                    'running': '⏳',
                    'completed': '✅',
                    'failed': '❌',
                    'terminated': '⏹️',
                    'unknown': '❓'
                };

                interface QuickPickItemWithOperation extends vscode.QuickPickItem {
                    operation: import('../background/BackgroundOperationManager').OperationEntry;
                }

                const items: QuickPickItemWithOperation[] = operations.map(op => {
                    const icon = statusIcons[op.status] || '•';
                    const elapsed = op.elapsedMs ? `${(op.elapsedMs / 1000).toFixed(1)}s` : 'N/A';
                    const workspace = op.datasetPath.split('/').pop() || 'unknown';
                    const digest = op.summaryDigest || 'N/A';
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

// ============================================================================
// Capture Commands (Milestone 1)
// ============================================================================

/**
 * Register capture commands for Milestone 1: Keyboard Shortcut Capture
 */
export function registerCaptureCommands(
    context: vscode.ExtensionContext,
    client: FlowbabyClient
): void {
    // Capture command for keyboard shortcut (Ctrl+Alt+C / Cmd+Alt+C)
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
                    console.log('Using editor selection as initial value:', initialValue.substring(0, 100));
                }

                // Step 2: Show input box for message content
                const message = await vscode.window.showInputBox({
                    prompt: 'Enter a message to capture as memory',
                    placeHolder: 'Describe what you learned or decided...',
                    value: initialValue,
                    ignoreFocusOut: true,
                    validateInput: (value) => {
                        if (!value || value.trim().length < 10) {
                            return 'Message should be at least 10 characters';
                        }
                        return null;
                    }
                });

                if (!message) {
                    console.log('Capture cancelled by user');
                    return;
                }

                // Step 3: Show progress while ingesting
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Capturing memory...',
                    cancellable: false
                }, async () => {
                    // Create a simple summary from the captured message
                    const summary: ConversationSummary = {
                        topic: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
                        topicId: null,
                        context: message,
                        decisions: [],
                        rationale: [],
                        openQuestions: [],
                        nextSteps: [],
                        references: [],
                        timeScope: new Date().toLocaleString(),
                        planId: null,
                        sessionId: null,
                        status: 'Active',
                        sourceCreatedAt: new Date(),
                        createdAt: new Date(),
                        updatedAt: new Date()
                    };

                    const success = await client.ingestSummary(summary);

                    if (success) {
                        vscode.window.showInformationMessage(
                            `✅ Memory captured: "${summary.topic}"`
                        );
                    } else {
                        vscode.window.showErrorMessage(
                            '❌ Failed to capture memory. Check Output > Flowbaby for details.'
                        );
                    }
                });
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

// ============================================================================
// Validation Commands
// ============================================================================

/**
 * Register validation and listing commands for memory diagnostics
 */
export function registerValidationCommands(
    context: vscode.ExtensionContext,
    client: FlowbabyClient
): void {
    // Validate Memories
    const validateCommand = vscode.commands.registerCommand('Flowbaby.validateMemories', async () => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Validating Flowbaby System...",
            cancellable: false
        }, async () => {
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
                const result = await client.listMemories(20);

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
                    outputChannel.appendLine(m.preview);
                    outputChannel.show();
                }

            } catch (error) {
                vscode.window.showErrorMessage(`Failed to list memories: ${error}`);
            }
        });
    });

    // Show Diagnostics command
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

// ============================================================================
// Chat Participant
// ============================================================================

/**
 * Register @flowbaby chat participant
 * Implements retrieval → format display → augment prompt → generate response → capture conversation
 */
export function registerFlowbabyParticipant(deps: ParticipantRegistrationDeps): void {
    const { context, getClient, getContextProvider, getInitState, getActiveWorkspacePath } = deps;

    console.log('=== MILESTONE 2: Registering @flowbaby Chat Participant ===');

    if (isParticipantRegistered()) {
        recordRegistrationGuardEvent('participant', { reason: 'already-registered' });
        return;
    }

    const hostParticipantSnapshot: { hasFlowbabyParticipant?: boolean; error?: string } = {
        hasFlowbabyParticipant: false
    };

    let participant: vscode.ChatParticipant | undefined;
    try {
        participant = vscode.chat.createChatParticipant(
            'flowbaby',
            async (
                request: vscode.ChatRequest,
                chatContext: vscode.ChatContext,
                stream: vscode.ChatResponseStream,
                token: vscode.CancellationToken
            ): Promise<vscode.ChatResult> => {
                console.log('=== @flowbaby participant invoked ===');
                console.log('User query:', request.prompt);

                try {
                    const flowbabyClient = getClient();
                    const flowbabyContextProvider = getContextProvider();
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

                    const config = vscode.workspace.getConfiguration('Flowbaby');
                    const memoryEnabled = config.get<boolean>('enabled', true);

                    if (!memoryEnabled) {
                        stream.markdown('⚠️ **Flowbaby is disabled**\n\nEnable it in settings: `Flowbaby.enabled`');
                        return { metadata: { disabled: true } };
                    }

                    const hasApiKey = await flowbabyClient.hasApiKey();
                    if (!hasApiKey) {
                        stream.markdown('☁️ **Flowbaby Cloud Login Required**\n\n');
                        stream.markdown('Flowbaby v0.7.0+ uses Cloud authentication for memory operations.\n\n');
                        stream.markdown('**Quick Fix:**\n');
                        stream.markdown('1. Run command: `Flowbaby: Login to Cloud`\n');
                        stream.markdown('2. Complete authentication in your browser\n\n');
                        stream.markdown('[Login to Cloud](command:flowbaby.cloud.login)');
                        return { metadata: { error: 'cloud_login_required' } };
                    }

                    // Help request handling
                    const trimmedPrompt = request.prompt.trim().toLowerCase();
                    const isHelpRequest = trimmedPrompt === '' ||
                        trimmedPrompt === 'help' ||
                        trimmedPrompt === '?' ||
                        trimmedPrompt.includes('how to use') ||
                        trimmedPrompt.includes('what can you do');

                    if (isHelpRequest) {
                        return handleHelpRequest(stream);
                    }

                    // Pending summary confirmation handling
                    const promptLower = request.prompt.toLowerCase().trim();
                    const isConfirmation = ['yes', 'y', 'store it', 'save', 'save it', 'confirm'].includes(promptLower);
                    const isDeclination = ['no', 'n', 'cancel', 'discard', 'don\'t save', 'dont save'].includes(promptLower);

                    if ((isConfirmation || isDeclination) && pendingSummaries.size > 0) {
                        return handlePendingSummaryConfirmation(stream, flowbabyClient, isConfirmation);
                    }

                    // Summary generation request detection
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

                    const threadId = extractThreadId(request);

                    if (isSummaryRequest) {
                        return await handleSummaryGeneration(
                            request, chatContext, stream, token, flowbabyClient, threadId
                        );
                    }

                    if (token.isCancellationRequested) {
                        return { metadata: { cancelled: true } };
                    }

                    // Main retrieval flow
                    return await handleRetrievalFlow(
                        request, stream, token, flowbabyClient, flowbabyContextProvider, config, threadId
                    );

                } catch (error) {
                    console.error('Chat participant error:', error);
                    stream.markdown(`\n\n❌ **Error:** ${error instanceof Error ? error.message : String(error)}`);
                    return { metadata: { error: error instanceof Error ? error.message : String(error) } };
                }
            }
        );
    } catch (error) {
        if (isKnownDuplicateParticipantError(error)) {
            recordRegistrationGuardEvent('participant', {
                reason: 'duplicate-accepted',
                error: error instanceof Error ? error.message : String(error),
                hostParticipantSnapshot
            });
            setParticipantRegistered(true);
            return;
        }

        recordRegistrationGuardEvent('participant', {
            reason: 'registration-failed',
            error: error instanceof Error ? error.message : String(error),
            hostParticipantSnapshot
        });
        return;
    }

    setParticipantRegistered(true);
    participant.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'media', 'flowbaby-icon-tightcrop.png'));
    console.log('✅ @flowbaby participant registered successfully');

    safePush(context, participant, { intent: { kind: 'participant', id: 'flowbaby' } });
    recordRegistrationGuardEvent('participant', { reason: 'registered', hostParticipantSnapshot });
}

// ============================================================================
// Helper Functions
// ============================================================================

function handleHelpRequest(stream: vscode.ChatResponseStream): vscode.ChatResult {
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

async function handlePendingSummaryConfirmation(
    stream: vscode.ChatResponseStream,
    client: FlowbabyClient,
    isConfirmation: boolean
): Promise<vscode.ChatResult> {
    const entries = Array.from(pendingSummaries.entries());
    const mostRecent = entries.sort((a, b) => b[1].timestamp - a[1].timestamp)[0];

    if (!mostRecent) {
        return { metadata: { error: 'no_pending_summary' } };
    }

    const [key, pending] = mostRecent;

    if (isConfirmation) {
        stream.markdown('📝 **Storing summary...**\n\n');

        try {
            const success = await client.ingestSummary(pending.summary, pending.threadId);

            if (success) {
                stream.markdown(`✅ **Summary stored successfully!**\n\n`);
                stream.markdown(`Topic: **${pending.summary.topic}**\n\n`);
                stream.markdown('You can retrieve this summary later by asking questions related to this topic.');
                pendingSummaries.delete(key);
                return { metadata: { summaryStored: true, topic: pending.summary.topic } };
            } else {
                stream.markdown('⚠️ **Failed to store summary**\n\n');
                stream.markdown('There was an error storing the summary. Check the Output channel (Flowbaby) for details.\n\n');
                stream.markdown('You can try again by saying "yes" or "store it".');
                return { metadata: { error: 'storage_failed' } };
            }
        } catch (error) {
            stream.markdown('❌ **Error storing summary**\n\n');
            stream.markdown(`${error instanceof Error ? error.message : String(error)}\n\n`);
            stream.markdown('You can try again by saying "yes" or "store it".');
            return { metadata: { error: error instanceof Error ? error.message : String(error) } };
        }
    } else {
        stream.markdown('ℹ️ **Summary discarded**\n\n');
        stream.markdown('The summary was not stored. You can generate a new summary anytime by asking me to "summarize this conversation".');
        pendingSummaries.delete(key);
        return { metadata: { summaryDiscarded: true } };
    }
}

async function handleSummaryGeneration(
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    _client: FlowbabyClient,
    threadId?: string
): Promise<vscode.ChatResult> {
    console.log('Handling summary generation request');

    const DEFAULT_TURN_COUNT = 15;
    let turnCount = DEFAULT_TURN_COUNT;

    const turnCountMatch = request.prompt.match(/(?:last\s+)?(\d+)\s+turns?/i);
    if (turnCountMatch) {
        const requestedCount = parseInt(turnCountMatch[1]);
        if (requestedCount > 0 && requestedCount <= 100) {
            turnCount = requestedCount;
        }
    }

    const history = chatContext.history || [];
    const availableTurns = history.filter(h => h instanceof vscode.ChatRequestTurn || h instanceof vscode.ChatResponseTurn);
    const actualTurnCount = Math.min(turnCount, availableTurns.length);

    if (availableTurns.length === 0) {
        stream.markdown('⚠️ **No conversation history available to summarize**\n\n');
        stream.markdown('Chat with me first, then ask me to summarize the conversation.');
        return { metadata: { error: 'no_history' } };
    }

    const oldestTime = new Date(Date.now() - (actualTurnCount * 60000));
    const timeAgo = getTimeAgoString(oldestTime);

    stream.markdown(`📝 **Summary Scope**\n\n`);
    stream.markdown(`I'll summarize the last **${actualTurnCount} turns** (from ${timeAgo}).\n\n`);

    if (availableTurns.length > actualTurnCount) {
        stream.markdown(`💡 *Tip: You can adjust this by saying "summarize last 30 turns" or any number up to ${availableTurns.length}.*\n\n`);
    }

    stream.markdown('Generating summary...\n\n');
    stream.markdown('---\n\n');

    const recentTurns = availableTurns.slice(-actualTurnCount);
    const conversationText = recentTurns.map((turn, index) => {
        if (turn instanceof vscode.ChatRequestTurn) {
            return `[Turn ${index + 1} - User]: ${turn.prompt}`;
        } else if (turn instanceof vscode.ChatResponseTurn) {
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

    const summaryPrompt = buildSummaryPrompt(conversationText, actualTurnCount);

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

        const parsedSummary = parseSummaryFromText(generatedSummary);

        if (!parsedSummary) {
            stream.markdown('⚠️ **Failed to parse generated summary**\n\n');
            stream.markdown('The summary was generated but could not be parsed into the structured format. ');
            stream.markdown('You can still read it above, but it won\'t be stored in memory.\n\n');
            return { metadata: { error: 'parse_failed' } };
        }

        parsedSummary.sessionId = threadId || null;
        parsedSummary.planId = extractPlanIdFromConversation(conversationText);
        parsedSummary.status = 'Active';
        parsedSummary.createdAt = new Date();
        parsedSummary.updatedAt = new Date();

        const summaryKey = `summary-${Date.now()}`;
        pendingSummaries.set(summaryKey, { summary: parsedSummary, timestamp: Date.now(), threadId });

        // Clean up old pending summaries (>5 minutes)
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        for (const [key, pending] of pendingSummaries.entries()) {
            if (pending.timestamp < fiveMinutesAgo) {
                pendingSummaries.delete(key);
            }
        }

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

async function handleRetrievalFlow(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    _client: FlowbabyClient,
    contextProvider: FlowbabyContextProvider,
    config: vscode.WorkspaceConfiguration,
    threadId: string
): Promise<vscode.ChatResult> {
    const retrievalStart = Date.now();
    let retrievedMemories: RetrievalResult[] = [];
    let retrievalFailed = false;

    try {
        const contextResponse = await contextProvider.retrieveContext({
            query: request.prompt,
            maxResults: config.get<number>('maxContextResults', 3),
            maxTokens: config.get<number>('maxContextTokens', 2000),
            threadId
        });

        if ('error' in contextResponse) {
            throw new Error(contextResponse.message);
        }

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
        console.log(`Retrieved ${retrievedMemories.length} memories in ${retrievalDuration}ms`);
    } catch (error) {
        retrievalFailed = true;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Retrieval failed:', error);

        // Plan 083 M6: Cloud-only messaging (v0.7.0)
        if (errorMessage.includes('API key') || errorMessage.includes('API_KEY') || errorMessage.includes('NOT_AUTHENTICATED')) {
            stream.markdown('⚠️ **Cloud login required** - Use "Flowbaby Cloud: Login with GitHub" command to enable memory retrieval\n\n');
        } else {
            stream.markdown('⚠️ **Memory retrieval unavailable** - continuing without context\n\n');
        }
    }

    if (token.isCancellationRequested) {
        return { metadata: { cancelled: true } };
    }

    let augmentedPrompt = request.prompt;
    if (!retrievalFailed && retrievedMemories.length > 0) {
        stream.markdown(`📚 **Retrieved ${retrievedMemories.length} ${retrievedMemories.length === 1 ? 'memory' : 'memories'}**\n\n`);

        retrievedMemories.forEach((result, index) => {
            const memory = result.summaryText || result.text || '';
            const maxPreviewLength = 2000;
            const preview = memory.length > maxPreviewLength
                ? memory.substring(0, maxPreviewLength) + `... (showing ${maxPreviewLength} of ${memory.length} chars)`
                : memory;
            const lengthIndicator = memory.length > 100 ? ` (${memory.length} chars)` : '';

            if (result.topicId) {
                stream.markdown(`**Memory ${index + 1}${lengthIndicator}:**\n`);

                const badges: string[] = [];
                if (result.status) badges.push(`📋 Status: ${result.status}`);
                if (result.createdAt) badges.push(`📅 Created: ${getTimeAgoString(result.createdAt)}`);
                if (result.sourceCreatedAt) badges.push(`🕰️ Source: ${getTimeAgoString(result.sourceCreatedAt)}`);
                if (result.updatedAt) badges.push(`♻️ Updated: ${getTimeAgoString(result.updatedAt)}`);
                if (result.planId) badges.push(`🏷️ Plan: ${result.planId}`);
                if (badges.length > 0) stream.markdown(`*${badges.join(' | ')}*\n\n`);

                if (result.topic) stream.markdown(`**Topic:** ${result.topic}\n\n`);
                if (result.decisions?.length) stream.markdown(`**Key Decisions:**\n${result.decisions.map(d => `- ${d}`).join('\n')}\n\n`);
                if (result.openQuestions?.length) stream.markdown(`**Open Questions:**\n${result.openQuestions.map(q => `- ${q}`).join('\n')}\n\n`);
                if (result.nextSteps?.length) stream.markdown(`**Next Steps:**\n${result.nextSteps.map(s => `- ${s}`).join('\n')}\n\n`);

                stream.markdown(`> ${preview}\n\n`);
            } else {
                stream.markdown(`**Memory ${index + 1}${lengthIndicator}:**\n> ${preview}\n\n`);
            }
        });

        stream.markdown('---\n\n');

        const contextSection = retrievedMemories
            .map((result, i) => `### Memory ${i + 1}\n${result.summaryText || result.text || ''}`)
            .join('\n\n');

        // Plan 063: Prepend MEMORY_CONTEXT_INSTRUCTIONS to frame retrieved memories
        // as supplementary and subordinate to current code/docs
        augmentedPrompt = `${MEMORY_CONTEXT_INSTRUCTIONS}## Relevant Past Conversations\n\n${contextSection}\n\n## Current Question\n\n${request.prompt}`;
    } else if (!retrievalFailed) {
        stream.markdown('ℹ️ *No relevant memories found for this query*\n\n---\n\n');
    }

    if (token.isCancellationRequested) {
        return { metadata: { cancelled: true } };
    }

    let fullResponse = '';

    try {
        const messages = [vscode.LanguageModelChatMessage.User(augmentedPrompt)];
        const chatResponse = await request.model.sendRequest(messages, {}, token);

        for await (const fragment of chatResponse.text) {
            if (token.isCancellationRequested) {
                return { metadata: { cancelled: true } };
            }
            stream.markdown(fragment);
            fullResponse += fragment;
        }
    } catch (error) {
        console.error('Response generation failed:', error);

        if (error instanceof vscode.LanguageModelError) {
            stream.markdown(`\n\n⚠️ **Language Model Error:** ${error.message} (Code: ${error.code})`);
        } else {
            stream.markdown('\n\n⚠️ **Failed to generate response** - Please try again');
        }

        return { metadata: { error: error instanceof Error ? error.message : String(error) } };
    }

    return { metadata: { memoriesRetrieved: retrievedMemories.length, responseLength: fullResponse.length } };
}

function buildSummaryPrompt(conversationText: string, turnCount: number): string {
    return `You are a helpful assistant that creates structured summaries of conversations.

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

**Conversation to summarize (${turnCount} turns):**

${conversationText}

---

Create the summary now, following the format exactly. Use markdown formatting.`;
}

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

function extractPlanIdFromConversation(text: string): string | null {
    const planMatch = text.match(/[Pp]lan[- ]?(\d{3})/);
    return planMatch ? planMatch[1] : null;
}

function extractThreadId(request: vscode.ChatRequest): string {
    const possibleSessionId = (request as { sessionId?: unknown }).sessionId;
    if (typeof possibleSessionId === 'string' && possibleSessionId.trim()) {
        return possibleSessionId;
    }
    return 'workspace-session';
}
