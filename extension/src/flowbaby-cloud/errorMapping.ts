/**
 * Centralized Cloud Error → UX Mapping (Plan 083 M3)
 *
 * This module provides a single source of truth for mapping Flowbaby Cloud errors
 * to user-facing messages and recommended actions. By centralizing this logic,
 * we ensure consistent messaging across all entrypoints:
 * - Activation/initialization
 * - Spawn-per-request env assembly
 * - Daemon env assembly
 * - Background operation env assembly
 * - Chat participant/context provider
 *
 * Error codes flow through from backend → credentials → provider → calling code,
 * and this mapping layer translates them into actionable UX.
 */

import * as vscode from 'vscode';
import { FlowbabyCloudError, FlowbabyCloudErrorCode } from './types';

/**
 * Severity level for error display.
 * Determines the VS Code notification type.
 */
export type ErrorSeverity = 'info' | 'warning' | 'error';

/**
 * Command action that can be offered to the user.
 */
export interface ErrorAction {
    /** Display label for the action button */
    label: string;
    /** VS Code command ID to execute */
    commandId: string;
    /** Optional arguments for the command */
    args?: unknown[];
}

/**
 * Result of mapping a Cloud error to UX elements.
 */
export interface CloudErrorUX {
    /** User-facing message to display */
    message: string;
    /** Severity determines notification type (info/warning/error) */
    severity: ErrorSeverity;
    /** Actions to offer the user (appears as buttons in notification) */
    actions: ErrorAction[];
    /** Log-safe metadata (no secrets) for diagnostic logging */
    logMetadata: Record<string, string | number | boolean | undefined>;
}

/**
 * Cloud commands - centralized command IDs for error action buttons.
 * Plan 085: Use canonical flowbaby.cloud.* namespace to match registered commands.
 */
export const CLOUD_ERROR_COMMANDS = {
    LOGIN: 'flowbaby.cloud.login',
    STATUS: 'flowbaby.cloud.status',
    RETRY: 'workbench.action.reloadWindow',
} as const;

/**
 * Map a FlowbabyCloudError to user-facing UX elements.
 *
 * @param error - The Cloud error (or any error)
 * @param context - Optional context string (e.g., "during retrieval")
 * @returns CloudErrorUX with message, severity, actions, and log metadata
 */
export function mapCloudErrorToUX(error: unknown, context?: string): CloudErrorUX {
    const contextSuffix = context ? ` ${context}` : '';

    // Handle FlowbabyCloudError with specific codes
    if (error instanceof FlowbabyCloudError) {
        return mapFlowbabyCloudError(error, contextSuffix);
    }

    // Handle generic Error
    if (error instanceof Error) {
        return {
            message: `An error occurred${contextSuffix}: ${error.message}`,
            severity: 'error',
            actions: [],
            logMetadata: {
                errorType: 'Error',
                errorMessage: error.message,
            },
        };
    }

    // Handle unknown errors
    return {
        message: `An unexpected error occurred${contextSuffix}`,
        severity: 'error',
        actions: [],
        logMetadata: {
            errorType: 'unknown',
            errorString: String(error),
        },
    };
}

/**
 * Map a FlowbabyCloudError to UX elements based on its error code.
 */
function mapFlowbabyCloudError(error: FlowbabyCloudError, contextSuffix: string): CloudErrorUX {
    switch (error.code) {
        // Authentication errors - user needs to log in
        case 'NOT_AUTHENTICATED':
        case 'SESSION_EXPIRED':
        case 'SESSION_INVALID':
        case 'INVALID_REFRESH':
            return {
                message: `Flowbaby Cloud login required${contextSuffix}. Please log in with GitHub.`,
                severity: 'warning',
                actions: [
                    { label: 'Login to Cloud', commandId: CLOUD_ERROR_COMMANDS.LOGIN },
                ],
                logMetadata: {
                    errorCode: error.code,
                    category: 'authentication',
                },
            };

        // Rate limiting - temporary, ask user to wait
        case 'RATE_LIMITED':
            return {
                message: error.retryAfter
                    ? `Rate limited${contextSuffix}. Please try again in ${error.retryAfter} seconds.`
                    : `Rate limited${contextSuffix}. Please try again later.`,
                severity: 'warning',
                actions: [],
                logMetadata: {
                    errorCode: error.code,
                    category: 'rate_limit',
                    retryAfter: error.retryAfter,
                },
            };

        // Quota exceeded - user needs to upgrade
        case 'QUOTA_EXCEEDED':
            return {
                message: `Usage quota exceeded${contextSuffix}. Consider upgrading your subscription.`,
                severity: 'error',
                actions: [
                    { label: 'Check Status', commandId: CLOUD_ERROR_COMMANDS.STATUS },
                ],
                logMetadata: {
                    errorCode: error.code,
                    category: 'quota',
                },
            };

        // Tier access denied
        case 'TIER_INVALID':
            return {
                message: `Your tier does not have access to this feature${contextSuffix}.`,
                severity: 'error',
                actions: [
                    { label: 'Check Status', commandId: CLOUD_ERROR_COMMANDS.STATUS },
                ],
                logMetadata: {
                    errorCode: error.code,
                    category: 'tier',
                },
            };

        // Network errors - user should check connection
        case 'NETWORK_ERROR':
            return {
                message: `Network error${contextSuffix}. Please check your internet connection.`,
                severity: 'error',
                actions: [],
                logMetadata: {
                    errorCode: error.code,
                    category: 'network',
                },
            };

        // Server-side errors - may be temporary
        case 'INTERNAL_ERROR':
        case 'GITHUB_ERROR':
            return {
                message: `Flowbaby Cloud service error${contextSuffix}. Please try again later.`,
                severity: 'error',
                actions: [
                    { label: 'Check Status', commandId: CLOUD_ERROR_COMMANDS.STATUS },
                ],
                logMetadata: {
                    errorCode: error.code,
                    category: 'server',
                },
            };

        // Invalid request errors - likely a bug or version mismatch
        case 'INVALID_CODE':
        case 'STATE_MISMATCH':
        case 'UNEXPECTED_RESPONSE':
            return {
                message: `Request error${contextSuffix}. Please try logging in again.`,
                severity: 'error',
                actions: [
                    { label: 'Login to Cloud', commandId: CLOUD_ERROR_COMMANDS.LOGIN },
                ],
                logMetadata: {
                    errorCode: error.code,
                    category: 'invalid_request',
                },
            };

        // Credentials expired - need to refresh
        case 'CREDENTIALS_EXPIRED':
            return {
                message: `Cloud credentials expired${contextSuffix}. Refreshing...`,
                severity: 'info',
                actions: [],
                logMetadata: {
                    errorCode: error.code,
                    category: 'credentials',
                },
            };

        // Default handler for any other codes (future-proofing)
        default:
            return {
                message: error.message
                    ? `${error.message}${contextSuffix}`
                    : `Cloud error${contextSuffix}: ${error.code}`,
                severity: 'error',
                actions: [],
                logMetadata: {
                    errorCode: error.code,
                    category: 'unknown',
                },
            };
    }
}

/**
 * Show a Cloud error to the user using VS Code notifications.
 *
 * @param error - The error to display
 * @param context - Optional context (e.g., "during retrieval")
 * @param outputChannel - Optional output channel for logging
 */
export async function showCloudError(
    error: unknown,
    context?: string,
    outputChannel?: vscode.OutputChannel
): Promise<void> {
    const ux = mapCloudErrorToUX(error, context);

    // Log to output channel if provided
    if (outputChannel) {
        outputChannel.appendLine(
            `[Cloud Error] ${JSON.stringify(ux.logMetadata)} - ${ux.message}`
        );
    }

    // Prepare action buttons
    const actionLabels = ux.actions.map(a => a.label);

    // Show notification based on severity
    let selection: string | undefined;
    switch (ux.severity) {
        case 'info':
            selection = await vscode.window.showInformationMessage(ux.message, ...actionLabels);
            break;
        case 'warning':
            selection = await vscode.window.showWarningMessage(ux.message, ...actionLabels);
            break;
        case 'error':
            selection = await vscode.window.showErrorMessage(ux.message, ...actionLabels);
            break;
    }

    // Execute selected action
    if (selection) {
        const action = ux.actions.find(a => a.label === selection);
        if (action) {
            await vscode.commands.executeCommand(action.commandId, ...(action.args ?? []));
        }
    }
}

/**
 * Check if an error is a recoverable Cloud error (user can retry).
 */
export function isRecoverableCloudError(error: unknown): boolean {
    if (!(error instanceof FlowbabyCloudError)) {
        return false;
    }
    // Rate limit and network errors are recoverable with retry
    return ['RATE_LIMITED', 'NETWORK_ERROR'].includes(error.code);
}

/**
 * Check if an error requires re-authentication.
 */
export function requiresReAuthentication(error: unknown): boolean {
    if (!(error instanceof FlowbabyCloudError)) {
        return false;
    }
    return [
        'NOT_AUTHENTICATED',
        'SESSION_EXPIRED',
        'SESSION_INVALID',
        'INVALID_REFRESH',
    ].includes(error.code);
}
