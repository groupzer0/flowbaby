/**
 * FlowbabyContextProvider - Centralized retrieval service for agent integration (Plan 016)
 * 
 * This service wraps FlowbabyClient.retrieve with agent-friendly structured responses,
 * enforces concurrency/rate limits, and provides the single retrieval entry point
 * for both the @flowbaby participant and public agent commands.
 * 
 * Architecture Reference: system-architecture.md §3.1, §4.5
 * Contract Reference: extension/bridge/RETRIEVE_CONTRACT.md
 */

import * as vscode from 'vscode';
import { FlowbabyClient } from './flowbabyClient';
import {
    FlowbabyContextRequest,
    FlowbabyContextEntry,
    FlowbabyContextResponse,
    AgentErrorCode,
    AgentErrorResponse
} from './types/agentIntegration';
import { SessionManager } from './sessionManager';

/**
 * Request queue item with timestamp for rate limiting
 */
interface QueuedRequest {
    /** Unique identifier for this request */
    id: string;

    /** Request parameters */
    request: FlowbabyContextRequest;

    /** Timestamp when request was queued */
    queuedAt: Date;

    /** Promise resolve function */
    resolve: (response: FlowbabyContextResponse | AgentErrorResponse) => void;

    /** Promise reject function */
    reject: (error: Error) => void;
}

import { FlowbabySetupService } from './setup/FlowbabySetupService';

/**
 * Configuration for FlowbabyContextProvider
 */
export interface ProviderConfig {
    /** Maximum concurrent requests (default: 2, max: 5) */
    maxConcurrentRequests: number;

    /** Maximum request queue size before rejecting (default: 5) */
    maxQueueSize: number;

    /** Maximum requests per minute (default: 10, max: 30) */
    rateLimitPerMinute: number;
}

/**
 * FlowbabyContextProvider - Singleton service for agent retrieval
 * 
 * Key responsibilities:
 * - Centralize retrieval logic for participant and agent commands
 * - Enforce concurrency limits (max 2 in-flight, configurable up to 5)
 * - Enforce rate limits (max 10/minute, configurable up to 30)
 * - Convert bridge responses to structured FlowbabyContextEntry format
 * - Provide transparent error handling with standard error codes
 * 
 * @see system-architecture.md §4.5 for agent integration flow
 */
export class FlowbabyContextProvider {
    private readonly client: FlowbabyClient;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly setupService: FlowbabySetupService;
    private readonly config: ProviderConfig;
    private readonly sessionManager?: SessionManager; // Plan 001

    /** Currently in-flight requests */
    private inFlightRequests: Set<string> = new Set();

    /** Queued requests waiting for slot */
    private requestQueue: QueuedRequest[] = [];

    /** Request timestamps for rate limiting (last 60 seconds) */
    private requestTimestamps: Date[] = [];

    /** Next request ID counter */
    private nextRequestId = 0;

    /** Timestamp of last toast shown for dedupe guard (Plan 067) */
    private lastToastTime = 0;

    /** Dedupe window in milliseconds - suppress duplicate toasts within this window (Plan 067) */
    private readonly TOAST_DEDUPE_MS = 5000;
    /**
     * Constructor - Initialize provider with FlowbabyClient and configuration
     * 
     * @param client - FlowbabyClient instance for bridge operations
     * @param outputChannel - Output channel for logging
     * @param setupService - FlowbabySetupService for environment verification
     * @param sessionManager - Optional SessionManager instance (Plan 001)
     */
    constructor(
        client: FlowbabyClient,
        outputChannel: vscode.OutputChannel,
        setupService: FlowbabySetupService,
        sessionManager?: SessionManager
    ) {
        this.client = client;
        this.outputChannel = outputChannel;
        this.setupService = setupService;
        this.sessionManager = sessionManager;

        // Load configuration with safe upper bounds
        const vsConfig = vscode.workspace.getConfiguration('Flowbaby.agentAccess');
        const maxConcurrent = vsConfig.get<number>('maxConcurrentRequests', 2);
        const rateLimit = vsConfig.get<number>('rateLimitPerMinute', 10);

        this.config = {
            maxConcurrentRequests: Math.min(maxConcurrent, 5), // Clamp to max 5
            maxQueueSize: 5,
            rateLimitPerMinute: Math.min(rateLimit, 30) // Clamp to max 30
        };

        // Log configuration with warnings if clamped
        if (maxConcurrent > 5) {
            this.outputChannel.appendLine(
                `[WARNING] maxConcurrentRequests clamped from ${maxConcurrent} to 5 (architectural limit)`
            );
        }
        if (rateLimit > 30) {
            this.outputChannel.appendLine(
                `[WARNING] rateLimitPerMinute clamped from ${rateLimit} to 30 (architectural limit)`
            );
        }

        this.outputChannel.appendLine(
            `[FlowbabyContextProvider] Initialized with concurrency=${this.config.maxConcurrentRequests}, ` +
            `rate limit=${this.config.rateLimitPerMinute}/min`
        );
    }

    /**
     * Retrieve context from Flowbaby with concurrency and rate limiting
     * 
     * This is the primary method for all retrieval operations. It:
     * 1. Validates request parameters
     * 2. Checks rate limits
     * 3. Queues request if concurrency limit reached
     * 4. Calls FlowbabyClient.retrieve when slot available
     * 5. Converts bridge results to FlowbabyContextResponse
     * 6. Returns structured response or error
     * 
     * @param req - Retrieval request with query and optional limits
     * @returns Promise resolving to structured response or error
     */
    async retrieveContext(
        req: FlowbabyContextRequest
    ): Promise<FlowbabyContextResponse | AgentErrorResponse> {
        // Plan 049: Check environment verification
        if (!this.setupService.isVerified) {
            return {
                error: AgentErrorCode.NOT_INITIALIZED,
                message: 'Environment not initialized or dependencies outdated.',
                details: 'Run "Flowbaby: Initialize Workspace" or "Flowbaby: Refresh Dependencies".'
            };
        }

        // Plan 083: Pre-check Cloud credentials for faster feedback (Cloud-only v0.7.0+)
        const hasApiKey = await this.client.hasApiKey();
        if (!hasApiKey) {
            this.outputChannel.appendLine(
                `[FlowbabyContextProvider] ${new Date().toISOString()} - Cloud login required`
            );

            // Surface actionable prompt to user
            const action = await vscode.window.showWarningMessage(
                'Flowbaby Cloud login required for memory operations.',
                'Login to Cloud',
                'Cancel'
            );

            if (action === 'Login to Cloud') {
                await vscode.commands.executeCommand('flowbaby.cloud.login');
            }

            return {
                error: AgentErrorCode.INVALID_REQUEST,
                message: 'Cloud login required. Use "Flowbaby: Login to Cloud" command.',
                details: 'Memory operations require Flowbaby Cloud authentication (v0.7.0+)'
            };
        }

        // Validate request
        if (!req.query || req.query.trim().length === 0) {
            return {
                error: AgentErrorCode.INVALID_REQUEST,
                message: 'Query cannot be empty',
                details: 'request.query must be a non-empty string'
            };
        }

        // Check rate limit
        if (!this.checkRateLimit()) {
            return {
                error: AgentErrorCode.RATE_LIMIT_EXCEEDED,
                message: `Rate limit exceeded: max ${this.config.rateLimitPerMinute} requests per minute`,
                details: `Current window: ${this.requestTimestamps.length} requests in last 60s`
            };
        }

        // Check queue capacity
        if (this.requestQueue.length >= this.config.maxQueueSize) {
            return {
                error: AgentErrorCode.QUEUE_FULL,
                message: `Request queue full: max ${this.config.maxQueueSize} pending requests`,
                details: `Currently in-flight: ${this.inFlightRequests.size}, queued: ${this.requestQueue.length}`
            };
        }

        // Generate unique request ID
        const requestId = `req-${this.nextRequestId++}`;

        // Create queued request
        return new Promise((resolve, reject) => {
            const queuedRequest: QueuedRequest = {
                id: requestId,
                request: req,
                queuedAt: new Date(),
                resolve,
                reject
            };

            this.requestQueue.push(queuedRequest);
            this.processQueue();
        });
    }

    /**
     * Check if request is within rate limit window
     * 
     * @returns true if request allowed, false if rate limit exceeded
     */
    private checkRateLimit(): boolean {
        // Remove timestamps older than 60 seconds
        const now = new Date();
        const oneMinuteAgo = new Date(now.getTime() - 60000);
        this.requestTimestamps = this.requestTimestamps.filter(
            ts => ts > oneMinuteAgo
        );

        // Check if under limit
        return this.requestTimestamps.length < this.config.rateLimitPerMinute;
    }

    /**
     * Process queued requests up to concurrency limit
     * 
     * This method is called whenever:
     * - A new request is queued
     * - An in-flight request completes
     * 
     * It processes requests in FIFO order.
     */
    private processQueue(): void {
        // Process as many requests as concurrency allows
        while (
            this.inFlightRequests.size < this.config.maxConcurrentRequests &&
            this.requestQueue.length > 0
        ) {
            const queuedRequest = this.requestQueue.shift();
            if (!queuedRequest) {
                break;
            }

            // Mark as in-flight
            this.inFlightRequests.add(queuedRequest.id);

            // Record timestamp for rate limiting
            this.requestTimestamps.push(new Date());

            // Execute request
            this.executeRequest(queuedRequest)
                .then(response => {
                    queuedRequest.resolve(response);
                })
                .catch(error => {
                    queuedRequest.reject(error);
                })
                .finally(() => {
                    // Remove from in-flight and process next
                    this.inFlightRequests.delete(queuedRequest.id);
                    this.processQueue();
                });
        }
    }

    /**
     * Execute a single retrieval request
     * 
     * @param queuedRequest - Request to execute
     * @returns Promise resolving to response or error
     */
    private async executeRequest(
        queuedRequest: QueuedRequest
    ): Promise<FlowbabyContextResponse | AgentErrorResponse> {
        const { id, request, queuedAt } = queuedRequest;
        const startTime = Date.now();
        const queueWaitMs = startTime - queuedAt.getTime();

        this.outputChannel.appendLine(
            `[FlowbabyContextProvider] Executing request ${id} ` +
            `(queue wait: ${queueWaitMs}ms, query: "${request.query.substring(0, 50)}...")`
        );

        try {
            // Call FlowbabyClient.retrieve with query
            // Note: maxResults and maxTokens are handled by FlowbabyClient configuration
            // Per Milestone 1 Task 2, provider enforces concurrency/rate limits but
            // delegates token budgets to existing FlowbabyClient settings
            const results = await this.client.retrieve(request.query, {
                maxResults: request.maxResults,
                maxTokens: request.maxTokens,
                includeSuperseded: request.includeSuperseded,
                halfLifeDays: request.halfLifeDays,
                threadId: request.threadId // Plan 001: Pass threadId
            });

            // Filter out low confidence results (redundant check for safety)
            // Allow score 0.0 (sentinel for synthesized answers) but filter noise (e.g. 0.005)
            const validResults = results.filter(r => (r.score ?? 0) > 0.01 || r.score === 0.0);
            const filteredCount = results.length - validResults.length;

            if (filteredCount > 0) {
                this.outputChannel.appendLine(
                    `[FlowbabyContextProvider] Filtered ${filteredCount} results with score <= 0.01 (excluding 0.0 sentinel)`
                );
            }

            // Log if synthesized answers are present
            const synthesizedCount = validResults.filter(r => r.score === 0.0).length;
            if (synthesizedCount > 0) {
                this.outputChannel.appendLine(
                    `[FlowbabyContextProvider] Included ${synthesizedCount} synthesized answers (score 0.0)`
                );
            }

            // Convert RetrievalResult[] to FlowbabyContextEntry[]
            const entries: FlowbabyContextEntry[] = validResults.map(result => ({
                summaryText: result.summaryText || result.text || '',
                decisions: result.decisions,
                rationale: result.rationale,
                openQuestions: result.openQuestions,
                nextSteps: result.nextSteps,
                references: result.references,
                topic: result.topic,
                topicId: result.topicId || null,
                sessionId: result.sessionId || null,
                planId: result.planId || null,
                status: result.status ?? null,
                createdAt: result.createdAt ? result.createdAt.toISOString() : null,
                sourceCreatedAt: result.sourceCreatedAt ? result.sourceCreatedAt.toISOString() : null,
                updatedAt: result.updatedAt ? result.updatedAt.toISOString() : null,
                finalScore: result.score,
                score: result.score,
                confidenceLabel: result.confidenceLabel,
                tokens: result.tokens
            }));

            // Calculate total tokens
            const tokensUsed = validResults.reduce((sum, r) => sum + (r.tokens || 0), 0);

            const duration = Date.now() - startTime;
            this.outputChannel.appendLine(
                `[FlowbabyContextProvider] Request ${id} completed ` +
                `(duration: ${duration}ms, results: ${entries.length}, tokens: ${tokensUsed})`
            );

            // Plan 067: Show toast notification for interactive retrieval when enabled
            if (entries.length > 0) {
                const showNotifications = vscode.workspace.getConfiguration('flowbaby')
                    .get<boolean>('showRetrievalNotifications', true);

                if (showNotifications) {
                    // Dedupe guard: suppress rapid successive toasts (Plan 067)
                    const now = Date.now();
                    if (now - this.lastToastTime >= this.TOAST_DEDUPE_MS) {
                        this.lastToastTime = now;

                        // 2-second delay to avoid interrupting user mid-thought (Plan 067)
                        setTimeout(() => {
                            vscode.window.showInformationMessage(
                                `✨ Flowbaby retrieved and provided context`,
                                'View Graph',
                                'Turn Off'
                            ).then(action => {
                                if (action === 'View Graph') {
                                    vscode.commands.executeCommand('Flowbaby.visualizeGraph');
                                } else if (action === 'Turn Off') {
                                    // Open settings with the notification setting focused
                                    vscode.commands.executeCommand(
                                        'workbench.action.openSettings',
                                        'flowbaby.showRetrievalNotifications'
                                    );
                                }
                            });
                        }, 2000);
                    }
                }
            }

            return {
                entries,
                totalResults: validResults.length,
                tokensUsed
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);

            this.outputChannel.appendLine(
                `[FlowbabyContextProvider] Request ${id} failed ` +
                `(duration: ${duration}ms, error: ${errorMessage})`
            );

            // Determine error code based on error type
            const isTimeout = errorMessage.toLowerCase().includes('timeout');
            const errorCode = isTimeout
                ? AgentErrorCode.BRIDGE_TIMEOUT
                : AgentErrorCode.INVALID_REQUEST;

            return {
                error: errorCode,
                message: `Retrieval failed: ${errorMessage}`,
                details: `Request ${id} failed after ${duration}ms`
            };
        }
    }

    /**
     * Get current provider status for debugging/transparency
     * 
     * @returns Status object with queue sizes and limits
     */
    getStatus(): {
        inFlight: number;
        queued: number;
        maxConcurrent: number;
        rateLimit: number;
        currentRateWindow: number;
    } {
        // Count recent requests in last 60 seconds
        const now = new Date();
        const oneMinuteAgo = new Date(now.getTime() - 60000);
        const recentRequests = this.requestTimestamps.filter(ts => ts > oneMinuteAgo).length;

        return {
            inFlight: this.inFlightRequests.size,
            queued: this.requestQueue.length,
            maxConcurrent: this.config.maxConcurrentRequests,
            rateLimit: this.config.rateLimitPerMinute,
            currentRateWindow: recentRequests
        };
    }
}
