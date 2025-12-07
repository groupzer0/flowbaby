import * as assert from 'assert';
import * as vscode from 'vscode';
import { SessionManager } from '../sessionManager';

suite('SessionManager Test Suite', () => {
    let context: vscode.ExtensionContext;
    let globalState: Map<string, any>;

    setup(() => {
        globalState = new Map();
        context = {
            globalState: {
                get: (key: string) => globalState.get(key),
                update: (key: string, value: any) => {
                    globalState.set(key, value);
                    return Promise.resolve();
                }
            }
        } as any;
    });

    test('getSessionIdForChatThread returns stable ID for same thread', () => {
        const manager = new SessionManager(context);
        const threadId = 'thread-1';
        
        const id1 = manager.getSessionIdForChatThread(threadId);
        const id2 = manager.getSessionIdForChatThread(threadId);
        
        assert.ok(id1, 'Session ID should be generated');
        assert.strictEqual(id1, id2, 'Session ID should be stable for same thread');
    });

    test('getSessionIdForChatThread returns different IDs for different threads', () => {
        const manager = new SessionManager(context);
        
        const id1 = manager.getSessionIdForChatThread('thread-1');
        const id2 = manager.getSessionIdForChatThread('thread-2');
        
        assert.notStrictEqual(id1, id2, 'Session IDs should differ for different threads');
    });

    test('getSessionIdForAgentRun returns unique IDs', () => {
        const manager = new SessionManager(context);
        
        const id1 = manager.getSessionIdForAgentRun();
        const id2 = manager.getSessionIdForAgentRun();
        
        assert.notStrictEqual(id1, id2, 'Agent run IDs should be unique');
    });

    test('wrapPayload injects session ID', () => {
        const manager = new SessionManager(context);
        const payload = { foo: 'bar' };
        const sessionId = 'session-123';
        
        const wrapped = manager.wrapPayload(payload, sessionId);
        
        assert.strictEqual(wrapped.foo, 'bar');
        assert.strictEqual(wrapped.__user_session_id, sessionId);
        assert.strictEqual((payload as any).__user_session_id, undefined, 'original payload should not be mutated');
    });

    test('wrapPayload preserves arbitrary fields when session ID omitted', () => {
        const manager = new SessionManager(context);
        const payload = { topic: 't', context: 'c', nested: { value: true } } as const;

        const wrapped = manager.wrapPayload(payload);

        assert.strictEqual(wrapped.__user_session_id, undefined, 'session ID should be absent');
        assert.strictEqual(wrapped.topic, 't');
        assert.strictEqual(wrapped.context, 'c');
        assert.deepStrictEqual(wrapped.nested, { value: true });
    });
});
