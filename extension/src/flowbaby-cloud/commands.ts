/**
 * Flowbaby Cloud Commands
 *
 * VS Code commands for Flowbaby Cloud authentication and management.
 *
 * @see Plan 077 M2 - Authentication Module
 * @see Plan 083 M3 - Uses centralized error mapping
 */

import * as vscode from 'vscode';
import { FlowbabyCloudAuth } from './auth';
import { FlowbabyCloudClient } from './client';
import { showCloudError } from './errorMapping';

/**
 * Command identifiers for Flowbaby Cloud.
 */
export const CLOUD_COMMANDS = {
    LOGIN: 'flowbaby.cloud.login',
    LOGOUT: 'flowbaby.cloud.logout',
    STATUS: 'flowbaby.cloud.status',
    DASHBOARD: 'flowbaby.cloud.dashboard',
} as const;

/**
 * Register all Flowbaby Cloud commands.
 *
 * @param context - Extension context for registering disposables
 * @param auth - Authentication manager instance
 * @param client - Cloud client for API calls
 * @param outputChannel - Optional output channel for command observability (Plan 085)
 * @returns Array of disposables for the registered commands
 */
export function registerCloudCommands(
    context: vscode.ExtensionContext,
    auth: FlowbabyCloudAuth,
    client: FlowbabyCloudClient,
    outputChannel?: vscode.OutputChannel
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // Plan 085: Helper for safe observability logging (no secrets)
    const logCommand = (command: string, detail?: string) => {
        if (outputChannel) {
            const timestamp = new Date().toISOString();
            const message = detail
                ? `[${timestamp}] Command invoked: ${command} - ${detail}`
                : `[${timestamp}] Command invoked: ${command}`;
            outputChannel.appendLine(message);
        }
    };

    // Login command
    disposables.push(
        vscode.commands.registerCommand(CLOUD_COMMANDS.LOGIN, async () => {
            logCommand(CLOUD_COMMANDS.LOGIN, 'starting login flow');
            try {
                // Check if already authenticated
                if (await auth.isAuthenticated()) {
                    logCommand(CLOUD_COMMANDS.LOGIN, 'already authenticated, prompting for logout');
                    const action = await vscode.window.showInformationMessage(
                        'You are already logged in to Flowbaby Cloud.',
                        'Logout',
                        'Cancel'
                    );
                    if (action === 'Logout') {
                        await vscode.commands.executeCommand(CLOUD_COMMANDS.LOGOUT);
                    }
                    return;
                }

                // Start login flow
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Flowbaby Cloud',
                        cancellable: false,
                    },
                    async (progress) => {
                        progress.report({ message: 'Logging in with GitHub...' });
                        await auth.login();
                        const tier = await auth.getUserTier();
                        logCommand(CLOUD_COMMANDS.LOGIN, `login successful (tier: ${tier || 'free'})`);
                        vscode.window.showInformationMessage(
                            `Successfully logged in to Flowbaby Cloud (${tier || 'free'} tier)`
                        );
                    }
                );
            } catch (error) {
                logCommand(CLOUD_COMMANDS.LOGIN, `login failed: ${error instanceof Error ? error.message : 'unknown error'}`);
                // Plan 083 M3: Use centralized error mapping
                await showCloudError(error, 'during login');
            }
        })
    );

    // Logout command
    disposables.push(
        vscode.commands.registerCommand(CLOUD_COMMANDS.LOGOUT, async () => {
            logCommand(CLOUD_COMMANDS.LOGOUT, 'starting logout flow');
            try {
                // Check if authenticated
                if (!(await auth.isAuthenticated())) {
                    logCommand(CLOUD_COMMANDS.LOGOUT, 'not authenticated');
                    vscode.window.showInformationMessage('You are not logged in to Flowbaby Cloud.');
                    return;
                }

                // Confirm logout
                const action = await vscode.window.showWarningMessage(
                    'Are you sure you want to log out of Flowbaby Cloud?',
                    'Logout',
                    'Cancel'
                );

                if (action !== 'Logout') {
                    logCommand(CLOUD_COMMANDS.LOGOUT, 'cancelled by user');
                    return;
                }

                await auth.logout();
                logCommand(CLOUD_COMMANDS.LOGOUT, 'logout successful');
                vscode.window.showInformationMessage('Successfully logged out of Flowbaby Cloud.');
            } catch (error) {
                logCommand(CLOUD_COMMANDS.LOGOUT, `logout failed: ${error instanceof Error ? error.message : 'unknown error'}`);
                // Plan 083 M3: Use centralized error mapping
                await showCloudError(error, 'during logout');
            }
        })
    );

    // Status command
    disposables.push(
        vscode.commands.registerCommand(CLOUD_COMMANDS.STATUS, async () => {
            logCommand(CLOUD_COMMANDS.STATUS, 'checking status');
            try {
                if (await auth.isAuthenticated()) {
                    const tier = await auth.getUserTier();
                    logCommand(CLOUD_COMMANDS.STATUS, `authenticated (tier: ${tier || 'free'})`);
                    vscode.window.showInformationMessage(
                        `Flowbaby Cloud: Logged in (${tier || 'free'} tier)`
                    );
                } else {
                    logCommand(CLOUD_COMMANDS.STATUS, 'not authenticated');
                    const action = await vscode.window.showInformationMessage(
                        'Flowbaby Cloud: Not logged in',
                        'Login'
                    );
                    if (action === 'Login') {
                        await vscode.commands.executeCommand(CLOUD_COMMANDS.LOGIN);
                    }
                }
            } catch (error) {
                logCommand(CLOUD_COMMANDS.STATUS, `status check failed: ${error instanceof Error ? error.message : 'unknown error'}`);
                // Plan 083 M3: Use centralized error mapping
                await showCloudError(error, 'checking status');
            }
        })
    );

    // Dashboard command (Plan 097: reveals sidebar view, legacy panel removed)
    disposables.push(
        vscode.commands.registerCommand(CLOUD_COMMANDS.DASHBOARD, async () => {
            logCommand(CLOUD_COMMANDS.DASHBOARD, 'opening dashboard');
            try {
                // Check if authenticated
                if (!(await auth.isAuthenticated())) {
                    logCommand(CLOUD_COMMANDS.DASHBOARD, 'not authenticated, prompting login');
                    const action = await vscode.window.showInformationMessage(
                        'Login to view your Flowbaby dashboard',
                        'Login'
                    );
                    if (action === 'Login') {
                        await vscode.commands.executeCommand(CLOUD_COMMANDS.LOGIN);
                        // Check again after login attempt
                        if (!(await auth.isAuthenticated())) {
                            return;
                        }
                    } else {
                        return;
                    }
                }

                // Plan 097: Single dashboard surface - reveal sidebar view
                await vscode.commands.executeCommand('flowbaby.dashboardView.focus');
                logCommand(CLOUD_COMMANDS.DASHBOARD, 'dashboard opened');
            } catch (error) {
                logCommand(CLOUD_COMMANDS.DASHBOARD, `failed to open dashboard: ${error instanceof Error ? error.message : 'unknown error'}`);
                await showCloudError(error, 'opening dashboard');
            }
        })
    );

    // Register all disposables with the context
    disposables.forEach(d => context.subscriptions.push(d));

    return disposables;
}

// Plan 083 M3: Removed handleCloudError - now using centralized showCloudError from errorMapping.ts
