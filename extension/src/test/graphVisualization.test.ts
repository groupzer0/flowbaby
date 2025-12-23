/**
 * Graph Visualization Tests (Plan 067)
 * 
 * Tests for the graph visualization feature including:
 * - Command registration and execution
 * - FlowbabyClient.visualize() method
 * - Toast notification behavior
 * - Offline validation
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { registerVisualizeGraphCommand } from '../commands/graphVisualization';
import { FlowbabyClient, VisualizeResult } from '../flowbabyClient';

suite('Graph Visualization Test Suite (Plan 067)', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('registerVisualizeGraphCommand', () => {
        let registeredCommand: sinon.SinonStub;
        let registeredCallback: ((...args: any[]) => Promise<void>) | undefined;
        let mockContext: vscode.ExtensionContext;
        let mockOutputChannel: vscode.OutputChannel;

        setup(() => {
            // Capture command registration
            registeredCallback = undefined;
            registeredCommand = sandbox.stub(vscode.commands, 'registerCommand').callsFake(
                (id: string, callback: (...args: any[]) => any) => {
                    if (id === 'Flowbaby.visualizeGraph') {
                        registeredCallback = callback;
                    }
                    return { dispose: () => {} } as vscode.Disposable;
                }
            );

            // Mock context
            mockContext = {
                subscriptions: []
            } as unknown as vscode.ExtensionContext;

            // Mock output channel
            mockOutputChannel = {
                appendLine: sandbox.stub(),
                show: sandbox.stub()
            } as unknown as vscode.OutputChannel;
        });

        test('registers Flowbaby.visualizeGraph command', () => {
            registerVisualizeGraphCommand(
                mockContext,
                () => undefined,
                mockOutputChannel
            );

            assert.ok(
                registeredCommand.calledWith('Flowbaby.visualizeGraph', sinon.match.func),
                'Command should be registered with correct ID'
            );
        });

        test('shows error when no client available', async () => {
            const errorMsgStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves();

            registerVisualizeGraphCommand(
                mockContext,
                () => undefined, // No client
                mockOutputChannel
            );

            assert.ok(registeredCallback, 'Callback should be registered');
            await registeredCallback!();

            assert.ok(
                errorMsgStub.calledWith(sinon.match(/No workspace open/)),
                'Should show no workspace error'
            );
        });

        test('shows error when no workspace folder', async () => {
            const errorMsgStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves();
            sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

            const mockClient = {} as FlowbabyClient;

            registerVisualizeGraphCommand(
                mockContext,
                () => mockClient,
                mockOutputChannel
            );

            assert.ok(registeredCallback, 'Callback should be registered');
            await registeredCallback!();

            assert.ok(
                errorMsgStub.calledWith(sinon.match(/No workspace folder/)),
                'Should show no workspace folder error'
            );
        });

        test('handles NO_DATA error code gracefully', async () => {
            const warnMsgStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves();
            
            // Use a temp directory that actually exists to avoid fs stubs
            const tempWorkspace = os.tmpdir();
            sandbox.stub(vscode.workspace, 'workspaceFolders').value([
                { uri: vscode.Uri.file(tempWorkspace), name: 'test', index: 0 }
            ]);

            const mockClient = {
                visualize: sandbox.stub().resolves({
                    success: false,
                    error_code: 'NO_DATA',
                    user_message: 'No memories found'
                } as VisualizeResult)
            } as unknown as FlowbabyClient;

            // Stub withProgress to execute the callback immediately
            sandbox.stub(vscode.window, 'withProgress').callsFake(async (options, task) => {
                return task({ report: () => {} }, new vscode.CancellationTokenSource().token);
            });

            registerVisualizeGraphCommand(
                mockContext,
                () => mockClient,
                mockOutputChannel
            );

            assert.ok(registeredCallback, 'Callback should be registered');
            await registeredCallback!();

            assert.ok(
                warnMsgStub.calledWith(sinon.match(/No.*graph.*data.*ingest/i)),
                'Should show no data warning message'
            );
        });

        test('handles MISSING_API_KEY error code with link to settings', async () => {
            const errorMsgStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves();
            
            // Use a temp directory that actually exists to avoid fs stubs
            const tempWorkspace = os.tmpdir();
            sandbox.stub(vscode.workspace, 'workspaceFolders').value([
                { uri: vscode.Uri.file(tempWorkspace), name: 'test', index: 0 }
            ]);

            const mockClient = {
                visualize: sandbox.stub().resolves({
                    success: false,
                    error_code: 'MISSING_API_KEY',
                    user_message: 'LLM_API_KEY not configured'
                } as VisualizeResult)
            } as unknown as FlowbabyClient;

            sandbox.stub(vscode.window, 'withProgress').callsFake(async (options, task) => {
                return task({ report: () => {} }, new vscode.CancellationTokenSource().token);
            });

            registerVisualizeGraphCommand(
                mockContext,
                () => mockClient,
                mockOutputChannel
            );

            await registeredCallback!();

            assert.ok(
                errorMsgStub.calledWith(
                    sinon.match(/API key/i),
                    sinon.match.string // 'Set API Key' button
                ),
                'Should show API key error with configure option'
            );
        });

        test('opens browser on successful visualization', async () => {
            const openExternalStub = sandbox.stub(vscode.env, 'openExternal').resolves(true);
            const infoMsgStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves('Open in Browser' as any);
            
            // Use a temp directory that actually exists to avoid fs stubs
            const tempWorkspace = os.tmpdir();
            sandbox.stub(vscode.workspace, 'workspaceFolders').value([
                { uri: vscode.Uri.file(tempWorkspace), name: 'test', index: 0 }
            ]);

            const mockClient = {
                visualize: sandbox.stub().resolves({
                    success: true,
                    output_path: '/tmp/test-output/graph.html',
                    node_count: 5,
                    offline_safe: true
                } as VisualizeResult)
            } as unknown as FlowbabyClient;

            sandbox.stub(vscode.window, 'withProgress').callsFake(async (options, task) => {
                return task({ report: () => {} }, new vscode.CancellationTokenSource().token);
            });

            registerVisualizeGraphCommand(
                mockContext,
                () => mockClient,
                mockOutputChannel
            );

            await registeredCallback!();

            assert.ok(
                openExternalStub.calledOnce,
                'Should open browser with visualization'
            );
            assert.ok(
                infoMsgStub.calledWith(sinon.match(/Graph visualization generated/)),
                'Should show success message'
            );
        });
    });

    suite('FlowbabyClient.visualize() interface', () => {
        test('VisualizeResult interface has expected properties', () => {
            // Document expected interface shape
            const successResult: VisualizeResult = {
                success: true,
                output_path: '/path/to/graph.html',
                file_size_bytes: 12345,
                node_count: 10,
                offline_safe: true
            };

            // Verify interface shape
            assert.ok('success' in successResult, 'Should have success property');
            assert.ok('output_path' in successResult, 'Should have output_path property');
            assert.ok('offline_safe' in successResult, 'Should have offline_safe property');
        });

        test('VisualizeResult supports error properties', () => {
            const errorResult: VisualizeResult = {
                success: false,
                error: 'Some error occurred',
                error_code: 'NO_DATA',
                user_message: 'No data available'
            };

            assert.ok('error_code' in errorResult, 'Should have error_code property');
            assert.ok('user_message' in errorResult, 'Should have user_message property');
        });
    });

    suite('Toast Notification Configuration', () => {
        test('showRetrievalNotifications setting exists in package.json', async () => {
            // Read and parse package.json
            const extensionRoot = path.resolve(__dirname, '..', '..');
            const packageJsonPath = path.join(extensionRoot, 'package.json');
            
            assert.ok(fs.existsSync(packageJsonPath), 'package.json should exist');
            
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            const settings = packageJson.contributes?.configuration?.properties;
            
            assert.ok(settings, 'Should have configuration properties');
            assert.ok(
                settings['flowbaby.showRetrievalNotifications'],
                'Should have showRetrievalNotifications setting'
            );
            assert.strictEqual(
                settings['flowbaby.showRetrievalNotifications'].type,
                'boolean',
                'Setting should be boolean type'
            );
            assert.strictEqual(
                settings['flowbaby.showRetrievalNotifications'].default,
                true,
                'Setting should default to true'
            );
        });

        test('Flowbaby.visualizeGraph command exists in package.json', async () => {
            const extensionRoot = path.resolve(__dirname, '..', '..');
            const packageJsonPath = path.join(extensionRoot, 'package.json');
            
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            const commands = packageJson.contributes?.commands;
            
            assert.ok(commands, 'Should have commands');
            
            const visualizeCommand = commands.find(
                (cmd: { command: string }) => cmd.command === 'Flowbaby.visualizeGraph'
            );
            assert.ok(visualizeCommand, 'Should have visualizeGraph command');
            assert.ok(
                visualizeCommand.title.includes('Visualize') || 
                visualizeCommand.title.includes('Graph'),
                'Command title should mention visualization'
            );
        });
    });

    suite('Output Path and Offline Validation (Plan 067)', () => {
        let registeredCallback2: ((...args: any[]) => Promise<void>) | undefined;
        let mockContext2: vscode.ExtensionContext;
        let mockOutputChannel2: vscode.OutputChannel;

        setup(() => {
            // Capture command registration
            registeredCallback2 = undefined;
            sandbox.stub(vscode.commands, 'registerCommand').callsFake(
                (id: string, callback: (...args: any[]) => any) => {
                    if (id === 'Flowbaby.visualizeGraph') {
                        registeredCallback2 = callback;
                    }
                    return { dispose: () => {} } as vscode.Disposable;
                }
            );

            // Mock context
            mockContext2 = {
                subscriptions: []
            } as unknown as vscode.ExtensionContext;

            // Mock output channel
            mockOutputChannel2 = {
                appendLine: sandbox.stub(),
                show: sandbox.stub()
            } as unknown as vscode.OutputChannel;
        });

        test('visualization output uses .flowbaby/cache directory (Plan 067)', async () => {
            // Use a temp directory that actually exists to avoid fs stubs
            const tempWorkspace = os.tmpdir();
            sandbox.stub(vscode.workspace, 'workspaceFolders').value([
                { uri: vscode.Uri.file(tempWorkspace), name: 'test', index: 0 }
            ]);

            let capturedOutputPath: string | undefined;
            const mockClient = {
                visualize: sandbox.stub().callsFake((outputPath: string) => {
                    capturedOutputPath = outputPath;
                    return Promise.resolve({
                        success: true,
                        output_path: outputPath,
                        node_count: 5,
                        offline_safe: true
                    } as VisualizeResult);
                })
            } as unknown as FlowbabyClient;

            sandbox.stub(vscode.window, 'withProgress').callsFake(async (options, task) => {
                return task({ report: () => {} }, new vscode.CancellationTokenSource().token);
            });
            sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
            sandbox.stub(vscode.env, 'openExternal').resolves(true);

            registerVisualizeGraphCommand(
                mockContext2,
                () => mockClient,
                mockOutputChannel2
            );

            assert.ok(registeredCallback2, 'Callback should be registered');
            await registeredCallback2!();

            // Verify output path uses .flowbaby/cache (not .flowbaby/visualization)
            assert.ok(capturedOutputPath, 'Output path should be captured');
            assert.ok(
                capturedOutputPath!.includes('.flowbaby/cache') || 
                capturedOutputPath!.includes('.flowbaby\\cache'),
                `Output path should use .flowbaby/cache, got: ${capturedOutputPath}`
            );
            assert.ok(
                !capturedOutputPath!.includes('visualization'),
                'Output path should NOT use .flowbaby/visualization'
            );
        });

        test('OFFLINE_VIOLATION error code exists in VisualizeResult', () => {
            // Document expected error response for offline violations
            const offlineViolationResult: VisualizeResult = {
                success: false,
                error_code: 'OFFLINE_VIOLATION',
                error: 'HTML contains external dependencies',
                user_message: 'Graph visualization failed: contains external dependencies'
            };

            assert.strictEqual(offlineViolationResult.success, false);
            assert.strictEqual(offlineViolationResult.error_code, 'OFFLINE_VIOLATION');
        });

        test('successful result has offline_safe=true', () => {
            // Verify success results guarantee offline safety
            const successResult: VisualizeResult = {
                success: true,
                output_path: '/path/to/graph.html',
                node_count: 10,
                offline_safe: true
            };

            assert.strictEqual(successResult.offline_safe, true);
        });
    });
});
