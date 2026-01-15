/**
 * Plan 107: Backup Audit Logger - Forensic Logging for Migration/Backup Events
 * 
 * This service provides always-on logging for backup-related events that:
 * - Lives in globalStorageUri (survives .flowbaby rename)
 * - Uses JSONL format (one JSON object per line) for support parsing
 * - Implements rotation/retention to bound disk usage
 * - Redacts secrets/tokens using a strict allowlist of fields
 * - Never logs memory content, prompts, or completions
 * 
 * @see Plan 107 Milestone 1: Define the always-on logging sink
 * @see REQ-8: File-based audit log for support
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Log file configuration
 */
export const BACKUP_AUDIT_LOG_FILENAME = 'backup-audit.jsonl';
export const BACKUP_AUDIT_MAX_SIZE_BYTES = 512 * 1024; // 512 KB per log file
export const BACKUP_AUDIT_MAX_ENTRIES = 1000; // Max entries to retain
export const BACKUP_AUDIT_MAX_FILES = 3; // Max rotated files to keep

/**
 * Event types for backup audit logging
 */
export enum BackupAuditEventType {
    // Migration detection events
    MIGRATION_CHECK_INVOKED = 'migration_check_invoked',
    MIGRATION_STATE_SNAPSHOT = 'migration_state_snapshot',
    MIGRATION_DETECTION_RESULT = 'migration_detection_result',
    
    // User interaction events
    BACKUP_MODAL_SHOWN = 'backup_modal_shown',
    BACKUP_USER_CONFIRMED = 'backup_user_confirmed',
    BACKUP_USER_DECLINED = 'backup_user_declined',
    BACKUP_MODAL_CLOSED = 'backup_modal_closed',
    
    // Backup execution events
    BACKUP_QUIESCE_START = 'backup_quiesce_start',
    BACKUP_QUIESCE_COMPLETE = 'backup_quiesce_complete',
    BACKUP_QUIESCE_TIMEOUT = 'backup_quiesce_timeout',
    BACKUP_QUIESCE_FAILED = 'backup_quiesce_failed',
    BACKUP_GUARD_FILE_WRITTEN = 'backup_guard_file_written',
    BACKUP_STARTED = 'backup_started',
    BACKUP_COMPLETED = 'backup_completed',
    BACKUP_FAILED = 'backup_failed',
    BACKUP_GUARD_FILE_DELETED = 'backup_guard_file_deleted',
    
    // Error states
    UNKNOWN_IO_ERROR = 'unknown_io_error',
    MARKER_READ_ERROR = 'marker_read_error',
    
    // Guard file detection
    ORPHAN_GUARD_FILE_DETECTED = 'orphan_guard_file_detected',
    
    // Initialization events
    MARKER_WRITTEN_EARLY = 'marker_written_early',
    PRE_BACKUP_REVALIDATION = 'pre_backup_revalidation'
}

/**
 * Structured audit event payload
 */
export interface BackupAuditEvent {
    /** Event type identifier */
    type: BackupAuditEventType;
    /** ISO 8601 timestamp */
    timestamp: string;
    /** VS Code session ID (unique per window) */
    windowId: string;
    /** Workspace path */
    workspacePath: string;
    /** Extension version */
    extensionVersion: string;
    /** Additional event-specific data (will be redacted) */
    data?: Record<string, unknown>;
}

/**
 * Fields that are ALLOWED in the data payload (allowlist approach)
 * All other fields will be redacted.
 */
const ALLOWED_DATA_FIELDS = new Set([
    // Filesystem state
    'flowbabyExists',
    'bridgeEnvExists',
    'bridgeEnvOwnership',
    'markerPath',
    'markerExists',
    'markerContent',
    'markerVersion',
    'currentSchemaVersion',
    
    // Decision data
    'decision',
    'decisionReason',
    'detectionState',
    'triggerContext',
    
    // Guard file
    'guardFilePath',
    'guardFileContent',
    'operationId',
    
    // Backup operation
    'sourcePath',
    'targetPath',
    'backupPath',
    'backupFolderName',
    
    // Quiescence
    'quiesceTimeoutMs',
    'daemonStopped',
    'backgroundOpsPaused',
    
    // Error info
    'errorCode',
    'errorMessage',
    
    // Timing
    'durationMs',
    
    // Revalidation
    'revalidationResult',
    'markerNowPresent'
]);

/**
 * Fields that should be completely excluded (never logged, not even as [REDACTED])
 */
const EXCLUDED_FIELDS = new Set([
    'memoryContent',
    'promptData',
    'completionData',
    'memories',
    'context',
    'conversation'
]);

/**
 * Patterns that indicate a sensitive value (even if field name is allowed)
 */
const SENSITIVE_VALUE_PATTERNS = [
    /^sk-/i,           // OpenAI keys
    /^ghp_/i,          // GitHub tokens
    /^gho_/i,          // GitHub OAuth tokens
    /^github_pat_/i,   // GitHub PAT
    /Bearer\s+/i,      // Bearer tokens
    /^eyJ/,            // JWT tokens
];

/**
 * Backup Audit Logger - Forensic logging for migration/backup events
 * 
 * Uses globalStorageUri to survive .flowbaby renames.
 * Implements JSONL format with rotation and retention limits.
 */
export class BackupAuditLogger {
    private readonly context: vscode.ExtensionContext;
    private logDir: string | null = null;
    private logFilePath: string | null = null;
    private workspaceHash: string | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Initialize the logger (creates log directory if needed)
     */
    async initialize(): Promise<void> {
        this.logDir = path.join(this.context.globalStorageUri.fsPath, 'backup-audit');
        
        // Ensure log directory exists
        await fs.promises.mkdir(this.logDir, { recursive: true });
        
        this.logFilePath = path.join(this.logDir, BACKUP_AUDIT_LOG_FILENAME);
    }

    /**
     * Initialize for a specific workspace (uses workspace path hash for partitioning)
     */
    async initializeForWorkspace(workspacePath: string): Promise<void> {
        this.workspaceHash = this.hashWorkspacePath(workspacePath);
        this.logDir = path.join(this.context.globalStorageUri.fsPath, 'backup-audit');
        
        // Ensure log directory exists
        await fs.promises.mkdir(this.logDir, { recursive: true });
        
        // Use workspace hash in filename for partitioning
        this.logFilePath = path.join(this.logDir, `backup-audit-${this.workspaceHash}.jsonl`);
    }

    /**
     * Get the current log file path
     */
    getLogPath(): string | null {
        return this.logFilePath;
    }

    /**
     * Log an audit event
     * 
     * @param event The event to log
     */
    async log(event: BackupAuditEvent): Promise<void> {
        if (!this.logFilePath) {
            console.error('[BACKUP-AUDIT] Logger not initialized');
            return;
        }

        try {
            // Apply redaction to data payload
            const redactedEvent = this.redactEvent(event);
            
            // Serialize to JSON line
            const jsonLine = JSON.stringify(redactedEvent) + '\n';
            
            // Check if rotation is needed before writing
            await this.rotateIfNeeded();
            
            // Append to log file
            await fs.promises.appendFile(this.logFilePath, jsonLine, 'utf8');
            
            // Also log to console for extension-host logs (REQ-6)
            console.log(`[BACKUP-AUDIT] ${event.type}`, redactedEvent);
            
        } catch (error) {
            // Log errors should not crash the extension
            console.error('[BACKUP-AUDIT] Failed to write log', error);
        }
    }

    /**
     * Count total entries across all log files
     */
    async countTotalEntries(): Promise<number> {
        if (!this.logDir) {
            return 0;
        }

        try {
            const files = await fs.promises.readdir(this.logDir);
            let total = 0;
            
            for (const file of files) {
                if (file.endsWith('.jsonl')) {
                    const filePath = path.join(this.logDir, file);
                    const content = await fs.promises.readFile(filePath, 'utf8');
                    total += content.trim().split('\n').filter(line => line.length > 0).length;
                }
            }
            
            return total;
        } catch {
            return 0;
        }
    }

    /**
     * Rotate log file if it exceeds size limit
     */
    private async rotateIfNeeded(): Promise<void> {
        if (!this.logFilePath || !this.logDir) {
            return;
        }

        try {
            // Check if current log file exists and its size
            let stats: fs.Stats;
            try {
                stats = await fs.promises.stat(this.logFilePath);
            } catch {
                // File doesn't exist yet, no rotation needed
                return;
            }

            if (stats.size < BACKUP_AUDIT_MAX_SIZE_BYTES) {
                return; // No rotation needed
            }

            // Rotate: rename current log to timestamped backup
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const baseName = path.basename(this.logFilePath, '.jsonl');
            const rotatedName = `${baseName}.${timestamp}.jsonl`;
            const rotatedPath = path.join(this.logDir, rotatedName);
            
            await fs.promises.rename(this.logFilePath, rotatedPath);
            
            // Clean up old rotated files (keep only MAX_FILES)
            await this.cleanupOldLogs();
            
        } catch (error) {
            console.error('[BACKUP-AUDIT] Rotation failed', error);
        }
    }

    /**
     * Clean up old rotated log files, keeping only the most recent ones
     */
    private async cleanupOldLogs(): Promise<void> {
        if (!this.logDir) {
            return;
        }

        try {
            const files = await fs.promises.readdir(this.logDir);
            const logFiles = files
                .filter(f => f.endsWith('.jsonl') && f !== BACKUP_AUDIT_LOG_FILENAME)
                .map(f => ({
                    name: f,
                    path: path.join(this.logDir!, f)
                }));

            // Sort by modification time (newest first)
            const withStats = await Promise.all(
                logFiles.map(async f => {
                    try {
                        const stats = await fs.promises.stat(f.path);
                        return { ...f, mtime: stats.mtime.getTime() };
                    } catch {
                        return { ...f, mtime: 0 };
                    }
                })
            );
            
            withStats.sort((a, b) => b.mtime - a.mtime);
            
            // Delete files beyond the limit
            const toDelete = withStats.slice(BACKUP_AUDIT_MAX_FILES);
            for (const file of toDelete) {
                try {
                    await fs.promises.unlink(file.path);
                } catch {
                    // Ignore deletion errors
                }
            }
            
        } catch (error) {
            console.error('[BACKUP-AUDIT] Cleanup failed', error);
        }
    }

    /**
     * Redact sensitive data from event
     */
    private redactEvent(event: BackupAuditEvent): BackupAuditEvent {
        const redacted = { ...event };
        
        if (event.data) {
            redacted.data = this.redactData(event.data);
        }
        
        return redacted;
    }

    /**
     * Redact sensitive fields from data payload
     */
    private redactData(data: Record<string, unknown>): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        
        for (const [key, value] of Object.entries(data)) {
            // Completely exclude certain fields
            if (EXCLUDED_FIELDS.has(key)) {
                continue;
            }
            
            // Check if field is in allowlist
            if (!ALLOWED_DATA_FIELDS.has(key)) {
                result[key] = '[REDACTED]';
                continue;
            }
            
            // Check if value looks sensitive
            if (typeof value === 'string' && this.isSensitiveValue(value)) {
                result[key] = '[REDACTED]';
                continue;
            }
            
            // Recursively handle nested objects
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                result[key] = this.redactData(value as Record<string, unknown>);
                continue;
            }
            
            // Value is allowed
            result[key] = value;
        }
        
        return result;
    }

    /**
     * Check if a value appears to be sensitive (API key, token, etc.)
     */
    private isSensitiveValue(value: string): boolean {
        return SENSITIVE_VALUE_PATTERNS.some(pattern => pattern.test(value));
    }

    /**
     * Hash workspace path for partitioning (short, filesystem-safe)
     */
    private hashWorkspacePath(workspacePath: string): string {
        return crypto.createHash('sha256')
            .update(workspacePath)
            .digest('hex')
            .substring(0, 12);
    }
}
