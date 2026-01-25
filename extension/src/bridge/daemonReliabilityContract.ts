/**
 * Daemon Reliability Contract - Plan 116
 * 
 * Defines the state machine, reason codes, and error structures for
 * daemon lifecycle management. This contract ensures consistent
 * error handling and observability across all daemon operations.
 * 
 * @see agent-output/planning/116-daemon-startup-and-recovery-hardening.md
 * @see agent-output/implementation/116-daemon-startup-and-recovery-hardening-implementation.md
 */

/**
 * Plan 116 M1: Stable reason codes for daemon unavailability.
 * 
 * Every daemon unavailability error maps to exactly one of these codes.
 * Codes are stable (do not change meaning) for aggregation and telemetry.
 */
export enum DaemonUnavailableReason {
    // Startup phase failures
    /** Bounded startup deadline exceeded */
    STARTUP_TIMEOUT = 'STARTUP_TIMEOUT',
    /** Process spawned but no readiness response within timeout */
    STARTUP_HUNG = 'STARTUP_HUNG',
    /** Python process could not be created */
    SPAWN_FAILED = 'SPAWN_FAILED',
    /** stdin/stdout/stderr not available after spawn */
    STDIO_UNAVAILABLE = 'STDIO_UNAVAILABLE',
    /** Health check returned error response */
    HANDSHAKE_FAILED = 'HANDSHAKE_FAILED',
    /** Malformed/non-JSON response during handshake */
    PROTOCOL_ERROR = 'PROTOCOL_ERROR',
    /** Process exited during/immediately after spawn */
    IMMEDIATE_EXIT = 'IMMEDIATE_EXIT',

    // Lock/ownership failures
    /** Another VS Code window owns the daemon for this workspace */
    LOCK_HELD = 'LOCK_HELD',
    /** Could not acquire lock (unexpected error) */
    LOCK_ACQUISITION_FAILED = 'LOCK_ACQUISITION_FAILED',

    // Operational blocks
    /** venv install/refresh in progress; daemon blocked */
    VENV_MUTATION_BLOCKED = 'VENV_MUTATION_BLOCKED',
    /** User disabled daemon mode in settings */
    DAEMON_DISABLED = 'DAEMON_DISABLED',

    // Recovery exhaustion
    /** Max retries reached; entered degraded mode */
    RECOVERY_BUDGET_EXHAUSTED = 'RECOVERY_BUDGET_EXHAUSTED',

    // Runtime failures
    /** Daemon not running (generic fallback) */
    PROCESS_NOT_AVAILABLE = 'PROCESS_NOT_AVAILABLE',
    /** Individual request timed out */
    REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',

    // Startup-time request handling
    /** Startup in progress; caller should wait or retry */
    STARTUP_IN_PROGRESS = 'STARTUP_IN_PROGRESS',
}

/**
 * Plan 116 M1: User-friendly messages for each reason code.
 * Messages include remediation guidance where applicable.
 */
export function getDaemonUnavailableMessage(reason: DaemonUnavailableReason): string {
    const messages: Record<DaemonUnavailableReason, string> = {
        [DaemonUnavailableReason.STARTUP_TIMEOUT]: 
            'Daemon startup timed out. Run "Flowbaby: Diagnose Daemon" for details.',
        [DaemonUnavailableReason.STARTUP_HUNG]: 
            'Daemon startup hung (no response). Run "Flowbaby: Diagnose Daemon" for details.',
        [DaemonUnavailableReason.SPAWN_FAILED]: 
            'Failed to start Python daemon. Check Python path in settings.',
        [DaemonUnavailableReason.STDIO_UNAVAILABLE]: 
            'Daemon process started but stdio unavailable. Run "Flowbaby: Diagnose Daemon".',
        [DaemonUnavailableReason.HANDSHAKE_FAILED]: 
            'Daemon health check failed. Run "Flowbaby: Diagnose Daemon" for details.',
        [DaemonUnavailableReason.PROTOCOL_ERROR]: 
            'Daemon protocol error. Check daemon logs for details.',
        [DaemonUnavailableReason.IMMEDIATE_EXIT]: 
            'Daemon exited immediately after start. Check daemon logs.',
        [DaemonUnavailableReason.LOCK_HELD]: 
            'Another VS Code window is managing this workspace daemon. Close other windows or disable daemon mode.',
        [DaemonUnavailableReason.LOCK_ACQUISITION_FAILED]: 
            'Could not acquire daemon lock. Run "Flowbaby: Diagnose Daemon".',
        [DaemonUnavailableReason.VENV_MUTATION_BLOCKED]: 
            'Daemon blocked during dependency refresh. Wait for refresh to complete.',
        [DaemonUnavailableReason.DAEMON_DISABLED]: 
            'Daemon mode is disabled in settings.',
        [DaemonUnavailableReason.RECOVERY_BUDGET_EXHAUSTED]: 
            'Daemon recovery failed after multiple attempts. Run "Flowbaby: Diagnose Daemon".',
        [DaemonUnavailableReason.PROCESS_NOT_AVAILABLE]: 
            'Daemon not available. Run "Flowbaby: Diagnose Daemon" for details.',
        [DaemonUnavailableReason.REQUEST_TIMEOUT]: 
            'Daemon request timed out.',
        [DaemonUnavailableReason.STARTUP_IN_PROGRESS]:
            'Daemon startup in progress. Please wait or retry.',
    };
    return messages[reason];
}

/**
 * Plan 116 M1: Error class for daemon unavailability.
 * 
 * Includes the reason code, optional attempt ID for correlation,
 * and optional details for diagnostics.
 */
export class DaemonUnavailableError extends Error {
    public readonly name = 'DaemonUnavailableError';

    constructor(
        public readonly reason: DaemonUnavailableReason,
        public readonly attemptId?: string,
        public readonly details?: Record<string, unknown>
    ) {
        super(getDaemonUnavailableMessage(reason));
        // Maintains proper stack trace in V8 (Node/Chrome)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, DaemonUnavailableError);
        }
    }
}

/**
 * Plan 116 M1: Daemon lifecycle states.
 * 
 * The daemon manager maintains a state machine with these states.
 * All state transitions must go through validateTransition() to
 * ensure invariants are maintained.
 */
export enum DaemonState {
    /** No daemon process; not attempting to start */
    STOPPED = 'stopped',
    /** Startup in progress (lock acquire → spawn → handshake) */
    STARTING = 'starting',
    /** Daemon healthy and accepting requests */
    RUNNING = 'running',
    /** Graceful shutdown in progress */
    STOPPING = 'stopping',
    /** Unexpected process exit while running */
    CRASHED = 'crashed',
    /** Startup attempt failed; cleanup complete */
    FAILED_STARTUP = 'failed_startup',
    /** Recovery budget exhausted; daemon unavailable */
    DEGRADED = 'degraded',
}

/**
 * Valid state transitions for the daemon state machine.
 * Key is the "from" state, value is array of valid "to" states.
 */
const VALID_TRANSITIONS: Record<DaemonState, DaemonState[]> = {
    [DaemonState.STOPPED]: [DaemonState.STARTING],
    [DaemonState.STARTING]: [DaemonState.RUNNING, DaemonState.FAILED_STARTUP, DaemonState.STOPPED],
    [DaemonState.RUNNING]: [DaemonState.STOPPING, DaemonState.CRASHED],
    [DaemonState.STOPPING]: [DaemonState.STOPPED],
    [DaemonState.CRASHED]: [DaemonState.STARTING, DaemonState.STOPPED],
    [DaemonState.FAILED_STARTUP]: [DaemonState.STOPPED, DaemonState.DEGRADED, DaemonState.STARTING],
    [DaemonState.DEGRADED]: [DaemonState.STOPPED],
};

/**
 * Check if a state is terminal (no automatic recovery).
 * Terminal states require explicit user action to reset.
 */
export function isTerminalState(state: DaemonState): boolean {
    return state === DaemonState.STOPPED || state === DaemonState.DEGRADED;
}

/**
 * Check if a state transition is valid per the state machine.
 */
export function canTransitionTo(from: DaemonState, to: DaemonState): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Plan 116 M1: Startup attempt metadata for correlation and diagnostics.
 */
export interface StartupAttempt {
    /** Unique identifier for this startup attempt */
    attemptId: string;
    /** Timestamp when startup began */
    startedAt: number;
    /** Bounded deadline for this attempt (ms since epoch) */
    deadline: number;
    /** Phase of startup (lock, spawn, handshake) */
    phase: 'lock' | 'spawn' | 'handshake' | 'complete' | 'failed';
    /** Error if startup failed */
    error?: DaemonUnavailableReason;
    /** Additional error details */
    errorDetails?: Record<string, unknown>;
}

/**
 * Plan 116 M1: Last failure record for diagnostics.
 * Persisted to enable "diagnose daemon" command output.
 */
export interface LastFailureRecord {
    /** Timestamp of the failure */
    timestamp: number;
    /** Reason code */
    reason: DaemonUnavailableReason;
    /** Startup attempt ID if applicable */
    attemptId?: string;
    /** Captured stderr tail (bounded, redacted) */
    stderrTail?: string;
    /** Recovery attempt number (if part of recovery loop) */
    recoveryAttempt?: number;
    /** Additional context */
    details?: Record<string, unknown>;
}

/**
 * Plan 116 M1: Recovery state for bounded recovery loop.
 */
export interface RecoveryState {
    /** Number of recovery attempts made */
    attempts: number;
    /** Maximum attempts before entering degraded mode */
    maxAttempts: number;
    /** Timestamp of last attempt */
    lastAttemptAt?: number;
    /** Next attempt scheduled at (ms since epoch) */
    nextAttemptAt?: number;
    /** Whether recovery loop is active */
    active: boolean;
    /** Cooldown period (ms) - increased after repeated failures */
    cooldownMs: number;
}

/**
 * Plan 116 M1: Default configuration for daemon reliability.
 */
export const DAEMON_RELIABILITY_DEFAULTS = {
    /** Maximum time for entire startup sequence (lock + spawn + handshake) */
    STARTUP_DEADLINE_MS: 30000,
    /** Maximum time to wait for readiness handshake specifically */
    HANDSHAKE_TIMEOUT_MS: 10000,
    /** Maximum recovery attempts before entering degraded mode */
    MAX_RECOVERY_ATTEMPTS: 3,
    /** Base backoff for recovery retries */
    RECOVERY_BACKOFF_BASE_MS: 1000,
    /** Maximum backoff for recovery retries */
    RECOVERY_BACKOFF_MAX_MS: 30000,
    /** Cooldown period after recovery budget exhausted */
    DEGRADED_COOLDOWN_MS: 60000,
    /** Maximum stderr lines to capture for diagnostics */
    MAX_STDERR_LINES: 50,
    /** Maximum stderr characters to capture for diagnostics */
    MAX_STDERR_CHARS: 4096,
} as const;

/**
 * Plan 116 M6: Diagnostic report returned by getDiagnostics().
 * Provides comprehensive daemon state information for troubleshooting.
 */
export interface DaemonDiagnosticReport {
    /** Current daemon state */
    state: string;
    /** Whether daemon is healthy and accepting requests */
    healthy: boolean;
    /** Whether daemon mode is enabled in settings */
    daemonModeEnabled: boolean;
    /** Whether daemon mode is suspended due to repeated failures */
    daemonModeSuspended: boolean;
    /** Last failure record if any */
    lastFailure: LastFailureRecord | null;
    /** Recovery state summary */
    recovery: {
        active: boolean;
        attempts: number;
        maxAttempts: number;
        cooldownMs: number;
        nextAttemptAt?: number;
    };
    /** Lock state summary */
    lock: {
        held: boolean;
        lockPath: string;
        owner?: {
            pid: number;
            hostname: string;
            workspacePath: string;
            acquiredAt: number;
        };
    };
    /** Runtime information */
    runtime: {
        pid?: number;
        uptime?: number;
        pendingRequests: number;
    };
    /** Where to find daemon logs */
    logsPath: string;
    /** Remediation hints based on current state */
    remediationHints: string[];
}
