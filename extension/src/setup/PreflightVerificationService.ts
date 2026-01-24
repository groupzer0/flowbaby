/**
 * Plan 108: PreflightVerificationService
 * Plan 115 M1+M2: Add correlation fields and reasonCode taxonomy
 * 
 * Fail-fast preflight verification for all bridge entrypoints.
 * Verifies cognee is importable before allowing bridge operations.
 * 
 * Plan 108 Milestone 2: Prevents "No module named 'cognee'" errors
 * by checking import capability and providing actionable remediation.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { execFile as nodeExecFile } from 'child_process';
import { debugLog, isDebugLoggingEnabled } from '../outputChannels';
import { InterpreterSelectionService, InterpreterSelectionResult } from './InterpreterSelectionService';

/**
 * Preflight verification status
 */
export enum PreflightStatus {
    /** Environment is healthy, cognee imports successfully */
    HEALTHY = 'healthy',
    /** Cognee module is not importable */
    COGNEE_MISSING = 'cognee-missing',
    /** Python interpreter cannot be executed */
    INTERPRETER_NOT_RUNNABLE = 'interpreter-not-runnable',
    /** Verification is in progress (for async status) */
    IN_PROGRESS = 'in-progress'
}

/**
 * Remediation action for preflight failures
 */
export enum PreflightRemediationAction {
    /** Run "Flowbaby: Refresh Bridge Dependencies" (managed env) */
    REFRESH_DEPENDENCIES = 'refresh-dependencies',
    /** Manual pip install guidance (external env) */
    INSTALL_GUIDANCE = 'install-guidance',
    /** Switch to managed environment */
    SWITCH_TO_MANAGED = 'switch-to-managed',
    /** No action needed */
    NONE = 'none'
}

/**
 * Plan 115 M2: Low-cardinality reason codes for preflight failures.
 * Always emitted in logs for triage. Extend only if clearly necessary.
 */
export enum PreflightReasonCode {
    /** Python interpreter not found */
    PYTHON_NOT_FOUND = 'PYTHON_NOT_FOUND',
    /** Python execution failed */
    PYTHON_EXEC_FAILED = 'PYTHON_EXEC_FAILED',
    /** Python probe timed out */
    PYTHON_TIMEOUT = 'PYTHON_TIMEOUT',
    /** cognee import failed */
    COGNEE_IMPORT_FAILED = 'COGNEE_IMPORT_FAILED',
    /** cognee dependency not found */
    COGNEE_DEP_NOT_FOUND = 'COGNEE_DEP_NOT_FOUND',
    /** DLL or shared library load failed */
    DLL_LOAD_FAILED = 'DLL_LOAD_FAILED',
    /** Database locked or busy */
    DB_LOCKED_OR_BUSY = 'DB_LOCKED_OR_BUSY',
    /** Permission denied */
    PERMISSION_DENIED = 'PERMISSION_DENIED',
    /** Unknown error */
    UNKNOWN = 'UNKNOWN'
}

/**
 * Remediation guidance for preflight failures
 */
export interface PreflightRemediation {
    /** Action to take */
    action: PreflightRemediationAction;
    /** User-friendly message */
    message: string;
    /** Command ID to run (if applicable) */
    commandId?: string;
}

/**
 * Result of preflight verification
 */
export interface PreflightResult {
    /** Verification status */
    status: PreflightStatus;
    /** Whether cognee is importable */
    cogneeImportable: boolean;
    /** Cognee version if importable */
    cogneeVersion?: string;
    /** Python interpreter path used */
    pythonPath: string;
    /** Environment ownership */
    ownership?: 'managed' | 'external';
    /** Error message if failed */
    error?: string;
    /** Plan 115 M2: Low-cardinality reason code (always present on failure) */
    reasonCode?: PreflightReasonCode;
    /** Remediation guidance if failed */
    remediation?: PreflightRemediation;
    /** Duration of verification in milliseconds */
    durationMs: number;
    /** Whether result came from cache */
    cached: boolean;
}

/**
 * Internal verification response from Python probe
 * Plan 115 M2: Now includes stderr for diagnostic purposes
 */
interface VerificationResponse {
    status: 'ok' | 'error';
    cognee_importable: boolean;
    cognee_version?: string;
    error?: string;
    /** Plan 115 M2: stderr captured from probe execution */
    stderr?: string;
}

/**
 * Cache entry for preflight results
 */
interface CacheEntry {
    result: PreflightResult;
    pythonPath: string;
    ownership?: 'managed' | 'external';
    requirementsHash?: string;
    timestamp: number;
}

/**
 * Callback signature for execFile
 */
type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;
type ExecFileFn = (cmd: string, args: string[], opts: object, cb: ExecFileCallback) => void;

/**
 * Cache TTL in milliseconds (30 seconds for in-memory cache)
 */
const CACHE_TTL_MS = 30000;

/**
 * Plan 108 Milestone 2: Preflight verification service
 * 
 * Provides fail-fast verification before any bridge entrypoint execution.
 * Caches results briefly to avoid duplicate probes during activation bursts.
 */
export class PreflightVerificationService {
    private readonly workspacePath: string;
    private readonly bridgePath: string;
    private readonly interpreterService: InterpreterSelectionService;
    private readonly execFile: ExecFileFn;
    private cache: CacheEntry | null = null;

    constructor(
        workspacePath: string,
        bridgePath: string,
        interpreterService: InterpreterSelectionService,
        execFileFn?: ExecFileFn
    ) {
        this.workspacePath = workspacePath;
        this.bridgePath = bridgePath;
        this.interpreterService = interpreterService;
        this.execFile = execFileFn || ((cmd, args, opts, cb) => {
            nodeExecFile(cmd, args, opts as any, (err, stdout, stderr) => {
                cb(err, stdout?.toString() ?? '', stderr?.toString() ?? '');
            });
        });
    }

    /**
     * Verify the Python environment is healthy for bridge operations.
     * 
     * This is the primary gate that MUST be called before any bridge entrypoint.
     */
    async verify(): Promise<PreflightResult> {
        const startTime = Date.now();

        // Get current interpreter selection
        const interpreter = await this.interpreterService.selectInterpreter();

        // Check cache validity
        if (this.isCacheValid(interpreter)) {
            const cachedResult = { ...this.cache!.result, cached: true };
            this.logPreflight(cachedResult, 'cache-hit');
            return cachedResult;
        }

        // Run actual verification
        const result = await this.runVerification(interpreter, startTime);
        
        // Cache healthy results
        if (result.status === PreflightStatus.HEALTHY) {
            this.cache = {
                result,
                pythonPath: interpreter.pythonPath,
                ownership: interpreter.ownership,
                requirementsHash: interpreter.requirementsHash,
                timestamp: Date.now()
            };
        }

        this.logPreflight(result, 'verification');
        return result;
    }

    /**
     * Explicitly invalidate the cache.
     * Called after dependency refresh or interpreter changes.
     */
    invalidateCache(): void {
        this.cache = null;
        debugLog('PreflightVerificationService: cache invalidated');
    }

    /**
     * Helper to check if a result indicates a healthy environment
     */
    isHealthy(result: PreflightResult): boolean {
        return result.status === PreflightStatus.HEALTHY && result.cogneeImportable;
    }

    /**
     * Check if cached result is still valid
     */
    private isCacheValid(interpreter: InterpreterSelectionResult): boolean {
        if (!this.cache) {
            return false;
        }

        const now = Date.now();
        const age = now - this.cache.timestamp;

        // TTL expired
        if (age > CACHE_TTL_MS) {
            return false;
        }

        // Interpreter path changed
        if (this.cache.pythonPath !== interpreter.pythonPath) {
            debugLog('PreflightVerificationService: cache invalidated - interpreter path changed');
            return false;
        }

        // Ownership changed
        if (this.cache.ownership !== interpreter.ownership) {
            debugLog('PreflightVerificationService: cache invalidated - ownership changed');
            return false;
        }

        // Requirements hash changed (Plan 108: invalidate on requirements drift)
        if (this.cache.requirementsHash !== interpreter.requirementsHash) {
            debugLog('PreflightVerificationService: cache invalidated - requirements hash changed');
            return false;
        }

        return true;
    }

    /**
     * Run the actual verification probe
     */
    private async runVerification(
        interpreter: InterpreterSelectionResult,
        startTime: number
    ): Promise<PreflightResult> {
        const pythonPath = interpreter.pythonPath;

        try {
            const response = await this.runProbe(pythonPath);
            const durationMs = Date.now() - startTime;

            if (response.cognee_importable) {
                return {
                    status: PreflightStatus.HEALTHY,
                    cogneeImportable: true,
                    cogneeVersion: response.cognee_version,
                    pythonPath,
                    ownership: interpreter.ownership,
                    durationMs,
                    cached: false
                };
            } else {
                return this.buildFailureResult(
                    PreflightStatus.COGNEE_MISSING,
                    pythonPath,
                    interpreter.ownership,
                    response.error || "cognee module not importable",
                    durationMs,
                    response.stderr
                );
            }
        } catch (error) {
            const durationMs = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isNotFound = errorMessage.includes('ENOENT') || 
                              errorMessage.includes('not found') ||
                              errorMessage.includes('spawn');

            return this.buildFailureResult(
                isNotFound ? PreflightStatus.INTERPRETER_NOT_RUNNABLE : PreflightStatus.COGNEE_MISSING,
                pythonPath,
                interpreter.ownership,
                isNotFound ? `Python interpreter not found: ${pythonPath}` : errorMessage,
                durationMs,
                undefined // stderr not available in catch block
            );
        }
    }

    /**
     * Run the Python probe to check cognee importability
     * Plan 115 M2: Captures stderr for diagnostic logging
     */
    private runProbe(pythonPath: string): Promise<VerificationResponse> {
        return new Promise((resolve, reject) => {
            // Use a simple inline Python script to check cognee import
            const probeScript = `
import json
import sys
try:
    import cognee
    print(json.dumps({
        "status": "ok",
        "cognee_importable": True,
        "cognee_version": getattr(cognee, "__version__", "unknown")
    }))
except ImportError as e:
    print(json.dumps({
        "status": "error",
        "cognee_importable": False,
        "error": str(e)
    }))
except Exception as e:
    print(json.dumps({
        "status": "error",
        "cognee_importable": False,
        "error": str(e)
    }))
`;

            this.execFile(
                pythonPath,
                ['-c', probeScript],
                { timeout: 10000, cwd: this.workspacePath },
                (error, stdout, stderr) => {
                    // Plan 115 M2: Log stderr excerpt only when debug logging is enabled
                    if (stderr && stderr.trim() && isDebugLoggingEnabled()) {
                        // Truncate and redact absolute paths for safety
                        const redactedStderr = this.redactPaths(stderr.substring(0, 500));
                        debugLog('PreflightVerificationService: probe stderr (debug)', {
                            stderr: redactedStderr
                        });
                    }

                    if (error) {
                        // Plan 115 M2: Include stderr in error rejection
                        const enhancedError = new Error(
                            `${error.message}${stderr ? ` | stderr: ${this.redactPaths(stderr.substring(0, 200))}` : ''}`
                        );
                        reject(enhancedError);
                        return;
                    }

                    try {
                        const response = JSON.parse(stdout.trim()) as VerificationResponse;
                        // Plan 115 M2: Attach stderr to response for downstream use
                        response.stderr = stderr || undefined;
                        resolve(response);
                    } catch (parseError) {
                        reject(new Error(`Failed to parse probe output: ${stdout}`));
                    }
                }
            );
        });
    }

    /**
     * Plan 115 M2: Redact absolute paths from stderr to avoid leaking sensitive paths
     */
    private redactPaths(text: string): string {
        // Replace absolute paths with basename or placeholder
        // Match common path patterns: /path/to/file, C:\path\to\file
        return text
            .replace(/\/[^\s:]+\/[^\s:]+/g, '<path>')
            .replace(/[A-Z]:\\[^\s:]+\\[^\s:]+/gi, '<path>');
    }

    /**
     * Build a failure result with appropriate remediation
     * Plan 115 M2: Now includes reasonCode for always-on triage
     */
    private buildFailureResult(
        status: PreflightStatus,
        pythonPath: string,
        ownership: 'managed' | 'external' | undefined,
        error: string,
        durationMs: number,
        stderr?: string
    ): PreflightResult {
        const remediation = this.getRemediation(status, ownership);
        const reasonCode = this.classifyReasonCode(error, stderr);

        return {
            status,
            cogneeImportable: false,
            pythonPath,
            ownership,
            error,
            reasonCode,
            remediation,
            durationMs,
            cached: false
        };
    }

    /**
     * Plan 115 M2: Classify error into a low-cardinality reason code
     */
    private classifyReasonCode(error: string, stderr?: string): PreflightReasonCode {
        const combined = `${error} ${stderr || ''}`.toLowerCase();

        if (combined.includes('enoent') || combined.includes('not found') || combined.includes('spawn')) {
            return PreflightReasonCode.PYTHON_NOT_FOUND;
        }
        if (combined.includes('timeout') || combined.includes('timed out')) {
            return PreflightReasonCode.PYTHON_TIMEOUT;
        }
        if (combined.includes('dll') || combined.includes('.so') || combined.includes('load') && combined.includes('fail')) {
            return PreflightReasonCode.DLL_LOAD_FAILED;
        }
        if (combined.includes('locked') || combined.includes('busy') || combined.includes('database is locked')) {
            return PreflightReasonCode.DB_LOCKED_OR_BUSY;
        }
        if (combined.includes('permission') || combined.includes('access denied') || combined.includes('eacces')) {
            return PreflightReasonCode.PERMISSION_DENIED;
        }
        if (combined.includes('no module named') || combined.includes('modulenotfounderror')) {
            return PreflightReasonCode.COGNEE_DEP_NOT_FOUND;
        }
        if (combined.includes('importerror') || combined.includes('cannot import')) {
            return PreflightReasonCode.COGNEE_IMPORT_FAILED;
        }
        if (combined.includes('exec') || combined.includes('failed to execute')) {
            return PreflightReasonCode.PYTHON_EXEC_FAILED;
        }

        return PreflightReasonCode.UNKNOWN;
    }

    /**
     * Get remediation guidance based on failure type and ownership
     */
    private getRemediation(
        status: PreflightStatus,
        ownership: 'managed' | 'external' | undefined
    ): PreflightRemediation {
        if (status === PreflightStatus.HEALTHY) {
            return { action: PreflightRemediationAction.NONE, message: '' };
        }

        // External environment: provide install guidance, never suggest mutation
        if (ownership === 'external') {
            return {
                action: PreflightRemediationAction.INSTALL_GUIDANCE,
                message: 'Your external Python environment is missing required packages. ' +
                         'Run: pip install -r extension/bridge/requirements.txt ' +
                         'or switch to a managed environment.'
            };
        }

        // Managed environment: suggest refresh
        if (ownership === 'managed') {
            return {
                action: PreflightRemediationAction.REFRESH_DEPENDENCIES,
                message: 'Run "Flowbaby: Refresh Bridge Dependencies" to repair the environment.',
                commandId: 'Flowbaby.refreshDependencies'
            };
        }

        // Unknown/no ownership (system fallback): suggest creating managed env
        return {
            action: PreflightRemediationAction.SWITCH_TO_MANAGED,
            message: 'No Flowbaby environment configured. Run "Flowbaby: Initialize Workspace" to set up.',
            commandId: 'Flowbaby.initializeWorkspace'
        };
    }

    /**
     * Log preflight results at Normal observability level
     * Plan 108 Milestone 4.1: Always-on, low-volume logging
     * Plan 115 M1+M2: Add correlation fields (sessionId, pid) and reasonCode
     */
    private logPreflight(result: PreflightResult, source: 'cache-hit' | 'verification'): void {
        debugLog('PreflightVerificationService: preflight complete', {
            status: result.status,
            cogneeImportable: result.cogneeImportable,
            cogneeVersion: result.cogneeVersion,
            ownership: result.ownership ?? 'unknown',
            reasonCode: result.reasonCode,
            durationMs: result.durationMs,
            cached: result.cached,
            source,
            // Plan 115 M1: Correlation fields
            sessionId: vscode.env.sessionId,
            extensionHostPid: process.pid
        });
    }
}
