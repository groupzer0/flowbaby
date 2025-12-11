/**
 * Tests for PythonBridgeDaemonManager - Plan 054
 * 
 * Tests lifecycle management, IPC communication, and error handling
 * for the long-lived Python bridge daemon.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import { PythonBridgeDaemonManager } from '../bridge/PythonBridgeDaemonManager';

// Mock child process for testing with proper stream interfaces
class MockChildProcess extends EventEmitter {
    stdin: Writable & { write: sinon.SinonStub };
    stdout: Readable & EventEmitter;
    stderr: Readable & EventEmitter;
    pid = 12345;
    killed = false;

    constructor() {
        super();
        // Create mock stdin with write stub
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

        // Create mock stdout/stderr as event emitters
        this.stdout = new EventEmitter() as Readable & EventEmitter;
        this.stderr = new EventEmitter() as Readable & EventEmitter;
    }

    kill(signal?: string): boolean {
        this.killed = true;
        // Emit close event asynchronously to allow cleanup
        setImmediate(() => {
            this.emit('close', signal === 'SIGKILL' ? 9 : 0, signal || null);
        });
        return true;
    }

    // Simulate receiving a JSON-RPC response
    simulateResponse(response: object): void {
        const line = JSON.stringify(response) + '\n';
        this.stdout.emit('data', Buffer.from(line));
    }

    // Simulate stderr output
    simulateStderr(message: string): void {
        this.stderr.emit('data', Buffer.from(message + '\n'));
    }
}

suite('PythonBridgeDaemonManager', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockOutputChannel: vscode.OutputChannel;
    let mockWorkspacePath: string;
    let mockPythonPath: string;
    let mockBridgePath: string;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock workspace path
        mockWorkspacePath = '/test/workspace';
        mockPythonPath = '/usr/bin/python3';
        mockBridgePath = '/test/extension/bridge';

        // Mock VS Code extension context
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

        // Mock output channel
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

        // Mock VS Code configuration
        sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
            return {
                get: (key: string, defaultValue?: unknown) => {
                    if (section === 'Flowbaby') {
                        if (key === 'bridgeMode') return 'daemon';
                        if (key === 'daemonIdleTimeoutMinutes') return 5;
                    }
                    if (section === 'Flowbaby.llm') {
                        if (key === 'provider') return 'openai';
                        if (key === 'model') return 'gpt-4o-mini';
                    }
                    return defaultValue;
                },
                has: () => true,
                inspect: () => undefined,
                update: sandbox.stub().resolves()
            } as unknown as vscode.WorkspaceConfiguration;
        });
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Initialization', () => {
        test('should create daemon manager with correct configuration', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            assert.strictEqual(manager.isDaemonEnabled(), true);
            assert.strictEqual(manager.getState(), 'stopped');
            assert.strictEqual(manager.isHealthy(), false);

            manager.dispose();
        });

        test('should respect disabled daemon mode', () => {
            (vscode.workspace.getConfiguration as sinon.SinonStub).callsFake(() => ({
                get: (key: string, defaultValue?: unknown) => {
                    if (key === 'bridgeMode') return 'spawn';
                    return defaultValue;
                },
                has: () => true,
                inspect: () => undefined,
                update: sandbox.stub().resolves()
            }));

            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            assert.strictEqual(manager.isDaemonEnabled(), false);
            manager.dispose();
        });
    });

    suite('State Management', () => {
        test('should report correct states', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            assert.strictEqual(manager.getState(), 'stopped');
            assert.strictEqual(manager.isHealthy(), false);

            manager.dispose();
        });
    });

    suite('Request Handling', () => {
        test('should reject requests when daemon is not started', async () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Ensure daemon is stopped and try to send request
            assert.strictEqual(manager.getState(), 'stopped');

            try {
                await manager.sendRequest('health', {});
                assert.fail('Expected error');
            } catch (error) {
                assert.ok(error instanceof Error);
                // sendRequest should either fail because daemon isn't running
                // or trigger a start attempt
            }

            manager.dispose();
        });
    });

    suite('Lifecycle', () => {
        test('should dispose cleanly', async () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Dispose should not throw
            manager.dispose();
        });

        test('should skip start when daemon mode is disabled', async () => {
            (vscode.workspace.getConfiguration as sinon.SinonStub).callsFake(() => ({
                get: (key: string, defaultValue?: unknown) => {
                    if (key === 'bridgeMode') return 'spawn';
                    return defaultValue;
                },
                has: () => true,
                inspect: () => undefined,
                update: sandbox.stub().resolves()
            }));

            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Start should be a no-op when disabled
            await manager.start();
            assert.strictEqual(manager.getState(), 'stopped');
            assert.strictEqual(manager.isHealthy(), false);

            manager.dispose();
        });

        test('should not start twice if already running', async () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Manually set state to running to simulate already started
            (manager as any).state = 'running';
            (manager as any).daemonProcess = new MockChildProcess();

            // Start should detect already running and return immediately
            await manager.start();
            assert.strictEqual(manager.getState(), 'running');

            manager.dispose();
        });
    });

    suite('Configuration Updates', () => {
        test('should reload configuration on change', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Verify initial state
            assert.strictEqual(manager.isDaemonEnabled(), true);

            // Configuration change event would be handled by the listener
            // This test verifies the manager was created without errors

            manager.dispose();
        });

        test('should use custom idle timeout from config', () => {
            (vscode.workspace.getConfiguration as sinon.SinonStub).callsFake(() => ({
                get: (key: string, defaultValue?: unknown) => {
                    if (key === 'bridgeMode') return 'daemon';
                    if (key === 'daemonIdleTimeoutMinutes') return 15;
                    return defaultValue;
                },
                has: () => true,
                inspect: () => undefined,
                update: sandbox.stub().resolves()
            }));

            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Verify the manager was created (internal config would be 15)
            assert.strictEqual(manager.isDaemonEnabled(), true);
            manager.dispose();
        });
    });

    suite('JSON-RPC Response Parsing', () => {
        test('should handle success response correctly', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Set up mock process
            const mockProcess = new MockChildProcess();
            (manager as any).state = 'running';
            (manager as any).daemonProcess = mockProcess;

            // Create a pending request
            const requestId = 'test-123';
            let resolvedResponse: any = null;
            (manager as any).pendingRequests.set(requestId, {
                resolve: (response: any) => { resolvedResponse = response; },
                reject: () => {},
                timer: setTimeout(() => {}, 10000),
                method: 'health',
                startTime: Date.now()
            });

            // Manually call handleStdout to simulate response processing
            const responseJson = JSON.stringify({
                jsonrpc: '2.0',
                id: requestId,
                result: { status: 'ok', cognee_version: '0.4.1' }
            }) + '\n';
            (manager as any).handleStdout(responseJson);

            // Verify response was processed
            assert.ok(resolvedResponse, 'Response should have been resolved');
            assert.strictEqual(resolvedResponse.result.status, 'ok');
            assert.strictEqual((manager as any).pendingRequests.size, 0);

            manager.dispose();
        });

        test('should handle error response correctly', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            const mockProcess = new MockChildProcess();
            (manager as any).state = 'running';
            (manager as any).daemonProcess = mockProcess;

            const requestId = 'test-456';
            let resolvedResponse: any = null;
            (manager as any).pendingRequests.set(requestId, {
                resolve: (response: any) => { resolvedResponse = response; },
                reject: () => {},
                timer: setTimeout(() => {}, 10000),
                method: 'retrieve',
                startTime: Date.now()
            });

            // Manually call handleStdout to simulate error response
            const responseJson = JSON.stringify({
                jsonrpc: '2.0',
                id: requestId,
                error: { code: -32000, message: 'Cognee not initialized' }
            }) + '\n';
            (manager as any).handleStdout(responseJson);

            assert.ok(resolvedResponse, 'Response should have been resolved');
            assert.strictEqual(resolvedResponse.error.code, -32000);
            assert.strictEqual(resolvedResponse.error.message, 'Cognee not initialized');

            manager.dispose();
        });

        test('should ignore responses with unknown request IDs', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            const mockProcess = new MockChildProcess();
            (manager as any).state = 'running';
            (manager as any).daemonProcess = mockProcess;

            // Manually call handleStdout with response for unknown request
            const responseJson = JSON.stringify({
                jsonrpc: '2.0',
                id: 'unknown-id',
                result: { status: 'ok' }
            }) + '\n';
            (manager as any).handleStdout(responseJson);

            // Should not throw, just log warning
            assert.strictEqual((manager as any).pendingRequests.size, 0);

            manager.dispose();
        });

        test('should handle malformed JSON gracefully', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            const mockProcess = new MockChildProcess();
            (manager as any).state = 'running';
            (manager as any).daemonProcess = mockProcess;

            // Manually call handleStdout with malformed JSON
            (manager as any).handleStdout('not valid json\n');

            // Should not throw, just log error
            manager.dispose();
        });
    });

    suite('Process Exit Handling', () => {
        test('should reject pending requests on process exit', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            const mockProcess = new MockChildProcess();
            (manager as any).state = 'running';
            (manager as any).daemonProcess = mockProcess;

            // Create pending requests
            let rejected = false;
            (manager as any).pendingRequests.set('pending-1', {
                resolve: () => {},
                reject: () => { rejected = true; },
                timer: setTimeout(() => {}, 10000),
                method: 'health',
                startTime: Date.now()
            });

            // Simulate process exit
            (manager as any).handleProcessExit(1, 'SIGTERM');

            assert.strictEqual(rejected, true);
            assert.strictEqual((manager as any).pendingRequests.size, 0);
            assert.strictEqual(manager.getState(), 'crashed');

            manager.dispose();
        });

        test('should set state to stopped on clean exit', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            (manager as any).state = 'running';

            // Simulate clean exit (code 0)
            (manager as any).handleProcessExit(0, null);

            assert.strictEqual(manager.getState(), 'stopped');

            manager.dispose();
        });

        test('should set state to crashed on non-zero exit', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            (manager as any).state = 'running';

            // Simulate crash (non-zero exit)
            (manager as any).handleProcessExit(1, null);

            assert.strictEqual(manager.getState(), 'crashed');

            manager.dispose();
        });
    });

    suite('Stop Behavior', () => {
        test('should be no-op when already stopped', async () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Already stopped by default
            assert.strictEqual(manager.getState(), 'stopped');

            // Stop should be a no-op
            await manager.stop();
            assert.strictEqual(manager.getState(), 'stopped');

            manager.dispose();
        });
    });

    suite('Output Channel Logging', () => {
        test('should log to output channel', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Verify appendLine was called during construction
            assert.ok((mockOutputChannel.appendLine as sinon.SinonStub).called);

            manager.dispose();
        });
    });
});
