/**
 * Flowbaby Cloud Dashboard Panel
 *
 * Webview panel displaying user profile, credit usage, quick actions, and external links.
 * Implements singleton pattern - only one dashboard can be open at a time.
 *
 * @see Plan 097 - Dashboard Implementation
 */

import * as vscode from 'vscode';
import { FlowbabyCloudAuth } from '../auth';
import { FlowbabyCloudClient } from '../client';
import type { UserProfileResponse, UsageResponse } from '../types';
import { generateDashboardHtml } from './dashboardHtml';

/**
 * Dashboard webview panel.
 * Uses singleton pattern to ensure only one instance exists.
 */
export class DashboardPanel {
    public static currentPanel: DashboardPanel | undefined;
    private static readonly viewType = 'flowbabyDashboard';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    /**
     * Create or show the dashboard panel.
     * If panel already exists, it will be revealed instead of creating a new one.
     */
    public static async createOrShow(
        extensionUri: vscode.Uri,
        auth: FlowbabyCloudAuth,
        client: FlowbabyCloudClient
    ): Promise<void> {
        const column = vscode.ViewColumn.One;

        // If panel exists, reveal it
        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel._panel.reveal(column);
            await DashboardPanel.currentPanel._update(auth, client);
            return;
        }

        // Create new panel
        const panel = vscode.window.createWebviewPanel(
            DashboardPanel.viewType,
            'Flowbaby Dashboard',
            column,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
                retainContextWhenHidden: true,
            }
        );

        DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri);
        await DashboardPanel.currentPanel._update(auth, client);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Handle panel disposal
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    /**
     * Update dashboard with fresh data.
     */
    private async _update(
        auth: FlowbabyCloudAuth,
        client: FlowbabyCloudClient
    ): Promise<void> {
        const webview = this._panel.webview;

        let profile: UserProfileResponse | null = null;
        let usage: UsageResponse | null = null;
        let error: string | undefined;

        try {
            const sessionToken = await auth.getSessionToken();
            if (!sessionToken) {
                error = 'Not authenticated';
            } else {
                // Fetch profile and usage in parallel
                [profile, usage] = await Promise.all([
                    client.getUserProfile(sessionToken),
                    client.getUserUsage(sessionToken),
                ]);
            }
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to load dashboard data';
        }

        // Get icon URI for webview
        const iconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'flowbaby-icon-tightcrop.png')
        );

        // Set HTML content
        this._panel.webview.html = generateDashboardHtml(
            webview,
            profile,
            usage,
            iconUri.toString(),
            error
        );

        // Set up message listener
        this._setWebviewMessageListener(webview, auth, client);
    }

    /**
     * Handle messages from the webview.
     */
    private _setWebviewMessageListener(
        webview: vscode.Webview,
        auth: FlowbabyCloudAuth,
        client: FlowbabyCloudClient
    ): void {
        webview.onDidReceiveMessage(
            async (message: { command: string; url?: string }) => {
                switch (message.command) {
                    case 'refreshDeps':
                        await vscode.commands.executeCommand('Flowbaby.refreshDependencies');
                        break;

                    case 'setupEnvironment':
                        await vscode.commands.executeCommand('Flowbaby.setup');
                        break;

                    case 'showDebugLogs':
                        await vscode.commands.executeCommand('Flowbaby.showLogs');
                        break;

                    case 'openUrl':
                        if (message.url) {
                            await vscode.env.openExternal(vscode.Uri.parse(message.url));
                        }
                        break;

                    case 'refresh':
                        await this._update(auth, client);
                        break;

                    case 'login':
                        await vscode.commands.executeCommand('flowbaby.cloud.login');
                        // Refresh dashboard after login
                        await this._update(auth, client);
                        break;

                    case 'logout':
                        await vscode.commands.executeCommand('flowbaby.cloud.logout');
                        // Refresh dashboard after logout
                        await this._update(auth, client);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * Clean up resources.
     */
    public dispose(): void {
        DashboardPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
