import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

interface EnvVerificationResult {
    status: 'ok' | 'error';
    details: Record<string, boolean>;
    missing?: string[];
    python_version?: string;
}

export class RecallFlowSetupService {
    private readonly workspacePath: string;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly bridgePath: string;
    private readonly fs: { existsSync: (path: string) => boolean };
    private readonly spawnFn: typeof spawn;

    constructor(
        context: vscode.ExtensionContext, 
        workspacePath: string, 
        outputChannel: vscode.OutputChannel,
        fileSystem?: { existsSync: (path: string) => boolean },
        spawnFunction?: typeof spawn
    ) {
        this.workspacePath = workspacePath;
        this.outputChannel = outputChannel;
        this.bridgePath = path.join(context.extensionPath, 'bridge');
        this.fs = fileSystem || fs;
        this.spawnFn = spawnFunction || spawn;
    }

    /**
     * Initialize workspace environment (Milestone 4)
     * Checks for .venv, offers to create if missing.
     */
    async initializeWorkspace(): Promise<void> {
        const config = vscode.workspace.getConfiguration('cogneeMemory');
        const defaultPython = this.getSystemPythonCommand();
        const pythonPath = config.get<string>('pythonPath', defaultPython);
        
        // If user has explicit custom path, assume they manage it
        if (pythonPath !== defaultPython && pythonPath !== '') {
            this.log('Using configured Python path: ' + pythonPath);
            return;
        }

        const venvPath = path.join(this.workspacePath, '.venv');
        const hasVenv = this.fs.existsSync(venvPath);

        if (!hasVenv) {
            // Managed Mode: Offer to create
            const create = await vscode.window.showInformationMessage(
                'RecallFlow requires a Python environment. Create a managed .venv?',
                'Create Environment',
                'I\'ll Manage It'
            );

            if (create === 'Create Environment') {
                await this.createEnvironment();
            }
        } else {
            // External Mode: Check if it's valid
            this.log('Found existing .venv, verifying...');
            const valid = await this.verifyEnvironment();
            if (!valid) {
                const fix = await vscode.window.showWarningMessage(
                    'RecallFlow .venv is missing dependencies.',
                    'Repair Environment',
                    'Ignore'
                );
                if (fix === 'Repair Environment') {
                    await this.installDependencies();
                }
            }
        }
    }

    /**
     * Create .venv and install dependencies
     */
    async createEnvironment(): Promise<boolean> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Setting up RecallFlow Environment...",
            cancellable: false
        }, async (progress) => {
            try {
                // 1. Create venv
                progress.report({ message: "Creating .venv..." });
                this.log('Creating virtual environment...');
                const pythonCommand = this.getSystemPythonCommand();
                await this.runCommand(pythonCommand, ['-m', 'venv', '.venv'], this.workspacePath);

                // 2. Install dependencies
                progress.report({ message: "Installing dependencies (this may take a minute)..." });
                await this.installDependencies();

                vscode.window.showInformationMessage('RecallFlow environment setup complete!');
                return true;
            } catch (error) {
                this.log('Setup failed: ' + error);
                vscode.window.showErrorMessage('Setup failed. Check output for details.');
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
        await this.runCommand(pipPath, ['install', '-r', requirementsPath], this.workspacePath);
        this.log('Dependencies installed successfully.');
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
            return result.status === 'ok';
        } catch (error) {
            this.log('Verification failed: ' + error);
            return false;
        }
    }

    /**
     * Refresh dependencies command handler
     */
    async refreshDependencies(): Promise<void> {
        // Coordination with BackgroundOperationManager handled in extension.ts or here if we import it
        // For now, we'll just run the install logic
        
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Refreshing RecallFlow Dependencies...",
            cancellable: false
        }, async () => {
            try {
                await this.installDependencies();
                const valid = await this.verifyEnvironment();
                if (valid) {
                    vscode.window.showInformationMessage('Dependencies refreshed successfully.');
                } else {
                    vscode.window.showErrorMessage('Refresh completed but verification failed.');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Refresh failed: ${error}`);
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

    private log(message: string) {
        this.outputChannel.appendLine(`[Setup] ${message}`);
    }
}
