/**
 * Flowbaby Cloud Types
 *
 * Re-exports API contract types for use within the extension.
 * This module provides a single import point for all Cloud-related types.
 *
 * @see api-contract/types.ts for the canonical type definitions
 * @see ./contract/types.ts for the synced copy used at compile time
 */

// Import types from the API contract (synced copy) for use within this file
import type {
    UserTier as UserTierType,
    ErrorCode as ErrorCodeType,
    ApiError as ApiErrorType,
} from './contract';

// Re-export all types from the API contract (synced copy)
export type {
    UserTier,
    AuthRequest,
    AuthResponse,
    VendRequest,
    VendResponse,
    ErrorCode,
    ApiError,
    TierConfig,
} from './contract';

export {
    ERROR_HTTP_STATUS,
    TIER_LIMITS,
    OPERATION_COSTS,
} from './contract';

// Type aliases for local use (re-exports don't bring types into scope)
type ErrorCode = ErrorCodeType;
type ApiError = ApiErrorType;
type UserTier = UserTierType;

// =============================================================================
// Extension-Specific Types
// =============================================================================

/**
 * Extension-specific error codes that supplement the API contract errors.
 * These are used for client-side error handling.
 */
export type ExtensionErrorCode =
    | 'NOT_AUTHENTICATED'      // User has not logged in
    | 'CREDENTIALS_EXPIRED'    // Cached STS credentials have expired
    | 'NETWORK_ERROR'          // Failed to reach the backend
    | 'UNEXPECTED_RESPONSE';   // Response did not match expected shape

/**
 * Combined error type for extension error handling.
 */
export type FlowbabyCloudErrorCode = ErrorCode | ExtensionErrorCode;

/**
 * Custom error class for Flowbaby Cloud operations.
 */
export class FlowbabyCloudError extends Error {
    constructor(
        public readonly code: FlowbabyCloudErrorCode,
        message: string,
        public readonly retryAfter?: number
    ) {
        super(message);
        this.name = 'FlowbabyCloudError';
    }

    /**
     * Create an error from an API error response.
     */
    static fromApiError(apiError: ApiError): FlowbabyCloudError {
        return new FlowbabyCloudError(apiError.code, apiError.message, apiError.retryAfter);
    }
}

/**
 * Cached credentials with metadata for refresh scheduling.
 */
export interface CachedCredentials {
    /** AWS Access Key ID */
    accessKeyId: string;
    /** AWS Secret Access Key */
    secretAccessKey: string;
    /** AWS Session Token */
    sessionToken: string;
    /** AWS region for Bedrock calls */
    region: string;
    /** When the credentials expire (Date object for easy comparison) */
    expiresAt: Date;
    /** When the credentials were fetched (for staleness detection) */
    fetchedAt: Date;
}

/**
 * Authentication state for the extension.
 */
export interface AuthState {
    /** Whether the user is currently authenticated */
    isAuthenticated: boolean;
    /** User's subscription tier (if authenticated) */
    tier?: UserTier;
    /** GitHub user ID (if authenticated) */
    githubId?: string;
    /** When the session expires (if authenticated) */
    sessionExpiresAt?: Date;
}

/**
 * Configuration for the Flowbaby Cloud client.
 */
export interface FlowbabyCloudConfig {
    /** Backend API base URL (defaults to production) */
    apiBaseUrl: string;
    /** Request timeout in milliseconds */
    timeoutMs: number;
    /** Number of retry attempts for transient failures */
    maxRetries: number;
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: FlowbabyCloudConfig = {
    apiBaseUrl: 'https://api.flowbaby.dev',
    timeoutMs: 30000,
    maxRetries: 3,
};

/**
 * Get the configured API base URL.
 * Priority: FLOWBABY_CLOUD_API_URL env var > default production URL
 */
export function getApiBaseUrl(): string {
    return process.env.FLOWBABY_CLOUD_API_URL || DEFAULT_CONFIG.apiBaseUrl;
}

/**
 * OAuth callback URI for the extension.
 * Must match the URI handler registration and GitHub OAuth app configuration.
 *
 * Format: vscode://<publisher>.<name>/<path>
 * For this extension: vscode://Flowbaby.flowbaby/auth/callback
 */
export const OAUTH_CALLBACK_URI = 'vscode://Flowbaby.flowbaby/auth/callback';

/**
 * Verify that the OAuth callback URI matches the extension manifest.
 * This is a development-time check to catch mismatches early.
 */
export function verifyOAuthCallbackUri(publisher: string, name: string): boolean {
    const expectedUri = `vscode://${publisher}.${name}/auth/callback`;
    return OAUTH_CALLBACK_URI === expectedUri;
}

/**
 * SecretStorage keys used by the Cloud module.
 */
export const SECRET_KEYS = {
    /** JWT session token from backend */
    SESSION_TOKEN: 'flowbaby.cloud.sessionToken',
    /** Session expiry timestamp (ISO 8601) */
    SESSION_EXPIRES_AT: 'flowbaby.cloud.sessionExpiresAt',
    /** User's subscription tier */
    USER_TIER: 'flowbaby.cloud.userTier',
} as const;

/**
 * Flowbaby Cloud configuration object.
 * Used by auth and client modules.
 */
export const FLOWBABY_CLOUD_CONFIG = {
    /** Backend API base URL */
    baseUrl: process.env.FLOWBABY_CLOUD_API_URL || 'https://api.flowbaby.dev',
    /** OAuth login endpoint path */
    authLoginPath: '/auth/login',
    /** OAuth token exchange endpoint path */
    authTokenPath: '/auth/token',
    /** Credential vending endpoint path */
    vendCredentialsPath: '/vend/credentials',
} as const;

/**
 * Credential refresh configuration.
 */
export const CREDENTIAL_REFRESH = {
    /** Minutes before expiry to trigger proactive refresh */
    REFRESH_BEFORE_EXPIRY_MINUTES: 15,
    /** Maximum drain window for daemon restart (seconds) */
    MAX_DRAIN_WINDOW_SECONDS: 30,
} as const;
