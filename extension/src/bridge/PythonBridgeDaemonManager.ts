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
const DEFAULT_IDLE_TIMEOUT_MINUTES = 5;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_BACKOFF_BASE_MS = 1000;
const RESTART_BACKOFF_MAX_MS = 30000;

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
     * Check if daemon mode is enabled
     */
    public isDaemonEnabled(): boolean {
        return this.daemonEnabled;
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
     * Internal daemon start logic
     */
    private async doStart(): Promise<void> {
        this.state = 'starting';
        const startTime = Date.now();

        try {
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
     * Stop the daemon gracefully
     */
    public async stop(): Promise<void> {
        if (this.state === 'stopped' || this.state === 'stopping') {
            return;
        }

        this.state = 'stopping';
        this.clearIdleTimer();

        try {
            if (this.daemonProcess) {
                // Try graceful shutdown first
                try {
                    await Promise.race([
                        this.sendRequest('shutdown', {}),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Shutdown timeout')), 5000)
                        )
                    ]);
                } catch {
                    // Graceful shutdown failed, force kill
                    this.log('WARN', 'Graceful shutdown failed, forcing termination');
                }

                // Ensure process is terminated
                if (this.daemonProcess) {
                    this.daemonProcess.kill('SIGTERM');
                    
                    // Wait briefly for clean exit
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    if (this.daemonProcess) {
                        this.daemonProcess.kill('SIGKILL');
                    }
                }
            }
        } finally {
            this.state = 'stopped';
            this.daemonProcess = null;
            this.deletePidFile();
        }

        this.log('INFO', 'Daemon stopped');
    }

    /**
     * Restart the daemon (stop then start)
     */
    public async restart(): Promise<void> {
        this.log('INFO', 'Restarting daemon');
        await this.stop();
        await this.start();
    }

    /**
     * Reset idle timer
     */
    private resetIdleTimer(): void {
        this.clearIdleTimer();
        
        if (this.idleTimeoutMinutes > 0) {
            this.idleTimer = setTimeout(() => {
                this.log('INFO', 'Idle timeout reached, stopping daemon');
                this.stop().catch(err => {
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
     * Write PID file for daemon tracking
     */
    private async writePidFile(): Promise<void> {
        if (!this.daemonProcess?.pid) return;

        const pidPath = path.join(this.workspacePath, '.flowbaby', 'daemon.pid');
        try {
            await fs.promises.mkdir(path.dirname(pidPath), { recursive: true });
            await fs.promises.writeFile(pidPath, String(this.daemonProcess.pid), 'utf8');
        } catch (error) {
            this.log('WARN', 'Failed to write PID file', { error: String(error) });
        }
    }

    /**
     * Delete PID file
     */
    private deletePidFile(): void {
        const pidPath = path.join(this.workspacePath, '.flowbaby', 'daemon.pid');
        try {
            fs.unlinkSync(pidPath);
        } catch {
            // Ignore errors (file may not exist)
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
     * Dispose resources
     */
    public dispose(): void {
        this.stop().catch(err => {
            this.log('ERROR', 'Error during dispose', { error: String(err) });
        });
    }
}
