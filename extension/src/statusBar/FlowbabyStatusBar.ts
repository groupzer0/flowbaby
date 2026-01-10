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
        // Plan 097: Click status bar to focus sidebar dashboard view
        this.statusBarItem.command = 'flowbaby.dashboardView.focus';
        safePush(context, this.statusBarItem, { intent: { kind: 'other', id: 'statusBarItem' } });

        debugLog('Status bar initialized');

        this.update();
        this.statusBarItem.show();
    }

    // Plan 097: showStatusMenu removed - status bar now opens dashboard directly

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
