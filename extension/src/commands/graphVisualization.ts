/**
 * Graph Visualization Command (Plan 067)
 * 
 * Exposes Flowbaby.visualizeGraph command for users and agents to generate
 * a standalone HTML visualization of the knowledge graph.
 * 
 * This command:
 * 1. Validates workspace context exists
 * 2. Generates offline-first HTML via FlowbabyClient.visualize()
 * 3. Opens the result in the default browser
 * 4. Shows toast notifications for success/error
 * 
 * Architecture Reference: system-architecture.md §4.5
 */

import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { safePush } from '../lifecycle/registrationHelper';
import { FlowbabyClient, VisualizeResult } from '../flowbabyClient';

/**
 * Register the Flowbaby.visualizeGraph command
 * 
 * This command is visible in the command palette and triggers graph visualization.
 * 
 * @param context - Extension context for registrations
 * @param getClient - Function to get or create FlowbabyClient for current workspace
 * @param outputChannel - Output channel for logging
 */
export function registerVisualizeGraphCommand(
    context: vscode.ExtensionContext,
    getClient: () => FlowbabyClient | undefined,
    outputChannel: vscode.OutputChannel
): void {
    const command = vscode.commands.registerCommand(
        'Flowbaby.visualizeGraph',
        async (): Promise<void> => {
            const startTime = Date.now();
            
            try {
                // Get client for current workspace
                const client = getClient();
                if (!client) {
                    vscode.window.showErrorMessage(
                        'Flowbaby: No workspace open. Open a folder to visualize the memory graph.'
                    );
                    return;
                }

                // Get workspace folder for output path
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    vscode.window.showErrorMessage(
                        'Flowbaby: No workspace folder found.'
                    );
                    return;
                }

                const workspacePath = workspaceFolders[0].uri.fsPath;
                
                // Generate output path in .flowbaby/cache directory (Plan 067 requirement)
                const outputDir = path.join(workspacePath, '.flowbaby', 'cache');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const outputPath = path.join(outputDir, `graph-${timestamp}.html`);

                // Ensure output directory exists
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }

                // Show progress notification
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Flowbaby: Generating graph visualization...',
                        cancellable: false
                    },
                    async (progress) => {
                        progress.report({ increment: 0 });

                        // Generate visualization
                        const result: VisualizeResult = await client.visualize(outputPath);

                        progress.report({ increment: 100 });

                        if (result.success && result.output_path) {
                            const duration = Date.now() - startTime;
                            
                            // Log success
                            outputChannel.appendLine(
                                `[Visualization] ${new Date().toISOString()} - SUCCESS - ` +
                                `nodes: ${result.node_count ?? 'unknown'}, ` +
                                `size: ${result.file_size_bytes ?? 0} bytes, ` +
                                `offline_safe: ${result.offline_safe ?? false}, ` +
                                `duration: ${duration}ms`
                            );

                            // Show success toast with action to open
                            const openAction = 'Open in Browser';
                            const revealAction = 'Reveal in Explorer';
                            
                            const action = await vscode.window.showInformationMessage(
                                `Graph visualization generated successfully (${result.node_count ?? 0} nodes)`,
                                openAction,
                                revealAction
                            );

                            if (action === openAction) {
                                // Open in default browser
                                const uri = vscode.Uri.file(result.output_path);
                                await vscode.env.openExternal(uri);
                            } else if (action === revealAction) {
                                // Reveal in file explorer
                                const uri = vscode.Uri.file(result.output_path);
                                await vscode.commands.executeCommand('revealFileInOS', uri);
                            }
                        } else {
                            // Handle specific error codes
                            const errorMessage = result.user_message || result.error || 'Unknown error';
                            
                            outputChannel.appendLine(
                                `[Visualization] ${new Date().toISOString()} - FAILED - ` +
                                `error_code: ${result.error_code ?? 'UNKNOWN'}, ` +
                                `error: ${errorMessage}`
                            );

                            if (result.error_code === 'NO_DATA') {
                                vscode.window.showWarningMessage(
                                    'Flowbaby: No graph data available. Ingest some memories first using the chat participant.'
                                );
                            } else if (result.error_code === 'MISSING_API_KEY') {
                                const setKeyAction = 'Set API Key';
                                const action = await vscode.window.showErrorMessage(
                                    'Flowbaby: API key not configured.',
                                    setKeyAction
                                );
                                if (action === setKeyAction) {
                                    await vscode.commands.executeCommand('Flowbaby.setApiKey');
                                }
                            } else {
                                vscode.window.showErrorMessage(
                                    `Flowbaby: Failed to generate graph visualization. ${errorMessage}`
                                );
                            }
                        }
                    }
                );
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                
                outputChannel.appendLine(
                    `[Visualization] ${new Date().toISOString()} - ERROR - ` +
                    `exception: ${errorMessage}`
                );

                vscode.window.showErrorMessage(
                    `Flowbaby: Graph visualization failed. ${errorMessage}`
                );
            }
        }
    );

    safePush(context, command);
}
