/**
 * Background Status Command - Plan 017
 * 
 * Shows status of all background cognify operations
 */

import * as vscode from 'vscode';
import { BackgroundOperationManager, OperationEntry } from '../background/BackgroundOperationManager';

export async function backgroundStatus(): Promise<void> {
    try {
        const manager = BackgroundOperationManager.getInstance();
        const operations = manager.getStatus() as OperationEntry[];
        
        if (operations.length === 0) {
            vscode.window.showInformationMessage('No background operations');
            return;
        }
        
        // Create quick pick items
        const items = operations.map(op => {
            const elapsed = op.elapsedMs 
                ? `${(op.elapsedMs / 1000).toFixed(1)}s`
                : `${Math.round((Date.now() - new Date(op.startTime).getTime()) / 1000)}s`;
            
            const statusIcons: Record<string, string> = {
                'running': '⏳',
                'pending': '⏸',
                'completed': '✅',
                'failed': '❌',
                'terminated': '⚠️',
                'unknown': '❓'
            };
            const statusIcon = statusIcons[op.status] || '❓';
            
            return {
                label: `${statusIcon} ${op.summaryDigest}`,
                description: `${op.status} • ${elapsed}`,
                detail: `Operation ID: ${op.operationId} • Workspace: ${op.datasetPath.split('/').pop()}`,
                operation: op
            };
        });
        
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select operation to view details',
            matchOnDescription: true,
            matchOnDetail: true
        });
        
        if (selected) {
            const op = selected.operation;
            const details = [
                `Operation ID: ${op.operationId}`,
                `Status: ${op.status}`,
                `Workspace: ${op.datasetPath}`,
                `Started: ${new Date(op.startTime).toLocaleString()}`,
                op.elapsedMs ? `Duration: ${(op.elapsedMs / 1000).toFixed(1)}s` : null,
                op.entityCount ? `Entities: ${op.entityCount}` : null,
                op.errorCode ? `Error: ${op.errorCode} - ${op.errorMessage}` : null
            ].filter(Boolean).join('\n');
            
            vscode.window.showInformationMessage(details, { modal: true });
        }
        
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to get background status: ${err instanceof Error ? err.message : String(err)}`);
    }
}
