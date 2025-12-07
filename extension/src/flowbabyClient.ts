import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess, SpawnOptions, execFileSync, ExecFileSyncOptions } from 'child_process';
import { getFlowbabyOutputChannel, debugLog } from './outputChannels';
import { getAuditLogger } from './audit/AuditLogger';
import { SessionManager } from './sessionManager';

/**
 * Interface for BackgroundOperationManager to avoid circular imports.
 * Defines the minimal contract needed by FlowbabyClient for async operations.
 */
interface IBackgroundOperationManager {
    startOperation(
        summaryText: string,
        datasetPath: string,
        pythonPath: string,
        bridgeScriptPath: string,
        payload: {
            type: 'summary' | 'conversation';
            summary?: Record<string, unknown>;
            conversation?: {
                userMessage: string;
                assistantMessage: string;
                importance: number;
            };
        }
    ): Promise<string>;
}

/**
 * Result structure from Python bridge scripts
 */
interface FlowbabyResult {
    success: boolean;
    error?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any; // Additional fields from Python scripts
}

/**
 * Plan 045: Centralized API key state model
 * Tracks both Python-side (from init.py) and TypeScript-side (SecretStorage) API key status
 */
export interface ApiKeyState {
    /** Whether init.py detected LLM_API_KEY in its environment */
    pythonConfigured: boolean;
    /** Whether TypeScript layer has API key in SecretStorage or env */
    typescriptConfigured: boolean;
    /** Combined readiness - true if either source has API key */
    llmReady: boolean;
    /** User-friendly message about API key status */
    statusMessage: string;
}

/**
 * Plan 045: Result from initialize() with API key state
 */
export interface InitializeResult {
    /** Whether core initialization succeeded (directories, DB, ontology) */
    success: boolean;
    /** API key configuration state */
    apiKeyState: ApiKeyState;
    /** Error message if success is false */
    error?: string;
}

/**
 * Retrieval result with structured metadata per RETRIEVE_CONTRACT.md
 * Supports mixed-mode: enriched summaries (full metadata) and legacy memories (null metadata)
 */
export interface RetrievalResult {
    summaryText: string;
    text?: string; // Backward compatibility
    topic?: string;
    topicId?: string;
    planId?: string;
    sessionId?: string;
    status?: 'Active' | 'Superseded' | 'DecisionRecord' | null;
    createdAt?: Date;
    sourceCreatedAt?: Date;
    updatedAt?: Date;
    score: number;
    finalScore?: number;
    confidenceLabel?: 'synthesized_high' | 'normal';
    decisions?: string[];
    rationale?: string[];
    openQuestions?: string[];
    nextSteps?: string[];
    references?: string[];
    tokens?: number;
}

type SummaryPayload = {
    topic: string;
    context: string;
    decisions: string[];
    rationale: string[];
    openQuestions: string[];
    nextSteps: string[];
    references: string[];
    timeScope: string;
    topicId: string | null;
    sessionId: string | null;
    planId: string | null;
    status: 'Active' | 'Superseded' | 'DecisionRecord' | null;
    sourceCreatedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    workspace_path: string;
    __user_session_id?: string;
};

type ConversationPayload = {
    workspace_path: string;
    user_message: string;
    assistant_message: string;
    importance: number;
    __user_session_id?: string;
};

type RetrievePayload = {
    workspace_path: string;
    query: string;
    max_results: number;
    max_tokens: number;
    half_life_days: number;
    include_superseded: boolean;
    search_top_k: number;
    __user_session_id?: string;
};

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
 * FlowbabyClient - TypeScript client for spawning Python bridge scripts
 * 
 * Provides high-level API for Flowbaby operations (init, ingest, retrieve)
 * via subprocess communication with JSON over stdout.
 */
export class FlowbabyClient {
    private readonly workspacePath: string;
    private readonly pythonPath: string;
    private readonly bridgePath: string;
    private readonly maxContextResults: number;
    private readonly maxContextTokens: number;
    private readonly searchTopK: number;
    private readonly rankingHalfLifeDays: number;
    private readonly logLevel: LogLevel;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly MAX_PAYLOAD_CHARS = 100000;
    private readonly context: vscode.ExtensionContext;  // Plan 028 M5
    private cachedApiKeyState: ApiKeyState | null = null;  // Plan 045 Hotfix
    private readonly sessionManager?: SessionManager; // Plan 001: Session Manager
    private readonly sessionManagementEnabled: boolean; // Plan 050: User toggle for sessions
    private readonly debugLoggingEnabled: boolean; // Plan 050: Propagate debug gate to bridge

    /**
     * Constructor - Load configuration and initialize output channel
     * 
     * @param workspacePath Absolute path to workspace root
     * @param context VS Code extension context for SecretStorage access (Plan 028 M5)
     * @param sessionManager Optional SessionManager instance (Plan 001)
     */
    constructor(workspacePath: string, context: vscode.ExtensionContext, sessionManager?: SessionManager) {
        this.workspacePath = workspacePath;
        this.context = context;
        this.sessionManager = sessionManager;

        // Load configuration from VS Code settings
        const config = vscode.workspace.getConfiguration('Flowbaby');
        this.maxContextResults = config.get<number>('maxContextResults', 3);
        this.maxContextTokens = config.get<number>('maxContextTokens', 32000);
        this.searchTopK = config.get<number>('searchTopK', 10);
        const rankingConfig = vscode.workspace.getConfiguration('Flowbaby.ranking');
        const halfLifeSetting = rankingConfig.get<number>('halfLifeDays', 7);
        this.rankingHalfLifeDays = this.clampHalfLifeDays(halfLifeSetting);

        // Map log level string to enum
        const logLevelStr = config.get<string>('logLevel', 'info');
        this.logLevel = this.parseLogLevel(logLevelStr);

        // Plan 050: Read session management and debug logging toggles
        this.sessionManagementEnabled = vscode.workspace
            .getConfiguration('Flowbaby.sessionManagement')
            .get<boolean>('enabled', true);
        this.debugLoggingEnabled = config.get<boolean>('debugLogging', false);

        // Use singleton Output Channel for logging (Plan 028 M1)
        this.outputChannel = getFlowbabyOutputChannel();

        // Resolve bridge path (extension/bridge relative to dist/)
        this.bridgePath = path.join(__dirname, '..', 'bridge');

        // Detect Python interpreter using auto-detection or explicit config
        this.pythonPath = this.detectPythonInterpreter();

        // Validate Python version compatibility before using the interpreter
        this.pythonPath = this.validatePythonVersion(this.pythonPath);

        // Log detected interpreter with source attribution
        const configuredPath = config.get<string>('pythonPath', 'python3');
        const detectionSource = (configuredPath !== 'python3' && configuredPath !== '') 
            ? 'explicit_config' 
            : 'auto_detected';

        this.log('INFO', 'FlowbabyClient initialized', {
            workspace: workspacePath,
            pythonPath: this.pythonPath,
            pythonSource: detectionSource,
            maxContextResults: this.maxContextResults,
            maxContextTokens: this.maxContextTokens,
            searchTopK: this.searchTopK,
            rankingHalfLifeDays: this.rankingHalfLifeDays,
            bridgePath: this.bridgePath,
            sessionManagementEnabled: this.sessionManagementEnabled,
            debugLoggingEnabled: this.debugLoggingEnabled
        });
    }

    /**
     * Validate that the selected Python interpreter is within a supported version range.
     * 
     * Current constraint: Python 3.10–3.12 inclusive. Python 3.11 is recommended.
     * Python 3.13 is not yet supported due to upstream native dependencies (e.g. kuzu).
     */
    /**
     * Wrapper for execFileSync to facilitate testing
     */
    protected execFileSync(command: string, args: string[], options: ExecFileSyncOptions): string {
        return execFileSync(command, args, options).toString();
    }

    private validatePythonVersion(pythonPath: string): string {
        const SUPPORTED_MIN = { major: 3, minor: 10 };
        const SUPPORTED_MAX = { major: 3, minor: 12 };

        let versionOutput: string;
        try {
            // Use --version to avoid importing any modules; keep this as cheap as possible
            versionOutput = this.execFileSync(pythonPath, ['--version'], {
                encoding: 'utf8'
            }).trim();
        } catch (error) {
            // On Unix-like systems, if the initial fallback command was python3,
            // try python as a secondary fallback before giving up.
            const isWindows = process.platform === 'win32';
            const initialErrorMessage = error instanceof Error ? error.message : String(error);

            // Windows Fallback: If 'python' fails, try 'py' (Python Launcher)
            if (isWindows && pythonPath === 'python') {
                this.log('WARN', 'python --version failed; attempting py (Python Launcher) as fallback', {
                    pythonPath,
                    error: initialErrorMessage
                });

                try {
                    versionOutput = this.execFileSync('py', ['--version'], {
                        encoding: 'utf8'
                    }).trim();
                    // If this succeeds, switch to 'py'
                    pythonPath = 'py';
                } catch (fallbackError) {
                    const fallbackMessage = fallbackError instanceof Error
                        ? fallbackError.message
                        : String(fallbackError);

                    this.log('ERROR', 'Failed to run python and py --version', {
                        primaryError: initialErrorMessage,
                        fallbackError: fallbackMessage
                    });

                    const friendlyMessage =
                        'Flowbaby could not run a Python interpreter. ' +
                        'Tried both "python" and "py" (Python Launcher) on this system. ' +
                        'Please ensure Python 3.10–3.12 is installed and available on your PATH, ' +
                        'or set Flowbaby.pythonPath to a valid interpreter.';

                    throw new Error(friendlyMessage);
                }
            } else if (!isWindows && pythonPath === 'python3') {
                this.log('WARN', 'python3 --version failed; attempting python as fallback', {
                    pythonPath,
                    error: initialErrorMessage
                });

                try {
                    versionOutput = this.execFileSync('python', ['--version'], {
                        encoding: 'utf8'
                    }).trim();
                    // If this succeeds, continue with version parsing below using python.
                    pythonPath = 'python';
                } catch (fallbackError) {
                    const fallbackMessage = fallbackError instanceof Error
                        ? fallbackError.message
                        : String(fallbackError);

                    this.log('ERROR', 'Failed to run python3 and python --version', {
                        primaryError: initialErrorMessage,
                        fallbackError: fallbackMessage
                    });

                    const friendlyMessage =
                        'Flowbaby could not run a Python interpreter. ' +
                        'Tried both "python3" and "python" on this system. ' +
                        'Please ensure Python 3.10–3.12 is installed and available on your PATH, ' +
                        'or set Flowbaby.pythonPath to a valid interpreter.';

                    // Don't show toast here; the outer catch block will display it to avoid duplicates
                    throw new Error(friendlyMessage);
                }
            } else {
                this.log('ERROR', 'Failed to run python --version', {
                    pythonPath,
                    error: initialErrorMessage
                });

                // Build a clear, platform-specific message
                const commandTried = isWindows ? 'python' : pythonPath;
                const friendlyMessage =
                    `Flowbaby could not run "${commandTried} --version". ` +
                    'Please install Python 3.10–3.12 (3.11 recommended) and ensure it is available on your PATH, ' +
                    'or set Flowbaby.pythonPath to the full path of a valid Python interpreter.';

                // Don't show toast here; the outer catch block will display it to avoid duplicates
                throw new Error(friendlyMessage);
            }
        }

        const match = versionOutput.match(/Python\s+(\d+)\.(\d+)\.(\d+)/i);
        if (!match) {
            this.log('WARN', 'Unable to parse Python version', { pythonPath, versionOutput });
            return pythonPath; // Do not block if we cannot parse; defer to downstream errors
        }

        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);

        const inRange =
            major === SUPPORTED_MIN.major &&
            minor >= SUPPORTED_MIN.minor &&
            minor <= SUPPORTED_MAX.minor;

        if (!inRange) {
            const friendlyMessage =
                `Flowbaby requires Python ${SUPPORTED_MIN.major}.${SUPPORTED_MIN.minor}–` +
                `${SUPPORTED_MAX.major}.${SUPPORTED_MAX.minor} (Python 3.11 recommended). ` +
                `Detected ${versionOutput} at ${pythonPath}. ` +
                'Please install a supported Python version and update the Flowbaby.pythonPath setting, ' +
                'then re-run "Flowbaby: Initialize Workspace".';

            this.log('ERROR', 'Unsupported Python version for Flowbaby bridge', {
                pythonPath,
                versionOutput,
                supportedRange: '3.10–3.12'
            });

            // Don't show toast here; the outer catch block will display it to avoid duplicates
            throw new Error(friendlyMessage);
        }

        return pythonPath;
    }

    /**
     * Detect Python interpreter with auto-detection fallback chain
     * 
     * Priority order:
     * 1. Explicit Flowbaby.pythonPath setting (if set)
     * 2. .flowbaby/venv virtual environment (managed environment)
     * 3. System Python ("python" on Windows, "python3" on Unix with "python" fallback)
     * 
     * @returns string - Path to Python interpreter
     */
    private detectPythonInterpreter(): string {
        const config = vscode.workspace.getConfiguration('Flowbaby');
        const configuredPath = config.get<string>('pythonPath', '');

        // Priority 1: Explicit config always wins (user override is sacred)
        if (configuredPath && configuredPath.trim() !== '') {
            debugLog('Python interpreter: using explicit config', { pythonPath: configuredPath });
            return configuredPath;
        }

        const isWindows = process.platform === 'win32';
        
        // Priority 2: Check .flowbaby/venv (managed environment)
        const flowbabyPath = isWindows
            ? path.join(this.workspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
            : path.join(this.workspacePath, '.flowbaby', 'venv', 'bin', 'python');

        try {
            if (fs.existsSync(flowbabyPath)) {
                debugLog('Python interpreter: using .flowbaby/venv', { pythonPath: flowbabyPath });
                return flowbabyPath;
            }
        } catch (error) {
            this.log('DEBUG', '.flowbaby/venv detection failed', {
                flowbabyPath,
                error: error instanceof Error ? error.message : String(error)
            });
        }

        // Priority 3: Fall back to system Python on each platform
        if (isWindows) {
            debugLog('Python interpreter: using system python (Windows)');
            return 'python';
        }

        // On Unix-like systems, prefer python3 but fall back to python if needed.
        // The actual failure mode (if both are missing or broken) will be surfaced
        // by validatePythonVersion with a clear, user-friendly message.
        debugLog('Python interpreter: preferring system python3 (Unix)');
        return 'python3';
    }

    /**
     * Initialize Flowbaby for workspace
     * 
     * Calls init.py to configure Flowbaby directories, databases, and ontology.
     * Plan 045: API key is now optional - initialization succeeds without it.
     * 
     * @returns Promise<InitializeResult> - Result with success status and API key state
     */
    async initialize(): Promise<InitializeResult> {
        const startTime = Date.now();
        this.log('INFO', 'Initializing Flowbaby', { workspace: this.workspacePath });

        // Plan 045: Build API key state by checking both TypeScript and Python sources
        const buildApiKeyState = async (pythonConfigured: boolean): Promise<ApiKeyState> => {
            const tsApiKey = await this.resolveApiKey();
            const typescriptConfigured = !!tsApiKey;
            const llmReady = pythonConfigured || typescriptConfigured;
            
            let statusMessage: string;
            if (llmReady) {
                statusMessage = 'LLM API key configured - memory operations ready';
            } else {
                statusMessage = 'LLM API key not configured (OpenAI by default) - use "Flowbaby: Set API Key" command';
            }
            
            return {
                pythonConfigured,
                typescriptConfigured,
                llmReady,
                statusMessage
            };
        };

        try {
            // Plan 040.1: Use 60-second timeout for initialization
            // First-run database creation (SQLite, Kuzu, LanceDB) can exceed default 10s on slower machines
            const result = await this.runPythonScript('init.py', [this.workspacePath], 60000);
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
                    flowbaby_dir: result.flowbaby_dir
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
                        note: 'Untagged legacy data pruned from global Flowbaby directory'
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

                // Plan 045: Extract API key state from init.py response
                const pythonConfigured = result.api_key_configured === true;
                const apiKeyState = await buildApiKeyState(pythonConfigured);
                
                // Log API key status
                this.log('INFO', 'API key status', {
                    python_configured: apiKeyState.pythonConfigured,
                    typescript_configured: apiKeyState.typescriptConfigured,
                    llm_ready: apiKeyState.llmReady
                });

                // Plan 045 Hotfix: Cache the API key state for later access
                this.cachedApiKeyState = apiKeyState;

                return {
                    success: true,
                    apiKeyState
                };
            } else {
                this.log('ERROR', 'Flowbaby initialization failed', {
                    duration,
                    error: result.error
                });

                // Plan 040 Hotfix: Specific handling for missing VC++ Redistributable
                if (result.error && result.error.includes('Visual C++ Redistributable')) {
                    const download = 'Download Redistributable';
                    vscode.window.showErrorMessage(
                        'Flowbaby requires the Microsoft Visual C++ Redistributable on Windows.',
                        download
                    ).then(selection => {
                        if (selection === download) {
                            vscode.env.openExternal(vscode.Uri.parse('https://aka.ms/vs/17/release/vc_redist.x64.exe'));
                        }
                    });
                } else {
                    vscode.window.showWarningMessage(
                        `Flowbaby initialization failed: ${result.error}`
                    );
                }
                
                // Even on failure, provide API key state
                const apiKeyState = await buildApiKeyState(false);
                return {
                    success: false,
                    apiKeyState,
                    error: result.error
                };
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log('ERROR', 'Flowbaby initialization exception', {
                duration,
                error: errorMessage
            });

            // Plan 040 Hotfix: Specific handling for missing VC++ Redistributable (exception path)
            if (errorMessage.includes('Visual C++ Redistributable')) {
                const download = 'Download Redistributable';
                vscode.window.showErrorMessage(
                    'Flowbaby requires the Microsoft Visual C++ Redistributable on Windows.',
                    download
                ).then(selection => {
                    if (selection === download) {
                        vscode.env.openExternal(vscode.Uri.parse('https://aka.ms/vs/17/release/vc_redist.x64.exe'));
                    }
                });
            } else {
                vscode.window.showWarningMessage(
                    `Flowbaby initialization error: ${errorMessage}`
                );
            }
            
            // Even on exception, provide API key state
            const apiKeyState = await buildApiKeyState(false);
            return {
                success: false,
                apiKeyState,
                error: errorMessage
            };
        }
    }

    /**
     * Ingest a structured conversation summary (Plan 014 Milestone 3)
     * @param summary - ConversationSummary object with content and metadata fields
     * @returns Promise<boolean> - true if ingested, false on error
     */
    async ingestSummary(summary: {
        topic: string;
        context: string;
        decisions: string[];
        rationale: string[];
        openQuestions: string[];
        nextSteps: string[];
        references: string[];
        timeScope: string;
        topicId: string | null;
        sessionId: string | null;
        planId: string | null;
        status: 'Active' | 'Superseded' | 'DecisionRecord' | null;
        sourceCreatedAt: Date | null;
        createdAt: Date | null;
        updatedAt: Date | null;
    }, threadId?: string): Promise<boolean> {
        const startTime = Date.now();
        
        this.log('DEBUG', 'Ingesting conversation summary', {
            topic: summary.topic,
            topicId: summary.topicId,
            status: summary.status,
            timeScope: summary.timeScope,
            threadId
        });

        try {
            // Convert camelCase to format expected by Python (handles both naming conventions)
            let summaryPayload: SummaryPayload = {
                topic: summary.topic,
                context: summary.context,
                decisions: summary.decisions,
                rationale: summary.rationale,
                openQuestions: summary.openQuestions,
                nextSteps: summary.nextSteps,
                references: summary.references,
                timeScope: summary.timeScope,
                topicId: summary.topicId,
                sessionId: summary.sessionId,
                planId: summary.planId,
                status: summary.status,
                sourceCreatedAt: summary.sourceCreatedAt ? summary.sourceCreatedAt.toISOString() : null,
                createdAt: summary.createdAt ? summary.createdAt.toISOString() : null,
                updatedAt: summary.updatedAt ? summary.updatedAt.toISOString() : null,
                workspace_path: this.workspacePath
            };

            // Plan 001: Inject session ID if SessionManager is available
            if (this.sessionManager && this.sessionManagementEnabled) {
                const sessionId = threadId 
                    ? this.sessionManager.getSessionIdForChatThread(threadId)
                    : this.sessionManager.getSessionIdForAgentRun();
                summaryPayload = this.sessionManager.wrapPayload(summaryPayload, sessionId);
            }

            const summaryJson = JSON.stringify(summaryPayload);

            if (summaryJson.length > this.MAX_PAYLOAD_CHARS) {
                throw new Error(`Payload too large (${summaryJson.length} chars). Max allowed is ${this.MAX_PAYLOAD_CHARS}.`);
            }
            
            // Use 120-second timeout for summary ingestion (same as conversation)
            const result = await this.runPythonScript('ingest.py', [
                '--summary',
                '--summary-json',
                summaryJson
            ], 120000);

            const duration = Date.now() - startTime;

            if (result.success) {
                this.log('INFO', 'Summary ingested', {
                    topic: summary.topic,
                    topicId: summary.topicId,
                    chars: result.ingested_chars,
                    timestamp: result.timestamp,
                    metadata: result.metadata,
                    duration_ms: duration,
                    ingestion_duration_sec: result.ingestion_duration_sec
                });
                
                // Log step-level metrics if available
                if (result.ingestion_metrics) {
                    this.log('DEBUG', 'Summary ingestion metrics', {
                        metrics: result.ingestion_metrics
                    });
                }
                
                return true;
            } else {
                this.log('ERROR', 'Summary ingestion failed', {
                    topic: summary.topic,
                    duration,
                    error: result.error
                });
                return false;
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            // Distinguish timeout vs true failure
            const isTimeout = /Python script timeout after/i.test(errorMessage);
            
            if (isTimeout) {
                this.log('ERROR', 'Summary ingestion timeout', {
                    topic: summary.topic,
                    duration_ms: duration,
                    error_type: 'timeout',
                    error: errorMessage,
                    note: 'Summary ingestion may still complete in background - check @flowbaby retrieval'
                });
                
                vscode.window.showWarningMessage(
                    'Flowbaby is still working on summary ingestion in the background. ' +
                    'The extension timed out waiting for a response after 120 seconds. ' +
                    'Your summary may still be ingested; you can check by querying @flowbaby in a moment.'
                );
            } else {
                this.log('ERROR', 'Summary ingestion exception', {
                    topic: summary.topic,
                    duration_ms: duration,
                    error_type: 'failure',
                    error: errorMessage
                });
            }
            
            return false;
        }
    }

    /**
     * Ingest summary asynchronously (Plan 017)
     * 
     * Runs add-only mode, then spawns background cognify-only subprocess.
     * Returns immediately after add() completes (<10s).
     * 
     * @param summary - ConversationSummary object
     * @param manager - BackgroundOperationManager instance
     * @returns Promise<{success: boolean, operationId?: string, staged: boolean}>
     */
    async ingestSummaryAsync(
        summary: {
            topic: string;
            context: string;
            decisions: string[];
            rationale: string[];
            openQuestions: string[];
            nextSteps: string[];
            references: string[];
            timeScope: string;
            topicId: string | null;
            sessionId: string | null;
            planId: string | null;
            status: 'Active' | 'Superseded' | 'DecisionRecord' | null;
            sourceCreatedAt: Date | null;
            createdAt: Date | null;
            updatedAt: Date | null;
        },
        manager: IBackgroundOperationManager,
        threadId?: string
    ): Promise<{success: boolean, operationId?: string, staged: boolean, error?: string}> {
        const startTime = Date.now();
        
        this.log('DEBUG', 'Ingesting conversation summary (async mode)', {
            topic: summary.topic,
            topicId: summary.topicId,
            status: summary.status,
            threadId
        });

        try {
            // Convert to Python format
            let summaryPayload: SummaryPayload = {
                topic: summary.topic,
                context: summary.context,
                decisions: summary.decisions,
                rationale: summary.rationale,
                openQuestions: summary.openQuestions,
                nextSteps: summary.nextSteps,
                references: summary.references,
                timeScope: summary.timeScope,
                topicId: summary.topicId,
                sessionId: summary.sessionId,
                planId: summary.planId,
                status: summary.status,
                sourceCreatedAt: summary.sourceCreatedAt ? summary.sourceCreatedAt.toISOString() : null,
                createdAt: summary.createdAt ? summary.createdAt.toISOString() : null,
                updatedAt: summary.updatedAt ? summary.updatedAt.toISOString() : null,
                workspace_path: this.workspacePath
            };

            // Plan 001: Inject session ID if SessionManager is available
            if (this.sessionManager && this.sessionManagementEnabled) {
                const sessionId = threadId 
                    ? this.sessionManager.getSessionIdForChatThread(threadId)
                    : this.sessionManager.getSessionIdForAgentRun();
                summaryPayload = this.sessionManager.wrapPayload(summaryPayload, sessionId);
            }

            const summaryJson = JSON.stringify(summaryPayload);

            if (summaryJson.length > this.MAX_PAYLOAD_CHARS) {
                throw new Error(`Payload too large (${summaryJson.length} chars). Max allowed is ${this.MAX_PAYLOAD_CHARS}.`);
            }
            
            // Run add-only mode (fast, <10s)
            const result = await this.runPythonScript('ingest.py', [
                '--mode', 'add-only',
                '--summary',
                '--summary-json',
                summaryJson
            ], 30000); // 30s timeout for add-only

            const duration = Date.now() - startTime;

            if (result.success && result.staged) {
                this.log('INFO', 'Summary staged for background cognify', {
                    topic: summary.topic,
                    topicId: summary.topicId,
                    chars: result.ingested_chars,
                    duration_ms: duration
                });
                
                // Get summary text for digest
                const summaryText = `${summary.topic}: ${summary.context.substring(0, 100)}`;
                const ingestScriptPath = path.join(this.bridgePath, 'ingest.py');
                
                // Start background cognify operation
                try {
                    const operationId = await manager.startOperation(
                        summaryText,
                        this.workspacePath,
                        this.pythonPath,
                        ingestScriptPath,
                        {
                            type: 'summary',
                            summary: summaryPayload
                        }
                    );
                    
                    return {
                        success: true,
                        operationId,
                        staged: true
                    };
                } catch (bgError) {
                    // Background operation failed to start (queue full, etc.)
                    const bgErrorMessage = bgError instanceof Error ? bgError.message : String(bgError);
                    this.log('ERROR', 'Failed to start background cognify', {
                        topic: summary.topic,
                        error: bgErrorMessage
                    });
                    
                    return {
                        success: false,
                        staged: true, // Data was staged, but cognify didn't queue
                        error: bgErrorMessage
                    };
                }
            } else {
                this.log('ERROR', 'Summary staging failed (add-only)', {
                    topic: summary.topic,
                    duration,
                    error: result.error
                });
                return {
                    success: false,
                    staged: false,
                    error: result.error
                };
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            this.log('ERROR', 'Summary async ingestion failed', {
                topic: summary.topic,
                duration_ms: duration,
                error: errorMessage
            });
            
            return {
                success: false,
                staged: false,
                error: errorMessage
            };
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
        importance: number = 0.0,
        threadId?: string
    ): Promise<boolean> {
        const startTime = Date.now();
        
        this.log('DEBUG', 'Ingesting conversation', {
            user_length: userMessage.length,
            assistant_length: assistantMessage.length,
            importance,
            threadId
        });

        try {
            const payload: ConversationPayload = {
                workspace_path: this.workspacePath,
                user_message: userMessage,
                assistant_message: assistantMessage,
                importance
            };

            const args = (this.sessionManager && this.sessionManagementEnabled)
                ? (() => {
                    const sessionId = threadId
                        ? this.sessionManager.getSessionIdForChatThread(threadId)
                        : this.sessionManager.getSessionIdForAgentRun();
                    const wrapped = this.sessionManager.wrapPayload(payload, sessionId);
                    return ['--conversation-json', JSON.stringify(wrapped)];
                })()
                : [
                    this.workspacePath,
                    userMessage,
                    assistantMessage,
                    importance.toString()
                ];

            if ((userMessage.length + assistantMessage.length) > this.MAX_PAYLOAD_CHARS) {
                throw new Error(`Payload too large (${userMessage.length + assistantMessage.length} chars). Max allowed is ${this.MAX_PAYLOAD_CHARS}.`);
            }

            // Use 120-second timeout for ingestion (Cognee setup + LLM processing can take time)
            // Increased from 30s to reduce false-positive timeout errors when ingestion succeeds but takes >30s
            const result = await this.runPythonScript('ingest.py', args, 120000);

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
                    note: 'Ingestion may still complete in background - check @flowbaby retrieval'
                });
                
                // User-facing message clarifying background processing
                vscode.window.showWarningMessage(
                    'Flowbaby is still working on ingestion in the background. ' +
                    'The extension timed out waiting for a response after 120 seconds. ' +
                    'Your data may still be ingested; you can check by querying @flowbaby in a moment.'
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
     * Ingest conversation asynchronously (Plan 017)
     * 
     * Runs add-only mode, then spawns background cognify-only subprocess.
     * Returns immediately after add() completes (<10s).
     * 
     * Used by manual capture command for async ingestion.
     * 
     * @param userMessage - User message
     * @param assistantMessage - Assistant message
     * @param manager - BackgroundOperationManager instance
     * @param importance - Optional importance score (0.0-1.0)
     * @returns Promise<{success: boolean, operationId?: string, staged: boolean, error?: string}>
     */
    async ingestAsync(
        userMessage: string,
        assistantMessage: string,
        manager: IBackgroundOperationManager,
        importance: number = 0.0,
        threadId?: string
    ): Promise<{success: boolean, operationId?: string, staged: boolean, error?: string}> {
        const startTime = Date.now();
        
        this.log('DEBUG', 'Ingesting conversation (async mode)', {
            user_length: userMessage.length,
            assistant_length: assistantMessage.length,
            importance,
            threadId
        });

        try {
            if (!this.pythonPath) {
            const interpreterError = 'Python interpreter not configured. Set Flowbaby.pythonPath or create a workspace .venv.';
            this.log('ERROR', 'Cannot start async ingestion without Python interpreter', {
                duration_ms: 0,
                error: interpreterError
            });
            vscode.window.showErrorMessage(
                'Flowbaby cannot start background ingestion because no Python interpreter is configured. ' +
                'Set Flowbaby.pythonPath or create a workspace .venv and try again.'
            );
            return {
                success: false,
                staged: false,
                error: interpreterError
            };
        }
            if ((userMessage.length + assistantMessage.length) > this.MAX_PAYLOAD_CHARS) {
                throw new Error(`Payload too large (${userMessage.length + assistantMessage.length} chars). Max allowed is ${this.MAX_PAYLOAD_CHARS}.`);
            }

            // Plan 001: Prepare payload with session ID
            let args: string[] = [];
                if (this.sessionManager && this.sessionManagementEnabled) {
                 const sessionId = threadId 
                    ? this.sessionManager.getSessionIdForChatThread(threadId)
                    : this.sessionManager.getSessionIdForAgentRun();
                 
                 // Construct JSON payload
                 const conversationPayload = {
                     workspace_path: this.workspacePath,
                     user_message: userMessage,
                     assistant_message: assistantMessage,
                     importance: importance,
                     __user_session_id: sessionId
                 };
                 
                 args = ['--mode', 'add-only', '--conversation-json', JSON.stringify(conversationPayload)];
            } else {
                // Fallback to legacy positional args
                args = [
                    '--mode', 'add-only',
                    this.workspacePath,
                    userMessage,
                    assistantMessage,
                    importance.toString()
                ];
            }

            // Run add-only mode (fast, <10s)
            const result = await this.runPythonScript('ingest.py', args, 30000); // 30s timeout for add-only

            const duration = Date.now() - startTime;

            if (result.success && result.staged) {
                this.log('INFO', 'Conversation staged for background cognify', {
                    chars: result.ingested_chars,
                    duration_ms: duration
                });
                
                // Get conversation summary for digest
                const summaryText = `${userMessage.substring(0, 50)}: ${assistantMessage.substring(0, 50)}`;
                const ingestScriptPath = path.join(this.bridgePath, 'ingest.py');
                
                // Start background cognify operation
                try {
                    const operationId = await manager.startOperation(
                        summaryText,
                        this.workspacePath,
                        this.pythonPath,
                        ingestScriptPath,
                        {
                            type: 'conversation',
                            conversation: {
                                userMessage,
                                assistantMessage,
                                importance
                            }
                        }
                    );
                    
                    return {
                        success: true,
                        operationId,
                        staged: true
                    };
                } catch (bgError) {
                    // Background operation failed to start (queue full, etc.)
                    const bgErrorMessage = bgError instanceof Error ? bgError.message : String(bgError);
                    this.log('ERROR', 'Failed to start background cognify', {
                        error: bgErrorMessage
                    });
                    
                    return {
                        success: false,
                        staged: true, // Data was staged, but cognify didn't queue
                        error: bgErrorMessage
                    };
                }
            } else {
                this.log('ERROR', 'Conversation staging failed (add-only)', {
                    duration,
                    error: result.error
                });
                return {
                    success: false,
                    staged: false,
                    error: result.error
                };
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            this.log('ERROR', 'Conversation async ingestion failed', {
                duration_ms: duration,
                error: errorMessage
            });
            
            return {
                success: false,
                staged: false,
                error: errorMessage
            };
        }
    }

    /**
     * Retrieve context from Cognee with structured metadata
     * 
     * Calls retrieve.py to search for relevant context with hybrid graph-vector search.
     * Returns structured RetrievalResult objects with metadata per RETRIEVE_CONTRACT.md.
     * Supports mixed-mode: enriched summaries (full metadata) and legacy memories (null metadata).
     * 
     * @param query User's search query
     * @returns Promise<RetrievalResult[]> - Array of retrieval results with metadata (empty on error)
     */
    async retrieve(
        query: string,
        options?: {
            maxResults?: number;
            maxTokens?: number;
            includeSuperseded?: boolean;
            halfLifeDays?: number;
            threadId?: string; // Plan 001: Support session ID
        }
    ): Promise<RetrievalResult[]> {
        const startTime = Date.now();

        const maxResults = options?.maxResults ?? this.maxContextResults;
        const maxTokens = options?.maxTokens ?? this.maxContextTokens;
        const halfLifeDays = this.clampHalfLifeDays(options?.halfLifeDays ?? this.rankingHalfLifeDays);
        const includeSuperseded = options?.includeSuperseded ?? false;
        const threadId = options?.threadId;
        const searchTopK = this.searchTopK;

        this.log('DEBUG', 'Retrieving context', {
            query_length: query.length,
            query_preview: query.length > 200 ? query.substring(0, 200) + `... (${query.length} chars total)` : query,
            max_results: maxResults,
            max_tokens: maxTokens,
            search_top_k: searchTopK,
            half_life_days: halfLifeDays,
            include_superseded: includeSuperseded,
            threadId
        });

        try {
            // Plan 001: Use JSON payload with session ID
            let payload: RetrievePayload = {
                workspace_path: this.workspacePath,
                query: query,
                max_results: maxResults,
                max_tokens: maxTokens,
                half_life_days: halfLifeDays,
                include_superseded: includeSuperseded,
                search_top_k: searchTopK
            };

            if (this.sessionManager && this.sessionManagementEnabled) {
                const sessionId = threadId 
                    ? this.sessionManager.getSessionIdForChatThread(threadId)
                    : this.sessionManager.getSessionIdForAgentRun();
                payload = this.sessionManager.wrapPayload(payload, sessionId);
            }

            // Always prefer JSON payloads; session ID added only when enabled
            const args = ['--json', JSON.stringify(payload)];

            // Use 15-second timeout for retrieval (semantic search can be slow)
            const result = await this.runPythonScript('retrieve.py', args, 15000);

            const duration = Date.now() - startTime;

            if (result.success) {
                // Parse structured results per RETRIEVE_CONTRACT.md
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const results: RetrievalResult[] = (result.results || []).map((r: any) => {
                    // Mixed-mode handling per §4.4.1: branch on topic_id presence
                    const _isEnriched = !!r.topic_id; // Reserved for future enriched-text handling
                    
                    return {
                        summaryText: r.summary_text || r.text || '',
                        text: r.text, // Backward compatibility
                        topic: r.topic || undefined,
                        topicId: r.topic_id || undefined,
                        planId: r.plan_id || undefined,
                        sessionId: r.session_id || undefined,
                        status: r.status || undefined,
                        createdAt: r.created_at ? new Date(r.created_at) : undefined,
                        sourceCreatedAt: r.source_created_at
                            ? new Date(r.source_created_at)
                            : (r.created_at ? new Date(r.created_at) : undefined),
                        updatedAt: r.updated_at ? new Date(r.updated_at) : undefined,
                        score: r.score ?? r.final_score ?? r.relevance_score ?? 0,
                        finalScore: r.final_score ?? r.relevance_score ?? r.score ?? 0,
                        confidenceLabel: r.confidenceLabel || undefined,
                        decisions: r.decisions || [],
                        rationale: r.rationale || [],
                        openQuestions: r.open_questions || [],
                        nextSteps: r.next_steps || [],
                        references: r.references || [],
                        tokens: r.tokens
                    } as RetrievalResult;
                });
                
                const enrichedCount = results.filter(r => r.topicId).length;
                const legacyCount = results.length - enrichedCount;
                
                this.log('INFO', 'Context retrieved', {
                    result_count: result.result_count || 0,
                    filtered_count: result.filtered_count || 0,
                    enriched_count: enrichedCount,
                    legacy_count: legacyCount,
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

                return results;
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
     * Validate memory system integrity (Milestone 3)
     * 
     * Checks environment, ontology, and graph connection.
     * 
     * @returns Promise<{success: boolean, checks: any, status: string, error?: string}>
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async validateMemories(): Promise<{success: boolean, checks: any, status: string, error?: string}> {
        this.log('DEBUG', 'Validating memory system');
        const result = await this.runPythonScript('validate_memories.py', [this.workspacePath]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return result as any;
    }

    /**
     * List recent memories (Milestone 3)
     * 
     * Retrieves a list of recent summaries and decisions for display.
     * 
     * @param limit Maximum number of memories to return
     * @returns Promise<{success: boolean, memories: any[], error?: string}>
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async listMemories(limit: number = 10): Promise<{success: boolean, memories: any[], error?: string}> {
        this.log('DEBUG', 'Listing memories', { limit });
        const result = await this.runPythonScript('list_memories.py', [this.workspacePath, limit.toString()]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return result as any;
    }

    /**
     * Check if memory is enabled
     * 
     * @returns boolean - true if enabled in configuration
     */
    isEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('Flowbaby');
        return config.get<boolean>('enabled', true);
    }

    /**
     * Validate configuration
     * 
     * Checks if API key is available via SecretStorage or environment
     * Plan 039 M5: Updated to remove .env requirement
     * 
     * @returns Promise<{valid: boolean, errors: string[]}>
     */
    async validateConfiguration(): Promise<{ valid: boolean; errors: string[] }> {
        const errors: string[] = [];

        // Plan 039 M5: Check for API key via resolveApiKey (SecretStorage or env var)
        const apiKey = await this.resolveApiKey();
        if (!apiKey) {
            errors.push('LLM API key not configured. Use "Flowbaby: Set API Key" command (OpenAI by default, or set LLM_API_KEY env var).');
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
        let dataStr = '';
        if (data) {
            const stringified = JSON.stringify(data);
            // Sanitize and truncate data to prevent UI bloat
            dataStr = ` ${this.sanitizeOutput(stringified)}`;
        }
        
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
     * @returns Promise<FlowbabyResult> - Parsed JSON result
     */
    /**
     * Process a single line of stderr output from the bridge
     * Handles both structured JSON logs and legacy text markers
     */
    private processBridgeLogLine(line: string, scriptName: string): void {
        if (!line.trim()) {return;}

        try {
            // Try parsing as structured JSON log
            const logEntry = JSON.parse(line);
            
            // Validate it looks like our bridge log format
            if (logEntry.level && logEntry.message) {
                // Map Python level to VS Code level
                // Python: DEBUG, INFO, WARNING, ERROR, CRITICAL
                // VS Code: Debug, Info, Warn, Error
                let level = logEntry.level.toUpperCase();
                if (level === 'WARNING') {level = 'WARN';}
                if (level === 'CRITICAL') {level = 'ERROR';}
                
                // Log with data if present
                this.log(level, logEntry.message, logEntry.data);
                return;
            }
        } catch (e) {
            // Not JSON, fall through to legacy handling
        }

        // Legacy handling for non-JSON lines
        if (line.includes('[ERROR]')) {
            // Extract and parse JSON error payload if present
            const jsonMatch = line.match(/\[ERROR\]\s*(\{.*\})/);
            if (jsonMatch) {
                try {
                    const errorPayload = JSON.parse(jsonMatch[1]);
                    this.log('ERROR', 'Bridge script error', {
                        script: scriptName,
                        error_code: errorPayload.error_code,
                        error_type: errorPayload.error_type,
                        message: errorPayload.message
                    });
                } catch {
                    this.log('ERROR', 'Bridge script error (unparseable)', { line });
                }
            } else {
                this.log('ERROR', 'Bridge script error', { line });
            }
        } else if (line.includes('[WARNING]')) {
            this.log('WARN', 'Bridge script warning', { line });
        } else if (line.includes('[PROGRESS]')) {
            this.log('INFO', 'Bridge progress', { line });
        } else {
            // Log other stderr output at DEBUG level
            // But sanitize it first
            const sanitized = this.sanitizeOutput(line);
            this.log('DEBUG', `[${scriptName}] ${sanitized}`);
        }
    }

    /**
     * Spawn a child process (wrapper for testing)
     */
    protected spawnProcess(command: string, args: string[], options: SpawnOptions): ChildProcess {
        return spawn(command, args, options);
    }

    private async runPythonScript(
        scriptName: string,
        args: string[],
        timeoutMs: number = 10000
    ): Promise<FlowbabyResult> {
        const scriptPath = path.join(this.bridgePath, scriptName);
        const sanitizedArgs = args.map((arg, i) => 
            i === 0 ? arg : `<arg${i}>`  // Sanitize args (hide sensitive data)
        );

        this.log('DEBUG', 'Running Python script', {
            script: scriptName,
            args: sanitizedArgs
        });
        
        // Plan 028 M2: Debug logging for bridge spawn events
        debugLog('Python bridge spawn', {
            script: scriptName,
            pythonPath: this.pythonPath,
            bridgePath: this.bridgePath,
            workingDirectory: this.workspacePath,
            timeout_ms: timeoutMs
        });

        return new Promise((resolve, reject) => {
            // Milestone 5: Track process timing to distinguish timeout vs exit timing
            let timedOut = false;
            const requestStart = Date.now();
            let timeoutFiredAt: number | null = null;
            
            // Plan 028 M5/M6: Get LLM environment async and spawn process
            // Note: We have to wrap the spawn in an async IIFE since Promise executor can't be async
            (async () => {
                const llmEnv = await this.getLLMEnvironment();
                
                // Spawn Python process with workspace as working directory
                // This ensures relative paths in scripts resolve from workspace root
                // Set PYTHONUNBUFFERED=1 to ensure stderr [PROGRESS] markers appear immediately
                // Plan 028 M5: Inject LLM environment variables (API key, provider, model, endpoint)
                const python = this.spawnProcess(this.pythonPath, [scriptPath, ...args], {
                    cwd: this.workspacePath,
                    env: { 
                        ...process.env, 
                        PYTHONUNBUFFERED: '1',
                        ...llmEnv,
                        FLOWBABY_DEBUG_LOGGING: this.debugLoggingEnabled ? 'true' : 'false'
                    },
                    windowsHide: true
                });
                
                if (!python.stdout || !python.stderr) {
                    reject(new Error('Failed to spawn Python process: stdout/stderr not available'));
                    return;
                }

                let stdout = '';
                let stderrCaptured = '';
                let stderrBuffer = '';

            // Collect stdout (with buffer limit to prevent memory bloat)
            python.stdout.on('data', (data) => {
                stdout += data.toString();
                // Truncate if exceeding 1MB during collection (streaming truncation)
                if (stdout.length > 1048576) {
                    stdout = stdout.substring(0, 1048576);
                }
            });

            // Collect stderr (with buffer limit for error reporting, but stream processing for logs)
            python.stderr.on('data', (data) => {
                const chunk = data.toString();
                
                // 1. Capture for final error reporting (truncated)
                if (stderrCaptured.length < 1048576) {
                    stderrCaptured += chunk;
                    if (stderrCaptured.length > 1048576) {
                        stderrCaptured = stderrCaptured.substring(0, 1048576);
                    }
                }

                // 2. Stream processing for logs
                stderrBuffer += chunk;
                const lines = stderrBuffer.split('\n');
                
                // Process all complete lines
                // The last element is either an empty string (if ended with \n) or a partial line
                for (let i = 0; i < lines.length - 1; i++) {
                    this.processBridgeLogLine(lines[i], scriptName);
                }
                
                // Keep the last partial line in the buffer
                stderrBuffer = lines[lines.length - 1];
            });

            // Handle process close
            python.on('close', (code) => {
                const closeTime = Date.now();
                
                // Process any remaining stderr buffer
                if (stderrBuffer.trim()) {
                    this.processBridgeLogLine(stderrBuffer, scriptName);
                }

                this.log('DEBUG', 'Python script completed', {
                    script: scriptName,
                    exit_code: code,
                    close_duration_ms: closeTime - requestStart,
                    timed_out: timedOut,
                    timeout_fired_ms: timeoutFiredAt ? timeoutFiredAt - requestStart : null
                });
                
                // Plan 028 M2: Debug logging for bridge exit
                debugLog('Python bridge exit', {
                    script: scriptName,
                    exit_code: code,
                    duration_ms: closeTime - requestStart,
                    timed_out: timedOut
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
                        const result = JSON.parse(stdout) as FlowbabyResult;
                        if (result.error) {
                            structuredError = result.error;
                            errorMessage = structuredError;
                        }
                    } catch {
                        // stdout is not valid JSON - will log as unstructured error
                    }

                    // Sanitize outputs before logging
                    const sanitizedStdout = this.sanitizeOutput(stdout);
                    const sanitizedStderr = this.sanitizeOutput(stderrCaptured);

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
                        : ' Check Output Channel for details. If using virtual environment, configure Flowbaby.pythonPath setting.';
                    
                    reject(new Error(`${errorMessage}${troubleshootingHint}`));
                    return;
                }

                // Parse JSON output (success path)
                try {
                    const result = JSON.parse(stdout) as FlowbabyResult;
                    resolve(result);
                } catch (error) {
                    // Sanitize before logging parse failure
                    const sanitizedStdout = this.sanitizeOutput(stdout);
                    const sanitizedStderr = this.sanitizeOutput(stderrCaptured);
                    
                    this.log('ERROR', 'JSON parse failed', {
                        script: scriptName,
                        stdout_preview: sanitizedStdout,
                        stderr_preview: sanitizedStderr,
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
                
                // Log any stderr collected before timeout (diagnostic context from Milestone 2)
                if (stderrCaptured && stderrCaptured.trim()) {
                    const stderrLines = stderrCaptured.split('\n');
                    const lastProgressLine = stderrLines.filter(l => l.includes('[PROGRESS]')).pop();
                    const errorLines = stderrLines.filter(l => l.includes('[ERROR]'));
                    
                    this.log('ERROR', 'Python script timeout - partial stderr captured', {
                        script: scriptName,
                        timeout: timeoutMs,
                        elapsed_ms: timeoutFiredAt - requestStart,
                        last_progress: lastProgressLine || 'none',
                        error_count: errorLines.length
                    });
                    
                    // Surface any error payloads found
                    for (const errorLine of errorLines) {
                        const jsonMatch = errorLine.match(/\[ERROR\]\s*(\{.*\})/);
                        if (jsonMatch) {
                            try {
                                const errorPayload = JSON.parse(jsonMatch[1]);
                                this.log('ERROR', 'Bridge error before timeout', {
                                    error_code: errorPayload.error_code,
                                    error_type: errorPayload.error_type,
                                    message: errorPayload.message
                                });
                            } catch {
                                // Ignore parse errors
                            }
                        }
                    }
                } else {
                    this.log('ERROR', 'Python script timeout', {
                        script: scriptName,
                        timeout: timeoutMs,
                        elapsed_ms: timeoutFiredAt - requestStart
                    });
                }
                
                reject(new Error(`Python script timeout after ${timeoutMs/1000} seconds`));
            }, timeoutMs);

            // Clear timeout on close (only if not already timed out)
            python.on('close', () => {
                if (!timedOut) {
                    clearTimeout(timeout);
                }
            });
            })().catch(reject);  // Close async IIFE and forward any errors to reject
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
            /LLM_API_KEY[\s=]+[\w-]{32,}/gi,
            'LLM_API_KEY=***'
        );

        // Redact OpenAI API keys (environment variable format - legacy, for backwards compatibility)
        sanitized = sanitized.replace(
            /OPENAI_API_KEY[\s=]+[\w-]{32,}/gi,
            'OPENAI_API_KEY=***'
        );

        // Redact OpenAI-style keys (sk-... format)
        sanitized = sanitized.replace(
            /sk-[A-Za-z0-9]{32,}/g,
            'sk-***'
        );

        // Redact Bearer tokens
        sanitized = sanitized.replace(
            /Bearer\s+[A-Za-z0-9_-]{32,}/g,
            'Bearer ***'
        );

        // Redact AWS secret access keys
        sanitized = sanitized.replace(
            /AWS_SECRET_ACCESS_KEY[\s=]+[\w/+]{32,}/gi,
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
     * Resolve LLM API key with priority order (Plan 039 M5 - Security Hardening)
     * 
     * Priority:
     * 1. SecretStorage global key (flowbaby.llmApiKey) - secure, encrypted storage
     * 2. System environment LLM_API_KEY (fallback for CI/automated environments)
     * 
     * NOTE: Workspace .env support removed per Plan 037 F2 security finding.
     * Plaintext API keys in .env files are a credential exposure risk.
     * Users should use "Flowbaby: Set API Key" command for secure storage.
     * 
     * @returns Promise<string | undefined> - Resolved API key or undefined
     */
    private async resolveApiKey(): Promise<string | undefined> {
        // Priority 1: Check SecretStorage (secure, encrypted)
        try {
            const secretKey = await this.context.secrets.get('flowbaby.llmApiKey');
            if (secretKey) {
                debugLog('API key resolved from SecretStorage');
                return secretKey;
            }
        } catch (error) {
            this.log('DEBUG', 'Failed to read from SecretStorage', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
        
        // Priority 2: System environment variable (for CI/automated environments)
        if (process.env.LLM_API_KEY) {
            debugLog('API key resolved from system environment');
            return process.env.LLM_API_KEY;
        }
        
        debugLog('No API key found in any source');
        return undefined;
    }

    /**
     * Get LLM environment variables for bridge subprocess (Plan 028 M5/M6)
     * 
     * Returns environment variables to inject into Python bridge process
     * for API key and LLM configuration.
     * 
     * @returns Promise<Record<string, string>> - Environment variables to inject
     */
    private async getLLMEnvironment(): Promise<Record<string, string>> {
        const env: Record<string, string> = {};
        
        // Resolve and inject API key
        const apiKey = await this.resolveApiKey();
        if (apiKey) {
            env['LLM_API_KEY'] = apiKey;
        }
        
        // Plan 028 M6: Get LLM provider settings
        const config = vscode.workspace.getConfiguration('Flowbaby');
        const provider = config.get<string>('llm.provider', 'openai');
        const model = config.get<string>('llm.model', 'gpt-4o-mini');
        const endpoint = config.get<string>('llm.endpoint', '');
        
        env['LLM_PROVIDER'] = provider;
        env['LLM_MODEL'] = model;
        if (endpoint) {
            env['LLM_ENDPOINT'] = endpoint;
        }
        
        return env;
    }

    /**
     * Plan 045: Check if API key is configured
     * 
     * Public method to check API key availability without exposing the key.
     * Used by extension.ts to determine if API key prompt is needed.
     * 
     * @returns Promise<boolean> - true if API key is available
     */
    async hasApiKey(): Promise<boolean> {
        const apiKey = await this.resolveApiKey();
        return !!apiKey;
    }

    /**
     * Plan 045 Hotfix: Get cached API key state from last initialization
     * 
     * Used by extension.ts to show post-init prompt after withProgress completes.
     * Returns null if initialize() has not been called yet.
     * 
     * @returns ApiKeyState | null - cached state or null if not initialized
     */
    getApiKeyState(): ApiKeyState | null {
        return this.cachedApiKeyState;
    }

    /**
     * Clear workspace memory with soft-delete (Plan 039 M7 - F8)
     * 
     * Instead of permanent deletion, moves data to .flowbaby/.trash/{timestamp}/
     * This allows recovery of accidentally cleared memories.
     * 
     * Retention policy: Trash contents older than 7 days can be purged by user
     * 
     * @returns Promise<boolean> - true if cleared successfully
     */
    async clearMemory(): Promise<boolean> {
        const auditLogger = getAuditLogger();
        
        try {
            const flowbabyPath = path.join(this.workspacePath, '.flowbaby');
            
            if (!fs.existsSync(flowbabyPath)) {
                this.log('WARN', 'No memory to clear', { path: flowbabyPath });
                auditLogger.logMemoryClear(true, 'soft');
                return true;
            }
            
            // Plan 039 M7: Soft-delete - move to .trash instead of permanent delete
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const trashDir = path.join(flowbabyPath, '.trash');
            const trashPath = path.join(trashDir, timestamp);
            
            // Ensure trash directory exists
            if (!fs.existsSync(trashDir)) {
                fs.mkdirSync(trashDir, { recursive: true });
            }
            
            // Move data directories to trash (preserve logs and trash itself)
            const dataDirectories = ['system', 'data'];
            let movedAny = false;
            
            for (const dirName of dataDirectories) {
                const srcPath = path.join(flowbabyPath, dirName);
                if (fs.existsSync(srcPath)) {
                    const destDir = path.join(trashPath, dirName);
                    fs.mkdirSync(path.dirname(destDir), { recursive: true });
                    fs.renameSync(srcPath, destDir);
                    movedAny = true;
                    this.log('INFO', `Moved ${dirName} to trash`, { 
                        src: srcPath, 
                        dest: destDir 
                    });
                }
            }
            
            // Also move bridge metadata files (but preserve logs and trash)
            const metadataFiles = ['bridge-env.json', 'bridge-version.json', '.migration_v1_complete', '.dataset_migration_complete'];
            for (const fileName of metadataFiles) {
                const srcPath = path.join(flowbabyPath, fileName);
                if (fs.existsSync(srcPath)) {
                    const destPath = path.join(trashPath, fileName);
                    fs.mkdirSync(path.dirname(destPath), { recursive: true });
                    fs.renameSync(srcPath, destPath);
                    movedAny = true;
                }
            }
            
            if (movedAny) {
                this.log('INFO', 'Workspace memory soft-deleted', { 
                    path: flowbabyPath,
                    trashPath: trashPath,
                    note: 'Data moved to .trash - can be recovered if needed'
                });
                auditLogger.logMemoryClear(true, 'soft');
            } else {
                this.log('INFO', 'No data directories to clear', { path: flowbabyPath });
                auditLogger.logMemoryClear(true, 'soft');
            }
            
            return true;
        } catch (error) {
            this.log('ERROR', 'Failed to clear memory', {
                error: error instanceof Error ? error.message : String(error)
            });
            auditLogger.logMemoryClear(false, 'soft');
            return false;
        }
    }

    /**
     * Permanently purge trash (for users who want to free disk space)
     * 
     * @returns Promise<boolean> - true if purged successfully
     */
    async purgeTrash(): Promise<boolean> {
        try {
            const trashPath = path.join(this.workspacePath, '.flowbaby', '.trash');
            
            if (fs.existsSync(trashPath)) {
                fs.rmSync(trashPath, { recursive: true, force: true });
                this.log('INFO', 'Trash purged', { path: trashPath });
                return true;
            } else {
                this.log('INFO', 'No trash to purge', { path: trashPath });
                return true;
            }
        } catch (error) {
            this.log('ERROR', 'Failed to purge trash', {
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

    /**
     * Clamp half-life configuration to supported bounds (0.5 - 90 days)
     */
    private clampHalfLifeDays(value: number | undefined): number {
        if (value === undefined || Number.isNaN(value)) {
            return 7;
        }
        return Math.min(Math.max(value, 0.5), 90);
    }
}
