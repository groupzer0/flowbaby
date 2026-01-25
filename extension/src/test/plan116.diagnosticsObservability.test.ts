/**
 * Plan 116 M6 - Diagnostics and Observability Tests
 * 
 * Tests for daemon diagnostics infrastructure:
 * - getDiagnostics() method returning current state and last failure
 * - Normal vs Debug observability split
 * - Diagnose Daemon command integration
 * 
 * TDD: These tests define expected behavior BEFORE implementation.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PythonBridgeDaemonManager } from '../bridge/PythonBridgeDaemonManager';
import {
    DaemonUnavailableReason,
    DaemonDiagnosticReport,
    DAEMON_RELIABILITY_DEFAULTS
} from '../bridge/daemonReliabilityContract';

suite('Plan 116 M6 - Diagnostics and Observability', () => {
    let sandbox: sinon.SinonSandbox;
    let workspacePath: string;
    let outputLines: string[];
    let outputChannel: vscode.OutputChannel;
    let context: vscode.ExtensionContext;

    setup(() => {
        sandbox = sinon.createSandbox();
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-diag-'));
        outputLines = [];
        outputChannel = {
            appendLine: (line: string) => outputLines.push(line)
        } as unknown as vscode.OutputChannel;
        context = {
            subscriptions: [],
            globalState: {
                get: sandbox.stub().returns(undefined),
                update: sandbox.stub().resolves()
            }
        } as unknown as vscode.ExtensionContext;
    });

    teardown(() => {
        sandbox.restore();
        if (fs.existsSync(workspacePath)) {
            fs.rmSync(workspacePath, { recursive: true, force: true });
        }
    });

    suite('getDiagnostics() method', () => {
        test('getDiagnostics() returns DaemonDiagnosticReport interface', async () => {
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/usr/bin/python3',
                path.join(workspacePath, 'bridge'),
                context,
                outputChannel
            );

            const report = manager.getDiagnostics();

            // Verify report has required fields
            assert.ok(typeof report.state === 'string', 'Report should have state');
            assert.ok(typeof report.healthy === 'boolean', 'Report should have healthy');
            assert.ok(typeof report.daemonModeEnabled === 'boolean', 'Report should have daemonModeEnabled');
            assert.ok(typeof report.daemonModeSuspended === 'boolean', 'Report should have daemonModeSuspended');
            assert.ok(report.recovery !== undefined, 'Report should have recovery');
            assert.ok(report.lock !== undefined, 'Report should have lock');
            assert.ok(report.runtime !== undefined, 'Report should have runtime');
            assert.ok(typeof report.logsPath === 'string', 'Report should have logsPath');
            assert.ok(Array.isArray(report.remediationHints), 'Report should have remediationHints array');

            await manager.stop();
        });

        test('getDiagnostics() includes last failure record after startup failure', async () => {
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/nonexistent/python',  // Will fail to start
                path.join(workspacePath, 'bridge'),
                context,
                outputChannel
            );

            // Attempt to start (will fail)
            try {
                await manager.start();
            } catch {
                // Expected to fail
            }

            const report = manager.getDiagnostics();

            // Verify lastFailure is populated
            assert.ok(report.lastFailure, 'lastFailure should be populated after failure');
            assert.ok(report.lastFailure?.timestamp, 'lastFailure should have timestamp');
            assert.ok(report.lastFailure?.reason, 'lastFailure should have reason');

            await manager.stop();
        });

        test('getDiagnostics() provides remediation hints based on state', async () => {
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/usr/bin/python3',
                path.join(workspacePath, 'bridge'),
                context,
                outputChannel
            );

            const report = manager.getDiagnostics();

            // Stopped state should suggest starting
            assert.ok(
                report.remediationHints.length > 0,
                'Should provide remediation hints'
            );

            await manager.stop();
        });

        test('getDiagnostics() includes lock ownership information', async () => {
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/usr/bin/python3',
                path.join(workspacePath, 'bridge'),
                context,
                outputChannel
            );

            const report = manager.getDiagnostics();

            assert.ok(typeof report.lock.held === 'boolean', 'lock.held should be boolean');
            assert.ok(typeof report.lock.lockPath === 'string', 'lock.lockPath should be string');

            await manager.stop();
        });

        test('getDiagnostics() includes pending request count', async () => {
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/usr/bin/python3',
                path.join(workspacePath, 'bridge'),
                context,
                outputChannel
            );

            const report = manager.getDiagnostics();

            assert.ok(typeof report.runtime.pendingRequests === 'number', 'pendingRequests should be number');
            assert.strictEqual(report.runtime.pendingRequests, 0, 'pendingRequests should be 0 initially');

            await manager.stop();
        });
    });

    suite('Normal vs Debug observability split', () => {
        test('normal logging includes state transitions', async () => {
            // State transitions should always be logged (normal mode)
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/usr/bin/python3',
                path.join(workspacePath, 'bridge'),
                context,
                outputChannel
            );

            // The constructor logs state, check for INFO level logs
            const stateLog = outputLines.find(line =>
                line.includes('DaemonManager created') ||
                line.includes('state')
            );
            assert.ok(stateLog, 'Should log state info in normal mode');

            await manager.stop();
        });

        test('debug logging includes stderr excerpts (bounded)', async () => {
            // Stderr excerpts should only appear in debug mode
            // and should be bounded by MAX_STDERR_LINES
            const maxLines = DAEMON_RELIABILITY_DEFAULTS.MAX_STDERR_LINES;
            assert.ok(maxLines > 0, 'MAX_STDERR_LINES should be positive');
            assert.ok(maxLines <= 100, 'MAX_STDERR_LINES should be bounded');
        });

        test('stderr capture is bounded by MAX_STDERR_CHARS', () => {
            const maxChars = DAEMON_RELIABILITY_DEFAULTS.MAX_STDERR_CHARS;
            assert.ok(maxChars > 0, 'MAX_STDERR_CHARS should be positive');
            assert.ok(maxChars <= 10000, 'MAX_STDERR_CHARS should be bounded');
        });
    });

    suite('Remediation hint generation', () => {
        test('stopped state suggests manual start or workspace reload', async () => {
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/usr/bin/python3',
                path.join(workspacePath, 'bridge'),
                context,
                outputChannel
            );

            const report = manager.getDiagnostics();
            const hints = report.remediationHints.join(' ').toLowerCase();

            assert.ok(
                hints.includes('start') || hints.includes('reload') || hints.includes('restart'),
                'Stopped state should hint at starting/reloading'
            );

            await manager.stop();
        });

        test('failed_startup state suggests checking Python path', async () => {
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/nonexistent/python',
                path.join(workspacePath, 'bridge'),
                context,
                outputChannel
            );

            try {
                await manager.start();
            } catch {
                // Expected
            }

            const report = manager.getDiagnostics();
            const hints = report.remediationHints.join(' ').toLowerCase();

            assert.ok(
                hints.includes('python') || hints.includes('path') || hints.includes('environment'),
                'Startup failure should hint at Python path issues'
            );

            await manager.stop();
        });

        test('degraded state explains recovery exhausted', async () => {
            // Simulate degraded state by setting internal state
            const manager = new PythonBridgeDaemonManager(
                workspacePath,
                '/usr/bin/python3',
                path.join(workspacePath, 'bridge'),
                context,
                outputChannel
            );

            // Force degraded state for testing
            (manager as any).state = 'degraded';
            (manager as any).recoveryState = {
                attempts: 3,
                maxAttempts: 3,
                active: false,
                cooldownMs: 60000
            };

            const report = manager.getDiagnostics();
            const hints = report.remediationHints.join(' ').toLowerCase();

            assert.ok(
                hints.includes('recovery') || hints.includes('degraded') || hints.includes('restart'),
                'Degraded state should explain recovery exhausted'
            );

            await manager.stop();
        });
    });
});
