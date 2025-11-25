import * as vscode from 'vscode';
import { debugLog } from '../outputChannels';

export enum RecallFlowStatus {
    Ready = 'Ready',
    SetupRequired = 'SetupRequired',
    Refreshing = 'Refreshing',
    Error = 'Error'
}

export class RecallFlowStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private status: RecallFlowStatus = RecallFlowStatus.SetupRequired;
    private message: string = '';

    constructor(context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'cognee.showStatus';
        context.subscriptions.push(this.statusBarItem);
        
        // Plan 028 M4: Register command with error handling
        const statusCommand = vscode.commands.registerCommand('cognee.showStatus', async () => {
            try {
                await this.showStatusMenu();
            } catch (error) {
                debugLog('Status menu error', { error: String(error) });
                vscode.window.showErrorMessage(
                    `RecallFlow status menu error: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        });
        context.subscriptions.push(statusCommand);
        
        debugLog('Status bar initialized');

        this.update();
        this.statusBarItem.show();
    }

    private async showStatusMenu() {
        debugLog('Status menu opened', { currentStatus: this.status });
        
        const items: vscode.QuickPickItem[] = [
            {
                label: '$(sync) Refresh Dependencies',
                description: 'Reinstall RecallFlow dependencies',
                detail: 'Use this if you encounter environment issues'
            },
            {
                label: '$(gear) Setup Environment',
                description: 'Initialize or repair Python environment',
                detail: 'Create managed environment in .cognee/venv'
            },
            {
                label: '$(key) Set API Key',
                description: 'Store LLM API key securely',
                detail: 'Global API key for all workspaces'
            },
            {
                label: '$(output) Show Debug Logs',
                description: 'Open debug output channel',
                detail: 'Enable cogneeMemory.debugLogging for detailed logs'
            }
        ];

        const selection = await vscode.window.showQuickPick(items, {
            placeHolder: `RecallFlow Status: ${this.status}`
        });

        if (selection) {
            debugLog('Status menu selection', { label: selection.label });
            
            if (selection.label.includes('Refresh Dependencies')) {
                vscode.commands.executeCommand('cognee.refreshDependencies');
            } else if (selection.label.includes('Setup Environment')) {
                vscode.commands.executeCommand('cognee.setupEnvironment');
            } else if (selection.label.includes('Set API Key')) {
                vscode.commands.executeCommand('cognee.setApiKey');
            } else if (selection.label.includes('Show Debug Logs')) {
                vscode.commands.executeCommand('cognee.showDebugLogs');
            }
        }
    }

    public setStatus(status: RecallFlowStatus, message?: string) {
        const previousStatus = this.status;
        this.status = status;
        this.message = message || '';
        
        // Plan 028 M2: Debug logging for status bar transitions
        debugLog('Status bar transition', {
            from: previousStatus,
            to: status,
            message: message || '(none)'
        });
        
        this.update();
    }

    private update() {
        switch (this.status) {
            case RecallFlowStatus.Ready:
                this.statusBarItem.text = '$(check) RecallFlow';
                this.statusBarItem.tooltip = 'RecallFlow Memory: Ready';
                this.statusBarItem.backgroundColor = undefined; // Default color
                break;
            case RecallFlowStatus.SetupRequired:
                this.statusBarItem.text = '$(alert) RecallFlow';
                this.statusBarItem.tooltip = 'RecallFlow Memory: Setup Required';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            case RecallFlowStatus.Refreshing:
                this.statusBarItem.text = '$(sync~spin) RecallFlow';
                this.statusBarItem.tooltip = 'RecallFlow Memory: Refreshing Dependencies...';
                this.statusBarItem.backgroundColor = undefined;
                break;
            case RecallFlowStatus.Error:
                this.statusBarItem.text = '$(error) RecallFlow';
                this.statusBarItem.tooltip = `RecallFlow Memory: Error - ${this.message}`;
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
        }
    }
}
