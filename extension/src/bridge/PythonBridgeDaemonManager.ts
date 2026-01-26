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
import { debugLog, isDebugLoggingEnabled, stripAnsiCodes } from '../outputChannels';
import { v4 as uuidv4 } from 'uuid';
import { BackgroundOperationManager } from '../background/BackgroundOperationManager';
// Plan 116: Import reliability contract types
import {
    DaemonUnavailableReason,
    DaemonUnavailableError,
    DaemonState as ContractDaemonState,
    StartupAttempt,
    LastFailureRecord,
    RecoveryState,
    DAEMON_RELIABILITY_DEFAULTS,
    DaemonDiagnosticReport
} from './daemonReliabilityContract';
// Plan 081: Import Cloud provider for Bedrock credentials
// Plan 083: Import FlowbabyCloudError to preserve error codes end-to-end
// Plan 087: Import getReadinessService for user-visible error surfacing
import { isProviderInitialized, getFlowbabyCloudEnvironment, isFlowbabyCloudEnabled, FlowbabyCloudError, getReadinessService } from '../flowbaby-cloud';

/**
 * JSON-RPC 2.0 request structure
 */
interface DaemonRequest {
    jsonrpc: '2.0';
    id: string;
    method: 'health' | 'ingest' | 'retrieve' | 'shutdown' | 'cognify' | 'visualize';
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
 * Plan 116: Added 'failed_startup' and 'degraded' states
 */
type DaemonState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed' | 'failed_startup' | 'degraded';

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
 * Plan 095: Lock owner metadata for stale lock detection
 * Written to owner.json inside the daemon.lock directory
 */
interface LockOwnerMetadata {
    /** Timestamp when lock was acquired (ms since epoch) */
    createdAt: number;
    /** PID of the VS Code extension host process that holds the lock */
    extensionHostPid: number;
    /** Random UUID generated per lock acquisition attempt (for log correlation) */
    instanceId: string;
    /** Workspace identifier (hashed or relative path marker) */
    workspaceIdentifier: string;
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
const CONSECUTIVE_FORCED_KILLS_THRESHOLD = 3; // Plan 116: enter degraded mode after this many forced kills

/**
 * Plan 116: Bounded startup deadline constants
 * 
 * Single deadline covers: lock acquisition + spawn + readiness handshake.
 * Startup must always settle within this deadline.
 */
const STARTUP_DEADLINE_MS = DAEMON_RELIABILITY_DEFAULTS.STARTUP_DEADLINE_MS;
const HANDSHAKE_TIMEOUT_MS = DAEMON_RELIABILITY_DEFAULTS.HANDSHAKE_TIMEOUT_MS;
const MAX_RECOVERY_ATTEMPTS = DAEMON_RELIABILITY_DEFAULTS.MAX_RECOVERY_ATTEMPTS;
const RECOVERY_BACKOFF_BASE_MS = DAEMON_RELIABILITY_DEFAULTS.RECOVERY_BACKOFF_BASE_MS;
const RECOVERY_BACKOFF_MAX_MS = DAEMON_RELIABILITY_DEFAULTS.RECOVERY_BACKOFF_MAX_MS;

/**
 * Plan 095: Stale lock recovery constants
 * 
 * Conservative threshold for determining lock staleness when owner metadata
 * is missing or corrupt. Only locks older than this threshold (and with no
 * alive daemon process) are considered stale.
 */
const STALE_LOCK_AGE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

const PYTHON_SPAWN_WAIT_FOR_REFRESH_MS = 15000;
const PYTHON_SPAWN_POLL_INTERVAL_MS = 250;

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
    private daemonModeSuspended: boolean = false; // Plan 116: memory ops unavailable when suspended

    // Plan 116: Bounded startup and recovery tracking
    private currentStartupAttempt: StartupAttempt | null = null;
    private lastFailure: LastFailureRecord | null = null;
    private recoveryState: RecoveryState = {
        attempts: 0,
        maxAttempts: MAX_RECOVERY_ATTEMPTS,
        active: false,
        cooldownMs: RECOVERY_BACKOFF_BASE_MS
    };
    private startupStderrBuffer: string[] = []; // Capture stderr during startup for diagnostics

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

    private async pathExists(candidatePath: string): Promise<boolean> {
        try {
            await fs.promises.access(candidatePath);
            return true;
        } catch {
            return false;
        }
    }

    private async resolvePythonPathForSpawn(): Promise<string> {
        // If user provided a command on PATH (e.g., python3), we can't reliably preflight existence.
        if (!path.isAbsolute(this.pythonPath)) {
            return this.pythonPath;
        }

        if (await this.pathExists(this.pythonPath)) {
            return this.pythonPath;
        }

        // The managed environment refresh flow temporarily renames venv -> venv.backup
        // while recreating it. If we see that backup, wait briefly for venv to return.
        const flowbabyVenvBackup = path.join(this.workspacePath, '.flowbaby', 'venv.backup');
        const legacyVenvBackup = path.join(this.workspacePath, '.venv.backup');
        const refreshInProgress = (await this.pathExists(flowbabyVenvBackup)) || (await this.pathExists(legacyVenvBackup));

        if (refreshInProgress) {
            const deadline = Date.now() + PYTHON_SPAWN_WAIT_FOR_REFRESH_MS;
            while (Date.now() < deadline) {
                if (await this.pathExists(this.pythonPath)) {
                    this.log('INFO', 'Python executable became available after waiting for refresh', {
                        pythonPath: this.pythonPath
                    });
                    return this.pythonPath;
                }
                await new Promise(resolve => setTimeout(resolve, PYTHON_SPAWN_POLL_INTERVAL_MS));
            }
        }

        // Fall back to common managed locations if the stored path is stale.
        const candidates: string[] = [];
        if (process.platform === 'win32') {
            candidates.push(
                path.join(this.workspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe'),
                path.join(this.workspacePath, '.venv', 'Scripts', 'python.exe')
            );
        } else {
            candidates.push(
                path.join(this.workspacePath, '.flowbaby', 'venv', 'bin', 'python'),
                path.join(this.workspacePath, '.venv', 'bin', 'python')
            );
        }

        for (const candidate of candidates) {
            if (await this.pathExists(candidate)) {
                this.log('WARN', 'Configured Python path missing; falling back to discovered interpreter', {
                    configured: this.pythonPath,
                    fallback: candidate
                });
                return candidate;
            }
        }

        throw new Error(
            `Python executable not found: ${this.pythonPath}. ` +
            `If Flowbaby is refreshing dependencies, wait a moment and retry. ` +
            `Otherwise, run “Flowbaby: Refresh Dependencies” (or re-initialize the workspace environment) ` +
            `or set Flowbaby.pythonPath to a valid interpreter.`
        );
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
     * Plan 116 M6: Get comprehensive diagnostic report for troubleshooting.
     * Used by "Flowbaby: Diagnose Daemon" command.
     */
    public getDiagnostics(): DaemonDiagnosticReport {
        // Calculate uptime if daemon is running
        let uptime: number | undefined;
        if (this.state === 'running' && this.currentStartupAttempt?.startedAt) {
            uptime = Date.now() - this.currentStartupAttempt.startedAt;
        }

        // Try to read lock owner metadata if lock exists
        let lockOwner: DaemonDiagnosticReport['lock']['owner'] | undefined;
        const lockPath = this.getLockPath();
        const ownerPath = path.join(lockPath, 'owner.json');
        try {
            if (fs.existsSync(ownerPath)) {
                const ownerData = JSON.parse(fs.readFileSync(ownerPath, 'utf-8'));
                lockOwner = {
                    pid: ownerData.pid,
                    hostname: ownerData.hostname,
                    workspacePath: ownerData.workspacePath,
                    acquiredAt: ownerData.acquiredAt
                };
            }
        } catch {
            // Ignore errors reading lock owner
        }

        // Generate remediation hints based on current state
        const remediationHints = this.generateRemediationHints();

        // Determine logs path (daemon writes to .flowbaby/logs/daemon.log)
        const logsPath = path.join(this.workspacePath, '.flowbaby', 'logs', 'daemon.log');

        return {
            state: this.state,
            healthy: this.isHealthy(),
            daemonModeEnabled: this.daemonEnabled,
            daemonModeSuspended: this.daemonModeSuspended,
            lastFailure: this.lastFailure,
            recovery: {
                active: this.recoveryState.active,
                attempts: this.recoveryState.attempts,
                maxAttempts: this.recoveryState.maxAttempts,
                cooldownMs: this.recoveryState.cooldownMs,
                nextAttemptAt: this.recoveryState.nextAttemptAt
            },
            lock: {
                held: this.lockHeld,
                lockPath,
                owner: lockOwner
            },
            runtime: {
                pid: this.daemonProcess?.pid,
                uptime,
                pendingRequests: this.pendingRequests.size
            },
            logsPath,
            remediationHints
        };
    }

    /**
     * Plan 116 M6: Generate remediation hints based on current daemon state.
     */
    private generateRemediationHints(): string[] {
        const hints: string[] = [];

        switch (this.state) {
            case 'stopped':
                hints.push('Daemon is stopped. Reload the workspace or run a memory operation to start it.');
                break;

            case 'starting':
                hints.push('Daemon is currently starting. Please wait for startup to complete.');
                break;

            case 'failed_startup':
                hints.push('Daemon failed to start.');
                if (this.lastFailure) {
                    switch (this.lastFailure.reason) {
                        case DaemonUnavailableReason.SPAWN_FAILED:
                            hints.push('Check that the Python path is correct and Python is installed.');
                            hints.push('Run "Flowbaby: Diagnose Environment" to check Python setup.');
                            break;
                        case DaemonUnavailableReason.STARTUP_TIMEOUT:
                        case DaemonUnavailableReason.STARTUP_HUNG:
                            hints.push('The daemon process started but did not become ready.');
                            hints.push('Check daemon.log for errors. You may need to reinstall dependencies.');
                            break;
                        case DaemonUnavailableReason.HANDSHAKE_FAILED:
                            hints.push('Daemon started but health check failed.');
                            hints.push('Check daemon.log for Python errors or missing dependencies.');
                            break;
                        case DaemonUnavailableReason.STDIO_UNAVAILABLE:
                            hints.push('Could not communicate with daemon process.');
                            hints.push('This may indicate a system resource issue. Try restarting VS Code.');
                            break;
                        case DaemonUnavailableReason.LOCK_HELD:
                        case DaemonUnavailableReason.LOCK_ACQUISITION_FAILED:
                            hints.push('Another process holds the daemon lock.');
                            hints.push('Close other VS Code windows in this workspace, or restart VS Code.');
                            break;
                        default:
                            hints.push('Check daemon.log for details on the failure.');
                    }
                }
                break;

            case 'degraded':
                hints.push('Daemon recovery has been exhausted after multiple attempts.');
                hints.push(`Recovery attempts: ${this.recoveryState.attempts}/${this.recoveryState.maxAttempts}`);
                hints.push('Restart VS Code or reload the workspace to reset recovery budget.');
                if (this.lastFailure?.stderrTail) {
                    hints.push('Last error output may contain useful diagnostic information.');
                }
                break;

            case 'crashed':
                hints.push('Daemon process crashed unexpectedly.');
                hints.push('Check daemon.log for crash details.');
                hints.push('The daemon will attempt automatic recovery.');
                break;

            case 'running':
                hints.push('Daemon is running normally.');
                if (this.pendingRequests.size > 0) {
                    hints.push(`${this.pendingRequests.size} request(s) are currently pending.`);
                }
                break;

            case 'stopping':
                hints.push('Daemon is shutting down. Please wait.');
                break;
        }

        // Add general hints
        if (!this.daemonEnabled) {
            hints.push('Note: Daemon mode is disabled in settings. Memory operations will be unavailable.');
        }
        if (this.daemonModeSuspended) {
            hints.push('Warning: Daemon mode is temporarily suspended due to repeated failures.');
        }

        return hints;
    }

    /**
     * Plan 092 M1: Get the number of pending requests.
     * Required by IDaemonController interface for drain monitoring
     * during credential refresh coordination.
     */
    public getPendingRequestCount(): number {
        return this.pendingRequests.size;
    }

    /**
     * Plan 092 M1: Check if the daemon is currently running.
     * Required by IDaemonController interface for restart coordination
     * during credential refresh.
     */
    public isRunning(): boolean {
        return this.state === 'running' && this.daemonProcess !== null;
    }

    // ==========================================================================
    // Plan 092 M2: Exclusive Daemon Locking
    // ==========================================================================

    /** Tracks whether this manager holds the workspace lock */
    private lockHeld: boolean = false;

    /**
     * Plan 092 M2: Get the path to the lock directory.
     * Lock is placed in the workspace's .flowbaby directory to ensure
     * workspace-scoped exclusivity.
     */
    public getLockPath(): string {
        return path.join(this.workspacePath, '.flowbaby', 'daemon.lock');
    }

    /**
     * Plan 092 M2: Check if this manager holds the lock.
     */
    public isLockHeld(): boolean {
        return this.lockHeld;
    }

    /**
     * Plan 095: Get the path to the owner metadata file inside the lock directory.
     */
    private getOwnerMetadataPath(): string {
        return path.join(this.getLockPath(), 'owner.json');
    }

    /**
     * Plan 095: Write owner metadata to the lock directory.
     * Called immediately after successful lock acquisition.
     */
    private async writeLockOwnerMetadata(instanceId: string): Promise<void> {
        const ownerPath = this.getOwnerMetadataPath();
        const metadata: LockOwnerMetadata = {
            createdAt: Date.now(),
            extensionHostPid: process.pid,
            instanceId,
            workspaceIdentifier: path.basename(this.workspacePath) // Use basename to avoid absolute paths in metadata
        };

        try {
            await fs.promises.writeFile(ownerPath, JSON.stringify(metadata, null, 2), 'utf8');
            this.log('INFO', '[lock] owner metadata written', {
                instanceId,
                pid: process.pid
            });
        } catch (error) {
            this.log('WARN', '[lock] failed to write owner metadata', {
                error: error instanceof Error ? error.message : String(error)
            });
            // Don't throw - lock is still valid, just missing metadata
        }
    }

    /**
     * Plan 095: Read owner metadata from an existing lock directory.
     * Returns null if metadata doesn't exist or is corrupt.
     */
    private async readLockOwnerMetadata(): Promise<LockOwnerMetadata | null> {
        const ownerPath = this.getOwnerMetadataPath();
        try {
            const content = await fs.promises.readFile(ownerPath, 'utf8');
            const metadata = JSON.parse(content) as LockOwnerMetadata;
            // Validate required fields
            if (typeof metadata.createdAt !== 'number' ||
                typeof metadata.extensionHostPid !== 'number' ||
                typeof metadata.instanceId !== 'string') {
                return null;
            }
            return metadata;
        } catch {
            return null;
        }
    }

    /**
     * Plan 095: Determine if a lock is stale and can be recovered.
     * 
     * A lock is stale if:
     * 1. The daemon PID (from daemon.pid) is not alive, AND
     * 2. Either:
     *    a. Owner metadata exists and extensionHostPid is not alive, OR
     *    b. Owner metadata is missing/corrupt AND lock age exceeds threshold
     * 
     * Returns { stale: boolean, reason: string } for observability.
     */
    private async isLockStale(): Promise<{ stale: boolean; reason: string }> {
        const pidPath = this.getPidFilePath();
        const lockPath = this.getLockPath();

        // First check: is the daemon process alive?
        try {
            const pidContent = await fs.promises.readFile(pidPath, 'utf8');
            const daemonPid = parseInt(pidContent.trim(), 10);
            if (!isNaN(daemonPid) && this.isProcessAlive(daemonPid)) {
                return { stale: false, reason: 'daemon_pid_alive' };
            }
        } catch {
            // PID file doesn't exist - continue to owner check
        }

        // Second check: owner metadata
        const metadata = await this.readLockOwnerMetadata();
        if (metadata) {
            if (this.isProcessAlive(metadata.extensionHostPid)) {
                return { stale: false, reason: 'owner_pid_alive' };
            }
            return { stale: true, reason: 'owner_pid_dead' };
        }

        // Third check: no metadata - use age threshold (fail-safe policy)
        try {
            const stat = await fs.promises.stat(lockPath);
            const lockAge = Date.now() - stat.mtimeMs;
            if (lockAge > STALE_LOCK_AGE_THRESHOLD_MS) {
                return { stale: true, reason: 'lock_age_exceeded' };
            }
            // Fresh lock without metadata - could be a race condition
            return { stale: false, reason: 'fresh_lock_no_metadata' };
        } catch {
            // Can't stat lock - treat as stale (lock may have been removed)
            return { stale: true, reason: 'lock_stat_failed' };
        }
    }

    /**
     * Plan 095: Attempt to recover a stale lock.
     * Removes the lock directory and returns true if recovery succeeded.
     */
    private async recoverStaleLock(reason: string): Promise<boolean> {
        const lockPath = this.getLockPath();
        this.log('INFO', '[lock] attempting stale lock recovery', { reason });

        try {
            // Use recursive rm to handle directory with contents (fixes Windows ENOTEMPTY)
            // This handles owner.json and any other files that may exist in the lock directory
            await fs.promises.rm(lockPath, { recursive: true, force: true });
            this.log('INFO', '[lock] stale lock recovered successfully', { reason });
            return true;
        } catch (error) {
            this.log('WARN', '[lock] stale lock recovery failed', {
                reason,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Plan 092 M2 + Plan 095: Acquire exclusive lock for daemon management.
     * Uses atomic directory creation (mkdir) which is a POSIX-guaranteed
     * atomic operation - only one process can successfully create a directory.
     * 
     * Plan 095 enhancements:
     * - Writes owner metadata immediately after acquisition
     * - On EEXIST, attempts bounded stale lock recovery
     * - Emits structured breadcrumbs for observability
     * 
     * @returns true if lock acquired, false if lock already held by another process
     */
    public async acquireLock(): Promise<boolean> {
        if (this.lockHeld) {
            this.log('DEBUG', '[lock] already held by this manager');
            return true;
        }

        const lockPath = this.getLockPath();
        const instanceId = uuidv4(); // Generate per-acquisition for log correlation

        // Plan 115 M1: Add correlation fields to lock acquire log
        this.log('INFO', '[lock] acquire start', { 
            instanceId,
            sessionId: vscode.env.sessionId,
            extensionHostPid: process.pid
        });

        try {
            // Ensure .flowbaby directory exists
            const flowbabyDir = path.dirname(lockPath);
            await fs.promises.mkdir(flowbabyDir, { recursive: true });

            // Try to create lock directory atomically
            // mkdir without recursive option will fail with EEXIST if directory exists
            await fs.promises.mkdir(lockPath);

            this.lockHeld = true;

            // Write owner metadata immediately after acquisition
            await this.writeLockOwnerMetadata(instanceId);

            // Plan 115 M1: Add correlation fields to lock acquire success log
            this.log('INFO', '[lock] acquire success', { 
                instanceId, 
                extensionHostPid: process.pid,
                sessionId: vscode.env.sessionId
            });
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
                // Plan 095: EEXIST recovery - check if lock is stale
                // Plan 115 M5: Log bounded snapshot of existing lock owner metadata for contention diagnosis
                this.log('INFO', '[lock] EEXIST - checking staleness', { instanceId });

                // Plan 115 M5: Read existing lock owner metadata for contention breadcrumbs
                const existingOwner = await this.readLockOwnerMetadata();
                const lockAge = existingOwner ? Date.now() - existingOwner.createdAt : null;
                const ownerPidAlive = existingOwner ? this.isProcessAlive(existingOwner.extensionHostPid) : null;

                const { stale, reason } = await this.isLockStale();

                if (!stale) {
                    // Plan 115 M5: Log contention breadcrumbs when lock is held by another process
                    this.log('WARN', '[lock] acquire failed - lock held by another process', {
                        instanceId,
                        reason,
                        // Plan 115 M5: Bounded snapshot of existing lock owner (no absolute paths)
                        ownerPid: existingOwner?.extensionHostPid,
                        ownerInstanceId: existingOwner?.instanceId,
                        lockAge,
                        ownerPidAlive,
                        // Plan 115 M1: Correlation fields
                        sessionId: vscode.env.sessionId,
                        extensionHostPid: process.pid
                    });
                    return false;
                }

                // Attempt bounded recovery (exactly once)
                const recovered = await this.recoverStaleLock(reason);
                if (!recovered) {
                    this.log('WARN', '[lock] acquire failed - recovery unsuccessful', { instanceId });
                    return false;
                }

                // Retry acquisition after recovery
                try {
                    await fs.promises.mkdir(lockPath);
                    this.lockHeld = true;
                    await this.writeLockOwnerMetadata(instanceId);
                    this.log('INFO', '[lock] acquire success after recovery', {
                        instanceId,
                        pid: process.pid,
                        recoveryReason: reason
                    });
                    return true;
                } catch (retryError) {
                    this.log('WARN', '[lock] acquire failed after recovery', {
                        instanceId,
                        error: retryError instanceof Error ? retryError.message : String(retryError)
                    });
                    return false;
                }
            }

            // Unexpected error - log and rethrow
            this.log('ERROR', '[lock] acquire failed - unexpected error', {
                instanceId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Plan 092 M2 + Plan 095: Release the exclusive lock.
     * Only releases if this manager holds the lock.
     * Removes owner.json before removing lock directory.
     */
    public async releaseLock(): Promise<void> {
        if (!this.lockHeld) {
            this.log('DEBUG', '[lock] not held, nothing to release');
            return;
        }

        // Plan 115 M1: Add correlation fields to lock release log
        this.log('INFO', '[lock] release start', {
            sessionId: vscode.env.sessionId,
            extensionHostPid: process.pid
        });

        try {
            // Use recursive rm to handle directory with contents (fixes Windows ENOTEMPTY)
            // This handles owner.json and any other files that may exist in the lock directory
            await fs.promises.rm(this.getLockPath(), { recursive: true, force: true });
            this.lockHeld = false;
            this.log('INFO', '[lock] release success');
        } catch (error) {
            // Log but don't throw - lock release is best-effort cleanup
            this.log('WARN', '[lock] release failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            // Still mark as not held since we can't be sure of lock state
            this.lockHeld = false;
        }
    }

    /**
     * Start the daemon if not already running
     * Plan 116: Enhanced with degraded state check and attempt correlation
     */
    public async start(): Promise<void> {
        if (!this.daemonEnabled) {
            this.log('DEBUG', 'Daemon mode disabled, skipping start');
            throw new DaemonUnavailableError(DaemonUnavailableReason.DAEMON_DISABLED);
        }

        // Plan 116: Check for degraded state - require manual reset
        if (this.state === 'degraded') {
            this.log('DEBUG', 'Daemon in degraded state, start blocked');
            throw new DaemonUnavailableError(
                DaemonUnavailableReason.RECOVERY_BUDGET_EXHAUSTED,
                this.currentStartupAttempt?.attemptId,
                { lastFailure: this.lastFailure }
            );
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
     * Plan 061: Includes startup hygiene
     * Plan 095: Ensures lock is released if startup fails after acquisition
     * Plan 116: Bounded startup deadline, attempt tracking, reason-coded errors
     */
    private async doStart(): Promise<void> {
        this.state = 'starting';
        const startTime = Date.now();
        const attemptId = uuidv4();
        let lockWasAcquired = false;

        // Plan 116: Initialize startup attempt tracking
        this.currentStartupAttempt = {
            attemptId,
            startedAt: startTime,
            deadline: startTime + STARTUP_DEADLINE_MS,
            phase: 'lock'
        };
        this.startupStderrBuffer = []; // Clear stderr buffer for this attempt

        // Plan 116: Create a deadline timer that will abort startup if exceeded
        let deadlineExceeded = false;
        const deadlineTimer = setTimeout(() => {
            deadlineExceeded = true;
            this.log('ERROR', 'Startup deadline exceeded', {
                attemptId,
                elapsed_ms: Date.now() - startTime,
                deadline_ms: STARTUP_DEADLINE_MS,
                phase: this.currentStartupAttempt?.phase
            });
        }, STARTUP_DEADLINE_MS);

        try {
            // Plan 116: Check deadline before each phase
            const checkDeadline = (phase: string) => {
                if (deadlineExceeded) {
                    throw new DaemonUnavailableError(
                        DaemonUnavailableReason.STARTUP_TIMEOUT,
                        attemptId,
                        { phase, elapsed_ms: Date.now() - startTime }
                    );
                }
                if (this.currentStartupAttempt) {
                    this.currentStartupAttempt.phase = phase as StartupAttempt['phase'];
                }
            };

            // Phase: Lock acquisition
            checkDeadline('lock');
            const lockAcquired = await this.acquireLock();
            if (!lockAcquired) {
                this.state = 'stopped';
                throw new DaemonUnavailableError(
                    DaemonUnavailableReason.LOCK_HELD,
                    attemptId
                );
            }
            lockWasAcquired = true;

            // Plan 061: Startup hygiene - check for orphan/stale daemons
            await this.cleanupStaleDaemon();

            const daemonScript = path.join(this.bridgePath, 'daemon.py');

            // Verify daemon script exists
            if (!fs.existsSync(daemonScript)) {
                throw new DaemonUnavailableError(
                    DaemonUnavailableReason.SPAWN_FAILED,
                    attemptId,
                    { reason: 'Daemon script not found', path: daemonScript }
                );
            }

            // Phase: Spawn
            checkDeadline('spawn');
            this.log('INFO', 'Starting bridge daemon', {
                script: 'bridge/daemon.py',
                attemptId
            });

            // Get LLM environment variables
            const llmEnv = await this.getLLMEnvironment();

            const pythonForSpawn = await this.resolvePythonPathForSpawn();

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

            this.daemonProcess = spawn(pythonForSpawn, [daemonScript], spawnOptions);

            if (!this.daemonProcess.stdout || !this.daemonProcess.stderr || !this.daemonProcess.stdin) {
                throw new DaemonUnavailableError(
                    DaemonUnavailableReason.STDIO_UNAVAILABLE,
                    attemptId
                );
            }

            // Set up event handlers
            this.setupProcessHandlers();

            // Phase: Handshake
            checkDeadline('handshake');
            await this.waitForReady(HANDSHAKE_TIMEOUT_MS);

            // Success - clear deadline timer
            clearTimeout(deadlineTimer);

            this.state = 'running';
            this.restartAttempts = 0;
            this.recoveryState.attempts = 0; // Reset recovery counter on success
            this.recoveryState.active = false;
            this.resetIdleTimer();

            if (this.currentStartupAttempt) {
                this.currentStartupAttempt.phase = 'complete';
            }

            const startupDuration = Date.now() - startTime;
            this.log('INFO', 'Bridge daemon started successfully', {
                startupDuration_ms: startupDuration,
                daemonPid: this.daemonProcess.pid,
                extensionHostPid: process.pid,
                sessionId: vscode.env.sessionId,
                platform: process.platform,
                attemptId
            });

            // Write PID file for crash recovery
            await this.writePidFile();

        } catch (error) {
            clearTimeout(deadlineTimer);
            
            // Plan 116: Determine reason code from error
            let reason: DaemonUnavailableReason;
            let details: Record<string, unknown> = {};

            if (error instanceof DaemonUnavailableError) {
                reason = error.reason;
                details = error.details || {};
            } else {
                const errorMessage = error instanceof Error ? error.message : String(error);
                details = { error: errorMessage };
                
                // Map common errors to reason codes
                if (errorMessage.includes('timeout') || deadlineExceeded) {
                    reason = DaemonUnavailableReason.STARTUP_TIMEOUT;
                } else if (errorMessage.includes('Health check failed')) {
                    reason = DaemonUnavailableReason.HANDSHAKE_FAILED;
                } else if (errorMessage.includes('spawn') || errorMessage.includes('ENOENT')) {
                    reason = DaemonUnavailableReason.SPAWN_FAILED;
                } else if (errorMessage.includes('stdio')) {
                    reason = DaemonUnavailableReason.STDIO_UNAVAILABLE;
                } else {
                    reason = DaemonUnavailableReason.SPAWN_FAILED;
                }
            }

            // Plan 116: Record failure for diagnostics
            this.lastFailure = {
                timestamp: Date.now(),
                reason,
                attemptId,
                stderrTail: this.startupStderrBuffer.slice(-DAEMON_RELIABILITY_DEFAULTS.MAX_STDERR_LINES).join('\n'),
                recoveryAttempt: this.recoveryState.attempts,
                details
            };

            if (this.currentStartupAttempt) {
                this.currentStartupAttempt.phase = 'failed';
                this.currentStartupAttempt.error = reason;
                this.currentStartupAttempt.errorDetails = details;
            }

            // Plan 116: Use failed_startup state instead of crashed for startup failures
            this.state = 'failed_startup';
            this.log('ERROR', 'Failed to start bridge daemon', {
                error: reason,
                attemptId,
                phase: this.currentStartupAttempt?.phase,
                details
            });

            // Clean up any spawned process
            if (this.daemonProcess) {
                try {
                    this.daemonProcess.kill('SIGKILL');
                } catch {
                    // Ignore kill errors
                }
                this.daemonProcess = null;
            }

            // Plan 095: Release lock if we acquired it but failed to start
            if (lockWasAcquired && this.lockHeld) {
                this.log('INFO', '[lock] releasing lock after startup failure', { attemptId });
                await this.releaseLock();
            }

            // Plan 116: Throw reason-coded error
            if (error instanceof DaemonUnavailableError) {
                throw error;
            }
            throw new DaemonUnavailableError(reason, attemptId, details);
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
            const trimmed = line.trim();
            if (trimmed) {
                // Strip ANSI escape codes and forward daemon logs to output channel
                const cleanLine = stripAnsiCodes(trimmed);
                this.log('DEBUG', `[daemon] ${cleanLine}`);
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

        // Clean up PID file and release lock
        this.deletePidFile();

        // Release lock on unexpected exit (crash/signal) to prevent stale locks
        // This is async but we don't await - best effort cleanup
        this.releaseLock().catch(err => {
            this.log('WARN', 'Failed to release lock on process exit', { error: String(err) });
        });

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
        method: 'health' | 'ingest' | 'retrieve' | 'shutdown' | 'cognify' | 'visualize',
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
     * degraded mode (Plan 116: memory operations unavailable until recovery).
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
                        action: 'Memory operations unavailable. Daemon mode will resume on next successful health check.'
                    });
                }
            }

        } finally {
            this.state = 'stopped';
            this.daemonProcess = null;
            this.deletePidFile();

            // Plan 092 M2.4: Release lock after daemon stops
            await this.releaseLock();

            // Plan 115 M1: Add correlation fields to daemon stop log
            this.log('INFO', 'Daemon stopped', {
                reason,
                outcome: shutdownOutcome,
                daemonPid: pid,
                extensionHostPid: process.pid,
                sessionId: vscode.env.sessionId
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
     * 
     * Plan 092 M3: Ensures old process fully exits before spawning new one.
     * - Calls stop() and waits for it to complete
     * - doStop() already handles graceful shutdown with SIGTERM/SIGKILL escalation
     * - Logs restart timing for observability
     */
    public async restart(): Promise<void> {
        const restartStart = Date.now();
        const oldPid = this.daemonProcess?.pid;

        this.log('INFO', 'Restarting daemon', { oldPid });

        // Stop and wait for completion - doStop() handles graceful + escalated shutdown
        await this.stop('restart');

        const stopDuration = Date.now() - restartStart;
        this.log('INFO', 'Restart: old process stopped', {
            stopDuration_ms: stopDuration,
            oldPid
        });

        // Start new daemon
        await this.start();

        const totalDuration = Date.now() - restartStart;
        this.log('INFO', 'Restart completed', {
            totalDuration_ms: totalDuration,
            newPid: this.daemonProcess?.pid
        });
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
     * 
     * Plan 081: In v0.7.0 (Cloud-only), merges Flowbaby Cloud AWS credentials
     * when authenticated. Cloud env takes precedence for Bedrock calls.
     * 
     * Plan 083: Preserves FlowbabyCloudError codes end-to-end for accurate UX.
     * Plan 087: Shows throttled user notification on vend failure.
     */
    private async getLLMEnvironment(): Promise<Record<string, string>> {
        const env: Record<string, string> = {};

        // Plan 081: If Cloud is enabled and provider is initialized, get Cloud credentials
        if (isFlowbabyCloudEnabled() && isProviderInitialized()) {
            try {
                const cloudEnv = await getFlowbabyCloudEnvironment();
                Object.assign(env, cloudEnv);
                this.log('INFO', 'Cloud credentials injected into daemon environment');
            } catch (error) {
                // Plan 083: Preserve FlowbabyCloudError for accurate UX (rate limit vs auth failure)
                this.log('WARN', `Cloud credentials not available: ${error}`);

                // Plan 087: Surface vend failure to user via throttled notification
                const readinessService = getReadinessService();
                if (readinessService) {
                    await readinessService.showThrottledError(error, 'during daemon startup');
                }

                if (error instanceof FlowbabyCloudError) {
                    throw error; // Preserve original error code
                }
                // Unknown errors: wrap with context but don't mask as auth failure
                throw new Error(`Cloud credentials error: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        // Plan 083 M5: Removed legacy LLM_API_KEY injection from SecretStorage
        // Plan 083 M5: Removed legacy LLM_API_KEY fallback from process.env
        // Plan 083 M5: Removed Flowbaby.llm.* settings injection (LLM_PROVIDER, LLM_MODEL, LLM_ENDPOINT)
        //
        // In v0.7.0+ (Cloud-only), LLM credentials are provided via AWS_* env vars
        // from getFlowbabyCloudEnvironment() above. The Python bridge uses these
        // to authenticate with AWS Bedrock.
        //
        // Legacy API keys stored in SecretStorage are handled by the migration
        // message (M7) but are not used for LLM operations.

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
     * 5. Clean up stale lock directories (orphaned from crashes)
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

        // Clean up stale lock directory if it exists but no valid daemon is running
        await this.cleanupStaleLock();
    }

    /**
     * Clean up stale lock directory left behind by a crashed daemon.
     * 
     * Plan 095: Added guard to prevent self-delete when this manager holds the lock.
     * 
     * A lock is considered stale if:
     * - The lock directory exists, AND
     * - This manager does NOT hold the lock (lockHeld === false), AND
     * - Either no PID file exists, OR
     * - The PID file exists but the process is not alive
     * 
     * This handles cases where VS Code or the daemon crashed without proper cleanup.
     */
    private async cleanupStaleLock(): Promise<void> {
        // Plan 095: Guard against self-delete - never clean up our own lock
        if (this.lockHeld) {
            this.log('DEBUG', '[lock] cleanupStaleLock skipped - lock held by this manager');
            return;
        }

        const lockPath = this.getLockPath();
        const pidPath = this.getPidFilePath();

        try {
            // Check if lock directory exists
            await fs.promises.access(lockPath);
        } catch {
            // Lock doesn't exist - nothing to clean up
            return;
        }

        // Lock exists - check if the associated daemon is still alive
        try {
            const pidContent = await fs.promises.readFile(pidPath, 'utf8');
            const pid = parseInt(pidContent.trim(), 10);

            if (!isNaN(pid) && this.isProcessAlive(pid)) {
                // Lock is held by a running process - this is legitimate
                // (This shouldn't happen since we check before acquiring lock,
                // but leaving as a safety check)
                this.log('DEBUG', '[lock] cleanup skipped - held by running process', { pid });
                return;
            }
        } catch {
            // PID file doesn't exist or can't be read - lock is definitely stale
        }

        // Lock is stale - clean it up
        this.log('INFO', '[lock] cleaning up stale lock directory');
        try {
            // Remove owner.json first if it exists
            const ownerPath = this.getOwnerMetadataPath();
            try {
                await fs.promises.unlink(ownerPath);
            } catch {
                // Ignore - may not exist
            }

            try {
                await fs.promises.rmdir(lockPath);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw error;
                }
            }
            this.log('INFO', '[lock] stale lock cleaned up successfully');
        } catch (error) {
            this.log('WARN', '[lock] failed to clean up stale lock', {
                error: error instanceof Error ? error.message : String(error)
            });
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
     * 
     * DEBUG level messages are only written when debug logging is enabled.
     * This prevents verbose daemon output from cluttering the main output channel.
     */
    private log(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string, data?: Record<string, unknown>): void {
        // Skip DEBUG messages entirely when debug logging is disabled
        if (level === 'DEBUG' && !isDebugLoggingEnabled()) {
            return;
        }

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
