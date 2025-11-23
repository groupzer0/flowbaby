import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

import { activate } from '../extension';
import { formatSummaryAsText, createDefaultSummary, TEMPLATE_VERSION } from '../summaryTemplate';
import { parseSummaryFromText } from '../summaryParser';

type Handler = vscode.ChatRequestHandler;

/**
 * Integration test for Plan 014 summary generation workflow
 * Tests the complete "summarize → confirm → store" flow per QA requirements
 */
suite('Summary Generation Workflow (Plan 014)', () => {
    let sandbox: sinon.SinonSandbox;
    let handler: Handler | undefined;
    const configState = { enabled: true, autoIngest: false };

    let ingestSummaryStub: sinon.SinonStub;
    let sendRequestSpy: sinon.SinonSpy;

    const workspacePath = '/tmp/vscode-cognee-test-ws';

    // Helper: create fake request with conversation history
    function makeRequestWithHistory(prompt: string, historyTurns: number = 15) {
        // Build fake conversation history
        // Note: VS Code chat history uses readonly ChatRequestTurn|ChatResponseTurn,
        // but extension code filters using instanceof checks.
        // We need to create objects that pass those checks.
        const history: any[] = [];
        
        for (let i = 0; i < historyTurns; i++) {
            // Create user turn - must be recognized by instanceof ChatRequestTurn
            const userTurn = Object.create(vscode.ChatRequestTurn.prototype);
            Object.assign(userTurn, {
                prompt: `User question ${i + 1}`,
                command: undefined,
                references: [],
                participant: 'test',
                toolReferences: []
            });
            history.push(userTurn);
            
            // Create assistant turn - must be recognized by instanceof ChatResponseTurn
            const assistantTurn = Object.create(vscode.ChatResponseTurn.prototype);
            Object.assign(assistantTurn, {
                response: [
                    new vscode.ChatResponseMarkdownPart(`Assistant answer ${i + 1}`)
                ],
                result: { metadata: {} },
                participant: 'test'
            });
            history.push(assistantTurn);
        }

        const chatContext: vscode.ChatContext = { history };

        // Async iterable for LLM response fragments
        async function* fragmentStream(text: string) {
            const fragments = text.split('\n\n');
            for (const f of fragments) {
                await Promise.resolve();
                yield f + '\n\n';
            }
        }

        const fakeModel: any = {
            sendRequest: async (messages: any, _options: any, _token: vscode.CancellationToken) => {
                sendRequestSpy(messages, _options, _token);
                
                // Generate a valid Plan 014 summary
                const summaryText = `# Conversation Summary: Test Summary

## Context
This is a test conversation about implementing feature X with decision Y.

## Key Decisions
- Decision 1: Use approach A
- Decision 2: Defer feature B to next release

## Rationale
- Approach A has better performance
- Feature B needs more research

## Open Questions
- Should we add caching?

## Next Steps
- Implement approach A
- Research feature B options

## References
- Plan 014
- architecture.md

## Time Scope
Nov 18 10:00-11:30`;
                
                return { text: fragmentStream(summaryText) };
            }
        };

        const req: vscode.ChatRequest = {
            prompt,
            model: fakeModel as vscode.LanguageModelChat
        } as any;

        const outputs: string[] = [];
        const stream: vscode.ChatResponseStream = {
            markdown: (s: string) => outputs.push(s),
            function: () => void 0,
            renderData: () => void 0
        } as any;

        const token: vscode.CancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose: () => {} })
        } as any;

        return { req, chatContext, stream, token, outputs };
    }

    setup(async () => {
        sandbox = sinon.createSandbox();
        handler = undefined;
        sendRequestSpy = sandbox.spy();

        sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file(workspacePath), name: 'ws', index: 0 } as vscode.WorkspaceFolder
        ]);

        const fakeConfig: vscode.WorkspaceConfiguration = {
            get: ((key: string, defaultValue?: any) => {
                if (key === 'enabled') return configState.enabled;
                if (key === 'autoIngestConversations') return configState.autoIngest;
                return defaultValue;
            }) as any,
            has: (() => true) as any,
            inspect: (() => undefined) as any,
            update: (async (section: string, value: any) => {
                if (section === 'enabled') configState.enabled = Boolean(value);
                if (section === 'autoIngestConversations') configState.autoIngest = Boolean(value);
            }) as any
        };
        sandbox.stub(vscode.workspace, 'getConfiguration').callsFake(() => fakeConfig);

        sandbox.stub(vscode.commands, 'registerCommand').callsFake((_id: string, _cb: (...args: any[]) => any) => {
            return { dispose: () => void 0 } as vscode.Disposable;
        });

        sandbox.stub(vscode.chat, 'createChatParticipant').callsFake((_id: string, h: vscode.ChatRequestHandler) => {
            handler = h;
            return { dispose: () => void 0 } as vscode.ChatParticipant;
        });

        const CogneeClientMod = await import('../cogneeClient');
        sandbox.stub(CogneeClientMod.CogneeClient.prototype, 'initialize').resolves(true);
        sandbox.stub(CogneeClientMod.CogneeClient.prototype, 'retrieve').resolves([]);
        sandbox.stub(CogneeClientMod.CogneeClient.prototype, 'ingest').resolves(true);
        ingestSummaryStub = sandbox.stub(CogneeClientMod.CogneeClient.prototype, 'ingestSummary').resolves(true);

        await activate({ subscriptions: [], extensionPath: '/tmp/vscode-cognee-test-ext' } as any);
        assert.ok(handler, 'chat participant handler was not registered');
    });

    teardown(() => {
        sandbox.restore();
        handler = undefined;
    });

    test('WORKFLOW: "summarize this conversation" triggers summary generation', async () => {
        const { req, chatContext, stream, token, outputs } = makeRequestWithHistory('summarize this conversation', 10);
        
        const result = await handler!(req, chatContext, stream, token);
        
        const joined = outputs.join('\n');
        
        // Verify summary generation was triggered (not normal retrieval)
        // If summary flow triggered, should see "Summary Scope" OR the generated summary content
        // If it went to normal retrieval instead, we'd see "Retrieved N memories" or "No relevant memories"
        const isSummaryFlow = /Summary Scope/i.test(joined) || 
                             (/Conversation Summary:/i.test(joined) && /Context/i.test(joined));
        
        if (!isSummaryFlow) {
            // Debug: show what flow was actually taken
            console.log('Expected summary flow but got:', joined.substring(0, 200));
        }
        
        assert.ok(isSummaryFlow, 'Should trigger summary generation flow (not normal retrieval)');
        
        // Verify LLM was called (summary generation uses LLM)
        assert.ok(sendRequestSpy.calledOnce, 'Should call LLM to generate summary');
        
        // Verify result metadata
        assert.ok(result, 'Should return ChatResult');
    });

    test('WORKFLOW: Summary with no history shows error message', async () => {
        const { req, stream, token, outputs } = makeRequestWithHistory('summarize this conversation', 0);
        const emptyContext: vscode.ChatContext = { history: [] };
        
        const result = await handler!(req, emptyContext, stream, token);
        
        const joined = outputs.join('\n');
        assert.ok(/No conversation history/i.test(joined), 'Should warn about empty history');
        assert.ok(result, 'Should return result');
        assert.strictEqual((result.metadata as any).error, 'no_history', 'Should return error metadata');
        assert.ok(ingestSummaryStub.notCalled, 'Should not attempt ingestion');
    });

    test('WORKFLOW: Custom turn count extraction from prompt', async () => {
        // Request "5 turns" but create 20 pairs (40 turns) so there's room
        const { req, chatContext, stream, token, outputs } = makeRequestWithHistory('summarize last 5 turns', 20);
        
        await handler!(req, chatContext, stream, token);
        
        const joined = outputs.join('\n');
        // Verify summary generation was triggered (should extract turn count from prompt)
        const isSummaryFlow = /Summary Scope/i.test(joined) || /Conversation Summary:/i.test(joined);
        assert.ok(isSummaryFlow, 'Should trigger summary generation with custom turn count');
    });

    test('WORKFLOW: Generated summary is parseable by summaryParser', async () => {
        const { req, chatContext, stream, token, outputs } = makeRequestWithHistory('create summary', 8);
        
        await handler!(req, chatContext, stream, token);
        
        // Extract generated summary from outputs
        const joined = outputs.join('\n');
        
        // LLM generated a valid summary (mocked above), verify it's parseable
        const parsedSummary = parseSummaryFromText(joined);
        assert.ok(parsedSummary, 'Generated summary should be parseable');
        assert.ok(parsedSummary.topic, 'Parsed summary should have topic');
        assert.ok(parsedSummary.context, 'Parsed summary should have context');
        assert.ok(Array.isArray(parsedSummary.decisions), 'Parsed summary should have decisions array');
    });

    test('WORKFLOW: Summary trigger variants work', async () => {
        const triggers = [
            'summarize this conversation',
            'summarize the conversation',
            'remember this session',
            'create summary',
            'create a summary',
            'summarize our discussion'
        ];

        for (const trigger of triggers) {
            sendRequestSpy.resetHistory();
            
            const { req, chatContext, stream, token } = makeRequestWithHistory(trigger, 5);
            await handler!(req, chatContext, stream, token);
            
            assert.ok(sendRequestSpy.calledOnce, `"${trigger}" should trigger summary generation`);
        }
    });

    test('WORKFLOW: Summary generation respects cancellation token', async () => {
        const { req, chatContext, stream } = makeRequestWithHistory('summarize', 10);
        
        // Create a pre-cancelled token
        const cancelledToken: vscode.CancellationToken = {
            isCancellationRequested: true,
            onCancellationRequested: () => ({ dispose: () => {} })
        } as any;
        
        const result = await handler!(req, chatContext, stream, cancelledToken);
        
        // Should return early with cancelled metadata
        assert.ok(result, 'Should return result');
        assert.strictEqual((result.metadata as any).cancelled, true, 'Should indicate cancellation');
        assert.ok(ingestSummaryStub.notCalled, 'Should not ingest when cancelled');
    });

    test('WORKFLOW: Long conversation (50+ turns) still generates summary', async () => {
        // Create 60 conversation pairs = 120 total turns
        const { req, chatContext, stream, token, outputs } = makeRequestWithHistory('summarize', 60);
        
        await handler!(req, chatContext, stream, token);
        
        const joined = outputs.join('\n');
        // Verify summary generation handles large conversations
        const isSummaryFlow = /Summary Scope/i.test(joined) || /Conversation Summary:/i.test(joined);
        assert.ok(isSummaryFlow, 'Should handle large turn counts and generate summary');
        assert.ok(sendRequestSpy.calledOnce, 'Should call LLM for summary generation');
    });
});

/**
 * README/Template Snapshot Validation Tests
 * Ensures documented schema matches actual template output
 */
suite('README and Template Consistency (Plan 014)', () => {
    test('SNAPSHOT: Template produces README-documented structure', () => {
        const testSummary = createDefaultSummary(
            'Test Topic',
            'Test context explaining the work'
        );
        testSummary.decisions = ['Decision 1', 'Decision 2'];
        testSummary.rationale = ['Rationale for decision 1'];
        testSummary.openQuestions = ['Open question 1'];
        testSummary.nextSteps = ['Next step 1'];
        testSummary.references = ['reference.md'];
        testSummary.timeScope = 'Nov 18 10:00-12:00';
        
        const formatted = formatSummaryAsText(testSummary);
        
        // Verify structure matches README example
        assert.ok(
            formatted.includes(`<!-- Template: v${TEMPLATE_VERSION} -->`),
            'Should include template version tag'
        );
        assert.ok(formatted.includes('# Conversation Summary:'), 'Should have title heading');
        assert.ok(formatted.includes('**Metadata:**'), 'Should have metadata block');
        assert.ok(formatted.includes('## Context'), 'Should have Context section');
        assert.ok(formatted.includes('## Key Decisions'), 'Should have Key Decisions section');
        assert.ok(formatted.includes('## Rationale'), 'Should have Rationale section');
        assert.ok(formatted.includes('## Open Questions'), 'Should have Open Questions section');
        assert.ok(formatted.includes('## Next Steps'), 'Should have Next Steps section');
        assert.ok(formatted.includes('## References'), 'Should have References section');
        assert.ok(formatted.includes('## Time Scope'), 'Should have Time Scope section');
        
        // Verify metadata fields present
        assert.ok(formatted.includes('- Topic ID:'), 'Should include Topic ID metadata');
        assert.ok(formatted.includes('- Session ID:'), 'Should include Session ID metadata');
        assert.ok(formatted.includes('- Plan ID:'), 'Should include Plan ID metadata');
        assert.ok(formatted.includes('- Status:'), 'Should include Status metadata');
        assert.ok(formatted.includes('- Source Created:'), 'Should include Source Created timestamp');
        assert.ok(formatted.includes('- Created:'), 'Should include Created timestamp');
        assert.ok(formatted.includes('- Updated:'), 'Should include Updated timestamp');
    });

    test('SNAPSHOT: Template round-trip preserves all fields', () => {
        const original = createDefaultSummary(
            'Round-trip Test',
            'Testing full cycle preservation'
        );
        original.decisions = ['Decision A', 'Decision B'];
        original.rationale = ['Reason A', 'Reason B'];
        original.openQuestions = ['Question 1'];
        original.nextSteps = ['Action 1', 'Action 2'];
        original.references = ['file.ts', 'Plan 014'];
        original.timeScope = 'Nov 18 14:00-16:00';
        
        const formatted = formatSummaryAsText(original);
        const parsed = parseSummaryFromText(formatted);
        
        assert.ok(parsed, 'Formatted text should be parseable');
        assert.strictEqual(parsed!.topic, original.topic, 'Topic should match');
        assert.strictEqual(parsed!.context, original.context, 'Context should match');
        assert.deepStrictEqual(parsed!.decisions, original.decisions, 'Decisions should match');
        assert.deepStrictEqual(parsed!.nextSteps, original.nextSteps, 'Next steps should match');
        assert.strictEqual(parsed!.topicId, original.topicId, 'Topic ID should match');
        assert.strictEqual(parsed!.status, original.status, 'Status should match');
    });

    test('SNAPSHOT: Empty sections render with (none) markers', () => {
        const summaryWithEmptyFields = createDefaultSummary(
            'Minimal Summary',
            'Just context, no decisions'
        );
        // Leave all optional fields as empty arrays (defaults)
        summaryWithEmptyFields.timeScope = 'Nov 18';
        
        const formatted = formatSummaryAsText(summaryWithEmptyFields);
        
        // Should show (none) markers for empty sections per template spec
        assert.ok(/Key Decisions[\s\S]*?\(none\)/i.test(formatted), 'Empty decisions should show (none)');
        assert.ok(/Rationale[\s\S]*?\(none\)/i.test(formatted), 'Empty rationale should show (none)');
        assert.ok(/Open Questions[\s\S]*?\(none\)/i.test(formatted), 'Empty questions should show (none)');
        assert.ok(/Next Steps[\s\S]*?\(none\)/i.test(formatted), 'Empty next steps should show (none)');
        assert.ok(/References[\s\S]*?\(none\)/i.test(formatted), 'Empty references should show (none)');
    });

    test('SNAPSHOT: Section headings match documented format exactly', () => {
        const summary = createDefaultSummary('Test', 'Context');
        summary.timeScope = 'Time';
        const formatted = formatSummaryAsText(summary);
        
        // These headings MUST match retrieve.py regex patterns per §4.4.1
        const requiredHeadings = [
            '## Context',
            '## Key Decisions',
            '## Rationale',
            '## Open Questions',
            '## Next Steps',
            '## References',
            '## Time Scope'
        ];
        
        for (const heading of requiredHeadings) {
            assert.ok(formatted.includes(heading), `Template must include exact heading: "${heading}"`);
        }
    });

    test('SNAPSHOT: Metadata block format matches DATAPOINT_SCHEMA.md', () => {
        const summary = createDefaultSummary('Test', 'Context');
        summary.timeScope = 'Time';
        const formatted = formatSummaryAsText(summary);
        
        // Extract metadata block
        const metadataMatch = formatted.match(/\*\*Metadata:\*\*([\s\S]*?)##/);
        assert.ok(metadataMatch, 'Should have metadata block before first section');
        
        const metadataBlock = metadataMatch![1];
        
        // Verify all required metadata fields present with correct format
        // Topic ID uses slug format (e.g., "test-topic") not UUID in current implementation
        assert.ok(/- Topic ID: [a-z0-9-]+/i.test(metadataBlock), 'Should include Topic ID');
        assert.ok(/- Session ID: /.test(metadataBlock), 'Should include Session ID line');
        assert.ok(/- Plan ID: /.test(metadataBlock), 'Should include Plan ID line');
        assert.ok(/- Status: (Active|Superseded|DecisionRecord)/i.test(metadataBlock), 'Should include Status with valid value');
        assert.ok(/- Source Created: (N\/A|\d{4}-\d{2}-\d{2})/i.test(metadataBlock), 'Should include Source Created timestamp');
        assert.ok(/- Created: \d{4}-\d{2}-\d{2}/i.test(metadataBlock), 'Should include Created timestamp');
        assert.ok(/- Updated: \d{4}-\d{2}-\d{2}/i.test(metadataBlock), 'Should include Updated timestamp');
    });
});
