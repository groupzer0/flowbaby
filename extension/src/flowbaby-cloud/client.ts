/**
 * Flowbaby Cloud HTTP Client
 *
 * Type-safe HTTP client for the Flowbaby Cloud backend API.
 * Handles request/response serialization, error parsing, and retry logic.
 *
 * @see api-contract/types.ts for request/response shapes
 * @see api-contract/endpoints.md for endpoint documentation
 */

import {
    AuthRequest,
    AuthResponse,
    RefreshRequest,
    VendRequest,
    VendResponse,
    ApiError,
    ErrorCode,
    FlowbabyCloudError,
    FlowbabyCloudConfig,
    DEFAULT_CONFIG,
    getApiBaseUrl,
} from './types';

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

    constructor(config: Partial<FlowbabyCloudConfig> = {}) {
        this.config = {
            ...DEFAULT_CONFIG,
            apiBaseUrl: getApiBaseUrl(),
            ...config,
        };
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
            throw lastError;
        }
        throw new FlowbabyCloudError('NETWORK_ERROR', lastError?.message || 'Request failed after retries');
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
