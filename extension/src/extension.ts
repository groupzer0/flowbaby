import * as vscode from 'vscode';
import * as path from 'path';
import { CogneeClient } from './cogneeClient';

// Module-level variable to store client instance
let cogneeClient: CogneeClient | undefined;

/**
 * Extension activation entry point
 * Called when VS Code activates the extension (onStartupFinished)
 */
export async function activate(_context: vscode.ExtensionContext) {
    console.log('Cognee Chat Memory extension activated');
    
    // Get workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage(
            'Cognee Chat Memory requires an open workspace folder'
        );
        return;
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;

    // Initialize Cognee client
    try {
        cogneeClient = new CogneeClient(workspacePath);
        const initialized = await cogneeClient.initialize();

        if (initialized) {
            console.log('Cognee client initialized successfully');
            
            // Register commands for Milestone 1: Context Menu Capture
            registerCaptureCommands(_context, cogneeClient);
            
            // Milestone 2: Register @cognee-memory chat participant
            registerCogneeMemoryParticipant(_context, cogneeClient);
        } else {
            console.warn('Cognee client initialization failed (see Output Channel)');
            
            // Check if it's an API key issue and provide helpful guidance
            const outputChannel = vscode.window.createOutputChannel('Cognee Memory');
            outputChannel.appendLine('Failed to initialize Cognee. Common issues:');
            outputChannel.appendLine('');
            outputChannel.appendLine('1. Missing LLM API Key:');
            outputChannel.appendLine('   - Create a .env file in your workspace root');
            outputChannel.appendLine('   - Add: LLM_API_KEY=your_key_here');
            outputChannel.appendLine('');
            outputChannel.appendLine('2. Missing Python dependencies:');
            outputChannel.appendLine('   - Ensure cognee and python-dotenv are installed');
            outputChannel.appendLine('   - Run: pip install cognee python-dotenv');
            outputChannel.show();
            
            const action = await vscode.window.showWarningMessage(
                'Cognee initialization failed. Check Output > Cognee Memory for setup instructions.',
                'Open Output',
                'Dismiss'
            );
            
            if (action === 'Open Output') {
                outputChannel.show();
            }
        }
    } catch (error) {
        console.error('Failed to create Cognee client:', error);
        vscode.window.showErrorMessage(
            `Cognee Chat Memory initialization error: ${error}`
        );
    }
}

/**
 * Extension deactivation entry point
 * Called when VS Code deactivates the extension
 */
export function deactivate() {
    console.log('Cognee Chat Memory extension deactivated');
    cogneeClient = undefined;
}

/**
 * Get the active Cognee client instance
 * Used by chat participant (Milestone 2)
 */
export function getCogneeClient(): CogneeClient | undefined {
    return cogneeClient;
}

/**
 * Register capture commands for Milestone 1: Keyboard Shortcut Capture
 * VALIDATION: Testing command palette + keyboard shortcut approach (fallback after context menu API failure)
 */
function registerCaptureCommands(
    context: vscode.ExtensionContext,
    client: CogneeClient
) {
    // VALIDATION 1: Test capture command with keyboard shortcut
    // NOTE: Context menu API (chat/message/context) does not exist - using fallback approach
    const captureCommand = vscode.commands.registerCommand(
        'cognee.captureMessage',
        async () => {
            console.log('=== VALIDATION 1: Capture Command Test (Fallback Approach) ===');
            console.log('Command triggered via keyboard shortcut or command palette');
            
            // Fallback: Show input box to capture user text or use clipboard
            try {
                const options: vscode.InputBoxOptions = {
                    prompt: 'Enter text to capture to Cognee Memory (or leave empty to capture from clipboard)',
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
                    
                    // Test ingestion (Validation 2 prep)
                    console.log('Testing ingestion...');
                    
                    // For manual capture, treat as user note
                    const userMsg = 'Manual note: ' + content;
                    const assistantMsg = 'Captured via Ctrl+Alt+C (Cmd+Alt+C on Mac) shortcut';
                    
                    const ingested = await client.ingest(userMsg, assistantMsg);
                    
                    if (ingested) {
                        vscode.window.showInformationMessage('✅ Captured to Cognee memory');
                    } else {
                        vscode.window.showWarningMessage('⚠️ Capture input received but ingestion failed');
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
        'cognee.toggleMemory',
        async () => {
            const config = vscode.workspace.getConfiguration('cogneeMemory');
            const currentState = config.get<boolean>('enabled', true);
            await config.update('enabled', !currentState, vscode.ConfigurationTarget.Workspace);
            vscode.window.showInformationMessage(
                `Cognee Memory ${!currentState ? 'enabled' : 'disabled'}`
            );
        }
    );
    
    // Clear memory command (Milestone 4)
    const clearCommand = vscode.commands.registerCommand(
        'cognee.clearMemory',
        async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Delete all Cognee memories for this workspace?',
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
 * Register @cognee-memory chat participant for Milestone 2
 * Implements 6-step flow: retrieval → format display → augment prompt → generate response → capture conversation
 */
function registerCogneeMemoryParticipant(
    context: vscode.ExtensionContext,
    client: CogneeClient
) {
    console.log('=== MILESTONE 2: Registering @cognee-memory Chat Participant ===');

    // Register chat participant with ID matching package.json
    const participant = vscode.chat.createChatParticipant(
        'cognee-memory',
        async (
            request: vscode.ChatRequest,
            _chatContext: vscode.ChatContext,
            stream: vscode.ChatResponseStream,
            token: vscode.CancellationToken
        ): Promise<vscode.ChatResult> => {
            console.log('=== @cognee-memory participant invoked ===');
            console.log('User query:', request.prompt);

            try {
                // Check if memory is enabled
                const config = vscode.workspace.getConfiguration('cogneeMemory');
                const memoryEnabled = config.get<boolean>('enabled', true);

                if (!memoryEnabled) {
                    stream.markdown('⚠️ **Cognee Memory is disabled**\n\nEnable it in settings: `cogneeMemory.enabled`');
                    return { metadata: { disabled: true } };
                }

                // Check cancellation before expensive operations
                if (token.isCancellationRequested) {
                    return { metadata: { cancelled: true } };
                }

                // STEP 1-2: Retrieve relevant context from Cognee
                const retrievalStart = Date.now();
                let retrievedMemories: string[] = [];
                let retrievalFailed = false;

                try {
                    retrievedMemories = await client.retrieve(request.prompt);
                    const retrievalDuration = Date.now() - retrievalStart;
                    console.log(`Retrieved ${retrievedMemories.length} memories in ${retrievalDuration}ms`);
                } catch (error) {
                    retrievalFailed = true;
                    console.error('Retrieval failed:', error);
                    stream.markdown('⚠️ **Memory retrieval unavailable** - continuing without context\n\n');
                }

                // Check cancellation after retrieval
                if (token.isCancellationRequested) {
                    return { metadata: { cancelled: true } };
                }

                // STEP 3: Format and display retrieved context
                let augmentedPrompt = request.prompt;
                if (!retrievalFailed && retrievedMemories.length > 0) {
                    stream.markdown(`📚 **Retrieved ${retrievedMemories.length} ${retrievedMemories.length === 1 ? 'memory' : 'memories'}**\n\n`);
                    
                    // Show preview of retrieved memories
                    retrievedMemories.forEach((memory, index) => {
                        const preview = memory.length > 150 
                            ? memory.substring(0, 150) + '...' 
                            : memory;
                        stream.markdown(`**Memory ${index + 1}:**\n> ${preview}\n\n`);
                    });

                    stream.markdown('---\n\n');

                    // STEP 4: Augment prompt with retrieved context
                    const contextSection = retrievedMemories
                        .map((memory, i) => `### Memory ${i + 1}\n${memory}`)
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
                    // Enable via cogneeMemory.autoIngestConversations setting for experimental testing
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
                        console.log('ℹ️ Step 6 automatic ingestion disabled (enable via cogneeMemory.autoIngestConversations)');
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

    console.log('✅ @cognee-memory participant registered successfully');

    // Add to subscriptions for proper cleanup
    context.subscriptions.push(participant);
}
