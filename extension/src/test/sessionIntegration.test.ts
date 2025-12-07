import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import { SessionManager } from '../sessionManager';
import { FlowbabyClient } from '../flowbabyClient';

suite('Session Integration Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let globalStateMap: Map<string, any>;
    let testWorkspacePath: string;

    setup(() => {
        sandbox = sinon.createSandbox();
        globalStateMap = new Map();
        testWorkspacePath = path.resolve('tmp', 'test-workspace');

        // Mock ExtensionContext with working globalState
        mockContext = {
            globalState: {
                get: (key: string) => globalStateMap.get(key),
                update: (key: string, value: any) => {
                    globalStateMap.set(key, value);
                    return Promise.resolve();
                }
            },
            secrets: {
                get: sinon.stub().resolves(undefined),
                store: sinon.stub().resolves(),
                delete: sinon.stub().resolves(),
                onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
            },
            subscriptions: []
        } as any;
    });

    teardown(() => {
        sandbox.restore();
    });

    test('SessionManager persists IDs across "restarts"', async () => {
        // 1. First "run"
        const manager1 = new SessionManager(mockContext);
        const threadId = 'thread-persistent';
        const sessionId1 = manager1.getSessionIdForChatThread(threadId);
        
        assert.ok(sessionId1, 'Should generate session ID');

        // 2. Simulate restart by creating new manager with SAME context (same globalStateMap)
        const manager2 = new SessionManager(mockContext);
        const sessionId2 = manager2.getSessionIdForChatThread(threadId);

        // 3. Verify persistence
        assert.strictEqual(sessionId2, sessionId1, 'Session ID should persist across manager instances');
    });

    test('FlowbabyClient injects session ID into ingest payload', async () => {
        const manager = new SessionManager(mockContext);
        const client = new FlowbabyClient(testWorkspacePath, mockContext, manager);
        
        // Mock runPythonScript to capture arguments
        const runScriptStub = sandbox.stub(client as any, 'runPythonScript').resolves({ success: true, staged: true });
        
        // Mock pythonPath to avoid error
        sandbox.stub(client as any, 'pythonPath').value('python');

        const threadId = 'thread-ingest';
        const expectedSessionId = manager.getSessionIdForChatThread(threadId);

        await client.ingestAsync('user msg', 'assistant msg', {} as any, 0.5, threadId);

        assert.ok(runScriptStub.calledOnce, 'Should call runPythonScript');
        const args = runScriptStub.firstCall.args[1];
        
        // Verify args contain the JSON payload
        const jsonArgIndex = args.indexOf('--conversation-json');
        assert.ok(jsonArgIndex >= 0, 'Should use JSON mode');
        
        const payload = JSON.parse(args[jsonArgIndex + 1]);
        assert.strictEqual(payload.__user_session_id, expectedSessionId, 'Payload should contain correct session ID');
    });

    test('FlowbabyClient injects session ID into retrieve payload', async () => {
        const manager = new SessionManager(mockContext);
        const client = new FlowbabyClient(testWorkspacePath, mockContext, manager);
        
        // Mock runPythonScript
        const runScriptStub = sandbox.stub(client as any, 'runPythonScript').resolves([]);
        
        // Mock pythonPath
        sandbox.stub(client as any, 'pythonPath').value('python');

        const threadId = 'thread-retrieve';
        const expectedSessionId = manager.getSessionIdForChatThread(threadId);

        await client.retrieve('query', { threadId });

        assert.ok(runScriptStub.calledOnce, 'Should call runPythonScript');
        const args = runScriptStub.firstCall.args[1];
        
        // Verify args contain the JSON payload
        const jsonArgIndex = args.indexOf('--json');
        assert.ok(jsonArgIndex >= 0, 'Should use JSON mode');
        
        const payload = JSON.parse(args[jsonArgIndex + 1]);
        assert.strictEqual(payload.__user_session_id, expectedSessionId, 'Payload should contain correct session ID');
    });

    test('FlowbabyClient omits session ID when session management is disabled', async () => {
        const manager = new SessionManager(mockContext);

        // Stub configuration to disable session management while keeping other defaults
        const flowConfig = {
            get: (key: string, defaultValue?: any) => {
                if (key === 'pythonPath') {return '/usr/bin/python3';}
                if (key === 'debugLogging') {return false;}
                return defaultValue;
            }
        } as any;
        const rankingConfig = { get: (_key: string, defaultValue?: any) => defaultValue } as any;
        const sessionConfig = { get: () => false } as any;

        sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
            if (section === 'Flowbaby.sessionManagement') {return sessionConfig;}
            if (section === 'Flowbaby.ranking') {return rankingConfig;}
            return flowConfig;
        });

        sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

        const client = new FlowbabyClient(testWorkspacePath, mockContext, manager);
        const runScriptStub = sandbox.stub(client as any, 'runPythonScript').resolves([]);

        await client.retrieve('query', { threadId: 'thread-disabled' });

        assert.ok(runScriptStub.calledOnce, 'Should call runPythonScript');
        const args = runScriptStub.firstCall.args[1];
        const jsonArgIndex = args.indexOf('--json');
        assert.ok(jsonArgIndex >= 0, 'Should use JSON payload');
        const payload = JSON.parse(args[jsonArgIndex + 1]);
        assert.strictEqual(payload.__user_session_id, undefined, 'Payload should not include session ID when disabled');
    });

    test('FlowbabyClient falls back to legacy mode without SessionManager', async () => {
        // Create client WITHOUT session manager
        const client = new FlowbabyClient(testWorkspacePath, mockContext, undefined);
        
        const runScriptStub = sandbox.stub(client as any, 'runPythonScript').resolves({ success: true, staged: true });
        sandbox.stub(client as any, 'pythonPath').value('python');

        await client.ingestAsync('user', 'assistant', {} as any);

        assert.ok(runScriptStub.calledOnce);
        const args = runScriptStub.firstCall.args[1];
        
        // Should NOT use --conversation-json (legacy positional args)
        // OR if it does, it shouldn't have __user_session_id. 
        // Looking at code: if (!this.sessionManager) -> legacy positional args.
        assert.strictEqual(args.indexOf('--conversation-json'), -1, 'Should use legacy positional args without SessionManager');
    });
});
