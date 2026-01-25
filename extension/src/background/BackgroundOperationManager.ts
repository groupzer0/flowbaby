/**
 * Background Operation Manager - Plan 017
 * 
 * Manages async cognify() operations, tracks state, enforces concurrency limits,
 * and triggers notifications on completion/failure.
 * 
 * Plan 061 Hotfix: Routes cognify through the daemon when available to avoid
 * KuzuDB lock contention between daemon and background subprocesses.
 * 
 * Plan 116 M5: Cognify is now daemon-only - no independent subprocess spawning.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
// Plan 039 M5: Removed dotenv import - .env API key support removed for security
// Plan 081: Import Cloud provider for Bedrock credentials
// Plan 083: Import FlowbabyCloudError to preserve error codes end-to-end
// Plan 087: Import getReadinessService for user-visible error surfacing
// Plan 090: Import getUsageMeter for credit consumption tracking
import { isProviderInitialized, getFlowbabyCloudEnvironment, isFlowbabyCloudEnabled, FlowbabyCloudError, getReadinessService, getUsageMeter } from '../flowbaby-cloud';
// Plan 116: Import reliability contract for daemon-only routing errors
import { DaemonUnavailableReason, DaemonUnavailableError } from '../bridge/daemonReliabilityContract';

/**
 * Interface for daemon manager to avoid circular imports
 * Plan 061 Hotfix: Used to route cognify through daemon
 */
export interface IDaemonManager {
    isDaemonEnabled(): boolean;
    isHealthy(): boolean;
    sendRequest(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<{
        jsonrpc: string;
        id: string;
        result?: Record<string, unknown>;
        error?: { code: number; message: string; data?: Record<string, unknown> };
    }>;
}

export interface OperationRetryPayload {
    type: 'summary' | 'conversation';
    summary?: Record<string, unknown>;
    conversation?: {
        userMessage: string;
        assistantMessage: string;
        importance: number;
    };
}

export interface OperationEntry {
    operationId: string;
    datasetPath: string;
    summaryDigest: string;
    summaryText?: string;
    pid: number | null;
    pythonPath?: string;
    bridgeScriptPath?: string;
    queueIndex?: number;
    startTime: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'terminated' | 'unknown';
    lastUpdate?: string;
    elapsedMs?: number;
    entityCount?: number;
    errorCode?: string;
    errorMessage?: string;
    payloadPath?: string;
    payloadType?: OperationRetryPayload['type'];
    // Plan 092 M5: Track auto-retry count for daemon failures
    retryCount?: number;
}

export interface StatusStub {
    operation_id: string;
    success: boolean;
    error_code?: string;
    error_message?: string;
    remediation?: string;
    elapsed_ms: number;
    entity_count?: number;
    timestamp: string;
}

export interface NotificationThrottle {
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
}

/**
 * Singleton service managing background cognify() operations
 */
export class BackgroundOperationManager {
    private static instance: BackgroundOperationManager;
    
    private operations: Map<string, OperationEntry> = new Map();
    private runningProcesses: Map<string, ChildProcess> = new Map();
    private notificationThrottles: Map<string, NotificationThrottle> = new Map();
    private stubMonitors: Map<string, NodeJS.Timeout> = new Map();
    
    private readonly maxConcurrent = 2;
    private readonly maxQueued = 3;
    private readonly throttleWindowMs = 5 * 60 * 1000; // 5 minutes
    private readonly stubPollIntervalMs = 5000; // 5 seconds
    
    // Plan 116 M5: Auto-retry via subprocess removed - daemon-only routing
    
    private context: vscode.ExtensionContext;
    private outputChannel: vscode.OutputChannel;
    private ledgerPath: string | null = null;
    private logFilePath: string | null = null;
    private defaultPythonPath: string | null = null;
    private defaultBridgeScriptPath: string | null = null;
    
    // Plan 061 Hotfix: Reference to daemon manager for routing cognify through daemon
    private daemonManager: IDaemonManager | null = null;
    
    private _isPaused: boolean = false;

    public get isPaused(): boolean {
        return this._isPaused;
    }

    public async pause(timeoutMs: number = 10000): Promise<boolean> {
        this._isPaused = true;
        this.outputChannel.appendLine('[BACKGROUND] Pausing operations...');
        
        // Wait for running jobs to complete or timeout
        const start = Date.now();
        while (this.getRunningCount() > 0) {
            if (Date.now() - start > timeoutMs) {
                return false; // Timed out waiting for jobs
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        return true;
    }

    public resume(): void {
        this._isPaused = false;
        this.outputChannel.appendLine('[BACKGROUND] Resuming operations...');
        void this.dequeueNext();
    }

    private constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
        this.context = context;
        this.outputChannel = outputChannel;
    }
    
    public static initialize(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): BackgroundOperationManager {
        if (!BackgroundOperationManager.instance) {
            BackgroundOperationManager.instance = new BackgroundOperationManager(context, outputChannel);
        }
        return BackgroundOperationManager.instance;
    }
    
    public static getInstance(): BackgroundOperationManager {
        if (!BackgroundOperationManager.instance) {
            throw new Error('BackgroundOperationManager not initialized');
        }
        return BackgroundOperationManager.instance;
    }
    
    /**
     * Set daemon manager reference for routing cognify through daemon
     * Plan 061 Hotfix: Avoids KuzuDB lock contention by serializing all DB writes through daemon
     */
    public setDaemonManager(daemonManager: IDaemonManager | null): void {
        this.daemonManager = daemonManager;
        if (daemonManager) {
            this.outputChannel.appendLine('[BACKGROUND] Daemon manager set - cognify will route through daemon');
        } else {
            // Plan 116: Daemon-only routing - no subprocess fallback
            this.outputChannel.appendLine('[BACKGROUND] Daemon manager cleared - cognify will be unavailable until daemon restored');
        }
    }
    
    /**
     * Initialize ledger for workspace
     */
    public async initializeForWorkspace(workspacePath: string): Promise<void> {
        const flowbabyDir = path.join(workspacePath, '.flowbaby');
        const logsDir = path.join(flowbabyDir, 'logs');
        await fs.promises.mkdir(flowbabyDir, { recursive: true });
        await fs.promises.mkdir(path.join(flowbabyDir, 'background_ops'), { recursive: true });
        await fs.promises.mkdir(logsDir, { recursive: true });
        
        this.ledgerPath = path.join(flowbabyDir, 'background_ops.json');
        this.logFilePath = path.join(logsDir, 'flowbaby.log');

        // Log rotation: if log file > 5MB, truncate it
        // Note: Python bridge_logger.py also writes to this file with its own rotation
        try {
            const stats = await fs.promises.stat(this.logFilePath);
            if (stats.size > 5 * 1024 * 1024) {
                await fs.promises.writeFile(this.logFilePath, ''); // Truncate
                this.outputChannel.appendLine(`[BACKGROUND] Log file rotated: ${this.logFilePath}`);
            }
        } catch {
            // Log file doesn't exist yet, ignore
        }
        
        // Load existing ledger
        await this.loadLedger();
        
        // Reconcile operations
        await this.reconcileLedger();

        // Resume any pending operations after reconciliation
        await this.resumePendingOperations();
    }

    /**
     * Plan 083 M5: Removed in v0.7.0 Cloud-only mode.
     * Cloud credentials are now obtained via getFlowbabyCloudEnvironment().
     * LLM_API_KEY is no longer supported - use Cloud login instead.
     * 
     * @deprecated Removed in v0.7.0 - always returns undefined
     */
    private async resolveApiKey(_workspacePath: string): Promise<undefined> {
        // Plan 083 M5: v0.7.0 is Cloud-only - no legacy API key support
        this.outputChannel.appendLine('[BACKGROUND] resolveApiKey called but v0.7.0 is Cloud-only - returning undefined');
        return undefined;
    }

    /**
     * Build LLM environment variables from config and resolved API key
     * 
     * Plan 081: In v0.7.0 (Cloud-only), merges Flowbaby Cloud AWS credentials
     * when authenticated. Cloud env takes precedence for Bedrock calls.
     * 
     * Plan 083: Preserves FlowbabyCloudError codes end-to-end for accurate UX.
     * Plan 087: Shows throttled user notification on vend failure.
     */
    private async getLLMEnvironment(workspacePath: string): Promise<Record<string, string>> {
        const env: Record<string, string> = {};
        
        // Plan 081: If Cloud is enabled and provider is initialized, get Cloud credentials
        if (isFlowbabyCloudEnabled() && isProviderInitialized()) {
            try {
                const cloudEnv = await getFlowbabyCloudEnvironment();
                Object.assign(env, cloudEnv);
                this.outputChannel.appendLine('[BACKGROUND] Cloud credentials injected into background operation environment');
            } catch (error) {
                // Plan 083: Preserve FlowbabyCloudError for accurate UX (rate limit vs auth failure)
                this.outputChannel.appendLine(`[BACKGROUND] Cloud credentials not available: ${error}`);

                // Plan 087: Surface vend failure to user via throttled notification
                const readinessService = getReadinessService();
                if (readinessService) {
                    await readinessService.showThrottledError(error, 'during background operation');
                }

                if (error instanceof FlowbabyCloudError) {
                    throw error; // Preserve original error code
                }
                // Unknown errors: wrap with context but don't mask as auth failure
                throw new Error(`Cloud credentials error: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        // Plan 083 M5: v0.7.0 is Cloud-only - no LLM_* env vars injected
        // Bridge subprocess env no longer includes LLM_API_KEY, LLM_PROVIDER, LLM_MODEL, LLM_ENDPOINT
        // Cloud credentials (AWS_*) are the only auth mechanism supported
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _workspacePathUnused = workspacePath; // Silence unused parameter warning

        return env;
    }
    
    /**
     * Start a new background cognify operation
     */
    public async startOperation(
        summaryText: string,
        datasetPath: string,
        pythonPath: string,
        bridgeScriptPath: string,
        payload: OperationRetryPayload
    ): Promise<string> {
        if (this._isPaused) {
             throw new Error('Background operations are paused. Please try again later.');
        }

        const operationId = this.generateOperationId();
        const summaryDigest = summaryText.substring(0, 50);
        
        // Check for duplicate (same datasetPath + summaryDigest with status=running|pending)
        for (const [_id, op] of this.operations) {
            if (op.datasetPath === datasetPath && 
                op.summaryDigest === summaryDigest &&
                (op.status === 'running' || op.status === 'pending')) {
                throw new Error('Duplicate ingestion detected. Wait for in-flight operation to complete.');
            }
        }
        
        // Check capacity
        const runningCount = this.getRunningCount();
        const queuedCount = this.getQueuedCount();
        
        if (runningCount + queuedCount >= this.maxConcurrent + this.maxQueued) {
            throw new Error('429_FLOWBABY_BACKLOG: Background queue full. Wait 30-60s and try again.');
        }
        
        // Persist payload for retry support
        const payloadPath = await this.persistPayload(operationId, datasetPath, payload);

        // Create operation entry
        const now = new Date().toISOString();
        const entry: OperationEntry = {
            operationId,
            datasetPath,
            summaryDigest,
            pid: null,
            pythonPath,
            bridgeScriptPath,
            startTime: now,
            lastUpdate: now,
            status: runningCount < this.maxConcurrent ? 'running' : 'pending',
            queueIndex: runningCount < this.maxConcurrent ? undefined : queuedCount,
            payloadPath,
            payloadType: payload.type,
            // Plan 092 M5: Initialize retry count for auto-retry tracking
            retryCount: 0
        };
        this.defaultPythonPath = pythonPath;
        this.defaultBridgeScriptPath = bridgeScriptPath;
        
        this.operations.set(operationId, entry);
        
        // Spawn if capacity available
        if (entry.status === 'running') {
            await this.spawnCognifyProcess(operationId, datasetPath, pythonPath, bridgeScriptPath);
        } else {
            await this.saveLedger();
        }
        
        this.outputChannel.appendLine(`[BACKGROUND] ${new Date().toISOString()} - Cognify ${entry.status} (operationId=${operationId}, workspace=${path.basename(datasetPath)}, pid=${entry.pid || 'queued'})`);
        
        return operationId;
    }

    /**
     * Check if a file exists.
     * Protected to allow mocking in tests.
     */
    public checkFileExists(filePath: string): boolean {
        return fs.existsSync(filePath);
    }
    
    /**
     * Spawn cognify-only subprocess OR route through daemon
     * 
     * Plan 061 Hotfix: Routes through daemon when available to avoid KuzuDB lock
     * contention. The daemon holds the single connection to KuzuDB, so all DB
     * writes must go through it.
     * 
     * Plan 032 M3: Removed logFd file descriptor passing to prevent TypeScript from
     * holding the log file open. Python bridge_logger.py handles its own log rotation
     * using RotatingFileHandler. With TS holding the fd open, Python cannot rotate
     * logs properly, resulting in writes to .log.1 or rotation failures.
     * 
     * Plan 116 M5: Cognify is now daemon-only. No independent subprocess spawning.
     * When daemon is unavailable, this method fails with DaemonUnavailableError.
     */
    private async spawnCognifyProcess(
        operationId: string,
        datasetPathOverride?: string,
        pythonPathOverride?: string,
        bridgeScriptPathOverride?: string
    ): Promise<void> {
        const entry = this.operations.get(operationId);
        if (!entry) {
            throw new Error(`Operation not found: ${operationId}`);
        }
        const workspacePath = datasetPathOverride || entry.datasetPath;
        const pythonExecutable = pythonPathOverride || entry.pythonPath || this.defaultPythonPath;
        const bridgeScriptPath = bridgeScriptPathOverride || entry.bridgeScriptPath || this.defaultBridgeScriptPath;
        if (!pythonExecutable || !bridgeScriptPath) {
            throw new Error('Missing python or bridge script path for background operation');
        }
        entry.datasetPath = workspacePath;
        entry.bridgeScriptPath = bridgeScriptPath;
        entry.pythonPath = pythonExecutable;

        // Plan 116 M5: Daemon-only routing for background cognify
        // No subprocess fallback - daemon is the only execution path
        if (!this.daemonManager) {
            this.outputChannel.appendLine(`[BACKGROUND] ${new Date().toISOString()} - Daemon manager not available (operationId=${operationId})`);
            await this.failOperation(operationId, {
                code: 'DAEMON_UNAVAILABLE',
                message: 'Daemon manager not initialized',
                remediation: 'Restart VS Code or check extension logs.'
            });
            await this.dequeueNext();
            throw new DaemonUnavailableError(
                DaemonUnavailableReason.PROCESS_NOT_AVAILABLE,
                operationId,
                { operation: 'background_cognify' }
            );
        }

        if (!this.daemonManager.isDaemonEnabled()) {
            this.outputChannel.appendLine(`[BACKGROUND] ${new Date().toISOString()} - Daemon mode disabled (operationId=${operationId})`);
            await this.failOperation(operationId, {
                code: 'DAEMON_DISABLED',
                message: 'Daemon mode is disabled in settings',
                remediation: 'Enable daemon mode in Flowbaby settings (bridgeMode: daemon).'
            });
            await this.dequeueNext();
            throw new DaemonUnavailableError(
                DaemonUnavailableReason.DAEMON_DISABLED,
                operationId
            );
        }

        if (!this.daemonManager.isHealthy()) {
            this.outputChannel.appendLine(`[BACKGROUND] ${new Date().toISOString()} - Daemon not healthy (operationId=${operationId})`);
            await this.failOperation(operationId, {
                code: 'DAEMON_UNHEALTHY',
                message: 'Daemon is not healthy',
                remediation: 'Run "Flowbaby: Diagnose Daemon" or restart VS Code.'
            });
            await this.dequeueNext();
            throw new DaemonUnavailableError(
                DaemonUnavailableReason.PROCESS_NOT_AVAILABLE,
                operationId,
                { operation: 'background_cognify', reason: 'daemon_unhealthy' }
            );
        }

        this.outputChannel.appendLine(`[BACKGROUND] ${new Date().toISOString()} - Routing cognify through daemon (operationId=${operationId})`);
        
        entry.status = 'running';
        entry.queueIndex = undefined;
        entry.lastUpdate = new Date().toISOString();
        await this.saveLedger();
        
        // Fire-and-forget: Start daemon cognify but don't block on it
        // Completion/failure handled asynchronously via .then()/.catch()
        this.daemonManager.sendRequest('cognify', {
            operation_id: operationId
        }, 120000) // 120s timeout for cognify
            .then(async (response) => {
                if (response.error) {
                    await this.failOperation(operationId, {
                        code: 'COGNEE_SDK_ERROR',
                        message: response.error.message || 'Unknown error during cognify',
                        remediation: 'Check logs for details. Try running Flowbaby: Refresh Environment.'
                    });
                } else {
                    const result = response.result as { success: boolean; elapsed_ms?: number; entity_count?: number; error?: string };
                    
                    if (result.success) {
                        // Plan 090: Record credit consumption for successful embed operation (async cognify path)
                        // Fire-and-forget: metering failure does NOT block operation completion
                        const idempotencyKey = uuidv4();
                        getUsageMeter().recordOperation('embed', idempotencyKey).then(meteringResult => {
                            if (meteringResult.success && !meteringResult.skipped) {
                                this.outputChannel.appendLine(
                                    `[BACKGROUND] ${new Date().toISOString()} - Cognify metering recorded: ` +
                                    `usedCredits=${meteringResult.usedCredits}, remaining=${meteringResult.remaining}`
                                );
                            } else if (!meteringResult.success) {
                                this.outputChannel.appendLine(
                                    `[BACKGROUND] ${new Date().toISOString()} - Cognify metering failed (non-blocking): ${meteringResult.error}`
                                );
                            }
                        }).catch((err: Error) => {
                            this.outputChannel.appendLine(
                                `[BACKGROUND] ${new Date().toISOString()} - Cognify metering unexpected error: ${err.message}`
                            );
                        });

                        await this.completeOperation(operationId, {
                            elapsedMs: result.elapsed_ms || 0,
                            entityCount: result.entity_count
                        });
                    } else {
                        await this.failOperation(operationId, {
                            code: 'COGNEE_SDK_ERROR',
                            message: result.error || 'Unknown error during cognify',
                            remediation: 'Check logs for details. Try running Flowbaby: Refresh Environment.'
                        });
                    }
                }
                // Dequeue next after completion
                await this.dequeueNext();
            })
            .catch(async (daemonError) => {
                const errorMsg = daemonError instanceof Error ? daemonError.message : String(daemonError);
                this.outputChannel.appendLine(`[BACKGROUND] ${new Date().toISOString()} - Daemon cognify failed: ${errorMsg}`);
                
                // Plan 116 M5: No auto-retry via subprocess - fail fast with reason code
                await this.failOperation(operationId, {
                    code: 'DAEMON_ERROR',
                    message: errorMsg,
                    remediation: 'Run "Flowbaby: Diagnose Daemon" for details.'
                });
                await this.dequeueNext();
            });
        
        // Return immediately - cognify runs in background
    }
    
    /**
     * Handle process exit
     */
    private async handleProcessExit(operationId: string, code: number | null, signal: string | null): Promise<void> {
        const entry = this.operations.get(operationId);
        if (!entry) {
            return;
        }
        this.outputChannel.appendLine(`[BACKGROUND] ${new Date().toISOString()} - Cognify process exited (operationId=${operationId}, code=${code}, signal=${signal})`);
        
        this.runningProcesses.delete(operationId);
        entry.pid = null;
        
        const processed = await this.processStatusStub(operationId, entry.datasetPath);
        if (!processed) {
            entry.status = 'unknown';
            entry.lastUpdate = new Date().toISOString();
            await this.saveLedger();
        }
    }
    
    /**
     * Complete operation successfully
     */
    public async completeOperation(operationId: string, result: { entityCount?: number; elapsedMs: number }): Promise<void> {
        const entry = this.operations.get(operationId);
        if (!entry) {
            return;
        }
        
        entry.status = 'completed';
        entry.elapsedMs = result.elapsedMs;
        entry.entityCount = result.entityCount;
        entry.lastUpdate = new Date().toISOString();
        
        await this.saveLedger();
        await this.deletePayloadFile(entry);
        
        this.outputChannel.appendLine(`[BACKGROUND] ${new Date().toISOString()} - Cognify completed (operationId=${operationId}, elapsed=${result.elapsedMs}ms, entities=${result.entityCount || 'unknown'})`);
        
        // Schedule success notification (throttled)
        await this.scheduleSuccessNotification(entry);
    }
    
    /**
     * Fail operation with error
     */
    public async failOperation(operationId: string, error: { code: string; message: string; remediation: string }): Promise<void> {
        const entry = this.operations.get(operationId);
        if (!entry) {
            return;
        }
        
        entry.status = 'failed';
        entry.errorCode = error.code;
        entry.errorMessage = error.message;
        entry.lastUpdate = new Date().toISOString();
        
        await this.saveLedger();
        
        this.outputChannel.appendLine(`[ERROR] ${new Date().toISOString()} - Flowbaby processing failed (operationId=${operationId}, errorCode=${error.code}, message=${error.message})`);
        
        // Schedule failure notification (always shown, throttled)
        await this.scheduleFailureNotification(entry, error.remediation);
    }
    
    /**
     * Schedule success notification (info-level, throttled)
     * Plan 017 architecture: "✅ Flowbaby processing finished" with workspace, summary, time, entity count
     * Plan 032 M4: Updated branding from "Cognify" to "Flowbaby"
     * Plan 043: Respect flowbaby.notifications.showIngestionSuccess setting
     */
    private async scheduleSuccessNotification(entry: OperationEntry): Promise<void> {
        // Plan 043: Check if success notifications are enabled
        const showSuccessNotifications = vscode.workspace.getConfiguration('flowbaby.notifications').get<boolean>('showIngestionSuccess', true);
        if (!showSuccessNotifications) {
            this.outputChannel.appendLine(`[BACKGROUND] Success notification suppressed by user setting (flowbaby.notifications.showIngestionSuccess=false)`);
            return;
        }

        const workspaceName = path.basename(entry.datasetPath);
        const throttle = this.getOrCreateThrottle(entry.datasetPath);
        
        const now = new Date();
        // Throttling removed per user request: "Only success noticices should be supressed when the user has that set in the extension settings"
        
        throttle.lastSuccessAt = now;
        
        const elapsedSec = ((entry.elapsedMs || 0) / 1000).toFixed(1);
        const entityCount = entry.entityCount || 0;
        
        // Architecture spec format: "Workspace: {name}\nSummary: {digest}\nCompleted in {elapsed}s ({entity_count} entities)"
        const message = `Workspace: ${workspaceName}\nSummary: ${entry.summaryDigest || 'N/A'}\nCompleted in ${elapsedSec}s (${entityCount} entities)`;
        
        const action = await vscode.window.showInformationMessage(
            '✅ Flowbaby processing finished',
            { detail: message, modal: false },
            'View Status'
        );
        
        if (action === 'View Status') {
            vscode.commands.executeCommand('Flowbaby.backgroundStatus');
        }
    }
    
    /**
     * Schedule failure notification (warning-level, throttled)
     * Plan 017 architecture: "⚠️ Flowbaby processing failed" with workspace, summary, remediation
     * Plan 032 M4: Updated branding from "Cognify" to "Flowbaby"
     */
    private async scheduleFailureNotification(entry: OperationEntry, remediation: string): Promise<void> {
        const workspaceName = path.basename(entry.datasetPath);
        const throttle = this.getOrCreateThrottle(entry.datasetPath);
        
        const now = new Date();
        // Throttling removed per user request: "Failure notices should never be supressed"
        
        throttle.lastFailureAt = now;
        
        // Architecture spec format: "Workspace: {name}\nSummary: {digest}\n{remediation}"
        const message = `Workspace: ${workspaceName}\nSummary: ${entry.summaryDigest || 'N/A'}\n${remediation}`;
        
        if (this.logFilePath) {
             this.outputChannel.appendLine(`[INFO] Logs available at: ${this.logFilePath}`);
        }

        const action = await vscode.window.showWarningMessage(
            '⚠️ Flowbaby processing failed',
            { detail: message, modal: false },
            'Retry',
            'View Logs'
        );
        
        if (action === 'Retry') {
            try {
                await this.retryOperation(entry);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.outputChannel.appendLine(`[ERROR] ${new Date().toISOString()} - Retry handler error: ${message}`);
                vscode.window.showErrorMessage(`Retry failed: ${message}`);
            }
        } else if (action === 'View Logs') {
            if (this.logFilePath) {
                const doc = await vscode.workspace.openTextDocument(this.logFilePath);
                await vscode.window.showTextDocument(doc);
            } else {
                this.outputChannel.show();
            }
        }
    }
    
    /**
     * Get or create notification throttle for workspace
     */
    private getOrCreateThrottle(workspacePath: string): NotificationThrottle {
        if (!this.notificationThrottles.has(workspacePath)) {
            this.notificationThrottles.set(workspacePath, {
                lastSuccessAt: null,
                lastFailureAt: null
            });
        }
        return this.notificationThrottles.get(workspacePath)!;
    }
    
    /**
     * Dequeue next pending operation
     */
    private async dequeueNext(): Promise<void> {
        await this.resumePendingOperations();
    }

    private async processStatusStub(operationId: string, workspacePath: string, silentOnMissing = false): Promise<boolean> {
        const entry = this.operations.get(operationId);
        if (!entry) {
            this.clearStubMonitor(operationId);
            return true;
        }
        const stubPath = path.join(workspacePath, '.flowbaby', 'background_ops', `${operationId}.json`);
        try {
            const stubContent = await fs.promises.readFile(stubPath, 'utf-8');
            const stub: StatusStub = JSON.parse(stubContent);
            if (stub.success) {
                // Plan 090: Record credit consumption for successful embed operation (subprocess cognify path)
                // Fire-and-forget: metering failure does NOT block operation completion
                const idempotencyKey = uuidv4();
                getUsageMeter().recordOperation('embed', idempotencyKey).then(meteringResult => {
                    if (meteringResult.success && !meteringResult.skipped) {
                        this.outputChannel.appendLine(
                            `[BACKGROUND] ${new Date().toISOString()} - Cognify metering recorded (subprocess): ` +
                            `usedCredits=${meteringResult.usedCredits}, remaining=${meteringResult.remaining}`
                        );
                    } else if (!meteringResult.success) {
                        this.outputChannel.appendLine(
                            `[BACKGROUND] ${new Date().toISOString()} - Cognify metering failed (non-blocking): ${meteringResult.error}`
                        );
                    }
                }).catch((err: Error) => {
                    this.outputChannel.appendLine(
                        `[BACKGROUND] ${new Date().toISOString()} - Cognify metering unexpected error: ${err.message}`
                    );
                });

                await this.completeOperation(operationId, {
                    entityCount: stub.entity_count,
                    elapsedMs: stub.elapsed_ms
                });
            } else {
                await this.failOperation(operationId, {
                    code: stub.error_code || 'UNKNOWN_ERROR',
                    message: stub.error_message || 'Background processing failed',
                    remediation: stub.remediation || 'Check logs for details'
                });
            }
            this.clearStubMonitor(operationId);
            await this.dequeueNext();
            return true;
        } catch (err) {
            if (!silentOnMissing) {
                // If we are here, it means the process exited but no stub was found.
                // This is a crash or silent failure.
                this.outputChannel.appendLine(`[ERROR] ${new Date().toISOString()} - Cognify process crashed or was killed (operationId=${operationId})`);
                await this.failOperation(operationId, {
                    code: 'PROCESS_CRASHED',
                    message: 'Background process crashed or was killed unexpectedly.',
                    remediation: 'Check logs for details. You may need to restart VS Code.'
                });
                this.clearStubMonitor(operationId);
                await this.dequeueNext();
                return true;
            }
            return false;
        }
    }

    private monitorStatusStub(operationId: string, workspacePath: string): void {
        if (this.stubMonitors.has(operationId)) {
            return;
        }
        const poll = async () => {
            const processed = await this.processStatusStub(operationId, workspacePath, true);
            if (processed) {
                this.clearStubMonitor(operationId);
            }
        };
        const interval = setInterval(() => {
            void poll();
        }, this.stubPollIntervalMs);
        this.stubMonitors.set(operationId, interval);
        void poll();
    }

    private clearStubMonitor(operationId: string): void {
        const monitor = this.stubMonitors.get(operationId);
        if (monitor) {
            clearInterval(monitor);
            this.stubMonitors.delete(operationId);
        }
    }

    private clearAllStubMonitors(): void {
        for (const monitor of this.stubMonitors.values()) {
            clearInterval(monitor);
        }
        this.stubMonitors.clear();
    }

    private async resumePendingOperations(): Promise<void> {
        while (this.getRunningCount() < this.maxConcurrent) {
            const pending = Array.from(this.operations.values())
                .filter(op => op.status === 'pending')
                .sort((a, b) => {
                    const idxA = typeof a.queueIndex === 'number' ? a.queueIndex : Number.MAX_SAFE_INTEGER;
                    const idxB = typeof b.queueIndex === 'number' ? b.queueIndex : Number.MAX_SAFE_INTEGER;
                    if (idxA !== idxB) {
                        return idxA - idxB;
                    }
                    return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
                });
            if (pending.length === 0) {
                break;
            }
            const nextOp = pending[0];
            try {
                await this.spawnCognifyProcess(nextOp.operationId);
                this.outputChannel.appendLine(`[BACKGROUND] ${new Date().toISOString()} - Dequeued operation ${nextOp.operationId}`);
            } catch (error) {
                nextOp.status = 'failed';
                nextOp.errorCode = 'RESUME_FAILED';
                nextOp.errorMessage = error instanceof Error ? error.message : String(error);
                nextOp.lastUpdate = new Date().toISOString();
                await this.saveLedger();
                this.outputChannel.appendLine(`[ERROR] ${new Date().toISOString()} - Failed to resume pending operation ${nextOp.operationId}: ${nextOp.errorMessage}`);
                break;
            }
        }
    }

    private reassignQueueIndexes(): void {
        const pending = Array.from(this.operations.values())
            .filter(op => op.status === 'pending')
            .sort((a, b) => {
                const idxA = typeof a.queueIndex === 'number' ? a.queueIndex : Number.MAX_SAFE_INTEGER;
                const idxB = typeof b.queueIndex === 'number' ? b.queueIndex : Number.MAX_SAFE_INTEGER;
                if (idxA !== idxB) {
                    return idxA - idxB;
                }
                return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
            });
        pending.forEach((op, index) => {
            op.queueIndex = index;
        });
    }

    private async persistPayload(operationId: string, workspacePath: string, payload: OperationRetryPayload): Promise<string> {
        const payloadDir = path.join(workspacePath, '.flowbaby', 'background_ops', 'payloads');
        await fs.promises.mkdir(payloadDir, { recursive: true });
        const payloadPath = path.join(payloadDir, `${operationId}.json`);
        const tempPath = `${payloadPath}.tmp`;
        await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8');
        await fs.promises.rename(tempPath, payloadPath);
        return payloadPath;
    }

    private async deletePayloadFile(entry: OperationEntry): Promise<void> {
        if (!entry.payloadPath) {
            return;
        }
        try {
            await fs.promises.unlink(entry.payloadPath);
        } catch {
            // ignore cleanup errors
        }
        entry.payloadPath = undefined;
        entry.payloadType = undefined;
    }

    private async loadPayload(entry: OperationEntry): Promise<OperationRetryPayload | null> {
        if (!entry.payloadPath) {
            return null;
        }
        try {
            const content = await fs.promises.readFile(entry.payloadPath, 'utf-8');
            return JSON.parse(content) as OperationRetryPayload;
        } catch (error) {
            this.outputChannel.appendLine(`[ERROR] ${new Date().toISOString()} - Failed to load payload for ${entry.operationId}: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    private async deleteStatusStub(operationId: string, workspacePath: string): Promise<void> {
        const stubPath = path.join(workspacePath, '.flowbaby', 'background_ops', `${operationId}.json`);
        try {
            await fs.promises.unlink(stubPath);
        } catch {
            // Stubs may already be removed; ignore errors
        }
    }

    private async runAddOnlyPayload(entry: OperationEntry, payload: OperationRetryPayload): Promise<void> {
        const pythonExecutable = entry.pythonPath || this.defaultPythonPath;
        const bridgeScriptPath = entry.bridgeScriptPath || this.defaultBridgeScriptPath;
        if (!pythonExecutable || !bridgeScriptPath) {
            throw new Error('Missing python or bridge script path for retry');
        }

        const args = [
            bridgeScriptPath,
            '--mode', 'add-only'
        ];

        if (payload.type === 'summary' && payload.summary) {
            args.push('--summary', '--summary-json', JSON.stringify(payload.summary));
        } else if (payload.type === 'conversation' && payload.conversation) {
            const convo = payload.conversation;
            args.push(
                entry.datasetPath,
                convo.userMessage,
                convo.assistantMessage,
                convo.importance.toString()
            );
        } else {
            throw new Error('Retry payload is incomplete');
        }

        const result = await this.runPythonJson(pythonExecutable, args, path.dirname(bridgeScriptPath), entry.datasetPath);
        if (!result.success) {
            const errorMessage = typeof result.error === 'string' ? result.error : 'Add-only retry failed';
            throw new Error(errorMessage);
        }
    }

    private async runPythonJson(
        pythonExecutable: string,
        args: string[],
        cwd: string,
        workspacePath?: string
    ): Promise<{ success?: boolean; error?: unknown; [key: string]: unknown }> {
        // Build environment with LLM variables if workspace provided
        let spawnEnv: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: '1' };
        if (workspacePath) {
            const llmEnv = await this.getLLMEnvironment(workspacePath);
            spawnEnv = { ...spawnEnv, ...llmEnv };
        }
        
        return await new Promise((resolve, reject) => {
            const child = spawn(pythonExecutable, args, {
                cwd,
                env: spawnEnv,
                windowsHide: true
            });
            let stdout = '';
            let stderr = '';

            child.stdout.on('data', data => {
                stdout += data.toString();
            });
            child.stderr.on('data', data => {
                stderr += data.toString();
            });
            child.on('error', err => reject(err));
            child.on('close', code => {
                if (code !== 0) {
                    const error = new Error(stderr || `Python exited with code ${code}`);
                    return reject(error);
                }
                try {
                    resolve(JSON.parse(stdout || '{}'));
                } catch (err) {
                    reject(new Error(`Failed to parse add-only response: ${err instanceof Error ? err.message : String(err)}`));
                }
            });
        });
    }

    private async retryOperation(entry: OperationEntry): Promise<void> {
        if (this._isPaused) {
             vscode.window.showErrorMessage('Cannot retry: background operations are paused.');
             return;
        }

        const runningCount = this.getRunningCount();
        const queuedCount = this.getQueuedCount();
        if (runningCount + queuedCount >= this.maxConcurrent + this.maxQueued) {
            vscode.window.showErrorMessage('Cannot retry: background queue full. Wait 30-60s and try again.');
            return;
        }

        const payload = await this.loadPayload(entry);
        if (!payload) {
            vscode.window.showErrorMessage('Cannot retry: original payload unavailable. Please capture the memory again.');
            return;
        }

        try {
            await this.runAddOnlyPayload(entry, payload);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`[ERROR] ${new Date().toISOString()} - Retry staging failed (operationId=${entry.operationId}): ${message}`);
            vscode.window.showErrorMessage(`Retry failed while staging memory: ${message}`);
            return;
        }

        await this.deleteStatusStub(entry.operationId, entry.datasetPath);

        entry.startTime = new Date().toISOString();
        entry.lastUpdate = entry.startTime;
        entry.elapsedMs = undefined;
        entry.entityCount = undefined;
        entry.errorCode = undefined;
        entry.errorMessage = undefined;
        entry.pid = null;

        if (this.getRunningCount() < this.maxConcurrent) {
            entry.status = 'running';
            entry.queueIndex = undefined;
            try {
                await this.spawnCognifyProcess(entry.operationId);
                this.outputChannel.appendLine(`[BACKGROUND] ${new Date().toISOString()} - Retry started (operationId=${entry.operationId})`);
                vscode.window.showInformationMessage('Retry started. You will be notified when processing completes.');
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                entry.status = 'failed';
                entry.errorCode = 'RETRY_SPAWN_FAILED';
                entry.errorMessage = message;
                entry.lastUpdate = new Date().toISOString();
                await this.saveLedger();
                vscode.window.showErrorMessage(`Retry failed while starting background process: ${message}`);
            }
            return;
        }

        entry.status = 'pending';
        entry.queueIndex = this.getQueuedCount();
        entry.lastUpdate = new Date().toISOString();
        await this.saveLedger();
        this.outputChannel.appendLine(`[BACKGROUND] ${new Date().toISOString()} - Retry queued for operation ${entry.operationId}`);
        vscode.window.showInformationMessage('Retry queued. It will run once current operations finish.');
    }
    
    /**
     * Get status of operation(s)
     */
    public getStatus(operationId?: string): OperationEntry | OperationEntry[] {
        if (operationId) {
            const entry = this.operations.get(operationId);
            if (!entry) {
                throw new Error(`Operation not found: ${operationId}`);
            }
            return entry;
        }
        
        return Array.from(this.operations.values());
    }
    
    /**
     * Reconcile ledger on activation
     */
    public async reconcileLedger(): Promise<void> {
        for (const [operationId, entry] of this.operations) {
            if (entry.status === 'running' && entry.pid) {
                // Check if PID still exists
                try {
                    process.kill(entry.pid, 0); // Signal 0 = existence check
                    // PID exists, try to reattach (not possible after reload, mark unknown)
                    entry.status = 'unknown';
                    entry.lastUpdate = new Date().toISOString();
                    this.outputChannel.appendLine(`[WARNING] Orphaned operation detected: ${operationId} (PID ${entry.pid})`);
                } catch (err) {
                    // PID doesn't exist
                    entry.status = 'unknown';
                    entry.errorMessage = 'Process not found after reload';
                    entry.lastUpdate = new Date().toISOString();
                    this.outputChannel.appendLine(`[WARNING] Stale operation marked unknown: ${operationId}`);
                }
            }
        }
        
        // Clean up old entries
        await this.cleanupOldEntries();
        
        await this.saveLedger();
    }
    
    /**
     * Clean up old entries (24h success, 7d failure)
     */
    private async cleanupOldEntries(): Promise<void> {
        const now = new Date();
        const successRetention = 24 * 60 * 60 * 1000; // 24 hours
        const failureRetention = 7 * 24 * 60 * 60 * 1000; // 7 days
        
        for (const [operationId, entry] of this.operations) {
            const age = now.getTime() - new Date(entry.startTime).getTime();
            
            if ((entry.status === 'completed' && age > successRetention) ||
                (entry.status === 'failed' && age > failureRetention) ||
                (entry.status === 'terminated' && age > failureRetention) ||
                (entry.status === 'unknown' && age > failureRetention)) {
                this.clearStubMonitor(operationId);
                await this.deletePayloadFile(entry);
                this.operations.delete(operationId);
            }
        }
    }
    
    /**
     * Shutdown: terminate all running processes
     */
    public async shutdown(): Promise<void> {
        this.outputChannel.appendLine('[BACKGROUND] Shutting down - terminating all running processes');
        
        for (const [operationId, _child] of this.runningProcesses) {
            const entry = this.operations.get(operationId);
            if (!entry) {continue;}
            
            try {
                // Send SIGTERM
                if (entry.pid) {
                    process.kill(entry.pid, 'SIGTERM');
                }
                
                // Wait 5 seconds then SIGKILL
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                if (entry.pid) {
                    try {
                        process.kill(entry.pid, 0); // Check if still alive
                        process.kill(entry.pid, 'SIGKILL');
                    } catch (err) {
                        // Already dead
                    }
                }
                
                entry.status = 'terminated';
                entry.errorMessage = 'Extension deactivated during cognify';
                entry.lastUpdate = new Date().toISOString();
                
            } catch (err) {
                this.outputChannel.appendLine(`[ERROR] Failed to terminate process ${entry.pid}: ${err}`);
            }
        }
        
        this.runningProcesses.clear();
        this.clearAllStubMonitors();
        await this.saveLedger();
    }
    
    /**
     * Generate UUID v4 operation ID
     */
    private generateOperationId(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    
    /**
     * Get count of running operations
     */
    private getRunningCount(): number {
        return Array.from(this.operations.values()).filter(op => op.status === 'running').length;
    }
    
    /**
     * Get count of queued operations
     */
    private getQueuedCount(): number {
        return Array.from(this.operations.values()).filter(op => op.status === 'pending').length;
    }

    /**
     * Plan 061 M5/RC3: Check if any background operations are active (running or pending)
     * Used by PythonBridgeDaemonManager to defer idle shutdown when background work is in progress.
     */
    public hasActiveOperations(): boolean {
        return this.getRunningCount() > 0 || this.getQueuedCount() > 0;
    }

    /**
     * Plan 061 M5/RC3: Get count of active operations (running + pending)
     * Useful for logging/diagnostics.
     */
    public getActiveOperationsCount(): { running: number; pending: number } {
        return {
            running: this.getRunningCount(),
            pending: this.getQueuedCount()
        };
    }
    
    /**
     * Load ledger from disk
     */
    private async loadLedger(): Promise<void> {
        if (!this.ledgerPath) {
            return;
        }
        
        try {
            const content = await fs.promises.readFile(this.ledgerPath, 'utf-8');
            const data = JSON.parse(content);
            
            this.operations.clear();
            this.runningProcesses.clear();
            this.clearAllStubMonitors();
            for (const entry of data.operations || []) {
                this.operations.set(entry.operationId, entry);
            }
            
            // Also try to load from globalState (optional in test environments)
            if (this.context?.globalState) {
                const stateData = this.context.globalState.get<OperationEntry[]>('flowbaby.backgroundOps');
                if (stateData) {
                    for (const entry of stateData) {
                        // File takes precedence
                        if (!this.operations.has(entry.operationId)) {
                            this.operations.set(entry.operationId, entry);
                        }
                    }
                }
            }
            
        } catch (err) {
            // Ledger doesn't exist yet
            this.operations.clear();
        }
    }
    
    /**
     * Save ledger to disk (atomic)
     */
    private async saveLedger(): Promise<void> {
        if (!this.ledgerPath) {
            return;
        }
        
        const data = {
            operations: Array.from(this.operations.values())
        };
        
        // Atomic write: temp file + rename
        const tempPath = `${this.ledgerPath}.tmp`;
        await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
        
        // Sync to disk (Node.js doesn't have fsync for writeFile, but rename is atomic)
        await fs.promises.rename(tempPath, this.ledgerPath);
        
        // Mirror to globalState (optional in test environments)
        if (this.context?.globalState) {
            await this.context.globalState.update('flowbaby.backgroundOps', Array.from(this.operations.values()));
        }
    }
}
