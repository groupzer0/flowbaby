/**
 * Language Model Tool for Cognee Memory Storage (Plan 015)
 * 
 * Implements VS Code's LanguageModelTool interface to allow Copilot agents
 * to store conversation summaries in Cognee knowledge graph.
 * 
 * Tool registration follows opt-in lifecycle:
 * - Registered when cogneeMemory.agentAccess.enabled = true
 * - Unregistered when setting disabled
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
     * Invoked when Copilot agent calls cognee_storeMemory tool
     */
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<StoreMemoryToolInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const startTime = Date.now();
        
        this.outputChannel.appendLine(
            `[Tool Invocation] ${new Date().toISOString()} - cognee_storeMemory called`
        );
        this.outputChannel.appendLine(`  Topic: ${options.input.topic}`);
        this.outputChannel.appendLine(`  Context length: ${options.input.context.length} chars`);

        try {
            // Check if agent access is enabled
            const config = vscode.workspace.getConfiguration('cogneeMemory');
            const agentAccessEnabled = config.get<boolean>('agentAccess.enabled', false);

            if (!agentAccessEnabled) {
                const errorMsg = 'Agent access is disabled. Enable cogneeMemory.agentAccess.enabled setting.';
                this.outputChannel.appendLine(`  ❌ BLOCKED: ${errorMsg}`);
                
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify({
                        success: false,
                        error: errorMsg,
                        errorCode: 'ACCESS_DISABLED'
                    }))
                ]);
            }

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

            // Invoke internal command
            const responseJson = await vscode.commands.executeCommand<string>(
                'cogneeMemory.ingestForAgent',
                JSON.stringify(payload)
            );

            const duration = Date.now() - startTime;
            this.outputChannel.appendLine(`  ✅ Ingestion completed in ${duration}ms`);

            // Parse and return response
            const response = JSON.parse(responseJson || '{"success":false,"error":"No response"}');
            
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(JSON.stringify({
                    success: response.success,
                    summary_id: response.summary_id,
                    ingested_chars: response.ingested_chars,
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
