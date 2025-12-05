import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

import { activate } from '../extension';

type Handler = vscode.ChatRequestHandler;

suite('@cognee-memory Participant Integration (captured via API stubs)', () => {
    let sandbox: sinon.SinonSandbox;
    let handler: Handler | undefined;
    // Mutable config state accessible to tests
    const configState = { enabled: true };

    // Common stubs
    let retrieveStub: sinon.SinonStub;
    let ingestStub: sinon.SinonStub;
    let sendRequestSpy: sinon.SinonSpy;

    const workspacePath = '/tmp/vscode-cognee-test-ws';

    // Utility to create a fake request/stream/token triple
    function makeInvocation(prompt: string, fragments: string[] = ['Hello ', 'world.']) {
        // Async iterable for fragments
        async function* fragmentStream() {
            for (const f of fragments) {
                await Promise.resolve();
                yield f;
            }
        }

        const fakeModel: any = {
            sendRequest: async (_messages: any, _options: any, _token: vscode.CancellationToken) => {
                // Record call for assertion
                sendRequestSpy(_messages, _options, _token);
                return { text: fragmentStream() };
            }
        };

        const req: vscode.ChatRequest = {
            prompt,
            model: fakeModel as vscode.LanguageModelChat
        } as any;

        const outputs: string[] = [];
        const stream: vscode.ChatResponseStream = {
            markdown: (s: string) => outputs.push(s),
            // not used in these tests
            function: () => void 0,
            renderData: () => void 0
        } as any;

        const token: vscode.CancellationToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) } as any;

        return { req, stream, token, outputs };
    }

    setup(async () => {
        sandbox = sinon.createSandbox();
        handler = undefined;
        sendRequestSpy = sandbox.spy();

        // Workspace folder available
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file(workspacePath), name: 'ws', index: 0 } as vscode.WorkspaceFolder
        ]);

        // Stub config with toggles we can override per test
        const fakeConfig: vscode.WorkspaceConfiguration = {
            get: ((key: string, defaultValue?: any) => {
                if (key === 'enabled') {return configState.enabled;}
                return defaultValue;
            }) as any,
            has: (() => true) as any,
            inspect: (() => undefined) as any,
            update: (async (section: string, value: any) => {
                if (section === 'enabled') {configState.enabled = Boolean(value);}
            }) as any
        };
        sandbox.stub(vscode.workspace, 'getConfiguration').callsFake(() => fakeConfig);

        // Avoid global command registration conflicts when tests activate repeatedly
        sandbox.stub(vscode.commands, 'registerCommand').callsFake((_id: string, _cb: (...args: any[]) => any) => {
            return { dispose: () => void 0 } as vscode.Disposable;
        });

        // Capture the participant handler when the extension registers it
        sandbox.stub(vscode.chat, 'createChatParticipant').callsFake((_id: string, h: vscode.ChatRequestHandler) => {
            handler = h;
            return { dispose: () => void 0 } as vscode.ChatParticipant;
        });

        // Avoid real Python bridge during activation and handler operations
        const FlowbabyClientMod = await import('../flowbabyClient');
        // Plan 045: initialize() now returns InitializeResult instead of boolean
        sandbox.stub(FlowbabyClientMod.FlowbabyClient.prototype, 'initialize').resolves({
            success: true,
            apiKeyState: {
                pythonConfigured: true,
                typescriptConfigured: true,
                llmReady: true,
                statusMessage: 'API key configured'
            }
        });
        retrieveStub = sandbox.stub(FlowbabyClientMod.FlowbabyClient.prototype, 'retrieve');
        ingestStub = sandbox.stub(FlowbabyClientMod.FlowbabyClient.prototype, 'ingest').resolves(true);
        // Plan 045: Stub hasApiKey to return true so API key checks pass
        sandbox.stub(FlowbabyClientMod.FlowbabyClient.prototype, 'hasApiKey').resolves(true);

        // Plan 039 M3: Stub health check to return VALID so tests can proceed with initialization
        const FlowbabySetupMod = await import('../setup/FlowbabySetupService');
        sandbox.stub(FlowbabySetupMod.FlowbabySetupService.prototype, 'checkWorkspaceHealth').resolves('VALID');
        // Plan 049: Stub isVerified to return true so guardrails pass
        sandbox.stub(FlowbabySetupMod.FlowbabySetupService.prototype, 'isVerified').get(() => true);

        await activate({ subscriptions: [], extensionPath: '/tmp/vscode-cognee-test-ext' } as any);
        assert.ok(handler, 'chat participant handler was not registered');
    });

    teardown(() => {
        sandbox.restore();
        handler = undefined;
    });

    test('Disabled state: streams disabled message and returns metadata', async () => {
        // Force config to disabled for this invocation
        configState.enabled = false;

        try {
            const { req, stream, token, outputs } = makeInvocation('What did we do?');
            const result = await handler!(req, {} as any, stream, token) as vscode.ChatResult;

            assert.ok(outputs.join('\n').includes('Flowbaby is disabled'));
            assert.deepStrictEqual(result.metadata && (result.metadata as any).disabled, true);
            assert.ok(retrieveStub.notCalled, 'retrieve should not be called when disabled');
        } finally {
            // reset for other tests
            configState.enabled = true;
        }
    });

    test('Retrieval failure: degrades gracefully and still generates response', async () => {
        retrieveStub.rejects(new Error('backend down'));

        const { req, stream, token, outputs } = makeInvocation('question');
    const result = await handler!(req, {} as any, stream, token) as vscode.ChatResult;

        // Should warn and proceed
        assert.ok(outputs.some(s => /Memory retrieval unavailable/i.test(s)));
    assert.ok(sendRequestSpy.calledOnce, 'model.sendRequest should still be called');
    assert.ok(result, 'handler should return ChatResult');
    assert.ok((result!.metadata as any).responseLength >= 0);
    });

    test('Success path: previews memories, augments prompt, streams response', async () => {
        retrieveStub.resolves([
            { summaryText: 'First memory content here', text: 'First memory content here', score: 0.9, decisions: [], rationale: [], openQuestions: [], nextSteps: [], references: [] },
            { summaryText: 'Second memory snippet', text: 'Second memory snippet', score: 0.8, decisions: [], rationale: [], openQuestions: [], nextSteps: [], references: [] }
        ]);

        const { req, stream, token, outputs } = makeInvocation('How did we implement caching?');
        const result = await handler!(req, {} as any, stream, token);

        // Previews include count and Memory 1/2 markers
        const joined = outputs.join('\n');
        assert.ok(/Retrieved 2 memories/.test(joined));
        assert.ok(/Memory 1:/i.test(joined));
        assert.ok(/Memory 2:/i.test(joined));
        assert.ok(sendRequestSpy.calledOnce, 'model.sendRequest must be called once');

        // Augmented prompt presence check
        const messages = sendRequestSpy.firstCall.args[0];
        const userPayload = messages[0].content ?? messages[0].parts ?? messages[0];
        const serialized = typeof userPayload === 'string' ? userPayload : JSON.stringify(userPayload);
        assert.ok(/## Relevant Past Conversations/.test(serialized), 'augmented prompt should include context header');

    assert.ok(result, 'handler should return ChatResult');
    assert.ok(result!.metadata, 'metadata should be present');
    assert.strictEqual((result!.metadata as any).memoriesRetrieved, 2);
    assert.ok((result!.metadata as any).responseLength > 0);
    });

    test('Memory previews include character counts and truncation indicator when exceeding 2000 chars', async () => {
        const longMemory = 'A'.repeat(2500);
        retrieveStub.resolves([{
            summaryText: longMemory,
            text: longMemory,
            score: 0.9,
            decisions: [],
            rationale: [],
            openQuestions: [],
            nextSteps: [],
            references: []
        }]);

        const { req, stream, token, outputs } = makeInvocation('Show long memory sample');
        await handler!(req, {} as any, stream, token);

        const joined = outputs.join('\n');
        assert.ok(/Memory 1 \(2500 chars\)/.test(joined), 'Should display character count for long memory');
        assert.ok(joined.includes('showing 2000 of 2500 chars'), 'Should indicate truncation boundary');
    });

    test('Memory previews include character counts without truncation when under 2000 chars', async () => {
        const mediumMemory = 'B'.repeat(500);
        retrieveStub.resolves([{
            summaryText: mediumMemory,
            text: mediumMemory,
            score: 0.9,
            decisions: [],
            rationale: [],
            openQuestions: [],
            nextSteps: [],
            references: []
        }]);

        const { req, stream, token, outputs } = makeInvocation('Show medium memory');
        await handler!(req, {} as any, stream, token);

        const joined = outputs.join('\n');
        assert.ok(/Memory 1 \(500 chars\)/.test(joined), 'Should show length indicator for >100 chars');
        assert.ok(!joined.includes('showing 2000'), 'Should not include truncation message when below limit');
    });
});
