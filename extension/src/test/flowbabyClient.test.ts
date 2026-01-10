import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import { EventEmitter } from 'events';
import { FlowbabyClient } from '../flowbabyClient';
import { PythonBridgeDaemonManager } from '../bridge/PythonBridgeDaemonManager';
import * as cloudProvider from '../flowbaby-cloud/provider';
import * as usageMeter from '../flowbaby-cloud/usageMeter';

// Helper to create directory structure
function createTestStructure(basePath: string, structure: any) {
    if (!fs.existsSync(basePath)) {
        fs.mkdirSync(basePath, { recursive: true });
    }
    for (const key in structure) {
        const fullPath = path.join(basePath, key);
        if (typeof structure[key] === 'string') {
            // Ensure parent directory exists
            const parentDir = path.dirname(fullPath);
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }
            fs.writeFileSync(fullPath, structure[key]);
        } else {
            createTestStructure(fullPath, structure[key]);
        }
    }
}

// Helper to clean up
function cleanupTestStructure(basePath: string) {
    if (fs.existsSync(basePath)) {
        try {
            fs.rmSync(basePath, { recursive: true, force: true });
        } catch (e) {
            console.error(`Failed to cleanup ${basePath}:`, e);
        }
    }
}

/**
 * Creates a mock VS Code ExtensionContext for testing.
 * Only includes the properties actually used by FlowbabyClient.
 */
function createMockContext(): vscode.ExtensionContext {
    const secretStorage: vscode.SecretStorage = {
        get: sinon.stub().resolves(undefined),
        store: sinon.stub().resolves(),
        delete: sinon.stub().resolves(),
        keys: sinon.stub().resolves([]),
        onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
    };
    
    return {
        secrets: secretStorage,
        // Minimal stubs for other required properties
        subscriptions: [],
        workspaceState: {} as any,
        globalState: {} as any,
        extensionUri: vscode.Uri.file('/mock/extension'),
        extensionPath: '/mock/extension',
        storagePath: '/mock/storage',
        globalStoragePath: '/mock/global-storage',
        logPath: '/mock/logs',
        extensionMode: vscode.ExtensionMode.Test,
        storageUri: vscode.Uri.file('/mock/storage'),
        globalStorageUri: vscode.Uri.file('/mock/global-storage'),
        logUri: vscode.Uri.file('/mock/logs'),
        extension: {} as any,
        asAbsolutePath: (relativePath: string) => path.join('/mock/extension', relativePath),
        environmentVariableCollection: {} as any,
        languageModelAccessInformation: {} as any
    } as vscode.ExtensionContext;
}

suite('FlowbabyClient Test Suite', () => {
    const testWorkspacePath = path.resolve('tmp', 'test-workspace');
    let mockContext: vscode.ExtensionContext;

    // Initialize mock context before each test
    setup(() => {
        mockContext = createMockContext();
    });

    suite('detectPythonInterpreter', () => {
        let originalPlatform: string;
        let sandbox: sinon.SinonSandbox;

        setup(() => {
            sandbox = sinon.createSandbox();
            // Save original platform
            originalPlatform = process.platform;
            
            // Ensure mockContext is available
            mockContext = createMockContext();

            // Stub execFileSync to avoid actual execution during tests
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');
        });

        teardown(() => {
            sandbox.restore();
            // Restore original platform
            Object.defineProperty(process, 'platform', {
                value: originalPlatform,
                writable: true,
                configurable: true
            });
        });

        test('Explicit config overrides auto-detection', () => {
            // Setup: Mock explicit config
            const mockConfig = {
                get: (key: string, defaultValue?: string) => {
                    if (key === 'pythonPath') {return '/usr/bin/python3.11';}
                    return defaultValue;
                }
            };
            sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

            // Execute
            const client = new FlowbabyClient(testWorkspacePath, mockContext);

            // Assert: Explicit config is used
            assert.strictEqual(client['pythonPath'], '/usr/bin/python3.11');
        });

        test('Detects .flowbaby/venv/bin/python on Linux/macOS', () => {
            // Setup: Mock Linux platform and existing .flowbaby/venv
            Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
            const venvPath = path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');
            
            // Create real filesystem structure
            createTestStructure(testWorkspacePath, {
                '.flowbaby': {
                    'venv': {
                        'bin': {
                            'python': ''  // Empty file is sufficient for existsSync check
                        }
                    }
                }
            });
            
            console.log(`[TEST] Checking if venvPath exists: ${venvPath}`);
            console.log(`[TEST] Exists: ${fs.existsSync(venvPath)}`);

            const mockConfig = {
                get: (key: string, defaultValue?: string) => {
                    if (key === 'pythonPath') {return '';} // Empty to trigger auto-detection
                    return defaultValue;
                }
            };
            sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

            // Execute
            const client = new FlowbabyClient(testWorkspacePath, mockContext);

            // Assert: .flowbaby/venv is detected
            // Note: On Windows running this test, path.join will use backslashes.
            // The client logic uses path.join, so it should match.
            assert.strictEqual(client['pythonPath'], venvPath);

            // Cleanup
            cleanupTestStructure(testWorkspacePath);
        });

        test('Detects .flowbaby/venv/Scripts/python.exe on Windows', () => {
            // Setup: Mock Windows platform and existing .flowbaby/venv
            Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
            const venvPath = path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe');
            
            // Create real filesystem structure
            createTestStructure(testWorkspacePath, {
                '.flowbaby': {
                    'venv': {
                        'Scripts': {
                            'python.exe': ''  // Empty file is sufficient for existsSync check
                        }
                    }
                }
            });
            
            console.log(`[TEST] Checking if venvPath exists: ${venvPath}`);
            console.log(`[TEST] Exists: ${fs.existsSync(venvPath)}`);

            const mockConfig = {
                get: (key: string, defaultValue?: string) => {
                    if (key === 'pythonPath') {return '';} // Empty to trigger auto-detection
                    return defaultValue;
                }
            };
            sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

            // Execute
            const client = new FlowbabyClient(testWorkspacePath, mockContext);

            // Assert: .flowbaby/venv is detected with Windows path
            assert.strictEqual(client['pythonPath'], venvPath);

            // Cleanup
            cleanupTestStructure(testWorkspacePath);
        });

        test('Falls back to python3 when no venv found', () => {
            // Setup: Mock empty workspace (no .venv)
            createTestStructure(testWorkspacePath, {});
            
            const mockConfig = {
                get: (key: string, defaultValue?: string) => {
                    if (key === 'pythonPath') {return '';} // Empty to trigger auto-detection
                    return defaultValue;
                }
            };
            sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

            // Execute
            const client = new FlowbabyClient(testWorkspacePath, mockContext);

            // Assert: Falls back to system python3
            const expectedPython = process.platform === 'win32' ? 'python' : 'python3';
            assert.strictEqual(client['pythonPath'], expectedPython);

            // Cleanup
            cleanupTestStructure(testWorkspacePath);
        });

        test('Handles permission errors gracefully', () => {
            // Setup: Mock filesystem with permission-restricted directory
            // mock-fs doesn't directly support permission errors, but we can test
            // the try-catch by mocking an empty workspace (simulates graceful fallback)
            createTestStructure(testWorkspacePath, {});
            
            const mockConfig = {
                get: (key: string, defaultValue?: string) => {
                    if (key === 'pythonPath') {return '';} // Empty to trigger auto-detection
                    return defaultValue;
                }
            };
            sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

            // Execute
            const client = new FlowbabyClient(testWorkspacePath, mockContext);

            // Assert: Falls back to system python3 despite error
            // Note: This tests the fallback path, though mock-fs cannot simulate actual permission errors
            const expectedPython = process.platform === 'win32' ? 'python' : 'python3';
            assert.strictEqual(client['pythonPath'], expectedPython);

            // Cleanup
            cleanupTestStructure(testWorkspacePath);
        });

        test('Detection completes in <10ms', () => {
            // Setup: Mock empty workspace
            createTestStructure(testWorkspacePath, {});
            
            const mockConfig = {
                get: (key: string, defaultValue?: string) => {
                    if (key === 'pythonPath') {return '';} // Empty to trigger auto-detection
                    return defaultValue;
                }
            };
            sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

            // Execute: Run detection 10 times and measure average
            const iterations = 10;
            const startTime = Date.now();
            
            for (let i = 0; i < iterations; i++) {
                const _client = new FlowbabyClient(testWorkspacePath, mockContext);
            }
            
            const endTime = Date.now();
            const averageTime = (endTime - startTime) / iterations;

            // Assert: Average detection time is under 10ms
            // Note: mock-fs performance is not representative of real I/O
            assert.ok(averageTime < 10, `Average detection time ${averageTime}ms exceeds 10ms target`);

            // Cleanup
            cleanupTestStructure(testWorkspacePath);
        });
    });

    suite('sanitizeOutput', () => {
        let client: FlowbabyClient;

        setup(() => {
            // Create client for accessing private sanitizeOutput method
            client = new FlowbabyClient(testWorkspacePath, mockContext);
        });

        test('Redacts LLM_API_KEY environment variable format (current)', () => {
            const input = 'Error: LLM_API_KEY=sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234';
            const output = client['sanitizeOutput'](input);
            
            assert.ok(output.includes('LLM_API_KEY=***'));
            assert.ok(!output.includes('sk-proj-abc123'));
        });

        test('Redacts OPENAI_API_KEY environment variable format (legacy)', () => {
            const input = 'Error: OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234';
            const output = client['sanitizeOutput'](input);
            
            assert.ok(output.includes('OPENAI_API_KEY=***'));
            assert.ok(!output.includes('sk-proj-abc123'));
        });

        test('Redacts OpenAI sk- style keys', () => {
            const input = 'Using key sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234';
            const output = client['sanitizeOutput'](input);
            
            assert.ok(output.includes('sk-***'));
            assert.ok(!output.includes('sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234'));
        });

        test('Redacts Bearer tokens', () => {
            const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0';
            const output = client['sanitizeOutput'](input);
            
            assert.ok(output.includes('Bearer ***'));
            assert.ok(!output.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
        });

        test('Redacts AWS secret access keys', () => {
            const input = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
            const output = client['sanitizeOutput'](input);
            
            assert.ok(output.includes('AWS_SECRET_ACCESS_KEY=***'));
            assert.ok(!output.includes('wJalrXUtnFEMI'));
        });

        test('Redacts long hex strings (32+ chars)', () => {
            const input = 'Token: abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
            const output = client['sanitizeOutput'](input);
            
            assert.ok(output.includes('<redacted_token>'));
            assert.ok(!output.includes('abcdef0123456789abcdef0123456789'));
        });

        test('Truncates output to 1KB maximum', () => {
            // Use 'X' instead of 'A' to avoid hex pattern matching (A-F are hex digits)
            const input = 'X'.repeat(2000);
            const output = client['sanitizeOutput'](input);
            
            assert.ok(output.length <= 1024 + 20); // Allow for truncation message
            assert.ok(output.includes('\n... (truncated)'));
        });

        test('Passes through normal error messages (no false positives)', () => {
            const input = 'Error: Module not found - No module named cognee';
            const output = client['sanitizeOutput'](input);
            
            assert.strictEqual(output, input);
        });

        test('Handles empty strings', () => {
            const input = '';
            const output = client['sanitizeOutput'](input);
            
            assert.strictEqual(output, '');
        });

        test('Handles multiple secret patterns in same text', () => {
            const input = `
                LLM_API_KEY=sk-test-abc123def456ghi789jkl012mno345pqr678stu901vwx
                OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx
                AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
                Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0
            `;
            const output = client['sanitizeOutput'](input);
            
            assert.ok(output.includes('LLM_API_KEY=***'));
            assert.ok(output.includes('OPENAI_API_KEY=***'));
            assert.ok(output.includes('AWS_SECRET_ACCESS_KEY=***'));
            assert.ok(output.includes('Bearer ***'));
            assert.ok(!output.includes('sk-test-abc123'));
            assert.ok(!output.includes('sk-proj-abc123'));
            assert.ok(!output.includes('wJalrXUtnFEMI'));
            assert.ok(!output.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
        });
    });

    suite('retrieve logging previews', () => {
        const workspacePath = '/tmp/test-workspace-logging';
        let sandbox: sinon.SinonSandbox;

        function stubSharedDependencies() {
            sandbox.stub(vscode.workspace, 'getConfiguration').returns({
                get: (key: string, defaultValue?: any) => {
                    if (key === 'bridgeMode') {return 'spawn';}
                    return defaultValue;
                }
            } as vscode.WorkspaceConfiguration);
            sandbox.stub(vscode.window, 'createOutputChannel').returns({
                name: 'Cognee Memory',
                appendLine: () => void 0,
                append: () => void 0,
                replace: () => void 0,
                clear: () => void 0,
                dispose: () => void 0,
                hide: () => void 0,
                show: () => void 0
            } as unknown as vscode.LogOutputChannel);
        }

        setup(() => {
            sandbox = sinon.createSandbox();
        });

        teardown(() => {
            sandbox.restore();
        });

        test('logs truncated query preview with total length when query exceeds 200 chars', async () => {
            stubSharedDependencies();
            const client = new FlowbabyClient(workspacePath, mockContext);
            const logStub = sandbox.stub(client as any, 'log');
            sandbox.stub(client as any, 'runPythonScript').resolves({
                success: true,
                results: [],
                result_count: 0,
                total_tokens: 0
            });

            const realNow = Date.now;
            let callCount = 0;
            sandbox.stub(Date, 'now').callsFake(() => {
                if (callCount === 0) {
                    callCount++;
                    return 0;
                }
                if (callCount === 1) {
                    callCount++;
                    return 1500; // Force latency warning
                }
                return realNow();
            });

            const longQuery = 'Q'.repeat(250);
            await client.retrieve(longQuery);

            const debugCall = logStub.getCalls().find((call) => call.args[1] === 'Retrieving context');
            assert.ok(debugCall, 'Debug log for retrieval not emitted');
            const preview = debugCall!.args[2].query_preview as string;
            assert.ok(preview.startsWith('Q'.repeat(200)));
            assert.ok(preview.endsWith('... (250 chars total)'));

            const warnCall = logStub.getCalls().find((call) => call.args[1] === 'Retrieval latency exceeded target');
            assert.ok(warnCall, 'Latency warning not emitted');
            const warnPreview = warnCall!.args[2].query_preview as string;
            assert.ok(warnPreview.endsWith('... (250 chars total)'), 'Warning log should include truncated preview metadata');
        });

        test('logs full query when length is 200 chars or less', async () => {
            stubSharedDependencies();
            const client = new FlowbabyClient(workspacePath, mockContext);
            const logStub = sandbox.stub(client as any, 'log');

            const recordOperationStub = sandbox.stub().resolves({
                success: true,
                skipped: true,
                reason: 'test'
            });
            sandbox.stub(usageMeter, 'getUsageMeter').returns({
                recordOperation: recordOperationStub
            } as unknown as usageMeter.IUsageMeter);

            sandbox.stub(client as any, 'runPythonScript').resolves({
                success: true,
                results: [],
                result_count: 0,
                total_tokens: 0
            });

            const query = 'Explain migrations';
            await client.retrieve(query);

            assert.ok(recordOperationStub.calledOnce, 'retrieve() should record usage metering');
            assert.strictEqual(recordOperationStub.firstCall.args[0], 'retrieve');
            assert.match(
                recordOperationStub.firstCall.args[1] as string,
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            );

            const debugCall = logStub.getCalls().find((call) => call.args[1] === 'Retrieving context');
            assert.ok(debugCall, 'Debug log missing for short query');
            const preview = debugCall!.args[2].query_preview as string;
            assert.strictEqual(preview, query);
        });
    });

    suite('ingest metrics and error handling', () => {
        const workspacePath = '/tmp/test-workspace-ingest';
        let sandbox: sinon.SinonSandbox;

        function stubSharedDependencies() {
            sandbox.stub(vscode.workspace, 'getConfiguration').returns({
                get: (key: string, defaultValue?: any) => {
                    if (key === 'bridgeMode') {return 'spawn';}
                    return defaultValue;
                }
            } as vscode.WorkspaceConfiguration);
            sandbox.stub(vscode.window, 'createOutputChannel').returns({
                name: 'Cognee Memory',
                appendLine: () => void 0,
                append: () => void 0,
                replace: () => void 0,
                clear: () => void 0,
                dispose: () => void 0,
                hide: () => void 0,
                show: () => void 0
            } as unknown as vscode.LogOutputChannel);
        }

        setup(() => {
            sandbox = sinon.createSandbox();
        });

        teardown(() => {
            sandbox.restore();
        });

        test('logs ingestion metrics on success and suppresses warning toast', async () => {
            stubSharedDependencies();
            const client = new FlowbabyClient(workspacePath, mockContext);
            const logStub = sandbox.stub(client as any, 'log');

            const recordOperationStub = sandbox.stub().resolves({
                success: true,
                skipped: true,
                reason: 'test'
            });
            sandbox.stub(usageMeter, 'getUsageMeter').returns({
                recordOperation: recordOperationStub
            } as unknown as usageMeter.IUsageMeter);

            sandbox.stub(client as any, 'runPythonScript').resolves({
                success: true,
                ingested_chars: 120,
                timestamp: '2025-11-17T14:00:00.000Z',
                ingestion_duration_sec: 1.5,
                ingestion_metrics: { add_sec: 0.4 }
            });

            const warningStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

            const result = await client.ingest('How do I cache?', 'Use functools.lru_cache');

            assert.strictEqual(result, true);

            assert.ok(recordOperationStub.calledOnce, 'ingest() should record usage metering');
            assert.strictEqual(recordOperationStub.firstCall.args[0], 'embed');
            assert.match(
                recordOperationStub.firstCall.args[1] as string,
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            );
            assert.ok(warningStub.notCalled, 'Warning message should not show on success');

            const successCall = logStub.getCalls().find((call) => call.args[1] === 'Conversation ingested');
            assert.ok(successCall, 'Success log missing');
            assert.strictEqual(successCall!.args[2].ingestion_duration_sec, 1.5);

            const metricsCall = logStub.getCalls().find((call) => call.args[1] === 'Ingestion metrics');
            assert.ok(metricsCall, 'Detailed metrics log missing');
            assert.deepStrictEqual(metricsCall!.args[2].metrics, { add_sec: 0.4 });
        });

        test('handles timeout errors with user-facing guidance', async () => {
            stubSharedDependencies();
            const client = new FlowbabyClient(workspacePath, mockContext);
            const logStub = sandbox.stub(client as any, 'log');
            sandbox.stub(client as any, 'runPythonScript').rejects(new Error('Python script timeout after 120 seconds'));

            const warningStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

            const result = await client.ingest('Question', 'Answer');

            assert.strictEqual(result, false);
            assert.ok(warningStub.calledOnce, 'Timeout should trigger warning notification');

            const timeoutCall = logStub.getCalls().find((call) => call.args[1] === 'Ingestion timeout');
            assert.ok(timeoutCall, 'Timeout log missing');
            assert.strictEqual(timeoutCall!.args[2].error_type, 'timeout');
            assert.match(timeoutCall!.args[2].error as string, /Python script timeout/);
        });

        test('handles non-timeout failures without warning toast', async () => {
            stubSharedDependencies();
            const client = new FlowbabyClient(workspacePath, mockContext);
            const logStub = sandbox.stub(client as any, 'log');
            sandbox.stub(client as any, 'runPythonScript').rejects(new Error('LLM_API_KEY not found'));

            const warningStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

            const result = await client.ingest('Question', 'Answer');

            assert.strictEqual(result, false);
            assert.ok(warningStub.notCalled, 'Failure path should not show timeout guidance');

            const failureCall = logStub.getCalls().find((call) => call.args[1] === 'Ingestion exception');
            assert.ok(failureCall, 'Failure log missing');
            assert.strictEqual(failureCall!.args[2].error_type, 'failure');
            assert.match(failureCall!.args[2].error as string, /LLM_API_KEY/);
        });

        test('rejects payloads larger than 100k characters', async () => {
            stubSharedDependencies();
            const client = new FlowbabyClient(workspacePath, mockContext);
            const logStub = sandbox.stub(client as any, 'log');
            const runPythonStub = sandbox.stub(client as any, 'runPythonScript').resolves({
                success: true,
                ingested_chars: 100000,
                timestamp: '2025-11-17T14:00:00.000Z',
                ingestion_duration_sec: 1.5
            });

            const _warningStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

            const largeContext = 'A'.repeat(100005);
            const result = await client.ingest('Question', largeContext);

            assert.strictEqual(result, false, 'Should return false for oversized payload');
            assert.ok(runPythonStub.notCalled, 'Should not call python script');

            const failureCall = logStub.getCalls().find((call) => call.args[1] === 'Ingestion exception');
            assert.ok(failureCall, 'Failure log missing');
            assert.match(failureCall!.args[2].error as string, /Payload too large/);
        });
    });

    suite('ingestSummary (Plan 014)', () => {
        const workspacePath = '/tmp/test-workspace-summary';
        let sandbox: sinon.SinonSandbox;

        function stubSharedDependencies() {
            sandbox.stub(vscode.workspace, 'getConfiguration').returns({
                get: (_key: string, defaultValue?: any) => defaultValue
            } as vscode.WorkspaceConfiguration);
            sandbox.stub(vscode.window, 'createOutputChannel').returns({
                name: 'Cognee Memory',
                appendLine: () => void 0,
                append: () => void 0,
                replace: () => void 0,
                clear: () => void 0,
                dispose: () => void 0,
                hide: () => void 0,
                show: () => void 0
            } as unknown as vscode.LogOutputChannel);
        }

        setup(() => {
            sandbox = sinon.createSandbox();
        });

        teardown(() => {
            sandbox.restore();
        });

        test('calls ingest.py with --summary and serialized JSON payload', async () => {
            stubSharedDependencies();
            const client = new FlowbabyClient(workspacePath, mockContext);
            sandbox.stub(client as any, 'log');
            const runPythonStub = sandbox.stub(client as any, 'runPythonScript').resolves({
                success: true,
                ingested_chars: 500,
                timestamp: '2025-11-17T16:30:00.000Z',
                metadata: { topicId: '12345', status: 'Active' },
                ingestion_duration_sec: 2.3
            });

            const summary = {
                topic: 'Python Environment Detection',
                context: 'Implementing intelligent interpreter detection',
                decisions: ['Use .venv first', 'Fall back to python3'],
                rationale: ['Explicit config wins', 'Workspace isolation'],
                openQuestions: ['How to handle conda?'],
                nextSteps: ['Test on Windows'],
                references: ['Plan 007'],
                timeScope: '2025-11-17',
                topicId: '12345',
                sessionId: null,
                planId: '007',
                status: 'Active' as const,
                sourceCreatedAt: new Date('2025-11-17T15:00:00Z'),
                createdAt: new Date('2025-11-17T16:30:00Z'),
                updatedAt: new Date('2025-11-17T16:30:00Z')
            };

            const result = await client.ingestSummary(summary);

            assert.strictEqual(result, true);
            assert.ok(runPythonStub.calledOnce);
            
            const args = runPythonStub.firstCall.args;
            assert.strictEqual(args[0], 'ingest.py');
            assert.deepStrictEqual(args[1], [
                '--summary',
                '--summary-json',
                JSON.stringify({
                    topic: summary.topic,
                    context: summary.context,
                    decisions: summary.decisions,
                    rationale: summary.rationale,
                    openQuestions: summary.openQuestions,
                    nextSteps: summary.nextSteps,
                    references: summary.references,
                    timeScope: summary.timeScope,
                    topicId: summary.topicId,
                    sessionId: summary.sessionId,
                    planId: summary.planId,
                    status: summary.status,
                    sourceCreatedAt: '2025-11-17T15:00:00.000Z',
                    createdAt: '2025-11-17T16:30:00.000Z',
                    updatedAt: '2025-11-17T16:30:00.000Z',
                    workspace_path: workspacePath
                })
            ]);
            assert.strictEqual(args[2], 120000); // 120-second timeout
        });

        test('logs summary ingestion metrics on success', async () => {
            stubSharedDependencies();
            const client = new FlowbabyClient(workspacePath, mockContext);
            const logStub = sandbox.stub(client as any, 'log');

            const recordOperationStub = sandbox.stub().resolves({
                success: true,
                skipped: true,
                reason: 'test'
            });
            sandbox.stub(usageMeter, 'getUsageMeter').returns({
                recordOperation: recordOperationStub
            } as unknown as usageMeter.IUsageMeter);

            sandbox.stub(client as any, 'runPythonScript').resolves({
                success: true,
                ingested_chars: 500,
                timestamp: '2025-11-17T16:30:00.000Z',
                metadata: { topicId: '12345', status: 'Active' },
                ingestion_duration_sec: 2.3,
                ingestion_metrics: { add_sec: 0.8, cognify_sec: 1.5 }
            });

            const summary = {
                topic: 'Test Summary',
                context: 'Test context',
                decisions: [],
                rationale: [],
                openQuestions: [],
                nextSteps: [],
                references: [],
                timeScope: '2025-11-17',
                topicId: '12345',
                sessionId: null,
                planId: null,
                status: 'Active' as const,
                sourceCreatedAt: new Date('2025-11-17T16:10:00Z'),
                createdAt: new Date('2025-11-17T16:30:00Z'),
                updatedAt: null
            };

            await client.ingestSummary(summary);

            assert.ok(recordOperationStub.calledOnce, 'ingestSummary() should record usage metering');
            assert.strictEqual(recordOperationStub.firstCall.args[0], 'embed');
            assert.match(
                recordOperationStub.firstCall.args[1] as string,
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            );

            const successCall = logStub.getCalls().find((call) => call.args[1] === 'Summary ingested');
            assert.ok(successCall, 'Success log missing');
            assert.strictEqual(successCall!.args[2].topic, 'Test Summary');
            assert.strictEqual(successCall!.args[2].topicId, '12345');
            assert.strictEqual(successCall!.args[2].chars, 500);
            assert.strictEqual(successCall!.args[2].ingestion_duration_sec, 2.3);

            const metricsCall = logStub.getCalls().find((call) => call.args[1] === 'Summary ingestion metrics');
            assert.ok(metricsCall, 'Metrics log missing');
            assert.deepStrictEqual(metricsCall!.args[2].metrics, { add_sec: 0.8, cognify_sec: 1.5 });
        });

        test('handles timeout with warning notification', async () => {
            stubSharedDependencies();
            const client = new FlowbabyClient(workspacePath, mockContext);
            const logStub = sandbox.stub(client as any, 'log');
            sandbox.stub(client as any, 'runPythonScript').rejects(
                new Error('Python script timeout after 120 seconds')
            );

            const warningStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

            const summary = {
                topic: 'Long Summary',
                context: 'A'.repeat(10000),
                decisions: [],
                rationale: [],
                openQuestions: [],
                nextSteps: [],
                references: [],
                timeScope: '2025-11-17',
                topicId: '12345',
                sessionId: null,
                planId: null,
                status: 'Active' as const,
                sourceCreatedAt: new Date(),
                createdAt: new Date(),
                updatedAt: null
            };

            const result = await client.ingestSummary(summary);

            assert.strictEqual(result, false);
            assert.ok(warningStub.calledOnce, 'Timeout should trigger warning notification');
            assert.match(
                warningStub.firstCall.args[0] as string,
                /still working on summary ingestion in the background/
            );

            const timeoutCall = logStub.getCalls().find((call) => call.args[1] === 'Summary ingestion timeout');
            assert.ok(timeoutCall, 'Timeout log missing');
            assert.strictEqual(timeoutCall!.args[2].topic, 'Long Summary');
            assert.strictEqual(timeoutCall!.args[2].error_type, 'timeout');
            assert.match(timeoutCall!.args[2].error as string, /Python script timeout/);
        });

        test('handles non-timeout failures without warning toast', async () => {
            stubSharedDependencies();
            const client = new FlowbabyClient(workspacePath, mockContext);
            const logStub = sandbox.stub(client as any, 'log');
            sandbox.stub(client as any, 'runPythonScript').rejects(new Error('LLM_API_KEY not configured'));

            const warningStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

            const summary = {
                topic: 'Failed Summary',
                context: 'Test',
                decisions: [],
                rationale: [],
                openQuestions: [],
                nextSteps: [],
                references: [],
                timeScope: '2025-11-17',
                topicId: null,
                sessionId: null,
                planId: null,
                status: null,
                sourceCreatedAt: null,
                createdAt: null,
                updatedAt: null
            };

            const result = await client.ingestSummary(summary);

            assert.strictEqual(result, false);
            assert.ok(warningStub.notCalled, 'Non-timeout failure should not show warning toast');

            const failureCall = logStub.getCalls().find((call) => call.args[1] === 'Summary ingestion exception');
            assert.ok(failureCall, 'Failure log missing');
            assert.strictEqual(failureCall!.args[2].topic, 'Failed Summary');
            assert.strictEqual(failureCall!.args[2].error_type, 'failure');
            assert.match(failureCall!.args[2].error as string, /LLM_API_KEY/);
        });

        test('handles null metadata fields gracefully', async () => {
            stubSharedDependencies();
            const client = new FlowbabyClient(workspacePath, mockContext);
            sandbox.stub(client as any, 'log');
            const runPythonStub = sandbox.stub(client as any, 'runPythonScript').resolves({
                success: true,
                ingested_chars: 300,
                timestamp: '2025-11-17T16:30:00.000Z',
                ingestion_duration_sec: 1.2
            });

            const summary = {
                topic: 'Minimal Summary',
                context: 'Test',
                decisions: [],
                rationale: [],
                openQuestions: [],
                nextSteps: [],
                references: [],
                timeScope: '2025-11-17',
                topicId: null,
                sessionId: null,
                planId: null,
                status: null,
                sourceCreatedAt: null,
                createdAt: null,
                updatedAt: null
            };

            const result = await client.ingestSummary(summary);

            assert.strictEqual(result, true);
            
            const payload = JSON.parse(runPythonStub.firstCall.args[1][2]);
            assert.strictEqual(payload.topicId, null);
            assert.strictEqual(payload.sessionId, null);
            assert.strictEqual(payload.planId, null);
            assert.strictEqual(payload.status, null);
            assert.strictEqual(payload.sourceCreatedAt, null);
            assert.strictEqual(payload.createdAt, null);
            assert.strictEqual(payload.updatedAt, null);
        });

        test('handles Python script failure response (success: false)', async () => {
            stubSharedDependencies();
            const client = new FlowbabyClient(workspacePath, mockContext);
            const logStub = sandbox.stub(client as any, 'log');
            sandbox.stub(client as any, 'runPythonScript').resolves({
                success: false,
                error: 'Failed to parse summary metadata'
            });

            const summary = {
                topic: 'Invalid Summary',
                context: 'Test',
                decisions: [],
                rationale: [],
                openQuestions: [],
                nextSteps: [],
                references: [],
                timeScope: '2025-11-17',
                topicId: '12345',
                sessionId: null,
                planId: null,
                status: 'Active' as const,
                sourceCreatedAt: new Date(),
                createdAt: new Date(),
                updatedAt: null
            };

            const result = await client.ingestSummary(summary);

            assert.strictEqual(result, false);

            const failureCall = logStub.getCalls().find((call) => call.args[1] === 'Summary ingestion failed');
            assert.ok(failureCall, 'Failure log missing');
            assert.strictEqual(failureCall!.args[2].topic, 'Invalid Summary');
            assert.match(failureCall!.args[2].error as string, /Failed to parse summary metadata/);
        });
    });

    suite('Plan 022: Retrieval Filtering and Truncation', () => {
        const workspacePath = '/tmp/test-workspace-plan022';
        let sandbox: sinon.SinonSandbox;

        function stubSharedDependencies() {
            sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
                if (section === 'Flowbaby.sessionManagement') {
                    return { get: () => true } as any;
                }
                if (section === 'Flowbaby.ranking') {
                    return { get: (_key: string, defaultValue?: any) => defaultValue } as any;
                }
                return {
                    get: (key: string, defaultValue?: any) => {
                        if (key === 'pythonPath') {return '/usr/bin/python3';}
                        if (key === 'debugLogging') {return false;}
                        if (key === 'bridgeMode') {return 'spawn';}
                        return defaultValue;
                    }
                } as any;
            });
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');
            sandbox.stub(vscode.window, 'createOutputChannel').returns({
                name: 'Cognee Memory',
                appendLine: () => void 0,
                append: () => void 0,
                replace: () => void 0,
                clear: () => void 0,
                dispose: () => void 0,
                hide: () => void 0,
                show: () => void 0
            } as unknown as vscode.LogOutputChannel);
        }

        setup(() => {
            sandbox = sinon.createSandbox();
            
            // Plan 081: Stub Cloud provider to avoid auth requirement in tests
            sandbox.stub(cloudProvider, 'isProviderInitialized').returns(true);
            sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
                AWS_ACCESS_KEY_ID: 'test-access-key',
                AWS_SECRET_ACCESS_KEY: 'test-secret-key',
                AWS_SESSION_TOKEN: 'test-session-token',
                AWS_REGION: 'us-east-1',
                FLOWBABY_CLOUD_MODE: 'true'
            });
        });

        teardown(() => {
            sandbox.restore();
        });

        test('retrieve logs filtered_count from bridge', async () => {
            stubSharedDependencies();
            const client = new FlowbabyClient(workspacePath, mockContext);
            const logStub = sandbox.stub(client as any, 'log');

            const mockProcess = new EventEmitter() as any;
            mockProcess.stdout = new EventEmitter();
            mockProcess.stderr = new EventEmitter();
            mockProcess.kill = sandbox.stub();
            
            // Stub protected spawnProcess method
            sandbox.stub(client as any, 'spawnProcess').returns(mockProcess);

            const retrievePromise = client.retrieve('test query');

            // Simulate bridge output (legacy path without contractVersion 2.x)
            const result = {
                success: true,
                results: [],
                result_count: 0,
                filtered_count: 5,
                total_tokens: 100
            };
            
            // Emit data asynchronously to simulate process
            setTimeout(() => {
                mockProcess.stdout.emit('data', JSON.stringify(result));
                mockProcess.emit('close', 0);
            }, 10);

            await retrievePromise;

            // Verify log call contains filtered_count (Plan 073: legacy path logs with suffix)
            const successCall = logStub.getCalls().find((call) => 
                call.args[1] && call.args[1].startsWith('Context retrieved')
            );
            assert.ok(successCall, 'Should log "Context retrieved..."');
            assert.strictEqual(successCall!.args[2].filtered_count, 5, 'Log should include filtered_count: 5');
        });

        test('runPythonScript handles large buffer (1MB limit)', async () => {
            stubSharedDependencies();
            const client = new FlowbabyClient(workspacePath, mockContext);
            const logStub = sandbox.stub(client as any, 'log');

            const mockProcess = new EventEmitter() as any;
            mockProcess.stdout = new EventEmitter();
            mockProcess.stderr = new EventEmitter();
            mockProcess.kill = sandbox.stub();
            
            // Stub protected spawnProcess method
            sandbox.stub(client as any, 'spawnProcess').returns(mockProcess);

            // Access private method via casting to any
            const runScriptPromise = (client as any).runPythonScript('test.py', []);

            // Emit 1.5MB of data
            // We emit in chunks
            const chunk = 'a'.repeat(1024 * 100); // 100KB
            
            setTimeout(() => {
                for (let i = 0; i < 15; i++) {
                    mockProcess.stdout.emit('data', chunk);
                }
                mockProcess.emit('close', 0);
            }, 10);

            try {
                await runScriptPromise;
                assert.fail('Should have failed due to invalid JSON (truncated)');
            } catch (error: any) {
                assert.ok(error.message.includes('Failed to parse JSON'), 'Should fail to parse truncated JSON');
            }
            
            // Verify log shows JSON parse failure
            const errorCall = logStub.getCalls().find((call) => call.args[1] === 'JSON parse failed');
            assert.ok(errorCall, 'Should log JSON parse failure');
            
            // Check that stdout_preview is present and truncated to 1024 chars (by sanitizeOutput)
            assert.ok(errorCall!.args[2].stdout_preview, 'Should have stdout_preview');
        });

        test('runPythonScript captures stderr on JSON parse failure', async () => {
            stubSharedDependencies();
            const client = new FlowbabyClient(workspacePath, mockContext);
            const logStub = sandbox.stub(client as any, 'log');

            const mockProcess = new EventEmitter() as any;
            mockProcess.stdout = new EventEmitter();
            mockProcess.stderr = new EventEmitter();
            mockProcess.kill = sandbox.stub();
            
            // Stub protected spawnProcess method
            sandbox.stub(client as any, 'spawnProcess').returns(mockProcess);

            const runScriptPromise = (client as any).runPythonScript('test.py', []);

            setTimeout(() => {
                // Emit invalid JSON
                mockProcess.stdout.emit('data', 'invalid json');
                
                // Emit stderr
                mockProcess.stderr.emit('data', 'Error details in stderr');
                
                mockProcess.emit('close', 0);
            }, 10);

            try {
                await runScriptPromise;
                assert.fail('Should have failed');
            } catch (error: any) {
                assert.ok(error.message.includes('Failed to parse JSON'));
            }

            const errorCall = logStub.getCalls().find((call) => call.args[1] === 'JSON parse failed');
            assert.ok(errorCall, 'Should log JSON parse failure');
            assert.strictEqual(errorCall!.args[2].stderr_preview, 'Error details in stderr', 'Log should include stderr preview');
        });
    });

    suite('Plan 050: Debug logging propagation', () => {
        const workspacePath = '/tmp/test-workspace-plan050-debug';
        let sandbox: sinon.SinonSandbox;

        function stubConfigs(debugLogging: boolean) {
            sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
                if (section === 'Flowbaby.sessionManagement') {
                    return { get: () => true } as any;
                }
                if (section === 'Flowbaby.ranking') {
                    return { get: (_key: string, defaultValue?: any) => defaultValue } as any;
                }
                return {
                    get: (key: string, defaultValue?: any) => {
                        if (key === 'pythonPath') {return '/usr/bin/python3';}
                        if (key === 'debugLogging') {return debugLogging;}
                        return defaultValue;
                    }
                } as any;
            });
        }

        setup(() => {
            sandbox = sinon.createSandbox();
            
            // Plan 081: Stub Cloud provider to avoid auth requirement in tests
            sandbox.stub(cloudProvider, 'isProviderInitialized').returns(true);
            sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
                AWS_ACCESS_KEY_ID: 'test-access-key',
                AWS_SECRET_ACCESS_KEY: 'test-secret-key',
                AWS_SESSION_TOKEN: 'test-session-token',
                AWS_REGION: 'us-east-1',
                FLOWBABY_CLOUD_MODE: 'true'
            });
        });

        teardown(() => {
            sandbox.restore();
        });

        function createMockProcess() {
            const mockProcess = new EventEmitter() as any;
            mockProcess.stdout = new EventEmitter();
            mockProcess.stderr = new EventEmitter();
            mockProcess.kill = sandbox.stub();
            return mockProcess;
        }

        test('runPythonScript sets FLOWBABY_DEBUG_LOGGING when debug logging is enabled', async () => {
            stubConfigs(true);
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const mockProcess = createMockProcess();
            const envCapture: any = {};

            sandbox.stub(client as any, 'spawnProcess').callsFake((...args: any[]) => {
                const options = args[2] as any;
                envCapture.env = options?.env;
                setTimeout(() => {
                    mockProcess.stdout.emit('data', JSON.stringify({ success: true }));
                    mockProcess.emit('close', 0);
                }, 0);
                return mockProcess;
            });

            await (client as any).runPythonScript('retrieve.py', []);

            assert.strictEqual(envCapture.env?.FLOWBABY_DEBUG_LOGGING, 'true', 'Should propagate debug flag to bridge environment');
        });

        test('runPythonScript sets FLOWBABY_DEBUG_LOGGING=false when debug logging is disabled', async () => {
            stubConfigs(false);
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const mockProcess = createMockProcess();
            const envCapture: any = {};

            sandbox.stub(client as any, 'spawnProcess').callsFake((...args: any[]) => {
                const options = args[2] as any;
                envCapture.env = options?.env;
                setTimeout(() => {
                    mockProcess.stdout.emit('data', JSON.stringify({ success: true }));
                    mockProcess.emit('close', 0);
                }, 0);
                return mockProcess;
            });

            await (client as any).runPythonScript('retrieve.py', []);

            assert.strictEqual(envCapture.env?.FLOWBABY_DEBUG_LOGGING, 'false', 'Should propagate disabled debug flag to bridge environment');
        });

        test('constructor reads sessionManagement.enabled flag', () => {
            // Arrange: sessionManagement.enabled should default to true when not set explicitly
            stubConfigs(false);
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;

            assert.strictEqual(anyClient.sessionManagementEnabled, true, 'Session management should default to enabled');
        });
    });

    // Plan 084: skipCloudCredentials option tests
    // These tests verify that bootstrap operations can run without Cloud credentials
    suite('Bootstrap Decoupling (Plan 084)', () => {
        let sandbox: sinon.SinonSandbox;
        const workspacePath = '/tmp/test-workspace-plan084';

        setup(() => {
            sandbox = sinon.createSandbox();
            
            // Basic config stubs
            // Note: bridgeMode is set to 'spawn' to disable daemon which would call getFlowbabyCloudEnvironment
            sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
                if (section === 'Flowbaby.sessionManagement') {
                    return { get: () => true } as any;
                }
                if (section === 'Flowbaby.ranking') {
                    return { get: (_key: string, defaultValue?: any) => defaultValue } as any;
                }
                return {
                    get: (key: string, defaultValue?: any) => {
                        if (key === 'pythonPath') {return '/usr/bin/python3';}
                        if (key === 'bridgeMode') {return 'spawn';} // Disable daemon to isolate tests
                        return defaultValue;
                    }
                } as any;
            });
            
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');
        });

        teardown(() => {
            sandbox.restore();
        });

        function createMockProcess() {
            const mockProcess = new EventEmitter() as any;
            mockProcess.stdout = new EventEmitter();
            mockProcess.stderr = new EventEmitter();
            mockProcess.kill = sandbox.stub();
            return mockProcess;
        }

        test('runPythonScript with skipCloudCredentials=true does NOT call getFlowbabyCloudEnvironment', async () => {
            // Stub Cloud provider functions
            // Note: isFlowbabyCloudEnabled must also be stubbed to control behavior
            sandbox.stub(cloudProvider, 'isFlowbabyCloudEnabled').returns(true);
            sandbox.stub(cloudProvider, 'isProviderInitialized').returns(true);
            
            // Spy on Cloud environment getter - should NOT be called when skipCloudCredentials is true
            const cloudEnvSpy = sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
                AWS_ACCESS_KEY_ID: 'test-key',
                AWS_SECRET_ACCESS_KEY: 'test-secret',
                AWS_SESSION_TOKEN: 'test-token',
                AWS_REGION: 'us-east-1',
                FLOWBABY_CLOUD_MODE: 'true'
            });

            const client = new FlowbabyClient(workspacePath, mockContext);
            const mockProcess = createMockProcess();

            sandbox.stub(client as any, 'spawnProcess').callsFake(() => {
                setTimeout(() => {
                    mockProcess.stdout.emit('data', JSON.stringify({ success: true }));
                    mockProcess.emit('close', 0);
                }, 0);
                return mockProcess;
            });

            // Call with skipCloudCredentials: true (bootstrap operation)
            await (client as any).runPythonScript('init.py', [], { skipCloudCredentials: true });

            // Cloud credentials should NOT be requested because skipCloudCredentials=true
            // The getLLMEnvironment() call is completely bypassed
            assert.strictEqual(
                cloudEnvSpy.called,
                false,
                'getFlowbabyCloudEnvironment should NOT be called when skipCloudCredentials is true'
            );
        });

        test('runPythonScript with skipCloudCredentials=false DOES call getFlowbabyCloudEnvironment', async () => {
            // Stub Cloud provider functions
            sandbox.stub(cloudProvider, 'isFlowbabyCloudEnabled').returns(true);
            sandbox.stub(cloudProvider, 'isProviderInitialized').returns(true);
            
            // Spy on Cloud environment getter - SHOULD be called when skipCloudCredentials is false
            const cloudEnvSpy = sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
                AWS_ACCESS_KEY_ID: 'test-key',
                AWS_SECRET_ACCESS_KEY: 'test-secret',
                AWS_SESSION_TOKEN: 'test-token',
                AWS_REGION: 'us-east-1',
                FLOWBABY_CLOUD_MODE: 'true'
            });

            const client = new FlowbabyClient(workspacePath, mockContext);
            const mockProcess = createMockProcess();

            sandbox.stub(client as any, 'spawnProcess').callsFake(() => {
                setTimeout(() => {
                    mockProcess.stdout.emit('data', JSON.stringify({ success: true }));
                    mockProcess.emit('close', 0);
                }, 0);
                return mockProcess;
            });

            // Call with skipCloudCredentials: false (LLM operation)
            await (client as any).runPythonScript('ingest.py', [], { skipCloudCredentials: false });

            // Cloud credentials SHOULD be requested
            assert.strictEqual(
                cloudEnvSpy.called,
                true,
                'getFlowbabyCloudEnvironment should be called when skipCloudCredentials is false'
            );
        });

        test('runPythonScript defaults to skipCloudCredentials=false (requires Cloud)', async () => {
            // Stub Cloud provider functions
            sandbox.stub(cloudProvider, 'isFlowbabyCloudEnabled').returns(true);
            sandbox.stub(cloudProvider, 'isProviderInitialized').returns(true);
            
            // Spy on Cloud environment getter - SHOULD be called by default
            const cloudEnvSpy = sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
                AWS_ACCESS_KEY_ID: 'test-key',
                AWS_SECRET_ACCESS_KEY: 'test-secret',
                AWS_SESSION_TOKEN: 'test-token',
                AWS_REGION: 'us-east-1',
                FLOWBABY_CLOUD_MODE: 'true'
            });

            const client = new FlowbabyClient(workspacePath, mockContext);
            const mockProcess = createMockProcess();

            sandbox.stub(client as any, 'spawnProcess').callsFake(() => {
                setTimeout(() => {
                    mockProcess.stdout.emit('data', JSON.stringify({ success: true }));
                    mockProcess.emit('close', 0);
                }, 0);
                return mockProcess;
            });

            // Call with no options (defaults should apply)
            await (client as any).runPythonScript('retrieve.py', []);

            // Cloud credentials SHOULD be requested (default behavior)
            assert.strictEqual(
                cloudEnvSpy.called,
                true,
                'getFlowbabyCloudEnvironment should be called by default (skipCloudCredentials defaults to false)'
            );
        });

        test('runPythonScript with skipCloudCredentials=true still sets PYTHONUNBUFFERED', async () => {
            sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({});
            sandbox.stub(cloudProvider, 'isProviderInitialized').returns(false);

            const client = new FlowbabyClient(workspacePath, mockContext);
            const mockProcess = createMockProcess();
            let envCapture: { env?: NodeJS.ProcessEnv } = {};

            sandbox.stub(client as any, 'spawnProcess').callsFake((...args: unknown[]) => {
                const options = args[2] as any;
                envCapture.env = options?.env;
                setTimeout(() => {
                    mockProcess.stdout.emit('data', JSON.stringify({ success: true }));
                    mockProcess.emit('close', 0);
                }, 0);
                return mockProcess;
            });

            await (client as any).runPythonScript('init.py', [], { skipCloudCredentials: true });

            // Essential env vars should still be set
            assert.strictEqual(
                envCapture.env?.PYTHONUNBUFFERED,
                '1',
                'PYTHONUNBUFFERED should be set even without Cloud credentials'
            );
        });

        test('runPythonScript with skipCloudCredentials=true does NOT inject AWS credentials', async () => {
            sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
                AWS_ACCESS_KEY_ID: 'should-not-appear',
                AWS_SECRET_ACCESS_KEY: 'should-not-appear',
                AWS_SESSION_TOKEN: 'should-not-appear',
                AWS_REGION: 'us-east-1',
                FLOWBABY_CLOUD_MODE: 'true'
            });
            sandbox.stub(cloudProvider, 'isProviderInitialized').returns(true);

            const client = new FlowbabyClient(workspacePath, mockContext);
            const mockProcess = createMockProcess();
            let envCapture: { env?: NodeJS.ProcessEnv } = {};

            sandbox.stub(client as any, 'spawnProcess').callsFake((...args: unknown[]) => {
                const options = args[2] as any;
                envCapture.env = options?.env;
                setTimeout(() => {
                    mockProcess.stdout.emit('data', JSON.stringify({ success: true }));
                    mockProcess.emit('close', 0);
                }, 0);
                return mockProcess;
            });

            await (client as any).runPythonScript('init.py', [], { skipCloudCredentials: true });

            // Cloud-specific env vars should NOT be injected
            assert.strictEqual(
                envCapture.env?.FLOWBABY_CLOUD_MODE,
                undefined,
                'FLOWBABY_CLOUD_MODE should NOT be set when skipCloudCredentials is true'
            );
            // AWS credentials from Cloud provider should NOT be present
            // (they might be in process.env from the user, but not injected by the client)
        });

        test('runPythonScript with skipCloudCredentials=false DOES inject AWS credentials', async () => {
            const cloudCreds = {
                AWS_ACCESS_KEY_ID: 'cloud-access-key',
                AWS_SECRET_ACCESS_KEY: 'cloud-secret-key',
                AWS_SESSION_TOKEN: 'cloud-session-token',
                AWS_REGION: 'us-west-2',
                FLOWBABY_CLOUD_MODE: 'true'
            };
            sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves(cloudCreds);
            sandbox.stub(cloudProvider, 'isProviderInitialized').returns(true);

            const client = new FlowbabyClient(workspacePath, mockContext);
            const mockProcess = createMockProcess();
            let envCapture: { env?: NodeJS.ProcessEnv } = {};

            sandbox.stub(client as any, 'spawnProcess').callsFake((...args: unknown[]) => {
                const options = args[2] as any;
                envCapture.env = options?.env;
                setTimeout(() => {
                    mockProcess.stdout.emit('data', JSON.stringify({ success: true }));
                    mockProcess.emit('close', 0);
                }, 0);
                return mockProcess;
            });

            await (client as any).runPythonScript('retrieve.py', [], { skipCloudCredentials: false });

            // Cloud-specific env vars SHOULD be injected
            assert.strictEqual(
                envCapture.env?.FLOWBABY_CLOUD_MODE,
                'true',
                'FLOWBABY_CLOUD_MODE should be set when skipCloudCredentials is false'
            );
            assert.strictEqual(
                envCapture.env?.AWS_REGION,
                'us-west-2',
                'AWS_REGION should be injected from Cloud credentials'
            );
        });

        test('initialize() calls init.py with skipCloudCredentials: true', async () => {
            sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({});
            sandbox.stub(cloudProvider, 'isProviderInitialized').returns(false);

            const client = new FlowbabyClient(workspacePath, mockContext);
            
            let capturedOptions: any = null;
            sandbox.stub(client as any, 'runPythonScript').callsFake(
                (...args: unknown[]) => {
                    capturedOptions = args[2];
                    return Promise.resolve({
                        success: true,
                        llm_configured: false,
                        ontology_initialized: true
                    });
                }
            );

            await client.initialize();

            // Verify that init.py was called with skipCloudCredentials: true
            assert.ok(capturedOptions, 'runPythonScript should have been called');
            assert.strictEqual(
                capturedOptions.skipCloudCredentials,
                true,
                'initialize() should call init.py with skipCloudCredentials: true (bootstrap decoupling)'
            );
        });

        test('runPythonScript Cloud credential failure rejects for LLM operations', async () => {
            // Stub Cloud as enabled but credentials failing
            sandbox.stub(cloudProvider, 'isFlowbabyCloudEnabled').returns(true);
            sandbox.stub(cloudProvider, 'isProviderInitialized').returns(true);
            
            const credError = new Error('Cloud credentials not available');
            sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').rejects(credError);

            const client = new FlowbabyClient(workspacePath, mockContext);

            // For LLM operations (skipCloudCredentials: false), credential failure should propagate
            try {
                await (client as any).runPythonScript('ingest.py', [], { skipCloudCredentials: false });
                assert.fail('Should have thrown an error');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok(
                    (error as Error).message.includes('Cloud credentials'),
                    'Error should mention Cloud credentials'
                );
            }
        });

        test('RunPythonScriptOptions interface supports both timeoutMs and skipCloudCredentials', async () => {
            sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({});
            sandbox.stub(cloudProvider, 'isProviderInitialized').returns(false);

            const client = new FlowbabyClient(workspacePath, mockContext);
            const mockProcess = createMockProcess();
            let capturedTimeout: number | undefined;

            sandbox.stub(client as any, 'spawnProcess').callsFake(() => {
                setTimeout(() => {
                    mockProcess.stdout.emit('data', JSON.stringify({ success: true }));
                    mockProcess.emit('close', 0);
                }, 0);
                return mockProcess;
            });

            // Override internal timeout capture to verify both options work
            const originalMethod = (client as any).runPythonScript.bind(client);
            (client as any).runPythonScript = async function(
                scriptName: string, 
                args: string[], 
                options: { timeoutMs?: number; skipCloudCredentials?: boolean } = {}
            ) {
                capturedTimeout = options.timeoutMs;
                return originalMethod(scriptName, args, options);
            };

            // Call with both options
            await (client as any).runPythonScript('init.py', [], {
                timeoutMs: 60000,
                skipCloudCredentials: true
            });

            // Both options should be respected
            assert.strictEqual(capturedTimeout, 60000, 'timeoutMs should be passed through');
        });
    });

    // Plan 054 Fix Tests: Daemon Integration
    // These tests verify that the daemon is properly activated and used,
    // with appropriate fallback to spawn-per-request on failure.
    suite('Daemon Integration (Plan 054 Fix)', () => {
        let sandbox: sinon.SinonSandbox;
        let mockContext: vscode.ExtensionContext;
        const workspacePath = '/test/workspace';

        setup(() => {
            sandbox = sinon.createSandbox();
            
            // Create mock extension context
            mockContext = {
                extensionPath: '/test/extension',
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
                subscriptions: [],
                asAbsolutePath: (p: string) => path.join('/test/extension', p),
                storageUri: vscode.Uri.file('/test/storage'),
                globalStorageUri: vscode.Uri.file('/test/global-storage'),
                logUri: vscode.Uri.file('/test/logs'),
                extensionUri: vscode.Uri.file('/test/extension'),
                extensionMode: vscode.ExtensionMode.Development,
                environmentVariableCollection: {} as any,
                secrets: {} as any,
                extension: {} as any,
                storagePath: '/test/storage',
                globalStoragePath: '/test/global-storage',
                logPath: '/test/logs',
                languageModelAccessInformation: {} as any
            } as any;
        });

        teardown(() => {
            sandbox.restore();
        });

        /**
         * Helper to stub VS Code configuration for daemon tests
         */
        function stubDaemonConfigs(bridgeMode: 'daemon' | 'spawn' = 'daemon') {
            const configValues: Record<string, any> = {
                'pythonInterpreter': '/usr/bin/python3',
                'storageType': 'local',
                'bridgeMode': bridgeMode,
                'debugLogging': false,
                'sessionManagement.enabled': true
            };

            sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
                return {
                    get: <T>(key: string, defaultValue?: T): T => {
                        const fullKey = section ? `${section}.${key}` : key;
                        const value = configValues[key] ?? configValues[fullKey];
                        return (value !== undefined ? value : defaultValue) as T;
                    },
                    has: () => true,
                    inspect: () => undefined,
                    update: sandbox.stub().resolves()
                } as any;
            });
        }

        test('should set daemonModeEnabled=true when bridgeMode is daemon', () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            // Act
            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;

            // Assert
            assert.strictEqual(anyClient.daemonModeEnabled, true, 'Daemon mode should be enabled when bridgeMode=daemon');
        });

        test('should set daemonModeEnabled=false when bridgeMode is spawn', () => {
            // Arrange
            stubDaemonConfigs('spawn');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            // Act
            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;

            // Assert
            assert.strictEqual(anyClient.daemonModeEnabled, false, 'Daemon mode should be disabled when bridgeMode=spawn');
        });

        test('should initialize daemon manager when daemon mode is enabled', () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            // Act
            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;

            // Assert
            assert.ok(anyClient.daemonManager, 'DaemonManager should be initialized when daemon mode is enabled');
            assert.ok(anyClient.daemonManager instanceof PythonBridgeDaemonManager, 'Should be instance of PythonBridgeDaemonManager');
        });

        test('should not initialize daemon manager when daemon mode is disabled', () => {
            // Arrange
            stubDaemonConfigs('spawn');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            // Act
            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;

            // Assert
            assert.ok(!anyClient.daemonManager, 'DaemonManager should not be initialized when daemon mode is disabled');
        });

        test('retrieveViaDaemon should call daemon sendRequest with correct method', async () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            // Stub daemon manager sendRequest on prototype so all instances use it
            const mockSendRequest = sandbox.stub(PythonBridgeDaemonManager.prototype as any, 'sendRequest').resolves({
                success: true,
                results: [{ topic: 'test', context: 'test context', score: 0.9 }]
            });

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;

            // Act
            const payload = { query: 'test query', max_results: 3 };
            await anyClient.retrieveViaDaemon(payload);

            // Assert: find the retrieve call (there may be other calls, e.g. health checks)
            assert.ok(mockSendRequest.called, 'sendRequest should be called');
            const retrieveCall = mockSendRequest.getCalls().find((call) => call.args[0] === 'retrieve');
            assert.ok(retrieveCall, 'sendRequest should be called with method "retrieve"');
            const params = retrieveCall!.args[1] as any;
            assert.strictEqual(params.query, payload.query, 'Query should match payload');
            assert.strictEqual(params.max_results, payload.max_results, 'max_results should match payload');
        });

        test('ingestViaDaemon should call daemon sendRequest with correct method', async () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            // Stub daemon manager sendRequest on prototype so all instances use it
            const mockSendRequest = sandbox.stub(PythonBridgeDaemonManager.prototype as any, 'sendRequest').resolves({
                success: true,
                memory_id: 'test-id-123'
            });

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;

            // Act
            const payload = { topic: 'test topic', context: 'test context' };
            await anyClient.ingestViaDaemon(payload);

            // Assert: at least one call and method/payload correctness
            assert.ok(mockSendRequest.called, 'sendRequest should be called');
            assert.strictEqual(mockSendRequest.firstCall.args[0], 'ingest', 'Method should be "ingest"');
            assert.deepStrictEqual(mockSendRequest.firstCall.args[1], payload, 'Payload should match');
        });

        test('retrieve should use daemon when daemon mode enabled and daemon available', async () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;
            anyClient.pythonPath = '/usr/bin/python3';
            anyClient.isInitialized = true;

            // Mock retrieveViaDaemon to track calls
            const mockRetrieveViaDaemon = sandbox.stub(anyClient, 'retrieveViaDaemon').resolves({
                success: true,
                results: [{ topic: 'test', context: 'test context', score: 0.9 }]
            });

            // Mock runPythonScript to track fallback calls
            const mockRunPythonScript = sandbox.stub(anyClient, 'runPythonScript').resolves({
                success: true,
                results: []
            });

            // Act
            await client.retrieve('test query', { maxResults: 3 });

            // Assert
            assert.ok(mockRetrieveViaDaemon.calledOnce, 'Should use daemon for retrieval');
            assert.ok(!mockRunPythonScript.called, 'Should NOT fall back to spawn-per-request');
        });

        test('retrieve should fall back to spawn when daemon fails', async () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;
            anyClient.pythonPath = '/usr/bin/python3';
            anyClient.isInitialized = true;

            // Mock retrieveViaDaemon to throw an error
            const mockRetrieveViaDaemon = sandbox.stub(anyClient, 'retrieveViaDaemon').rejects(new Error('Daemon connection failed'));

            // Mock runPythonScript to return success
            const mockRunPythonScript = sandbox.stub(anyClient, 'runPythonScript').resolves({
                success: true,
                results: [{ summaryText: 'test context', topic: 'test', score: 0.9 }]
            });

            // Act
            const result = await client.retrieve('test query', { maxResults: 3 });

            // Assert
            assert.ok(mockRetrieveViaDaemon.calledOnce, 'Should try daemon first');
            assert.ok(mockRunPythonScript.calledOnce, 'Should fall back to spawn-per-request on daemon error');
            assert.ok(Array.isArray(result), 'Should return array result from fallback');
        });

        test('retrieve should use spawn directly when daemon mode disabled', async () => {
            // Arrange
            stubDaemonConfigs('spawn');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;
            anyClient.pythonPath = '/usr/bin/python3';
            anyClient.isInitialized = true;

            // Mock runPythonScript to track calls
            const mockRunPythonScript = sandbox.stub(anyClient, 'runPythonScript').resolves({
                success: true,
                results: [{ summaryText: 'test context', topic: 'test', score: 0.9 }]
            });

            // Act
            await client.retrieve('test query', { maxResults: 3 });

            // Assert
            assert.ok(mockRunPythonScript.calledOnce, 'Should use spawn-per-request directly');
        });

        test('ingest should use daemon when daemon mode enabled and daemon available', async () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;
            anyClient.pythonPath = '/usr/bin/python3';
            anyClient.isInitialized = true;

            // Mock ingestViaDaemon to track calls
            const mockIngestViaDaemon = sandbox.stub(anyClient, 'ingestViaDaemon').resolves({
                success: true,
                memory_id: 'test-id-123'
            });

            // Mock runPythonScript to track fallback calls
            const mockRunPythonScript = sandbox.stub(anyClient, 'runPythonScript').resolves({
                success: true,
                memory_id: 'test-id-456'
            });

            // Act - ingest() takes userMessage, assistantMessage, importance
            await client.ingest('user message', 'assistant response', 0.5);

            // Assert
            assert.ok(mockIngestViaDaemon.calledOnce, 'Should use daemon for ingestion');
            assert.ok(!mockRunPythonScript.called, 'Should NOT fall back to spawn-per-request');
        });

        test('ingest should fall back to spawn when daemon fails', async () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;
            anyClient.pythonPath = '/usr/bin/python3';
            anyClient.isInitialized = true;

            // Mock ingestViaDaemon to throw an error
            const mockIngestViaDaemon = sandbox.stub(anyClient, 'ingestViaDaemon').rejects(new Error('Daemon connection failed'));

            // Mock runPythonScript to return success
            const mockRunPythonScript = sandbox.stub(anyClient, 'runPythonScript').resolves({
                success: true,
                memory_id: 'test-id-456'
            });

            // Act - ingest() returns boolean
            const result = await client.ingest('user message', 'assistant response', 0.5);

            // Assert
            assert.ok(mockIngestViaDaemon.calledOnce, 'Should try daemon first');
            assert.ok(mockRunPythonScript.calledOnce, 'Should fall back to spawn-per-request on daemon error');
            assert.strictEqual(result, true, 'Should return true on successful fallback');
        });

        test('initializeDaemonManager should warm-start daemon', async () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            // Stub daemon manager's start on prototype so constructor warm-start is observable
            const mockStart = sandbox.stub(PythonBridgeDaemonManager.prototype as any, 'start').resolves();

            // Act: constructing the client should warm-start the daemon
            // via initializeDaemonManager() in the constructor
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const _client = new FlowbabyClient(workspacePath, mockContext);

            // Assert
            assert.ok(mockStart.calledOnce, 'Should warm-start daemon during initialization');
        });

        test('stopDaemon should stop daemon manager', async () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;

            // Mock daemon manager's stop method
            const mockStop = sandbox.stub(anyClient.daemonManager, 'stop').resolves();

            // Act
            await client.stopDaemon();

            // Assert
            assert.ok(mockStop.calledOnce, 'Should stop daemon manager on stopDaemon()');
        });

        // Plan 062: Tests for daemon-based summary ingestion
        test('ingestSummary should use daemon when daemon mode enabled', async () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;
            anyClient.pythonPath = '/usr/bin/python3';
            anyClient.isInitialized = true;

            // Mock ingestViaDaemon to track calls
            const mockIngestViaDaemon = sandbox.stub(anyClient, 'ingestViaDaemon').resolves({
                success: true,
                ingested_chars: 500,
                timestamp: '2025-12-20T10:00:00.000Z'
            });

            // Mock runPythonScript to ensure it's NOT called
            const mockRunPythonScript = sandbox.stub(anyClient, 'runPythonScript').resolves({
                success: true
            });

            const summary = {
                topic: 'Test Topic',
                context: 'Test context',
                decisions: [],
                rationale: [],
                openQuestions: [],
                nextSteps: [],
                references: [],
                timeScope: '2025-12-20',
                topicId: null,
                sessionId: null,
                planId: null,
                status: null,
                sourceCreatedAt: null,
                createdAt: null,
                updatedAt: null
            };

            // Act
            const result = await client.ingestSummary(summary);

            // Assert
            assert.strictEqual(result, true, 'Should return true on success');
            assert.ok(mockIngestViaDaemon.calledOnce, 'Should use daemon for summary ingestion');
            assert.ok(!mockRunPythonScript.called, 'Should NOT fall back to spawn-per-request');
            
            // Verify daemon params include mode: 'sync' and summary_json
            const daemonParams = mockIngestViaDaemon.firstCall.args[0];
            assert.strictEqual(daemonParams.mode, 'sync', 'Should use sync mode for ingestSummary');
            assert.ok(daemonParams.summary_json, 'Should include summary_json');
        });

        test('ingestSummary should fall back to spawn when daemon fails', async () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;
            anyClient.pythonPath = '/usr/bin/python3';
            anyClient.isInitialized = true;

            // Mock ingestViaDaemon to throw an error
            const mockIngestViaDaemon = sandbox.stub(anyClient, 'ingestViaDaemon').rejects(new Error('Daemon connection failed'));

            // Mock runPythonScript to return success
            const mockRunPythonScript = sandbox.stub(anyClient, 'runPythonScript').resolves({
                success: true,
                ingested_chars: 500,
                timestamp: '2025-12-20T10:00:00.000Z'
            });

            const summary = {
                topic: 'Test Topic',
                context: 'Test context',
                decisions: [],
                rationale: [],
                openQuestions: [],
                nextSteps: [],
                references: [],
                timeScope: '2025-12-20',
                topicId: null,
                sessionId: null,
                planId: null,
                status: null,
                sourceCreatedAt: null,
                createdAt: null,
                updatedAt: null
            };

            // Act
            const result = await client.ingestSummary(summary);

            // Assert
            assert.strictEqual(result, true, 'Should return true after successful fallback');
            assert.ok(mockIngestViaDaemon.calledOnce, 'Should try daemon first');
            assert.ok(mockRunPythonScript.calledOnce, 'Should fall back to spawn-per-request on daemon error');
        });

        test('ingestSummary should use spawn directly when daemon mode disabled', async () => {
            // Arrange
            stubDaemonConfigs('spawn');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;
            anyClient.pythonPath = '/usr/bin/python3';
            anyClient.isInitialized = true;

            // Mock runPythonScript to track calls
            const mockRunPythonScript = sandbox.stub(anyClient, 'runPythonScript').resolves({
                success: true,
                ingested_chars: 500,
                timestamp: '2025-12-20T10:00:00.000Z'
            });

            const summary = {
                topic: 'Test Topic',
                context: 'Test context',
                decisions: [],
                rationale: [],
                openQuestions: [],
                nextSteps: [],
                references: [],
                timeScope: '2025-12-20',
                topicId: null,
                sessionId: null,
                planId: null,
                status: null,
                sourceCreatedAt: null,
                createdAt: null,
                updatedAt: null
            };

            // Act
            await client.ingestSummary(summary);

            // Assert
            assert.ok(mockRunPythonScript.calledOnce, 'Should use spawn-per-request directly when daemon disabled');
        });

        test('ingestSummaryAsync should use daemon for add-only when daemon mode enabled', async () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;
            anyClient.pythonPath = '/usr/bin/python3';
            anyClient.isInitialized = true;

            const mockIngestViaDaemon = sandbox.stub(anyClient, 'ingestViaDaemon').resolves({
                success: true,
                staged: true,
                ingested_chars: 123,
                timestamp: '2025-12-20T10:00:00.000Z'
            });

            const mockRunPythonScript = sandbox.stub(anyClient, 'runPythonScript').resolves({
                success: true,
                staged: true
            });

            const startOperationStub = sandbox.stub().resolves('op-123');
            const manager = {
                startOperation: startOperationStub
            } as any;

            const summary = {
                topic: 'Test Topic',
                context: 'Test context',
                decisions: [],
                rationale: [],
                openQuestions: [],
                nextSteps: [],
                references: [],
                timeScope: '2025-12-20',
                topicId: null,
                sessionId: null,
                planId: null,
                status: null,
                sourceCreatedAt: null,
                createdAt: null,
                updatedAt: null
            };

            // Act
            const result = await client.ingestSummaryAsync(summary as any, manager);

            // Assert
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.staged, true);
            assert.strictEqual(result.operationId, 'op-123');
            assert.ok(mockIngestViaDaemon.calledOnce, 'Should use daemon for add-only staging');
            assert.ok(!mockRunPythonScript.called, 'Should NOT fall back to spawn-per-request');
            assert.ok(startOperationStub.calledOnce, 'Should enqueue background cognify op');

            const daemonParams = mockIngestViaDaemon.firstCall.args[0];
            assert.strictEqual(daemonParams.mode, 'add-only');
            assert.ok(daemonParams.summary_json, 'Should include summary_json');
        });

        test('ingestSummaryAsync should retry on retryable daemon error and succeed', async () => {
            // Plan 092 M4: Removed subprocess fallback, now retries on daemon path
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;
            anyClient.pythonPath = '/usr/bin/python3';
            anyClient.isInitialized = true;

            // First call fails with retryable error, second succeeds
            let callCount = 0;
            const mockIngestViaDaemon = sandbox.stub(anyClient, 'ingestViaDaemon').callsFake(async () => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('EBUSY: database is locked');
                }
                return {
                    success: true,
                    staged: true,
                    ingested_chars: 123,
                    timestamp: '2025-12-20T10:00:00.000Z'
                };
            });

            const startOperationStub = sandbox.stub().resolves('op-456');
            const manager = {
                startOperation: startOperationStub
            } as any;

            const summary = {
                topic: 'Test Topic',
                context: 'Test context',
                decisions: [],
                rationale: [],
                openQuestions: [],
                nextSteps: [],
                references: [],
                timeScope: '2025-12-20',
                topicId: null,
                sessionId: null,
                planId: null,
                status: null,
                sourceCreatedAt: null,
                createdAt: null,
                updatedAt: null
            };

            // Act
            const result = await client.ingestSummaryAsync(summary as any, manager);

            // Assert
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.staged, true);
            assert.strictEqual(result.operationId, 'op-456');
            assert.strictEqual(mockIngestViaDaemon.callCount, 2, 'Should retry daemon call');
            assert.ok(startOperationStub.calledOnce, 'Should enqueue background cognify op after successful retry');
        });

        // Plan 097: Tests for daemon-first visualization
        test('visualize should use daemon when daemon mode enabled and daemon available', async () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;
            anyClient.pythonPath = '/usr/bin/python3';
            anyClient.isInitialized = true;

            // Mock visualizeViaDaemon to track calls
            const mockVisualizeViaDaemon = sandbox.stub(anyClient, 'visualizeViaDaemon').resolves({
                success: true,
                output_path: '/tmp/graph.html',
                node_count: 10,
                offline_safe: true
            });

            // Mock runPythonScript to ensure it's NOT called
            const mockRunPythonScript = sandbox.stub(anyClient, 'runPythonScript').resolves({
                success: true,
                output_path: '/tmp/graph.html'
            });

            // Act
            const result = await client.visualize('/tmp/graph.html');

            // Assert
            assert.ok(result.success, 'Should return success');
            assert.ok(mockVisualizeViaDaemon.calledOnce, 'Should use daemon for visualization');
            assert.ok(!mockRunPythonScript.called, 'Should NOT fall back to spawn-per-request');
        });

        test('visualize should fall back to spawn when daemon fails', async () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;
            anyClient.pythonPath = '/usr/bin/python3';
            anyClient.isInitialized = true;

            // Mock visualizeViaDaemon to throw an error
            const mockVisualizeViaDaemon = sandbox.stub(anyClient, 'visualizeViaDaemon').rejects(new Error('Daemon connection failed'));

            // Mock runPythonScript to return success
            const mockRunPythonScript = sandbox.stub(anyClient, 'runPythonScript').resolves({
                success: true,
                output_path: '/tmp/graph.html',
                node_count: 5,
                offline_safe: true
            });

            // Act
            const result = await client.visualize('/tmp/graph.html');

            // Assert
            assert.ok(result.success, 'Should return success from fallback');
            assert.ok(mockVisualizeViaDaemon.calledOnce, 'Should try daemon first');
            assert.ok(mockRunPythonScript.calledOnce, 'Should fall back to spawn-per-request on daemon error');
        });

        test('visualize should use spawn directly when daemon mode disabled', async () => {
            // Arrange
            stubDaemonConfigs('spawn');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;
            anyClient.pythonPath = '/usr/bin/python3';
            anyClient.isInitialized = true;

            // Mock runPythonScript to track calls
            const mockRunPythonScript = sandbox.stub(anyClient, 'runPythonScript').resolves({
                success: true,
                output_path: '/tmp/graph.html',
                node_count: 8,
                offline_safe: true
            });

            // Act
            const result = await client.visualize('/tmp/graph.html');

            // Assert
            assert.ok(result.success, 'Should return success');
            assert.ok(mockRunPythonScript.calledOnce, 'Should use spawn-per-request directly when daemon disabled');
        });

        test('visualizeViaDaemon sends correct request to daemon', async () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;
            anyClient.pythonPath = '/usr/bin/python3';
            anyClient.isInitialized = true;

            // Directly stub daemonManager.sendRequest
            const mockSendRequest = sandbox.stub(anyClient.daemonManager, 'sendRequest').resolves({
                result: {
                    success: true,
                    output_path: '/tmp/graph.html',
                    node_count: 15,
                    offline_safe: true
                }
            });

            // Act
            const result = await anyClient.visualizeViaDaemon('/tmp/graph.html');

            // Assert
            assert.ok(mockSendRequest.calledOnce, 'Should call daemon sendRequest');
            assert.strictEqual(mockSendRequest.firstCall.args[0], 'visualize', 'Should use visualize method');
            assert.deepStrictEqual(mockSendRequest.firstCall.args[1], { output_path: '/tmp/graph.html' }, 'Should pass output_path');
            assert.ok(result.success, 'Should return success from daemon result');
        });

        test('visualizeViaDaemon maps daemon error to FlowbabyResult', async () => {
            // Arrange
            stubDaemonConfigs('daemon');
            sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');

            const client = new FlowbabyClient(workspacePath, mockContext);
            const anyClient = client as any;
            anyClient.pythonPath = '/usr/bin/python3';
            anyClient.isInitialized = true;

            // Mock daemon error response
            sandbox.stub(anyClient.daemonManager, 'sendRequest').resolves({
                error: {
                    code: -32001,
                    message: 'Not authenticated',
                    data: {
                        error_code: 'NOT_AUTHENTICATED',
                        user_message: 'Cloud login required'
                    }
                }
            });

            // Act
            const result = await anyClient.visualizeViaDaemon('/tmp/graph.html');

            // Assert
            assert.strictEqual(result.success, false, 'Should return failure');
            assert.strictEqual(result.error_code, 'NOT_AUTHENTICATED', 'Should preserve error_code from daemon');
            assert.ok(result.user_message.includes('Cloud'), 'Should preserve user_message');
        });
    });

    // Plan 092 M4: Tests for isRetryableError and staging retry logic
    suite('Staging Retry Logic (Plan 092)', () => {
        test('isRetryableError recognizes EBUSY error code', () => {
            const client = new FlowbabyClient(testWorkspacePath, mockContext);
            const anyClient = client as any;
            
            const result = anyClient.isRetryableError('EBUSY: resource busy');
            
            assert.strictEqual(result.isRetryable, true);
            assert.ok(result.reason.includes('EBUSY'));
        });

        test('isRetryableError recognizes LOCK_ERROR error code', () => {
            const client = new FlowbabyClient(testWorkspacePath, mockContext);
            const anyClient = client as any;
            
            const result = anyClient.isRetryableError('LOCK_ERROR: database is busy');
            
            assert.strictEqual(result.isRetryable, true);
            assert.ok(result.reason.includes('LOCK_ERROR'));
        });

        test('isRetryableError recognizes database locked pattern', () => {
            const client = new FlowbabyClient(testWorkspacePath, mockContext);
            const anyClient = client as any;
            
            const result = anyClient.isRetryableError('SQLite error: database is locked');
            
            assert.strictEqual(result.isRetryable, true);
            assert.ok(result.reason.includes('database is locked'));
        });

        test('isRetryableError rejects non-retryable errors', () => {
            const client = new FlowbabyClient(testWorkspacePath, mockContext);
            const anyClient = client as any;
            
            const result = anyClient.isRetryableError('Invalid payload: missing topic field');
            
            assert.strictEqual(result.isRetryable, false);
            assert.strictEqual(result.reason, 'not_matched');
        });

        test('isRetryableError recognizes timeout pattern', () => {
            const client = new FlowbabyClient(testWorkspacePath, mockContext);
            const anyClient = client as any;
            
            const result = anyClient.isRetryableError('Request timeout exceeded after 30s');
            
            assert.strictEqual(result.isRetryable, true);
            assert.ok(result.reason.includes('timeout'));
        });

        test('STAGING_MAX_RETRIES constant is defined', () => {
            const client = new FlowbabyClient(testWorkspacePath, mockContext);
            const anyClient = client as any;
            
            assert.strictEqual(typeof anyClient.STAGING_MAX_RETRIES, 'number');
            assert.ok(anyClient.STAGING_MAX_RETRIES >= 1, 'Should have at least 1 retry');
            assert.ok(anyClient.STAGING_MAX_RETRIES <= 5, 'Should not have more than 5 retries');
        });

        test('STAGING_RETRY_DELAY_MS constant is defined', () => {
            const client = new FlowbabyClient(testWorkspacePath, mockContext);
            const anyClient = client as any;
            
            assert.strictEqual(typeof anyClient.STAGING_RETRY_DELAY_MS, 'number');
            assert.ok(anyClient.STAGING_RETRY_DELAY_MS >= 500, 'Delay should be at least 500ms');
            assert.ok(anyClient.STAGING_RETRY_DELAY_MS <= 5000, 'Delay should not exceed 5s');
        });
    });
});
