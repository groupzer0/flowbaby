import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

/**
 * Result structure from Python bridge scripts
 */
interface CogneeResult {
    success: boolean;
    error?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any; // Additional fields from Python scripts
}

/**
 * Log level enumeration
 */
enum LogLevel {
    Error = 0,
    Warn = 1,
    Info = 2,
    Debug = 3
}

/**
 * CogneeClient - TypeScript client for spawning Python bridge scripts
 * 
 * Provides high-level API for Cognee operations (init, ingest, retrieve)
 * via subprocess communication with JSON over stdout.
 */
export class CogneeClient {
    private readonly workspacePath: string;
    private readonly pythonPath: string;
    private readonly bridgePath: string;
    private readonly maxContextResults: number;
    private readonly maxContextTokens: number;
    private readonly recencyWeight: number;
    private readonly importanceWeight: number;
    private readonly logLevel: LogLevel;
    private readonly outputChannel: vscode.OutputChannel;

    /**
     * Constructor - Load configuration and initialize output channel
     * 
     * @param workspacePath Absolute path to workspace root
     */
    constructor(workspacePath: string) {
        this.workspacePath = workspacePath;

        // Load configuration from VS Code settings
        const config = vscode.workspace.getConfiguration('cogneeMemory');
        this.pythonPath = config.get<string>('pythonPath', 'python3');
        this.maxContextResults = config.get<number>('maxContextResults', 3);
        this.maxContextTokens = config.get<number>('maxContextTokens', 2000);
        this.recencyWeight = config.get<number>('recencyWeight', 0.3);
        this.importanceWeight = config.get<number>('importanceWeight', 0.2);

        // Map log level string to enum
        const logLevelStr = config.get<string>('logLevel', 'info');
        this.logLevel = this.parseLogLevel(logLevelStr);

        // Create Output Channel for logging
        this.outputChannel = vscode.window.createOutputChannel('Cognee Memory');

        // Resolve bridge path (extension/bridge relative to dist/)
        this.bridgePath = path.join(__dirname, '..', 'bridge');

        this.log('INFO', 'CogneeClient initialized', {
            workspace: workspacePath,
            pythonPath: this.pythonPath,
            maxContextResults: this.maxContextResults,
            maxContextTokens: this.maxContextTokens,
            bridgePath: this.bridgePath
        });
    }

    /**
     * Initialize Cognee for workspace
     * 
     * Calls init.py to configure Cognee with API key from workspace .env
     * 
     * @returns Promise<boolean> - true if initialized, false on error
     */
    async initialize(): Promise<boolean> {
        const startTime = Date.now();
        this.log('INFO', 'Initializing Cognee', { workspace: this.workspacePath });

        try {
            const result = await this.runPythonScript('init.py', [this.workspacePath]);
            const duration = Date.now() - startTime;

            if (result.success) {
                this.log('INFO', 'Cognee initialized successfully', {
                    duration,
                    cognee_dir: result.cognee_dir
                });
                return true;
            } else {
                this.log('ERROR', 'Cognee initialization failed', {
                    duration,
                    error: result.error
                });
                vscode.window.showWarningMessage(
                    `Cognee initialization failed: ${result.error}`
                );
                return false;
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log('ERROR', 'Cognee initialization exception', {
                duration,
                error: errorMessage
            });
            vscode.window.showWarningMessage(
                `Cognee initialization error: ${errorMessage}`
            );
            return false;
        }
    }

    /**
     * Ingest conversation into Cognee
     * 
     * Calls ingest.py to store user/assistant conversation with metadata
     * 
     * @param userMessage User's question or prompt
     * @param assistantMessage Assistant's response
     * @param importance Importance score 0-1 (default 0.0)
     * @returns Promise<boolean> - true if ingested, false on error
     */
    async ingest(
        userMessage: string,
        assistantMessage: string,
        importance: number = 0.0
    ): Promise<boolean> {
        const startTime = Date.now();
        
        this.log('DEBUG', 'Ingesting conversation', {
            user_length: userMessage.length,
            assistant_length: assistantMessage.length,
            importance
        });

        try {
            const result = await this.runPythonScript('ingest.py', [
                this.workspacePath,
                userMessage,
                assistantMessage,
                importance.toString()
            ]);

            const duration = Date.now() - startTime;

            if (result.success) {
                this.log('INFO', 'Conversation ingested', {
                    chars: result.ingested_chars,
                    timestamp: result.timestamp,
                    duration
                });
                return true;
            } else {
                this.log('ERROR', 'Ingestion failed', {
                    duration,
                    error: result.error
                });
                return false;
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log('ERROR', 'Ingestion exception', {
                duration,
                error: errorMessage
            });
            return false;
        }
    }

    /**
     * Retrieve context from Cognee
     * 
     * Calls retrieve.py to search for relevant context with hybrid graph-vector search
     * 
     * @param query User's search query
     * @returns Promise<string[]> - Array of context texts (empty on error)
     */
    async retrieve(query: string): Promise<string[]> {
        const startTime = Date.now();

        this.log('DEBUG', 'Retrieving context', {
            query_length: query.length,
            query_preview: query.substring(0, 50),
            max_results: this.maxContextResults,
            max_tokens: this.maxContextTokens,
            recency_weight: this.recencyWeight,
            importance_weight: this.importanceWeight
        });

        try {
            const result = await this.runPythonScript('retrieve.py', [
                this.workspacePath,
                query,
                this.maxContextResults.toString(),
                this.maxContextTokens.toString(),
                this.recencyWeight.toString(),
                this.importanceWeight.toString()
            ]);

            const duration = Date.now() - startTime;

            if (result.success) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const contexts = result.results?.map((r: any) => r.text) || [];
                
                this.log('INFO', 'Context retrieved', {
                    result_count: result.result_count || 0,
                    total_tokens: result.total_tokens || 0,
                    duration
                });

                // Log warnings for latency
                if (duration > 1000) {
                    this.log('WARN', 'Retrieval latency exceeded target', {
                        duration,
                        target: 1000,
                        query_preview: query.substring(0, 50)
                    });
                } else if (duration > 500) {
                    this.log('INFO', 'Retrieval latency above stretch goal', {
                        duration,
                        stretch_goal: 500
                    });
                }

                return contexts;
            } else {
                this.log('ERROR', 'Retrieval failed', {
                    duration,
                    error: result.error
                });
                return [];
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log('ERROR', 'Retrieval exception', {
                duration,
                error: errorMessage
            });
            return [];
        }
    }

    /**
     * Check if memory is enabled
     * 
     * @returns boolean - true if enabled in configuration
     */
    isEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('cogneeMemory');
        return config.get<boolean>('enabled', true);
    }

    /**
     * Validate configuration
     * 
     * Checks if Python path exists and workspace has .env with API key
     * 
     * @returns Promise<{valid: boolean, errors: string[]}>
     */
    async validateConfiguration(): Promise<{ valid: boolean; errors: string[] }> {
        const errors: string[] = [];

        // Check if workspace .env exists
        const envPath = path.join(this.workspacePath, '.env');
        try {
            if (!fs.existsSync(envPath)) {
                errors.push('.env file not found in workspace');
            }
        } catch (error) {
            errors.push(`Error checking .env file: ${error}`);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Log message to Output Channel
     * 
     * @param level Log level (ERROR, WARN, INFO, DEBUG)
     * @param message Log message
     * @param data Optional structured data
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private log(level: string, message: string, data?: any): void {
        const logLevelValue = this.parseLogLevel(level);
        
        // Only log if message level <= configured log level
        if (logLevelValue > this.logLevel) {
            return;
        }

        const timestamp = new Date().toISOString();
        const dataStr = data ? ` ${JSON.stringify(data)}` : '';
        const logLine = `[${timestamp}] [${level}] ${message}${dataStr}`;
        
        this.outputChannel.appendLine(logLine);
    }

    /**
     * Run Python bridge script
     * 
     * Spawns Python subprocess, collects output, parses JSON response
     * 
     * @param scriptName Script filename (e.g., 'init.py')
     * @param args Command-line arguments
     * @returns Promise<CogneeResult> - Parsed JSON result
     */
    private async runPythonScript(
        scriptName: string,
        args: string[]
    ): Promise<CogneeResult> {
        const scriptPath = path.join(this.bridgePath, scriptName);
        const sanitizedArgs = args.map((arg, i) => 
            i === 0 ? arg : `<arg${i}>`  // Sanitize args (hide sensitive data)
        );

        this.log('DEBUG', 'Running Python script', {
            script: scriptName,
            args: sanitizedArgs
        });

        return new Promise((resolve, reject) => {
            const python = spawn(this.pythonPath, [scriptPath, ...args]);
            
            let stdout = '';
            let stderr = '';

            // Collect stdout
            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            // Collect stderr
            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            // Handle process close
            python.on('close', (code) => {
                this.log('DEBUG', 'Python script completed', {
                    script: scriptName,
                    exit_code: code
                });

                if (code !== 0) {
                    this.log('ERROR', 'Python script failed', {
                        script: scriptName,
                        exit_code: code,
                        stderr: stderr.substring(0, 500)
                    });
                    reject(new Error(`Python script exited with code ${code}: ${stderr}`));
                    return;
                }

                // Parse JSON output
                try {
                    const result = JSON.parse(stdout) as CogneeResult;
                    resolve(result);
                } catch (error) {
                    this.log('ERROR', 'JSON parse failed', {
                        script: scriptName,
                        stdout: stdout.substring(0, 200),
                        error: error instanceof Error ? error.message : String(error)
                    });
                    reject(new Error(`Failed to parse JSON output: ${error}`));
                }
            });

            // Handle spawn errors
            python.on('error', (error) => {
                this.log('ERROR', 'Python spawn error', {
                    script: scriptName,
                    error: error.message
                });
                reject(new Error(`Failed to spawn Python: ${error.message}`));
            });

            // Set 10-second timeout
            const timeout = setTimeout(() => {
                python.kill();
                this.log('ERROR', 'Python script timeout', {
                    script: scriptName,
                    timeout: 10000
                });
                reject(new Error(`Python script timeout after 10 seconds`));
            }, 10000);

            // Clear timeout on close
            python.on('close', () => {
                clearTimeout(timeout);
            });
        });
    }

    /**
     * Parse log level string to enum
     * 
     * @param level Log level string
     * @returns LogLevel enum value
     */
    private parseLogLevel(level: string): LogLevel {
        switch (level.toLowerCase()) {
            case 'error': return LogLevel.Error;
            case 'warn': return LogLevel.Warn;
            case 'info': return LogLevel.Info;
            case 'debug': return LogLevel.Debug;
            default: return LogLevel.Info;
        }
    }
}
