/**
 * Plan 101: Tests for Embedding Schema Migration
 * 
 * Tests the automatic backup-and-reset mechanism for v0.6.2 → v0.7.0 upgrade
 * where embedding schema incompatibility requires a fresh start.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';
import mock = require('mock-fs');
import { FlowbabySetupService, EMBEDDING_SCHEMA_VERSION, CURRENT_EMBEDDING_SCHEMA } from '../../setup/FlowbabySetupService';

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

suite('Plan 101: Embedding Schema Migration', () => {
    const testWorkspacePath = '/tmp/test-migration';
    let mockContext: vscode.ExtensionContext;
    let outputChannel: vscode.OutputChannel;
    let sandbox: sinon.SinonSandbox;
    let stopDaemonStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockContext = createMockContext();
        outputChannel = {
            appendLine: sandbox.stub(),
            append: sandbox.stub(),
            clear: sandbox.stub(),
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            name: 'Test',
            replace: sandbox.stub()
        } as any;

        stopDaemonStub = sandbox.stub().resolves();

        // Mock vscode.window methods
        sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as any);
        sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined as any);
        sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as any);
        sandbox.stub(vscode.commands, 'executeCommand').resolves();
    });

    teardown(() => {
        sandbox.restore();
        try { mock.restore(); } catch {}
    });

    suite('Schema Version Constants', () => {
        test('EMBEDDING_SCHEMA_VERSION path is under .flowbaby/system/', () => {
            // The marker file path should be .flowbaby/system/EMBEDDING_SCHEMA_VERSION
            assert.strictEqual(EMBEDDING_SCHEMA_VERSION, 'system/EMBEDDING_SCHEMA_VERSION');
        });

        test('CURRENT_EMBEDDING_SCHEMA is 2 for v0.7.0', () => {
            assert.strictEqual(CURRENT_EMBEDDING_SCHEMA, 2);
        });
    });

    suite('isPreUpgradeWorkspace() - Detection Logic', () => {
        test('returns false when .flowbaby does not exist (fresh workspace)', async () => {
            mock({
                [testWorkspacePath]: {}
            });

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            const result = await service.isPreUpgradeWorkspace();
            assert.strictEqual(result, false);
        });

        test('returns false when .flowbaby exists but bridge-env.json is missing (fresh workspace)', async () => {
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
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            const result = await service.isPreUpgradeWorkspace();
            assert.strictEqual(result, false);
        });

        test('returns true when bridge-env.json exists but schema marker is missing (pre-0.7.0)', async () => {
            const pythonPath = process.platform === 'win32'
                ? path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
                : path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');

            mock({
                [testWorkspacePath]: {
                    '.flowbaby': {
                        'bridge-env.json': JSON.stringify({
                            pythonPath: pythonPath,
                            ownership: 'managed',
                            requirementsHash: 'abc123',
                            createdAt: '2025-01-01T00:00:00Z',
                            platform: process.platform
                        }),
                        'venv': {
                            'bin': { 'python': '' },
                            'Scripts': { 'python.exe': '' }
                        }
                    }
                }
            });

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            const result = await service.isPreUpgradeWorkspace();
            assert.strictEqual(result, true);
        });

        test('returns false when schema marker exists with current version', async () => {
            const pythonPath = process.platform === 'win32'
                ? path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
                : path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');

            mock({
                [testWorkspacePath]: {
                    '.flowbaby': {
                        'bridge-env.json': JSON.stringify({
                            pythonPath: pythonPath,
                            ownership: 'managed',
                            requirementsHash: 'abc123',
                            createdAt: '2025-01-01T00:00:00Z',
                            platform: process.platform
                        }),
                        'system': {
                            'EMBEDDING_SCHEMA_VERSION': '2'
                        },
                        'venv': {
                            'bin': { 'python': '' },
                            'Scripts': { 'python.exe': '' }
                        }
                    }
                }
            });

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            const result = await service.isPreUpgradeWorkspace();
            assert.strictEqual(result, false);
        });

        test('returns true when schema marker exists with older version', async () => {
            const pythonPath = process.platform === 'win32'
                ? path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
                : path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');

            mock({
                [testWorkspacePath]: {
                    '.flowbaby': {
                        'bridge-env.json': JSON.stringify({
                            pythonPath: pythonPath,
                            ownership: 'managed',
                            requirementsHash: 'abc123',
                            createdAt: '2025-01-01T00:00:00Z',
                            platform: process.platform
                        }),
                        'system': {
                            'EMBEDDING_SCHEMA_VERSION': '1'
                        },
                        'venv': {
                            'bin': { 'python': '' },
                            'Scripts': { 'python.exe': '' }
                        }
                    }
                }
            });

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            const result = await service.isPreUpgradeWorkspace();
            assert.strictEqual(result, true);
        });
    });

    suite('backupPreUpgradeWorkspace() - Backup/Rename Logic', () => {
        test('generates Windows-safe backup folder name without colons', async () => {
            const pythonPath = process.platform === 'win32'
                ? path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
                : path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');

            mock({
                [testWorkspacePath]: {
                    '.flowbaby': {
                        'bridge-env.json': JSON.stringify({
                            pythonPath: pythonPath,
                            ownership: 'managed',
                            requirementsHash: 'abc123',
                            createdAt: '2025-01-01T00:00:00Z',
                            platform: process.platform
                        }),
                        'venv': {
                            'bin': { 'python': '' },
                            'Scripts': { 'python.exe': '' }
                        }
                    }
                }
            });

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            const result = await service.backupPreUpgradeWorkspace();

            // Should return success with backup folder path
            assert.strictEqual(result.success, true);
            assert.ok(result.backupPath, 'backupPath should be defined');

            // Backup folder name should be Windows-safe (no colons)
            const backupFolderName = path.basename(result.backupPath!);
            assert.ok(!backupFolderName.includes(':'), 'Backup folder name should not contain colons');
            assert.ok(backupFolderName.startsWith('.flowbaby-pre-0.7.0-backup-'), 
                'Backup folder should start with .flowbaby-pre-0.7.0-backup-');
        });

        test('stops daemon before rename attempt', async () => {
            const pythonPath = process.platform === 'win32'
                ? path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
                : path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');

            mock({
                [testWorkspacePath]: {
                    '.flowbaby': {
                        'bridge-env.json': JSON.stringify({
                            pythonPath: pythonPath,
                            ownership: 'managed',
                            requirementsHash: 'abc123',
                            createdAt: '2025-01-01T00:00:00Z',
                            platform: process.platform
                        }),
                        'venv': {
                            'bin': { 'python': '' },
                            'Scripts': { 'python.exe': '' }
                        }
                    }
                }
            });

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            await service.backupPreUpgradeWorkspace();

            // Daemon stop should have been called before rename
            assert.ok(stopDaemonStub.calledOnce, 'stopDaemonFn should be called once');
        });

        test('returns failure when rename fails due to file lock', async () => {
            const pythonPath = process.platform === 'win32'
                ? path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
                : path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');

            mock({
                [testWorkspacePath]: {
                    '.flowbaby': {
                        'bridge-env.json': JSON.stringify({
                            pythonPath: pythonPath,
                            ownership: 'managed',
                            requirementsHash: 'abc123',
                            createdAt: '2025-01-01T00:00:00Z',
                            platform: process.platform
                        }),
                        'venv': {
                            'bin': { 'python': '' },
                            'Scripts': { 'python.exe': '' }
                        }
                    }
                }
            });

            // Stub fs.promises.rename to throw EPERM error
            sandbox.stub(fs.promises, 'rename').rejects({ code: 'EPERM', message: 'File locked' });

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            const result = await service.backupPreUpgradeWorkspace();

            assert.strictEqual(result.success, false);
            assert.ok(result.error, 'Error should be defined on failure');
        });

        test('handles collision with existing backup folder', async () => {
            const pythonPath = process.platform === 'win32'
                ? path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
                : path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');

            // Create mock with an existing backup folder at the expected name
            mock({
                [testWorkspacePath]: {
                    '.flowbaby': {
                        'bridge-env.json': JSON.stringify({
                            pythonPath: pythonPath,
                            ownership: 'managed',
                            requirementsHash: 'abc123',
                            createdAt: '2025-01-01T00:00:00Z',
                            platform: process.platform
                        }),
                        'venv': {
                            'bin': { 'python': '' },
                            'Scripts': { 'python.exe': '' }
                        }
                    },
                    // Simulate existing backup - the implementation should handle collision
                    '.flowbaby-pre-0.7.0-backup-20260112T000000': {}
                }
            });

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            const result = await service.backupPreUpgradeWorkspace();

            // Should still succeed with a unique name (suffix added)
            assert.strictEqual(result.success, true);
            assert.ok(result.backupPath, 'backupPath should be defined');
        });
    });

    suite('checkPreUpgradeMigration() - Orchestration', () => {
        test('returns no-action when workspace is fresh', async () => {
            mock({
                [testWorkspacePath]: {}
            });

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            const result = await service.checkPreUpgradeMigration();

            assert.strictEqual(result.action, 'none');
            assert.strictEqual(result.requiresFreshInit, false);
        });

        test('returns no-action when workspace already has current schema', async () => {
            const pythonPath = process.platform === 'win32'
                ? path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
                : path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');

            mock({
                [testWorkspacePath]: {
                    '.flowbaby': {
                        'bridge-env.json': JSON.stringify({
                            pythonPath: pythonPath,
                            ownership: 'managed',
                            requirementsHash: 'abc123',
                            createdAt: '2025-01-01T00:00:00Z',
                            platform: process.platform
                        }),
                        'system': {
                            'EMBEDDING_SCHEMA_VERSION': '2'
                        },
                        'venv': {
                            'bin': { 'python': '' },
                            'Scripts': { 'python.exe': '' }
                        }
                    }
                }
            });

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            const result = await service.checkPreUpgradeMigration();

            assert.strictEqual(result.action, 'none');
            assert.strictEqual(result.requiresFreshInit, false);
        });

        test('returns backup-success and requiresFreshInit when pre-0.7.0 workspace backed up', async () => {
            const pythonPath = process.platform === 'win32'
                ? path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
                : path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');

            mock({
                [testWorkspacePath]: {
                    '.flowbaby': {
                        'bridge-env.json': JSON.stringify({
                            pythonPath: pythonPath,
                            ownership: 'managed',
                            requirementsHash: 'abc123',
                            createdAt: '2025-01-01T00:00:00Z',
                            platform: process.platform
                        }),
                        'venv': {
                            'bin': { 'python': '' },
                            'Scripts': { 'python.exe': '' }
                        }
                    }
                }
            });

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            const result = await service.checkPreUpgradeMigration();

            assert.strictEqual(result.action, 'backup-success');
            assert.strictEqual(result.requiresFreshInit, true);
            assert.ok(result.backupPath, 'backupPath should be defined');
        });

        test('returns backup-failed and requiresFreshInit when backup fails', async () => {
            const pythonPath = process.platform === 'win32'
                ? path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
                : path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');

            mock({
                [testWorkspacePath]: {
                    '.flowbaby': {
                        'bridge-env.json': JSON.stringify({
                            pythonPath: pythonPath,
                            ownership: 'managed',
                            requirementsHash: 'abc123',
                            createdAt: '2025-01-01T00:00:00Z',
                            platform: process.platform
                        }),
                        'venv': {
                            'bin': { 'python': '' },
                            'Scripts': { 'python.exe': '' }
                        }
                    }
                }
            });

            // Stub fs.promises.rename to throw EPERM error
            sandbox.stub(fs.promises, 'rename').rejects({ code: 'EPERM', message: 'File locked' });

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            const result = await service.checkPreUpgradeMigration();

            assert.strictEqual(result.action, 'backup-failed');
            assert.strictEqual(result.requiresFreshInit, true);
            assert.ok(result.error, 'error should be defined on failure');
        });
    });

    suite('writeEmbeddingSchemaMarker() - Marker Write', () => {
        test('writes current schema version to marker file', async () => {
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
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            await service.writeEmbeddingSchemaMarker();

            // Verify marker file was written
            const markerPath = path.join(testWorkspacePath, '.flowbaby', 'system', 'EMBEDDING_SCHEMA_VERSION');
            const content = fs.readFileSync(markerPath, 'utf8');
            assert.strictEqual(content, '2');
        });

        test('creates system directory if missing', async () => {
            mock({
                [testWorkspacePath]: {
                    '.flowbaby': {}
                }
            });

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            await service.writeEmbeddingSchemaMarker();

            // Verify marker file was written (directory created automatically)
            const markerPath = path.join(testWorkspacePath, '.flowbaby', 'system', 'EMBEDDING_SCHEMA_VERSION');
            assert.ok(fs.existsSync(markerPath), 'Marker file should exist');
        });
    });
});
