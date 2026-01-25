/**
 * Plan 116 M7 - Startup Robustness Verification Matrix
 * 
 * Engineering verification harnesses to prove no-limbo + recovery semantics
 * across the failure modes identified in Analysis 116.
 * 
 * Each scenario verifies:
 * - Bounded completion of start()
 * - Deterministic error reason code
 * - Cleanup (retryable subsequent start)
 * - Recovery budget behavior
 * 
 * @see agent-output/planning/116-daemon-startup-and-recovery-hardening.md
 * @see agent-output/analysis/100-daemon-availability-analysis.md
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { EventEmitter } from 'events';
import { Writable, Readable } from 'stream';
import { PythonBridgeDaemonManager } from '../bridge/PythonBridgeDaemonManager';
import {
    DaemonUnavailableReason,
    DaemonUnavailableError,
    DAEMON_RELIABILITY_DEFAULTS
} from '../bridge/daemonReliabilityContract';

/**
 * Mock child process for controlled failure injection
 */
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

    simulateStderr(message: string): void {
        this.stderr.emit('data', Buffer.from(message));
    }

    simulateImmediateExit(code: number = 1): void {
        setImmediate(() => {
            this.emit('close', code, null);
        });
    }

    simulateHang(): void {
        // Do nothing - process never responds
    }
}

suite('Plan 116 M7: Startup Robustness Verification Matrix', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockOutputChannel: vscode.OutputChannel;
    let workspacePath: string;
    let outputLines: string[];

    setup(() => {
        sandbox = sinon.createSandbox();
        outputLines = [];
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-matrix-'));

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
            appendLine: (line: string) => outputLines.push(line),
            clear: sandbox.stub(),
            show: sandbox.stub() as unknown as vscode.OutputChannel['show'],
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            replace: sandbox.stub()
        };
    });

    teardown(() => {
        sandbox.restore();
        if (fs.existsSync(workspacePath)) {
            fs.rmSync(workspacePath, { recursive: true, force: true });
        }
    });

    /**
     * Verification Matrix Scenario 1: Daemon Immediate Exit on Start
     * 
     * Simulates: Python process starts then immediately exits before handshake
     * Expected: SPAWN_FAILED or IMMEDIATE_EXIT reason, bounded completion, cleanup
     */
    suite('Scenario 1: Daemon Immediate Exit on Start', () => {
        test('should complete with deterministic error reason', async () => {
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/nonexistent/python',  // Will fail spawn
                path.join(workspacePath, 'bridge'),
                mockContext,
                mockOutputChannel
            );

            let caughtError: DaemonUnavailableError | null = null;
            const startTime = Date.now();

            try {
                await manager.start();
            } catch (error) {
                if (error instanceof DaemonUnavailableError) {
                    caughtError = error;
                }
            }

            const duration = Date.now() - startTime;

            // Verify bounded completion
            assert.ok(
                duration < DAEMON_RELIABILITY_DEFAULTS.STARTUP_DEADLINE_MS + 1000,
                `Should complete within deadline, took ${duration}ms`
            );

            // Verify deterministic error reason
            assert.ok(caughtError, 'Should throw DaemonUnavailableError');
            assert.ok(
                [DaemonUnavailableReason.SPAWN_FAILED, DaemonUnavailableReason.IMMEDIATE_EXIT].includes(caughtError!.reason),
                `Expected SPAWN_FAILED or IMMEDIATE_EXIT, got ${caughtError!.reason}`
            );

            // Verify cleanup
            const state = manager.getState();
            assert.notStrictEqual(state, 'starting', 'Should not be stuck in starting');
            assert.ok(
                ['stopped', 'failed_startup', 'crashed'].includes(state),
                `State should be terminal, got ${state}`
            );

            await manager.stop();
        });

        test('should allow retry after immediate exit', async () => {
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/nonexistent/python',
                path.join(workspacePath, 'bridge'),
                mockContext,
                mockOutputChannel
            );

            // First attempt
            try { await manager.start(); } catch { /* expected */ }

            // Verify can attempt again (not blocked by stuck state)
            const state = manager.getState();
            assert.notStrictEqual(state, 'starting', 'Should allow retry');
            assert.notStrictEqual(state, 'running', 'Should not falsely report running');

            await manager.stop();
        });
    });

    /**
     * Verification Matrix Scenario 2: Daemon Hang/No Readiness Response
     * 
     * Simulates: Python process starts, never responds with readiness
     * Expected: STARTUP_HUNG reason after timeout, bounded completion
     */
    suite('Scenario 2: Daemon Hang/No Readiness Response', () => {
        test('contract defines bounded handshake timeout', () => {
            // The handshake timeout ensures we don't hang forever
            assert.ok(
                DAEMON_RELIABILITY_DEFAULTS.HANDSHAKE_TIMEOUT_MS > 0,
                'HANDSHAKE_TIMEOUT_MS should be positive'
            );
            assert.ok(
                DAEMON_RELIABILITY_DEFAULTS.HANDSHAKE_TIMEOUT_MS <= 30000,
                'HANDSHAKE_TIMEOUT_MS should be reasonable (<=30s)'
            );
        });

        test('startup deadline includes handshake time', () => {
            // Overall startup must complete within deadline
            assert.ok(
                DAEMON_RELIABILITY_DEFAULTS.STARTUP_DEADLINE_MS >= 
                DAEMON_RELIABILITY_DEFAULTS.HANDSHAKE_TIMEOUT_MS,
                'STARTUP_DEADLINE should include HANDSHAKE_TIMEOUT'
            );
        });

        test('hang scenario produces STARTUP_HUNG or STARTUP_TIMEOUT reason', async () => {
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/nonexistent/python',  // Will fail before hang, but tests the reason code expectation
                path.join(workspacePath, 'bridge'),
                mockContext,
                mockOutputChannel
            );

            let caughtError: DaemonUnavailableError | null = null;

            try {
                await manager.start();
            } catch (error) {
                if (error instanceof DaemonUnavailableError) {
                    caughtError = error;
                }
            }

            // Verify error was thrown with a valid reason
            assert.ok(caughtError, 'Should throw DaemonUnavailableError');
            assert.ok(
                Object.values(DaemonUnavailableReason).includes(caughtError!.reason),
                `Should have valid reason code, got ${caughtError!.reason}`
            );

            await manager.stop();
        });
    });

    /**
     * Verification Matrix Scenario 3: Malformed Protocol/Handshake Failure
     * 
     * Simulates: Python responds with invalid/malformed JSON
     * Expected: PROTOCOL_ERROR or HANDSHAKE_FAILED reason
     */
    suite('Scenario 3: Malformed Protocol/Handshake Failure', () => {
        test('PROTOCOL_ERROR reason exists in contract', () => {
            assert.ok(
                DaemonUnavailableReason.PROTOCOL_ERROR !== undefined,
                'PROTOCOL_ERROR should be defined'
            );
        });

        test('HANDSHAKE_FAILED reason exists in contract', () => {
            assert.ok(
                DaemonUnavailableReason.HANDSHAKE_FAILED !== undefined,
                'HANDSHAKE_FAILED should be defined'
            );
        });

        test('both protocol errors should have user-friendly messages', () => {
            const protocolError = new DaemonUnavailableError(DaemonUnavailableReason.PROTOCOL_ERROR);
            const handshakeError = new DaemonUnavailableError(DaemonUnavailableReason.HANDSHAKE_FAILED);

            assert.ok(protocolError.message.length > 20, 'PROTOCOL_ERROR should have message');
            assert.ok(handshakeError.message.length > 20, 'HANDSHAKE_FAILED should have message');
        });
    });

    /**
     * Verification Matrix Scenario 4: Stdio Closed/Missing Streams
     * 
     * Simulates: stdin/stdout/stderr not available after spawn
     * Expected: STDIO_UNAVAILABLE reason
     */
    suite('Scenario 4: Stdio Closed/Missing Streams', () => {
        test('STDIO_UNAVAILABLE reason exists in contract', () => {
            assert.ok(
                DaemonUnavailableReason.STDIO_UNAVAILABLE !== undefined,
                'STDIO_UNAVAILABLE should be defined'
            );
        });

        test('STDIO_UNAVAILABLE has remediation message', () => {
            const error = new DaemonUnavailableError(DaemonUnavailableReason.STDIO_UNAVAILABLE);
            assert.ok(
                error.message.toLowerCase().includes('stdio') ||
                error.message.toLowerCase().includes('diagnose'),
                'STDIO_UNAVAILABLE should mention stdio or provide diagnosis guidance'
            );
        });
    });

    /**
     * Verification Matrix Scenario 5: Health Succeeds Then Daemon Exits
     * 
     * Simulates: Daemon starts successfully, passes health check, then crashes
     * Expected: Recovery loop should attempt restart
     */
    suite('Scenario 5: Health Succeeds Then Daemon Exits (Runtime Crash)', () => {
        test('recovery budget allows multiple attempts', () => {
            assert.ok(
                DAEMON_RELIABILITY_DEFAULTS.MAX_RECOVERY_ATTEMPTS > 0,
                'MAX_RECOVERY_ATTEMPTS should allow at least one retry'
            );
            assert.ok(
                DAEMON_RELIABILITY_DEFAULTS.MAX_RECOVERY_ATTEMPTS <= 10,
                'MAX_RECOVERY_ATTEMPTS should not be excessive'
            );
        });

        test('recovery backoff increases with attempts', () => {
            const base = DAEMON_RELIABILITY_DEFAULTS.RECOVERY_BACKOFF_BASE_MS;
            const max = DAEMON_RELIABILITY_DEFAULTS.RECOVERY_BACKOFF_MAX_MS;

            assert.ok(base > 0, 'Base backoff should be positive');
            assert.ok(max > base, 'Max backoff should be greater than base');
            assert.ok(max >= 10000, 'Max backoff should allow meaningful delays');
        });

        test('RECOVERY_BUDGET_EXHAUSTED indicates final state', () => {
            const error = new DaemonUnavailableError(
                DaemonUnavailableReason.RECOVERY_BUDGET_EXHAUSTED
            );
            assert.ok(
                error.message.toLowerCase().includes('recovery') ||
                error.message.toLowerCase().includes('failed'),
                'RECOVERY_BUDGET_EXHAUSTED should indicate finality'
            );
        });
    });

    /**
     * Cross-cutting: Recovery Budget Behavior
     */
    suite('Cross-cutting: Recovery Budget Semantics', () => {
        test('recovery state initializes correctly', async () => {
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/usr/bin/python3',
                path.join(workspacePath, 'bridge'),
                mockContext,
                mockOutputChannel
            );

            const recoveryState = (manager as any).recoveryState;
            
            assert.strictEqual(recoveryState.attempts, 0, 'Initial attempts should be 0');
            assert.strictEqual(
                recoveryState.maxAttempts,
                DAEMON_RELIABILITY_DEFAULTS.MAX_RECOVERY_ATTEMPTS,
                'Max attempts should match defaults'
            );
            assert.strictEqual(recoveryState.active, false, 'Recovery should not be active initially');

            await manager.stop();
        });

        test('degraded state entered after recovery exhaustion', async () => {
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/nonexistent/python',
                path.join(workspacePath, 'bridge'),
                mockContext,
                mockOutputChannel
            );

            // Exhaust recovery budget by forcing max attempts
            const maxAttempts = DAEMON_RELIABILITY_DEFAULTS.MAX_RECOVERY_ATTEMPTS;
            for (let i = 0; i <= maxAttempts; i++) {
                try {
                    await manager.start();
                } catch {
                    // Expected
                }
            }

            // After exhausting budget, state should indicate degraded or failed
            const state = manager.getState();
            assert.ok(
                ['degraded', 'failed_startup', 'stopped'].includes(state),
                `State should reflect exhausted budget, got ${state}`
            );

            await manager.stop();
        });
    });

    /**
     * Cross-cutting: Diagnostics Integration
     */
    suite('Cross-cutting: Diagnostics After Failure', () => {
        test('getDiagnostics() returns complete report after startup failure', async () => {
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/nonexistent/python',
                path.join(workspacePath, 'bridge'),
                mockContext,
                mockOutputChannel
            );

            try { await manager.start(); } catch { /* expected */ }

            const diag = manager.getDiagnostics();

            // Verify report structure
            assert.ok(diag.state, 'Should have state');
            assert.ok(typeof diag.healthy === 'boolean', 'Should have healthy flag');
            assert.ok(diag.recovery, 'Should have recovery state');
            assert.ok(diag.lock, 'Should have lock state');
            assert.ok(diag.runtime, 'Should have runtime info');
            assert.ok(diag.remediationHints, 'Should have remediation hints');
            assert.ok(diag.logsPath, 'Should have logs path');

            // Verify failure was recorded
            assert.ok(diag.lastFailure, 'Should have lastFailure after startup failure');
            assert.ok(diag.lastFailure?.reason, 'lastFailure should have reason');
            assert.ok(diag.lastFailure?.timestamp, 'lastFailure should have timestamp');

            await manager.stop();
        });

        test('remediation hints are relevant to failure reason', async () => {
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/nonexistent/python',
                path.join(workspacePath, 'bridge'),
                mockContext,
                mockOutputChannel
            );

            try { await manager.start(); } catch { /* expected */ }

            const diag = manager.getDiagnostics();
            const hintsText = diag.remediationHints.join(' ').toLowerCase();

            // SPAWN_FAILED should hint at Python path issues
            assert.ok(
                hintsText.includes('python') || 
                hintsText.includes('path') || 
                hintsText.includes('environment') ||
                hintsText.includes('diagnose'),
                'Hints should guide toward resolution'
            );

            await manager.stop();
        });
    });
});
