/**
 * Language Model Tool for Cognee Memory Storage (Plan 015)
 * 
 * Implements VS Code's LanguageModelTool interface to allow Copilot agents
 * to store conversation summaries in Cognee knowledge graph.
 * 
 * Tool registration and authorization (Plan 016.1):
 * - Registered unconditionally at extension activation
 * - Authorization controlled by VS Code Configure Tools UI
 * - All invocations logged to audit trail
 */

import * as vscode from 'vscode';

export interface StoreMemoryToolInput {
    topic: string;
    context: string;
    decisions?: string[];
    rationale?: string[];
    openQuestions?: string[];
    nextSteps?: string[];
    references?: string[];
    metadata?: {
        plan_id?: string;
        session_id?: string;
        status?: 'Active' | 'Superseded' | 'DecisionRecord';
    };
}

export class StoreMemoryTool implements vscode.LanguageModelTool<StoreMemoryToolInput> {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Invoked when Copilot agent calls recallflow_storeMemory tool
     */
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<StoreMemoryToolInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const startTime = Date.now();
        
        this.outputChannel.appendLine(
            `[Tool Invocation] ${new Date().toISOString()} - recallflow_storeMemory called`
        );
        this.outputChannel.appendLine(`  Topic: ${options.input.topic}`);
        this.outputChannel.appendLine(`  Context length: ${options.input.context.length} chars`);

        try {
            // Plan 016.1: No access check needed - Configure Tools is sole opt-in
            // If this tool is invoked, user has enabled it via Configure Tools UI
            
            // Prepare payload for cogneeMemory.ingestForAgent command
            const payload = {
                topic: options.input.topic,
                context: options.input.context,
                decisions: options.input.decisions || [],
                rationale: options.input.rationale || [],
                openQuestions: options.input.openQuestions || [],
                nextSteps: options.input.nextSteps || [],
                references: options.input.references || [],
                metadata: options.input.metadata || {},
                agentName: 'Copilot (via languageModelTool)'
            };

            // Invoke internal command (now async)
            const responseJson = await vscode.commands.executeCommand<string>(
                'cogneeMemory.ingestForAgent',
                JSON.stringify(payload)
            );

            const duration = Date.now() - startTime;
            this.outputChannel.appendLine(`  ✅ Memory staged in ${duration}ms`);

            // Parse and return response
            const response = JSON.parse(responseJson || '{"success":false,"error":"No response"}');
            
            // Return staged messaging per Plan 017 architecture
            if (response.success && response.staged) {
                this.outputChannel.appendLine(`  📝 Operation ID: ${response.operationId}`);
                this.outputChannel.appendLine(`  ⏳ Background processing started`);
                
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify({
                        success: true,
                        operationId: response.operationId,
                        staged: true,
                        message: "Memory staged – processing will finish in ~1–2 minutes. You'll get a notification when it's done.",
                        duration_ms: duration
                    }))
                ]);
            }
            
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(JSON.stringify({
                    success: response.success,
                    error: response.error,
                    errorCode: response.errorCode || 'INGESTION_ERROR',
                    duration_ms: duration
                }))
            ]);

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg = error instanceof Error ? error.message : String(error);
            
            this.outputChannel.appendLine(`  ❌ Error after ${duration}ms: ${errorMsg}`);

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(JSON.stringify({
                    success: false,
                    error: errorMsg,
                    errorCode: 'TOOL_INVOCATION_ERROR'
                }))
            ]);
        }
    }

    /**
     * Optional: Prepare tool invocation (validation, parameter transformation)
     */
    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<StoreMemoryToolInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        // Validate required fields
        if (!options.input.topic || !options.input.context) {
            throw new Error('Tool invocation requires both "topic" and "context" fields');
        }

        // Return prepared invocation (can transform input if needed)
        return {
            invocationMessage: `Storing memory: ${options.input.topic}`
        };
    }
}
