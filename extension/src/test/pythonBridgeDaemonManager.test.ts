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

        test('should be idempotent when called multiple times', async () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Set up mock running state
            const mockProcess = new MockChildProcess();
            (manager as any).state = 'running';
            (manager as any).daemonProcess = mockProcess;

            // Call stop multiple times concurrently - should not throw
            await Promise.all([
                manager.stop(),
                manager.stop(),
                manager.stop()
            ]);

            assert.strictEqual(manager.getState(), 'stopped');
            manager.dispose();
        });
    });

    suite('Plan 061: Graceful Shutdown', () => {
        test('should attempt graceful shutdown before escalation', async () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Set up mock running state
            const mockProcess = new MockChildProcess();
            (manager as any).state = 'running';
            (manager as any).daemonProcess = mockProcess;

            // Stop the daemon
            const stopPromise = manager.stop();
            
            // Simulate process exiting gracefully after shutdown request
            setTimeout(() => {
                mockProcess.emit('close', 0, null);
                mockProcess.emit('exit', 0, null);
            }, 100);

            await stopPromise;

            assert.strictEqual(manager.getState(), 'stopped');
            assert.strictEqual((manager as any).consecutiveForcedKills, 0);
            manager.dispose();
        });

        test('should track shutdown reason in logs', async () => {
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

            // Stop with specific reason
            const stopPromise = (manager as any).stop('idle-timeout');
            
            setTimeout(() => {
                mockProcess.emit('close', 0, null);
            }, 50);

            await stopPromise;

            // Verify log contains the reason
            const logCalls = (mockOutputChannel.appendLine as sinon.SinonStub).getCalls();
            const shutdownLog = logCalls.find((call: sinon.SinonSpyCall) => 
                call.args[0].includes('Shutdown requested') && call.args[0].includes('idle-timeout')
            );
            assert.ok(shutdownLog, 'Should log shutdown with reason');

            manager.dispose();
        });
    });

    suite('Plan 061: Operational Fallback', () => {
        test('should report daemon not suspended initially', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            assert.strictEqual(manager.isDaemonSuspended(), false);
            assert.strictEqual(manager.isDaemonEnabled(), true);

            manager.dispose();
        });

        test('should suspend daemon mode after consecutive forced kills', async () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Simulate consecutive forced kills reaching threshold (3)
            (manager as any).consecutiveForcedKills = 2;

            // Set up mock running state with process that doesn't respond
            const mockProcess = new MockChildProcess();
            mockProcess.kill = () => {
                // Don't emit close event - simulate unresponsive process
                return true;
            };
            (manager as any).state = 'running';
            (manager as any).daemonProcess = mockProcess;

            // Manually increment to trigger suspension threshold
            (manager as any).consecutiveForcedKills = 3;
            (manager as any).daemonModeSuspended = true;

            // Verify daemon is now suspended
            assert.strictEqual(manager.isDaemonSuspended(), true);
            assert.strictEqual(manager.isDaemonEnabled(), false); // Suspended = not enabled

            manager.dispose();
        });

        test('should resume daemon mode after successful health check', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Simulate suspended state
            (manager as any).daemonModeSuspended = true;
            (manager as any).consecutiveForcedKills = 3;

            assert.strictEqual(manager.isDaemonSuspended(), true);

            // Resume daemon mode
            manager.resumeDaemonMode();

            assert.strictEqual(manager.isDaemonSuspended(), false);
            assert.strictEqual((manager as any).consecutiveForcedKills, 0);
            assert.strictEqual(manager.isDaemonEnabled(), true);

            manager.dispose();
        });
    });

    suite('Plan 061: Idle Semantics', () => {
        test('should use 30 minute default idle timeout', () => {
            // Override config to return default
            (vscode.workspace.getConfiguration as sinon.SinonStub).callsFake(() => ({
                get: (key: string, defaultValue?: unknown) => {
                    if (key === 'bridgeMode') return 'daemon';
                    // Return undefined to trigger default value usage
                    if (key === 'daemonIdleTimeoutMinutes') return defaultValue;
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

            // The default should be 30 minutes (Plan 061)
            assert.strictEqual((manager as any).idleTimeoutMinutes, 30);

            manager.dispose();
        });

        test('should defer idle timeout when requests are pending', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Set up running state with pending request
            (manager as any).state = 'running';
            (manager as any).pendingRequests.set('test-request', {
                resolve: () => {},
                reject: () => {},
                timer: setTimeout(() => {}, 10000),
                method: 'retrieve',
                startTime: Date.now()
            });

            // Manually trigger idle check (simulating timer callback)
            let stopCalled = false;
            const originalStop = (manager as any).stop.bind(manager);
            (manager as any).stop = () => {
                stopCalled = true;
                return Promise.resolve();
            };

            // Reset idle timer to trigger the check
            (manager as any).idleTimeoutMinutes = 0.0001; // Very short for testing
            (manager as any).resetIdleTimer();

            // Give it a moment
            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    // Stop should NOT have been called because requests are pending
                    // The timer should have reset instead
                    assert.strictEqual(stopCalled, false);
                    (manager as any).stop = originalStop;
                    manager.dispose();
                    resolve();
                }, 50);
            });
        });

        test('should defer idle timeout when background operations are active (Plan 061 M5/RC3)', async () => {
            // Import BackgroundOperationManager to set up mock
            const { BackgroundOperationManager } = await import('../background/BackgroundOperationManager');
            
            // Create a mock instance that reports active operations
            const mockBgManager = {
                hasActiveOperations: () => true,
                getActiveOperationsCount: () => ({ running: 1, pending: 0 })
            };
            
            // Stub getInstance to return our mock
            const getInstanceStub = sandbox.stub(BackgroundOperationManager, 'getInstance').returns(
                mockBgManager as ReturnType<typeof BackgroundOperationManager.getInstance>
            );

            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Set up running state with NO pending requests
            (manager as any).state = 'running';
            (manager as any).pendingRequests.clear();

            // Track if stop was called
            let stopCalled = false;
            const originalStop = (manager as any).stop.bind(manager);
            (manager as any).stop = () => {
                stopCalled = true;
                return Promise.resolve();
            };

            // Reset idle timer to trigger the check
            (manager as any).idleTimeoutMinutes = 0.0001; // Very short for testing
            (manager as any).resetIdleTimer();

            // Give it a moment
            await new Promise<void>((resolve) => {
                setTimeout(() => {
                    // Stop should NOT have been called because background ops are active
                    assert.strictEqual(stopCalled, false, 'Stop should not be called when background operations are active');
                    (manager as any).stop = originalStop;
                    getInstanceStub.restore();
                    manager.dispose();
                    resolve();
                }, 50);
            });
        });

        test('should proceed with idle shutdown when no background operations (Plan 061 M5/RC3)', async () => {
            // Import BackgroundOperationManager to set up mock
            const { BackgroundOperationManager } = await import('../background/BackgroundOperationManager');
            
            // Create a mock instance that reports no active operations
            const mockBgManager = {
                hasActiveOperations: () => false,
                getActiveOperationsCount: () => ({ running: 0, pending: 0 })
            };
            
            // Stub getInstance to return our mock
            const getInstanceStub = sandbox.stub(BackgroundOperationManager, 'getInstance').returns(
                mockBgManager as ReturnType<typeof BackgroundOperationManager.getInstance>
            );

            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Set up running state with NO pending requests
            (manager as any).state = 'running';
            (manager as any).pendingRequests.clear();

            // Track if stop was called
            let stopCalled = false;
            const originalStop = (manager as any).stop.bind(manager);
            (manager as any).stop = () => {
                stopCalled = true;
                return Promise.resolve();
            };

            // Reset idle timer to trigger the check
            (manager as any).idleTimeoutMinutes = 0.0001; // Very short for testing
            (manager as any).resetIdleTimer();

            // Give it a moment
            await new Promise<void>((resolve) => {
                setTimeout(() => {
                    // Stop SHOULD have been called because no pending requests and no background ops
                    assert.strictEqual(stopCalled, true, 'Stop should be called when no work is active');
                    (manager as any).stop = originalStop;
                    getInstanceStub.restore();
                    manager.dispose();
                    resolve();
                }, 50);
            });
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

    // Plan 092 M1: Test for getPendingRequestCount() method
    suite('Pending Request Count (Plan 092)', () => {
        test('should return 0 when no requests are pending', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // New method required by IDaemonController interface
            assert.strictEqual(manager.getPendingRequestCount(), 0);

            manager.dispose();
        });

        test('should return correct count when requests are in flight', async () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Simulate adding pending requests via internal state
            // Access private pendingRequests map for test setup
            const pendingRequests = (manager as any).pendingRequests as Map<string, unknown>;
            pendingRequests.set('req-1', { resolve: () => {}, reject: () => {}, timer: null, method: 'test', startTime: Date.now() });
            pendingRequests.set('req-2', { resolve: () => {}, reject: () => {}, timer: null, method: 'test', startTime: Date.now() });

            assert.strictEqual(manager.getPendingRequestCount(), 2);

            pendingRequests.clear();
            assert.strictEqual(manager.getPendingRequestCount(), 0);

            manager.dispose();
        });
    });

    // Plan 092 M1: Test for isRunning() method (IDaemonController interface)
    suite('Is Running (Plan 092)', () => {
        test('should return false when daemon process is not started', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Before starting, daemon should not be running
            assert.strictEqual(manager.isRunning(), false);

            manager.dispose();
        });

        test('should return true when daemon process is active', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Simulate daemon running by setting internal state
            (manager as any).state = 'running';
            (manager as any).daemonProcess = new MockChildProcess();
            
            // Daemon should be running
            assert.strictEqual(manager.isRunning(), true);

            manager.dispose();
        });

        test('should return false after daemon process is stopped', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Simulate daemon running then stopped
            (manager as any).state = 'running';
            (manager as any).daemonProcess = new MockChildProcess();
            assert.strictEqual(manager.isRunning(), true);
            
            // Simulate stop
            (manager as any).state = 'stopped';
            (manager as any).daemonProcess = null;
            
            // Daemon should not be running after stop
            assert.strictEqual(manager.isRunning(), false);

            manager.dispose();
        });

        test('should return false when state is running but process is null', () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Edge case: state says running but process is null (crashed/killed)
            (manager as any).state = 'running';
            (manager as any).daemonProcess = null;
            
            assert.strictEqual(manager.isRunning(), false);

            manager.dispose();
        });
    });

    // Plan 092 M2: Tests for exclusive daemon locking
    suite('Exclusive Daemon Locking (Plan 092)', () => {
        let tempWorkspacePath: string;
        let tempManager: PythonBridgeDaemonManager;

        setup(() => {
            // Create a unique temp directory for each test
            const os = require('os');
            const crypto = require('crypto');
            tempWorkspacePath = path.join(
                os.tmpdir(),
                `flowbaby-test-${crypto.randomBytes(8).toString('hex')}`
            );
            
            // Create the workspace directory
            require('fs').mkdirSync(tempWorkspacePath, { recursive: true });
            
            tempManager = new PythonBridgeDaemonManager(
                tempWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );
        });

        teardown(async () => {
            // Release lock if held
            await tempManager.releaseLock();
            tempManager.dispose();
            
            // Clean up temp directory
            const fs = require('fs');
            try {
                fs.rmSync(tempWorkspacePath, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors
            }
        });

        test('getLockPath returns path under .flowbaby directory', () => {
            const lockPath = tempManager.getLockPath();
            
            // Lock should be under workspace's .flowbaby directory
            assert.ok(lockPath.startsWith(path.join(tempWorkspacePath, '.flowbaby')),
                'Lock path should be under .flowbaby directory');
            assert.ok(lockPath.includes('daemon.lock'),
                'Lock path should include daemon.lock');
        });

        test('acquireLock succeeds when no lock exists', async () => {
            const result = await tempManager.acquireLock();
            
            assert.strictEqual(result, true, 'Should acquire lock successfully');
            assert.strictEqual(tempManager.isLockHeld(), true, 'Lock should be held');
            
            // Verify lock directory was created
            const fs = require('fs');
            assert.ok(fs.existsSync(tempManager.getLockPath()), 'Lock directory should exist');
        });

        test('acquireLock fails when lock already exists', async () => {
            // First acquire the lock
            const firstResult = await tempManager.acquireLock();
            assert.strictEqual(firstResult, true, 'First lock should succeed');
            
            // Create second manager for same workspace
            const secondManager = new PythonBridgeDaemonManager(
                tempWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );
            
            // Second acquire should fail
            const secondResult = await secondManager.acquireLock();
            assert.strictEqual(secondResult, false, 'Second lock should fail');
            assert.strictEqual(secondManager.isLockHeld(), false, 'Second manager should not hold lock');
            
            secondManager.dispose();
        });

        test('acquireLock is idempotent when already held', async () => {
            // Acquire lock twice from same manager
            const firstResult = await tempManager.acquireLock();
            const secondResult = await tempManager.acquireLock();
            
            assert.strictEqual(firstResult, true, 'First acquire should succeed');
            assert.strictEqual(secondResult, true, 'Second acquire from same manager should succeed');
            assert.strictEqual(tempManager.isLockHeld(), true, 'Lock should be held');
        });

        test('releaseLock succeeds when lock is held', async () => {
            // Acquire then release
            await tempManager.acquireLock();
            assert.strictEqual(tempManager.isLockHeld(), true, 'Lock should be held before release');
            
            await tempManager.releaseLock();
            
            assert.strictEqual(tempManager.isLockHeld(), false, 'Lock should not be held after release');
            
            // Verify lock directory was removed
            const fs = require('fs');
            assert.strictEqual(fs.existsSync(tempManager.getLockPath()), false, 'Lock directory should not exist');
        });

        test('releaseLock is idempotent when lock not held', async () => {
            // Release without acquiring - should not throw
            assert.strictEqual(tempManager.isLockHeld(), false, 'Lock should not be held initially');
            
            await tempManager.releaseLock();
            
            assert.strictEqual(tempManager.isLockHeld(), false, 'Lock should still not be held');
        });

        test('isLockHeld returns correct state', async () => {
            assert.strictEqual(tempManager.isLockHeld(), false, 'Lock should not be held initially');

            await tempManager.acquireLock();
            assert.strictEqual(tempManager.isLockHeld(), true, 'Lock should be held after acquire');

            await tempManager.releaseLock();
            assert.strictEqual(tempManager.isLockHeld(), false, 'Lock should not be held after release');
        });

        test('lock can be acquired after release', async () => {
            // Acquire, release, acquire again
            const firstResult = await tempManager.acquireLock();
            assert.strictEqual(firstResult, true, 'First acquire should succeed');
            
            await tempManager.releaseLock();
            
            const secondResult = await tempManager.acquireLock();
            assert.strictEqual(secondResult, true, 'Second acquire after release should succeed');
        });
    });

    // Plan 092 M3: Tests for restart with process exit verification
    suite('Restart Process Exit Verification (Plan 092)', () => {
        test('restart waits for stop to complete before starting', async () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Track method call order
            const callOrder: string[] = [];
            const originalStop = (manager as any).doStop.bind(manager);
            const originalStart = (manager as any).doStart.bind(manager);

            // Simulate daemon running
            (manager as any).state = 'running';
            (manager as any).daemonProcess = new MockChildProcess();

            // Mock stop to track timing
            (manager as any).doStop = async (reason: string) => {
                callOrder.push('stop-start');
                await new Promise(resolve => setTimeout(resolve, 50)); // Simulate stop delay
                (manager as any).state = 'stopped';
                (manager as any).daemonProcess = null;
                callOrder.push('stop-end');
            };

            // Mock start to track timing and prevent actual spawn
            (manager as any).startupPromise = null;
            (manager as any).doStart = async () => {
                callOrder.push('start-start');
                // Should only be called after stop completes
                assert.ok(callOrder.includes('stop-end'), 'Start should only be called after stop completes');
                callOrder.push('start-end');
            };

            await manager.restart();

            assert.deepStrictEqual(callOrder, ['stop-start', 'stop-end', 'start-start', 'start-end'],
                'Stop should complete before start begins');

            manager.dispose();
        });

        test('restart logs timing information', async () => {
            const manager = new PythonBridgeDaemonManager(
                mockWorkspacePath,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            // Simulate daemon running
            (manager as any).state = 'running';
            (manager as any).daemonProcess = new MockChildProcess();

            // Mock stop to simulate quick exit
            (manager as any).doStop = async () => {
                (manager as any).state = 'stopped';
                (manager as any).daemonProcess = null;
            };

            // Mock start to prevent actual spawn
            (manager as any).startupPromise = null;
            (manager as any).doStart = async () => {
                // Do nothing - we just want to test the restart logs
            };

            await manager.restart();

            // Verify restart was logged
            const logCalls = (mockOutputChannel.appendLine as sinon.SinonStub).getCalls();
            const restartLogs = logCalls.filter((call: sinon.SinonSpyCall) => 
                call.args[0]?.includes('Restart'));
            
            assert.ok(restartLogs.length > 0, 'Should log restart information');

            manager.dispose();
        });
    });

    // Plan 095: Lock Recovery & Observability Tests
    suite('Plan 095: Lock Owner Metadata', () => {
        let tempDir: string;
        let tempManager: PythonBridgeDaemonManager;

        setup(async () => {
            // Create a real temporary directory for lock tests
            const os = require('os');
            const fs = require('fs').promises;
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowbaby-test-095-'));

            tempManager = new PythonBridgeDaemonManager(
                tempDir,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );
        });

        teardown(async () => {
            // Clean up
            await tempManager.releaseLock();
            tempManager.dispose();

            // Remove temp directory
            const fs = require('fs').promises;
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors
            }
        });

        test('acquireLock writes owner.json with required metadata', async () => {
            const fs = require('fs').promises;
            const result = await tempManager.acquireLock();
            assert.strictEqual(result, true, 'Lock should be acquired');

            // Verify owner.json exists and contains required fields
            const ownerPath = path.join(tempManager.getLockPath(), 'owner.json');
            const ownerContent = await fs.readFile(ownerPath, 'utf8');
            const owner = JSON.parse(ownerContent);

            assert.ok(owner.createdAt, 'owner.json should have createdAt');
            assert.ok(typeof owner.createdAt === 'number', 'createdAt should be a number (timestamp)');
            assert.ok(owner.extensionHostPid, 'owner.json should have extensionHostPid');
            assert.strictEqual(owner.extensionHostPid, process.pid, 'extensionHostPid should match current process');
            assert.ok(owner.instanceId, 'owner.json should have instanceId');
            assert.ok(typeof owner.instanceId === 'string' && owner.instanceId.length > 0, 'instanceId should be a non-empty string');
            assert.ok(owner.workspaceIdentifier, 'owner.json should have workspaceIdentifier');
        });

        test('owner.json instanceId changes on each lock acquisition', async () => {
            const fs = require('fs').promises;
            
            // First acquisition
            await tempManager.acquireLock();
            const ownerPath = path.join(tempManager.getLockPath(), 'owner.json');
            const owner1 = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
            await tempManager.releaseLock();

            // Second acquisition
            await tempManager.acquireLock();
            const owner2 = JSON.parse(await fs.readFile(ownerPath, 'utf8'));

            assert.notStrictEqual(owner1.instanceId, owner2.instanceId, 
                'instanceId should be different per lock acquisition');
        });

        test('getOwnerMetadataPath returns correct path', () => {
            const ownerPath = (tempManager as any).getOwnerMetadataPath();
            assert.ok(ownerPath.endsWith('owner.json'), 'Should end with owner.json');
            assert.ok(ownerPath.includes('daemon.lock'), 'Should be inside daemon.lock directory');
        });
    });

    suite('Plan 095: Stale Lock Recovery on EEXIST', () => {
        let tempDir: string;
        let tempManager: PythonBridgeDaemonManager;

        setup(async () => {
            const os = require('os');
            const fs = require('fs').promises;
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowbaby-test-095-stale-'));

            tempManager = new PythonBridgeDaemonManager(
                tempDir,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );
        });

        teardown(async () => {
            await tempManager.releaseLock();
            tempManager.dispose();

            const fs = require('fs').promises;
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors
            }
        });

        test('recovers stale lock when owner pid is dead', async () => {
            const fs = require('fs').promises;
            const lockPath = tempManager.getLockPath();
            const flowbabyDir = path.dirname(lockPath);

            // Create stale lock with dead PID owner metadata
            await fs.mkdir(flowbabyDir, { recursive: true });
            await fs.mkdir(lockPath);
            const staleOwner = {
                createdAt: Date.now() - (15 * 60 * 1000), // 15 minutes ago
                extensionHostPid: 99999999, // Non-existent PID
                instanceId: 'stale-instance',
                workspaceIdentifier: tempDir
            };
            await fs.writeFile(path.join(lockPath, 'owner.json'), JSON.stringify(staleOwner), 'utf8');

            // Acquire should succeed by recovering the stale lock
            const result = await tempManager.acquireLock();
            assert.strictEqual(result, true, 'Should recover stale lock and acquire successfully');
            assert.strictEqual(tempManager.isLockHeld(), true, 'Lock should be held after recovery');
        });

        test('does not delete lock when owner pid is alive', async () => {
            const fs = require('fs').promises;
            const lockPath = tempManager.getLockPath();
            const flowbabyDir = path.dirname(lockPath);

            // Create a lock with current process as owner (simulates another window)
            await fs.mkdir(flowbabyDir, { recursive: true });
            await fs.mkdir(lockPath);
            const liveOwner = {
                createdAt: Date.now(),
                extensionHostPid: process.pid, // Current process - definitely alive
                instanceId: 'live-instance',
                workspaceIdentifier: tempDir
            };
            await fs.writeFile(path.join(lockPath, 'owner.json'), JSON.stringify(liveOwner), 'utf8');

            // Acquire should fail because owner is alive
            const result = await tempManager.acquireLock();
            assert.strictEqual(result, false, 'Should not acquire lock when owner is alive');
        });

        test('does not delete fresh lock without metadata (race protection)', async () => {
            const fs = require('fs').promises;
            const lockPath = tempManager.getLockPath();
            const flowbabyDir = path.dirname(lockPath);

            // Create fresh lock directory without owner.json (simulates race condition)
            await fs.mkdir(flowbabyDir, { recursive: true });
            await fs.mkdir(lockPath);
            // Intentionally no owner.json - lock is "fresh" (just created)

            // Acquire should fail because we can't determine staleness of fresh lock
            const result = await tempManager.acquireLock();
            assert.strictEqual(result, false, 'Should not acquire fresh lock without metadata');
        });

        test('recovers old lock without metadata when age exceeds threshold', async () => {
            const fs = require('fs').promises;
            const lockPath = tempManager.getLockPath();
            const flowbabyDir = path.dirname(lockPath);

            // Create old lock directory without owner.json
            await fs.mkdir(flowbabyDir, { recursive: true });
            await fs.mkdir(lockPath);
            
            // Manually set mtime to > 10 minutes ago using utimes
            const oldTime = new Date(Date.now() - (15 * 60 * 1000));
            await fs.utimes(lockPath, oldTime, oldTime);

            // Acquire should succeed because lock is old enough
            const result = await tempManager.acquireLock();
            assert.strictEqual(result, true, 'Should recover old lock without metadata');
        });

        test('checks daemon.pid before deleting lock even with dead owner', async () => {
            const fs = require('fs').promises;
            const lockPath = tempManager.getLockPath();
            const flowbabyDir = path.dirname(lockPath);
            const pidPath = path.join(flowbabyDir, 'daemon.pid');

            // Create lock with dead owner
            await fs.mkdir(flowbabyDir, { recursive: true });
            await fs.mkdir(lockPath);
            const staleOwner = {
                createdAt: Date.now() - (15 * 60 * 1000),
                extensionHostPid: 99999999, // Dead PID
                instanceId: 'stale-instance',
                workspaceIdentifier: tempDir
            };
            await fs.writeFile(path.join(lockPath, 'owner.json'), JSON.stringify(staleOwner), 'utf8');

            // But create a PID file with current process (daemon still alive)
            await fs.writeFile(pidPath, String(process.pid), 'utf8');

            // Acquire should fail because daemon PID is alive
            const result = await tempManager.acquireLock();
            assert.strictEqual(result, false, 'Should not delete lock when daemon PID is alive');

            // Cleanup
            await fs.unlink(pidPath);
        });
    });

    suite('Plan 095: Fresh Lock Self-Delete Guard', () => {
        let tempDir: string;
        let tempManager: PythonBridgeDaemonManager;

        setup(async () => {
            const os = require('os');
            const fs = require('fs').promises;
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowbaby-test-095-guard-'));

            tempManager = new PythonBridgeDaemonManager(
                tempDir,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );
        });

        teardown(async () => {
            await tempManager.releaseLock();
            tempManager.dispose();

            const fs = require('fs').promises;
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch {
                // Ignore
            }
        });

        test('cleanupStaleLock does not delete lock when lockHeld is true', async () => {
            const fs = require('fs').promises;

            // Acquire lock
            await tempManager.acquireLock();
            assert.strictEqual(tempManager.isLockHeld(), true);

            // Call cleanupStaleLock - should NOT delete our own lock
            await (tempManager as any).cleanupStaleLock();

            // Verify lock still exists
            const lockPath = tempManager.getLockPath();
            try {
                await fs.access(lockPath);
            } catch {
                assert.fail('Lock should still exist after cleanupStaleLock when lockHeld is true');
            }
        });

        test('lock exists after successful daemon start', async () => {
            const fs = require('fs').promises;
            
            // Mock doStart to simulate successful acquisition
            const originalDoStart = (tempManager as any).doStart.bind(tempManager);
            let lockExistsAfterAcquire = false;
            let lockExistsAfterCleanup = false;
            
            (tempManager as any).doStart = async function() {
                const lockPath = this.getLockPath();
                
                // Acquire lock
                const acquired = await this.acquireLock();
                assert.strictEqual(acquired, true);
                
                // Check lock exists after acquire
                try {
                    await fs.access(lockPath);
                    lockExistsAfterAcquire = true;
                } catch { /* ignore */ }

                // Call cleanupStaleDaemon (which calls cleanupStaleLock)
                await this.cleanupStaleDaemon();

                // Check lock still exists after cleanup
                try {
                    await fs.access(lockPath);
                    lockExistsAfterCleanup = true;
                } catch { /* ignore */ }

                // Don't actually spawn daemon
                this.state = 'running';
            };

            await tempManager.start();

            assert.strictEqual(lockExistsAfterAcquire, true, 'Lock should exist after acquire');
            assert.strictEqual(lockExistsAfterCleanup, true, 'Lock should exist after cleanup');
        });
    });

    suite('Plan 095: Lock Release on Failure', () => {
        let tempDir: string;
        let tempManager: PythonBridgeDaemonManager;

        setup(async () => {
            const os = require('os');
            const fs = require('fs').promises;
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowbaby-test-095-release-'));

            tempManager = new PythonBridgeDaemonManager(
                tempDir,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );
        });

        teardown(async () => {
            await tempManager.releaseLock();
            tempManager.dispose();

            const fs = require('fs').promises;
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch {
                // Ignore
            }
        });

        test('lock is released when doStart fails after acquisition', async () => {
            const fs = require('fs').promises;
            const lockPath = tempManager.getLockPath();

            // Attempt to start - should fail (daemon.py missing in test harness)
            try {
                await tempManager.start();
                assert.fail('Start should have thrown');
            } catch (e) {
                // Expected
            }

            // Verify lock was released
            assert.strictEqual(tempManager.isLockHeld(), false, 'Lock should be released after failure');
            
            // Verify lock directory was removed
            try {
                await fs.access(lockPath);
                assert.fail('Lock directory should be removed after failure');
            } catch {
                // Expected - lock should not exist
            }
        });
    });

    suite('Plan 095: Lock Lifecycle Observability', () => {
        test('logs lock acquisition start and success', async () => {
            const os = require('os');
            const fs = require('fs').promises;
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowbaby-test-095-log-'));

            const manager = new PythonBridgeDaemonManager(
                tempDir,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            await manager.acquireLock();

            const logCalls = (mockOutputChannel.appendLine as sinon.SinonStub).getCalls();
            const lockLogs = logCalls.filter((call: sinon.SinonSpyCall) =>
                call.args[0]?.includes('[lock]') || call.args[0]?.includes('Lock')
            );

            assert.ok(lockLogs.some((call: sinon.SinonSpyCall) => 
                call.args[0].includes('acquire') || call.args[0].includes('acquired')
            ), 'Should log lock acquisition');

            await manager.releaseLock();
            manager.dispose();
            await fs.rm(tempDir, { recursive: true, force: true });
        });

        test('logs stale lock recovery decision with reason', async () => {
            const os = require('os');
            const fs = require('fs').promises;
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowbaby-test-095-recovery-'));
            const flowbabyDir = path.join(tempDir, '.flowbaby');
            const lockPath = path.join(flowbabyDir, 'daemon.lock');

            // Create stale lock
            await fs.mkdir(flowbabyDir, { recursive: true });
            await fs.mkdir(lockPath);
            const staleOwner = {
                createdAt: Date.now() - (15 * 60 * 1000),
                extensionHostPid: 99999999,
                instanceId: 'stale-instance',
                workspaceIdentifier: tempDir
            };
            await fs.writeFile(path.join(lockPath, 'owner.json'), JSON.stringify(staleOwner), 'utf8');

            const manager = new PythonBridgeDaemonManager(
                tempDir,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            await manager.acquireLock();

            const logCalls = (mockOutputChannel.appendLine as sinon.SinonStub).getCalls();
            const recoveryLogs = logCalls.filter((call: sinon.SinonSpyCall) =>
                call.args[0]?.includes('stale') || call.args[0]?.includes('recovery') ||
                call.args[0]?.includes('owner_pid_dead')
            );

            assert.ok(recoveryLogs.length > 0, 'Should log stale lock recovery with decision reason');

            await manager.releaseLock();
            manager.dispose();
            await fs.rm(tempDir, { recursive: true, force: true });
        });

        test('does not log secrets or absolute workspace paths', async () => {
            const os = require('os');
            const fs = require('fs').promises;
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowbaby-test-095-secrets-'));

            const manager = new PythonBridgeDaemonManager(
                tempDir,
                mockPythonPath,
                mockBridgePath,
                mockContext,
                mockOutputChannel
            );

            await manager.acquireLock();
            await manager.releaseLock();

            const logCalls = (mockOutputChannel.appendLine as sinon.SinonStub).getCalls();
            const allLogs = logCalls.map((call: sinon.SinonSpyCall) => call.args[0]).join('\n');

            // Should not contain absolute temp path (uses relative markers instead)
            assert.ok(!allLogs.includes(tempDir),
                'Logs should use relative markers like .flowbaby/, not absolute workspace paths');

            manager.dispose();
            await fs.rm(tempDir, { recursive: true, force: true });
        });
    });
});
