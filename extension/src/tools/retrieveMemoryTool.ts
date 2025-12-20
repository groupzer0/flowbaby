/**
 * Language Model Tool for Flowbaby Retrieval (Plan 016)
 * 
 * Implements VS Code's LanguageModelTool interface to allow Copilot agents
 * to retrieve structured conversation summaries from Flowbaby knowledge graph.
 * 
 * Tool registration and authorization (Plan 016.1):
 * - Registered unconditionally at extension activation
 * - Authorization controlled by VS Code Configure Tools UI
 * - All invocations logged to audit trail
 * 
 * Architecture:
 * - Routes through singleton FlowbabyContextProvider (NOT via command)
 * - Returns BOTH narrative markdown AND verbatim JSON for agent parsing
 * - Enforces concurrency and rate limits via provider
 */

import * as vscode from 'vscode';
import { FlowbabyContextProvider } from '../flowbabyContextProvider';
import { FlowbabyContextRequest, FlowbabyContextResponse, AgentErrorResponse } from '../types/agentIntegration';
import { MEMORY_CONTEXT_INSTRUCTIONS } from '../shared/promptFragments';

export interface RetrieveMemoryToolInput {
    query: string;
    maxResults?: number;
}

export class RetrieveMemoryTool implements vscode.LanguageModelTool<RetrieveMemoryToolInput> {
    private outputChannel: vscode.OutputChannel;
    private provider: FlowbabyContextProvider;

    constructor(provider: FlowbabyContextProvider, outputChannel: vscode.OutputChannel) {
        this.provider = provider;
        this.outputChannel = outputChannel;
    }

    /**
     * Invoked when Copilot agent calls flowbaby_retrieveMemory tool
     */
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<RetrieveMemoryToolInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const startTime = Date.now();
        
        this.outputChannel.appendLine(
            `[Tool Invocation] ${new Date().toISOString()} - flowbaby_retrieveMemory called`
        );
        this.outputChannel.appendLine(`  Query: "${options.input.query.substring(0, 100)}${options.input.query.length > 100 ? '...' : ''}"`);
        this.outputChannel.appendLine(`  Max Results: ${options.input.maxResults || 3}`);

        try {
            // Plan 016.1: No access check needed - Configure Tools is sole opt-in
            // If this tool is invoked, user has enabled it via Configure Tools UI
            
            // Prepare retrieval request
            const request: FlowbabyContextRequest = {
                query: options.input.query,
                maxResults: options.input.maxResults || 3
            };

            // Call FlowbabyContextProvider directly (NOT via command)
            // This leverages shared concurrency/rate limiting without duplication
            const response = await this.provider.retrieveContext(request);

            const duration = Date.now() - startTime;

            // Check if response is an error
            if ('error' in response) {
                const errorResponse = response as AgentErrorResponse;
                this.outputChannel.appendLine(`  ❌ Retrieval failed after ${duration}ms: ${errorResponse.message}`);
                
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify({
                        success: false,
                        error: errorResponse.message,
                        errorCode: errorResponse.error,
                        details: errorResponse.details
                    }))
                ]);
            }

            // Success - format response with BOTH narrative and structured JSON
            const successResponse = response as FlowbabyContextResponse;
            
            this.outputChannel.appendLine(
                `  ✅ Retrieval completed in ${duration}ms ` +
                `(results: ${successResponse.entries.length}, tokens: ${successResponse.tokensUsed})`
            );

            // Build narrative markdown summary
            // Plan 063: Prepend MEMORY_CONTEXT_INSTRUCTIONS to frame retrieved memories
            // as supplementary and subordinate to current code/docs
            let narrative = MEMORY_CONTEXT_INSTRUCTIONS;
            narrative += `# Retrieved Memories (${successResponse.entries.length} results)\n\n`;
            
            if (successResponse.entries.length === 0) {
                narrative += 'No memories found matching your query. Try different search terms or check if memories have been stored.\n\n';
            } else {
                successResponse.entries.forEach((entry, idx) => {
                    narrative += `## ${idx + 1}. ${entry.topic || 'Untitled Memory'}\n\n`;
                    narrative += `${entry.summaryText}\n\n`;
                    
                    if (entry.decisions && entry.decisions.length > 0) {
                        narrative += `**Decisions:**\n`;
                        entry.decisions.forEach(d => narrative += `- ${d}\n`);
                        narrative += '\n';
                    }
                    
                    // Display metadata if available (graceful degradation for legacy memories)
                    const displayScore = entry.finalScore ?? entry.score ?? 0;

                    if (entry.topicId || entry.planId || entry.createdAt) {
                        narrative += `**Metadata:**\n`;
                        if (entry.topicId) {
                            narrative += `- Topic ID: ${entry.topicId}\n`;
                        }
                        if (entry.planId) {
                            narrative += `- Plan: ${entry.planId}\n`;
                        }
                        if (entry.createdAt) {
                            narrative += `- Created: ${entry.createdAt}\n`;
                        }
                        narrative += `- Relevance Score: ${displayScore.toFixed(3)}\n\n`;
                    } else {
                        // Legacy memory without metadata - just show score
                        narrative += `**Relevance Score:** ${displayScore.toFixed(3)}\n\n`;
                    }
                    
                    narrative += '---\n\n';
                });
            }
            
            // Add verbatim structured JSON in fenced code block
            // This allows agents to parse metadata for auditing/further processing
            narrative += '## Structured Response (JSON)\n\n';
            narrative += '```json\n';
            narrative += JSON.stringify(successResponse, null, 2);
            narrative += '\n```\n';

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(narrative)
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
     * Optional: Prepare tool invocation (validation, confirmation message)
     */
    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<RetrieveMemoryToolInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        // Validate required fields
        if (!options.input.query || options.input.query.trim().length === 0) {
            throw new Error('Tool invocation requires a non-empty "query" field');
        }

        // Return prepared invocation with confirmation message
        return {
            invocationMessage: `Searching Flowbaby memory: "${options.input.query.substring(0, 50)}${options.input.query.length > 50 ? '...' : ''}"`
        };
    }
}
