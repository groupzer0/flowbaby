import * as vscode from 'vscode';

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
        
        const statusCommand = vscode.commands.registerCommand('cognee.showStatus', () => this.showStatusMenu());
        context.subscriptions.push(statusCommand);

        this.update();
        this.statusBarItem.show();
    }

    private async showStatusMenu() {
        const items: vscode.QuickPickItem[] = [
            {
                label: '$(sync) Refresh Dependencies',
                description: 'Reinstall RecallFlow dependencies',
                detail: 'Use this if you encounter environment issues'
            },
            {
                label: '$(gear) Setup Environment',
                description: 'Initialize or repair Python environment',
                detail: 'Create a managed .venv for RecallFlow'
            }
        ];

        const selection = await vscode.window.showQuickPick(items, {
            placeHolder: `RecallFlow Status: ${this.status}`
        });

        if (selection) {
            if (selection.label.includes('Refresh Dependencies')) {
                vscode.commands.executeCommand('cognee.refreshDependencies');
            } else if (selection.label.includes('Setup Environment')) {
                vscode.commands.executeCommand('cognee.setupEnvironment');
            }
        }
    }

    public setStatus(status: RecallFlowStatus, message?: string) {
        this.status = status;
        this.message = message || '';
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
