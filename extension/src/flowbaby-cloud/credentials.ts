/**
 * Flowbaby Cloud Credential Vending Module
 *
 * Manages AWS STS credentials for Bedrock access.
 * Credentials are cached in memory (never persisted) with automatic refresh.
 *
 * Security notes:
 * - STS credentials are NEVER written to disk or SecretStorage
 * - Credentials are held only in memory during extension lifetime
 * - Proactive refresh before expiry prevents disruption
 *
 * @see Plan 077 M3 - Credential Vending Client
 */

import * as vscode from 'vscode';
import type { VendResponse, VendRequest } from './types';
import {
    CachedCredentials,
    FlowbabyCloudError,
    CREDENTIAL_REFRESH,
} from './types';
import { FlowbabyCloudClient } from './client';
import { FlowbabyCloudAuth } from './auth';

/**
 * Interface for credential client operations.
 * Allows for mock injection in tests.
 */
export interface ICredentialClient {
    /**
     * Vend temporary AWS credentials.
     * @param sessionToken - The Flowbaby session token
     * @param request - Optional request body with operation type and preferred region
     */
    vendCredentials(sessionToken: string, request?: VendRequest): Promise<VendResponse>;
}

/**
 * Mock credential client for testing without network calls.
 * Plan 086: Now includes backend-controlled model configuration fields.
 */
export class MockCredentialClient implements ICredentialClient {
    private mockResponse: VendResponse;
    private callCount = 0;

    constructor(mockResponse?: Partial<VendResponse>) {
        // Default to 1-hour expiry
        const expiration = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        this.mockResponse = {
            accessKeyId: 'MOCK_ACCESS_KEY_ID',
            secretAccessKey: 'MOCK_SECRET_ACCESS_KEY',
            sessionToken: 'MOCK_SESSION_TOKEN',
            region: 'us-east-1',
            expiration,
            // Plan 086: Backend-controlled model configuration
            llmModel: 'anthropic.claude-3-haiku-20240307-v1:0',
            embeddingModel: 'bedrock/amazon.titan-embed-text-v2:0',
            embeddingDimensions: 1024,
            ...mockResponse,
        };
    }

    async vendCredentials(_sessionToken: string, _request?: VendRequest): Promise<VendResponse> {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 100));
        this.callCount++;
        return this.mockResponse;
    }

    /**
     * Get how many times vendCredentials was called (for testing).
     */
    getCallCount(): number {
        return this.callCount;
    }

    /**
     * Reset call count (for testing).
     */
    resetCallCount(): void {
        this.callCount = 0;
    }
}

/**
 * Adapter that wraps FlowbabyCloudClient to implement ICredentialClient.
 */
class CredentialClientAdapter implements ICredentialClient {
    constructor(private readonly client: FlowbabyCloudClient) {}

    async vendCredentials(sessionToken: string, request?: VendRequest): Promise<VendResponse> {
        return this.client.vendCredentials(sessionToken, request);
    }
}

/**
 * Credential refresh event data.
 */
export interface CredentialRefreshEvent {
    /** The new credentials */
    credentials: CachedCredentials;
    /** Whether this was a proactive refresh (vs initial fetch) */
    isRefresh: boolean;
}

/**
 * Credential expiry event data.
 */
export interface CredentialExpiryEvent {
    /** When the credentials expired */
    expiredAt: Date;
    /** Error that caused the expiry (if any) */
    error?: Error;
}

/**
 * Credential manager for Flowbaby Cloud.
 *
 * Handles credential vending, caching, and proactive refresh.
 * Credentials are held in memory only and never persisted.
 *
 * Plan 083: Single-flight guard ensures concurrent credential requests
 * from spawn, daemon, and background operations share the same in-flight
 * request to avoid backend concurrency limit errors.
 */
export class FlowbabyCloudCredentials implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly _onDidRefreshCredentials = new vscode.EventEmitter<CredentialRefreshEvent>();
    private readonly _onDidExpireCredentials = new vscode.EventEmitter<CredentialExpiryEvent>();

    /**
     * Event fired when credentials are refreshed.
     */
    public readonly onDidRefreshCredentials = this._onDidRefreshCredentials.event;

    /**
     * Event fired when credentials expire (e.g., due to refresh failure).
     */
    public readonly onDidExpireCredentials = this._onDidExpireCredentials.event;

    /** Cached credentials (in-memory only) */
    private cachedCredentials?: CachedCredentials;

    /** Timer for proactive refresh */
    private refreshTimer?: NodeJS.Timeout;

    /**
     * Plan 083: Single-flight guard for credential vending.
     * When multiple callers request credentials simultaneously (e.g., spawn + daemon
     * during activation), they all await this single promise instead of issuing
     * separate /vend/credentials calls that would hit the backend concurrency limit.
     */
    private inFlightRefresh?: Promise<CachedCredentials>;

    constructor(
        private readonly auth: FlowbabyCloudAuth,
        private readonly credentialClient: ICredentialClient,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        // Listen for auth state changes
        this.disposables.push(
            auth.onDidChangeAuthState(event => {
                if (!event.isAuthenticated) {
                    this.clearCredentials();
                }
            })
        );
    }

    /**
     * Get current cached credentials.
     * Returns undefined if no valid credentials are available.
     */
    getCachedCredentials(): CachedCredentials | undefined {
        if (!this.cachedCredentials) {
            return undefined;
        }

        // Check if expired
        if (this.cachedCredentials.expiresAt <= new Date()) {
            this.log('Cached credentials have expired');
            this.clearCredentials();
            return undefined;
        }

        return this.cachedCredentials;
    }

    /**
     * Check if valid credentials are currently cached.
     */
    hasValidCredentials(): boolean {
        return this.getCachedCredentials() !== undefined;
    }

    /**
     * Get the time until credentials expire (in milliseconds).
     * Returns undefined if no credentials are cached.
     */
    getTimeUntilExpiry(): number | undefined {
        const creds = this.getCachedCredentials();
        if (!creds) {
            return undefined;
        }
        return Math.max(0, creds.expiresAt.getTime() - Date.now());
    }

    /**
     * Ensure valid credentials are available.
     * Fetches new credentials if none are cached or if they're about to expire.
     *
     * @returns The current valid credentials
     * @throws FlowbabyCloudError if credentials cannot be obtained
     */
    async ensureCredentials(): Promise<CachedCredentials> {
        // Check if we have valid credentials that aren't about to expire
        const existingCreds = this.getCachedCredentials();
        if (existingCreds) {
            const timeUntilExpiry = this.getTimeUntilExpiry()!;
            const refreshThreshold = CREDENTIAL_REFRESH.REFRESH_BEFORE_EXPIRY_MINUTES * 60 * 1000;

            if (timeUntilExpiry > refreshThreshold) {
                return existingCreds;
            }

            this.log(`Credentials expiring soon (${Math.round(timeUntilExpiry / 1000)}s), refreshing`);
        }

        // Need to fetch new credentials
        return this.refreshCredentials();
    }

    /**
     * Force a credential refresh.
     *
     * Plan 083: Uses single-flight guard to ensure concurrent callers (spawn, daemon,
     * background operations) share the same in-flight request. This prevents hitting
     * backend concurrency limits during activation when multiple subsystems start
     * simultaneously.
     *
     * @returns The new credentials
     * @throws FlowbabyCloudError if refresh fails
     */
    async refreshCredentials(): Promise<CachedCredentials> {
        // Plan 083: Single-flight guard - if a refresh is already in progress,
        // return the same promise to all concurrent callers
        if (this.inFlightRefresh) {
            this.log('Credential refresh already in flight, awaiting existing request');
            return this.inFlightRefresh;
        }

        // Start the actual refresh and store the promise
        this.inFlightRefresh = this.doRefreshCredentials();

        try {
            return await this.inFlightRefresh;
        } finally {
            // Always clear the in-flight marker, whether success or failure
            this.inFlightRefresh = undefined;
        }
    }

    /**
     * Internal method that performs the actual credential refresh.
     * Called by refreshCredentials() which wraps it with single-flight guard.
     */
    private async doRefreshCredentials(): Promise<CachedCredentials> {
        // Ensure authenticated
        if (!(await this.auth.isAuthenticated())) {
            throw new FlowbabyCloudError('NOT_AUTHENTICATED', 'Must be logged in to vend credentials');
        }

        const sessionToken = await this.auth.getSessionToken();
        if (!sessionToken) {
            throw new FlowbabyCloudError('NOT_AUTHENTICATED', 'Session token not available');
        }

        // Read user's preferred region from settings (Plan 081)
        const config = vscode.workspace.getConfiguration('flowbaby.cloud');
        const preferredRegion = config.get<string>('preferredRegion');

        this.log(`Fetching new credentials (preferredRegion: ${preferredRegion || 'default'})`);

        try {
            // Pass preferredRegion to backend; backend validates and returns resolved region
            const request: VendRequest = {};
            if (preferredRegion) {
                request.preferredRegion = preferredRegion as VendRequest['preferredRegion'];
            }

            const response = await this.credentialClient.vendCredentials(sessionToken, request);

            // Plan 086: Map model configuration fields from VendResponse to CachedCredentials
            const credentials: CachedCredentials = {
                accessKeyId: response.accessKeyId,
                secretAccessKey: response.secretAccessKey,
                sessionToken: response.sessionToken,
                region: response.region,
                expiresAt: new Date(response.expiration),
                fetchedAt: new Date(),
                // Backend-controlled model configuration (Plan 086)
                llmModel: response.llmModel,
                embeddingModel: response.embeddingModel,
                embeddingDimensions: response.embeddingDimensions,
            };

            // Plan 086: Validate required model fields for Cloud-only mode
            // If missing, fail loudly with user-friendly message
            if (!response.llmModel || !response.embeddingModel || response.embeddingDimensions === undefined) {
                this.log('WARNING: Backend did not return model configuration fields. Cloud may need an update.');
                // Note: We continue with credentials since they're still usable for auth,
                // but the bridge will fail loudly when model config is missing.
            } else {
                this.log(`Model config: llm=${response.llmModel}, embedding=${response.embeddingModel}, dims=${response.embeddingDimensions}`);
            }

            this.cachedCredentials = credentials;
            this.scheduleRefresh(credentials);

            const isRefresh = this.refreshTimer !== undefined;
            this._onDidRefreshCredentials.fire({ credentials, isRefresh });

            this.log(`Credentials refreshed, expires at ${credentials.expiresAt.toISOString()}`);
            return credentials;
        } catch (error) {
            this.log(`Failed to refresh credentials: ${error}`);

            // If this was a refresh attempt and it failed, credentials are now invalid
            if (this.cachedCredentials) {
                this.clearCredentials();
                this._onDidExpireCredentials.fire({
                    expiredAt: new Date(),
                    error: error instanceof Error ? error : new Error(String(error)),
                });
            }

            throw error;
        }
    }

    /**
     * Clear cached credentials.
     */
    clearCredentials(): void {
        this.cachedCredentials = undefined;
        this.cancelScheduledRefresh();
        this.log('Credentials cleared');
    }

    /**
     * Schedule a proactive refresh before credentials expire.
     */
    private scheduleRefresh(credentials: CachedCredentials): void {
        this.cancelScheduledRefresh();

        const refreshThreshold = CREDENTIAL_REFRESH.REFRESH_BEFORE_EXPIRY_MINUTES * 60 * 1000;
        const timeUntilExpiry = credentials.expiresAt.getTime() - Date.now();
        const refreshDelay = Math.max(0, timeUntilExpiry - refreshThreshold);

        if (refreshDelay <= 0) {
            // Credentials will expire before our refresh threshold, don't schedule
            this.log('Credentials expire before refresh threshold, not scheduling refresh');
            return;
        }

        this.log(`Scheduling credential refresh in ${Math.round(refreshDelay / 1000)}s`);

        this.refreshTimer = setTimeout(async () => {
            try {
                await this.refreshCredentials();
            } catch (error) {
                this.log(`Scheduled refresh failed: ${error}`);
                // Event already fired in refreshCredentials
            }
        }, refreshDelay);
    }

    /**
     * Cancel any scheduled refresh.
     */
    private cancelScheduledRefresh(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }

    /**
     * Log a message to the output channel.
     */
    private log(message: string): void {
        this.outputChannel.appendLine(`[FlowbabyCloudCredentials] ${message}`);
    }

    dispose(): void {
        this._onDidRefreshCredentials.dispose();
        this._onDidExpireCredentials.dispose();
        this.cancelScheduledRefresh();
        this.clearCredentials();
        this.disposables.forEach(d => d.dispose());
    }
}

/**
 * Create the credential manager with real client.
 */
export function createFlowbabyCloudCredentials(
    auth: FlowbabyCloudAuth,
    outputChannel: vscode.OutputChannel
): FlowbabyCloudCredentials {
    const client = new FlowbabyCloudClient();
    const credentialClient = new CredentialClientAdapter(client);
    return new FlowbabyCloudCredentials(auth, credentialClient, outputChannel);
}
