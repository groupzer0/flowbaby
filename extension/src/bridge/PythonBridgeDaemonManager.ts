/**
 * PythonBridgeDaemonManager - Plan 054
 * 
 * Manages a long-lived Python bridge daemon process for each workspace.
 * Eliminates per-request Python spawn overhead (~2-3s) by keeping the
 * Python process warm with Cognee already imported.
 * 
 * @see agent-output/planning/054-python-bridge-daemon-and-request-latency.md
 * @see agent-output/architecture/054-python-bridge-daemon-architecture-findings.md
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { debugLog } from '../outputChannels';
import { v4 as uuidv4 } from 'uuid';
import { BackgroundOperationManager } from '../background/BackgroundOperationManager';

/**
 * JSON-RPC 2.0 request structure
 */
interface DaemonRequest {
    jsonrpc: '2.0';
    id: string;
    method: 'health' | 'ingest' | 'retrieve' | 'shutdown';
    params: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 success response
 */
interface DaemonSuccessResponse {
    jsonrpc: '2.0';
    id: string;
    result: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 error response
 */
interface DaemonErrorResponse {
    jsonrpc: '2.0';
    id: string;
    error: {
        code: number;
        message: string;
        data?: Record<string, unknown>;
    };
}

type DaemonResponse = DaemonSuccessResponse | DaemonErrorResponse;

/**
 * Health check result from daemon
 */
export interface DaemonHealthStatus {
    status: 'ok' | 'error';
    cognee_version?: string;
    uptime_ms?: number;
    error?: string;
}

/**
 * Daemon state for lifecycle management
 */
type DaemonState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

/**
 * Pending request tracking
 */
interface PendingRequest {
    resolve: (response: DaemonResponse) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
    method: string;
    startTime: number;
}

/**
 * Default configuration values
 */
const DEFAULT_IDLE_TIMEOUT_MINUTES = 30; // Plan 061: Increased from 5 to 30 minutes
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_BACKOFF_BASE_MS = 1000;
const RESTART_BACKOFF_MAX_MS = 30000;

/**
 * Shutdown escalation timeouts (Plan 061)
 * 
 * These define the graceful-first shutdown contract:
 * 1. Send shutdown RPC and wait for graceful exit
 * 2. If no exit after GRACEFUL_SHUTDOWN_TIMEOUT_MS, send SIGTERM
 * 3. If still no exit after SIGTERM_TIMEOUT_MS, send SIGKILL (last resort)
 */
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000;  // Wait for graceful exit after shutdown RPC
const SIGTERM_TIMEOUT_MS = 3000;            // Wait after SIGTERM before SIGKILL
const CONSECUTIVE_FORCED_KILLS_THRESHOLD = 3; // Fallback to spawn-per-request after this many forced kills

/**
 * PythonBridgeDaemonManager
 * 
 * Manages the lifecycle of a Python bridge daemon for a single workspace.
 * Provides JSON-RPC communication over stdio.
 */
export class PythonBridgeDaemonManager implements vscode.Disposable {
    private readonly workspacePath: string;
    private readonly pythonPath: string;
    private readonly bridgePath: string;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly context: vscode.ExtensionContext;

    private daemonProcess: ChildProcess | null = null;
    private state: DaemonState = 'stopped';
    private pendingRequests: Map<string, PendingRequest> = new Map();
    private restartAttempts: number = 0;
    private idleTimer: NodeJS.Timeout | null = null;
    private stdoutBuffer: string = '';
    private startupPromise: Promise<void> | null = null;
    private stopPromise: Promise<void> | null = null; // Plan 061: Prevent concurrent stops

    // Plan 061: Track consecutive forced kills for operational fallback
    private consecutiveForcedKills: number = 0;
    private daemonModeSuspended: boolean = false; // Fallback to spawn-per-request

    // Configuration (initialized in loadConfiguration, called from constructor)
    private idleTimeoutMinutes: number = DEFAULT_IDLE_TIMEOUT_MINUTES;
    private requestTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS;
    private daemonEnabled: boolean = true;

    /**
     * Constructor
     * 
     * @param workspacePath Absolute path to workspace root
     * @param pythonPath Path to Python interpreter
     * @param bridgePath Path to bridge scripts directory
     * @param context VS Code extension context
     * @param outputChannel Output channel for logging
     */
    constructor(
        workspacePath: string,
        pythonPath: string,
        bridgePath: string,
        context: vscode.ExtensionContext,
        outputChannel: vscode.OutputChannel
    ) {
        this.workspacePath = workspacePath;
        this.pythonPath = pythonPath;
        this.bridgePath = bridgePath;
        this.context = context;
        this.outputChannel = outputChannel;

        // Load configuration
        this.loadConfiguration();

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('Flowbaby')) {
                this.loadConfiguration();
            }
        });

        this.log('INFO', 'DaemonManager created', {
            workspace: workspacePath,
            pythonPath,
            bridgePath,
            daemonEnabled: this.daemonEnabled,
            idleTimeoutMinutes: this.idleTimeoutMinutes
        });
    }

    /**
     * Load configuration from VS Code settings
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('Flowbaby');
        this.daemonEnabled = config.get<string>('bridgeMode', 'daemon') === 'daemon';
        this.idleTimeoutMinutes = config.get<number>('daemonIdleTimeoutMinutes', DEFAULT_IDLE_TIMEOUT_MINUTES);
        this.requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
    }

    /**
     * Check if daemon mode is enabled and not suspended (Plan 061)
     * 
     * Returns false if:
     * - User has disabled daemon mode in settings
     * - Daemon mode is temporarily suspended due to repeated forced terminations
     */
    public isDaemonEnabled(): boolean {
        return this.daemonEnabled && !this.daemonModeSuspended;
    }

    /**
     * Check if daemon mode is suspended (Plan 061: Operational fallback)
     */
    public isDaemonSuspended(): boolean {
        return this.daemonModeSuspended;
    }

    /**
     * Resume daemon mode after suspension (Plan 061)
     * Called when a health check succeeds after suspension.
     */
    public resumeDaemonMode(): void {
        if (this.daemonModeSuspended) {
            this.log('INFO', 'Resuming daemon mode after successful health check');
            this.daemonModeSuspended = false;
            this.consecutiveForcedKills = 0;
        }
    }

    /**
     * Check if daemon is currently healthy and ready for requests
     */
    public isHealthy(): boolean {
        return this.state === 'running' && this.daemonProcess !== null;
    }

    /**
     * Get current daemon state
     */
    public getState(): DaemonState {
        return this.state;
    }

    /**
     * Start the daemon if not already running
     */
    public async start(): Promise<void> {
        if (!this.daemonEnabled) {
            this.log('DEBUG', 'Daemon mode disabled, skipping start');
            return;
        }

        if (this.state === 'running') {
            this.log('DEBUG', 'Daemon already running');
            return;
        }

        if (this.state === 'starting' && this.startupPromise) {
            this.log('DEBUG', 'Daemon already starting, waiting...');
            return this.startupPromise;
        }

        this.startupPromise = this.doStart();
        try {
            await this.startupPromise;
        } finally {
            this.startupPromise = null;
        }
    }

    /**
     * Internal daemon start logic (Plan 061: Includes startup hygiene)
     */
    private async doStart(): Promise<void> {
        this.state = 'starting';
        const startTime = Date.now();

        try {
            // Plan 061: Startup hygiene - check for orphan/stale daemons
            await this.cleanupStaleDaemon();

            const daemonScript = path.join(this.bridgePath, 'daemon.py');
            
            // Verify daemon script exists
            if (!fs.existsSync(daemonScript)) {
                throw new Error(`Daemon script not found: ${daemonScript}`);
            }

            this.log('INFO', 'Starting bridge daemon', {
                script: daemonScript,
                pythonPath: this.pythonPath,
                workspace: this.workspacePath
            });

            // Get LLM environment variables
            const llmEnv = await this.getLLMEnvironment();

            // Spawn daemon process
            const spawnOptions: SpawnOptions = {
                cwd: this.workspacePath,
                env: {
                    ...process.env,
                    PYTHONUNBUFFERED: '1',
                    ...llmEnv,
                    FLOWBABY_DAEMON_MODE: 'true',
                    FLOWBABY_WORKSPACE_PATH: this.workspacePath
                },
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe']
            };

            this.daemonProcess = spawn(this.pythonPath, [daemonScript], spawnOptions);

            if (!this.daemonProcess.stdout || !this.daemonProcess.stderr || !this.daemonProcess.stdin) {
                throw new Error('Failed to spawn daemon: stdio not available');
            }

            // Set up event handlers
            this.setupProcessHandlers();

            // Wait for ready handshake
            await this.waitForReady();

            this.state = 'running';
            this.restartAttempts = 0;
            this.resetIdleTimer();

            const startupDuration = Date.now() - startTime;
            this.log('INFO', 'Bridge daemon started successfully', {
                startupDuration_ms: startupDuration,
                pid: this.daemonProcess.pid
            });

            // Write PID file for crash recovery
            await this.writePidFile();

        } catch (error) {
            this.state = 'crashed';
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log('ERROR', 'Failed to start bridge daemon', { error: errorMessage });
            throw error;
        }
    }

    /**
     * Set up process event handlers for stdout, stderr, and lifecycle
     */
    private setupProcessHandlers(): void {
        if (!this.daemonProcess) return;

        // Handle stdout (JSON-RPC responses)
        this.daemonProcess.stdout!.on('data', (data: Buffer) => {
            this.handleStdout(data.toString());
        });

        // Handle stderr (logs)
        this.daemonProcess.stderr!.on('data', (data: Buffer) => {
            this.handleStderr(data.toString());
        });

        // Handle process exit
        this.daemonProcess.on('close', (code: number | null, signal: string | null) => {
            this.handleProcessExit(code, signal);
        });

        // Handle process errors
        this.daemonProcess.on('error', (error: Error) => {
            this.log('ERROR', 'Daemon process error', { error: error.message });
            this.handleProcessExit(null, null);
        });
    }

    /**
     * Handle stdout data (JSON-RPC responses)
     */
    private handleStdout(data: string): void {
        this.stdoutBuffer += data;

        // Process complete JSON lines
        let newlineIndex: number;
        while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
            const line = this.stdoutBuffer.substring(0, newlineIndex).trim();
            this.stdoutBuffer = this.stdoutBuffer.substring(newlineIndex + 1);

            if (line) {
                this.processJsonLine(line);
            }
        }
    }

    /**
     * Process a complete JSON-RPC response line
     */
    private processJsonLine(line: string): void {
        try {
            const response = JSON.parse(line) as DaemonResponse;

            if (!response.id) {
                this.log('WARN', 'Received response without id', { line });
                return;
            }

            const pending = this.pendingRequests.get(response.id);
            if (!pending) {
                this.log('WARN', 'Received response for unknown request', { id: response.id });
                return;
            }

            // Clear timeout and resolve
            clearTimeout(pending.timer);
            this.pendingRequests.delete(response.id);

            const duration = Date.now() - pending.startTime;
            this.log('DEBUG', 'Request completed', {
                id: response.id,
                method: pending.method,
                duration_ms: duration,
                success: !('error' in response)
            });

            pending.resolve(response);

        } catch (error) {
            this.log('ERROR', 'Failed to parse JSON response', { line, error: String(error) });
        }
    }

    /**
     * Handle stderr data (daemon logs)
     */
    private handleStderr(data: string): void {
        const lines = data.split('\n');
        for (const line of lines) {
            if (line.trim()) {
                // Forward daemon logs to output channel
                this.log('DEBUG', `[daemon] ${line.trim()}`);
            }
        }
    }

    /**
     * Handle process exit
     */
    private handleProcessExit(code: number | null, signal: string | null): void {
        const wasRunning = this.state === 'running';
        this.state = code === 0 ? 'stopped' : 'crashed';
        this.daemonProcess = null;
        this.clearIdleTimer();

        // Reject all pending requests
        for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new Error(`Daemon process exited with code ${code}, signal ${signal}`));
        }
        this.pendingRequests.clear();

        this.log('INFO', 'Daemon process exited', {
            code,
            signal,
            wasRunning,
            state: this.state
        });

        // Clean up PID file
        this.deletePidFile();

        // If it crashed while running, consider auto-restart
        if (wasRunning && this.state === 'crashed') {
            this.scheduleRestart();
        }
    }

    /**
     * Wait for the daemon to send ready signal
     */
    private async waitForReady(timeoutMs: number = 10000): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Daemon startup timeout - no ready signal received'));
            }, timeoutMs);

            // Send health check and wait for response
            this.sendRequest('health', {})
                .then(response => {
                    clearTimeout(timer);
                    if ('error' in response) {
                        reject(new Error(`Health check failed: ${response.error.message}`));
                    } else {
                        resolve();
                    }
                })
                .catch(err => {
                    clearTimeout(timer);
                    reject(err);
                });
        });
    }

    /**
     * Schedule automatic restart with exponential backoff
     */
    private scheduleRestart(): void {
        if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
            this.log('WARN', 'Max restart attempts reached, falling back to spawn-per-request', {
                attempts: this.restartAttempts
            });
            return;
        }

        const backoff = Math.min(
            RESTART_BACKOFF_BASE_MS * Math.pow(2, this.restartAttempts),
            RESTART_BACKOFF_MAX_MS
        );

        this.restartAttempts++;
        this.log('INFO', 'Scheduling daemon restart', {
            attempt: this.restartAttempts,
            backoff_ms: backoff
        });

        setTimeout(() => {
            if (this.state === 'crashed' && this.daemonEnabled) {
                this.start().catch(err => {
                    this.log('ERROR', 'Restart failed', { error: String(err) });
                });
            }
        }, backoff);
    }

    /**
     * Send a request to the daemon
     */
    public async sendRequest(
        method: 'health' | 'ingest' | 'retrieve' | 'shutdown',
        params: Record<string, unknown>,
        timeoutMs?: number
    ): Promise<DaemonResponse> {
        // Ensure daemon is running
        if (this.state !== 'running' && this.state !== 'starting') {
            if (this.daemonEnabled) {
                await this.start();
            } else {
                throw new Error('Daemon mode is disabled');
            }
        }

        // Wait for startup if in progress (but NOT if we're in 'starting' state,
        // which means we're being called from the startup flow itself e.g. health check)
        if (this.startupPromise && this.state !== 'starting') {
            await this.startupPromise;
        }

        if (!this.daemonProcess?.stdin) {
            throw new Error('Daemon process not available');
        }

        const requestId = uuidv4();
        const request: DaemonRequest = {
            jsonrpc: '2.0',
            id: requestId,
            method,
            params
        };

        const timeout = timeoutMs ?? this.requestTimeoutMs;
        const startTime = Date.now();

        return new Promise((resolve, reject) => {
            // Set up timeout
            const timer = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`Request timeout after ${timeout}ms`));
            }, timeout);

            // Track pending request
            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                timer,
                method,
                startTime
            });

            // Send request
            try {
                const requestLine = JSON.stringify(request) + '\n';
                this.daemonProcess!.stdin!.write(requestLine, (err) => {
                    if (err) {
                        clearTimeout(timer);
                        this.pendingRequests.delete(requestId);
                        reject(new Error(`Failed to write request: ${err.message}`));
                    }
                });
            } catch (error) {
                clearTimeout(timer);
                this.pendingRequests.delete(requestId);
                reject(error);
            }

            // Reset idle timer on activity
            this.resetIdleTimer();
        });
    }

    /**
     * Stop the daemon gracefully (Plan 061: Graceful-first with conditional escalation)
     * 
     * Shutdown contract:
     * 1. Send shutdown RPC and wait for process exit (graceful)
     * 2. If no exit after GRACEFUL_SHUTDOWN_TIMEOUT_MS, send SIGTERM (escalated)
     * 3. If no exit after SIGTERM_TIMEOUT_MS, send SIGKILL (forced - last resort)
     * 
     * Each phase is logged for observability. Consecutive forced kills trigger
     * operational fallback to spawn-per-request mode.
     */
    public async stop(reason: string = 'requested'): Promise<void> {
        // Idempotent: if already stopped or stopping, wait for existing stop
        if (this.state === 'stopped') {
            return;
        }

        if (this.state === 'stopping' && this.stopPromise) {
            this.log('DEBUG', 'Stop already in progress, waiting...');
            return this.stopPromise;
        }

        this.stopPromise = this.doStop(reason);
        try {
            await this.stopPromise;
        } finally {
            this.stopPromise = null;
        }
    }

    /**
     * Internal stop implementation with graceful-first shutdown contract
     */
    private async doStop(reason: string): Promise<void> {
        this.state = 'stopping';
        this.clearIdleTimer();

        const pid = this.daemonProcess?.pid;
        let shutdownOutcome: 'graceful' | 'escalated' | 'forced' = 'graceful';

        this.log('INFO', 'Shutdown requested', { reason, pid });

        try {
            if (!this.daemonProcess) {
                this.log('DEBUG', 'No daemon process to stop');
                return;
            }

            // Create a promise that resolves when the process exits
            const processExitPromise = new Promise<void>((resolve) => {
                if (!this.daemonProcess) {
                    resolve();
                    return;
                }
                const onExit = () => {
                    this.daemonProcess?.removeListener('close', onExit);
                    this.daemonProcess?.removeListener('exit', onExit);
                    resolve();
                };
                this.daemonProcess.once('close', onExit);
                this.daemonProcess.once('exit', onExit);
            });

            // Phase 1: Send shutdown RPC and wait for graceful exit
            this.log('DEBUG', 'Phase 1: Sending shutdown RPC, waiting for graceful exit', {
                timeout_ms: GRACEFUL_SHUTDOWN_TIMEOUT_MS
            });

            try {
                // Send shutdown request (don't await the response, just the write)
                const shutdownSent = this.sendShutdownRequest();
                
                // Wait for either: process exit OR graceful timeout
                const gracefulResult = await Promise.race([
                    processExitPromise.then(() => 'exited' as const),
                    shutdownSent.then(() => 
                        new Promise<'timeout'>((resolve) => 
                            setTimeout(() => resolve('timeout'), GRACEFUL_SHUTDOWN_TIMEOUT_MS)
                        )
                    )
                ]);

                if (gracefulResult === 'exited') {
                    this.log('INFO', 'Graceful shutdown succeeded', { pid, phase: 1 });
                    shutdownOutcome = 'graceful';
                    this.consecutiveForcedKills = 0; // Reset on graceful exit
                    return;
                }
            } catch (error) {
                this.log('DEBUG', 'Shutdown RPC failed, proceeding to SIGTERM', { 
                    error: String(error) 
                });
            }

            // Phase 2: SIGTERM (if process still alive)
            if (this.daemonProcess && !this.daemonProcess.killed) {
                shutdownOutcome = 'escalated';
                this.log('WARN', 'Phase 2: Graceful shutdown timeout, sending SIGTERM', {
                    pid,
                    timeout_ms: SIGTERM_TIMEOUT_MS
                });

                // Platform-aware: SIGTERM on POSIX, taskkill on Windows
                if (process.platform === 'win32') {
                    // On Windows, use taskkill for cleaner termination
                    try {
                        const { execSync } = require('child_process');
                        execSync(`taskkill /PID ${pid} /T`, { timeout: 1000 });
                    } catch {
                        // taskkill may fail if already exited, continue to check
                    }
                } else {
                    this.daemonProcess.kill('SIGTERM');
                }

                // Wait for exit after SIGTERM
                const sigtermResult = await Promise.race([
                    processExitPromise.then(() => 'exited' as const),
                    new Promise<'timeout'>((resolve) => 
                        setTimeout(() => resolve('timeout'), SIGTERM_TIMEOUT_MS)
                    )
                ]);

                if (sigtermResult === 'exited') {
                    this.log('INFO', 'Process exited after SIGTERM', { pid, phase: 2 });
                    this.consecutiveForcedKills = 0; // SIGTERM is still relatively clean
                    return;
                }
            }

            // Phase 3: SIGKILL (last resort)
            if (this.daemonProcess && !this.daemonProcess.killed) {
                shutdownOutcome = 'forced';
                this.consecutiveForcedKills++;
                
                this.log('ERROR', 'Phase 3: SIGTERM timeout, sending SIGKILL (forced termination)', {
                    pid,
                    consecutiveForcedKills: this.consecutiveForcedKills,
                    threshold: CONSECUTIVE_FORCED_KILLS_THRESHOLD
                });

                if (process.platform === 'win32') {
                    try {
                        const { execSync } = require('child_process');
                        execSync(`taskkill /PID ${pid} /F /T`, { timeout: 1000 });
                    } catch {
                        // Ignore errors - process may have exited
                    }
                } else {
                    this.daemonProcess.kill('SIGKILL');
                }

                // Brief wait for OS to clean up
                await new Promise(resolve => setTimeout(resolve, 100));

                // Check if we need to fall back to spawn-per-request
                if (this.consecutiveForcedKills >= CONSECUTIVE_FORCED_KILLS_THRESHOLD) {
                    this.daemonModeSuspended = true;
                    this.log('WARN', 'Daemon mode suspended: too many forced terminations', {
                        consecutiveForcedKills: this.consecutiveForcedKills,
                        action: 'Falling back to spawn-per-request mode. Daemon mode will resume on next successful health check.'
                    });
                }
            }

        } finally {
            this.state = 'stopped';
            this.daemonProcess = null;
            this.deletePidFile();
            
            this.log('INFO', 'Daemon stopped', { 
                reason, 
                outcome: shutdownOutcome,
                pid 
            });
        }
    }

    /**
     * Send shutdown request without waiting for response
     * (The daemon may exit before sending a response)
     */
    private async sendShutdownRequest(): Promise<void> {
        if (!this.daemonProcess?.stdin) {
            throw new Error('No stdin available');
        }

        const request = {
            jsonrpc: '2.0',
            id: uuidv4(),
            method: 'shutdown',
            params: {}
        };

        return new Promise((resolve, reject) => {
            const requestLine = JSON.stringify(request) + '\n';
            this.daemonProcess!.stdin!.write(requestLine, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Restart the daemon (stop then start)
     */
    public async restart(): Promise<void> {
        this.log('INFO', 'Restarting daemon');
        await this.stop('restart');
        await this.start();
    }

    /**
     * Reset idle timer (Plan 061: Manager-owned idle semantics)
     * 
     * The TypeScript daemon manager is the single authoritative owner of idle-timeout
     * shutdown decisions. "Idle" is defined as:
     * - No in-flight daemon requests
     * - No active background operations (running or pending) that depend on the workspace DB
     * - No shutdown sequence in progress
     * 
     * The daemon must not unilaterally self-terminate on idle.
     */
    private resetIdleTimer(): void {
        this.clearIdleTimer();
        
        if (this.idleTimeoutMinutes > 0 && this.state === 'running') {
            this.idleTimer = setTimeout(() => {
                // Plan 061: Check for in-flight requests before triggering idle shutdown
                if (this.pendingRequests.size > 0) {
                    this.log('DEBUG', 'Idle timeout deferred: requests still in flight', {
                        pendingCount: this.pendingRequests.size
                    });
                    // Reset timer to check again later
                    this.resetIdleTimer();
                    return;
                }

                // Plan 061 M5/RC3: Check for active background operations
                try {
                    const bgManager = BackgroundOperationManager.getInstance();
                    if (bgManager.hasActiveOperations()) {
                        const counts = bgManager.getActiveOperationsCount();
                        this.log('DEBUG', 'Idle timeout deferred: background operations active', {
                            running: counts.running,
                            pending: counts.pending
                        });
                        // Reset timer to check again later
                        this.resetIdleTimer();
                        return;
                    }
                } catch {
                    // BackgroundOperationManager not initialized - proceed with shutdown check
                    // This is expected during early startup or in test scenarios
                }

                // Check for stopping state (avoid double-stop)
                if (this.state === 'stopping') {
                    this.log('DEBUG', 'Idle timeout skipped: already stopping');
                    return;
                }

                this.log('INFO', 'Idle timeout reached, stopping daemon', {
                    idleTimeoutMinutes: this.idleTimeoutMinutes
                });
                this.stop('idle-timeout').catch(err => {
                    this.log('ERROR', 'Error stopping daemon on idle timeout', { error: String(err) });
                });
            }, this.idleTimeoutMinutes * 60 * 1000);
        }
    }

    /**
     * Clear idle timer
     */
    private clearIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    /**
     * Get LLM environment variables from extension context
     */
    private async getLLMEnvironment(): Promise<Record<string, string>> {
        const env: Record<string, string> = {};

        // Get API key from SecretStorage
        try {
            const apiKey = await this.context.secrets.get('flowbaby.llmApiKey');
            if (apiKey) {
                env['LLM_API_KEY'] = apiKey;
            }
        } catch (error) {
            this.log('WARN', 'Failed to get API key from SecretStorage', { error: String(error) });
        }

        // Get LLM configuration from settings
        const config = vscode.workspace.getConfiguration('Flowbaby.llm');
        const provider = config.get<string>('provider');
        const model = config.get<string>('model');
        const endpoint = config.get<string>('endpoint');

        if (provider) env['LLM_PROVIDER'] = provider;
        if (model) env['LLM_MODEL'] = model;
        if (endpoint) env['LLM_ENDPOINT'] = endpoint;

        return env;
    }

    /**
     * Get the primary PID file path (Plan 061: standardized under .flowbaby/)
     * Note: Architecture prefers .cognee/ but existing implementation uses .flowbaby/
     * Migration path: check both locations, write to primary, clean up legacy
     */
    private getPidFilePath(): string {
        return path.join(this.workspacePath, '.flowbaby', 'daemon.pid');
    }

    /**
     * Get legacy PID file paths that should be checked and migrated
     */
    private getLegacyPidFilePaths(): string[] {
        return [
            path.join(this.workspacePath, '.cognee', 'daemon.pid'),
            // Add other legacy locations here if needed
        ];
    }

    /**
     * Check if a process with given PID is still alive
     */
    private isProcessAlive(pid: number): boolean {
        try {
            // Sending signal 0 checks if process exists without killing it
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Plan 061: Startup hygiene - cleanup stale daemon and prevent double-start
     * 
     * 1. Check for existing PID file
     * 2. If PID exists and process is alive, reuse or stop it
     * 3. If PID exists but process is dead (stale), clean up
     * 4. Check and migrate legacy PID locations
     */
    private async cleanupStaleDaemon(): Promise<void> {
        const primaryPidPath = this.getPidFilePath();
        const legacyPaths = this.getLegacyPidFilePaths();

        // Check primary location first
        await this.checkAndCleanPidFile(primaryPidPath, 'primary');

        // Check and clean legacy locations
        for (const legacyPath of legacyPaths) {
            await this.checkAndCleanPidFile(legacyPath, 'legacy');
        }
    }

    /**
     * Check a PID file and handle stale/orphan cases
     */
    private async checkAndCleanPidFile(pidPath: string, location: string): Promise<void> {
        try {
            const pidContent = await fs.promises.readFile(pidPath, 'utf8');
            const pid = parseInt(pidContent.trim(), 10);

            if (isNaN(pid)) {
                this.log('WARN', `Invalid PID file content at ${location}`, { pidPath });
                await this.removePidFile(pidPath);
                return;
            }

            if (this.isProcessAlive(pid)) {
                // Process is still running - this could be:
                // 1. A legitimate daemon from this workspace (should reuse)
                // 2. An orphaned daemon that didn't clean up
                // 3. PID reuse (different process using same PID)
                this.log('WARN', `Found running process from ${location} PID file`, { 
                    pid, 
                    pidPath,
                    action: 'Attempting to stop before starting new daemon'
                });

                // Try to stop the existing process gracefully
                try {
                    if (process.platform === 'win32') {
                        const { execSync } = require('child_process');
                        execSync(`taskkill /PID ${pid} /T`, { timeout: 2000 });
                    } else {
                        process.kill(pid, 'SIGTERM');
                    }
                    // Wait for process to exit
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch {
                    // Process may have already exited, continue
                }

                // Clean up the PID file
                await this.removePidFile(pidPath);
            } else {
                // Stale PID file - process no longer exists
                this.log('INFO', `Cleaning up stale ${location} PID file`, { pid, pidPath });
                await this.removePidFile(pidPath);
            }
        } catch (error) {
            // PID file doesn't exist or can't be read - that's fine
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                this.log('DEBUG', `Error checking ${location} PID file`, { 
                    pidPath, 
                    error: String(error) 
                });
            }
        }
    }

    /**
     * Remove a PID file safely
     */
    private async removePidFile(pidPath: string): Promise<void> {
        try {
            await fs.promises.unlink(pidPath);
        } catch {
            // Ignore errors - file may not exist
        }
    }

    /**
     * Write PID file for daemon tracking
     */
    private async writePidFile(): Promise<void> {
        if (!this.daemonProcess?.pid) return;

        const pidPath = this.getPidFilePath();
        try {
            await fs.promises.mkdir(path.dirname(pidPath), { recursive: true });
            await fs.promises.writeFile(pidPath, String(this.daemonProcess.pid), 'utf8');
            this.log('DEBUG', 'PID file written', { pid: this.daemonProcess.pid, pidPath });
        } catch (error) {
            this.log('WARN', 'Failed to write PID file', { error: String(error) });
        }
    }

    /**
     * Delete PID file
     */
    private deletePidFile(): void {
        const pidPath = this.getPidFilePath();
        try {
            fs.unlinkSync(pidPath);
        } catch {
            // Ignore errors (file may not exist)
        }

        // Also clean up any legacy locations
        for (const legacyPath of this.getLegacyPidFilePaths()) {
            try {
                fs.unlinkSync(legacyPath);
            } catch {
                // Ignore errors
            }
        }
    }

    /**
     * Log helper
     */
    private log(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string, data?: Record<string, unknown>): void {
        const timestamp = new Date().toISOString();
        const dataStr = data ? ` ${JSON.stringify(data)}` : '';
        const logLine = `[${timestamp}] [${level}] [DaemonManager] ${message}${dataStr}`;
        try {
            this.outputChannel.appendLine(logLine);
        } catch {
            // In tests or during VS Code shutdown the underlying channel may be closed.
            // Swallow logging errors to avoid breaking workflows on teardown.
        }
        
        if (level === 'DEBUG') {
            debugLog(message, data);
        }
    }

    /**
     * Dispose resources (Plan 061: Graceful cleanup on deactivate)
     */
    public dispose(): void {
        this.stop('extension-deactivate').catch(err => {
            this.log('ERROR', 'Error during dispose', { error: String(err) });
        });
    }
}
