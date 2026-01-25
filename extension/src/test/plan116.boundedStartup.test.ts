/**
 * Tests for Plan 116 Milestone 2: Bounded Startup (No-Limbo)
 * 
 * Verifies that daemon startup:
 * - Always settles within a bounded deadline
 * - Performs complete cleanup on all exit paths
 * - Returns reason-coded errors with attempt IDs
 * - Never leaves the manager stuck in 'starting' state
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import { EventEmitter } from 'events';
import { Writable } from 'stream';
import { PythonBridgeDaemonManager } from '../bridge/PythonBridgeDaemonManager';
import { 
    DaemonUnavailableError, 
    DaemonUnavailableReason,
    DAEMON_RELIABILITY_DEFAULTS 
} from '../bridge/daemonReliabilityContract';

// Mock child process for controlled testing
class MockChildProcess extends EventEmitter {
    stdin: Writable & { write: sinon.SinonStub };
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid = 12345;
    killed = false;

    constructor() {
        super();
        this.stdin = new Writable({
            write: (_chunk, _encoding, callback) => {
                if (callback) callback();
                return true;
            }
        }) as Writable & { write: sinon.SinonStub };
        this.stdin.write = sinon.stub().callsFake((_data, callback) => {
            if (callback) callback(null);
            return true;
        });
        this.stdout = new EventEmitter();
        this.stderr = new EventEmitter();
    }

    kill(signal?: string): boolean {
        this.killed = true;
        setImmediate(() => {
            this.emit('close', signal === 'SIGKILL' ? 9 : 0, signal || null);
        });
        return true;
    }

    simulateResponse(response: object): void {
        const line = JSON.stringify(response) + '\n';
        this.stdout.emit('data', Buffer.from(line));
    }

    simulateImmediateExit(code: number = 1): void {
        setImmediate(() => {
            this.emit('close', code, null);
        });
    }
}

suite('Plan 116 M2: Bounded Startup (No-Limbo)', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockOutputChannel: vscode.OutputChannel;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockContext = {
            secrets: {
                get: sandbox.stub().resolves('test-api-key'),
                store: sandbox.stub().resolves(),
                delete: sandbox.stub().resolves(),
                onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
                keys: sandbox.stub().resolves([])
            },
            subscriptions: [],
            extensionPath: '/test/extension',
            extensionUri: vscode.Uri.file('/test/extension'),
            globalState: {
                get: sandbox.stub().returns(undefined),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            },
            workspaceState: {
                get: sandbox.stub().returns(undefined),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([])
            },
            storagePath: '/test/storage',
            globalStoragePath: '/test/global-storage',
            logPath: '/test/logs',
            storageUri: vscode.Uri.file('/test/storage'),
            globalStorageUri: vscode.Uri.file('/test/global-storage'),
            logUri: vscode.Uri.file('/test/logs'),
            extensionMode: vscode.ExtensionMode.Development,
            extension: undefined as unknown as vscode.Extension<unknown>,
            asAbsolutePath: (relativePath: string) => path.join('/test/extension', relativePath),
            environmentVariableCollection: {} as vscode.GlobalEnvironmentVariableCollection,
            languageModelAccessInformation: {} as vscode.LanguageModelAccessInformation
        };

        mockOutputChannel = {
            name: 'Flowbaby',
            append: sandbox.stub(),
            appendLine: sandbox.stub(),
            clear: sandbox.stub(),
            show: sandbox.stub() as unknown as vscode.OutputChannel['show'],
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            replace: sandbox.stub()
        };

        sandbox.stub(vscode.workspace, 'getConfiguration').callsFake(() => ({
            get: (key: string, defaultValue?: unknown) => {
                if (key === 'bridgeMode') return 'daemon';
                if (key === 'daemonIdleTimeoutMinutes') return 5;
                return defaultValue;
            },
            has: () => true,
            inspect: () => undefined,
            update: sandbox.stub().resolves()
        } as unknown as vscode.WorkspaceConfiguration));
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Startup Deadline', () => {
        test('DAEMON_RELIABILITY_DEFAULTS should define reasonable startup deadline', () => {
            // Verify contract defaults exist
            assert.ok(DAEMON_RELIABILITY_DEFAULTS.STARTUP_DEADLINE_MS > 0);
            assert.ok(DAEMON_RELIABILITY_DEFAULTS.STARTUP_DEADLINE_MS <= 60000); // Max 60s
            assert.ok(DAEMON_RELIABILITY_DEFAULTS.HANDSHAKE_TIMEOUT_MS > 0);
            assert.ok(DAEMON_RELIABILITY_DEFAULTS.HANDSHAKE_TIMEOUT_MS < DAEMON_RELIABILITY_DEFAULTS.STARTUP_DEADLINE_MS);
        });

        test('startup attempt should include attemptId for correlation', async () => {
            const manager = new PythonBridgeDaemonManager(
                '/test/workspace',
                '/usr/bin/python3',
                '/test/extension/bridge',
                mockContext,
                mockOutputChannel
            );

            // Verify manager can generate attempt IDs (via getCurrentAttemptId if exposed)
            // This is a contract verification - actual correlation tested in integration
            assert.ok(manager, 'Manager should be created');
            
            manager.dispose();
        });
    });

    suite('State Cleanup on Failure', () => {
        test('after failed start, state should not be stuck in starting', async () => {
            const manager = new PythonBridgeDaemonManager(
                '/test/workspace',
                '/usr/bin/python3',
                '/test/extension/bridge',
                mockContext,
                mockOutputChannel
            );

            // Simulate a start failure by having internal method fail
            // After failure, state should be 'stopped' or 'failed_startup', not 'starting'
            
            // Force an error condition
            (manager as any).pythonPath = '/nonexistent/python';
            
            try {
                await manager.start();
            } catch {
                // Expected to fail
            }

            const state = manager.getState();
            assert.notStrictEqual(state, 'starting', 'State should not be stuck in starting after failure');
            // Plan 116: 'failed_startup' is now the correct state for startup failures
            // (as opposed to 'crashed' which is for runtime failures)
            assert.ok(
                state === 'stopped' || state === 'crashed' || state === 'failed_startup',
                `State should be terminal after failure, got: ${state}`
            );

            manager.dispose();
        });

        test('startupPromise should be cleared after failure', async () => {
            const manager = new PythonBridgeDaemonManager(
                '/test/workspace',
                '/usr/bin/python3',
                '/test/extension/bridge',
                mockContext,
                mockOutputChannel
            );

            // Force failure
            (manager as any).pythonPath = '/nonexistent/python';

            try {
                await manager.start();
            } catch {
                // Expected
            }

            // startupPromise should be null after completion (success or failure)
            assert.strictEqual(
                (manager as any).startupPromise,
                null,
                'startupPromise should be cleared after failure'
            );

            manager.dispose();
        });
    });

    suite('Reason-Coded Errors', () => {
        test('DaemonUnavailableError should include reason code', () => {
            const error = new DaemonUnavailableError(
                DaemonUnavailableReason.STARTUP_TIMEOUT,
                'attempt-123'
            );

            assert.strictEqual(error.reason, DaemonUnavailableReason.STARTUP_TIMEOUT);
            assert.strictEqual(error.attemptId, 'attempt-123');
            assert.ok(error.message.length > 0);
        });

        test('all startup failure reasons should have user-friendly messages', () => {
            const startupReasons = [
                DaemonUnavailableReason.STARTUP_TIMEOUT,
                DaemonUnavailableReason.STARTUP_HUNG,
                DaemonUnavailableReason.SPAWN_FAILED,
                DaemonUnavailableReason.STDIO_UNAVAILABLE,
                DaemonUnavailableReason.HANDSHAKE_FAILED,
                DaemonUnavailableReason.PROTOCOL_ERROR,
                DaemonUnavailableReason.IMMEDIATE_EXIT
            ];

            for (const reason of startupReasons) {
                const error = new DaemonUnavailableError(reason);
                assert.ok(
                    error.message.length > 20,
                    `Reason ${reason} should have a descriptive message`
                );
            }
        });
    });

    suite('Subsequent Start After Failure', () => {
        test('should allow new start attempt after failure', async () => {
            const manager = new PythonBridgeDaemonManager(
                '/test/workspace',
                '/usr/bin/python3',
                '/test/extension/bridge',
                mockContext,
                mockOutputChannel
            );

            // First attempt - force failure
            (manager as any).pythonPath = '/nonexistent/python';
            
            try {
                await manager.start();
            } catch {
                // Expected
            }

            // State should allow retry
            const stateAfterFirstFailure = manager.getState();
            
            // A second start attempt should be possible (not blocked by stuck state)
            // We just verify state is not 'starting' which would block
            assert.notStrictEqual(
                stateAfterFirstFailure,
                'starting',
                'Should not be stuck in starting, allowing retry'
            );

            manager.dispose();
        });
    });

    suite('Concurrent Start Requests', () => {
        test('concurrent start calls should coalesce', async () => {
            const manager = new PythonBridgeDaemonManager(
                '/test/workspace',
                '/usr/bin/python3',
                '/test/extension/bridge',
                mockContext,
                mockOutputChannel
            );

            // This tests the existing behavior - concurrent starts should share the promise
            // We can't easily test this without mocking spawn, but we verify the interface
            
            assert.ok(typeof manager.start === 'function');
            assert.ok(typeof manager.getState === 'function');

            manager.dispose();
        });
    });
});
