import * as vscode from 'vscode';
import { debugLog } from '../outputChannels';
import { safePush } from '../lifecycle/registrationHelper';

/**
 * Status bar states for Flowbaby extension
 * Plan 083 M6: Simplified statuses for Cloud-only v0.7.0+
 * NeedsApiKey renamed to NeedsCloudLogin for conceptual clarity
 */
export enum FlowbabyStatus {
    Ready = 'Ready',
    SetupRequired = 'SetupRequired',
    Refreshing = 'Refreshing',
    Error = 'Error',
    /** Plan 083 M6: Core initialized but Cloud login required */
    NeedsCloudLogin = 'NeedsCloudLogin',
    /** @deprecated Plan 083 M6: Use NeedsCloudLogin instead */
    NeedsApiKey = 'NeedsCloudLogin' // Alias for backward compatibility
}

export class FlowbabyStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private status: FlowbabyStatus = FlowbabyStatus.SetupRequired;
    private message: string = '';

    constructor(context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'Flowbaby.showStatus';
        safePush(context, this.statusBarItem, { intent: { kind: 'other', id: 'statusBarItem' } });
        
        // Plan 028 M4: Register command with error handling
        const statusCommand = vscode.commands.registerCommand('Flowbaby.showStatus', async () => {
            try {
                await this.showStatusMenu();
            } catch (error) {
                debugLog('Status menu error', { error: String(error) });
                vscode.window.showErrorMessage(
                    `Flowbaby status menu error: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        });
        safePush(context, statusCommand, { intent: { kind: 'command', id: 'Flowbaby.showStatus' } });
        
        debugLog('Status bar initialized');

        this.update();
        this.statusBarItem.show();
    }

    private async showStatusMenu() {
        debugLog('Status menu opened', { currentStatus: this.status });
        
        // Plan 083 M4: Removed "Set API Key" option (Cloud-only in v0.7.0)
        // Cloud login is handled via FlowbabyCloud.login command
        const items: vscode.QuickPickItem[] = [
            {
                label: '$(sync) Refresh Dependencies',
                description: 'Reinstall Flowbaby dependencies',
                detail: 'Use this if you encounter environment issues'
            },
            {
                label: '$(gear) Setup Environment',
                description: 'Initialize or repair Python environment',
                detail: 'Create managed environment in .flowbaby/venv'
            },
            {
                label: '$(cloud) Flowbaby Cloud Status',
                description: 'Check Cloud login status',
                detail: 'Login to Flowbaby Cloud for LLM access'
            },
            {
                label: '$(output) Show Debug Logs',
                description: 'Open debug output channel',
                detail: 'Enable Flowbaby.debugLogging for detailed logs'
            }
        ];

        const selection = await vscode.window.showQuickPick(items, {
            placeHolder: `Flowbaby Status: ${this.status}`
        });

        if (selection) {
            debugLog('Status menu selection', { label: selection.label });
            
            if (selection.label.includes('Refresh Dependencies')) {
                vscode.commands.executeCommand('Flowbaby.refreshDependencies');
            } else if (selection.label.includes('Setup Environment')) {
                vscode.commands.executeCommand('Flowbaby.setupEnvironment');
            } else if (selection.label.includes('Flowbaby Cloud Status')) {
                // Plan 083 M4: Route to Cloud status instead of legacy API key
                vscode.commands.executeCommand('FlowbabyCloud.status');
            } else if (selection.label.includes('Show Debug Logs')) {
                vscode.commands.executeCommand('Flowbaby.showDebugLogs');
            }
        }
    }

    public setStatus(status: FlowbabyStatus, message?: string) {
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
            case FlowbabyStatus.Ready:
                this.statusBarItem.text = '$(check) Flowbaby';
                this.statusBarItem.tooltip = 'Flowbaby: Ready';
                this.statusBarItem.backgroundColor = undefined; // Default color
                break;
            case FlowbabyStatus.SetupRequired:
                this.statusBarItem.text = '$(alert) Flowbaby';
                this.statusBarItem.tooltip = 'Flowbaby: Setup Required';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            case FlowbabyStatus.Refreshing:
                this.statusBarItem.text = '$(sync~spin) Flowbaby';
                this.statusBarItem.tooltip = 'Flowbaby: Refreshing Dependencies...';
                this.statusBarItem.backgroundColor = undefined;
                break;
            case FlowbabyStatus.Error:
                this.statusBarItem.text = '$(error) Flowbaby';
                this.statusBarItem.tooltip = `Flowbaby: Error - ${this.message}`;
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
            case FlowbabyStatus.NeedsCloudLogin:
                // Plan 083 M6: Cloud login required (replaces legacy NeedsApiKey)
                this.statusBarItem.text = '$(cloud) Flowbaby';
                this.statusBarItem.tooltip = 'Flowbaby: Cloud Login Required - Click to login';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
        }
    }
}
