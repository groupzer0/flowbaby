/**
 * Flowbaby Cloud API Contract Version
 *
 * CANONICAL SOURCE: https://github.com/groupzer0/flowbaby/tree/main/api-contract
 *
 * This file is synced from the extension repo's api-contract/ directory.
 * Do NOT edit manually — changes will be overwritten by the sync workflow.
 *
 * The contract version determines compatibility between extension and backend.
 * Both repos must support the same contract version to interoperate.
 */

/**
 * Current contract version.
 * Format: MAJOR.MINOR.PATCH
 * - MAJOR: Breaking changes (incompatible request/response shapes)
 * - MINOR: Backward-compatible additions (new optional fields, new endpoints)
 * - PATCH: Documentation or non-functional changes
 *
 * v2.1.1 CHANGELOG:
 * - Removed: BedrockRegion type — regions now backend-defined (string)
 * - Changed: VendRequest.preferredRegion and VendResponse.region are now string
 * - Rationale: Backend owns region allowlist; extension displays backend-provided options
 *
 * v2.1.0 CHANGELOG (Plan 081):
 * - Added: BedrockRegion type (union of supported AWS regions)
 * - Added: VendRequest.preferredRegion optional field for user region preference
 * - Changed: VendResponse.region now typed as BedrockRegion (was string)
 * - Clarified: VendResponse.region is backend-resolved (authoritative)
 * - Rollout: Backend must accept/ignore preferredRegion before extension sends it
 *
 * v2.0.0 CHANGELOG (Plan 080):
 * - BREAKING: Removed 'pro' from UserTier (was unused placeholder)
 * - BREAKING: AuthResponse now requires 'refreshToken' field
 * - Added: POST /auth/refresh endpoint for session refresh without re-OAuth
 * - Added: RefreshRequest type
 * - Added: INVALID_REFRESH and STATE_MISMATCH error codes
 * - Fixed: AuthRequest.code documentation now correctly describes it as the
 *   Flowbaby one-time exchange code (not the GitHub OAuth authorization code)
 * - Fixed: GET /auth/login success flow documentation clarified
 */
export const CONTRACT_VERSION = '2.1.1';

/**
 * Indicates whether the contract is ready for implementation.
 * Backend milestones M2+ are blocked if this is false.
 */
export const CONTRACT_IMPLEMENTATION_READY = true;

/**
 * Minimum backend version required by this contract.
 * Used by extension to verify backend compatibility.
 */
export const MIN_BACKEND_VERSION = '0.4.0';

/**
 * Contract metadata for debugging and logging.
 */
export const CONTRACT_METADATA = {
  version: CONTRACT_VERSION,
  implementationReady: CONTRACT_IMPLEMENTATION_READY,
  minBackendVersion: MIN_BACKEND_VERSION,
  lastUpdated: '2025-12-30',
  source: 'flowbaby', // Canonical source
} as const;
