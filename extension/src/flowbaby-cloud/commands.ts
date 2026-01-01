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
import { showCloudError } from './errorMapping';

/**
 * Command identifiers for Flowbaby Cloud.
 */
export const CLOUD_COMMANDS = {
    LOGIN: 'flowbaby.cloud.login',
    LOGOUT: 'flowbaby.cloud.logout',
    STATUS: 'flowbaby.cloud.status',
} as const;

/**
 * Register all Flowbaby Cloud commands.
 *
 * @param context - Extension context for registering disposables
 * @param auth - Authentication manager instance
 * @returns Array of disposables for the registered commands
 */
export function registerCloudCommands(
    context: vscode.ExtensionContext,
    auth: FlowbabyCloudAuth
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // Login command
    disposables.push(
        vscode.commands.registerCommand(CLOUD_COMMANDS.LOGIN, async () => {
            try {
                // Check if already authenticated
                if (await auth.isAuthenticated()) {
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
                        vscode.window.showInformationMessage(
                            `Successfully logged in to Flowbaby Cloud (${tier || 'free'} tier)`
                        );
                    }
                );
            } catch (error) {
                // Plan 083 M3: Use centralized error mapping
                await showCloudError(error, 'during login');
            }
        })
    );

    // Logout command
    disposables.push(
        vscode.commands.registerCommand(CLOUD_COMMANDS.LOGOUT, async () => {
            try {
                // Check if authenticated
                if (!(await auth.isAuthenticated())) {
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
                    return;
                }

                await auth.logout();
                vscode.window.showInformationMessage('Successfully logged out of Flowbaby Cloud.');
            } catch (error) {
                // Plan 083 M3: Use centralized error mapping
                await showCloudError(error, 'during logout');
            }
        })
    );

    // Status command
    disposables.push(
        vscode.commands.registerCommand(CLOUD_COMMANDS.STATUS, async () => {
            try {
                if (await auth.isAuthenticated()) {
                    const tier = await auth.getUserTier();
                    vscode.window.showInformationMessage(
                        `Flowbaby Cloud: Logged in (${tier || 'free'} tier)`
                    );
                } else {
                    const action = await vscode.window.showInformationMessage(
                        'Flowbaby Cloud: Not logged in',
                        'Login'
                    );
                    if (action === 'Login') {
                        await vscode.commands.executeCommand(CLOUD_COMMANDS.LOGIN);
                    }
                }
            } catch (error) {
                // Plan 083 M3: Use centralized error mapping
                await showCloudError(error, 'checking status');
            }
        })
    );

    // Register all disposables with the context
    disposables.forEach(d => context.subscriptions.push(d));

    return disposables;
}

// Plan 083 M3: Removed handleCloudError - now using centralized showCloudError from errorMapping.ts

