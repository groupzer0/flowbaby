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
import { FlowbabyCloudError, SECRET_KEYS, OAUTH_CALLBACK_URI, FLOWBABY_CLOUD_CONFIG } from './types';
import { FlowbabyCloudClient } from './client';

/**
 * Interface for auth client operations.
 * Allows for mock injection in tests.
 */
export interface IAuthClient {
    /**
     * Exchange an OAuth authorization code for a session token.
     */
    exchangeOAuthCode(code: string): Promise<AuthResponse>;
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
            ...mockResponse,
        };
    }

    async exchangeOAuthCode(_code: string): Promise<AuthResponse> {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 100));
        return this.mockResponse;
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

        await Promise.all([
            this.secretStorage.delete(SECRET_KEYS.SESSION_TOKEN),
            this.secretStorage.delete(SECRET_KEYS.SESSION_EXPIRES_AT),
            this.secretStorage.delete(SECRET_KEYS.USER_TIER),
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
        ]);
    }

    /**
     * Log a message to the output channel.
     */
    private log(message: string): void {
        this.outputChannel.appendLine(`[FlowbabyCloudAuth] ${message}`);
    }

    dispose(): void {
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
