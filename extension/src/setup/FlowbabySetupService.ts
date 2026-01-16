import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, execFileSync, ExecFileSyncOptions } from 'child_process';
import * as crypto from 'crypto';
import { BackgroundOperationManager } from '../background/BackgroundOperationManager';
import { FlowbabyStatusBar, FlowbabyStatus } from '../statusBar/FlowbabyStatusBar';
import { debugLog } from '../outputChannels';
import { BackupAuditLogger, BackupAuditEventType } from './BackupAuditLogger';

export type WorkspaceHealthStatus = 'FRESH' | 'BROKEN' | 'VALID';

/**
 * Plan 101: Embedding schema marker file path (relative to .flowbaby/)
 * Located under system/ to group control-plane artifacts
 */
export const EMBEDDING_SCHEMA_VERSION = 'system/EMBEDDING_SCHEMA_VERSION';

/**
 * Plan 101: Current embedding schema version for v0.7.0+
 * Increment this when embedding model/dimensions change in a breaking way
 */
export const CURRENT_EMBEDDING_SCHEMA = 2;

/**
 * Plan 107 REQ-7: Guard file name (stored in globalStorageUri, workspace-partitioned)
 * Written before rename, deleted on success, orphan detected on activation.
 */
export const BACKUP_GUARD_FILENAME = 'backup-guard.json';

/**
 * Plan 107: Quiescence timeout for daemon stop before rename (ms)
 */
export const QUIESCE_TIMEOUT_MS = 15000;

/**
 * Plan 101: Result of pre-upgrade migration check
 */
export interface PreUpgradeMigrationResult {
    /** Action taken: 'none' (no migration needed), 'backup-success', 'backup-failed', 'io-error', 'user-declined', 'revalidation-aborted' */
    action: 'none' | 'backup-success' | 'backup-failed' | 'io-error' | 'user-declined' | 'revalidation-aborted';
    /** Whether workspace needs fresh initialization after this check */
    requiresFreshInit: boolean;
    /** Path to backup folder if backup was created */
    backupPath?: string;
    /** Error message if backup failed */
    error?: string;
}

/**
 * Plan 107: Migration detection state model
 * 
 * Every activation must resolve and log exactly one of these states:
 * - NOT_LEGACY: marker present with current version; no backup needed
 * - LEGACY_CONFIRMED: marker missing/old in a deterministic way; eligible to prompt for backup
 * - UNKNOWN_IO_ERROR: any non-ENOENT error when reading marker; must NOT trigger backup
 */
export type MigrationDetectionState = 'NOT_LEGACY' | 'LEGACY_CONFIRMED' | 'UNKNOWN_IO_ERROR';

/**
 * Plan 107: Result of migration state detection
 */
export interface MigrationDetectionResult {
    /** The detected state */
    state: MigrationDetectionState;
    /** Whether backup is required (only true for LEGACY_CONFIRMED) */
    requiresBackup: boolean;
    /** Human-readable reason for the decision */
    reason: string;
    /** Detailed data for forensic logging */
    data: {
        flowbabyExists: boolean;
        bridgeEnvExists: boolean;
        bridgeEnvOwnership?: 'managed' | 'external';
        markerPath: string;
        markerExists?: boolean;
        markerContent?: string;
        markerVersion?: number;
        currentSchemaVersion: number;
        errorCode?: string;
        errorMessage?: string;
    };
}

/**
 * Plan 101: Result of backup operation
 */
export interface BackupResult {
    success: boolean;
    backupPath?: string;
    error?: string;
}

export interface BridgeEnvMetadata {
    pythonPath: string;
    ownership: 'managed' | 'external';
    requirementsHash: string;
    createdAt: string;
    platform: string;
}

export interface BridgeVersionMetadata {
    bridgeVersion: string;
    extensionVersion: string;
    pythonVersion: string;
    requirementsHash: string;
    lastVerifiedAt: string;
}

interface EnvVerificationResult {
    status: 'ok' | 'error';
    details: Record<string, boolean>;
    missing?: string[];
    python_version?: string;
    bridge_version?: string;
}

export class FlowbabySetupService {
    private readonly workspacePath: string;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly bridgePath: string;
    private readonly fs: { existsSync: (path: string) => boolean };
    private readonly spawnFn: typeof spawn;
    private readonly statusBar?: FlowbabyStatusBar;
    private readonly stopDaemonFn?: () => Promise<void>;
    private readonly context: vscode.ExtensionContext;
    private auditLogger: BackupAuditLogger | null = null;
    private readonly extensionVersion: string;

    private _isVerified: boolean = false;

    get isVerified(): boolean {
        return this._isVerified;
    }

    private async setVerified(value: boolean) {
        this._isVerified = value;
        await vscode.commands.executeCommand('setContext', 'Flowbaby.environmentVerified', value);
        
        if (this.statusBar) {
            if (value) {
                this.statusBar.setStatus(FlowbabyStatus.Ready);
            } else {
                this.statusBar.setStatus(FlowbabyStatus.SetupRequired);
            }
        }
    }

    constructor(
        context: vscode.ExtensionContext, 
        workspacePath: string, 
        outputChannel: vscode.OutputChannel,
        fileSystem?: { existsSync: (path: string) => boolean },
        spawnFunction?: typeof spawn,
        statusBar?: FlowbabyStatusBar,
        stopDaemonFn?: () => Promise<void>
    ) {
        this.context = context;
        this.workspacePath = workspacePath;
        this.outputChannel = outputChannel;
        this.bridgePath = path.join(context.extensionPath, 'bridge');
        this.fs = fileSystem || fs;
        this.spawnFn = spawnFunction || spawn;
        this.statusBar = statusBar;
        this.stopDaemonFn = stopDaemonFn;
        // Plan 107: Get extension version for audit logging
        this.extensionVersion = context.extension?.packageJSON?.version ?? 'unknown';
    }

    /**
     * Plan 050: Early dependency mismatch detection (hash-based, no Python spawn)
     * Returns 'match' when hashes align, 'mismatch' when update is needed, 'unknown' on missing metadata/errors.
     */
    async checkRequirementsUpToDate(): Promise<'match' | 'mismatch' | 'unknown'> {
        const bridgeEnv = await this.readBridgeEnv();
        if (!bridgeEnv) {
            await this.setVerified(false);
            return 'unknown';
        }

        try {
            const currentHash = await this.computeRequirementsHash();
            if (bridgeEnv.requirementsHash !== currentHash) {
                await this.setVerified(false);
                if (this.statusBar) {
                    this.statusBar.setStatus(FlowbabyStatus.SetupRequired, 'Update Required');
                }
                return 'mismatch';
            }

            await this.setVerified(true);
            return 'match';
        } catch (error) {
            debugLog('Failed to compute requirements hash during mismatch check', { error: String(error) });
            await this.setVerified(false);
            return 'unknown';
        }
    }

    /**
     * Initialize workspace environment (Milestone 4)
     * Checks for .venv, offers to create if missing.
     */
    async initializeWorkspace(): Promise<void> {
        const bridgeEnv = await this.readBridgeEnv();
        
        if (bridgeEnv) {
            if (bridgeEnv.ownership === 'managed') {
                this.log('Found managed environment.');
                const verified = await this.verifyEnvironment();
                if (verified) {
                    // Check hash - if mismatch, set unverified but don't prompt here.
                    // Activation-time handleRequirementsMismatch in init.ts handles user notification.
                    const currentHash = await this.computeRequirementsHash();
                    if (bridgeEnv.requirementsHash !== currentHash) {
                        await this.setVerified(false);
                        if (this.statusBar) {
                            this.statusBar.setStatus(FlowbabyStatus.SetupRequired, 'Update Required');
                        }
                        // No modal prompt here - activation handles it
                    } else {
                        await this.setVerified(true);
                    }
                } else {
                    await this.setVerified(false);
                    vscode.window.showErrorMessage(
                        'Flowbaby environment is unhealthy.',
                        'Repair Environment'
                    ).then(selection => {
                        if (selection === 'Repair Environment') {
                            this.refreshDependencies();
                        }
                    });
                }
            } else {
                // External
                this.log('Found external environment.');
                const verified = await this.verifyEnvironment();
                
                if (verified) {
                    // Check hash - if mismatch, set unverified but don't prompt here.
                    // Activation-time handleRequirementsMismatch in init.ts handles user notification.
                    const currentHash = await this.computeRequirementsHash();
                    if (bridgeEnv.requirementsHash !== currentHash) {
                        await this.setVerified(false);
                        if (this.statusBar) {
                            this.statusBar.setStatus(FlowbabyStatus.SetupRequired, 'External env out of date');
                        }
                        // No modal prompt here - activation handles it
                    } else {
                        await this.setVerified(true);
                    }
                } else {
                    await this.setVerified(false);
                    if (this.statusBar) {
                        this.statusBar.setStatus(FlowbabyStatus.Error, 'Environment Broken');
                    }
                    vscode.window.showWarningMessage('External Python environment is missing dependencies.');
                }
            }
            return;
        }

        // No bridge-env.json
        const config = vscode.workspace.getConfiguration('Flowbaby');
        const defaultPython = this.getSystemPythonCommand();
        const pythonPath = config.get<string>('pythonPath', defaultPython);
        
        if (pythonPath !== defaultPython && pythonPath !== '') {
            // Explicit path set
            const adopt = await vscode.window.showInformationMessage(
                'Flowbaby found a configured Python path. Use this environment?',
                'Use Configured Python',
                'Create Managed Environment'
            );
            
            if (adopt === 'Use Configured Python') {
                // Plan 107 REQ-5: Ensure .flowbaby directory exists and write marker EARLY
                const cogneeDir = path.join(this.workspacePath, '.flowbaby');
                if (!this.fs.existsSync(cogneeDir)) {
                    await fs.promises.mkdir(cogneeDir, { recursive: true });
                }
                await this.writeEmbeddingSchemaMarker();
                
                // Adopt as external
                const requirementsHash = await this.computeRequirementsHash();
                await this.writeBridgeEnv({
                    pythonPath: pythonPath,
                    ownership: 'external',
                    requirementsHash: requirementsHash,
                    createdAt: new Date().toISOString(),
                    platform: process.platform
                });

                // Note: Marker already written early per Plan 107 REQ-5

                const verified = await this.verifyEnvironment();
                if (verified) {
                    await this.setVerified(true);
                } else {
                    await this.setVerified(false);
                    vscode.window.showWarningMessage('External Python environment is missing dependencies.');
                }
            } else if (adopt === 'Create Managed Environment') {
                await this.createEnvironment();
            }
        } else {
            // No config, no metadata -> Prompt setup
            const create = await vscode.window.showInformationMessage(
                'Flowbaby requires a Python environment.',
                'Initialize Workspace'
            );
            
            if (create === 'Initialize Workspace') {
                await this.createEnvironment();
            }
        }
    }

    /**
     * Create .flowbaby/venv and install dependencies (Plan 028 M3)
     * Uses isolated .flowbaby/venv path to avoid conflicts with user's workspace .venv
     * 
     * Plan 109: Always use managed .flowbaby/venv - no modal choice for existing .venv
     */
    async createEnvironment(): Promise<boolean> {
        if (this.statusBar) {this.statusBar.setStatus(FlowbabyStatus.Refreshing, 'Creating environment...');}
        
        // Plan 028 M2: Debug logging for setup operations
        debugLog('Creating Python environment', { workspacePath: this.workspacePath });
        
        // Plan 109: Log if workspace has existing .venv but always use managed .flowbaby/venv
        // The modal choice has been removed - managed venv is the only supported path via UX
        const existingVenvPath = path.join(this.workspacePath, '.venv');
        if (this.fs.existsSync(existingVenvPath)) {
            debugLog('Plan 109: Existing workspace .venv detected but using managed .flowbaby/venv', { 
                existingVenvPath,
                managedVenvPath: path.join(this.workspacePath, '.flowbaby', 'venv')
            });
            // Note: installIntoExistingVenv() path is retained but unreachable via normal UX
        }
        
        // Plan 028 M3: Check BackgroundOperationManager queue before proceeding
        try {
            const bgManager = BackgroundOperationManager.getInstance();
            const operations = bgManager.getStatus();
            const runningOps = Array.isArray(operations) 
                ? operations.filter(op => op.status === 'running' || op.status === 'pending')
                : [];
            
            if (runningOps.length > 0) {
                const proceed = await vscode.window.showWarningMessage(
                    `"Flowbaby has ${runningOps.length} pending operation(s). Creating a new environment may disrupt them.`,
                    'Wait for Completion',
                    'Create Anyway'
                );
                
                if (proceed !== 'Create Anyway') {
                    debugLog('Environment creation cancelled due to pending operations', { count: runningOps.length });
                    return false;
                }
                
                debugLog('User chose to create environment despite pending operations', { count: runningOps.length });
            }
        } catch {
            // BackgroundOperationManager not initialized yet - proceed
            debugLog('BackgroundOperationManager not initialized - proceeding with environment creation');
        }
        
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Setting up Flowbaby Environment...",
            cancellable: false
        }, async (progress) => {
            // Plan 028 M3: Use isolated .flowbaby/venv path
            const cogneeDir = path.join(this.workspacePath, '.flowbaby');
            const venvPath = path.join(cogneeDir, 'venv');
            
            try {
                // 1. Check Python Version
                progress.report({ message: "Checking Python version..." });
                const pythonCommand = this.getSystemPythonCommand();
                const isVersionValid = await this.checkPythonVersion(pythonCommand);
                
                if (!isVersionValid) {
                    throw new Error('PYTHON_VERSION_UNSUPPORTED: Python 3.10–3.12 is required.');
                }

                // 2. Ensure .flowbaby directory exists
                if (!this.fs.existsSync(cogneeDir)) {
                    await fs.promises.mkdir(cogneeDir, { recursive: true });
                }

                // Plan 107 REQ-5: Write marker EARLY in initialization
                // This prevents false-positive backup triggers on partial init
                // If later steps fail, the marker ensures we don't treat the workspace as pre-0.7.0
                await this.writeEmbeddingSchemaMarker();

                // 3. Create venv in .flowbaby/venv
                progress.report({ message: "Creating virtual environment..." });
                this.log('Creating virtual environment in .flowbaby/venv...');
                debugLog('Creating venv', { venvPath });
                await this.runCommand(pythonCommand, ['-m', 'venv', venvPath], this.workspacePath);
                this.log('Virtual environment created successfully.');

                // 4. Install dependencies
                progress.report({ message: "Installing dependencies (this may take 1-2 minutes)..." });
                this.log('Starting dependency installation...');
                await this.installDependencies();
                this.log('Dependency installation complete.');

                // 5. Verify installation
                progress.report({ message: "Verifying installation..." });
                const verified = await this.verifyEnvironment();
                if (!verified) {
                    throw new Error('VERIFICATION_FAILED: Environment verification script failed.');
                }

                // 6. Write Metadata atomically AFTER success
                const pythonPath = this.getPythonPath();
                const requirementsHash = await this.computeRequirementsHash();
                
                await this.writeBridgeEnv({
                    pythonPath: pythonPath,
                    ownership: 'managed',
                    requirementsHash: requirementsHash,
                    createdAt: new Date().toISOString(),
                    platform: process.platform
                });

                await this.setVerified(true);

                // Note: Marker already written early per Plan 107 REQ-5

                vscode.window.showInformationMessage('Flowbaby environment setup complete!');
                debugLog('Environment creation successful', { venvPath });
                return true;
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.log('Setup failed: ' + errorMessage);
                if (error instanceof Error && error.stack) {
                    this.log('Stack trace: ' + error.stack);
                }
                debugLog('Environment creation failed', { error: String(error), venvPath });
                
                // Plan 047: Reveal output channel on failure
                this.outputChannel.show(true);
                
                // Rollback
                if (this.fs.existsSync(venvPath)) {
                    this.log('Rolling back partial environment...');
                    await fs.promises.rm(venvPath, { recursive: true, force: true });
                }

                let userMessage = 'Setup failed.';
                if (errorMessage.includes('PYTHON_VERSION_UNSUPPORTED')) {
                    userMessage = 'Python 3.10–3.12 is required. Please install it and try again.';
                } else if (errorMessage.includes('VERIFICATION_FAILED')) {
                    userMessage = 'Environment verification failed. Check logs.';
                } else {
                    userMessage = 'Setup failed. Check output for details.';
                }

                vscode.window.showErrorMessage(userMessage);
                if (this.statusBar) {this.statusBar.setStatus(FlowbabyStatus.Error, userMessage);}
                return false;
            }
        });
    }

    /**
     * Install into existing workspace .venv (Plan 028 M7 - Advanced option)
     * Used when user chooses to use their existing .venv instead of .flowbaby/venv
     */
    private async installIntoExistingVenv(): Promise<boolean> {
        if (this.statusBar) {this.statusBar.setStatus(FlowbabyStatus.Refreshing, 'Installing into existing .venv...');}
        
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Installing Flowbaby into existing .venv...",
            cancellable: false
        }, async (progress) => {
            const venvPath = path.join(this.workspacePath, '.venv');
            
            try {
                // Plan 107 REQ-5: Ensure .flowbaby directory exists and write marker EARLY
                const cogneeDir = path.join(this.workspacePath, '.flowbaby');
                if (!this.fs.existsSync(cogneeDir)) {
                    await fs.promises.mkdir(cogneeDir, { recursive: true });
                }
                await this.writeEmbeddingSchemaMarker();

                // 1. Install dependencies into existing venv
                progress.report({ message: "Installing dependencies..." });
                
                // Get python path for existing venv
                const isWindows = process.platform === 'win32';
                const pythonPath = isWindows
                    ? path.join(venvPath, 'Scripts', 'python.exe')
                    : path.join(venvPath, 'bin', 'python');
                
                const requirementsPath = path.join(this.bridgePath, 'requirements.txt');
                // Plan 046: Use python -m pip for robustness
                await this.runCommand(pythonPath, ['-m', 'pip', 'install', '-r', requirementsPath], this.workspacePath);

                // 2. Verify installation
                progress.report({ message: "Verifying installation..." });
                const verified = await this.verifyEnvironment();
                if (!verified) {
                    throw new Error('VERIFICATION_FAILED: Environment verification script failed.');
                }

                // 3. Write Metadata
                const requirementsHash = await this.computeRequirementsHash();
                
                await this.writeBridgeEnv({
                    pythonPath: pythonPath,
                    ownership: 'managed',  // Still managed, but using legacy location
                    requirementsHash: requirementsHash,
                    createdAt: new Date().toISOString(),
                    platform: process.platform
                });

                await this.setVerified(true);

                // Note: Marker already written early per Plan 107 REQ-5

                vscode.window.showInformationMessage('Flowbaby installed into existing .venv');
                debugLog('Environment setup completed using existing .venv', { venvPath });
                return true;
            } catch (error: unknown) {
                this.log('Setup into existing .venv failed: ' + (error instanceof Error ? error.message : String(error)));
                if (error instanceof Error && error.stack) {
                    this.log('Stack trace: ' + error.stack);
                }
                debugLog('Setup into existing .venv failed', { error: String(error) });
                
                this.outputChannel.show(true);

                vscode.window.showErrorMessage('Failed to install into existing .venv. Check output for details.');
                if (this.statusBar) {this.statusBar.setStatus(FlowbabyStatus.Error, 'Setup failed');}
                return false;
            }
        });
    }

    /**
     * Install dependencies from requirements.txt
     */
    async installDependencies(): Promise<void> {
        const requirementsPath = path.join(this.bridgePath, 'requirements.txt');
        const pythonPath = this.getPythonPath();
        
        this.log(`Installing dependencies from ${requirementsPath}...`);
        
        // Plan 028 M2: Debug logging for pip install
        debugLog('Installing pip dependencies', { 
            requirementsPath, 
            pythonPath 
        });
        
        try {
            // Plan 046: Use python -m pip instead of pip executable for better Windows robustness
            await this.runCommand(pythonPath, ['-m', 'pip', 'install', '-r', requirementsPath], this.workspacePath);
            this.log('Dependencies installed successfully.');
            debugLog('Pip install completed successfully');
        } catch (e) {
            debugLog('Pip install failed', { error: String(e) });
            throw new Error(`PIP_INSTALL_FAILED: ${e}`);
        }
    }

    /**
     * Verify environment using verify_environment.py
     */
    async verifyEnvironment(): Promise<boolean> {
        const pythonPath = this.getPythonPath();
        const scriptPath = path.join(this.bridgePath, 'verify_environment.py');
        
        try {
            const output = await this.runCommand(pythonPath, [scriptPath, this.workspacePath], this.workspacePath, true);
            const result = JSON.parse(output) as EnvVerificationResult;
            
            this.log('Verification result: ' + JSON.stringify(result));
            
            if (result.status === 'ok') {
                const requirementsHash = await this.computeRequirementsHash();
                const extension = vscode.extensions.getExtension('flowbaby.flowbaby-chat-memory');
                const extensionVersion = extension ? extension.packageJSON.version : '0.0.0';

                await this.writeBridgeVersion({
                    bridgeVersion: result.bridge_version || '0.0.0',
                    extensionVersion: extensionVersion,
                    pythonVersion: result.python_version || '0.0.0',
                    requirementsHash: requirementsHash,
                    lastVerifiedAt: new Date().toISOString()
                });
                return true;
            }
            return false;
        } catch (error) {
            this.log('Verification failed: ' + error);
            return false;
        }
    }

    /**
     * Plan 039 M3: Proactive Workspace Health Check
     * 
     * Determines the health state of the Flowbaby workspace environment:
     * - FRESH: No .flowbaby directory exists OR .flowbaby exists but no bridge-env.json
     *          → user needs to initialize
     * - BROKEN: .flowbaby exists with bridge-env.json but environment is corrupt
     *           → user needs to repair
     * - VALID: All components present and healthy → proceed with client initialization
     * 
     * Plan 040 M3: Refined FRESH vs BROKEN distinction. Missing bridge-env.json is now
     * treated as FRESH (not BROKEN) since this is the expected state for workspaces
     * where only the logs directory has been created by VS Code or a previous failed run.
     * 
     * Note: These changes are additive refinements to the existing file/folder-based
     * health-check logic. No additional UX surfaces need to be audited beyond the
     * status bar and initialization prompts that already consume health state.
     * 
     * @returns Promise<WorkspaceHealthStatus> - 'FRESH' | 'BROKEN' | 'VALID'
     */
    async checkWorkspaceHealth(): Promise<WorkspaceHealthStatus> {
        const flowbabyDir = path.join(this.workspacePath, '.flowbaby');
        
        // Scenario 1: No .flowbaby directory → FRESH workspace
        if (!this.fs.existsSync(flowbabyDir)) {
            debugLog('Workspace health check: FRESH (no .flowbaby directory)');
            return 'FRESH';
        }

        // Scenario 2: Check for migration marker indicating unresolved migration
        // This is BROKEN even if bridge-env.json is missing because it indicates
        // an interrupted migration that needs repair.
        const migrationMarkerPath = path.join(flowbabyDir, '.migration-in-progress');
        if (this.fs.existsSync(migrationMarkerPath)) {
            debugLog('Workspace health check: BROKEN (migration marker exists)');
            return 'BROKEN';
        }
        
        // Scenario 3: .flowbaby exists but bridge-env.json is missing → FRESH
        // Plan 040 M3: This is the expected state for new workspaces where only
        // .flowbaby/logs has been created. Treat as FRESH, not BROKEN.
        const bridgeEnv = await this.readBridgeEnv();
        if (!bridgeEnv) {
            debugLog('Workspace health check: FRESH (bridge-env.json missing - new workspace)');
            return 'FRESH';
        }
        
        // Scenario 4: bridge-env.json exists, check Python environment health
        const pythonPath = bridgeEnv.pythonPath;
        const venvDir = path.dirname(path.dirname(pythonPath)); // Go up from bin/python to venv
        
        // Check if venv directory exists
        if (!this.fs.existsSync(venvDir)) {
            debugLog('Workspace health check: BROKEN (venv directory missing)', { venvDir });
            return 'BROKEN';
        }
        
        // Check if Python executable exists
        if (!this.fs.existsSync(pythonPath)) {
            debugLog('Workspace health check: BROKEN (Python executable missing)', { pythonPath });
            return 'BROKEN';
        }
        
        // All checks passed → VALID
        debugLog('Workspace health check: VALID');
        return 'VALID';
    }

    /**
     * Plan 101: Check if this workspace was created by a pre-0.7.0 version
     * 
     * Detection logic (ordered):
     * 1. If .flowbaby doesn't exist → not pre-upgrade (fresh workspace)
     * 2. If bridge-env.json doesn't exist → not pre-upgrade (fresh workspace)
     * 3. If EMBEDDING_SCHEMA_VERSION marker exists with current version → not pre-upgrade
     * 4. If EMBEDDING_SCHEMA_VERSION marker exists with older version → pre-upgrade
     * 5. If marker is missing but bridge-env.json exists → pre-upgrade (v0.6.x)
     * 
     * @returns true if workspace needs migration backup, false otherwise
     */
    async isPreUpgradeWorkspace(): Promise<boolean> {
        const flowbabyDir = path.join(this.workspacePath, '.flowbaby');
        
        // No .flowbaby directory → fresh workspace, not pre-upgrade
        if (!this.fs.existsSync(flowbabyDir)) {
            debugLog('isPreUpgradeWorkspace: false (no .flowbaby directory)');
            return false;
        }
        
        // No bridge-env.json → fresh workspace, not pre-upgrade
        const bridgeEnv = await this.readBridgeEnv();
        if (!bridgeEnv) {
            debugLog('isPreUpgradeWorkspace: false (no bridge-env.json)');
            return false;
        }
        
        // Check schema marker
        const markerPath = path.join(flowbabyDir, EMBEDDING_SCHEMA_VERSION);
        if (this.fs.existsSync(markerPath)) {
            try {
                const content = await fs.promises.readFile(markerPath, 'utf8');
                const version = parseInt(content.trim(), 10);
                if (version >= CURRENT_EMBEDDING_SCHEMA) {
                    debugLog('isPreUpgradeWorkspace: false (current schema version)', { version });
                    return false;
                }
                debugLog('isPreUpgradeWorkspace: true (older schema version)', { version, current: CURRENT_EMBEDDING_SCHEMA });
                return true;
            } catch (error) {
                debugLog('isPreUpgradeWorkspace: true (failed to read marker, assuming old)', { error: String(error) });
                return true;
            }
        }
        
        // bridge-env.json exists but no marker → pre-0.7.0 workspace
        debugLog('isPreUpgradeWorkspace: true (bridge-env.json exists but no schema marker)');
        return true;
    }

    /**
     * Plan 107: Detect migration state with explicit state model
     * 
     * Returns one of three states per Architecture Guardrail 1:
     * - NOT_LEGACY: marker present/current; no backup needed
     * - LEGACY_CONFIRMED: marker missing/old deterministically; eligible to prompt
     * - UNKNOWN_IO_ERROR: any non-ENOENT error; must NOT trigger backup
     * 
     * REQ-2: Fail-open on marker read error (non-ENOENT → UNKNOWN_IO_ERROR)
     * REQ-3: Atomic detection via single-read pattern (no TOCTOU)
     * 
     * @returns MigrationDetectionResult with state, reason, and diagnostic data
     */
    async detectMigrationState(): Promise<MigrationDetectionResult> {
        const flowbabyDir = path.join(this.workspacePath, '.flowbaby');
        const markerPath = path.join(flowbabyDir, EMBEDDING_SCHEMA_VERSION);
        
        // Build diagnostic data progressively
        const data: MigrationDetectionResult['data'] = {
            flowbabyExists: false,
            bridgeEnvExists: false,
            markerPath,
            currentSchemaVersion: CURRENT_EMBEDDING_SCHEMA
        };

        // Step 1: Check .flowbaby directory exists
        if (!this.fs.existsSync(flowbabyDir)) {
            data.flowbabyExists = false;
            const result: MigrationDetectionResult = {
                state: 'NOT_LEGACY',
                requiresBackup: false,
                reason: 'No .flowbaby directory (fresh workspace)',
                data
            };
            console.log('[BACKUP-TRIGGER] detectMigrationState', result);
            return result;
        }
        data.flowbabyExists = true;

        // Step 2: Check bridge-env.json exists
        const bridgeEnv = await this.readBridgeEnv();
        if (!bridgeEnv) {
            data.bridgeEnvExists = false;
            const result: MigrationDetectionResult = {
                state: 'NOT_LEGACY',
                requiresBackup: false,
                reason: 'No bridge-env.json (fresh workspace)',
                data
            };
            console.log('[BACKUP-TRIGGER] detectMigrationState', result);
            return result;
        }
        data.bridgeEnvExists = true;
        data.bridgeEnvOwnership = bridgeEnv.ownership;

        // Step 3: Single-read attempt for marker (REQ-3: atomic detection)
        // Do NOT use existsSync + readFile (TOCTOU race)
        try {
            const content = await fs.promises.readFile(markerPath, 'utf8');
            data.markerExists = true;
            data.markerContent = content.trim();
            
            const version = parseInt(content.trim(), 10);
            data.markerVersion = isNaN(version) ? undefined : version;

            if (!isNaN(version) && version >= CURRENT_EMBEDDING_SCHEMA) {
                const result: MigrationDetectionResult = {
                    state: 'NOT_LEGACY',
                    requiresBackup: false,
                    reason: `Current schema version (${version})`,
                    data
                };
                console.log('[BACKUP-TRIGGER] detectMigrationState', result);
                return result;
            }

            // Old version marker
            const result: MigrationDetectionResult = {
                state: 'LEGACY_CONFIRMED',
                requiresBackup: true,
                reason: `Older schema version (${version}, current: ${CURRENT_EMBEDDING_SCHEMA})`,
                data
            };
            console.log('[BACKUP-TRIGGER] detectMigrationState', result);
            return result;

        } catch (error: any) {
            // REQ-2: Distinguish ENOENT from other errors
            if (error.code === 'ENOENT') {
                // Marker file doesn't exist, but bridge-env.json does → pre-0.7.0
                data.markerExists = false;
                const result: MigrationDetectionResult = {
                    state: 'LEGACY_CONFIRMED',
                    requiresBackup: true,
                    reason: 'bridge-env.json exists but schema marker missing (pre-0.7.0)',
                    data
                };
                console.log('[BACKUP-TRIGGER] detectMigrationState', result);
                return result;
            }

            // Non-ENOENT error → UNKNOWN_IO_ERROR (REQ-2: fail-open for backup)
            data.errorCode = error.code || 'UNKNOWN';
            data.errorMessage = error.message || String(error);
            
            const result: MigrationDetectionResult = {
                state: 'UNKNOWN_IO_ERROR',
                requiresBackup: false, // Critical: do NOT trigger backup
                reason: `Marker read error (${error.code}): ${error.message}`,
                data
            };
            console.log('[BACKUP-TRIGGER] detectMigrationState UNKNOWN_IO_ERROR', result);
            return result;
        }
    }

    /**
     * Plan 101: Generate a Windows-safe, collision-resistant backup folder name
     * Format: .flowbaby-pre-0.7.0-backup-{YYYYMMDD}T{HHMMSS}-{suffix}
     * 
     * Windows-safe: No colons (ISO timestamps use colons)
     * Collision-resistant: Adds numeric suffix if folder already exists
     */
    private generateBackupFolderName(): string {
        const now = new Date();
        // Format: YYYYMMDDTHHMMSS (no colons, Windows-safe)
        const timestamp = now.toISOString()
            .replace(/[-:]/g, '')
            .replace(/\.\d{3}Z$/, '')
            .replace('T', 'T'); // Keep T separator for readability
        
        const baseName = `.flowbaby-pre-0.7.0-backup-${timestamp}`;
        let candidate = baseName;
        let suffix = 0;
        
        // Check for collision and add suffix if needed
        while (this.fs.existsSync(path.join(this.workspacePath, candidate))) {
            suffix++;
            candidate = `${baseName}-${suffix}`;
        }
        
        return candidate;
    }

    /**
     * Plan 107: Initialize the audit logger for this workspace
     */
    private async initAuditLogger(): Promise<void> {
        if (!this.auditLogger) {
            try {
                this.auditLogger = new BackupAuditLogger(this.context);
                await this.auditLogger.initializeForWorkspace(this.workspacePath);
            } catch (error) {
                // Audit logging is best-effort - don't fail if it can't be initialized
                console.log('[BACKUP-TRIGGER] initAuditLogger: failed to initialize (continuing)', { error: String(error) });
                this.auditLogger = null;
            }
        }
    }

    /**
     * Plan 107: Log an audit event (best-effort, never throws)
     */
    private async logAuditEvent(type: BackupAuditEventType, data?: Record<string, unknown>): Promise<void> {
        try {
            await this.initAuditLogger();
            if (this.auditLogger) {
                await this.auditLogger.log({
                    type,
                    timestamp: new Date().toISOString(),
                    windowId: vscode.env.sessionId,
                    workspacePath: this.workspacePath,
                    extensionVersion: this.extensionVersion,
                    data
                });
            }
        } catch (error) {
            // Audit logging is best-effort - log to console but don't fail
            console.log('[BACKUP-TRIGGER] logAuditEvent: failed to log event (continuing)', { 
                type, 
                error: String(error) 
            });
        }
    }

    /**
     * Plan 107 REQ-7: Get guard file path (in globalStorageUri, workspace-partitioned)
     */
    private getGuardFilePath(): string {
        const workspaceHash = crypto.createHash('sha256')
            .update(this.workspacePath)
            .digest('hex')
            .substring(0, 12);
        return path.join(this.context.globalStorageUri.fsPath, 'backup-audit', `backup-guard-${workspaceHash}.json`);
    }

    /**
     * Plan 107 REQ-7: Write guard file before rename with rich state (best-effort)
     */
    private async writeGuardFile(operationId: string, backupPath: string): Promise<void> {
        try {
            const guardPath = this.getGuardFilePath();
            const guardContent = {
                operationId,
                timestamp: new Date().toISOString(),
                workspacePath: this.workspacePath,
                extensionVersion: this.extensionVersion,
                backupPath,
                status: 'in-progress'
            };
            
            // Ensure directory exists
            await fs.promises.mkdir(path.dirname(guardPath), { recursive: true });
            await fs.promises.writeFile(guardPath, JSON.stringify(guardContent, null, 2), 'utf8');
            
            console.log('[BACKUP-TRIGGER] writeGuardFile: guard file written', { guardPath });
            await this.logAuditEvent(BackupAuditEventType.BACKUP_GUARD_FILE_WRITTEN, {
                guardFilePath: guardPath,
                operationId
            });
        } catch (error) {
            // Guard file is best-effort - log but don't fail backup
            console.log('[BACKUP-TRIGGER] writeGuardFile: failed (continuing)', { error: String(error) });
        }
    }

    /**
     * Plan 107 REQ-7: Delete guard file on successful backup (best-effort)
     */
    private async deleteGuardFile(): Promise<void> {
        try {
            const guardPath = this.getGuardFilePath();
            await fs.promises.unlink(guardPath);
            console.log('[BACKUP-TRIGGER] deleteGuardFile: guard file deleted', { guardPath });
            await this.logAuditEvent(BackupAuditEventType.BACKUP_GUARD_FILE_DELETED, {
                guardFilePath: guardPath
            });
        } catch (error) {
            // Ignore all errors - guard file deletion is best-effort
            console.log('[BACKUP-TRIGGER] deleteGuardFile: failed or not present (continuing)', { error: String(error) });
        }
    }

    /**
     * Plan 107 REQ-7: Check for orphan guard file on activation
     * Returns the guard file content if an orphan is detected, null otherwise.
     */
    async checkOrphanGuardFile(): Promise<{ operationId: string; timestamp: string; backupPath: string } | null> {
        try {
            const guardPath = this.getGuardFilePath();
            const content = await fs.promises.readFile(guardPath, 'utf8');
            const parsed = JSON.parse(content);
            
            console.log('[BACKUP-TRIGGER] checkOrphanGuardFile: orphan guard file detected', { guardPath, parsed });
            await this.logAuditEvent(BackupAuditEventType.ORPHAN_GUARD_FILE_DETECTED, {
                guardFilePath: guardPath,
                operationId: parsed.operationId,
                backupPath: parsed.backupPath
            });
            
            return parsed;
        } catch {
            // No guard file or parse error - normal case
            return null;
        }
    }

    /**
     * Plan 101/107: Backup the pre-upgrade .flowbaby folder
     * 
     * Plan 107 enhancements:
     * - REQ-7: Write guard file before rename, delete on success
     * - REQ-8: Audit logging for all events
     * - Architecture: Quiesce-before-rename is enforced (abort on failure)
     * 
     * Steps:
     * 1. Quiesce workspace (daemon stop + background ops pause) with bounded timeout
     * 2. Write guard file with rich state
     * 3. Generate Windows-safe backup folder name
     * 4. Rename .flowbaby → backup folder
     * 5. Delete guard file on success
     * 
     * @returns BackupResult with success status and backup path or error
     */
    async backupPreUpgradeWorkspace(): Promise<BackupResult> {
        const flowbabyDir = path.join(this.workspacePath, '.flowbaby');
        const operationId = crypto.randomUUID();
        
        await this.logAuditEvent(BackupAuditEventType.BACKUP_STARTED, {
            operationId,
            sourcePath: flowbabyDir
        });
        
        // Step 1: Quiesce workspace with enforced timeout (Architecture Guardrail 4)
        await this.logAuditEvent(BackupAuditEventType.BACKUP_QUIESCE_START, {
            operationId,
            quiesceTimeoutMs: QUIESCE_TIMEOUT_MS
        });
        
        let daemonStopped = false;
        let backgroundOpsPaused = false;
        
        // 1a. Pause background operations (if manager available)
        let bgManager: BackgroundOperationManager | null = null;
        try {
            bgManager = BackgroundOperationManager.getInstance();
            backgroundOpsPaused = await bgManager.pause(5000); // 5s timeout for pause
        } catch {
            // Manager not initialized - proceed
            backgroundOpsPaused = true; // No ops to pause
        }
        
        // 1b. Stop daemon with bounded wait
        if (this.stopDaemonFn) {
            const timeoutPromise = new Promise<boolean>((resolve) => {
                setTimeout(() => resolve(false), QUIESCE_TIMEOUT_MS);
            });
            const stopPromise = this.stopDaemonFn()
                .then(() => true)
                .catch(() => false);
            
            daemonStopped = await Promise.race([stopPromise, timeoutPromise]);
            
            if (daemonStopped) {
                // Give Windows a moment to release file locks
                await new Promise(resolve => setTimeout(resolve, 300));
                console.log('[BACKUP-TRIGGER] backupPreUpgradeWorkspace: daemon stopped successfully');
            } else {
                console.log('[BACKUP-TRIGGER] backupPreUpgradeWorkspace: daemon stop timed out or failed');
            }
        } else {
            daemonStopped = true; // No daemon to stop
        }
        
        // Check if quiescence achieved
        if (!daemonStopped || !backgroundOpsPaused) {
            // Architecture Guardrail 4: If quiescence cannot be achieved, abort backup
            console.log('[BACKUP-TRIGGER] backupPreUpgradeWorkspace: quiescence failed - aborting backup', {
                daemonStopped,
                backgroundOpsPaused
            });
            
            await this.logAuditEvent(BackupAuditEventType.BACKUP_QUIESCE_FAILED, {
                operationId,
                daemonStopped,
                backgroundOpsPaused
            });
            
            // Resume background ops if we paused them
            if (bgManager && backgroundOpsPaused) {
                bgManager.resume();
            }
            
            return {
                success: false,
                error: 'Could not achieve workspace quiescence before backup. Please close other VS Code windows using this workspace and try again.'
            };
        }
        
        await this.logAuditEvent(BackupAuditEventType.BACKUP_QUIESCE_COMPLETE, {
            operationId,
            daemonStopped,
            backgroundOpsPaused
        });
        
        // Step 2: Generate backup folder name
        const backupFolderName = this.generateBackupFolderName();
        const backupPath = path.join(this.workspacePath, backupFolderName);
        
        // Step 3: Write guard file before rename (REQ-7)
        await this.writeGuardFile(operationId, backupPath);
        
        // Step 4: Attempt rename with retries (uses existing renameWithRetries for Windows robustness)
        try {
            console.log('[BACKUP-TRIGGER] backupPreUpgradeWorkspace: executing rename', { 
                source: flowbabyDir, 
                target: backupPath 
            });
            await this.renameWithRetries(flowbabyDir, backupPath);
            console.log('[BACKUP-TRIGGER] backupPreUpgradeWorkspace: backup successful', { backupPath });
            
            // Step 5: Delete guard file on success (REQ-7)
            await this.deleteGuardFile();
            
            await this.logAuditEvent(BackupAuditEventType.BACKUP_COMPLETED, {
                operationId,
                backupPath
            });
            
            return { success: true, backupPath };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log('[BACKUP-TRIGGER] backupPreUpgradeWorkspace: rename failed', { error: errorMessage });
            
            await this.logAuditEvent(BackupAuditEventType.BACKUP_FAILED, {
                operationId,
                errorMessage
            });
            
            // Guard file intentionally left in place for forensics
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Plan 101/107: Check for pre-upgrade workspace and perform migration if needed
     * 
     * This is the main orchestration method that should be called from activation.
     * It combines detection, backup, and user notification.
     * 
     * Plan 107 enhancements:
     * - Uses explicit state model (NOT_LEGACY, LEGACY_CONFIRMED, UNKNOWN_IO_ERROR)
     * - UNKNOWN_IO_ERROR returns io-error action (no backup, no proceed)
     * - REQ-1: User confirmation modal before backup (fail-closed on Ignore/Close)
     * - REQ-7: Check for orphan guard files on activation
     * - REQ-8: Audit logging for all events
     * 
     * @returns PreUpgradeMigrationResult indicating what happened and what to do next
     */
    async checkPreUpgradeMigration(): Promise<PreUpgradeMigrationResult> {
        // Plan 107 REQ-8: Log migration check invocation
        await this.logAuditEvent(BackupAuditEventType.MIGRATION_CHECK_INVOKED, {
            workspacePath: this.workspacePath
        });
        
        // Plan 107 REQ-7: Check for orphan guard file (interrupted previous backup)
        const orphanGuard = await this.checkOrphanGuardFile();
        if (orphanGuard) {
            // Orphan guard file detected - a previous backup was interrupted
            // This is informational; we still proceed with fresh detection
            console.log('[BACKUP-TRIGGER] checkPreUpgradeMigration: orphan guard file detected from previous interrupted backup', orphanGuard);
        }
        
        // Plan 107: Use explicit state model for detection
        const detectionResult = await this.detectMigrationState();
        
        // Plan 107 REQ-8: Log detection result
        await this.logAuditEvent(BackupAuditEventType.MIGRATION_DETECTION_RESULT, {
            detectionState: detectionResult.state,
            decisionReason: detectionResult.reason,
            ...detectionResult.data
        });
        
        // Handle UNKNOWN_IO_ERROR: fail-closed for initialization (Architecture Guardrail 2)
        if (detectionResult.state === 'UNKNOWN_IO_ERROR') {
            console.log('[BACKUP-TRIGGER] checkPreUpgradeMigration: UNKNOWN_IO_ERROR - no backup, no proceed', detectionResult);
            await this.logAuditEvent(BackupAuditEventType.UNKNOWN_IO_ERROR, {
                errorCode: detectionResult.data.errorCode,
                errorMessage: detectionResult.data.errorMessage
            });
            return { 
                action: 'io-error', 
                requiresFreshInit: false,
                error: detectionResult.reason
            };
        }
        
        // Handle NOT_LEGACY: no migration needed
        if (detectionResult.state === 'NOT_LEGACY') {
            return { action: 'none', requiresFreshInit: false };
        }
        
        // Handle LEGACY_CONFIRMED: backup is needed, but requires user confirmation first (REQ-1)
        console.log('[BACKUP-TRIGGER] checkPreUpgradeMigration: LEGACY_CONFIRMED, showing confirmation modal', detectionResult);
        
        // Plan 107 REQ-8: Log modal shown
        await this.logAuditEvent(BackupAuditEventType.BACKUP_MODAL_SHOWN, {
            detectionState: detectionResult.state,
            decisionReason: detectionResult.reason
        });
        
        // REQ-1: User confirmation modal before backup
        // Modal copy sourced from Analysis 107
        const choice = await vscode.window.showWarningMessage(
            'No existing Flowbaby 0.7.0-compatible environment has been detected. ' +
            'A new initialization is recommended. Your existing data will be backed up. ' +
            'If you believe this is an error, click "Ignore" and report the issue to the Flowbaby team.',
            { modal: true },
            'Proceed with Backup',
            'Ignore'
        );
        
        // Architecture Guardrail 3: Ignore/Cancel/Close is fail-closed
        if (choice !== 'Proceed with Backup') {
            console.log('[BACKUP-TRIGGER] checkPreUpgradeMigration: User declined backup', { choice });
            await this.logAuditEvent(BackupAuditEventType.BACKUP_USER_DECLINED, {
                decision: choice ?? 'modal-closed'
            });
            return { action: 'user-declined', requiresFreshInit: false };
        }
        
        // Plan 107 REQ-8: Log user confirmed
        await this.logAuditEvent(BackupAuditEventType.BACKUP_USER_CONFIRMED, {});
        
        console.log('[BACKUP-TRIGGER] checkPreUpgradeMigration: User confirmed, starting pre-backup revalidation', detectionResult);
        
        // REQ-4: Pre-backup revalidation - re-verify marker state immediately before backup
        // This catches race conditions where another window completed init during modal display
        const revalidationResult = await this.detectMigrationState();
        console.log('[BACKUP-TRIGGER] checkPreUpgradeMigration: Pre-backup revalidation result', revalidationResult);
        
        // Plan 107 REQ-8: Log revalidation result
        await this.logAuditEvent(BackupAuditEventType.PRE_BACKUP_REVALIDATION, {
            revalidationResult: revalidationResult.state,
            markerNowPresent: revalidationResult.state === 'NOT_LEGACY'
        });
        
        if (revalidationResult.state === 'NOT_LEGACY') {
            // Marker appeared after initial detection - abort backup
            console.log('[BACKUP-TRIGGER] checkPreUpgradeMigration: Revalidation shows NOT_LEGACY - aborting backup');
            return { action: 'revalidation-aborted', requiresFreshInit: false };
        }
        
        if (revalidationResult.state === 'UNKNOWN_IO_ERROR') {
            // IO error during revalidation - fail-closed (no backup, no proceed)
            console.log('[BACKUP-TRIGGER] checkPreUpgradeMigration: Revalidation shows UNKNOWN_IO_ERROR - aborting backup', revalidationResult);
            return { 
                action: 'io-error', 
                requiresFreshInit: false,
                error: revalidationResult.reason
            };
        }
        
        // Revalidation still shows LEGACY_CONFIRMED - proceed with backup
        console.log('[BACKUP-TRIGGER] checkPreUpgradeMigration: Revalidation confirmed LEGACY_CONFIRMED, proceeding with backup');
        
        // Attempt backup
        debugLog('checkPreUpgradeMigration: pre-0.7.0 workspace detected, attempting backup');
        const backupResult = await this.backupPreUpgradeWorkspace();
        
        if (backupResult.success) {
            return {
                action: 'backup-success',
                requiresFreshInit: true,
                backupPath: backupResult.backupPath
            };
        }
        
        // Backup failed - return failure but still require fresh init
        // (fail-closed: don't proceed with incompatible storage)
        return {
            action: 'backup-failed',
            requiresFreshInit: true,
            error: backupResult.error
        };
    }

    /**
     * Plan 101: Write the embedding schema marker file
     * 
     * Called after successful initialization to prevent repeated migration attempts.
     * Creates the system/ directory if it doesn't exist.
     */
    async writeEmbeddingSchemaMarker(): Promise<void> {
        const systemDir = path.join(this.workspacePath, '.flowbaby', 'system');
        const markerPath = path.join(systemDir, 'EMBEDDING_SCHEMA_VERSION');
        
        // Ensure system directory exists
        if (!this.fs.existsSync(systemDir)) {
            await fs.promises.mkdir(systemDir, { recursive: true });
        }
        
        // Write current schema version
        await fs.promises.writeFile(markerPath, String(CURRENT_EMBEDDING_SCHEMA), 'utf8');
        debugLog('writeEmbeddingSchemaMarker: marker written', { version: CURRENT_EMBEDDING_SCHEMA });
    }

    /**
     * Refresh dependencies command handler
     */
    async refreshDependencies(): Promise<void> {
        const bridgeEnv = await this.readBridgeEnv();
        if (bridgeEnv && bridgeEnv.ownership === 'external') {
            vscode.window.showInformationMessage(
                'Your workspace uses a custom Python interpreter. Please update dependencies manually: pip install -r extension/bridge/requirements.txt'
            );
            return;
        }

        let bgManager: BackgroundOperationManager | null = null;
        try {
            bgManager = BackgroundOperationManager.getInstance();
        } catch (error) {
            // When activation stops early (e.g., stale deps) the manager might not exist yet; proceed without pause/resume
            debugLog('Refresh dependencies without BackgroundOperationManager (not initialized yet)', { error: String(error) });
        }

        // 1. Pause Background Ops (only if manager available)
        if (bgManager) {
            const paused = await bgManager.pause(5000); // 5s timeout
            if (!paused) {
                const action = await vscode.window.showWarningMessage(
                    'Background operations are running. Cancel them to proceed with refresh?',
                    'Cancel Operations',
                    'Abort'
                );
                if (action !== 'Cancel Operations') {
                    bgManager.resume();
                    return;
                }
            }
        }

        // Plan 054: Stop the bridge daemon before touching the venv on Windows.
        // The daemon can hold a lock on .flowbaby\venv, causing EPERM on rename.
        try {
            if (this.stopDaemonFn) {
                await this.stopDaemonFn();
                // Give Windows a moment to release file locks.
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        } catch (error) {
            debugLog('Failed to stop bridge daemon before refresh (continuing)', { error: String(error) });
        }

        if (this.statusBar) {this.statusBar.setStatus(FlowbabyStatus.Refreshing, 'Refreshing dependencies...');}

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Refreshing Flowbaby Dependencies...",
            cancellable: false
        }, async (progress) => {
            // Plan 028 M3: Use .flowbaby/venv path, with fallback to legacy .venv
            const cogneeDir = path.join(this.workspacePath, '.flowbaby');
            const venvPath = path.join(cogneeDir, 'venv');
            const backupPath = path.join(cogneeDir, 'venv.backup');
            
            // Check if we need to use legacy path (existing .venv with no .flowbaby/venv)
            const useLegacyPath = !this.fs.existsSync(venvPath) && 
                                  this.fs.existsSync(path.join(this.workspacePath, '.venv'));
            
            const actualVenvPath = useLegacyPath ? path.join(this.workspacePath, '.venv') : venvPath;
            const actualBackupPath = useLegacyPath ? path.join(this.workspacePath, '.venv.backup') : backupPath;
            
            debugLog('Refreshing dependencies', { 
                venvPath: actualVenvPath, 
                useLegacyPath 
            });

            try {
                progress.report({ message: "Quiescing background operations..." });
                
                // Ensure .flowbaby directory exists for new installs
                if (!useLegacyPath && !this.fs.existsSync(cogneeDir)) {
                    await fs.promises.mkdir(cogneeDir, { recursive: true });
                }
                
                // 2. Backup venv
                if (this.fs.existsSync(actualVenvPath)) {
                    progress.report({ message: "Backing up environment..." });
                    if (this.fs.existsSync(actualBackupPath)) {
                        await fs.promises.rm(actualBackupPath, { recursive: true, force: true });
                    }
                    await this.renameWithRetries(actualVenvPath, actualBackupPath);
                }

                // 3. Recreate and Install
                progress.report({ message: "Recreating environment..." });
                const pythonCommand = this.getSystemPythonCommand();
                await this.runCommand(pythonCommand, ['-m', 'venv', actualVenvPath], this.workspacePath);
                
                progress.report({ message: "Installing dependencies..." });
                await this.installDependencies();

                // 4. Verify
                progress.report({ message: "Verifying..." });
                const verified = await this.verifyEnvironment();
                
                if (verified) {
                    // Success
                    if (this.fs.existsSync(actualBackupPath)) {
                        await fs.promises.rm(actualBackupPath, { recursive: true, force: true });
                    }

                    // Plan 049: Update bridge-env.json with new hash
                    const requirementsHash = await this.computeRequirementsHash();
                    const pythonPath = this.getPythonPath();
                    await this.writeBridgeEnv({
                        pythonPath: pythonPath,
                        ownership: 'managed',
                        requirementsHash: requirementsHash,
                        createdAt: new Date().toISOString(),
                        platform: process.platform
                    });

                    await this.setVerified(true);
                    vscode.window.showInformationMessage('Dependencies refreshed successfully.');
                    debugLog('Dependencies refresh completed successfully');
                } else {
                    throw new Error('VERIFICATION_FAILED');
                }

            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.log(`Refresh failed: ${errorMessage}`);
                if (error instanceof Error && error.stack) {
                    this.log('Stack trace: ' + error.stack);
                }
                debugLog('Dependencies refresh failed', { error: String(error) });
                
                this.outputChannel.show(true);
                
                // Restore backup
                if (this.fs.existsSync(actualBackupPath)) {
                    this.log('Restoring backup...');
                    if (this.fs.existsSync(actualVenvPath)) {
                        await fs.promises.rm(actualVenvPath, { recursive: true, force: true });
                    }
                    await this.renameWithRetries(actualBackupPath, actualVenvPath);
                }
                
                let msg = 'Refresh failed.';
                if (errorMessage.includes('PIP_INSTALL_FAILED')) {
                    msg = 'Failed to install dependencies.';
                } else if (errorMessage.includes('VERIFICATION_FAILED')) {
                    msg = 'Verification failed after refresh.';
                }
                
                vscode.window.showErrorMessage(msg + ' Previous environment restored.');
                if (this.statusBar) {this.statusBar.setStatus(FlowbabyStatus.Error, msg);}
            } finally {
                if (bgManager) {bgManager.resume();}
            }
        });
    }

    private async renameWithRetries(fromPath: string, toPath: string): Promise<void> {
        const isWindows = process.platform === 'win32';
        const maxAttempts = isWindows ? 6 : 2;
        const baseDelayMs = isWindows ? 250 : 50;

        let lastError: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await fs.promises.rename(fromPath, toPath);
                return;
            } catch (error) {
                lastError = error;

                const err = error as { code?: string; message?: string };
                const code = err?.code;
                const msg = err?.message || String(error);

                // Windows frequently returns EPERM when a process holds a handle open.
                // Retry a few times to allow file locks (or AV scanning) to settle.
                const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
                if (!retryable || attempt === maxAttempts) {
                    debugLog('renameWithRetries failed', { fromPath, toPath, attempt, code, error: msg });
                    throw error;
                }

                await new Promise(resolve => setTimeout(resolve, baseDelayMs * attempt));
            }
        }

        throw lastError;
    }

    /**
     * Wrapper for execFileSync to facilitate testing
     */
    protected execFileSync(command: string, args: string[], options: ExecFileSyncOptions): void {
        execFileSync(command, args, options);
    }

    private getSystemPythonCommand(): string {
        const config = vscode.workspace.getConfiguration('Flowbaby');
        const configuredPath = config.get<string>('pythonPath', '');
        if (configuredPath && configuredPath.trim() !== '') {
            return configuredPath;
        }

        if (process.platform === 'win32') {
            try {
                this.execFileSync('python', ['--version'], { stdio: 'ignore' });
                return 'python';
            } catch {
                try {
                    this.execFileSync('py', ['--version'], { stdio: 'ignore' });
                    return 'py';
                } catch {
                    return 'python';
                }
            }
        } else {
            try {
                this.execFileSync('python3', ['--version'], { stdio: 'ignore' });
                return 'python3';
            } catch {
                try {
                    this.execFileSync('python', ['--version'], { stdio: 'ignore' });
                    return 'python';
                } catch {
                    return 'python3';
                }
            }
        }
    }

    /**
     * Get Python path for managed environment (Plan 028 M3)
     * Priority: .flowbaby/venv > .venv (legacy fallback)
     */
    private getPythonPath(): string {
        const isWindows = process.platform === 'win32';
        const cogneeVenv = isWindows
            ? path.join(this.workspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
            : path.join(this.workspacePath, '.flowbaby', 'venv', 'bin', 'python');
        
        // Check .flowbaby/venv first (preferred)
        if (this.fs.existsSync(cogneeVenv)) {
            return cogneeVenv;
        }
        
        // Fallback to legacy .venv (for backward compatibility)
        return isWindows
            ? path.join(this.workspacePath, '.venv', 'Scripts', 'python.exe')
            : path.join(this.workspacePath, '.venv', 'bin', 'python');
    }

    private runCommand(command: string, args: string[], cwd: string, captureOutput: boolean = false): Promise<string> {
        return new Promise((resolve, reject) => {
            // Plan 047: Enhanced diagnostic logging
            this.log(`[Exec] Running: ${command} ${args.join(' ')}`);
            this.log(`[Exec] CWD: ${cwd}`);

            // Plan 046: Use shell: false to let Node.js handle argument quoting
            // This fixes issues with spaces in paths on Windows where manual quoting + shell: true was fragile
            const proc = this.spawnFn(command, args, { cwd, shell: false });
            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
                if (!captureOutput) {this.outputChannel.append(data.toString());}
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
                if (!captureOutput) {this.outputChannel.append(data.toString());}
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    // Plan 047: Include stdout in error if captured, to aid debugging
                    const outputInfo = captureOutput ? `\nStdout: ${stdout}` : '';
                    reject(new Error(`Command failed with code ${code}: ${stderr}${outputInfo}`));
                }
            });
            
            proc.on('error', (err: NodeJS.ErrnoException) => {
                // Plan 047: Log system error details
                this.log(`[Exec] Spawn error: ${err.message}`);
                if (err.code) {
                    this.log(`[Exec] Error code: ${err.code}`);
                }
                reject(err);
            });
        });
    }

    private getMetadataPath(filename: string): string {
        return path.join(this.workspacePath, '.flowbaby', filename);
    }

    async computeRequirementsHash(): Promise<string> {
        const requirementsPath = path.join(this.bridgePath, 'requirements.txt');
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(requirementsPath);
            stream.on('error', err => reject(err));
            stream.on('data', chunk => hash.update(chunk));
            stream.on('end', () => resolve(hash.digest('hex')));
        });
    }

    async readBridgeEnv(): Promise<BridgeEnvMetadata | null> {
        const filePath = this.getMetadataPath('bridge-env.json');
        if (!this.fs.existsSync(filePath)) {return null;}
        try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            return JSON.parse(content) as BridgeEnvMetadata;
        } catch (e) {
            this.log(`Failed to read bridge-env.json: ${e}`);
            return null;
        }
    }

    async writeBridgeEnv(metadata: BridgeEnvMetadata): Promise<void> {
        const dir = path.join(this.workspacePath, '.flowbaby');
        if (!this.fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
        const filePath = this.getMetadataPath('bridge-env.json');
        await fs.promises.writeFile(filePath, JSON.stringify(metadata, null, 2));
    }

    async readBridgeVersion(): Promise<BridgeVersionMetadata | null> {
        const filePath = this.getMetadataPath('bridge-version.json');
        if (!this.fs.existsSync(filePath)) {return null;}
        try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            return JSON.parse(content) as BridgeVersionMetadata;
        } catch (e) {
            this.log(`Failed to read bridge-version.json: ${e}`);
            return null;
        }
    }

    async writeBridgeVersion(metadata: BridgeVersionMetadata): Promise<void> {
        const dir = path.join(this.workspacePath, '.flowbaby');
        if (!this.fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
        const filePath = this.getMetadataPath('bridge-version.json');
        await fs.promises.writeFile(filePath, JSON.stringify(metadata, null, 2));
    }

    private async checkPythonVersion(pythonCommand: string): Promise<boolean> {
        try {
            const output = await this.runCommand(pythonCommand, ['--version'], this.workspacePath, true);
            // Output format: "Python 3.8.10"
            const match = output.match(/Python (\d+)\.(\d+)\.(\d+)/);
            if (match) {
                const major = parseInt(match[1]);
                const minor = parseInt(match[2]);
                // Enforce 3.10 - 3.12
                if (major === 3 && minor >= 10 && minor <= 12) {
                    return true;
                }
                this.log(`Unsupported Python version detected: ${major}.${minor}. Required: 3.10-3.12`);
            }
            return false;
        } catch (e) {
            this.log(`Failed to check Python version: ${e}`);
            return false;
        }
    }

    private log(message: string) {
        this.outputChannel.appendLine(`[Setup] ${message}`);
    }
}
