import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import { BackgroundOperationManager } from '../background/BackgroundOperationManager';
import { RecallFlowStatusBar, RecallFlowStatus } from '../statusBar/RecallFlowStatusBar';

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
    cogneeVersion: string;
    requirementsHash: string;
    lastVerifiedAt: string;
}

interface EnvVerificationResult {
    status: 'ok' | 'error';
    details: Record<string, boolean>;
    missing?: string[];
    python_version?: string;
    cognee_version?: string;
    bridge_version?: string;
}

export class RecallFlowSetupService {
    private readonly workspacePath: string;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly bridgePath: string;
    private readonly fs: { existsSync: (path: string) => boolean };
    private readonly spawnFn: typeof spawn;
    private readonly statusBar?: RecallFlowStatusBar;

    private _isVerified: boolean = false;

    get isVerified(): boolean {
        return this._isVerified;
    }

    private async setVerified(value: boolean) {
        this._isVerified = value;
        await vscode.commands.executeCommand('setContext', 'cogneeMemory.environmentVerified', value);
        
        if (this.statusBar) {
            if (value) {
                this.statusBar.setStatus(RecallFlowStatus.Ready);
            } else {
                this.statusBar.setStatus(RecallFlowStatus.SetupRequired);
            }
        }
    }

    constructor(
        context: vscode.ExtensionContext, 
        workspacePath: string, 
        outputChannel: vscode.OutputChannel,
        fileSystem?: { existsSync: (path: string) => boolean },
        spawnFunction?: typeof spawn,
        statusBar?: RecallFlowStatusBar
    ) {
        this.workspacePath = workspacePath;
        this.outputChannel = outputChannel;
        this.bridgePath = path.join(context.extensionPath, 'bridge');
        this.fs = fileSystem || fs;
        this.spawnFn = spawnFunction || spawn;
        this.statusBar = statusBar;
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
                        vscode.window.showWarningMessage(
                            'RecallFlow dependencies are outdated.',
                            'Refresh Dependencies'
                        ).then(selection => {
                            if (selection === 'Refresh Dependencies') {
                                this.refreshDependencies();
                            }
                        });
                        // Mark verified but warn
                        await this.setVerified(true);
                    } else {
                        await this.setVerified(true);
                    }
                } else {
                    await this.setVerified(false);
                    vscode.window.showErrorMessage(
                        'RecallFlow environment is unhealthy.',
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
                await this.setVerified(verified);
                if (!verified) {
                    vscode.window.showWarningMessage('External Python environment is missing dependencies.');
                }
            }
            return;
        }

        // No bridge-env.json
        const config = vscode.workspace.getConfiguration('cogneeMemory');
        const defaultPython = this.getSystemPythonCommand();
        const pythonPath = config.get<string>('pythonPath', defaultPython);
        
        if (pythonPath !== defaultPython && pythonPath !== '') {
            // Explicit path set
            const adopt = await vscode.window.showInformationMessage(
                'RecallFlow found a configured Python path. Use this environment?',
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
                await this.verifyEnvironment(); // Will set verified
            } else if (adopt === 'Create Managed Environment') {
                await this.createEnvironment();
            }
        } else {
            // No config, no metadata -> Prompt setup
            const create = await vscode.window.showInformationMessage(
                'RecallFlow requires a Python environment.',
                'Initialize Workspace'
            );
            
            if (create === 'Initialize Workspace') {
                await this.createEnvironment();
            }
        }
    }

    /**
     * Create .venv and install dependencies
     */
    async createEnvironment(): Promise<boolean> {
        if (this.statusBar) this.statusBar.setStatus(RecallFlowStatus.Refreshing, 'Creating environment...');
        
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Setting up RecallFlow Environment...",
            cancellable: false
        }, async (progress) => {
            const venvPath = path.join(this.workspacePath, '.venv');
            
            try {
                // 1. Check Python Version
                progress.report({ message: "Checking Python version..." });
                const pythonCommand = this.getSystemPythonCommand();
                const isVersionValid = await this.checkPythonVersion(pythonCommand);
                
                if (!isVersionValid) {
                    throw new Error('PYTHON_VERSION_UNSUPPORTED: Python 3.8+ is required.');
                }

                // 2. Create venv
                progress.report({ message: "Creating virtual environment..." });
                this.log('Creating virtual environment...');
                await this.runCommand(pythonCommand, ['-m', 'venv', '.venv'], this.workspacePath);

                // 3. Install dependencies
                progress.report({ message: "Installing dependencies (this may take 1-2 minutes)..." });
                await this.installDependencies();

                // 4. Verify installation
                progress.report({ message: "Verifying installation..." });
                const verified = await this.verifyEnvironment();
                if (!verified) {
                    throw new Error('VERIFICATION_FAILED: Environment verification script failed.');
                }

                // 5. Write Metadata
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

                vscode.window.showInformationMessage('RecallFlow environment setup complete!');
                return true;
            } catch (error: any) {
                this.log('Setup failed: ' + error);
                
                // Rollback
                if (this.fs.existsSync(venvPath)) {
                    this.log('Rolling back partial environment...');
                    await fs.promises.rm(venvPath, { recursive: true, force: true });
                }

                let userMessage = 'Setup failed.';
                if (error.message && error.message.includes('PYTHON_VERSION_UNSUPPORTED')) {
                    userMessage = 'Python 3.8+ is required. Please install it and try again.';
                } else if (error.message && error.message.includes('VERIFICATION_FAILED')) {
                    userMessage = 'Environment verification failed. Check logs.';
                } else {
                    userMessage = 'Setup failed. Check output for details.';
                }

                vscode.window.showErrorMessage(userMessage);
                if (this.statusBar) this.statusBar.setStatus(RecallFlowStatus.Error, userMessage);
                return false;
            }
        });
    }

    /**
     * Install dependencies from requirements.txt
     */
    async installDependencies(): Promise<void> {
        const requirementsPath = path.join(this.bridgePath, 'requirements.txt');
        const pipPath = this.getPipPath();
        
        this.log(`Installing dependencies from ${requirementsPath}...`);
        try {
            await this.runCommand(pipPath, ['install', '-r', requirementsPath], this.workspacePath);
            this.log('Dependencies installed successfully.');
        } catch (e) {
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
                const extension = vscode.extensions.getExtension('recallflow.cognee-chat-memory');
                const extensionVersion = extension ? extension.packageJSON.version : '0.0.0';

                await this.writeBridgeVersion({
                    bridgeVersion: result.bridge_version || '0.0.0',
                    extensionVersion: extensionVersion,
                    cogneeVersion: result.cognee_version || '0.0.0',
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

        const bgManager = BackgroundOperationManager.getInstance();
        
        // 1. Pause Background Ops
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

        if (this.statusBar) this.statusBar.setStatus(RecallFlowStatus.Refreshing, 'Refreshing dependencies...');

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Refreshing RecallFlow Dependencies...",
            cancellable: false
        }, async (progress) => {
            const venvPath = path.join(this.workspacePath, '.venv');
            const backupPath = path.join(this.workspacePath, '.venv.backup');

            try {
                progress.report({ message: "Quiescing background operations..." });
                
                // 2. Backup .venv
                if (this.fs.existsSync(venvPath)) {
                    progress.report({ message: "Backing up environment..." });
                    if (this.fs.existsSync(backupPath)) {
                        await fs.promises.rm(backupPath, { recursive: true, force: true });
                    }
                    await fs.promises.rename(venvPath, backupPath);
                }

                // 3. Recreate and Install
                progress.report({ message: "Recreating environment..." });
                const pythonCommand = this.getSystemPythonCommand();
                await this.runCommand(pythonCommand, ['-m', 'venv', '.venv'], this.workspacePath);
                
                progress.report({ message: "Installing dependencies..." });
                await this.installDependencies();

                // 4. Verify
                progress.report({ message: "Verifying..." });
                const verified = await this.verifyEnvironment();
                
                if (verified) {
                    // Success
                    if (this.fs.existsSync(backupPath)) {
                        await fs.promises.rm(backupPath, { recursive: true, force: true });
                    }
                    await this.setVerified(true);
                    vscode.window.showInformationMessage('Dependencies refreshed successfully.');
                } else {
                    throw new Error('VERIFICATION_FAILED');
                }

            } catch (error: any) {
                this.log(`Refresh failed: ${error}`);
                
                // Restore backup
                if (this.fs.existsSync(backupPath)) {
                    this.log('Restoring backup...');
                    if (this.fs.existsSync(venvPath)) {
                        await fs.promises.rm(venvPath, { recursive: true, force: true });
                    }
                    await fs.promises.rename(backupPath, venvPath);
                }
                
                let msg = 'Refresh failed.';
                if (error.message && error.message.includes('PIP_INSTALL_FAILED')) {
                    msg = 'Failed to install dependencies.';
                } else if (error.message && error.message.includes('VERIFICATION_FAILED')) {
                    msg = 'Verification failed after refresh.';
                }
                
                vscode.window.showErrorMessage(msg + ' Previous environment restored.');
                if (this.statusBar) this.statusBar.setStatus(RecallFlowStatus.Error, msg);
            } finally {
                bgManager.resume();
            }
        });
    }

    private getSystemPythonCommand(): string {
        return process.platform === 'win32' ? 'python' : 'python3';
    }

    private getPythonPath(): string {
        const isWindows = process.platform === 'win32';
        return isWindows
            ? path.join(this.workspacePath, '.venv', 'Scripts', 'python.exe')
            : path.join(this.workspacePath, '.venv', 'bin', 'python');
    }

    private getPipPath(): string {
        const isWindows = process.platform === 'win32';
        return isWindows
            ? path.join(this.workspacePath, '.venv', 'Scripts', 'pip.exe')
            : path.join(this.workspacePath, '.venv', 'bin', 'pip');
    }

    private runCommand(command: string, args: string[], cwd: string, captureOutput: boolean = false): Promise<string> {
        return new Promise((resolve, reject) => {
            const proc = this.spawnFn(command, args, { cwd, shell: true }); // shell: true for path resolution
            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
                if (!captureOutput) this.outputChannel.append(data.toString());
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
                if (!captureOutput) this.outputChannel.append(data.toString());
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(`Command failed with code ${code}: ${stderr}`));
                }
            });
            
            proc.on('error', (err) => {
                reject(err);
            });
        });
    }

    private getMetadataPath(filename: string): string {
        return path.join(this.workspacePath, '.cognee', filename);
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
        if (!this.fs.existsSync(filePath)) return null;
        try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            return JSON.parse(content) as BridgeEnvMetadata;
        } catch (e) {
            this.log(`Failed to read bridge-env.json: ${e}`);
            return null;
        }
    }

    async writeBridgeEnv(metadata: BridgeEnvMetadata): Promise<void> {
        const dir = path.join(this.workspacePath, '.cognee');
        if (!this.fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
        const filePath = this.getMetadataPath('bridge-env.json');
        await fs.promises.writeFile(filePath, JSON.stringify(metadata, null, 2));
    }

    async readBridgeVersion(): Promise<BridgeVersionMetadata | null> {
        const filePath = this.getMetadataPath('bridge-version.json');
        if (!this.fs.existsSync(filePath)) return null;
        try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            return JSON.parse(content) as BridgeVersionMetadata;
        } catch (e) {
            this.log(`Failed to read bridge-version.json: ${e}`);
            return null;
        }
    }

    async writeBridgeVersion(metadata: BridgeVersionMetadata): Promise<void> {
        const dir = path.join(this.workspacePath, '.cognee');
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
                if (major > 3 || (major === 3 && minor >= 8)) {
                    return true;
                }
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    private log(message: string) {
        this.outputChannel.appendLine(`[Setup] ${message}`);
    }
}
