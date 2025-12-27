/**
 * Flowbaby Cloud Provider Integration
 *
 * Provides AWS Bedrock credentials to the Python bridge via environment variables.
 * This module bridges the credential cache (M3) with the daemon manager.
 *
 * Environment variables passed to bridge:
 * - AWS_ACCESS_KEY_ID: STS access key
 * - AWS_SECRET_ACCESS_KEY: STS secret key
 * - AWS_SESSION_TOKEN: STS session token
 * - AWS_REGION: AWS region for Bedrock
 * - FLOWBABY_CLOUD_MODE: 'true' signals cloud mode to bridge
 *
 * @see Plan 077 M4 - Provider Integration
 */

import { FlowbabyCloudCredentials } from './credentials';
import { CachedCredentials } from './types';

/**
 * Environment variables for Flowbaby Cloud mode.
 */
export interface FlowbabyCloudEnvironment {
    AWS_ACCESS_KEY_ID: string;
    AWS_SECRET_ACCESS_KEY: string;
    AWS_SESSION_TOKEN: string;
    AWS_REGION: string;
    FLOWBABY_CLOUD_MODE: 'true';
}

/**
 * Provider for Flowbaby Cloud credentials.
 *
 * This class is the interface between the credential cache and the daemon manager.
 * It provides environment variables for spawning the Python bridge with Bedrock access.
 */
export class FlowbabyCloudProvider {
    constructor(private readonly credentials: FlowbabyCloudCredentials) {}

    /**
     * Check if the provider is ready (has valid credentials).
     */
    isReady(): boolean {
        return this.credentials.hasValidCredentials();
    }

    /**
     * Get environment variables for the Python bridge.
     *
     * @returns Environment variables with AWS credentials
     * @throws FlowbabyCloudError if not authenticated or credentials unavailable
     */
    async getEnvironment(): Promise<FlowbabyCloudEnvironment> {
        const creds = await this.credentials.ensureCredentials();
        return this.credentialsToEnv(creds);
    }

    /**
     * Get environment variables using current cached credentials (no refresh).
     *
     * Use this when you need env vars quickly without network call.
     * Returns undefined if no valid credentials are cached.
     */
    getCachedEnvironment(): FlowbabyCloudEnvironment | undefined {
        const creds = this.credentials.getCachedCredentials();
        if (!creds) {
            return undefined;
        }
        return this.credentialsToEnv(creds);
    }

    /**
     * Get time until credentials expire (for refresh scheduling).
     */
    getTimeUntilExpiry(): number | undefined {
        return this.credentials.getTimeUntilExpiry();
    }

    /**
     * Convert cached credentials to environment variables.
     */
    private credentialsToEnv(creds: CachedCredentials): FlowbabyCloudEnvironment {
        return {
            AWS_ACCESS_KEY_ID: creds.accessKeyId,
            AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
            AWS_SESSION_TOKEN: creds.sessionToken,
            AWS_REGION: creds.region,
            FLOWBABY_CLOUD_MODE: 'true',
        };
    }
}

/**
 * Singleton instance for the provider.
 * Initialized by the extension activation.
 */
let providerInstance: FlowbabyCloudProvider | undefined;

/**
 * Initialize the provider singleton.
 * Should be called during extension activation.
 */
export function initializeProvider(credentials: FlowbabyCloudCredentials): FlowbabyCloudProvider {
    providerInstance = new FlowbabyCloudProvider(credentials);
    return providerInstance;
}

/**
 * Get the provider singleton.
 * @throws Error if provider not initialized
 */
export function getProvider(): FlowbabyCloudProvider {
    if (!providerInstance) {
        throw new Error('FlowbabyCloudProvider not initialized. Call initializeProvider() first.');
    }
    return providerInstance;
}

/**
 * Check if the provider is initialized.
 */
export function isProviderInitialized(): boolean {
    return providerInstance !== undefined;
}

/**
 * Reset the provider singleton (for testing).
 */
export function resetProvider(): void {
    providerInstance = undefined;
}

/**
 * Get Flowbaby Cloud environment variables.
 *
 * This is the primary function called by the daemon manager to get
 * credentials for the Python bridge.
 *
 * @returns Environment variables with AWS credentials
 * @throws FlowbabyCloudError if not authenticated
 */
export async function getFlowbabyCloudEnvironment(): Promise<Record<string, string>> {
    const provider = getProvider();
    const env = await provider.getEnvironment();
    // Spread to create a plain Record<string, string>
    return { ...env };
}

/**
 * Check if Flowbaby Cloud mode is enabled.
 *
 * In v0.7.0, this is always true as Flowbaby Cloud is the sole LLM provider.
 * The function exists for future extensibility if we add local provider support.
 */
export function isFlowbabyCloudEnabled(): boolean {
    // v0.7.0: Always true - Flowbaby Cloud is the only option
    // Future versions may check configuration for hybrid mode
    return true;
}
