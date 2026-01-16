/**
 * Plan 108 Milestone 4: DiagnoseEnvironmentService
 * 
 * Provides a shareable diagnostic report of the Flowbaby environment.
 * Called by the "Flowbaby: Diagnose Environment" command.
 */

import * as path from 'path';
import * as fs from 'fs';
import { PreflightVerificationService, PreflightStatus, PreflightResult } from './PreflightVerificationService';
import { InterpreterSelectionService, InterpreterSelectionResult, InterpreterSelectionReason } from './InterpreterSelectionService';
import { debugLog } from '../outputChannels';

/**
 * Diagnostic report structure
 */
export interface DiagnoseReport {
    /** Whether the environment is healthy */
    healthy: boolean;
    /** Markdown-formatted report for display */
    markdown: string;
    /** Structured data for programmatic access */
    data: {
        workspacePath: string;
        interpreter: InterpreterSelectionResult;
        preflight: PreflightResult;
        timestamp: string;
    };
}

/**
 * Plan 108 Milestone 4: Diagnostic report generator
 * 
 * Collects environment details and generates a shareable report.
 */
export class DiagnoseEnvironmentService {
    private readonly workspacePath: string;
    private readonly bridgePath: string;
    private readonly interpreterService: InterpreterSelectionService;
    private readonly preflightService: PreflightVerificationService;

    constructor(
        workspacePath: string,
        bridgePath: string,
        interpreterService: InterpreterSelectionService,
        preflightService: PreflightVerificationService
    ) {
        this.workspacePath = workspacePath;
        this.bridgePath = bridgePath;
        this.interpreterService = interpreterService;
        this.preflightService = preflightService;
    }

    /**
     * Generate a diagnostic report for the current environment.
     */
    async generateReport(): Promise<DiagnoseReport> {
        debugLog('DiagnoseEnvironmentService: generating report');
        
        // Get interpreter selection
        const interpreter = await this.interpreterService.selectInterpreter();
        
        // Run preflight verification (bypasses cache for fresh check)
        this.preflightService.invalidateCache();
        const preflight = await this.preflightService.verify();
        
        const healthy = preflight.status === PreflightStatus.HEALTHY;
        const timestamp = new Date().toISOString();
        
        // Generate markdown report
        const markdown = this.formatMarkdown(interpreter, preflight, healthy, timestamp);
        
        return {
            healthy,
            markdown,
            data: {
                workspacePath: this.workspacePath,
                interpreter,
                preflight,
                timestamp
            }
        };
    }

    /**
     * Format the diagnostic report as markdown.
     */
    private formatMarkdown(
        interpreter: InterpreterSelectionResult,
        preflight: PreflightResult,
        healthy: boolean,
        timestamp: string
    ): string {
        const statusIcon = healthy ? '✅' : '❌';
        const statusText = healthy ? 'Healthy' : 'Issues Detected';
        
        const lines: string[] = [
            '# Flowbaby Environment Diagnostics',
            '',
            `**Generated:** ${timestamp}`,
            `**Workspace:** ${this.workspacePath}`,
            '',
            '## Summary',
            '',
            `${statusIcon} **Status:** ${statusText}`,
            '',
            '---',
            '',
            '## Interpreter Selection',
            '',
            `| Property | Value |`,
            `|----------|-------|`,
            `| Python Path | \`${interpreter.pythonPath}\` |`,
            `| Selection Reason | ${this.formatReason(interpreter.reason)} |`,
            `| Metadata Exists | ${interpreter.metadataExists ? 'Yes' : 'No'} |`,
            `| Ownership | ${interpreter.ownership ?? 'Unknown'} |`,
            `| Requirements Hash | ${interpreter.requirementsHash ?? 'N/A'} |`,
            '',
            '---',
            '',
            '## Preflight Verification',
            '',
            `| Property | Value |`,
            `|----------|-------|`,
            `| Status | ${this.formatPreflightStatus(preflight.status)} |`,
            `| cognee Importable | ${preflight.cogneeImportable ? '✅ Yes' : '❌ No'} |`,
            `| cognee Version | ${preflight.cogneeVersion ?? 'N/A'} |`,
            `| Verification Duration | ${preflight.durationMs}ms |`,
            `| Result Cached | ${preflight.cached ? 'Yes' : 'No'} |`,
        ];
        
        // Add error details if present
        if (preflight.error) {
            lines.push('');
            lines.push('### Error Details');
            lines.push('');
            lines.push('```');
            lines.push(preflight.error);
            lines.push('```');
        }
        
        // Add recommended actions if not healthy
        if (!healthy && preflight.remediation) {
            lines.push('');
            lines.push('---');
            lines.push('');
            lines.push('## Recommended Actions');
            lines.push('');
            lines.push(`**${preflight.remediation.message}**`);
            if (preflight.remediation.commandId) {
                lines.push('');
                lines.push(`Run command: \`${preflight.remediation.commandId}\``);
            }
        }
        
        // Add technical details
        lines.push('');
        lines.push('---');
        lines.push('');
        lines.push('## Technical Details');
        lines.push('');
        lines.push('```json');
        lines.push(JSON.stringify({
            interpreter: {
                pythonPath: interpreter.pythonPath,
                reason: interpreter.reason,
                metadataExists: interpreter.metadataExists,
                ownership: interpreter.ownership
            },
            preflight: {
                status: preflight.status,
                cogneeImportable: preflight.cogneeImportable,
                cogneeVersion: preflight.cogneeVersion,
                durationMs: preflight.durationMs
            }
        }, null, 2));
        lines.push('```');
        
        return lines.join('\n');
    }

    /**
     * Format interpreter selection reason as human-readable text.
     */
    private formatReason(reason: InterpreterSelectionReason): string {
        switch (reason) {
            case InterpreterSelectionReason.METADATA:
                return 'From bridge-env.json metadata (recommended)';
            case InterpreterSelectionReason.MANAGED_VENV_HEURISTIC:
                return 'From .flowbaby/venv (managed environment)';
            case InterpreterSelectionReason.EXPLICIT_CONFIG:
                return 'From Flowbaby.pythonPath setting';
            case InterpreterSelectionReason.SYSTEM_FALLBACK:
                return 'System Python (fallback)';
            default:
                return String(reason);
        }
    }

    /**
     * Format preflight status with icon.
     */
    private formatPreflightStatus(status: PreflightStatus): string {
        switch (status) {
            case PreflightStatus.HEALTHY:
                return '✅ Healthy';
            case PreflightStatus.COGNEE_MISSING:
                return '❌ cognee module not found';
            case PreflightStatus.INTERPRETER_NOT_RUNNABLE:
                return '❌ Python interpreter not runnable';
            case PreflightStatus.IN_PROGRESS:
                return '⏳ In Progress';
            default:
                return String(status);
        }
    }
}
