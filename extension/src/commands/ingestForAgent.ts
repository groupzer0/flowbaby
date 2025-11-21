/**
 * Agent Ingestion Command Handler (Plan 015 Milestone 2)
 * 
 * Implements `cogneeMemory.ingestForAgent` command for agent-driven memory writes.
 * Validates payloads, enforces access control, and provides audit logging.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
    CogneeIngestRequest,
    CogneeIngestResponse
} from '../types/agentIntegration';
import { validateIngestRequest } from '../validation/summaryValidator';
import { CogneeClient } from '../cogneeClient';

/**
 * Register the agent ingestion command
 * 
 * @param context VS Code extension context
 * @param cogneeClient CogneeClient instance for bridge communication
 * @param outputChannel Output channel for agent activity logging
 */
export function registerIngestForAgentCommand(
    context: vscode.ExtensionContext,
    cogneeClient: CogneeClient,
    outputChannel: vscode.OutputChannel
): void {
    const command = vscode.commands.registerCommand(
        'cogneeMemory.ingestForAgent',
        async (requestJson: string): Promise<string> => {
            return await handleIngestForAgent(requestJson, cogneeClient, outputChannel, context);
        }
    );

    context.subscriptions.push(command);
}

/**
 * Handle agent ingestion command
 * 
 * @param requestJson JSON string containing CogneeIngestRequest
 * @param cogneeClient CogneeClient instance
 * @param outputChannel Output channel for logging
 * @param context Extension context
 * @returns JSON string containing CogneeIngestResponse
 */
export async function handleIngestForAgent(
    requestJson: string,
    cogneeClient: CogneeClient,
    outputChannel: vscode.OutputChannel,
    context: vscode.ExtensionContext
): Promise<string> {
    const startTime = Date.now();
    
    try {
        // Step 1: Parse JSON request
        let request: CogneeIngestRequest;
        try {
            const parsed = JSON.parse(requestJson);
            request = parsed as CogneeIngestRequest;
        } catch (error) {
            const response: CogneeIngestResponse = {
                success: false,
                error: 'Invalid JSON in request payload',
                errorCode: 'INVALID_JSON'
            };
            return JSON.stringify(response);
        }

        // Step 2: Validate schema
        const validation = validateIngestRequest(request);
        if (!validation.valid) {
            const response: CogneeIngestResponse = {
                success: false,
                error: `Payload validation failed: ${validation.errors.join('; ')}`,
                errorCode: 'INVALID_PAYLOAD'
            };
            
            outputChannel.appendLine(
                `[Agent Ingest] ${new Date().toISOString()} - Validation failed: ${validation.errors.join('; ')}`
            );
            
            return JSON.stringify(response);
        }

        // Step 3: Access control (Plan 016.1 - Configure Tools is sole opt-in)
        // Commands proxy tool invocations; if tool is disabled in Configure Tools,
        // VS Code won't invoke the tool so this command won't be called
        // No additional access check needed
        
        // Step 4: Generate missing metadata fields (supports minimal payloads)
        // If metadata is completely missing, generate defaults
        if (!request.metadata) {
            request.metadata = {
                topicId: generateTopicId(request.topic),
                status: 'Active',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
        }
        
        const topicId = request.metadata.topicId || generateTopicId(request.topic);
        const sessionId = request.metadata.sessionId || null;
        const planId = request.metadata.planId || null;
        const status = request.metadata.status || 'Active';
        const now = new Date().toISOString();
        const createdAt = request.metadata.createdAt || now;
        const updatedAt = request.metadata.updatedAt || now;

        // Step 5: Call bridge via CogneeClient (async mode per Plan 017)
        outputChannel.appendLine(
            `[Agent Ingest] ${new Date().toISOString()} - Agent: ${request.agentName || 'Unknown'} - Topic: ${request.topic} - Status: staging...`
        );

        try {
            // Get BackgroundOperationManager instance
            const { BackgroundOperationManager } = await import('../background/BackgroundOperationManager');
            const manager = BackgroundOperationManager.getInstance();
            
            const result = await cogneeClient.ingestSummaryAsync({
                topic: request.topic,
                context: request.context,
                decisions: request.decisions || [],
                rationale: request.rationale || [],
                openQuestions: request.openQuestions || [],
                nextSteps: request.nextSteps || [],
                references: request.references || [],
                timeScope: request.timeScope || '',
                topicId,
                sessionId,
                planId,
                status: status as 'Active' | 'Superseded' | 'Draft',
                createdAt: new Date(createdAt),
                updatedAt: new Date(updatedAt)
            }, manager);

            const duration = Date.now() - startTime;

            if (result.success && result.staged) {
                // Step 6: Build staged response per Plan 017
                const response: CogneeIngestResponse = {
                    success: true,
                    staged: true,
                    operationId: result.operationId,
                    ingested_chars: request.topic.length + request.context.length +
                        (request.decisions || []).join('').length +
                        (request.rationale || []).join('').length +
                        (request.openQuestions || []).join('').length +
                        (request.nextSteps || []).join('').length +
                        (request.references || []).join('').length,
                    timestamp: createdAt,
                    metadata: {
                        topic_id: topicId,
                        session_id: sessionId || undefined,
                        plan_id: planId || undefined,
                        status,
                        created_at: createdAt,
                        updated_at: updatedAt
                    },
                    staging_duration_sec: duration / 1000
                };

                outputChannel.appendLine(
                    `[Agent Ingest] ${new Date().toISOString()} - Agent: ${request.agentName || 'Unknown'} - Topic: ${request.topic} - Status: staged - Operation ID: ${result.operationId} - Duration: ${(duration / 1000).toFixed(2)}s`
                );

                // Log staging success to audit file
                await logAuditEntry(context, {
                    timestamp: new Date().toISOString(),
                    command: 'ingestForAgent',
                    agentName: request.agentName || 'Unknown',
                    topicDigest: hashTopicId(topicId),
                    result: 'staged',
                    errorCode: null,
                    durationMs: duration
                });

                return JSON.stringify(response);
            } else {
                // Staging failed
                const response: CogneeIngestResponse = {
                    success: false,
                    error: result.error || 'Staging failed - check Output channel for details',
                    errorCode: 'COGNEE_ERROR'
                };

                outputChannel.appendLine(
                    `[Agent Ingest] ${new Date().toISOString()} - Agent: ${request.agentName || 'Unknown'} - Topic: ${request.topic} - Status: failed`
                );

                await logAuditEntry(context, {
                    timestamp: new Date().toISOString(),
                    command: 'ingestForAgent',
                    agentName: request.agentName || 'Unknown',
                    topicDigest: hashTopicId(topicId),
                    result: 'error',
                    errorCode: 'COGNEE_ERROR',
                    durationMs: duration
                });

                return JSON.stringify(response);
            }
        } catch (error) {
            // Bridge threw exception
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isTimeout = /timeout/i.test(errorMessage);
            const errorCode = isTimeout ? 'BRIDGE_TIMEOUT' : 'COGNEE_ERROR';

            const response: CogneeIngestResponse = {
                success: false,
                error: errorMessage,
                errorCode
            };

            outputChannel.appendLine(
                `[Agent Ingest] ${new Date().toISOString()} - Agent: ${request.agentName || 'Unknown'} - Topic: ${request.topic} - Status: error - ${errorMessage}`
            );

            await logAuditEntry(context, {
                timestamp: new Date().toISOString(),
                command: 'ingestForAgent',
                agentName: request.agentName || 'Unknown',
                topicDigest: hashTopicId(request.metadata.topicId),
                result: 'error',
                errorCode,
                durationMs: duration
            });

            return JSON.stringify(response);
        }
    } catch (error) {
        // Outer exception (JSON parsing, validation, etc.)
        const errorMessage = error instanceof Error ? error.message : String(error);
        const response: CogneeIngestResponse = {
            success: false,
            error: `Unexpected error: ${errorMessage}`,
            errorCode: 'INTERNAL_ERROR'
        };

        outputChannel.appendLine(
            `[Agent Ingest] ${new Date().toISOString()} - Unexpected error: ${errorMessage}`
        );

        return JSON.stringify(response);
    }
}

/**
 * Generate a topic ID from topic text
 * 
 * Uses SHA-256 hash of topic + timestamp for uniqueness
 * 
 * @param topic Topic text
 * @returns Generated topic ID (16-char hex string)
 */
function generateTopicId(topic: string): string {
    const timestamp = new Date().toISOString();
    const hash = crypto.createHash('sha256')
        .update(`${topic}-${timestamp}`)
        .digest('hex');
    return hash.substring(0, 16);
}

/**
 * Hash topic ID for privacy in audit logs
 * 
 * Uses first 8 characters of SHA-256 hash
 * 
 * @param topicId Topic ID to hash
 * @returns Topic ID digest (8-char hex string)
 */
function hashTopicId(topicId: string): string {
    const hash = crypto.createHash('sha256')
        .update(topicId)
        .digest('hex');
    return hash.substring(0, 8);
}

/**
 * Log audit entry to .cognee/agent_audit.log
 * 
 * @param context Extension context
 * @param entry Audit log entry
 */
export async function logAuditEntry(
    context: vscode.ExtensionContext,
    entry: {
        timestamp: string;
        command: string;
        agentName: string;
        topicDigest: string;
        result: string;
        errorCode: string | null;
        durationMs?: number;
    }
): Promise<void> {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const cogneeDir = path.join(workspaceFolder.uri.fsPath, '.cognee');
        const auditLogPath = path.join(cogneeDir, 'agent_audit.log');

        // Ensure .cognee directory exists
        if (!fs.existsSync(cogneeDir)) {
            fs.mkdirSync(cogneeDir, { recursive: true });
        }

        // Append audit entry as JSON line
        const logLine = JSON.stringify(entry) + '\n';
        fs.appendFileSync(auditLogPath, logLine, 'utf8');
    } catch (error) {
        // Audit logging failure should not break ingestion
        console.error('Failed to log audit entry:', error);
    }
}
