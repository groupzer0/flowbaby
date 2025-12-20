/**
 * Unit Tests for RetrieveMemoryTool (Plan 016 Language Model Tool)
 *
 * Validates tool output includes Plan 063 memory-context framing.
 */

import { suite, test } from 'mocha';
import { expect } from 'chai';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

import { RetrieveMemoryTool } from '../tools/retrieveMemoryTool';
import { FlowbabyContextProvider } from '../flowbabyContextProvider';
import { FlowbabyContextResponse } from '../types/agentIntegration';

suite('RetrieveMemoryTool (Language Model Tool Integration)', () => {
    const outputChannel = vscode.window.createOutputChannel('Test Output');

    let sandbox: sinon.SinonSandbox;
    let provider: FlowbabyContextProvider;
    let retrieveContextStub: sinon.SinonStub;

    suiteSetup(() => {
        sandbox = sinon.createSandbox();
        provider = {
            // Concrete method so sinon can stub
            retrieveContext: async () => ({ entries: [], totalResults: 0, tokensUsed: 0 } as any)
        } as unknown as FlowbabyContextProvider;

        retrieveContextStub = sandbox.stub(provider, 'retrieveContext');
    });

    setup(() => {
        retrieveContextStub.resetHistory();
    });

    suiteTeardown(() => {
        sandbox.restore();
    });

    test('invoke prepends MEMORY_CONTEXT_INSTRUCTIONS to narrative', async () => {
        const response: FlowbabyContextResponse = {
            entries: [
                {
                    summaryText: 'Test memory body',
                    decisions: [],
                    rationale: [],
                    openQuestions: [],
                    nextSteps: [],
                    references: [],
                    finalScore: 1.0
                } as any
            ],
            totalResults: 1,
            tokensUsed: 10
        } as any;

        retrieveContextStub.resolves(response);

        const tool = new RetrieveMemoryTool(provider, outputChannel);
        const tokenSource = new vscode.CancellationTokenSource();

        const result = await tool.invoke(
            {
                input: { query: 'test query', maxResults: 1 }
            } as vscode.LanguageModelToolInvocationOptions<any>,
            tokenSource.token
        );

        expect(result).to.be.instanceOf(vscode.LanguageModelToolResult);
        expect(result.content).to.have.lengthOf(1);

        const part = result.content[0] as vscode.LanguageModelTextPart;
        expect(part.value).to.be.a('string');
        expect(part.value).to.match(/^## Memory Context Guidance\n/m);
        expect(part.value).to.include('# Retrieved Memories (1 results)');

        tokenSource.dispose();
    });
});
