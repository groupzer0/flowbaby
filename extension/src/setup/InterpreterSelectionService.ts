/**
 * Plan 108: InterpreterSelectionService
 * 
 * Centralized interpreter selection with metadata-first priority.
 * Enforces bridge-env.json as single source of truth when present.
 * 
 * Priority order (Plan 108 Milestone 1):
 * 1. Metadata from .flowbaby/bridge-env.json (when present)
 * 2. Managed venv heuristic (.flowbaby/venv)
 * 3. Explicit Flowbaby.pythonPath config
 * 4. System Python fallback
 */

import * as path from 'path';
import * as fs from 'fs';
import { debugLog } from '../outputChannels';

/**
 * Reason for interpreter selection (for logging and diagnostics)
 */
export enum InterpreterSelectionReason {
    /** Selected from .flowbaby/bridge-env.json metadata */
    METADATA = 'metadata',
    /** Heuristic: .flowbaby/venv exists */
    MANAGED_VENV_HEURISTIC = 'managed-venv-heuristic',
    /** Explicit Flowbaby.pythonPath setting */
    EXPLICIT_CONFIG = 'explicit-config',
    /** Fallback to system python/python3 */
    SYSTEM_FALLBACK = 'system-fallback'
}

/**
 * Result of interpreter selection
 */
export interface InterpreterSelectionResult {
    /** Path to the selected Python interpreter */
    pythonPath: string;
    /** Why this interpreter was selected */
    reason: InterpreterSelectionReason;
    /** Whether bridge-env.json metadata exists */
    metadataExists: boolean;
    /** Ownership mode from metadata (if available) */
    ownership?: 'managed' | 'external';
    /** Requirements hash from metadata (if available) */
    requirementsHash?: string;
}

/**
 * Bridge environment metadata structure
 */
export interface BridgeEnvMetadata {
    pythonPath: string;
    ownership: 'managed' | 'external';
    requirementsHash: string;
    createdAt: string;
    platform: string;
}

/**
 * Filesystem interface for dependency injection (testability)
 */
interface FileSystemInterface {
    existsSync: (path: string) => boolean;
    promises: {
        readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
    };
}

/**
 * Configuration interface for dependency injection (testability)
 */
interface ConfigInterface {
    get: <T>(key: string, defaultValue: T) => T;
}

/**
 * Plan 108 Milestone 1: Centralized interpreter selection service
 * 
 * Ensures all bridge calls use the same interpreter resolution logic
 * with metadata-first priority when bridge-env.json exists.
 */
export class InterpreterSelectionService {
    private readonly workspacePath: string;
    private readonly fs: FileSystemInterface;
    private readonly config: ConfigInterface;
    private readonly isWindows: boolean;

    constructor(
        workspacePath: string,
        fileSystem?: FileSystemInterface,
        config?: ConfigInterface
    ) {
        this.workspacePath = workspacePath;
        this.fs = fileSystem || {
            existsSync: fs.existsSync,
            promises: {
                readFile: (p: string, enc: BufferEncoding) => fs.promises.readFile(p, enc)
            }
        };
        this.config = config || {
            get: <T>(key: string, defaultValue: T): T => defaultValue
        };
        this.isWindows = process.platform === 'win32';
    }

    /**
     * Select the Python interpreter using metadata-first priority.
     * 
     * Plan 108: When bridge-env.json exists, its pythonPath MUST be used
     * for all bridge invocations. Fallback heuristics only apply when
     * metadata is missing.
     */
    async selectInterpreter(): Promise<InterpreterSelectionResult> {
        // Priority 1: Metadata from bridge-env.json (single source of truth)
        const metadata = await this.readBridgeEnv();
        if (metadata) {
            const result: InterpreterSelectionResult = {
                pythonPath: metadata.pythonPath,
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: metadata.ownership,
                requirementsHash: metadata.requirementsHash
            };
            this.logSelection(result);
            return result;
        }

        // Priority 2: Managed venv heuristic (.flowbaby/venv)
        const managedPythonPath = this.getManagedVenvPythonPath();
        if (this.fs.existsSync(managedPythonPath)) {
            const result: InterpreterSelectionResult = {
                pythonPath: managedPythonPath,
                reason: InterpreterSelectionReason.MANAGED_VENV_HEURISTIC,
                metadataExists: false
            };
            this.logSelection(result);
            return result;
        }

        // Priority 3: Explicit Flowbaby.pythonPath config
        const explicitPath = this.config.get<string>('pythonPath', '');
        if (explicitPath && explicitPath.trim() !== '') {
            const result: InterpreterSelectionResult = {
                pythonPath: explicitPath,
                reason: InterpreterSelectionReason.EXPLICIT_CONFIG,
                metadataExists: false
            };
            this.logSelection(result);
            return result;
        }

        // Priority 4: System Python fallback
        const systemPython = this.isWindows ? 'python' : 'python3';
        const result: InterpreterSelectionResult = {
            pythonPath: systemPython,
            reason: InterpreterSelectionReason.SYSTEM_FALLBACK,
            metadataExists: false
        };
        this.logSelection(result);
        return result;
    }

    /**
     * Get the expected path to the managed venv Python executable
     */
    private getManagedVenvPythonPath(): string {
        return this.isWindows
            ? path.join(this.workspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
            : path.join(this.workspacePath, '.flowbaby', 'venv', 'bin', 'python');
    }

    /**
     * Read bridge-env.json metadata if it exists
     */
    private async readBridgeEnv(): Promise<BridgeEnvMetadata | null> {
        const bridgeEnvPath = path.join(this.workspacePath, '.flowbaby', 'bridge-env.json');
        
        if (!this.fs.existsSync(bridgeEnvPath)) {
            return null;
        }

        try {
            const content = await this.fs.promises.readFile(bridgeEnvPath, 'utf8');
            const metadata = JSON.parse(content) as BridgeEnvMetadata;
            
            // Validate required fields
            if (!metadata.pythonPath || !metadata.ownership) {
                debugLog('InterpreterSelectionService: bridge-env.json missing required fields', {
                    hasPythonPath: !!metadata.pythonPath,
                    hasOwnership: !!metadata.ownership
                });
                return null;
            }
            
            return metadata;
        } catch (error) {
            // Corrupted or unreadable bridge-env.json - treat as missing
            debugLog('InterpreterSelectionService: failed to read bridge-env.json', {
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Log interpreter selection at Normal observability level
     * Plan 108 Milestone 4.1: Always-on, low-volume logging
     */
    private logSelection(result: InterpreterSelectionResult): void {
        debugLog('InterpreterSelectionService: interpreter selected', {
            pythonPath: result.pythonPath,
            reason: result.reason,
            ownership: result.ownership ?? 'unknown',
            metadataExists: result.metadataExists
        });
    }
}
