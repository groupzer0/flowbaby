/**
 * Centralized Flowbaby Configuration Access Layer
 * 
 * Plan 102: Single source of truth for all Flowbaby settings.
 * All modules MUST use this module to read configuration values
 * to prevent drift and ensure consistent behavior.
 * 
 * Settings are organized into three tiers:
 * - Core: Primary user-facing settings (visible in Settings UI)
 * - Advanced: Tuning knobs for power users (under "Flowbaby (Advanced)")
 * - Hidden-but-supported: Removed from UI but still functional via settings.json
 */

import * as vscode from 'vscode';

// ============================================================================
// Core Settings (visible in primary "Flowbaby" settings group)
// ============================================================================

/**
 * Whether Flowbaby is enabled for the workspace.
 * Core setting #1.
 */
export function isEnabled(): boolean {
    return vscode.workspace.getConfiguration('Flowbaby').get<boolean>('enabled', true);
}

/**
 * Preferred geographic zone for Flowbaby Cloud Bedrock calls.
 * Core setting #2.
 * Values: '' (backend default), 'us', 'eu', 'apac'
 */
export function getCloudPreferredZone(): string {
    return vscode.workspace.getConfiguration('flowbaby.cloud').get<string>('preferredZone', '');
}

/**
 * Copilot synthesis model ID for memory retrieval.
 * Core setting #3.
 */
export function getSynthesisModelId(): string {
    return vscode.workspace.getConfiguration('Flowbaby.synthesis').get<string>('modelId', 'gpt-5-mini');
}

/**
 * Whether session management (grouping interactions by session) is enabled.
 * Core setting #4.
 */
export function isSessionManagementEnabled(): boolean {
    return vscode.workspace.getConfiguration('Flowbaby.sessionManagement').get<boolean>('enabled', true);
}

/**
 * Whether debug logging is enabled.
 * Core setting #5.
 */
export function isDebugLoggingEnabled(): boolean {
    return vscode.workspace.getConfiguration('Flowbaby').get<boolean>('debugLogging', false);
}

/**
 * Whether to show toast notifications on successful ingestion.
 * Core setting #6.
 */
export function shouldShowIngestionSuccessNotifications(): boolean {
    return vscode.workspace.getConfiguration('flowbaby.notifications').get<boolean>('showIngestionSuccess', true);
}

/**
 * Whether to show toast notifications on retrieval.
 * Core setting #7.
 */
export function shouldShowRetrievalNotifications(): boolean {
    return vscode.workspace.getConfiguration('flowbaby').get<boolean>('showRetrievalNotifications', true);
}

// ============================================================================
// Advanced Settings (visible under "Flowbaby (Advanced)" group)
// ============================================================================

/**
 * Maximum number of memory results to retrieve.
 * Tuning-only (retrieval breadth).
 */
export function getMaxContextResults(): number {
    return vscode.workspace.getConfiguration('Flowbaby').get<number>('maxContextResults', 3);
}

/**
 * Maximum token budget for retrieved context.
 * Tuning-only (latency/memory tradeoff).
 * Hard-clamped to 100k in the bridge.
 */
export function getMaxContextTokens(): number {
    return vscode.workspace.getConfiguration('Flowbaby').get<number>('maxContextTokens', 32000);
}

/**
 * Maximum candidates to request from search engine before ranking.
 * Tuning-only (candidate pool size).
 */
export function getSearchTopK(): number {
    return vscode.workspace.getConfiguration('Flowbaby').get<number>('searchTopK', 10);
}

/**
 * Half-life in days for recency-aware ranking.
 * Tuning-only (recency bias).
 * Clamped to [0.5, 90] range.
 */
export function getRankingHalfLifeDays(): number {
    const value = vscode.workspace.getConfiguration('Flowbaby.ranking').get<number>('halfLifeDays', 7);
    return Math.max(0.5, Math.min(90, value));
}

/**
 * Maximum triplets to retrieve during wide graph search.
 * Support-only (graph retrieval tuning).
 */
export function getWideSearchTopK(): number {
    return vscode.workspace.getConfiguration('Flowbaby.advancedSearch').get<number>('wideSearchTopK', 150);
}

/**
 * Penalty for triplet distance during graph ranking.
 * Support-only (graph ranking tuning).
 */
export function getTripletDistancePenalty(): number {
    return vscode.workspace.getConfiguration('Flowbaby.advancedSearch').get<number>('tripletDistancePenalty', 3.0);
}

/**
 * Path to Python interpreter.
 * Power-user override (environment selection).
 * Empty string means auto-detection.
 */
export function getPythonPath(): string {
    return vscode.workspace.getConfiguration('Flowbaby').get<string>('pythonPath', '');
}

/**
 * Logging verbosity level.
 * Support-only (log verbosity shaping).
 */
export function getLogLevel(): 'error' | 'warn' | 'info' | 'debug' {
    const level = vscode.workspace.getConfiguration('Flowbaby').get<string>('logLevel', 'info');
    if (['error', 'warn', 'info', 'debug'].includes(level)) {
        return level as 'error' | 'warn' | 'info' | 'debug';
    }
    return 'info';
}

// ============================================================================
// Hidden-but-Supported Settings
// These are NOT in the Settings UI but remain fully functional when set
// via settings.json. Do NOT change their behavior in v0.7.1.
// ============================================================================

/**
 * Bridge execution mode: 'daemon' or 'spawn'.
 * Hidden-but-supported (support/troubleshooting).
 * 
 * NOTE: This setting is hidden from the Settings UI but remains
 * functional when set via settings.json per Plan 102.
 */
export function getBridgeMode(): 'daemon' | 'spawn' {
    const mode = vscode.workspace.getConfiguration('Flowbaby').get<string>('bridgeMode', 'daemon');
    return mode === 'spawn' ? 'spawn' : 'daemon';
}

/**
 * Minutes of inactivity before daemon exits.
 * Hidden-but-supported (daemon lifecycle tuning).
 * 
 * NOTE: This setting is hidden from the Settings UI but remains
 * functional when set via settings.json per Plan 102.
 */
export function getDaemonIdleTimeoutMinutes(): number {
    const value = vscode.workspace.getConfiguration('Flowbaby').get<number>('daemonIdleTimeoutMinutes', 30);
    return Math.max(1, Math.min(60, value));
}

/**
 * Flowbaby Cloud API endpoint override.
 * Hidden-but-supported (developer/testing).
 * 
 * Resolution precedence (Plan 084/099 - MUST preserve):
 * 1. VS Code setting: flowbaby.cloud.apiEndpoint
 * 2. Environment variable: FLOWBABY_CLOUD_API_URL
 * 3. Built-in default (api.flowbaby.ai)
 * 
 * NOTE: This setting is hidden from the Settings UI but remains
 * functional when set via settings.json per Plan 102.
 */
export function getCloudApiEndpoint(): string {
    // 1. VS Code setting (highest priority)
    try {
        const settingValue = vscode.workspace.getConfiguration('flowbaby.cloud').get<string>('apiEndpoint');
        if (settingValue && settingValue.trim().length > 0) {
            return settingValue.trim();
        }
    } catch {
        // VS Code API not available - fall through
    }
    
    // 2. Environment variable
    if (process.env.FLOWBABY_CLOUD_API_URL) {
        return process.env.FLOWBABY_CLOUD_API_URL;
    }
    
    // 3. Built-in default
    return 'https://api.flowbaby.ai';
}

// ============================================================================
// Architectural Constants (Plan 102: hardcoded, not configurable)
// These were previously read from Flowbaby.agentAccess.* but are now
// hardcoded per architecture doc to prevent misconfiguration.
// ============================================================================

/**
 * Maximum concurrent agent requests.
 * Hardcoded architectural limit (previously Flowbaby.agentAccess.maxConcurrentRequests).
 */
export const MAX_CONCURRENT_AGENT_REQUESTS = 5;

/**
 * Agent request queue size.
 * Hardcoded architectural limit.
 */
export const AGENT_QUEUE_SIZE = 5;

/**
 * Maximum agent requests per minute.
 * Hardcoded architectural limit (previously Flowbaby.agentAccess.rateLimitPerMinute).
 */
export const AGENT_RATE_LIMIT_PER_MINUTE = 30;

// ============================================================================
// Aggregate Config Types (for callers that need multiple values at once)
// ============================================================================

export interface FlowbabyRetrievalConfig {
    maxContextResults: number;
    maxContextTokens: number;
    searchTopK: number;
    halfLifeDays: number;
    wideSearchTopK: number;
    tripletDistancePenalty: number;
}

/**
 * Get all retrieval-related configuration in a single call.
 * Useful for callers that need multiple retrieval settings.
 */
export function getRetrievalConfig(): FlowbabyRetrievalConfig {
    return {
        maxContextResults: getMaxContextResults(),
        maxContextTokens: getMaxContextTokens(),
        searchTopK: getSearchTopK(),
        halfLifeDays: getRankingHalfLifeDays(),
        wideSearchTopK: getWideSearchTopK(),
        tripletDistancePenalty: getTripletDistancePenalty(),
    };
}

export interface FlowbabyAgentAccessConfig {
    maxConcurrentRequests: number;
    maxQueueSize: number;
    rateLimitPerMinute: number;
}

/**
 * Get agent access configuration.
 * These values are hardcoded architectural limits (Plan 102).
 */
export function getAgentAccessConfig(): FlowbabyAgentAccessConfig {
    return {
        maxConcurrentRequests: MAX_CONCURRENT_AGENT_REQUESTS,
        maxQueueSize: AGENT_QUEUE_SIZE,
        rateLimitPerMinute: AGENT_RATE_LIMIT_PER_MINUTE,
    };
}
