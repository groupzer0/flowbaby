import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as sinon from 'sinon';
import mock = require('mock-fs');
import { FlowbabySetupService } from '../setup/FlowbabySetupService';

/**
 * Creates a mock VS Code ExtensionContext for testing.
 */
function createMockContext(): vscode.ExtensionContext {
    return {
        secrets: {
            get: sinon.stub().resolves(undefined),
            store: sinon.stub().resolves(),
            delete: sinon.stub().resolves(),
            keys: sinon.stub().resolves([]),
            onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
        },
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

suite('FlowbabySetupService.checkWorkspaceHealth (Plan 039 M3)', () => {
    const testWorkspacePath = '/tmp/test-workspace-health';
    let mockContext: vscode.ExtensionContext;
    let outputChannel: vscode.OutputChannel;

    setup(() => {
        mockContext = createMockContext();
        outputChannel = {
            appendLine: sinon.stub(),
            append: sinon.stub(),
            clear: sinon.stub(),
            show: sinon.stub(),
            hide: sinon.stub(),
            dispose: sinon.stub(),
            name: 'Test',
            replace: sinon.stub()
        } as any;
    });

    teardown(() => {
        try { mock.restore(); } catch {}
    });

    test('returns FRESH when .flowbaby directory does not exist', async () => {
        mock({
            [testWorkspacePath]: {}
        });

        const service = new FlowbabySetupService(
            mockContext,
            testWorkspacePath,
            outputChannel
        );

        const status = await service.checkWorkspaceHealth();
        assert.strictEqual(status, 'FRESH');

        mock.restore();
    });

    test('returns BROKEN when .flowbaby exists but bridge-env.json is missing', async () => {
        mock({
            [testWorkspacePath]: {
                '.flowbaby': {
                    'system': {}
                }
            }
        });

        const service = new FlowbabySetupService(
            mockContext,
            testWorkspacePath,
            outputChannel
        );

        const status = await service.checkWorkspaceHealth();
        assert.strictEqual(status, 'BROKEN');

        mock.restore();
    });

    test('returns BROKEN when migration marker exists', async () => {
        const pythonPath = process.platform === 'win32'
            ? path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
            : path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');

        mock({
            [testWorkspacePath]: {
                '.flowbaby': {
                    'bridge-env.json': JSON.stringify({
                        pythonPath: pythonPath,
                        ownership: 'managed'
                    }),
                    '.migration-in-progress': 'marker',
                    'venv': {
                        'bin': {
                            'python': ''
                        },
                        'Scripts': {
                            'python.exe': ''
                        }
                    }
                }
            }
        });

        const service = new FlowbabySetupService(
            mockContext,
            testWorkspacePath,
            outputChannel
        );

        const status = await service.checkWorkspaceHealth();
        assert.strictEqual(status, 'BROKEN');

        mock.restore();
    });

    test('returns BROKEN when venv directory is missing', async () => {
        const pythonPath = process.platform === 'win32'
            ? path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
            : path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');

        mock({
            [testWorkspacePath]: {
                '.flowbaby': {
                    'bridge-env.json': JSON.stringify({
                        pythonPath: pythonPath,
                        ownership: 'managed'
                    })
                    // venv directory missing
                }
            }
        });

        const service = new FlowbabySetupService(
            mockContext,
            testWorkspacePath,
            outputChannel
        );

        const status = await service.checkWorkspaceHealth();
        assert.strictEqual(status, 'BROKEN');

        mock.restore();
    });

    test('returns BROKEN when Python executable is missing', async () => {
        const pythonPath = process.platform === 'win32'
            ? path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
            : path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');

        mock({
            [testWorkspacePath]: {
                '.flowbaby': {
                    'bridge-env.json': JSON.stringify({
                        pythonPath: pythonPath,
                        ownership: 'managed'
                    }),
                    'venv': {
                        'bin': {},  // Empty - no python
                        'Scripts': {} // Empty - no python.exe
                    }
                }
            }
        });

        const service = new FlowbabySetupService(
            mockContext,
            testWorkspacePath,
            outputChannel
        );

        const status = await service.checkWorkspaceHealth();
        assert.strictEqual(status, 'BROKEN');

        mock.restore();
    });

    test('returns VALID when all components are present', async () => {
        const pythonPath = process.platform === 'win32'
            ? path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
            : path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');

        const mockFs: any = {
            [testWorkspacePath]: {
                '.flowbaby': {
                    'bridge-env.json': JSON.stringify({
                        pythonPath: pythonPath,
                        ownership: 'managed',
                        requirementsHash: 'abc123',
                        createdAt: new Date().toISOString(),
                        platform: process.platform
                    }),
                    'venv': {
                        'bin': {
                            'python': ''
                        },
                        'Scripts': {
                            'python.exe': ''
                        }
                    }
                }
            }
        };

        mock(mockFs);

        const service = new FlowbabySetupService(
            mockContext,
            testWorkspacePath,
            outputChannel
        );

        const status = await service.checkWorkspaceHealth();
        assert.strictEqual(status, 'VALID');

        mock.restore();
    });

    test('returns BROKEN when bridge-env.json is malformed', async () => {
        mock({
            [testWorkspacePath]: {
                '.flowbaby': {
                    'bridge-env.json': 'not valid json {'
                }
            }
        });

        const service = new FlowbabySetupService(
            mockContext,
            testWorkspacePath,
            outputChannel
        );

        const status = await service.checkWorkspaceHealth();
        assert.strictEqual(status, 'BROKEN');

        mock.restore();
    });
});
