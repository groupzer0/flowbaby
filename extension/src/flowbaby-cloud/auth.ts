/**
 * Flowbaby Cloud Authentication Module
 *
 * Implements GitHub OAuth authentication via VS Code URI handler.
 * Session tokens are stored securely in VS Code's SecretStorage.
 *
 * OAuth Flow:
 * 1. User initiates login via command
 * 2. Extension opens browser to GitHub OAuth authorize URL
 * 3. Backend handles OAuth callback, creates session, redirects to vscode://
 * 4. VS Code URI handler captures redirect with auth code
 * 5. Extension exchanges code for session token via backend
 * 6. Session token stored in SecretStorage
 *
 * Plan 104 Enhancements:
 * - Side-effect-free auth state queries (getAuthState)
 * - Refresh coordinator with singleflight + throttling (requestRefresh)
 * - Bounded activation-time refresh (activationRefresh)
 * - TTL-aware refresh scheduling
 *
 * @see Plan 077 M2 - Authentication Module
 * @see Plan 104 - Prevent Unexpected Cloud Logouts After VS Code Restart
 */

import * as vscode from 'vscode';
import type { AuthResponse, RefreshResponse, ExtensionAuthResponse, ExtensionRefreshResponse } from './types';
import { FlowbabyCloudError, SECRET_KEYS, getOAuthCallbackUri, UnsupportedUriSchemeError, FLOWBABY_CLOUD_CONFIG, SESSION_REFRESH, isExtensionAuthResponse, isExtensionRefreshResponse } from './types';
import { FlowbabyCloudClient } from './client';

// =============================================================================
// Plan 104: Auth State Types (Side-Effect-Free)
// =============================================================================

/**
 * Auth state enum for side-effect-free state queries.
 * These states MUST NOT trigger side effects when read.
 *
 * @see Plan 104 Milestone 5 - Auth State Model
 */
export type AuthState =
    | 'logged_out'          // No refresh credential present
    | 'valid'               // Access token unexpired
    | 'expired_refreshable' // Access token expired (or near expiry) and refresh credential exists
    | 'refresh_in_progress' // Coordinator refresh attempt currently in flight
    | 'login_required';     // Refresh credential missing/invalid OR coordinator classified refresh as non-recoverable

/**
 * Detailed auth state info returned by getAuthState().
 * All fields are read-only observations - no side effects.
 */
export interface AuthStateInfo {
    /** Current auth state */
    state: AuthState;
    /** Whether a refresh token is present in storage */
    refreshTokenPresent: boolean;
    /** Remaining TTL in milliseconds (undefined if no session) */
    remainingTtlMs?: number;
    /** Session expiry timestamp (undefined if no session) */
    expiresAt?: string;
}

/**
 * Result of a refresh request via the coordinator.
 */
export interface RefreshResult {
    /** Whether refresh succeeded */
    success: boolean;
    /** Whether the request was throttled (not attempted) */
    throttled?: boolean;
    /** Error if refresh failed */
    error?: Error;
}

/**
 * Result of activation-time refresh.
 */
export interface ActivationRefreshResult {
    /** Whether refresh was attempted */
    attempted: boolean;
    /** Whether refresh succeeded */
    success?: boolean;
    /** Whether the attempt timed out */
    timedOut?: boolean;
    /** Whether secrets were cleared (only on INVALID_REFRESH) */
    secretsCleared?: boolean;
    /** Reason for not attempting (if applicable) */
    reason?: string;
}

/**
 * Info about the current refresh schedule.
 */
export interface RefreshScheduleInfo {
    /** Whether a refresh is scheduled */
    scheduled: boolean;
    /** Time until next refresh in milliseconds */
    nextRefreshInMs?: number;
}

/**
 * Plan 104: Near-expiry threshold in milliseconds.
 * Sessions within this window are treated as "expired_refreshable" and
 * should trigger proactive refresh on activation.
 */
const NEAR_EXPIRY_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Plan 104: Activation refresh time budget in milliseconds.
 * Refresh attempts during activation must complete within this budget.
 */
const ACTIVATION_REFRESH_BUDGET_MS = 2000; // 2 seconds

/**
 * Plan 104: Minimum interval between refresh attempts after failure (throttling).
 */
const REFRESH_THROTTLE_INTERVAL_MS = 30 * 1000; // 30 seconds

/**
 * Interface for auth client operations.
 * Allows for mock injection in tests.
 */
export interface IAuthClient {
    /**
     * Exchange a Flowbaby one-time exchange code for session and refresh tokens.
     * Always sends clientType: 'extension' per contract v4.0.0.
     */
    exchangeOAuthCode(code: string): Promise<AuthResponse>;

    /**
     * Refresh a session using a refresh token.
     * Returns RefreshResponse (NOT AuthResponse) per contract v4.0.0.
     * Returns new session token and new refresh token (rotation).
     */
    refreshSession(refreshToken: string): Promise<RefreshResponse>;
}

/**
 * Adapter that wraps FlowbabyCloudClient to implement IAuthClient.
 * Converts the string code to the AuthRequest format expected by the client.
 * 
 * Plan 098: Always sends clientType: 'extension' per v4.0.0 contract.
 */
class AuthClientAdapter implements IAuthClient {
    constructor(private readonly client: FlowbabyCloudClient) {}

    async exchangeOAuthCode(code: string): Promise<AuthResponse> {
        // Plan 098: v4.0.0 requires clientType in AuthRequest
        return this.client.exchangeOAuthCode({ code, clientType: 'extension' });
    }

    async refreshSession(refreshToken: string): Promise<RefreshResponse> {
        // Plan 098: v4.0.0 refresh returns RefreshResponse (not AuthResponse)
        return this.client.refreshSession(refreshToken);
    }
}

/**
 * Authentication state change event data.
 */
export interface AuthStateChangeEvent {
    isAuthenticated: boolean;
    tier?: string;
}

/**
 * Mock auth client for testing without network calls.
 * Plan 098: Updated to return v4.0.0 compliant responses.
 */
export class MockAuthClient implements IAuthClient {
    private mockResponse: ExtensionAuthResponse;

    constructor(mockResponse?: Partial<ExtensionAuthResponse>) {
        this.mockResponse = {
            sessionToken: 'mock-session-token-' + Date.now(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            tier: 'free',
            githubId: 'mock-github-user',
            refreshToken: 'mock-refresh-token-' + Date.now(),
            ...mockResponse,
        };
    }

    async exchangeOAuthCode(_code: string): Promise<AuthResponse> {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 100));
        return this.mockResponse;
    }

    async refreshSession(_refreshToken: string): Promise<RefreshResponse> {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 100));
        // Return new tokens (simulating rotation) - v4.0.0 RefreshResponse
        const refreshResponse: ExtensionRefreshResponse = {
            sessionToken: 'mock-refreshed-session-' + Date.now(),
            refreshToken: 'mock-rotated-refresh-' + Date.now(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            tier: this.mockResponse.tier,
            githubId: this.mockResponse.githubId,
        };
        return refreshResponse;
    }
}

/**
 * Authentication manager for Flowbaby Cloud.
 *
 * Handles OAuth flow, token storage, and session state.
 *
 * Plan 104 Enhancements:
 * - getAuthState(): Side-effect-free auth state query
 * - requestRefresh(): Coordinator-based refresh with singleflight + throttling
 * - activationRefresh(): Bounded activation-time refresh (2s budget)
 */
export class FlowbabyCloudAuth implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly _onDidChangeAuthState = new vscode.EventEmitter<AuthStateChangeEvent>();

    /**
     * Event fired when authentication state changes.
     */
    public readonly onDidChangeAuthState = this._onDidChangeAuthState.event;

    private pendingOAuthResolve?: (code: string) => void;
    private pendingOAuthReject?: (error: Error) => void;

    /** Timer for proactive session refresh */
    private refreshTimer?: NodeJS.Timeout;

    /** Flag to prevent concurrent refresh attempts */
    private isRefreshing = false;

    // Plan 104: Refresh coordinator state
    /** Promise for the currently in-flight refresh (singleflight) */
    private inFlightRefresh?: Promise<RefreshResult>;
    /** Timestamp of last failed refresh attempt (for throttling) */
    private lastRefreshFailureAt?: number;

    constructor(
        private readonly secretStorage: vscode.SecretStorage,
        private readonly authClient: IAuthClient,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        // Register URI handler for OAuth callback
        this.disposables.push(
            vscode.window.registerUriHandler({
                handleUri: this.handleUri.bind(this),
            })
        );
    }

    /**
     * Check if the user is currently authenticated.
     * 
     * ⚠️ WARNING: This method has side effects (calls logout on expiry).
     * For side-effect-free state queries, use getAuthState() instead.
     * 
     * @deprecated Use getAuthState() for readiness checks (Plan 104).
     */
    async isAuthenticated(): Promise<boolean> {
        const token = await this.getSessionToken();
        if (!token) {
            return false;
        }

        // Check if session has expired
        const expiresAt = await this.secretStorage.get(SECRET_KEYS.SESSION_EXPIRES_AT);
        if (expiresAt) {
            const expiryDate = new Date(expiresAt);
            if (expiryDate <= new Date()) {
                this.log('Session expired, clearing credentials');
                await this.logout();
                return false;
            }
        }

        return true;
    }

    // =========================================================================
    // Plan 104: Side-Effect-Free Auth State Query
    // =========================================================================

    /**
     * Get the current auth state WITHOUT any side effects.
     * 
     * This method is safe to call from readiness polling - it will NEVER:
     * - Clear secrets
     * - Log the user out
     * - Trigger a refresh attempt
     * 
     * @returns AuthStateInfo with state and metadata
     * @see Plan 104 Milestone 1
     */
    async getAuthState(): Promise<AuthStateInfo> {
        // Defensive check for test environments where secretStorage may be undefined
        if (!this.secretStorage) {
            return {
                state: 'logged_out',
                refreshTokenPresent: false,
            };
        }

        const refreshToken = await this.secretStorage.get(SECRET_KEYS.REFRESH_TOKEN);
        const sessionToken = await this.secretStorage.get(SECRET_KEYS.SESSION_TOKEN);
        const expiresAtStr = await this.secretStorage.get(SECRET_KEYS.SESSION_EXPIRES_AT);
        const hasRefreshToken = !!refreshToken;

        // Check if refresh is in progress
        if (this.inFlightRefresh) {
            return {
                state: 'refresh_in_progress',
                refreshTokenPresent: hasRefreshToken,
                expiresAt: expiresAtStr,
            };
        }

        // No session token at all
        if (!sessionToken || !expiresAtStr) {
            // Have refresh token = can refresh to get new session
            if (hasRefreshToken) {
                return {
                    state: 'expired_refreshable',
                    refreshTokenPresent: true,
                };
            }
            // No tokens at all = logged out
            return {
                state: 'logged_out',
                refreshTokenPresent: false,
            };
        }

        // Have session token - check if expired
        const expiryDate = new Date(expiresAtStr);
        const now = new Date();
        const remainingTtlMs = expiryDate.getTime() - now.getTime();

        // Already expired or within near-expiry window
        if (remainingTtlMs <= NEAR_EXPIRY_THRESHOLD_MS) {
            // Can refresh if we have refresh token
            if (hasRefreshToken) {
                return {
                    state: 'expired_refreshable',
                    refreshTokenPresent: true,
                    remainingTtlMs: Math.max(0, remainingTtlMs),
                    expiresAt: expiresAtStr,
                };
            }
            // Expired and can't refresh = need login
            return {
                state: 'login_required',
                refreshTokenPresent: false,
                remainingTtlMs: Math.max(0, remainingTtlMs),
                expiresAt: expiresAtStr,
            };
        }

        // Valid session (not expired, not near expiry)
        return {
            state: 'valid',
            refreshTokenPresent: hasRefreshToken,
            remainingTtlMs,
            expiresAt: expiresAtStr,
        };
    }

    // =========================================================================
    // Plan 104: Refresh Coordinator (Singleflight + Throttling)
    // =========================================================================

    /**
     * Request a session refresh via the coordinator.
     * 
     * This method enforces:
     * - Singleflight: Only one refresh attempt at a time
     * - Throttling: Minimum interval between failed attempts
     * 
     * @returns RefreshResult indicating success/failure/throttled
     * @see Plan 104 Milestone 2
     */
    async requestRefresh(): Promise<RefreshResult> {
        // If already refreshing, return the existing promise (singleflight)
        if (this.inFlightRefresh) {
            this.log('Refresh already in progress, joining existing request (singleflight)');
            return this.inFlightRefresh;
        }

        // Check throttling
        if (this.lastRefreshFailureAt) {
            const timeSinceFailure = Date.now() - this.lastRefreshFailureAt;
            if (timeSinceFailure < REFRESH_THROTTLE_INTERVAL_MS) {
                this.log(`Refresh throttled: ${Math.round((REFRESH_THROTTLE_INTERVAL_MS - timeSinceFailure) / 1000)}s until next attempt`);
                return { success: false, throttled: true };
            }
        }

        // Start the refresh
        this.inFlightRefresh = this.executeRefresh();

        try {
            return await this.inFlightRefresh;
        } finally {
            this.inFlightRefresh = undefined;
        }
    }

    /**
     * Execute the actual refresh operation.
     * This is called by requestRefresh() and handles the network call.
     */
    private async executeRefresh(): Promise<RefreshResult> {
        const refreshToken = await this.secretStorage.get(SECRET_KEYS.REFRESH_TOKEN);
        if (!refreshToken) {
            this.log('No refresh token available for refresh');
            return { success: false, error: new Error('No refresh token') };
        }

        this.isRefreshing = true;
        this.log('Executing session refresh via coordinator');

        try {
            const response = await this.authClient.refreshSession(refreshToken);

            // Plan 098: Fail closed if response is not extension variant
            if (!isExtensionRefreshResponse(response)) {
                this.log('FAIL CLOSED: Received web refresh response instead of extension response.');
                await this.logout();
                return { success: false, error: new Error('Invalid response format') };
            }

            await this.storeExtensionSession(response);
            this.log('Session refreshed successfully via coordinator');
            this._onDidChangeAuthState.fire({ isAuthenticated: true, tier: response.tier });

            // Clear failure timestamp on success
            this.lastRefreshFailureAt = undefined;

            return { success: true };
        } catch (error) {
            this.log(`Session refresh failed: ${error}`);
            this.lastRefreshFailureAt = Date.now();

            // Check if refresh token is invalid (non-recoverable)
            const isInvalidRefresh = error instanceof FlowbabyCloudError && error.code === 'INVALID_REFRESH';
            const errorWithCode = error as { code?: string };
            const isInvalidRefreshCode = errorWithCode.code === 'INVALID_REFRESH';

            if (isInvalidRefresh || isInvalidRefreshCode) {
                this.log('Refresh token is invalid, clearing stored credentials (fail-closed)');
                await this.logout();
                return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
            }

            // Transient error - do NOT clear secrets
            return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
        } finally {
            this.isRefreshing = false;
        }
    }

    // =========================================================================
    // Plan 104: Bounded Activation-Time Refresh
    // =========================================================================

    /**
     * Attempt activation-time refresh with a strict time budget.
     * 
     * This method is designed to be called during extension activation to:
     * - Restore refresh scheduling for existing sessions
     * - Attempt refresh if session is expired or near-expiry
     * - Never block activation beyond the time budget
     * 
     * @returns ActivationRefreshResult with attempt outcome
     * @see Plan 104 Milestone 3
     */
    async activationRefresh(): Promise<ActivationRefreshResult> {
        const authState = await this.getAuthState();

        // No-op if logged out
        if (authState.state === 'logged_out') {
            return { attempted: false, reason: 'User is logged out' };
        }

        // If session is valid, just ensure refresh is scheduled
        if (authState.state === 'valid') {
            // Defensive check for test environments where secretStorage may be undefined
            if (this.secretStorage) {
                const expiresAt = await this.secretStorage.get(SECRET_KEYS.SESSION_EXPIRES_AT);
                if (expiresAt) {
                    this.scheduleRefresh(expiresAt);
                }
            }
            return { attempted: false, reason: 'Session is valid, scheduled refresh' };
        }

        // If already refreshing, don't start another
        if (authState.state === 'refresh_in_progress') {
            return { attempted: false, reason: 'Refresh already in progress' };
        }

        // If login_required (no refresh token), nothing to do
        if (authState.state === 'login_required') {
            return { attempted: false, reason: 'No refresh token available' };
        }

        // Session is expired_refreshable - attempt bounded refresh
        this.log(`Activation refresh: session ${authState.remainingTtlMs !== undefined ? `expires in ${Math.round(authState.remainingTtlMs / 1000)}s` : 'is expired'}`);

        // Create a promise that resolves after the timeout
        const timeoutPromise = new Promise<RefreshResult>(resolve => {
            setTimeout(() => {
                resolve({ success: false, error: new Error('Timeout') });
            }, ACTIVATION_REFRESH_BUDGET_MS);
        });

        // Race the refresh against the timeout
        const refreshPromise = this.requestRefresh();
        const result = await Promise.race([refreshPromise, timeoutPromise]);

        if (result.error?.message === 'Timeout') {
            this.log('Activation refresh timed out (2s budget exceeded), continuing activation');
            return {
                attempted: true,
                success: false,
                timedOut: true,
                secretsCleared: false,
            };
        }

        return {
            attempted: true,
            success: result.success,
            timedOut: false,
            secretsCleared: !result.success && !(await this.secretStorage.get(SECRET_KEYS.REFRESH_TOKEN)),
        };
    }

    /**
     * Get information about the current refresh schedule.
     * 
     * @returns RefreshScheduleInfo with schedule details
     * @see Plan 104 Milestone 4
     */
    getRefreshScheduleInfo(): RefreshScheduleInfo {
        if (!this.refreshTimer) {
            return { scheduled: false };
        }

        // Note: We can't easily get the remaining time from a setTimeout,
        // so we return scheduled: true but no exact time.
        // The actual scheduling logic uses stored expiresAt.
        return { scheduled: true };
    }

    /**
     * Get the stored session token.
     */
    async getSessionToken(): Promise<string | undefined> {
        return this.secretStorage.get(SECRET_KEYS.SESSION_TOKEN);
    }

    /**
     * Get the user's subscription tier (if authenticated).
     */
    async getUserTier(): Promise<string | undefined> {
        return this.secretStorage.get(SECRET_KEYS.USER_TIER);
    }

    /**
     * Initiate the OAuth login flow.
     *
     * Opens the browser to the GitHub OAuth authorization URL.
     * Returns when the OAuth flow completes successfully.
     *
     * @throws FlowbabyCloudError if the OAuth flow fails
     * @throws UnsupportedUriSchemeError if running in an unsupported editor (Plan 106)
     */
    async login(): Promise<void> {
        // Plan 106: Get dynamic callback URI based on current editor variant
        // This will throw UnsupportedUriSchemeError for non-allowlisted editors
        let callbackUri: string;
        try {
            callbackUri = getOAuthCallbackUri();
        } catch (error) {
            if (error instanceof UnsupportedUriSchemeError) {
                this.log(`OAuth login blocked: ${error.message}`);
                // Re-throw with user-facing error for UI handling
                throw error;
            }
            throw error;
        }

        // Plan 106: Verify callback URI authority matches extension ID from activation context
        const { getActiveExtensionId } = require('../lifecycle/registrationHelper');
        const extensionId = getActiveExtensionId();
        if (!extensionId) {
            throw new FlowbabyCloudError(
                'NOT_AUTHENTICATED',
                'Could not determine extension identifier. Ensure the extension is properly installed.'
            );
        }

        // Plan 106: Validate callback URI authority (scheme is now dynamic)
        const url = new URL(callbackUri);
        if (url.host.toLowerCase() !== extensionId.toLowerCase()) {
            this.log(`Warning: OAuth callback URI authority mismatch. Expected: ${extensionId}, Got: ${url.host}`);
        }

        this.log(`Starting OAuth login flow (scheme: ${vscode.env.uriScheme})`);

        // Build the OAuth authorization URL
        const authUrl = new URL(`${FLOWBABY_CLOUD_CONFIG.baseUrl}/auth/login`);
        authUrl.searchParams.set('redirect_uri', callbackUri);

        // Open browser for OAuth
        this.log(`Opening OAuth URL: ${authUrl.toString()}`);
        await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

        // Wait for the OAuth callback
        const code = await this.waitForOAuthCallback();

        // Exchange code for session token
        this.log('Exchanging OAuth code for session token');
        try {
            const response = await this.authClient.exchangeOAuthCode(code);
            
            // Plan 098: Fail closed if response is not extension variant
            if (!isExtensionAuthResponse(response)) {
                this.log('FAIL CLOSED: Received web auth response instead of extension response. Forcing logout.');
                await this.logout();
                throw new FlowbabyCloudError(
                    'UNEXPECTED_RESPONSE',
                    'Server returned an incompatible response format. Please try logging in again.'
                );
            }
            
            await this.storeExtensionSession(response);
            this.log('Login successful');
            this._onDidChangeAuthState.fire({ isAuthenticated: true, tier: response.tier });
        } catch (error) {
            this.log(`Login failed: ${error}`);
            throw error;
        }
    }

    /**
     * Log out the current user.
     *
     * Clears all stored credentials and session data.
     */
    async logout(): Promise<void> {
        this.log('Logging out');

        // Cancel any pending refresh
        this.cancelRefreshTimer();

        await Promise.all([
            this.secretStorage.delete(SECRET_KEYS.SESSION_TOKEN),
            this.secretStorage.delete(SECRET_KEYS.SESSION_EXPIRES_AT),
            this.secretStorage.delete(SECRET_KEYS.USER_TIER),
            this.secretStorage.delete(SECRET_KEYS.REFRESH_TOKEN),
            this.secretStorage.delete(SECRET_KEYS.GITHUB_ID),
        ]);

        this._onDidChangeAuthState.fire({ isAuthenticated: false });
        this.log('Logged out successfully');
    }

    /**
     * Handle URI callback from OAuth flow.
     *
     * @internal Called by VS Code URI handler
     */
    private handleUri(uri: vscode.Uri): void {
        this.log(`Received URI callback: ${uri.path}`);

        if (uri.path !== '/auth/callback') {
            this.log(`Ignoring unrecognized callback path: ${uri.path}`);
            return;
        }

        const params = new URLSearchParams(uri.query);
        const code = params.get('code');
        const error = params.get('error');

        if (error) {
            const errorMessage = params.get('error_description') || error;
            this.log(`OAuth error: ${errorMessage}`);
            if (this.pendingOAuthReject) {
                this.pendingOAuthReject(new FlowbabyCloudError('NOT_AUTHENTICATED', `OAuth failed: ${errorMessage}`));
                this.clearPendingOAuth();
            }
            return;
        }

        if (!code) {
            this.log('OAuth callback missing code parameter');
            if (this.pendingOAuthReject) {
                this.pendingOAuthReject(new FlowbabyCloudError('UNEXPECTED_RESPONSE', 'OAuth callback missing authorization code'));
                this.clearPendingOAuth();
            }
            return;
        }

        if (this.pendingOAuthResolve) {
            this.pendingOAuthResolve(code);
            this.clearPendingOAuth();
        } else {
            this.log('Received OAuth callback but no pending login');
        }
    }

    /**
     * Wait for the OAuth callback with a timeout.
     */
    private waitForOAuthCallback(): Promise<string> {
        return new Promise((resolve, reject) => {
            this.pendingOAuthResolve = resolve;
            this.pendingOAuthReject = reject;

            // Timeout after 5 minutes
            const timeout = setTimeout(() => {
                if (this.pendingOAuthReject) {
                    this.pendingOAuthReject(new FlowbabyCloudError('NOT_AUTHENTICATED', 'OAuth login timed out'));
                    this.clearPendingOAuth();
                }
            }, 5 * 60 * 1000);

            // Store timeout reference for cleanup
            const cleanup = () => clearTimeout(timeout);
            this.disposables.push({ dispose: cleanup });
        });
    }

    /**
     * Clear pending OAuth state.
     */
    private clearPendingOAuth(): void {
        this.pendingOAuthResolve = undefined;
        this.pendingOAuthReject = undefined;
    }

    /**
     * Store extension session data securely.
     * Plan 098: Takes ExtensionAuthResponse or ExtensionRefreshResponse, both guaranteed to have refreshToken.
     */
    private async storeExtensionSession(response: ExtensionAuthResponse | ExtensionRefreshResponse): Promise<void> {
        await Promise.all([
            this.secretStorage.store(SECRET_KEYS.SESSION_TOKEN, response.sessionToken),
            this.secretStorage.store(SECRET_KEYS.SESSION_EXPIRES_AT, response.expiresAt),
            this.secretStorage.store(SECRET_KEYS.USER_TIER, response.tier),
            this.secretStorage.store(SECRET_KEYS.REFRESH_TOKEN, response.refreshToken),
            this.secretStorage.store(SECRET_KEYS.GITHUB_ID, response.githubId),
        ]);

        // Schedule proactive refresh
        this.scheduleRefresh(response.expiresAt);
    }

    /**
     * Schedule a proactive session refresh before the session expires.
     *
     * Uses SESSION_REFRESH configuration to determine when to refresh:
     * - Refreshes when less than REFRESH_THRESHOLD_FRACTION of TTL remains
     * - Has a MIN_REFRESH_SECONDS safety floor
     */
    private scheduleRefresh(expiresAt: string): void {
        this.cancelRefreshTimer();

        const expiryDate = new Date(expiresAt);
        const now = new Date();
        const totalTtlMs = expiryDate.getTime() - now.getTime();

        if (totalTtlMs <= 0) {
            this.log('Session already expired, not scheduling refresh');
            return;
        }

        // Calculate refresh time: when REFRESH_THRESHOLD_FRACTION of TTL remains
        const thresholdMs = totalTtlMs * SESSION_REFRESH.REFRESH_THRESHOLD_FRACTION;
        const minRefreshMs = SESSION_REFRESH.MIN_REFRESH_SECONDS * 1000;

        // Use the larger of threshold-based time or minimum time before expiry
        const refreshBeforeExpiryMs = Math.max(thresholdMs, minRefreshMs);
        const refreshInMs = Math.max(totalTtlMs - refreshBeforeExpiryMs, SESSION_REFRESH.INITIAL_CHECK_DELAY_SECONDS * 1000);

        this.log(`Session expires in ${Math.round(totalTtlMs / 1000 / 60)} minutes, scheduling refresh in ${Math.round(refreshInMs / 1000 / 60)} minutes`);

        this.refreshTimer = setTimeout(() => {
            void this.tryRefreshSession();
        }, refreshInMs);
    }

    /**
     * Cancel any pending refresh timer.
     */
    private cancelRefreshTimer(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }

    /**
     * Attempt to refresh the session using the stored refresh token.
     *
     * This is called proactively before session expiry. If refresh fails
     * due to an invalid refresh token, the user will need to re-authenticate.
     *
     * @returns true if refresh succeeded, false otherwise
     */
    async tryRefreshSession(): Promise<boolean> {
        if (this.isRefreshing) {
            this.log('Refresh already in progress, skipping');
            return false;
        }

        const refreshToken = await this.secretStorage.get(SECRET_KEYS.REFRESH_TOKEN);
        if (!refreshToken) {
            this.log('No refresh token available, cannot refresh session');
            return false;
        }

        this.isRefreshing = true;
        this.log('Attempting to refresh session');

        try {
            const response = await this.authClient.refreshSession(refreshToken);
            
            // Plan 098: Fail closed if response is not extension variant
            if (!isExtensionRefreshResponse(response)) {
                this.log('FAIL CLOSED: Received web refresh response instead of extension response. Forcing logout.');
                await this.logout();
                return false;
            }
            
            await this.storeExtensionSession(response);
            this.log('Session refreshed successfully');
            this._onDidChangeAuthState.fire({ isAuthenticated: true, tier: response.tier });
            return true;
        } catch (error) {
            this.log(`Session refresh failed: ${error}`);

            // If the refresh token is invalid, clear it so we don't keep trying
            if (error instanceof FlowbabyCloudError && error.code === 'INVALID_REFRESH') {
                this.log('Refresh token is invalid, clearing stored credentials');
                await this.logout();
            }

            return false;
        } finally {
            this.isRefreshing = false;
        }
    }

    /**
     * Get the stored refresh token (for testing/debugging only).
     * @internal
     */
    async getRefreshToken(): Promise<string | undefined> {
        return this.secretStorage.get(SECRET_KEYS.REFRESH_TOKEN);
    }

    /**
     * Check if session needs refresh and attempt it if so.
     * Call this on extension activation to handle sessions that may have
     * expired or be close to expiry while VS Code was closed.
     * 
     * Plan 104: Updated to use actual stored expiry instead of hardcoded 24h TTL.
     * Uses NEAR_EXPIRY_THRESHOLD_MS (2 minutes) as the threshold for "near expiry".
     */
    async checkAndRefreshIfNeeded(): Promise<void> {
        const expiresAt = await this.secretStorage.get(SECRET_KEYS.SESSION_EXPIRES_AT);
        if (!expiresAt) {
            return;
        }

        const refreshToken = await this.secretStorage.get(SECRET_KEYS.REFRESH_TOKEN);
        if (!refreshToken) {
            this.log('No refresh token available, skipping activation refresh check');
            return;
        }

        const expiryDate = new Date(expiresAt);
        const now = new Date();
        const remainingMs = expiryDate.getTime() - now.getTime();

        // If already expired or within near-expiry window, try to refresh
        if (remainingMs <= NEAR_EXPIRY_THRESHOLD_MS) {
            this.log(`Session ${remainingMs <= 0 ? 'has expired' : `expires in ${Math.round(remainingMs / 1000)}s (near expiry)`}, attempting refresh`);
            const result = await this.requestRefresh();
            if (!result.success && !result.throttled) {
                this.log('Could not refresh session, user may need to re-authenticate');
            }
            return;
        }

        // Session is still valid - schedule refresh for later
        this.scheduleRefresh(expiresAt);
    }

    /**
     * Log a message to the output channel.
     */
    private log(message: string): void {
        this.outputChannel.appendLine(`[FlowbabyCloudAuth] ${message}`);
    }

    dispose(): void {
        this.cancelRefreshTimer();
        this._onDidChangeAuthState.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

/**
 * Create the authentication manager with real client.
 */
export function createFlowbabyCloudAuth(
    secretStorage: vscode.SecretStorage,
    outputChannel: vscode.OutputChannel
): FlowbabyCloudAuth {
    const client = new FlowbabyCloudClient();
    const authClient = new AuthClientAdapter(client);
    return new FlowbabyCloudAuth(secretStorage, authClient, outputChannel);
}
