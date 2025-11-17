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

        // Detect Python interpreter using auto-detection or explicit config
        this.pythonPath = this.detectPythonInterpreter();

        // Log detected interpreter with source attribution
        const configuredPath = config.get<string>('pythonPath', 'python3');
        const detectionSource = (configuredPath !== 'python3' && configuredPath !== '') 
            ? 'explicit_config' 
            : 'auto_detected';

        this.log('INFO', 'CogneeClient initialized', {
            workspace: workspacePath,
            pythonPath: this.pythonPath,
            pythonSource: detectionSource,
            maxContextResults: this.maxContextResults,
            maxContextTokens: this.maxContextTokens,
            bridgePath: this.bridgePath
        });
    }

    /**
     * Detect Python interpreter with auto-detection fallback chain
     * 
     * Priority order:
     * 1. Explicit cogneeMemory.pythonPath setting (if not default)
     * 2. Workspace .venv virtual environment (platform-specific paths)
     * 3. System python3 fallback
     * 
     * @returns string - Path to Python interpreter
     */
    private detectPythonInterpreter(): string {
        const config = vscode.workspace.getConfiguration('cogneeMemory');
        const configuredPath = config.get<string>('pythonPath', 'python3');

        // Explicit config always wins (user override is sacred)
        if (configuredPath !== 'python3' && configuredPath !== '') {
            return configuredPath;
        }

        // Auto-detect workspace .venv (platform-specific)
        const isWindows = process.platform === 'win32';
        const venvPath = isWindows
            ? path.join(this.workspacePath, '.venv', 'Scripts', 'python.exe')
            : path.join(this.workspacePath, '.venv', 'bin', 'python');

        try {
            if (fs.existsSync(venvPath)) {
                return venvPath;
            }
        } catch (error) {
            // Permission error, missing directory, etc. - fall through to system Python
            this.log('DEBUG', 'Virtual environment detection failed', {
                venvPath,
                error: error instanceof Error ? error.message : String(error)
            });
        }

        // Fall back to system Python
        return 'python3';
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
                // Standardized initialization line (required format)
                const migrationStatus = result.migration_performed ? 'performed' : 'skipped';
                this.log('INFO', `Initialized workspace [${result.dataset_name}] (migration: ${migrationStatus})`);
                
                // Supplemental detail lines for diagnostics
                this.log('INFO', 'Workspace isolation details', {
                    duration,
                    dataset_name: result.dataset_name,
                    workspace_path: result.workspace_path,
                    cognee_dir: result.cognee_dir
                });
                
                this.log('INFO', 'Ontology configuration', {
                    ontology_loaded: result.ontology_loaded ?? false,
                    ontology_entities: result.ontology_entities ?? 0,
                    ontology_relationships: result.ontology_relationships ?? 0
                });
                
                // Log migration metadata if available
                if (result.migration_performed) {
                    const sizeBefore = result.data_dir_size_before ?? 0;
                    const sizeAfter = result.data_dir_size_after ?? 0;
                    const sizeDelta = sizeBefore - sizeAfter;
                    const sizeMB = (sizeBefore / 1024 / 1024).toFixed(2);
                    
                    // Use WARN level if data directory was > 100MB
                    const logLevel = sizeBefore > 100 * 1024 * 1024 ? 'WARN' : 'INFO';
                    
                    this.log(logLevel, 'Migration performed by this workspace', {
                        global_marker_location: result.global_marker_location,
                        data_dir_size_before_mb: sizeMB,
                        data_dir_size_after_mb: (sizeAfter / 1024 / 1024).toFixed(2),
                        data_removed_mb: (sizeDelta / 1024 / 1024).toFixed(2),
                        note: 'Untagged legacy data pruned from global Cognee directory'
                    });
                } else if (result.global_marker_location) {
                    this.log('INFO', 'Migration previously completed', {
                        global_marker_location: result.global_marker_location
                    });
                }

                // Verify ontology loaded correctly
                if (result.ontology_loaded !== true) {
                    this.log('WARN', 'Ontology loading not confirmed', {
                        message: 'May be using default or global ontology'
                    });
                }

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
            // Use 120-second timeout for ingestion (Cognee setup + LLM processing can take time)
            // Increased from 30s to reduce false-positive timeout errors when ingestion succeeds but takes >30s
            const result = await this.runPythonScript('ingest.py', [
                this.workspacePath,
                userMessage,
                assistantMessage,
                importance.toString()
            ], 120000);

            const duration = Date.now() - startTime;

            if (result.success) {
                this.log('INFO', 'Conversation ingested', {
                    chars: result.ingested_chars,
                    timestamp: result.timestamp,
                    duration_ms: duration,
                    ingestion_duration_sec: result.ingestion_duration_sec
                });
                
                // Log step-level metrics if available
                if (result.ingestion_metrics) {
                    this.log('DEBUG', 'Ingestion metrics', {
                        metrics: result.ingestion_metrics
                    });
                }
                
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
            
            // Milestone 2: Distinguish timeout vs true failure
            const isTimeout = /Python script timeout after/i.test(errorMessage);
            
            if (isTimeout) {
                this.log('ERROR', 'Ingestion timeout', {
                    duration_ms: duration,
                    error_type: 'timeout',
                    error: errorMessage,
                    note: 'Ingestion may still complete in background - check @cognee-memory retrieval'
                });
                
                // User-facing message clarifying background processing
                vscode.window.showWarningMessage(
                    'Cognee is still working on ingestion in the background. ' +
                    'The extension timed out waiting for a response after 120 seconds. ' +
                    'Your data may still be ingested; you can check by querying @cognee-memory in a moment.'
                );
            } else {
                this.log('ERROR', 'Ingestion exception', {
                    duration_ms: duration,
                    error_type: 'failure',
                    error: errorMessage
                });
            }
            
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
            query_preview: query.length > 200 ? query.substring(0, 200) + `... (${query.length} chars total)` : query,
            max_results: this.maxContextResults,
            max_tokens: this.maxContextTokens,
            recency_weight: this.recencyWeight,
            importance_weight: this.importanceWeight
        });

        try {
            // Use 15-second timeout for retrieval (semantic search can be slow)
            const result = await this.runPythonScript('retrieve.py', [
                this.workspacePath,
                query,
                this.maxContextResults.toString(),
                this.maxContextTokens.toString(),
                this.recencyWeight.toString(),
                this.importanceWeight.toString()
            ], 15000);

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
                        query_preview: query.length > 200 ? query.substring(0, 200) + `... (${query.length} chars total)` : query
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
     * Spawns Python subprocess from workspace context, collects stdout/stderr, parses JSON response.
     * Enhanced error surfacing captures structured errors from stdout and sanitizes sensitive data.
     * 
     * @param scriptName Script filename (e.g., 'init.py')
     * @param args Command-line arguments
     * @param timeoutMs Timeout in milliseconds (default: 10000ms, use 30000ms for ingestion)
     * @returns Promise<CogneeResult> - Parsed JSON result
     */
    private async runPythonScript(
        scriptName: string,
        args: string[],
        timeoutMs: number = 10000
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
            // Milestone 5: Track process timing to distinguish timeout vs exit timing
            let timedOut = false;
            const requestStart = Date.now();
            let timeoutFiredAt: number | null = null;
            
            // Spawn Python process with workspace as working directory
            // This ensures relative paths in scripts resolve from workspace root
            const python = spawn(this.pythonPath, [scriptPath, ...args], {
                cwd: this.workspacePath
            });
            
            let stdout = '';
            let stderr = '';

            // Collect stdout (with buffer limit to prevent memory bloat)
            python.stdout.on('data', (data) => {
                stdout += data.toString();
                // Truncate if exceeding 2KB during collection (streaming truncation)
                if (stdout.length > 2048) {
                    stdout = stdout.substring(0, 2048);
                }
            });

            // Collect stderr (with buffer limit)
            python.stderr.on('data', (data) => {
                stderr += data.toString();
                if (stderr.length > 2048) {
                    stderr = stderr.substring(0, 2048);
                }
            });

            // Handle process close
            python.on('close', (code) => {
                const closeTime = Date.now();
                
                this.log('DEBUG', 'Python script completed', {
                    script: scriptName,
                    exit_code: code,
                    close_duration_ms: closeTime - requestStart,
                    timed_out: timedOut,
                    timeout_fired_ms: timeoutFiredAt ? timeoutFiredAt - requestStart : null
                });
                
                // If we already timed out, process completed after promise rejection
                if (timedOut) {
                    return;
                }

                if (code !== 0) {
                    // Enhanced error surfacing: capture and parse both stdout and stderr
                    let errorMessage = `Python script exited with code ${code}`;
                    let structuredError: string | undefined;

                    // Try to parse stdout as JSON to extract structured error
                    try {
                        const result = JSON.parse(stdout) as CogneeResult;
                        if (result.error) {
                            structuredError = result.error;
                            errorMessage = structuredError;
                        }
                    } catch {
                        // stdout is not valid JSON - will log as unstructured error
                    }

                    // Sanitize outputs before logging
                    const sanitizedStdout = this.sanitizeOutput(stdout);
                    const sanitizedStderr = this.sanitizeOutput(stderr);

                    // Log comprehensive error details
                    this.log('ERROR', 'Python script failed', {
                        script: scriptName,
                        exit_code: code,
                        structured_error: structuredError,
                        stderr: sanitizedStderr,
                        stdout_preview: sanitizedStdout
                    });

                    // User-facing error with troubleshooting hint
                    const troubleshootingHint = structuredError 
                        ? '' 
                        : ' Check Output Channel for details. If using virtual environment, configure cogneeMemory.pythonPath setting.';
                    
                    reject(new Error(`${errorMessage}${troubleshootingHint}`));
                    return;
                }

                // Log stderr even on success (for debug output)
                if (stderr && stderr.trim()) {
                    const sanitizedStderr = this.sanitizeOutput(stderr);
                    this.log('DEBUG', 'Python script stderr output', {
                        script: scriptName,
                        stderr: sanitizedStderr
                    });
                }

                // Parse JSON output (success path)
                try {
                    const result = JSON.parse(stdout) as CogneeResult;
                    resolve(result);
                } catch (error) {
                    // Sanitize before logging parse failure
                    const sanitizedStdout = this.sanitizeOutput(stdout);
                    
                    this.log('ERROR', 'JSON parse failed', {
                        script: scriptName,
                        stdout_preview: sanitizedStdout,
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

            // Set timeout (configurable per operation)
            const timeout = setTimeout(() => {
                timedOut = true;
                timeoutFiredAt = Date.now();
                
                python.kill();
                
                this.log('ERROR', 'Python script timeout', {
                    script: scriptName,
                    timeout: timeoutMs,
                    elapsed_ms: timeoutFiredAt - requestStart
                });
                
                reject(new Error(`Python script timeout after ${timeoutMs/1000} seconds`));
            }, timeoutMs);

            // Clear timeout on close (only if not already timed out)
            python.on('close', () => {
                if (!timedOut) {
                    clearTimeout(timeout);
                }
            });
        });
    }

    /**
     * Sanitize output to redact sensitive data before logging
     * 
     * Redacts common secret patterns and truncates to prevent accidental exposure.
     * 
     * @param text Output text to sanitize
     * @returns string - Sanitized text
     */
    private sanitizeOutput(text: string): string {
        let sanitized = text;

        // Redact LLM API keys (environment variable format - current)
        sanitized = sanitized.replace(
            /LLM_API_KEY[\s=]+[\w\-]{32,}/gi,
            'LLM_API_KEY=***'
        );

        // Redact OpenAI API keys (environment variable format - legacy, for backwards compatibility)
        sanitized = sanitized.replace(
            /OPENAI_API_KEY[\s=]+[\w\-]{32,}/gi,
            'OPENAI_API_KEY=***'
        );

        // Redact OpenAI-style keys (sk-... format)
        sanitized = sanitized.replace(
            /sk-[A-Za-z0-9]{32,}/g,
            'sk-***'
        );

        // Redact Bearer tokens
        sanitized = sanitized.replace(
            /Bearer\s+[A-Za-z0-9\-_]{32,}/g,
            'Bearer ***'
        );

        // Redact AWS secret access keys
        sanitized = sanitized.replace(
            /AWS_SECRET_ACCESS_KEY[\s=]+[\w\/\+]{32,}/gi,
            'AWS_SECRET_ACCESS_KEY=***'
        );

        // Redact long hex strings (likely tokens)
        sanitized = sanitized.replace(
            /\b[0-9a-fA-F]{32,}\b/g,
            '<redacted_token>'
        );

        // Truncate to 1KB maximum
        if (sanitized.length > 1024) {
            sanitized = sanitized.substring(0, 1024) + '\n... (truncated)';
        }

        return sanitized;
    }

    /**
     * Clear workspace memory (delete .cognee directory)
     * 
     * @returns Promise<boolean> - true if cleared successfully
     */
    async clearMemory(): Promise<boolean> {
        try {
            const cogneePath = path.join(this.workspacePath, '.cognee');
            
            if (fs.existsSync(cogneePath)) {
                // Recursively delete .cognee directory
                fs.rmSync(cogneePath, { recursive: true, force: true });
                this.log('INFO', 'Workspace memory cleared', { path: cogneePath });
                return true;
            } else {
                this.log('WARN', 'No memory to clear', { path: cogneePath });
                return true;
            }
        } catch (error) {
            this.log('ERROR', 'Failed to clear memory', {
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
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
