/**
 * Flowbaby Cloud API Contract Types
 *
 * CANONICAL SOURCE: https://github.com/groupzer0/flowbaby/tree/main/api-contract
 *
 * This file is synced from the extension repo's api-contract/ directory.
 * Do NOT edit manually — changes will be overwritten by the sync workflow.
 *
 * @see .github/workflows/sync-contract.yml
 */

// =============================================================================
// User Tier
// =============================================================================

/**
 * User subscription tier determining quota limits and feature access.
 * Note: 'pro' tier is reserved for future implementation.
 */
export type UserTier = 'free' | 'basic';

// =============================================================================
// Auth Endpoint Types
// =============================================================================

/**
 * Request body for POST /auth/github
 *
 * Exchanges a **Flowbaby one-time exchange code** for a Flowbaby session token.
 *
 * IMPORTANT: The `code` field is NOT the GitHub OAuth authorization code directly.
 * It is the short-lived, single-use exchange code issued by the Flowbaby backend
 * after completing GitHub OAuth server-side. The backend deep-links this code to
 * the VS Code extension via `vscode://Flowbaby.flowbaby/auth/callback?code=...`.
 */
export interface AuthRequest {
  /**
   * Flowbaby one-time exchange code.
   * Issued by backend after successful GitHub OAuth callback.
   * Single-use, short-lived (≤60 seconds), invalidated after redemption.
   */
  code: string;
  /**
   * CSRF state token for validation.
   * If provided to GET /auth/login, backend echoes it through the OAuth flow
   * and includes it in the deep-link. Extension MUST verify it matches.
   */
  state?: string;
}

/**
 * Successful response from POST /auth/github or POST /auth/refresh
 */
export interface AuthResponse {
  /** Flowbaby JWT session token */
  sessionToken: string;
  /** ISO-8601 timestamp when the session expires */
  expiresAt: string;
  /** User's subscription tier */
  tier: UserTier;
  /** GitHub user identifier (numeric string) */
  githubId: string;
  /**
   * Refresh token for obtaining new session tokens without re-authenticating.
   * Single-use: each refresh returns a new refreshToken (rotation).
   * Longer-lived than sessionToken (e.g., 30 days).
   * Store securely (VS Code SecretStorage).
   */
  refreshToken: string;
}

/**
 * Request body for POST /auth/refresh
 * Exchange a valid refresh token for a new session token + new refresh token.
 */
export interface RefreshRequest {
  /** The refresh token from a previous AuthResponse */
  refreshToken: string;
}

// =============================================================================
// Vend Endpoint Types
// =============================================================================

/**
 * Request body for POST /vend/credentials
 * Session token is passed via Authorization header, not in body.
 */
export interface VendRequest {
  /** Operation type for quota tracking */
  operationType?: 'embed' | 'retrieve';
  /**
   * User's preferred AWS region for Bedrock calls.
   * Optional: if omitted, backend uses default region.
   * Backend validates against its allowlist and returns resolved region in VendResponse.region.
   * Available regions are defined by the backend and may change over time.
   */
  preferredRegion?: string;
}

/**
 * Successful response from POST /vend/credentials
 * Contains temporary AWS credentials for Bedrock access.
 */
export interface VendResponse {
  /** AWS Access Key ID */
  accessKeyId: string;
  /** AWS Secret Access Key */
  secretAccessKey: string;
  /** AWS Session Token */
  sessionToken: string;
  /** ISO-8601 timestamp when credentials expire */
  expiration: string;
  /**
   * Backend-resolved AWS region for Bedrock calls.
   * This is the authoritative region to use—always prefer this over any
   * user preference. Backend validates and resolves the region.
   */
  region: string;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Typed error codes for API responses.
 * Each code maps to a specific HTTP status and failure scenario.
 */
export type ErrorCode =
  | 'INVALID_CODE'        // 400 - Flowbaby exchange code is invalid or expired
  | 'INVALID_REFRESH'     // 400 - Refresh token is invalid, expired, or already used
  | 'STATE_MISMATCH'      // 400 - CSRF state validation failed
  | 'GITHUB_ERROR'        // 502 - GitHub API returned an error during code exchange
  | 'RATE_LIMITED'        // 429 - Too many requests; retry after backoff
  | 'SESSION_EXPIRED'     // 401 - Session token is expired
  | 'SESSION_INVALID'     // 401 - Session token signature verification failed
  | 'QUOTA_EXCEEDED'      // 403 - Monthly credit quota exhausted
  | 'TIER_INVALID'        // 403 - User tier does not permit this operation
  | 'INTERNAL_ERROR';     // 500 - Unexpected server error

/**
 * Standard error response envelope for all API errors.
 */
export interface ApiError {
  /** Always true for error responses */
  error: true;
  /** Typed error code */
  code: ErrorCode;
  /** Human-readable error description */
  message: string;
  /** Seconds until retry is allowed (for RATE_LIMITED) */
  retryAfter?: number;
}

// =============================================================================
// HTTP Status Code Mapping
// =============================================================================

/**
 * Maps error codes to HTTP status codes.
 * Used by Lambda handlers to set response status.
 */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_CODE: 400,
  INVALID_REFRESH: 400,
  STATE_MISMATCH: 400,
  GITHUB_ERROR: 502,
  RATE_LIMITED: 429,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  QUOTA_EXCEEDED: 403,
  TIER_INVALID: 403,
  INTERNAL_ERROR: 500,
};

// =============================================================================
// Tier Configuration
// =============================================================================

/**
 * Tier limits configuration.
 * Monthly credits reset on the 1st of each month (UTC).
 */
export interface TierConfig {
  /** Monthly credit allocation */
  monthlyCredits: number;
  /** Maximum concurrent operations */
  maxConcurrent: number;
}

export const TIER_LIMITS: Record<UserTier, TierConfig> = {
  free: { monthlyCredits: 100, maxConcurrent: 2 },
  basic: { monthlyCredits: 1000, maxConcurrent: 5 },
};

/**
 * Credit costs per operation type.
 * Deducted at vend-time as conservative estimates.
 */
export const OPERATION_COSTS = {
  embed: 1,
  retrieve: 2,
} as const;
