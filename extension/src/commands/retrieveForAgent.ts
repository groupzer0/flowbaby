/**
 * Agent Retrieval Command (Plan 016 Milestone 2)
 * 
 * Exposes Flowbaby.retrieveForAgent command for external extensions and agents.
 * This command is headless (not visible in command palette/menus) and returns
 * structured JSON responses for programmatic consumption.
 * 
 * Architecture Reference: system-architecture.md §4.5
 * API Documentation: extension/AGENT_INTEGRATION.md
 */

import * as vscode from 'vscode';
import {
    FlowbabyContextRequest,
    FlowbabyContextResponse,
    AgentErrorCode,
    AgentErrorResponse
} from '../types/agentIntegration';

/**
 * Register the Flowbaby.retrieveForAgent command
 * 
 * This command provides structured retrieval for arbitrary agents and extensions.
 * Authorization is controlled by VS Code Configure Tools UI.
 * 
 * @param context - Extension context for registrations
 * @param provider - FlowbabyContextProvider instance (must already be initialized)
 * @param outputChannel - Output channel for audit logging
 */
export function registerRetrieveForAgentCommand(
    context: vscode.ExtensionContext,
    provider: any, // FlowbabyContextProvider type (avoiding circular import)
    outputChannel: vscode.OutputChannel
): void {
    const command = vscode.commands.registerCommand(
        'Flowbaby.retrieveForAgent',
        async (requestJson: string): Promise<string> => {
            const startTime = Date.now();
            
            try {
                // Access control (Plan 016.1 - Configure Tools is sole opt-in)
                // Commands proxy tool invocations; if tool is disabled in Configure Tools,
                // VS Code won't invoke the tool so this command won't be called
                // No additional access check needed
                
                // Parse request JSON
                let request: FlowbabyContextRequest;
                try {
                    request = JSON.parse(requestJson);
                } catch (parseError) {
                    const errorResponse: AgentErrorResponse = {
                        error: AgentErrorCode.INVALID_REQUEST,
                        message: 'Invalid JSON payload',
                        details: parseError instanceof Error ? parseError.message : String(parseError)
                    };
                    
                    // Log invalid request
                    outputChannel.appendLine(
                        `[Agent Access] ${new Date().toISOString()} - INVALID - ` +
                        `error: ${errorResponse.details}`
                    );
                    
                    return JSON.stringify(errorResponse);
                }
                
                // Validate request structure
                if (!request.query || typeof request.query !== 'string') {
                    const errorResponse: AgentErrorResponse = {
                        error: AgentErrorCode.INVALID_REQUEST,
                        message: 'Missing or invalid query field',
                        details: 'request.query must be a non-empty string'
                    };
                    
                    outputChannel.appendLine(
                        `[Agent Access] ${new Date().toISOString()} - INVALID - ` +
                        `error: missing query field`
                    );
                    
                    return JSON.stringify(errorResponse);
                }
                
                // Generate query hash for logging (first 8 chars of SHA-256)
                const queryHash = require('crypto')
                    .createHash('sha256')
                    .update(request.query)
                    .digest('hex')
                    .substring(0, 8);
                
                // Log retrieval attempt (approved)
                outputChannel.appendLine(
                    `[Agent Access] ${new Date().toISOString()} - APPROVED - ` +
                    `query_hash: ${queryHash}, maxResults: ${request.maxResults || 'default'}, ` +
                    `maxTokens: ${request.maxTokens || 'default'}`
                );
                
                // Call FlowbabyContextProvider.retrieveContext
                const response = await provider.retrieveContext(request);
                
                const duration = Date.now() - startTime;
                
                // Check if response is an error
                if ('error' in response) {
                    const errorResponse = response as AgentErrorResponse;
                    
                    // Log error result
                    outputChannel.appendLine(
                        `[Agent Access] ${new Date().toISOString()} - ERROR - ` +
                        `query_hash: ${queryHash}, error: ${errorResponse.error}, ` +
                        `duration: ${duration}ms`
                    );
                    
                    return JSON.stringify(errorResponse);
                }
                
                const successResponse = response as FlowbabyContextResponse;
                
                // Log successful result
                outputChannel.appendLine(
                    `[Agent Access] ${new Date().toISOString()} - SUCCESS - ` +
                    `query_hash: ${queryHash}, results: ${successResponse.totalResults}, ` +
                    `tokens: ${successResponse.tokensUsed}, duration: ${duration}ms`
                );
                
                // Return JSON response
                return JSON.stringify(successResponse);
                
            } catch (error) {
                const duration = Date.now() - startTime;
                const errorMessage = error instanceof Error ? error.message : String(error);
                
                const errorResponse: AgentErrorResponse = {
                    error: AgentErrorCode.BRIDGE_TIMEOUT,
                    message: `Retrieval failed: ${errorMessage}`,
                    details: `Command failed after ${duration}ms`
                };
                
                // Log exception
                outputChannel.appendLine(
                    `[Agent Access] ${new Date().toISOString()} - EXCEPTION - ` +
                    `error: ${errorMessage}, duration: ${duration}ms`
                );
                
                return JSON.stringify(errorResponse);
            }
        }
    );
    
    context.subscriptions.push(command);
}
