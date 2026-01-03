/**
 * Cloud Readiness Module (Plan 087)
 *
 * Unified Cloud readiness model that distinguishes:
 * - Authenticated: session token present/valid
 * - CredentialsReady: vend succeeded; STS credentials available
 * - BridgeReady: daemon/spawn path responsive
 *
 * This module is the single source of truth for Cloud readiness state
 * and provides centralized remediation guidance for all entry points.
 *
 * Key design decisions:
 * - Readiness is a structured state model, not a single boolean
 * - Bootstrap does NOT require Cloud availability (Plan 084 decoupling)
 * - Bridge readiness is evaluated proactively for status bar accuracy
 * - Error throttling is shared across all entry points (DRY)
 *
 * @see Plan 087 - Cloud Readiness + Vend Error UX Hardening
 */

import * as vscode from 'vscode';
import { FlowbabyCloudAuth } from './auth';
import { FlowbabyCloudCredentials } from './credentials';
import { mapCloudErrorToUX, CloudErrorUX, CLOUD_ERROR_COMMANDS } from './errorMapping';
import { FlowbabyCloudError } from './types';

// =============================================================================
// Readiness State Types
// =============================================================================

/**
 * Individual readiness axis states.
 */
export type AuthReadinessState = 'authenticated' | 'not_authenticated' | 'session_expired';
export type VendReadinessState = 'ready' | 'not_attempted' | 'failed' | 'expired';
export type BridgeReadinessState = 'ready' | 'not_checked' | 'unreachable' | 'error';

/**
 * Unified Cloud readiness state.
 * Each axis can be queried independently for fine-grained logic,
 * but the overall state is compressed into user-visible status.
 */
export interface CloudReadinessState {
    /** Authentication axis: session token validity */
    auth: AuthReadinessState;
    /** Credential vending axis: STS credential availability */
    vend: VendReadinessState;
    /** Bridge axis: daemon/spawn responsiveness */
    bridge: BridgeReadinessState;
    /** Overall user-facing status (compressed from axes) */
    overall: CloudOverallStatus;
    /** Timestamp of last state evaluation */
    evaluatedAt: Date;
    /** Last error encountered (if any) */
    lastError?: FlowbabyCloudError | Error;
}

/**
 * Compressed overall status for UI display.
 * Maps to existing FlowbabyStatus values.
 */
export type CloudOverallStatus =
    | 'ready'           // All axes green
    | 'login_required'  // Auth axis failed
    | 'degraded'        // Auth ok, vend or bridge failed
    | 'error';          // Multiple axes failed or unrecoverable

/**
 * Remediation action that can be offered to the user.
 */
export interface CloudRemediation {
    /** User-facing message */
    message: string;
    /** Primary action to offer */
    primaryAction?: {
        label: string;
        commandId: string;
    };
    /** Secondary action (optional) */
    secondaryAction?: {
        label: string;
        commandId: string;
    };
}

// =============================================================================
// Error Throttling
// =============================================================================

/**
 * Configuration for error notification throttling.
 * Prevents spam when the same error occurs repeatedly.
 */
export interface ThrottleConfig {
    /** Minimum milliseconds between notifications for the same error category */
    minIntervalMs: number;
    /** Maximum notifications per window */
    maxPerWindow: number;
    /** Window duration in milliseconds */
    windowMs: number;
}

/**
 * Default throttle configuration.
 * Allows at most 3 notifications per 5 minutes, with at least 30s between each.
 */
export const DEFAULT_THROTTLE_CONFIG: ThrottleConfig = {
    minIntervalMs: 30_000,      // 30 seconds
    maxPerWindow: 3,
    windowMs: 5 * 60 * 1000,   // 5 minutes
};

/**
 * Tracks notification history for throttling.
 */
interface ThrottleEntry {
    timestamps: number[];
    lastShownAt?: number;
}

// =============================================================================
// CloudReadinessService
// =============================================================================

/**
 * Interface for bridge health checking.
 * Allows mock injection for testing.
 */
export interface IBridgeHealthChecker {
    /** Check if the bridge (daemon or spawn path) is responsive */
    checkHealth(): Promise<boolean>;
    /** Check if daemon mode is enabled and healthy */
    isDaemonHealthy(): boolean;
}

/**
 * Unified Cloud Readiness Service.
 *
 * Provides a single source of truth for:
 * - Cloud readiness state (auth/vend/bridge)
 * - User-facing remediation guidance
 * - Throttled error notifications
 *
 * This service is the interface between the raw Cloud modules
 * (auth, credentials, provider) and the user-visible surfaces
 * (status bar, activation prompts, operation failures).
 */
export class CloudReadinessService implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly _onDidChangeReadiness = new vscode.EventEmitter<CloudReadinessState>();
    
    /** Event fired when readiness state changes */
    public readonly onDidChangeReadiness = this._onDidChangeReadiness.event;

    /** Current readiness state */
    private currentState: CloudReadinessState;

    /** Throttle tracking per error category */
    private readonly throttleMap = new Map<string, ThrottleEntry>();

    constructor(
        private readonly auth: FlowbabyCloudAuth,
        private readonly credentials: FlowbabyCloudCredentials,
        private readonly bridgeChecker: IBridgeHealthChecker | undefined,
        private readonly outputChannel: vscode.OutputChannel,
        private readonly throttleConfig: ThrottleConfig = DEFAULT_THROTTLE_CONFIG
    ) {
        // Initialize with unknown state
        this.currentState = {
            auth: 'not_authenticated',
            vend: 'not_attempted',
            bridge: 'not_checked',
            overall: 'login_required',
            evaluatedAt: new Date(),
        };

        // Listen for auth state changes
        this.disposables.push(
            auth.onDidChangeAuthState(async () => {
                await this.evaluateReadiness();
            })
        );

        // Listen for credential refresh/expiry events
        this.disposables.push(
            credentials.onDidRefreshCredentials(async () => {
                await this.evaluateReadiness();
            }),
            credentials.onDidExpireCredentials(async (event) => {
                this.currentState = {
                    ...this.currentState,
                    vend: 'expired',
                    lastError: event.error,
                    evaluatedAt: new Date(),
                };
                this.updateOverallStatus();
                this._onDidChangeReadiness.fire(this.currentState);
            })
        );
    }

    /**
     * Get the current readiness state.
     * Does NOT trigger re-evaluation; call evaluateReadiness() for fresh state.
     */
    getState(): CloudReadinessState {
        return { ...this.currentState };
    }

    /**
     * Evaluate all readiness axes and update state.
     * This is the primary method for getting truthful readiness.
     *
     * @param options - Evaluation options
     * @returns Current readiness state
     */
    async evaluateReadiness(options?: {
        /** Skip bridge check (useful during bootstrap) */
        skipBridgeCheck?: boolean;
        /** Force credential refresh */
        forceVendRefresh?: boolean;
    }): Promise<CloudReadinessState> {
        const skipBridge = options?.skipBridgeCheck ?? false;
        const forceRefresh = options?.forceVendRefresh ?? false;

        this.log('Evaluating Cloud readiness', { skipBridge, forceRefresh });

        // 1. Evaluate auth axis
        const authState = await this.evaluateAuth();

        // 2. Evaluate vend axis (only if authenticated)
        let vendState: VendReadinessState = 'not_attempted';
        let vendError: FlowbabyCloudError | Error | undefined;

        if (authState === 'authenticated') {
            const vendResult = await this.evaluateVend(forceRefresh);
            vendState = vendResult.state;
            vendError = vendResult.error;
        }

        // 3. Evaluate bridge axis (only if credentials ready, unless skipped)
        let bridgeState: BridgeReadinessState = 'not_checked';

        if (!skipBridge && vendState === 'ready') {
            bridgeState = await this.evaluateBridge();
        }

        // 4. Compute overall status
        const newState: CloudReadinessState = {
            auth: authState,
            vend: vendState,
            bridge: bridgeState,
            overall: 'error', // Will be computed below
            evaluatedAt: new Date(),
            lastError: vendError,
        };

        newState.overall = this.computeOverallStatus(newState);

        // 5. Update state and fire event if changed
        const changed = this.hasStateChanged(newState);
        this.currentState = newState;

        if (changed) {
            this.log('Readiness state changed', {
                auth: newState.auth,
                vend: newState.vend,
                bridge: newState.bridge,
                overall: newState.overall,
            });
            this._onDidChangeReadiness.fire(newState);
        }

        return newState;
    }

    /**
     * Get remediation guidance for the current state.
     */
    getRemediation(): CloudRemediation {
        return this.computeRemediation(this.currentState);
    }

    /**
     * Get remediation guidance for a specific error.
     */
    getRemediationForError(error: unknown): CloudRemediation {
        const ux = mapCloudErrorToUX(error);
        return {
            message: ux.message,
            primaryAction: ux.actions[0] ? {
                label: ux.actions[0].label,
                commandId: ux.actions[0].commandId,
            } : undefined,
            secondaryAction: ux.actions[1] ? {
                label: ux.actions[1].label,
                commandId: ux.actions[1].commandId,
            } : undefined,
        };
    }

    /**
     * Show an error notification to the user, respecting throttle limits.
     *
     * @param error - The error to display
     * @param context - Context string (e.g., "during capture")
     * @returns true if notification was shown, false if throttled
     */
    async showThrottledError(error: unknown, context?: string): Promise<boolean> {
        // Determine error category for throttling
        const category = this.getErrorCategory(error);

        // Check throttle
        if (!this.shouldShowNotification(category)) {
            this.log(`Notification throttled for category: ${category}`);
            return false;
        }

        // Record this notification
        this.recordNotification(category);

        // Map error to UX and show
        const ux = mapCloudErrorToUX(error, context);
        await this.showNotification(ux);

        return true;
    }

    /**
     * Check if the user needs to log in (for prompt gating).
     * This is the primary method for determining if login prompt should appear.
     */
    needsLogin(): boolean {
        return this.currentState.auth !== 'authenticated';
    }

    /**
     * Check if credentials are ready for operations.
     */
    hasValidCredentials(): boolean {
        return this.currentState.vend === 'ready';
    }

    /**
     * Check if the system is fully operational.
     */
    isFullyReady(): boolean {
        return this.currentState.overall === 'ready';
    }

    // =========================================================================
    // Private: Axis Evaluation
    // =========================================================================

    private async evaluateAuth(): Promise<AuthReadinessState> {
        try {
            const isAuth = await this.auth.isAuthenticated();
            return isAuth ? 'authenticated' : 'not_authenticated';
        } catch (error) {
            if (error instanceof FlowbabyCloudError && 
                (error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_INVALID')) {
                return 'session_expired';
            }
            return 'not_authenticated';
        }
    }

    private async evaluateVend(forceRefresh: boolean): Promise<{
        state: VendReadinessState;
        error?: FlowbabyCloudError | Error;
    }> {
        try {
            // Check cached credentials first (fast path)
            if (!forceRefresh && this.credentials.hasValidCredentials()) {
                return { state: 'ready' };
            }

            // Try to ensure credentials (may refresh)
            await this.credentials.ensureCredentials();
            return { state: 'ready' };
        } catch (error) {
            const wrappedError = error instanceof Error ? error : new Error(String(error));
            
            if (error instanceof FlowbabyCloudError && error.code === 'CREDENTIALS_EXPIRED') {
                return { state: 'expired', error: error };
            }
            
            return { state: 'failed', error: wrappedError };
        }
    }

    private async evaluateBridge(): Promise<BridgeReadinessState> {
        if (!this.bridgeChecker) {
            // No bridge checker configured - assume ready
            // This allows bootstrap to complete without bridge dependency
            return 'not_checked';
        }

        try {
            // First check daemon mode (synchronous, no network)
            if (this.bridgeChecker.isDaemonHealthy()) {
                return 'ready';
            }

            // Fall back to active health check
            const healthy = await this.bridgeChecker.checkHealth();
            return healthy ? 'ready' : 'unreachable';
        } catch {
            return 'error';
        }
    }

    // =========================================================================
    // Private: Status Computation
    // =========================================================================

    private computeOverallStatus(state: CloudReadinessState): CloudOverallStatus {
        // Not authenticated = login required
        if (state.auth !== 'authenticated') {
            return 'login_required';
        }

        // Authenticated but vend/bridge issues = degraded
        if (state.vend !== 'ready' || 
            (state.bridge !== 'ready' && state.bridge !== 'not_checked')) {
            return 'degraded';
        }

        // All green
        return 'ready';
    }

    private updateOverallStatus(): void {
        this.currentState.overall = this.computeOverallStatus(this.currentState);
    }

    private hasStateChanged(newState: CloudReadinessState): boolean {
        return (
            this.currentState.auth !== newState.auth ||
            this.currentState.vend !== newState.vend ||
            this.currentState.bridge !== newState.bridge ||
            this.currentState.overall !== newState.overall
        );
    }

    // =========================================================================
    // Private: Remediation
    // =========================================================================

    private computeRemediation(state: CloudReadinessState): CloudRemediation {
        switch (state.overall) {
            case 'ready':
                return {
                    message: 'Flowbaby Cloud is ready.',
                };

            case 'login_required':
                return {
                    message: 'Login to Flowbaby Cloud to enable memory operations.',
                    primaryAction: {
                        label: 'Login to Cloud',
                        commandId: CLOUD_ERROR_COMMANDS.LOGIN,
                    },
                };

            case 'degraded':
                // Determine which axis is failing
                if (state.vend === 'failed' || state.vend === 'expired') {
                    return {
                        message: 'Flowbaby Cloud credentials unavailable. Check Cloud status or retry.',
                        primaryAction: {
                            label: 'Check Status',
                            commandId: CLOUD_ERROR_COMMANDS.STATUS,
                        },
                        secondaryAction: {
                            label: 'Reload Window',
                            commandId: CLOUD_ERROR_COMMANDS.RETRY,
                        },
                    };
                }
                if (state.bridge === 'unreachable' || state.bridge === 'error') {
                    return {
                        message: 'Flowbaby bridge is not responding. Try reloading the window.',
                        primaryAction: {
                            label: 'Reload Window',
                            commandId: CLOUD_ERROR_COMMANDS.RETRY,
                        },
                    };
                }
                // Generic degraded
                return {
                    message: 'Flowbaby Cloud is degraded. Some features may not work.',
                    primaryAction: {
                        label: 'Check Status',
                        commandId: CLOUD_ERROR_COMMANDS.STATUS,
                    },
                };

            case 'error':
            default:
                return {
                    message: 'Flowbaby Cloud error. Please check status and try again.',
                    primaryAction: {
                        label: 'Check Status',
                        commandId: CLOUD_ERROR_COMMANDS.STATUS,
                    },
                };
        }
    }

    // =========================================================================
    // Private: Throttling
    // =========================================================================

    private getErrorCategory(error: unknown): string {
        if (error instanceof FlowbabyCloudError) {
            // Group by error code for throttling
            return `cloud_${error.code}`;
        }
        if (error instanceof Error) {
            return `generic_${error.name}`;
        }
        return 'unknown';
    }

    private shouldShowNotification(category: string): boolean {
        const entry = this.throttleMap.get(category);
        if (!entry) {
            return true;
        }

        const now = Date.now();

        // Check minimum interval
        if (entry.lastShownAt && (now - entry.lastShownAt) < this.throttleConfig.minIntervalMs) {
            return false;
        }

        // Check max per window
        const windowStart = now - this.throttleConfig.windowMs;
        const recentCount = entry.timestamps.filter(t => t > windowStart).length;
        if (recentCount >= this.throttleConfig.maxPerWindow) {
            return false;
        }

        return true;
    }

    private recordNotification(category: string): void {
        const now = Date.now();
        let entry = this.throttleMap.get(category);

        if (!entry) {
            entry = { timestamps: [] };
            this.throttleMap.set(category, entry);
        }

        entry.timestamps.push(now);
        entry.lastShownAt = now;

        // Prune old timestamps
        const windowStart = now - this.throttleConfig.windowMs;
        entry.timestamps = entry.timestamps.filter(t => t > windowStart);
    }

    private async showNotification(ux: CloudErrorUX): Promise<void> {
        const actionLabels = ux.actions.map(a => a.label);

        let selection: string | undefined;
        switch (ux.severity) {
            case 'info':
                selection = await vscode.window.showInformationMessage(ux.message, ...actionLabels);
                break;
            case 'warning':
                selection = await vscode.window.showWarningMessage(ux.message, ...actionLabels);
                break;
            case 'error':
                selection = await vscode.window.showErrorMessage(ux.message, ...actionLabels);
                break;
        }

        if (selection) {
            const action = ux.actions.find(a => a.label === selection);
            if (action) {
                await vscode.commands.executeCommand(action.commandId, ...(action.args ?? []));
            }
        }
    }

    // =========================================================================
    // Private: Logging
    // =========================================================================

    private log(message: string, data?: Record<string, unknown>): void {
        const timestamp = new Date().toISOString();
        const dataStr = data ? ` ${JSON.stringify(data)}` : '';
        this.outputChannel.appendLine(`[${timestamp}] [CloudReadiness] ${message}${dataStr}`);
    }

    // =========================================================================
    // Disposal
    // =========================================================================

    dispose(): void {
        this._onDidChangeReadiness.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a CloudReadinessService with real dependencies.
 */
export function createCloudReadinessService(
    auth: FlowbabyCloudAuth,
    credentials: FlowbabyCloudCredentials,
    bridgeChecker: IBridgeHealthChecker | undefined,
    outputChannel: vscode.OutputChannel
): CloudReadinessService {
    return new CloudReadinessService(auth, credentials, bridgeChecker, outputChannel);
}

// =============================================================================
// Singleton Management
// =============================================================================

let readinessServiceInstance: CloudReadinessService | undefined;

/**
 * Initialize the readiness service singleton.
 */
export function initializeReadinessService(
    auth: FlowbabyCloudAuth,
    credentials: FlowbabyCloudCredentials,
    bridgeChecker: IBridgeHealthChecker | undefined,
    outputChannel: vscode.OutputChannel
): CloudReadinessService {
    readinessServiceInstance = createCloudReadinessService(
        auth,
        credentials,
        bridgeChecker,
        outputChannel
    );
    return readinessServiceInstance;
}

/**
 * Get the readiness service singleton.
 */
export function getReadinessService(): CloudReadinessService | undefined {
    return readinessServiceInstance;
}

/**
 * Reset the readiness service singleton (for testing).
 */
export function resetReadinessService(): void {
    if (readinessServiceInstance) {
        readinessServiceInstance.dispose();
        readinessServiceInstance = undefined;
    }
}
