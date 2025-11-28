/**
 * Audit Logger for Security-Relevant Events (Plan 039 M6 - F7)
 * 
 * Implements JSON-lines structured logging for security audit trail.
 * Events are logged to workspace-local .flowbaby/logs/audit.jsonl file.
 * 
 * Security Events Logged:
 * - API key changes (set, clear, rotate)
 * - Memory clear operations
 * - Environment initialization
 * - Authentication failures
 * - Configuration changes
 */

import * as fs from 'fs';
import * as path from 'path';
import { debugLog } from '../outputChannels';

/**
 * Audit event severity levels
 */
export type AuditSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

/**
 * Audit event categories
 */
export type AuditCategory = 
    | 'API_KEY'       // API key operations
    | 'MEMORY'        // Memory operations (clear, delete)
    | 'ENVIRONMENT'   // Environment setup/tear down
    | 'AUTH'          // Authentication events
    | 'CONFIG'        // Configuration changes
    | 'SECURITY';     // General security events

/**
 * Structured audit event payload
 */
export interface AuditEvent {
    timestamp: string;           // ISO 8601 timestamp
    severity: AuditSeverity;     // Event severity
    category: AuditCategory;     // Event category
    event: string;               // Event name (e.g., 'api_key_set')
    success: boolean;            // Whether operation succeeded
    details?: Record<string, unknown>; // Additional context (sanitized)
    workspacePath?: string;      // Workspace path (if applicable)
    userId?: string;             // User identifier (if available)
}

/**
 * Singleton Audit Logger for security event tracking
 */
export class AuditLogger {
    private static instance: AuditLogger | null = null;
    private workspacePath: string | null = null;
    private logFilePath: string | null = null;

    private constructor() {
        // Private constructor for singleton pattern
    }

    /**
     * Get or create singleton instance
     */
    public static getInstance(): AuditLogger {
        if (!AuditLogger.instance) {
            AuditLogger.instance = new AuditLogger();
        }
        return AuditLogger.instance;
    }

    /**
     * Initialize logger for a specific workspace
     * @param workspacePath Absolute path to workspace root
     */
    public initialize(workspacePath: string): void {
        this.workspacePath = workspacePath;
        
        // Create logs directory if needed
        const logsDir = path.join(workspacePath, '.flowbaby', 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        
        this.logFilePath = path.join(logsDir, 'audit.jsonl');
        debugLog('AuditLogger initialized', { logFilePath: this.logFilePath });
    }

    /**
     * Log an audit event
     * @param severity Event severity level
     * @param category Event category
     * @param event Event name/identifier
     * @param success Whether the operation succeeded
     * @param details Additional context (will be sanitized)
     */
    public log(
        severity: AuditSeverity,
        category: AuditCategory,
        event: string,
        success: boolean,
        details?: Record<string, unknown>
    ): void {
        const auditEvent: AuditEvent = {
            timestamp: new Date().toISOString(),
            severity,
            category,
            event,
            success,
            details: this.sanitizeDetails(details),
            workspacePath: this.workspacePath ?? undefined
        };

        this.writeEvent(auditEvent);
    }

    /**
     * Log API key set event
     */
    public logApiKeySet(success: boolean, source?: string): void {
        this.log('INFO', 'API_KEY', 'api_key_set', success, {
            source: source ?? 'command'
        });
    }

    /**
     * Log API key clear event
     */
    public logApiKeyClear(success: boolean): void {
        this.log('INFO', 'API_KEY', 'api_key_clear', success);
    }

    /**
     * Log memory clear event
     */
    public logMemoryClear(success: boolean, method?: 'hard' | 'soft'): void {
        this.log('WARN', 'MEMORY', 'memory_clear', success, {
            method: method ?? 'hard',
            note: method === 'soft' ? 'Moved to .flowbaby/.trash' : 'Permanently deleted'
        });
    }

    /**
     * Log environment initialization event
     */
    public logEnvironmentInit(success: boolean, details?: Record<string, unknown>): void {
        this.log('INFO', 'ENVIRONMENT', 'environment_init', success, details);
    }

    /**
     * Log environment repair event
     */
    public logEnvironmentRepair(success: boolean, reason?: string): void {
        this.log('WARN', 'ENVIRONMENT', 'environment_repair', success, {
            reason
        });
    }

    /**
     * Log authentication failure
     */
    public logAuthFailure(reason: string): void {
        this.log('ERROR', 'AUTH', 'auth_failure', false, {
            reason
        });
    }

    /**
     * Log configuration change
     */
    public logConfigChange(setting: string, success: boolean): void {
        this.log('INFO', 'CONFIG', 'config_change', success, {
            setting
        });
    }

    /**
     * Sanitize details object to prevent sensitive data leakage
     * - Redacts API keys, tokens, passwords
     * - Truncates long values
     */
    private sanitizeDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
        if (!details) {
            return undefined;
        }

        const sanitized: Record<string, unknown> = {};
        const sensitivePatterns = [
            /api[_-]?key/i,
            /secret/i,
            /password/i,
            /token/i,
            /bearer/i,
            /authorization/i
        ];

        for (const [key, value] of Object.entries(details)) {
            // Check if key is sensitive
            const isSensitiveKey = sensitivePatterns.some(pattern => pattern.test(key));
            
            if (isSensitiveKey) {
                sanitized[key] = '[REDACTED]';
            } else if (typeof value === 'string' && value.length > 200) {
                sanitized[key] = value.substring(0, 200) + '...[truncated]';
            } else if (typeof value === 'string') {
                // Redact potential secrets in values
                let sanitizedValue = value;
                
                // Redact OpenAI-style keys
                sanitizedValue = sanitizedValue.replace(
                    /sk-[A-Za-z0-9]{32,}/g,
                    'sk-***'
                );
                
                // Redact long hex strings (potential tokens)
                sanitizedValue = sanitizedValue.replace(
                    /\b[0-9a-fA-F]{32,}\b/g,
                    '[REDACTED_TOKEN]'
                );
                
                sanitized[key] = sanitizedValue;
            } else {
                sanitized[key] = value;
            }
        }

        return sanitized;
    }

    /**
     * Write event to audit log file
     */
    private writeEvent(event: AuditEvent): void {
        if (!this.logFilePath) {
            debugLog('AuditLogger not initialized, skipping event', { event: event.event });
            return;
        }

        try {
            const line = JSON.stringify(event) + '\n';
            fs.appendFileSync(this.logFilePath, line, 'utf8');
            debugLog('Audit event logged', { event: event.event, category: event.category });
        } catch (error) {
            // Don't throw - audit logging should not break functionality
            debugLog('Failed to write audit event', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get recent audit events (for debugging/diagnostics)
     * @param limit Maximum number of events to return
     * @returns Array of recent audit events
     */
    public getRecentEvents(limit: number = 50): AuditEvent[] {
        if (!this.logFilePath || !fs.existsSync(this.logFilePath)) {
            return [];
        }

        try {
            const content = fs.readFileSync(this.logFilePath, 'utf8');
            const lines = content.trim().split('\n').filter(line => line.length > 0);
            const events: AuditEvent[] = [];

            // Read from end (most recent first)
            for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
                try {
                    events.push(JSON.parse(lines[i]));
                } catch {
                    // Skip malformed lines
                }
            }

            return events;
        } catch (error) {
            debugLog('Failed to read audit events', {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }
}

// Export singleton getter for convenience
export function getAuditLogger(): AuditLogger {
    return AuditLogger.getInstance();
}
