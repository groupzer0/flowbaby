/**
 * Flowbaby Dashboard View Provider
 *
 * Provides the sidebar dashboard webview for the Flowbaby activity bar icon.
 * Replaces the old DashboardPanel (editor tab) approach.
 *
 * @see Plan 097 - Dashboard Sidebar Refactor
 */

import * as vscode from 'vscode';
import { FlowbabyCloudAuth } from '../auth';
import { FlowbabyCloudClient } from '../client';
import type { UserProfileResponse, UsageResponse } from '../types';
import { generateDashboardHtml } from './dashboardHtml';

/**
 * WebviewViewProvider for the Flowbaby sidebar dashboard.
 */
export class DashboardViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'flowbaby.dashboardView';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _auth: FlowbabyCloudAuth,
        private readonly _client: FlowbabyCloudClient
    ) { }

    /**
     * Called by VS Code when the view is first shown.
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
        };

        // Initial render
        this._updateView();

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message: { command: string; url?: string }) => {
            switch (message.command) {
                case 'refreshDeps':
                    await vscode.commands.executeCommand('Flowbaby.refreshDependencies');
                    break;

                case 'setupEnvironment':
                    await vscode.commands.executeCommand('Flowbaby.setup');
                    break;

                case 'visualizeGraph':
                    await vscode.commands.executeCommand('Flowbaby.visualizeGraph');
                    break;

                case 'openUrl':
                    if (message.url) {
                        await vscode.env.openExternal(vscode.Uri.parse(message.url));
                    }
                    break;

                case 'refresh':
                    await this._updateView();
                    break;

                case 'login':
                    await vscode.commands.executeCommand('flowbaby.cloud.login');
                    // Refresh after login
                    await this._updateView();
                    break;

                case 'logout':
                    await vscode.commands.executeCommand('flowbaby.cloud.logout');
                    // Refresh after logout
                    await this._updateView();
                    break;
            }
        });

        // Refresh when view becomes visible
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._updateView();
            }
        });
    }

    /**
     * Refresh the dashboard view.
     */
    public async refresh(): Promise<void> {
        await this._updateView();
    }

    /**
     * Update the webview content.
     */
    private async _updateView(): Promise<void> {
        if (!this._view) {
            return;
        }

        const webview = this._view.webview;

        let profile: UserProfileResponse | null = null;
        let usage: UsageResponse | null = null;
        let error: string | undefined;

        try {
            const sessionToken = await this._auth.getSessionToken();
            if (!sessionToken) {
                error = 'Not authenticated';
            } else {
                // Fetch profile and usage in parallel
                [profile, usage] = await Promise.all([
                    this._client.getUserProfile(sessionToken),
                    this._client.getUserUsage(sessionToken),
                ]);
            }
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to load dashboard data';
        }

        // Get icon URI for webview (using mono SVG)
        const iconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'flowbaby-icon-mono.svg')
        );

        // Set HTML content
        this._view.webview.html = generateDashboardHtml(
            webview,
            profile,
            usage,
            iconUri.toString(),
            error
        );
    }
}
