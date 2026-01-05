/**
 * Flowbaby Cloud Module
 *
 * This module provides Flowbaby Cloud authentication and credential management
 * for the VS Code extension. It enables zero-friction onboarding by handling:
 *
 * - GitHub OAuth login flow
 * - Session token management (SecretStorage)
 * - AWS STS credential vending and caching
 * - Provider wiring for the Python bridge
 *
 * @see Plan 077 for implementation details
 * @see api-contract/ for backend API contract
 */

// Re-export types for consumers
export * from './types';

// Re-export client
export { FlowbabyCloudClient, getCloudClient, resetCloudClient } from './client';

// Re-export auth module (M2)
export {
    FlowbabyCloudAuth,
    MockAuthClient,
    createFlowbabyCloudAuth,
    type IAuthClient,
    type AuthStateChangeEvent,
} from './auth';

// Re-export commands (M2)
export { registerCloudCommands, CLOUD_COMMANDS } from './commands';

// Re-export credentials module (M3)
export {
    FlowbabyCloudCredentials,
    MockCredentialClient,
    createFlowbabyCloudCredentials,
    type ICredentialClient,
    type CredentialRefreshEvent,
    type CredentialExpiryEvent,
} from './credentials';

// Re-export provider module (M4)
export {
    FlowbabyCloudProvider,
    initializeProvider,
    getProvider,
    isProviderInitialized,
    resetProvider,
    getFlowbabyCloudEnvironment,
    isFlowbabyCloudEnabled,
    type FlowbabyCloudEnvironment,
} from './provider';

// Re-export refresh manager (M5)
export {
    CredentialRefreshManager,
    createCredentialRefreshManager,
    type IDaemonController,
    type RefreshManagerEvent,
} from './refresh';

// Re-export error mapping (Plan 083 M3)
export {
    mapCloudErrorToUX,
    showCloudError,
    isRecoverableCloudError,
    requiresReAuthentication,
    CLOUD_ERROR_COMMANDS,
    type CloudErrorUX,
    type ErrorAction,
    type ErrorSeverity,
} from './errorMapping';

// Re-export readiness module (Plan 087)
export {
    CloudReadinessService,
    createCloudReadinessService,
    initializeReadinessService,
    getReadinessService,
    resetReadinessService,
    DEFAULT_THROTTLE_CONFIG,
    type CloudReadinessState,
    type CloudOverallStatus,
    type CloudRemediation,
    type AuthReadinessState,
    type VendReadinessState,
    type BridgeReadinessState,
    type IBridgeHealthChecker,
    type ThrottleConfig,
} from './readiness';

// Re-export usage metering module (Plan 090)
export {
    type IUsageMeter,
    type MeteringResult,
    NoOpUsageMeter,
    CloudUsageMeter,
    initializeUsageMeter,
    resetUsageMeter,
    getUsageMeter,
} from './usageMeter';
