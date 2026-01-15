/**
 * Flowbaby Cloud Types
 *
 * Re-exports API contract types for use within the extension.
 * This module provides a single import point for all Cloud-related types.
 *
 * @see @groupzer0/flowbaby-api-contract for the canonical type definitions
 * @since Plan 089 - migrated from repo-local contract copy to npm package
 */

import * as vscode from 'vscode';

// Import types from the canonical API contract package for use within this file
import type {
    UserTier as UserTierType,
    ErrorCode as ErrorCodeType,
    ApiError as ApiErrorType,
} from '@groupzer0/flowbaby-api-contract';

// Re-export all types from the API contract package
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
    UserProfileResponse,
    UsageResponse,
    EnabledBedrockRegion,
    AllowlistedLlmModel,
    // Plan 090: Consume types for credit usage metering
    ConsumeRequest,
    ConsumeResponse,
    // Plan 094: Geographic zone types for cross-region support
    GeographicZone,
    // Plan 098: v4.0.0 surface-specific auth types
    ClientType,
    ExtensionAuthResponse,
    WebAuthResponse,
    ExtensionRefreshRequest,
    WebRefreshRequest,
    RefreshResponse,
    ExtensionRefreshResponse,
    WebRefreshResponse,
    JwtAudience,
} from '@groupzer0/flowbaby-api-contract';

export {
    ERROR_HTTP_STATUS,
    TIER_LIMITS,
    TIER_DISPLAY_NAMES,
    OPERATION_COSTS,
    ENABLED_BEDROCK_REGIONS,
    DEFAULT_BEDROCK_REGION,
    ALLOWLISTED_LLM_MODELS,
    DEFAULT_LLM_MODEL,
    DEFAULT_EMBEDDING_MODEL,
    DEFAULT_EMBEDDING_DIMENSIONS,
    resolveBedrockRegion,
    getModelConfiguration,
    // Plan 094: Geographic zone constants
    GEOGRAPHIC_ZONES,
    DEFAULT_GEOGRAPHIC_ZONE,
    // Plan 098: v4.0.0 surface-specific type guards and constants
    isExtensionAuthResponse,
    isWebAuthResponse,
    isExtensionRefreshRequest,
    isWebRefreshRequest,
    isExtensionRefreshResponse,
    isWebRefreshResponse,
    JWT_AUDIENCES,
    getAudienceForClientType,
    CLIENT_TYPES,
    DEFAULT_CLIENT_TYPE,
    ERROR_DESCRIPTIONS,
} from '@groupzer0/flowbaby-api-contract';

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
    /**
     * Geographic zone for this credential set.
     * Backend-authoritative: client MUST use this value.
     * @see Plan 094 - Cross-Region Nova Lite
     */
    zone: import('@groupzer0/flowbaby-api-contract').GeographicZone;
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
 * Staging base URL - for development and testing only.
 * 
 * Plan 084: Changed from non-existent api.flowbaby.dev to the staging custom domain.
 * Plan 099: Production is now the default; use staging only via explicit override.
 */
export const STAGING_API_BASE_URL = 'https://api-staging.flowbaby.ai';

/**
 * Production base URL - default for marketplace-facing releases.
 * 
 * Plan 099: api.flowbaby.ai is now provisioned and is the built-in default.
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
 * Plan 099: Default is production (api.flowbaby.ai). Use overrides for staging/testing.
 */
export const DEFAULT_CONFIG: FlowbabyCloudConfig = {
    apiBaseUrl: PRODUCTION_API_BASE_URL,
    timeoutMs: 30000,
    maxRetries: 3,
};

/**
 * Get the configured API base URL.
 * 
 * Resolution precedence (Plan 084/099):
 * 1. VS Code setting: flowbaby.cloud.apiEndpoint
 * 2. Environment variable: FLOWBABY_CLOUD_API_URL
 * 3. Built-in default (PRODUCTION_API_BASE_URL)
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

// =============================================================================
// Plan 106: Dynamic OAuth Callback URI for VS Code Variants
// =============================================================================

/**
 * Supported URI schemes for OAuth callback.
 * Only VS Code stable and Insiders are supported in v0.7.2.
 * 
 * This is an explicit allowlist — fail-closed for unsupported schemes.
 * 
 * @see agent-output/planning/106-oauth-callback-vscode-variants.md
 */
export const SUPPORTED_URI_SCHEMES = ['vscode', 'vscode-insiders'] as const;
export type SupportedUriScheme = typeof SUPPORTED_URI_SCHEMES[number];

/**
 * Error thrown when OAuth login is attempted from an unsupported editor variant.
 * Provides actionable guidance to the user.
 */
export class UnsupportedUriSchemeError extends Error {
    public readonly scheme: string;

    constructor(scheme: string) {
        super(
            `OAuth login is not supported in this editor (scheme: ${scheme}). ` +
            `Please use VS Code or VS Code Insiders.`
        );
        this.name = 'UnsupportedUriSchemeError';
        this.scheme = scheme;
        Object.setPrototypeOf(this, UnsupportedUriSchemeError.prototype);
    }
}

/**
 * Get the OAuth callback URI for the current editor variant.
 * 
 * Uses vscode.env.uriScheme to dynamically determine the correct protocol,
 * and derives the authority from the runtime extension ID.
 * 
 * @throws UnsupportedUriSchemeError if the current editor scheme is not allowlisted
 * @returns The callback URI (e.g., 'vscode://Flowbaby.flowbaby/auth/callback')
 * 
 * @see agent-output/planning/106-oauth-callback-vscode-variants.md
 */
export function getOAuthCallbackUri(): string {
    const scheme = vscode.env.uriScheme;

    // Fail-closed: reject unsupported schemes with explicit error
    if (!SUPPORTED_URI_SCHEMES.includes(scheme as SupportedUriScheme)) {
        throw new UnsupportedUriSchemeError(scheme);
    }

    // Plan 106: Derive authority from runtime extension ID via activation context
    // This avoids hardcoding 'Flowbaby.flowbaby' in extension logic
    const { getActiveExtensionId } = require('../lifecycle/registrationHelper');
    const extensionId = getActiveExtensionId();
    if (!extensionId) {
        // Fail-closed: cannot build callback URI without extension identity
        throw new Error('Extension context not available. Cannot determine extension ID for OAuth callback.');
    }

    return `${scheme}://${extensionId}/auth/callback`;
}

/**
 * @deprecated Use getOAuthCallbackUri() instead. Retained for backward compatibility.
 * 
 * Legacy constant for OAuth callback URI.
 * This hardcodes the vscode:// scheme and breaks VS Code Insiders.
 * 
 * Plan 106 replaces this with getOAuthCallbackUri() which derives the scheme
 * from vscode.env.uriScheme at runtime.
 */
export const OAUTH_CALLBACK_URI = 'vscode://Flowbaby.flowbaby/auth/callback';

/**
 * Verify that the OAuth callback URI matches the expected extension identity.
 * 
 * Plan 106: Updated to validate against a dynamically generated URI instead
 * of comparing to a hardcoded constant. The scheme is now allowed to vary
 * between 'vscode' and 'vscode-insiders'.
 * 
 * @param extensionId The full extension ID (publisher.name format)
 * @returns true if the current environment's callback URI matches expected pattern
 */
export function verifyOAuthCallbackUri(extensionId: string): boolean {
    try {
        const callbackUri = getOAuthCallbackUri();
        // Validate that authority matches the expected extension ID
        const url = new URL(callbackUri);
        return url.host.toLowerCase() === extensionId.toLowerCase() &&
               url.pathname === '/auth/callback';
    } catch {
        // If getOAuthCallbackUri throws (unsupported scheme), verification fails
        return false;
    }
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
