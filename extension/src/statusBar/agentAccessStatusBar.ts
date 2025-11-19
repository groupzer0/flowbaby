/**
 * Status Bar Manager for Agent Access (Plan 015 Milestone 3)
 * 
 * Provides visual transparency when workspace is exposed to agent memory writes
 */

import * as vscode from 'vscode';

export class AgentAccessStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private config: vscode.WorkspaceConfiguration;
    private outputChannel: vscode.OutputChannel;

    constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.config = vscode.workspace.getConfiguration('cogneeMemory');
        
        // Create status bar item (right side, priority 100)
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        
        // Command to open output channel
        this.statusBarItem.command = 'cognee.showAgentActivity';
        
        // Register command to show output channel
        const showCommand = vscode.commands.registerCommand('cognee.showAgentActivity', () => {
            this.outputChannel.show();
        });
        
        context.subscriptions.push(this.statusBarItem);
        context.subscriptions.push(showCommand);
        
        // Listen for configuration changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('cogneeMemory.agentAccess.enabled')) {
                    this.updateStatusBar();
                }
            })
        );
        
        // Initial update
        this.updateStatusBar();
    }

    /**
     * Update status bar visibility and text based on configuration
     */
    private updateStatusBar(): void {
        this.config = vscode.workspace.getConfiguration('cogneeMemory');
        const agentAccessEnabled = this.config.get<boolean>('agentAccess.enabled', false);
        
        if (agentAccessEnabled) {
            this.statusBarItem.text = '$(shield) Cognee Agent Access';
            this.statusBarItem.tooltip = 'Agent memory writes enabled. Click to view agent activity.';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.statusBarItem.show();
        } else {
            this.statusBarItem.hide();
        }
    }

    /**
     * Show spinner during ingestion
     */
    public showIngesting(): void {
        const config = vscode.workspace.getConfiguration('cogneeMemory');
        const agentAccessEnabled = config.get<boolean>('agentAccess.enabled', false);
        
        if (agentAccessEnabled) {
            this.statusBarItem.text = '$(sync~spin) Cognee Ingesting...';
            this.statusBarItem.tooltip = 'Agent is writing to memory. Click to view details.';
        }
    }

    /**
     * Restore normal status after ingestion completes
     */
    public hideIngesting(): void {
        this.updateStatusBar();
    }

    /**
     * Dispose of status bar item
     */
    public dispose(): void {
        this.statusBarItem.dispose();
    }
}
