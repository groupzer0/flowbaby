import * as vscode from 'vscode';
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
            // TODO: Milestone 5 - Register chat participant
        } else {
            console.warn('Cognee client initialization failed (see Output Channel)');
        }
    } catch (error) {
        console.error('Failed to create Cognee client:', error);
        vscode.window.showWarningMessage(
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
 * Used by chat participant (Milestone 5)
 */
export function getCogneeClient(): CogneeClient | undefined {
    return cogneeClient;
}
