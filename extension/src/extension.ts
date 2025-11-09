import * as vscode from 'vscode';

/**
 * Extension activation entry point
 * Called when VS Code activates the extension (onStartupFinished)
 */
export function activate(_context: vscode.ExtensionContext) {
    console.log('Cognee Chat Memory extension activated');
    
    // TODO: Milestone 3 - Initialize Cognee client
    // TODO: Milestone 5 - Register chat participant
    
    // Placeholder for future functionality
    const outputChannel = vscode.window.createOutputChannel('Cognee Memory');
    outputChannel.appendLine('[INFO] Cognee Chat Memory extension loaded');
    outputChannel.appendLine('[INFO] Waiting for Milestone 3 (Python Bridge) implementation');
}

/**
 * Extension deactivation entry point
 * Called when VS Code deactivates the extension
 */
export function deactivate() {
    console.log('Cognee Chat Memory extension deactivated');
}
