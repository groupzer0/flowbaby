import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, execFileSync, ExecFileSyncOptions } from 'child_process';
import * as crypto from 'crypto';
import { BackgroundOperationManager } from '../background/BackgroundOperationManager';
import { FlowbabyStatusBar, FlowbabyStatus } from '../statusBar/FlowbabyStatusBar';
import { debugLog } from '../outputChannels';

export type WorkspaceHealthStatus = 'FRESH' | 'BROKEN' | 'VALID';

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
        statusBar?: FlowbabyStatusBar
    ) {
        this.workspacePath = workspacePath;
        this.outputChannel = outputChannel;
        this.bridgePath = path.join(context.extensionPath, 'bridge');
        this.fs = fileSystem || fs;
        this.spawnFn = spawnFunction || spawn;
        this.statusBar = statusBar;
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
                    // Check hash
                    const currentHash = await this.computeRequirementsHash();
                    if (bridgeEnv.requirementsHash !== currentHash) {
                        // Plan 049: Strict enforcement for managed envs
                        await this.setVerified(false);
                        if (this.statusBar) {
                            this.statusBar.setStatus(FlowbabyStatus.SetupRequired, 'Update Required');
                        }
                        
                        const selection = await vscode.window.showWarningMessage(
                            'Flowbaby dependencies need to be updated for this version.',
                            {
                                modal: true,
                                detail: 'The extension has been updated and requires new Python packages.'
                            },
                            'Update Now',
                            'Later'
                        );

                        if (selection === 'Update Now') {
                            await this.refreshDependencies();
                            // refreshDependencies handles verification and setting verified status
                        }
                        // If 'Later', remains unverified
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
                    const currentHash = await this.computeRequirementsHash();
                    if (bridgeEnv.requirementsHash !== currentHash) {
                        // Plan 049: Strict enforcement for external envs
                        await this.setVerified(false);
                        if (this.statusBar) {
                            this.statusBar.setStatus(FlowbabyStatus.SetupRequired, 'External env out of date');
                        }

                        const selection = await vscode.window.showWarningMessage(
                            'External Flowbaby environment requires dependency updates.',
                            {
                                modal: true,
                                detail: 'The extension has been upgraded and the external Python environment must be updated to match requirements.txt.'
                            },
                            'Copy pip Command',
                            'Dismiss'
                        );

                        if (selection === 'Copy pip Command') {
                            const requirementsPath = path.join(this.bridgePath, 'requirements.txt');
                            const pipCommand = `pip install -r "${requirementsPath}"`;
                            await vscode.env.clipboard.writeText(pipCommand);
                            vscode.window.showInformationMessage('Pip command copied to clipboard.');
                        }
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
                // Adopt as external
                const requirementsHash = await this.computeRequirementsHash();
                await this.writeBridgeEnv({
                    pythonPath: pythonPath,
                    ownership: 'external',
                    requirementsHash: requirementsHash,
                    createdAt: new Date().toISOString(),
                    platform: process.platform
                });
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
     */
    async createEnvironment(): Promise<boolean> {
        if (this.statusBar) {this.statusBar.setStatus(FlowbabyStatus.Refreshing, 'Creating environment...');}
        
        // Plan 028 M2: Debug logging for setup operations
        debugLog('Creating Python environment', { workspacePath: this.workspacePath });
        
        // Plan 028 M7: Detect existing workspace .venv and offer choices
        const existingVenvPath = path.join(this.workspacePath, '.venv');
        if (this.fs.existsSync(existingVenvPath)) {
            debugLog('Existing workspace .venv detected', { existingVenvPath });
            
            const choice = await vscode.window.showInformationMessage(
                'Your workspace has an existing .venv folder. **Recommended**: Flowbaby will create its own isolated environment in .flowbaby/venv to avoid dependency conflicts.',
                { modal: true },
                'Use .flowbaby/venv (Recommended)',
                'Use existing .venv (Advanced)'
            );
            
            if (!choice) {
                // User cancelled
                debugLog('User cancelled environment setup due to venv conflict');
                return false;
            }
            
            if (choice === 'Use existing .venv (Advanced)') {
                // User chose to use existing .venv - warn about conflicts
                debugLog('User chose to use existing .venv (advanced option)');
                
                const confirmConflict = await vscode.window.showWarningMessage(
                    'Using your existing .venv may cause version conflicts with your project. Flowbaby will install cognee and its dependencies into this environment.',
                    { modal: true },
                    'Proceed',
                    'Cancel'
                );
                
                if (confirmConflict !== 'Proceed') {
                    return false;
                }
                
                // Install into existing .venv using legacy path
                return this.installIntoExistingVenv();
            }
            // Otherwise, continue with .flowbaby/venv (recommended)
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
        
        // Scenario 2: .flowbaby exists but bridge-env.json is missing → FRESH
        // Plan 040 M3: This is the expected state for new workspaces where only
        // .flowbaby/logs has been created. Treat as FRESH, not BROKEN.
        const bridgeEnv = await this.readBridgeEnv();
        if (!bridgeEnv) {
            debugLog('Workspace health check: FRESH (bridge-env.json missing - new workspace)');
            return 'FRESH';
        }
        
        // Scenario 3: Check for migration marker indicating unresolved migration
        // This IS a broken state since it indicates an interrupted migration
        const migrationMarkerPath = path.join(flowbabyDir, '.migration-in-progress');
        if (this.fs.existsSync(migrationMarkerPath)) {
            debugLog('Workspace health check: BROKEN (migration marker exists)');
            return 'BROKEN';
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
                    await fs.promises.rename(actualVenvPath, actualBackupPath);
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
                    await fs.promises.rename(actualBackupPath, actualVenvPath);
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
