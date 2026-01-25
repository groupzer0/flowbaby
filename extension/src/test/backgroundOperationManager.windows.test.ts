/**
 * Plan 115 tests for Windows-specific behavior.
 * Updated by Plan 116: Background cognify now routes through daemon only,
 * so subprocess spawn tests are replaced with daemon-only routing tests.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { BackgroundOperationManager } from '../background/BackgroundOperationManager';
import * as cloudProvider from '../flowbaby-cloud/provider';
import * as usageMeter from '../flowbaby-cloud/usageMeter';

/**
 * Plan 116: These tests verify that Windows platform behavior is correct
 * for daemon-only routing. Subprocess spawn tests have been removed
 * since Plan 116 eliminated subprocess fallback.
 */
suite('BackgroundOperationManager - Windows Specific', () => {
    let workspacePath: string;
    let context: vscode.ExtensionContext;
    let output: vscode.OutputChannel;
    let manager: BackgroundOperationManager;
    let sandbox: sinon.SinonSandbox;
    let originalPlatform: string;
    let outputLines: string[];

    const resetSingleton = () => {
        (BackgroundOperationManager as unknown as { instance?: BackgroundOperationManager }).instance = undefined;
    };

    setup(async () => {
        sandbox = sinon.createSandbox();
        outputLines = [];
        
        // Plan 081: Stub Cloud provider to avoid auth requirement in tests
        sandbox.stub(cloudProvider, 'isProviderInitialized').returns(true);
        sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
            AWS_ACCESS_KEY_ID: 'test-access-key',
            AWS_SECRET_ACCESS_KEY: 'test-secret-key',
            AWS_SESSION_TOKEN: 'test-session-token',
            AWS_REGION: 'us-east-1',
            FLOWBABY_CLOUD_MODE: 'true'
        });
        
        // Stub usage meter
        sandbox.stub(usageMeter, 'getUsageMeter').returns({
            recordOperation: sandbox.stub().resolves({ success: true, skipped: false, usedCredits: 1, remaining: 99 })
        } as unknown as ReturnType<typeof usageMeter.getUsageMeter>);
        
        sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined as any);
        sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as any);
        
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cognee-bom-win-'));
        context = {
            subscriptions: [],
            secrets: { get: sinon.stub().resolves(undefined) },
            globalState: {
                get: sinon.stub().returns(undefined),
                update: sinon.stub().resolves()
            }
        } as unknown as vscode.ExtensionContext;
        output = {
            appendLine: (line: string) => outputLines.push(line)
        } as unknown as vscode.OutputChannel;

        resetSingleton();
        manager = BackgroundOperationManager.initialize(context, output);
        await manager.initializeForWorkspace(workspacePath);

        // Mock process.platform
        originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', {
            value: 'win32'
        });
    });

    teardown(async () => {
        Object.defineProperty(process, 'platform', {
            value: originalPlatform
        });
        sandbox.restore();
        await manager.shutdown();
        resetSingleton();
        if (fs.existsSync(workspacePath)) {
            fs.rmSync(workspacePath, { recursive: true, force: true });
        }
    });

    test('cognify routes through daemon on Windows (Plan 116)', async () => {
        // Plan 116: Cognify now routes through daemon only, no subprocess spawn
        const pythonPath = 'C:\\path\\to\\python.exe';
        const bridgePath = path.join(workspacePath, 'bridge', 'ingest.py');

        // Set up a fake daemon manager
        const fakeDaemonManager = {
            isDaemonEnabled: () => true,
            isHealthy: () => true,
            sendRequest: sandbox.stub().resolves({
                jsonrpc: '2.0',
                id: '123',
                result: { success: true, elapsed_ms: 1000, entity_count: 5 }
            })
        };
        manager.setDaemonManager(fakeDaemonManager as any);

        const payload = {
            type: 'summary' as const,
            summary: { topic: 'test', context: 'context' }
        };

        await manager.startOperation('test summary', workspacePath, pythonPath, bridgePath, payload);

        // Wait for async daemon call
        await new Promise(resolve => setTimeout(resolve, 500));

        // Verify daemon was called
        assert.ok(fakeDaemonManager.sendRequest.calledOnce, 'Daemon should be called on Windows');
        assert.ok(fakeDaemonManager.sendRequest.calledWith('cognify', sinon.match.any, 120000), 'Should call cognify method');
        
        // Verify log indicates daemon routing
        const daemonLog = outputLines.find(line => line.includes('Routing cognify through daemon'));
        assert.ok(daemonLog, 'Should log daemon routing on Windows');
    });

    test('cognify fails fast on Windows when daemon unavailable (Plan 116)', async () => {
        // Plan 116: No subprocess fallback - daemon unavailable should fail fast
        const pythonPath = 'C:\\path\\to\\python.exe';
        const bridgePath = path.join(workspacePath, 'bridge', 'ingest.py');

        const fakeDaemonManager = {
            isDaemonEnabled: () => true,
            isHealthy: () => false,  // Daemon unhealthy
            sendRequest: sandbox.stub()
        };
        manager.setDaemonManager(fakeDaemonManager as any);

        const payload = {
            type: 'summary' as const,
            summary: { topic: 'test', context: 'context' }
        };

        try {
            await manager.startOperation('test summary', workspacePath, pythonPath, bridgePath, payload);
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            // Expected - DaemonUnavailableError thrown
        }

        // Verify log indicates daemon unhealthy
        const unhealthyLog = outputLines.find(line => line.includes('Daemon not healthy'));
        assert.ok(unhealthyLog, 'Should log daemon unhealthy on Windows');
        
        // Daemon sendRequest should NOT be called
        assert.ok(!fakeDaemonManager.sendRequest.called, 'Daemon sendRequest should not be called when unhealthy');
    });
});
