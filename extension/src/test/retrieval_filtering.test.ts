
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { CogneeContextProvider } from '../cogneeContextProvider';
import { CogneeClient, RetrievalResult } from '../cogneeClient';

suite('Retrieval Filtering Test Suite (Plan 021)', () => {
    let sandbox: sinon.SinonSandbox;
    let outputChannel: vscode.OutputChannel;
    let mockClient: sinon.SinonStubbedInstance<CogneeClient>;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock output channel
        outputChannel = {
            appendLine: sandbox.stub(),
            append: sandbox.stub(),
            clear: sandbox.stub(),
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            name: 'Cognee Memory',
            replace: sandbox.stub()
        } as any;

        // Create mock client
        mockClient = sandbox.createStubInstance(CogneeClient);
        
        // Mock configuration
        const mockConfig = {
            get: (_key: string, defaultValue?: any) => defaultValue
        };
        sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    function createProvider(): CogneeContextProvider {
        return new CogneeContextProvider(mockClient as any, outputChannel);
    }

    test('Allows synthesized answers with score 0.0', async () => {
        const provider = createProvider();
        const synthesizedResult: RetrievalResult = {
            summaryText: 'Synthesized Answer',
            text: 'Synthesized Answer',
            score: 0.0,
            tokens: 100
        };
        mockClient.retrieve.resolves([synthesizedResult]);

        const response = await provider.retrieveContext({ query: 'test' });

        assert.strictEqual('error' in response, false);
        if ('entries' in response) {
            assert.strictEqual(response.entries.length, 1, 'Should include synthesized answer');
            assert.strictEqual(response.entries[0].score, 0.0);
        }
    });

    test('Filters out low confidence noise (e.g. 0.005)', async () => {
        const provider = createProvider();
        const noiseResult: RetrievalResult = {
            summaryText: 'Noise',
            text: 'Noise',
            score: 0.005,
            tokens: 100
        };
        mockClient.retrieve.resolves([noiseResult]);

        const response = await provider.retrieveContext({ query: 'test' });

        assert.strictEqual('error' in response, false);
        if ('entries' in response) {
            assert.strictEqual(response.entries.length, 0, 'Should filter out noise');
        }
    });

    test('Allows valid results with high score', async () => {
        const provider = createProvider();
        const validResult: RetrievalResult = {
            summaryText: 'Valid Result',
            text: 'Valid Result',
            score: 0.8,
            tokens: 100
        };
        mockClient.retrieve.resolves([validResult]);

        const response = await provider.retrieveContext({ query: 'test' });

        assert.strictEqual('error' in response, false);
        if ('entries' in response) {
            assert.strictEqual(response.entries.length, 1, 'Should include valid result');
            assert.strictEqual(response.entries[0].score, 0.8);
        }
    });

    test('Handles mixed results correctly', async () => {
        const provider = createProvider();
        const results: RetrievalResult[] = [
            { summaryText: 'Synthesized', text: 'Synthesized', score: 0.0, tokens: 100 },
            { summaryText: 'Noise', text: 'Noise', score: 0.005, tokens: 100 },
            { summaryText: 'Valid', text: 'Valid', score: 0.8, tokens: 100 }
        ];
        mockClient.retrieve.resolves(results);

        const response = await provider.retrieveContext({ query: 'test' });

        assert.strictEqual('error' in response, false);
        if ('entries' in response) {
            assert.strictEqual(response.entries.length, 2, 'Should include synthesized and valid results');
            const scores = response.entries.map(e => e.score);
            assert.ok(scores.includes(0.0));
            assert.ok(scores.includes(0.8));
            assert.ok(!scores.includes(0.005));
        }
    });
});
