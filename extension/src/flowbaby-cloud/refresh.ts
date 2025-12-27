/**
 * Flowbaby Cloud Credential Refresh Manager
 *
 * Coordinates credential refresh with daemon lifecycle.
 * Monitors credential expiry and triggers daemon restarts when needed.
 *
 * Design notes:
 * - Observes credential expiry from FlowbabyCloudCredentials
 * - Coordinates with daemon manager for graceful restart
 * - Ensures in-flight requests complete before restart (max 30s drain)
 *
 * @see Plan 077 M5 - Daemon Mode Credential Refresh
 */

import * as vscode from 'vscode';
import { FlowbabyCloudCredentials, CredentialRefreshEvent, CredentialExpiryEvent } from './credentials';
import { CREDENTIAL_REFRESH } from './types';

/**
 * Interface for daemon manager (to avoid circular dependency).
 * The PythonBridgeDaemonManager implements this interface.
 */
export interface IDaemonController {
    /**
     * Restart the daemon with new environment variables.
     * Should drain in-flight requests before restart.
     */
    restart(): Promise<void>;

    /**
     * Check if the daemon is currently running.
     */
    isRunning(): boolean;

    /**
     * Get the number of pending requests (for drain monitoring).
     */
    getPendingRequestCount(): number;
}

/**
 * Refresh state tracking.
 */
interface RefreshState {
    /** Whether a refresh is currently in progress */
    refreshInProgress: boolean;
    /** When the current credentials expire */
    credentialExpiresAt?: Date;
    /** Last successful refresh time */
    lastRefreshAt?: Date;
    /** Consecutive refresh failures */
    consecutiveFailures: number;
}

/**
 * Refresh manager event data.
 */
export interface RefreshManagerEvent {
    type: 'refresh-started' | 'refresh-completed' | 'refresh-failed' | 'daemon-restarting' | 'daemon-restarted';
    timestamp: Date;
    details?: Record<string, unknown>;
}

/**
 * Credential refresh manager for daemon mode.
 *
 * Monitors credential expiry and coordinates with the daemon manager
 * to restart the daemon with fresh credentials before they expire.
 */
export class CredentialRefreshManager implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly _onEvent = new vscode.EventEmitter<RefreshManagerEvent>();

    /**
     * Event fired on refresh lifecycle events.
     */
    public readonly onEvent = this._onEvent.event;

    private state: RefreshState = {
        refreshInProgress: false,
        consecutiveFailures: 0,
    };

    private daemonController?: IDaemonController;
    private drainCheckTimer?: NodeJS.Timeout;

    constructor(
        private readonly credentials: FlowbabyCloudCredentials,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        // Listen for credential refresh events
        this.disposables.push(
            this.credentials.onDidRefreshCredentials(event => this.handleCredentialRefresh(event))
        );

        // Listen for credential expiry events
        this.disposables.push(
            this.credentials.onDidExpireCredentials(event => this.handleCredentialExpiry(event))
        );
    }

    /**
     * Register the daemon controller for restart coordination.
     * Should be called when the daemon manager is initialized.
     */
    registerDaemonController(controller: IDaemonController): void {
        this.daemonController = controller;
        this.log('Daemon controller registered');
    }

    /**
     * Unregister the daemon controller.
     */
    unregisterDaemonController(): void {
        this.daemonController = undefined;
        this.log('Daemon controller unregistered');
    }

    /**
     * Check if refresh is currently in progress.
     */
    isRefreshInProgress(): boolean {
        return this.state.refreshInProgress;
    }

    /**
     * Get the current refresh state.
     */
    getState(): Readonly<RefreshState> {
        return { ...this.state };
    }

    /**
     * Handle credential refresh completion.
     * If daemon is running, trigger a graceful restart with new credentials.
     */
    private async handleCredentialRefresh(event: CredentialRefreshEvent): Promise<void> {
        this.log(`Credentials refreshed (${event.isRefresh ? 'proactive' : 'initial'})`);
        
        this.state.credentialExpiresAt = event.credentials.expiresAt;
        this.state.lastRefreshAt = new Date();

        // Only restart daemon if this was a proactive refresh (not initial fetch)
        // and the daemon is running
        if (event.isRefresh && this.daemonController?.isRunning()) {
            await this.restartDaemonWithNewCredentials();
        }

        this.state.consecutiveFailures = 0;
        this._onEvent.fire({
            type: 'refresh-completed',
            timestamp: new Date(),
            details: {
                expiresAt: event.credentials.expiresAt.toISOString(),
                isProactiveRefresh: event.isRefresh,
            },
        });
    }

    /**
     * Handle credential expiry.
     */
    private handleCredentialExpiry(event: CredentialExpiryEvent): void {
        this.log(`Credentials expired: ${event.error?.message || 'unknown reason'}`);
        
        this.state.credentialExpiresAt = undefined;
        this.state.consecutiveFailures++;

        // Show user notification
        vscode.window.showWarningMessage(
            'Flowbaby Cloud credentials have expired. Please re-authenticate.',
            'Login'
        ).then(action => {
            if (action === 'Login') {
                vscode.commands.executeCommand('flowbaby.cloud.login');
            }
        });

        this._onEvent.fire({
            type: 'refresh-failed',
            timestamp: new Date(),
            details: {
                error: event.error?.message,
                consecutiveFailures: this.state.consecutiveFailures,
            },
        });
    }

    /**
     * Restart the daemon with new credentials.
     * Implements graceful drain before restart.
     */
    private async restartDaemonWithNewCredentials(): Promise<void> {
        if (!this.daemonController) {
            this.log('WARN: No daemon controller registered, skipping restart');
            return;
        }

        if (this.state.refreshInProgress) {
            this.log('WARN: Refresh already in progress, skipping');
            return;
        }

        this.state.refreshInProgress = true;
        this._onEvent.fire({ type: 'refresh-started', timestamp: new Date() });

        try {
            this.log('Starting daemon restart with new credentials');
            this._onEvent.fire({ type: 'daemon-restarting', timestamp: new Date() });

            // Wait for in-flight requests to drain (max 30s)
            await this.waitForDrain();

            // Restart the daemon
            await this.daemonController.restart();

            this.log('Daemon restarted successfully with new credentials');
            this._onEvent.fire({ type: 'daemon-restarted', timestamp: new Date() });

        } catch (error) {
            this.log(`Failed to restart daemon: ${error}`);
            this.state.consecutiveFailures++;
            this._onEvent.fire({
                type: 'refresh-failed',
                timestamp: new Date(),
                details: { error: String(error) },
            });
        } finally {
            this.state.refreshInProgress = false;
        }
    }

    /**
     * Wait for in-flight requests to complete (drain).
     * Returns when pending count reaches 0 or timeout expires.
     */
    private async waitForDrain(): Promise<void> {
        const maxDrainMs = CREDENTIAL_REFRESH.MAX_DRAIN_WINDOW_SECONDS * 1000;
        const checkIntervalMs = 500;
        const startTime = Date.now();

        return new Promise<void>((resolve) => {
            const checkDrain = () => {
                const elapsed = Date.now() - startTime;
                const pendingCount = this.daemonController?.getPendingRequestCount() ?? 0;

                if (pendingCount === 0) {
                    this.log('Drain complete - no pending requests');
                    resolve();
                    return;
                }

                if (elapsed >= maxDrainMs) {
                    this.log(`Drain timeout reached (${pendingCount} requests still pending)`);
                    resolve(); // Proceed with restart anyway
                    return;
                }

                this.log(`Waiting for drain: ${pendingCount} pending, ${Math.round((maxDrainMs - elapsed) / 1000)}s remaining`);
                this.drainCheckTimer = setTimeout(checkDrain, checkIntervalMs);
            };

            checkDrain();
        });
    }

    /**
     * Log a message to the output channel.
     */
    private log(message: string): void {
        this.outputChannel.appendLine(`[CredentialRefreshManager] ${message}`);
    }

    dispose(): void {
        if (this.drainCheckTimer) {
            clearTimeout(this.drainCheckTimer);
        }
        this._onEvent.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

/**
 * Create the credential refresh manager.
 */
export function createCredentialRefreshManager(
    credentials: FlowbabyCloudCredentials,
    outputChannel: vscode.OutputChannel
): CredentialRefreshManager {
    return new CredentialRefreshManager(credentials, outputChannel);
}
