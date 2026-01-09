/**
 * Flowbaby Cloud HTTP Client
 *
 * Type-safe HTTP client for the Flowbaby Cloud backend API.
 * Handles request/response serialization, error parsing, and retry logic.
 *
 * @see api-contract/types.ts for request/response shapes
 * @see api-contract/endpoints.md for endpoint documentation
 */

import * as vscode from 'vscode';
import {
    AuthRequest,
    AuthResponse,
    RefreshRequest,
    VendRequest,
    VendResponse,
    ConsumeRequest,
    ConsumeResponse,
    ApiError,
    ErrorCode,
    FlowbabyCloudError,
    FlowbabyCloudConfig,
    DEFAULT_CONFIG,
    getApiBaseUrl,
} from './types';

/**
 * Singleton output channel for Cloud client operations.
 * Lazily initialized to avoid creating channel if never used.
 */
let cloudClientOutputChannel: vscode.OutputChannel | undefined;

/**
 * Debug logger for Cloud client operations.
 *
 * Plan 087: Captures HTTP status code and Cloud error code/message for diagnosability.
 * NEVER logs secrets (Authorization headers, tokens, AWS keys).
 */
function createDebugLogger(name: string): (msg: string) => void {
    return (msg: string) => {
        // Only log when debug mode is enabled
        const config = vscode.workspace.getConfiguration('flowbaby');
        const debug = config.get<boolean>('debug', false);
        if (debug) {
            // Lazily create singleton output channel
            if (!cloudClientOutputChannel) {
                cloudClientOutputChannel = vscode.window.createOutputChannel('Flowbaby Cloud Debug', { log: true });
            }
            cloudClientOutputChannel.appendLine(`[${name}] ${msg}`);
        }
    };
}

/**
 * HTTP client for Flowbaby Cloud API.
 *
 * Design notes:
 * - All methods are async and return typed responses
 * - Errors are thrown as FlowbabyCloudError instances
 * - Retry logic handles transient network failures
 * - Secrets are NEVER logged (strict redaction)
 */
export class FlowbabyCloudClient {
    private readonly config: FlowbabyCloudConfig;
    private readonly log: (msg: string) => void;

    constructor(config: Partial<FlowbabyCloudConfig> = {}) {
        this.config = {
            ...DEFAULT_CONFIG,
            apiBaseUrl: getApiBaseUrl(),
            ...config,
        };
        this.log = createDebugLogger('FlowbabyCloudClient');
    }

    // =========================================================================
    // Auth Endpoints
    // =========================================================================

    /**
     * Exchange a Flowbaby one-time exchange code for a session token.
     *
     * NOTE: The `code` in AuthRequest is the Flowbaby exchange code issued by
     * the backend after GitHub OAuth, NOT the GitHub authorization code directly.
     *
     * @param request - The auth request containing the exchange code
     * @returns The auth response with session token, refresh token, and user info
     * @throws FlowbabyCloudError on API errors or network failures
     */
    async exchangeOAuthCode(request: AuthRequest): Promise<AuthResponse> {
        return this.post<AuthRequest, AuthResponse>('/auth/github', request);
    }

    /**
     * Refresh a session using a refresh token.
     *
     * Refresh tokens are single-use and rotated on each successful refresh.
     * After calling this method, the old refresh token is invalidated and
     * the new one from the response must be stored.
     *
     * @param refreshToken - The refresh token from a previous AuthResponse
     * @returns New AuthResponse with new session token and new refresh token
     * @throws FlowbabyCloudError with code INVALID_REFRESH if token is invalid/expired/used
     */
    async refreshSession(refreshToken: string): Promise<AuthResponse> {
        const request: RefreshRequest = { refreshToken };
        return this.post<RefreshRequest, AuthResponse>('/auth/refresh', request);
    }

    // =========================================================================
    // Vend Endpoints
    // =========================================================================

    /**
     * Request temporary AWS STS credentials for Bedrock access.
     *
     * @param sessionToken - The Flowbaby session token (from login)
     * @param request - Optional request body with operation type
     * @returns The vend response with AWS credentials
     * @throws FlowbabyCloudError on API errors or network failures
     */
    async vendCredentials(sessionToken: string, request: VendRequest = {}): Promise<VendResponse> {
        return this.post<VendRequest, VendResponse>('/vend/credentials', request, sessionToken);
    }

    // =========================================================================
    // Usage Endpoints (Plan 090)
    // =========================================================================

    /**
     * Consume credits for a completed Bedrock operation.
     *
     * Plan 090: This endpoint is called AFTER a successful Bedrock operation
     * to charge credits. The idempotency key ensures at-most-once charging
     * even if the call is retried.
     *
     * IMPORTANT: This is fire-and-forget from the caller's perspective.
     * Failures should be logged but MUST NOT block user operations.
     *
     * @param sessionToken - The Flowbaby session token (from login)
     * @param operationType - The type of operation ('embed' or 'retrieve')
     * @param idempotencyKey - UUID to ensure at-most-once charging; MUST be stable per operation
     * @returns The consume response with credit usage info
     * @throws FlowbabyCloudError on API errors or network failures
     */
    async consume(
        sessionToken: string,
        operationType: 'embed' | 'retrieve',
        idempotencyKey: string
    ): Promise<ConsumeResponse> {
        const request: ConsumeRequest = { operationType };
        return this.postWithIdempotencyKey<ConsumeRequest, ConsumeResponse>(
            '/usage/consume',
            request,
            sessionToken,
            idempotencyKey
        );
    }

    // =========================================================================
    // HTTP Helpers
    // =========================================================================

    /**
     * Make a POST request to the API.
     *
     * @param path - API endpoint path (e.g., '/auth/github')
     * @param body - Request body
     * @param sessionToken - Optional session token for authenticated requests
     * @returns Parsed response body
     * @throws FlowbabyCloudError on errors
     */
    private async post<TRequest, TResponse>(
        path: string,
        body: TRequest,
        sessionToken?: string
    ): Promise<TResponse> {
        const url = `${this.config.apiBaseUrl}${path}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };

        if (sessionToken) {
            headers['Authorization'] = `Bearer ${sessionToken}`;
        }

        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            try {
                const response = await this.fetchWithTimeout(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                });

                // Parse response body
                const responseText = await response.text();
                let responseData: unknown;
                try {
                    responseData = responseText ? JSON.parse(responseText) : {};
                } catch {
                    throw new FlowbabyCloudError(
                        'UNEXPECTED_RESPONSE',
                        `Failed to parse response from ${path}`
                    );
                }

                // Check for error response
                if (!response.ok) {
                    const apiError = this.parseApiError(responseData, response.status);
                    // Plan 087: Debug log HTTP status and error code (never secrets)
                    this.log(`API error: HTTP ${response.status}, code=${apiError.code}, message="${apiError.message}"${apiError.retryAfter ? `, retryAfter=${apiError.retryAfter}` : ''}`);
                    throw FlowbabyCloudError.fromApiError(apiError);
                }

                // Validate response shape (basic check)
                if (typeof responseData !== 'object' || responseData === null) {
                    throw new FlowbabyCloudError(
                        'UNEXPECTED_RESPONSE',
                        `Unexpected response shape from ${path}`
                    );
                }

                return responseData as TResponse;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                // Don't retry on non-retryable errors
                if (error instanceof FlowbabyCloudError) {
                    if (!this.isRetryableError(error.code)) {
                        throw error;
                    }
                }

                // Wait before retrying (exponential backoff)
                if (attempt < this.config.maxRetries) {
                    const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000);
                    await this.delay(delayMs);
                }
            }
        }

        // All retries exhausted
        if (lastError instanceof FlowbabyCloudError) {
            this.log(`Request to ${path} failed after ${this.config.maxRetries + 1} attempts: code=${lastError.code}`);
            throw lastError;
        }
        const networkError = new FlowbabyCloudError('NETWORK_ERROR', lastError?.message || 'Request failed after retries');
        this.log(`Network error on ${path}: ${networkError.message}`);
        throw networkError;
    }

    /**
     * Make a POST request with an idempotency key header.
     *
     * Plan 090: Used for consume endpoint to ensure at-most-once charging.
     * The idempotency key is passed via X-Idempotency-Key header.
     *
     * SECURITY: Idempotency keys MUST NOT be logged at INFO/WARN/ERROR levels.
     * They may only appear in DEBUG logs when flowbaby.debug is enabled.
     *
     * @param path - API endpoint path
     * @param body - Request body
     * @param sessionToken - Session token for authentication
     * @param idempotencyKey - UUID for at-most-once semantics
     * @returns Parsed response body
     * @throws FlowbabyCloudError on errors
     */
    private async postWithIdempotencyKey<TRequest, TResponse>(
        path: string,
        body: TRequest,
        sessionToken: string,
        idempotencyKey: string
    ): Promise<TResponse> {
        const url = `${this.config.apiBaseUrl}${path}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${sessionToken}`,
            'X-Idempotency-Key': idempotencyKey,
        };

        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            try {
                const response = await this.fetchWithTimeout(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                });

                // Parse response body
                const responseText = await response.text();
                let responseData: unknown;
                try {
                    responseData = responseText ? JSON.parse(responseText) : {};
                } catch {
                    throw new FlowbabyCloudError(
                        'UNEXPECTED_RESPONSE',
                        `Failed to parse response from ${path}`
                    );
                }

                // Check for error response
                if (!response.ok) {
                    const apiError = this.parseApiError(responseData, response.status);
                    // Plan 090: Log error without idempotency key (security)
                    this.log(`API error: HTTP ${response.status}, code=${apiError.code}, message="${apiError.message}"`);
                    throw FlowbabyCloudError.fromApiError(apiError);
                }

                // Validate response shape (basic check)
                if (typeof responseData !== 'object' || responseData === null) {
                    throw new FlowbabyCloudError(
                        'UNEXPECTED_RESPONSE',
                        `Unexpected response shape from ${path}`
                    );
                }

                return responseData as TResponse;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                // Don't retry on non-retryable errors
                if (error instanceof FlowbabyCloudError) {
                    if (!this.isRetryableError(error.code)) {
                        throw error;
                    }
                }

                // Wait before retrying (exponential backoff)
                if (attempt < this.config.maxRetries) {
                    const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000);
                    await this.delay(delayMs);
                }
            }
        }

        // All retries exhausted
        if (lastError instanceof FlowbabyCloudError) {
            this.log(`Request to ${path} failed after ${this.config.maxRetries + 1} attempts: code=${lastError.code}`);
            throw lastError;
        }
        const networkError = new FlowbabyCloudError('NETWORK_ERROR', lastError?.message || 'Request failed after retries');
        this.log(`Network error on ${path}: ${networkError.message}`);
        throw networkError;
    }

    /**
     * Fetch with timeout support.
     */
    private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });
            return response;
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new FlowbabyCloudError('NETWORK_ERROR', `Request timed out after ${this.config.timeoutMs}ms`);
            }
            throw new FlowbabyCloudError('NETWORK_ERROR', `Network error: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Parse an API error response into a typed ApiError.
     */
    private parseApiError(data: unknown, statusCode: number): ApiError {
        // Check if response matches ApiError shape
        if (
            typeof data === 'object' &&
            data !== null &&
            'error' in data &&
            'code' in data &&
            'message' in data
        ) {
            const errorData = data as { error: boolean; code: string; message: string; retryAfter?: number };
            if (errorData.error === true && this.isValidErrorCode(errorData.code)) {
                return {
                    error: true,
                    code: errorData.code as ErrorCode,
                    message: errorData.message,
                    retryAfter: errorData.retryAfter,
                };
            }
        }

        // Fallback for unexpected error shapes
        return {
            error: true,
            code: 'INTERNAL_ERROR',
            message: `Unexpected error (HTTP ${statusCode})`,
        };
    }

    /**
     * Check if an error code is valid per the contract.
     * Plan 090: Added INVALID_REQUEST for consume endpoint validation errors.
     */
    private isValidErrorCode(code: string): code is ErrorCode {
        const validCodes: ErrorCode[] = [
            'INVALID_CODE',
            'INVALID_REFRESH',
            'STATE_MISMATCH',
            'GITHUB_ERROR',
            'RATE_LIMITED',
            'SESSION_EXPIRED',
            'SESSION_INVALID',
            'QUOTA_EXCEEDED',
            'TIER_INVALID',
            'INTERNAL_ERROR',
            'INVALID_REQUEST',     // Plan 090: Consume endpoint validation errors
            'USER_NOT_FOUND',      // Contract v3.3.0
        ];
        return validCodes.includes(code as ErrorCode);
    }

    /**
     * Check if an error code is retryable.
     */
    private isRetryableError(code: string): boolean {
        // Only retry on transient errors
        return code === 'RATE_LIMITED' || code === 'NETWORK_ERROR' || code === 'INTERNAL_ERROR';
    }

    /**
     * Delay helper for retry backoff.
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Singleton client instance.
 * Use this for most operations to share connection state.
 */
let defaultClient: FlowbabyCloudClient | null = null;

/**
 * Get the default Flowbaby Cloud client instance.
 */
export function getCloudClient(): FlowbabyCloudClient {
    if (!defaultClient) {
        defaultClient = new FlowbabyCloudClient();
    }
    return defaultClient;
}

/**
 * Reset the default client (useful for testing).
 */
export function resetCloudClient(): void {
    defaultClient = null;
}
