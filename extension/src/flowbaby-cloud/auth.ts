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
 * @see Plan 077 M2 - Authentication Module
 */

import * as vscode from 'vscode';
import type { AuthResponse } from './types';
import { FlowbabyCloudError, SECRET_KEYS, OAUTH_CALLBACK_URI, FLOWBABY_CLOUD_CONFIG, SESSION_REFRESH } from './types';
import { FlowbabyCloudClient } from './client';

/**
 * Interface for auth client operations.
 * Allows for mock injection in tests.
 */
export interface IAuthClient {
    /**
     * Exchange a Flowbaby one-time exchange code for session and refresh tokens.
     */
    exchangeOAuthCode(code: string): Promise<AuthResponse>;

    /**
     * Refresh a session using a refresh token.
     * Returns new session token and new refresh token (rotation).
     */
    refreshSession(refreshToken: string): Promise<AuthResponse>;
}

/**
 * Adapter that wraps FlowbabyCloudClient to implement IAuthClient.
 * Converts the string code to the AuthRequest format expected by the client.
 */
class AuthClientAdapter implements IAuthClient {
    constructor(private readonly client: FlowbabyCloudClient) {}

    async exchangeOAuthCode(code: string): Promise<AuthResponse> {
        return this.client.exchangeOAuthCode({ code });
    }

    async refreshSession(refreshToken: string): Promise<AuthResponse> {
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
 */
export class MockAuthClient implements IAuthClient {
    private mockResponse: AuthResponse;

    constructor(mockResponse?: Partial<AuthResponse>) {
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

    async refreshSession(_refreshToken: string): Promise<AuthResponse> {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 100));
        // Return new tokens (simulating rotation)
        return {
            ...this.mockResponse,
            sessionToken: 'mock-refreshed-session-' + Date.now(),
            refreshToken: 'mock-rotated-refresh-' + Date.now(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        };
    }
}

/**
 * Authentication manager for Flowbaby Cloud.
 *
 * Handles OAuth flow, token storage, and session state.
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
     */
    async login(): Promise<void> {
        // Verify callback URI matches extension ID
        const extensionId = vscode.extensions.getExtension('Flowbaby.flowbaby')?.id;
        if (!extensionId) {
            throw new FlowbabyCloudError(
                'NOT_AUTHENTICATED',
                'Could not determine extension identifier. Ensure the extension is properly installed.'
            );
        }

        // Validate callback URI matches expected format
        const expectedCallbackPrefix = `vscode://${extensionId}/auth/callback`;
        if (!OAUTH_CALLBACK_URI.toLowerCase().startsWith(`vscode://${extensionId.toLowerCase()}`)) {
            this.log(`Warning: OAuth callback URI may not match extension ID. Expected prefix: ${expectedCallbackPrefix}, Configured: ${OAUTH_CALLBACK_URI}`);
        }

        this.log('Starting OAuth login flow');

        // Build the OAuth authorization URL
        const authUrl = new URL(`${FLOWBABY_CLOUD_CONFIG.baseUrl}/auth/login`);
        authUrl.searchParams.set('redirect_uri', OAUTH_CALLBACK_URI);

        // Open browser for OAuth
        this.log(`Opening OAuth URL: ${authUrl.toString()}`);
        await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

        // Wait for the OAuth callback
        const code = await this.waitForOAuthCallback();

        // Exchange code for session token
        this.log('Exchanging OAuth code for session token');
        try {
            const response = await this.authClient.exchangeOAuthCode(code);
            await this.storeSession(response);
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
     * Store session data securely.
     */
    private async storeSession(response: AuthResponse): Promise<void> {
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
            await this.storeSession(response);
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
     */
    async checkAndRefreshIfNeeded(): Promise<void> {
        const expiresAt = await this.secretStorage.get(SECRET_KEYS.SESSION_EXPIRES_AT);
        if (!expiresAt) {
            return;
        }

        const expiryDate = new Date(expiresAt);
        const now = new Date();
        const remainingMs = expiryDate.getTime() - now.getTime();

        // If already expired, try to refresh
        if (remainingMs <= 0) {
            this.log('Session has expired, attempting refresh');
            const refreshed = await this.tryRefreshSession();
            if (!refreshed) {
                this.log('Could not refresh expired session, user will need to re-authenticate');
            }
            return;
        }

        // If close to expiry (within threshold), refresh proactively
        const totalTtlMs = 24 * 60 * 60 * 1000; // Assume 24h TTL for threshold calculation
        const thresholdMs = totalTtlMs * SESSION_REFRESH.REFRESH_THRESHOLD_FRACTION;
        if (remainingMs < thresholdMs) {
            this.log('Session close to expiry, refreshing proactively');
            await this.tryRefreshSession();
            return;
        }

        // Schedule refresh for later
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
