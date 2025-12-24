/**
 * POC-2: Copilot Synthesis Quality Testing
 * 
 * This is TEMPORARY POC code - NOT integrated with production functionality.
 * Delete this entire poc/ directory after POC evaluation.
 * 
 * Purpose:
 *   Test whether VS Code's Language Model API (Copilot) can synthesize
 *   quality answers from raw graph context returned by only_context=True.
 * 
 * Usage:
 *   Register via package.json command, then run from Command Palette:
 *   > Flowbaby: Run Synthesis POC
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Sample context from POC-1 (will be loaded from file or provided inline)
interface PocResult {
    query: string;
    context: string;
    synthesizedAnswer: string;
    latencyMs: number;
    modelUsed: string;
    success: boolean;
    error?: string;
}

interface Poc2Report {
    timestamp: string;
    testPath: 'poc2a_agent' | 'poc2b_participant' | 'poc2c_manual';
    results: PocResult[];
    summary: {
        totalTests: number;
        successCount: number;
        avgLatencyMs: number;
    };
}

/**
 * Synthesis prompt template - embeds system-like instructions in user message
 * since VS Code LM API doesn't support system messages.
 */
function buildSynthesisPrompt(query: string, context: string): string {
    return `You are a MEMORY RETRIEVAL ASSISTANT. Your job is to answer questions using ONLY the provided context.

RULES:
- Answer ONLY based on the context below
- If the context doesn't contain relevant information, say "No relevant information found in memory."
- Be concise and direct
- Do NOT make up information not in the context

CONTEXT FROM KNOWLEDGE GRAPH:
${context}

QUESTION: ${query}

ANSWER:`;
}

/**
 * POC-2c: Test synthesis using vscode.lm.selectChatModels()
 * This is the "manual command" path where we obtain the model ourselves.
 */
export async function runPoc2c_ManualSynthesis(): Promise<Poc2Report> {
    const report: Poc2Report = {
        timestamp: new Date().toISOString(),
        testPath: 'poc2c_manual',
        results: [],
        summary: {
            totalTests: 0,
            successCount: 0,
            avgLatencyMs: 0,
        },
    };

    // Load context from POC-1 results
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('POC-2: No workspace folder open');
        return report;
    }

    const poc1ResultsPath = path.join(
        workspaceFolder.uri.fsPath,
        'extension/bridge/poc_results/poc1_return_format.json'
    );

    let contextFromPoc1: string;
    try {
        const poc1Data = JSON.parse(fs.readFileSync(poc1ResultsPath, 'utf-8'));
        // Extract the context string from the POC-1 result structure
        const searchResult = poc1Data.raw_search_result?.[0]?.search_result;
        if (searchResult && Array.isArray(searchResult) && searchResult.length > 0) {
            // The search_result is typically [{dataset_name: "context string"}]
            const firstResult = searchResult[0];
            contextFromPoc1 = typeof firstResult === 'string'
                ? firstResult
                : Object.values(firstResult)[0] as string;
        } else {
            throw new Error('Could not extract context from POC-1 results');
        }
    } catch (err) {
        vscode.window.showErrorMessage(`POC-2: Failed to load POC-1 results: ${err}`);
        return report;
    }

    // Test queries
    const testQueries = [
        'What are the key decisions in this workspace?',
        'What plans have been implemented?',
        'What are the open questions or risks?',
    ];

    // Get Copilot model
    const outputChannel = vscode.window.createOutputChannel('Flowbaby POC-2');
    outputChannel.show();
    outputChannel.appendLine('=== POC-2c: Manual Synthesis Test ===');
    outputChannel.appendLine(`Timestamp: ${report.timestamp}`);
    outputChannel.appendLine('');

    let models: vscode.LanguageModelChat[];
    try {
        models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        if (models.length === 0) {
            outputChannel.appendLine('❌ No Copilot models available. Is Copilot installed and authenticated?');
            vscode.window.showErrorMessage('POC-2: No Copilot models available');
            return report;
        }
        outputChannel.appendLine(`✅ Found ${models.length} Copilot model(s)`);
        outputChannel.appendLine(`   Using: ${models[0].name} (${models[0].vendor}/${models[0].family})`);
    } catch (err) {
        outputChannel.appendLine(`❌ Failed to get Copilot models: ${err}`);
        return report;
    }

    const model = models[0];

    // Run tests
    for (const query of testQueries) {
        outputChannel.appendLine('');
        outputChannel.appendLine(`--- Query: "${query}" ---`);

        const result: PocResult = {
            query,
            context: contextFromPoc1.substring(0, 500) + '...', // Truncate for report
            synthesizedAnswer: '',
            latencyMs: 0,
            modelUsed: `${model.vendor}/${model.family}`,
            success: false,
        };

        const startTime = Date.now();

        try {
            const prompt = buildSynthesisPrompt(query, contextFromPoc1);
            const messages = [vscode.LanguageModelChatMessage.User(prompt)];

            const response = await model.sendRequest(
                messages,
                {},
                new vscode.CancellationTokenSource().token
            );

            let answer = '';
            for await (const chunk of response.text) {
                answer += chunk;
            }

            result.latencyMs = Date.now() - startTime;
            result.synthesizedAnswer = answer;
            result.success = true;

            outputChannel.appendLine(`✅ Completed in ${result.latencyMs}ms`);
            outputChannel.appendLine(`Answer: ${answer.substring(0, 200)}${answer.length > 200 ? '...' : ''}`);
        } catch (err) {
            result.latencyMs = Date.now() - startTime;
            result.error = String(err);
            outputChannel.appendLine(`❌ Failed: ${err}`);
        }

        report.results.push(result);
    }

    // Calculate summary
    report.summary.totalTests = report.results.length;
    report.summary.successCount = report.results.filter(r => r.success).length;
    const totalLatency = report.results.reduce((sum, r) => sum + r.latencyMs, 0);
    report.summary.avgLatencyMs = Math.round(totalLatency / report.results.length);

    outputChannel.appendLine('');
    outputChannel.appendLine('=== Summary ===');
    outputChannel.appendLine(`Total: ${report.summary.totalTests} tests`);
    outputChannel.appendLine(`Success: ${report.summary.successCount}/${report.summary.totalTests}`);
    outputChannel.appendLine(`Avg Latency: ${report.summary.avgLatencyMs}ms`);

    // Save report
    const reportPath = path.join(
        workspaceFolder.uri.fsPath,
        'extension/bridge/poc_results/poc2c_synthesis_report.json'
    );
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    outputChannel.appendLine(`\nReport saved: ${reportPath}`);

    vscode.window.showInformationMessage(
        `POC-2c Complete: ${report.summary.successCount}/${report.summary.totalTests} tests passed, avg ${report.summary.avgLatencyMs}ms`
    );

    return report;
}

/**
 * Register POC-2 command
 */
export function registerPoc2Commands(context: vscode.ExtensionContext): void {
    const poc2cCommand = vscode.commands.registerCommand(
        'flowbaby.poc2c.runSynthesis',
        async () => {
            await runPoc2c_ManualSynthesis();
        }
    );

    context.subscriptions.push(poc2cCommand);
}
