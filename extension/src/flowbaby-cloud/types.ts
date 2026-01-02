/**
 * Flowbaby Cloud Types
 *
 * Re-exports API contract types for use within the extension.
 * This module provides a single import point for all Cloud-related types.
 *
 * @see api-contract/types.ts for the canonical type definitions
 * @see ./contract/types.ts for the synced copy used at compile time
 */

import * as vscode from 'vscode';

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
    RefreshRequest,
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
    /**
     * Backend-controlled LLM model ID for cognify/completion operations.
     * Example: "anthropic.claude-3-haiku-20240307-v1:0"
     * @see Plan 086 - Backend-controlled model selection
     */
    llmModel?: string;
    /**
     * Backend-controlled embedding model ID with LiteLLM prefix.
     * Example: "bedrock/amazon.titan-embed-text-v2:0"
     * @see Plan 086 - Backend-controlled model selection
     */
    embeddingModel?: string;
    /**
     * Embedding dimensions for the configured embedding model.
     * Backend-controlled: extension/bridge must not hardcode dimensions.
     * @see Plan 086 - Backend-controlled model selection
     */
    embeddingDimensions?: number;
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
    /** Backend API base URL (defaults to staging) */
    apiBaseUrl: string;
    /** Request timeout in milliseconds */
    timeoutMs: number;
    /** Number of retry attempts for transient failures */
    maxRetries: number;
}

/**
 * Staging base URL - use until production is provisioned.
 * 
 * Plan 084: Changed from non-existent api.flowbaby.dev to the staging custom domain.
 * Once api-staging.flowbaby.ai is provisioned, this is the preferred URL.
 * During transition, FLOWBABY_CLOUD_API_URL can be set to the execute-api fallback.
 */
export const STAGING_API_BASE_URL = 'https://api-staging.flowbaby.ai';

/**
 * Production base URL - use for marketplace-facing releases.
 * 
 * Plan 084: api.flowbaby.ai is planned but not yet provisioned.
 * Marketplace-facing builds should use this once it's live.
 */
export const PRODUCTION_API_BASE_URL = 'https://api.flowbaby.ai';

/**
 * Fallback execute-api URL for when custom domains aren't provisioned.
 * 
 * Plan 084: This is the raw API Gateway URL from the staging deployment.
 * Use this via FLOWBABY_CLOUD_API_URL env var if custom domains are unavailable.
 */
export const EXECUTE_API_FALLBACK_URL = 'https://0h552crqta.execute-api.us-east-1.amazonaws.com';

/**
 * Default configuration values.
 * 
 * Plan 084: Changed default from non-existent api.flowbaby.dev to staging URL.
 */
export const DEFAULT_CONFIG: FlowbabyCloudConfig = {
    apiBaseUrl: STAGING_API_BASE_URL,
    timeoutMs: 30000,
    maxRetries: 3,
};

/**
 * Get the configured API base URL.
 * 
 * Resolution precedence (Plan 084):
 * 1. VS Code setting: flowbaby.cloud.apiEndpoint
 * 2. Environment variable: FLOWBABY_CLOUD_API_URL
 * 3. Built-in default (STAGING_API_BASE_URL for now; PRODUCTION once provisioned)
 * 
 * @returns The resolved API base URL
 */
export function getApiBaseUrl(): string {
    // 1. VS Code setting (highest priority)
    try {
        const settingValue = vscode.workspace.getConfiguration('flowbaby.cloud').get<string>('apiEndpoint');
        if (settingValue && settingValue.trim().length > 0) {
            return settingValue.trim();
        }
    } catch {
        // VS Code API not available (e.g., during testing) - fall through
    }
    
    // 2. Environment variable
    if (process.env.FLOWBABY_CLOUD_API_URL) {
        return process.env.FLOWBABY_CLOUD_API_URL;
    }
    
    // 3. Built-in default
    return DEFAULT_CONFIG.apiBaseUrl;
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
    /** Refresh token for session renewal (single-use, rotated) */
    REFRESH_TOKEN: 'flowbaby.cloud.refreshToken',
    /** GitHub user identifier (numeric string) */
    GITHUB_ID: 'flowbaby.cloud.githubId',
} as const;

/**
 * Flowbaby Cloud configuration object.
 * Used by auth and client modules.
 * 
 * Plan 084: baseUrl now uses getApiBaseUrl() for consistent resolution.
 * The getter ensures VS Code setting > env var > default precedence.
 */
export const FLOWBABY_CLOUD_CONFIG = {
    /** Backend API base URL - use getApiBaseUrl() for resolved value */
    get baseUrl(): string {
        return getApiBaseUrl();
    },
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

/**
 * Session refresh configuration.
 */
export const SESSION_REFRESH = {
    /** Fraction of session TTL remaining before proactive refresh (10% = 0.1) */
    REFRESH_THRESHOLD_FRACTION: 0.1,
    /** Minimum seconds remaining before refresh attempt (safety floor) */
    MIN_REFRESH_SECONDS: 300, // 5 minutes
    /** Maximum seconds before session start to delay initial refresh check */
    INITIAL_CHECK_DELAY_SECONDS: 60,
} as const;
