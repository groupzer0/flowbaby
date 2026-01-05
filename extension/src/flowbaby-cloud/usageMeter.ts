/**
 * Usage Metering Abstraction (Plan 090 M3.1)
 * 
 * Centralizes credit consumption behind a single boundary per DIP.
 * Provides two implementations:
 * - CloudUsageMeter: Calls the backend /usage/consume endpoint
 * - NoOpUsageMeter: No-op for non-Cloud mode
 */

import type { FlowbabyCloudClient } from './client';
import type { ConsumeResponse } from './types';

/**
 * Result of a metering operation
 */
export interface MeteringResult {
    /** Whether the metering call succeeded */
    success: boolean;
    
    /** True if metering was skipped (non-Cloud mode) */
    skipped?: boolean;
    
    /** Reason for skipping (only when skipped=true) */
    reason?: string;
    
    /** Error message if metering failed */
    error?: string;
    
    /** Credits consumed in this operation */
    usedCredits?: number;
    
    /** Remaining credits in the current window */
    remaining?: number;
    
    /** Start of the current billing window (ISO 8601) */
    windowStart?: string;
}

/**
 * Interface for usage metering.
 * Abstracts the "consume credits" operation so core paths don't need
 * to know about Cloud details.
 */
export interface IUsageMeter {
    /**
     * Record a billable operation.
     * 
     * @param operationType - Type of operation ('retrieve' or 'embed')
     * @param idempotencyKey - Unique key for this operation invocation (prevents double-charge on retries)
     * @returns Promise resolving to metering result (never throws)
     */
    recordOperation(
        operationType: 'retrieve' | 'embed',
        idempotencyKey: string
    ): Promise<MeteringResult>;
}

/**
 * No-op implementation for non-Cloud mode.
 * Returns success without calling any backend.
 */
export class NoOpUsageMeter implements IUsageMeter {
    async recordOperation(
        _operationType: 'retrieve' | 'embed',
        _idempotencyKey: string
    ): Promise<MeteringResult> {
        return {
            success: true,
            skipped: true,
            reason: 'non-cloud mode'
        };
    }
}

/**
 * Cloud-backed implementation that calls the /usage/consume endpoint.
 * 
 * Design decisions:
 * - Never throws: Returns failure result instead (fire-and-forget safe)
 * - Requires valid session token: Returns failure if token unavailable
 * - Passes through consume response fields for logging
 */
export class CloudUsageMeter implements IUsageMeter {
    private cloudClient: FlowbabyCloudClient;
    private getSessionToken: () => Promise<string | null>;

    /**
     * @param cloudClient - FlowbabyCloudClient instance with consume() method
     * @param getSessionToken - Function to get current session token (returns null if unavailable)
     */
    constructor(
        cloudClient: FlowbabyCloudClient,
        getSessionToken: () => Promise<string | null>
    ) {
        this.cloudClient = cloudClient;
        this.getSessionToken = getSessionToken;
    }

    async recordOperation(
        operationType: 'retrieve' | 'embed',
        idempotencyKey: string
    ): Promise<MeteringResult> {
        try {
            // Get session token
            const sessionToken = await this.getSessionToken();
            if (!sessionToken) {
                return {
                    success: false,
                    error: 'No session token available - cannot meter operation'
                };
            }

            // Call consume endpoint
            const response: ConsumeResponse = await this.cloudClient.consume(
                sessionToken,
                operationType,
                idempotencyKey
            );

            return {
                success: response.success,
                usedCredits: response.usedCredits,
                remaining: response.remaining,
                windowStart: response.windowStart
            };
        } catch (error) {
            // Never propagate errors - return failure result instead
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: errorMessage
            };
        }
    }
}

/**
 * Single no-op instance for non-Cloud mode (avoid creating new instances per call)
 */
const noOpMeter = new NoOpUsageMeter();

/**
 * Module-level meter instance that can be configured during activation.
 * Defaults to NoOpUsageMeter.
 */
let configuredMeter: IUsageMeter = noOpMeter;

/**
 * Initialize the global usage meter with Cloud dependencies.
 * 
 * Should be called during extension activation after Cloud authentication
 * is set up. This allows the metering abstraction to access the session
 * token without circular dependencies.
 * 
 * @param cloudClient - The FlowbabyCloudClient instance
 * @param getSessionToken - Function to get the current Flowbaby session token
 */
export function initializeUsageMeter(
    cloudClient: FlowbabyCloudClient,
    getSessionToken: () => Promise<string | null>
): void {
    configuredMeter = new CloudUsageMeter(cloudClient, getSessionToken);
}

/**
 * Reset the usage meter to NoOp (for testing or when Cloud is disabled).
 */
export function resetUsageMeter(): void {
    configuredMeter = noOpMeter;
}

/**
 * Get the currently configured usage meter.
 * 
 * Returns CloudUsageMeter if initializeUsageMeter() was called,
 * otherwise returns NoOpUsageMeter.
 * 
 * This is the primary entry point for metering operations in
 * FlowbabyClient's retrieve() and ingestSummary() methods.
 * 
 * @returns IUsageMeter instance
 */
export function getUsageMeter(): IUsageMeter {
    return configuredMeter;
}
