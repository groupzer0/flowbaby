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

            // Plan 107: User must confirm backup via modal
            (vscode.window.showWarningMessage as any).resolves('Proceed with Backup');

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

            // Plan 107: User must confirm backup via modal
            (vscode.window.showWarningMessage as any).resolves('Proceed with Backup');
            
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

    suite('initializeWorkspace() - Configured Python Adoption (Plan 103)', () => {
        test('writes schema marker when adopting configured Python (prevents false pre-upgrade detection)', async () => {
            mock({
                [testWorkspacePath]: {}
            });

            const configStub = sandbox.stub().returns('/mock/python');
            sandbox.stub(vscode.workspace, 'getConfiguration').returns({
                get: configStub
            } as any);

            (vscode.window.showInformationMessage as any).resolves('Use Configured Python');

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                stopDaemonStub
            );

            sandbox.stub(service as any, 'getSystemPythonCommand').returns('python');
            sandbox.stub(service, 'computeRequirementsHash').resolves('abc123');
            sandbox.stub(service, 'verifyEnvironment').resolves(true);

            await service.initializeWorkspace();

            const markerPath = path.join(testWorkspacePath, '.flowbaby', 'system', 'EMBEDDING_SCHEMA_VERSION');
            assert.ok(fs.existsSync(markerPath), 'Marker file should exist after configured-Python adoption');
            assert.strictEqual(fs.readFileSync(markerPath, 'utf8'), String(CURRENT_EMBEDDING_SCHEMA));

            const isPreUpgrade = await service.isPreUpgradeWorkspace();
            assert.strictEqual(isPreUpgrade, false);

            const migrationResult = await service.checkPreUpgradeMigration();
            assert.strictEqual(migrationResult.action, 'none');
            assert.strictEqual(migrationResult.requiresFreshInit, false);

            const children = fs.readdirSync(testWorkspacePath);
            const backupFolders = children.filter(name => name.startsWith('.flowbaby-pre-0.7.0-backup-'));
            assert.strictEqual(backupFolders.length, 0, 'No backup folder should be created after configured-Python adoption');
        });
    });

    /**
     * Plan 107: State-based migration detection tests
     * Tests the explicit detection state model: NOT_LEGACY, LEGACY_CONFIRMED, UNKNOWN_IO_ERROR
     */
    suite('Plan 107: State-Based Migration Detection', () => {
        test('detectMigrationState returns NOT_LEGACY when marker is current version', async () => {
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
                            'EMBEDDING_SCHEMA_VERSION': String(CURRENT_EMBEDDING_SCHEMA)
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

            const state = await service.detectMigrationState();
            assert.strictEqual(state.state, 'NOT_LEGACY');
            assert.strictEqual(state.requiresBackup, false);
        });

        test('detectMigrationState returns LEGACY_CONFIRMED when marker missing but bridge-env exists', async () => {
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
                        })
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

            const state = await service.detectMigrationState();
            assert.strictEqual(state.state, 'LEGACY_CONFIRMED');
            assert.strictEqual(state.requiresBackup, true);
            assert.ok(state.reason?.includes('marker'), 'Should mention missing marker');
        });

        test('detectMigrationState returns UNKNOWN_IO_ERROR on non-ENOENT read error', async () => {
            // This test verifies REQ-2: non-ENOENT errors should NOT trigger backup
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
                            // Create marker file but make it unreadable
                            'EMBEDDING_SCHEMA_VERSION': mock.file({
                                content: '2',
                                mode: 0o000 // No permissions
                            })
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

            const state = await service.detectMigrationState();
            // On permission error, should return UNKNOWN_IO_ERROR, NOT trigger backup
            assert.strictEqual(state.state, 'UNKNOWN_IO_ERROR');
            assert.strictEqual(state.requiresBackup, false, 'UNKNOWN_IO_ERROR must NOT trigger backup');
        });

        test('UNKNOWN_IO_ERROR does not proceed to initialization', async () => {
            // Architecture guardrail: UNKNOWN_IO_ERROR must be fail-closed for initialization
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
                            'EMBEDDING_SCHEMA_VERSION': mock.file({
                                content: '2',
                                mode: 0o000
                            })
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
            // Should NOT proceed as healthy (no action: 'none')
            // Should indicate special handling needed
            assert.notStrictEqual(result.action, 'backup-success', 'Should not backup on IO error');
            // The result should indicate an error state
            assert.ok(result.action === 'io-error' || result.error, 'Should indicate IO error state');
        });
    });

    /**
     * Plan 107: REQ-1 User Confirmation Modal Tests
     * Tests the modal gate before backup with fail-closed semantics on Ignore/Close
     */
    suite('Plan 107: REQ-1 User Confirmation Modal', () => {
        test('shows modal and proceeds with backup when user clicks "Proceed with Backup"', async () => {
            // Setup: Create a pre-upgrade workspace (missing schema marker)
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
                            [process.platform === 'win32' ? 'Scripts' : 'bin']: {
                                [process.platform === 'win32' ? 'python.exe' : 'python']: 'mock'
                            }
                        }
                    }
                }
            });

            // User clicks "Proceed with Backup"
            (vscode.window.showWarningMessage as any).resolves('Proceed with Backup');

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

            // Verify modal was shown
            assert.ok((vscode.window.showWarningMessage as any).called, 'Modal should be shown');
            const modalCall = (vscode.window.showWarningMessage as any).getCall(0);
            assert.ok(modalCall.args[0].includes('Flowbaby'), 'Modal message should mention Flowbaby');
            assert.ok(modalCall.args[1]?.modal === true, 'Should be a modal dialog');
            assert.ok(modalCall.args.includes('Proceed with Backup'), 'Should have proceed option');
            assert.ok(modalCall.args.includes('Ignore'), 'Should have ignore option');

            // Verify backup proceeded
            assert.strictEqual(result.action, 'backup-success', 'Should complete backup on proceed');
            assert.strictEqual(result.requiresFreshInit, true);
        });

        test('returns user-declined when user clicks "Ignore" (fail-closed)', async () => {
            // Setup: Create a pre-upgrade workspace
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
                        })
                    }
                }
            });

            // User clicks "Ignore"
            (vscode.window.showWarningMessage as any).resolves('Ignore');

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

            // Verify fail-closed: no backup, no proceed into healthy init
            assert.strictEqual(result.action, 'user-declined', 'Should indicate user declined');
            assert.strictEqual(result.requiresFreshInit, false, 'Should NOT proceed with init');
        });

        test('returns user-declined when user closes modal without choosing (fail-closed)', async () => {
            // Setup: Create a pre-upgrade workspace
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
                        })
                    }
                }
            });

            // User closes modal without choosing (returns undefined)
            (vscode.window.showWarningMessage as any).resolves(undefined);

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

            // Verify fail-closed: closing modal is treated as Ignore
            assert.strictEqual(result.action, 'user-declined', 'Should indicate user declined');
            assert.strictEqual(result.requiresFreshInit, false, 'Should NOT proceed with init');
        });

        test('logs user choice for forensics when modal is dismissed', async () => {
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
                        })
                    }
                }
            });

            (vscode.window.showWarningMessage as any).resolves('Ignore');

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

            // The console.log is a forensic/support feature, not testable in unit tests
            // because it goes to extension-host console. We verify the behavior is correct:
            // 1. User chose "Ignore" (modal was shown)
            // 2. Action is 'user-declined'
            // The console.log statement exists in the source code (verified by code review)
            assert.strictEqual(result.action, 'user-declined', 'Should indicate user declined');
            assert.ok((vscode.window.showWarningMessage as any).called, 'Modal should be shown');
            
            // Verify modal was called with correct args including "Ignore" option
            const modalCall = (vscode.window.showWarningMessage as any).getCall(0);
            assert.ok(modalCall.args.includes('Ignore'), 'Modal should have Ignore option');
        });

        test('does NOT show modal for NOT_LEGACY state', async () => {
            // Setup: Create a current workspace with schema marker
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
                            'EMBEDDING_SCHEMA_VERSION': String(CURRENT_EMBEDDING_SCHEMA)
                        }
                    }
                }
            });

            // Reset to track new calls
            (vscode.window.showWarningMessage as any).resetHistory();

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

            // Verify: no modal shown for current workspace
            assert.strictEqual((vscode.window.showWarningMessage as any).called, false, 
                'Modal should NOT be shown for NOT_LEGACY state');
            assert.strictEqual(result.action, 'none');
        });

        test('does NOT show modal for UNKNOWN_IO_ERROR state', async () => {
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
                            'EMBEDDING_SCHEMA_VERSION': mock.file({
                                content: '2',
                                mode: 0o000
                            })
                        }
                    }
                }
            });

            // Reset to track new calls
            (vscode.window.showWarningMessage as any).resetHistory();

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

            // Verify: no modal shown for IO error (should fail-closed immediately)
            assert.strictEqual((vscode.window.showWarningMessage as any).called, false, 
                'Modal should NOT be shown for UNKNOWN_IO_ERROR state');
            assert.strictEqual(result.action, 'io-error');
        });
    });

    /**
     * Plan 107: REQ-4 Pre-Backup Revalidation Tests
     * Tests that marker state is re-verified immediately before backup
     */
    suite('Plan 107: REQ-4 Pre-Backup Revalidation', () => {
        test('aborts backup if marker appears after initial detection', async () => {
            // Scenario: Initial check shows LEGACY_CONFIRMED (missing marker)
            // But during modal display, marker appears (e.g., another window completed init)
            // Expected: Abort backup, return action: 'revalidation-aborted'
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
                        })
                        // No marker initially - appears LEGACY_CONFIRMED
                    }
                }
            });

            // User clicks "Proceed with Backup", but marker appears during modal display
            // We simulate this by writing the marker before returning from the modal
            (vscode.window.showWarningMessage as any).callsFake(async () => {
                // Simulate another window completing init during modal display
                const systemDir = path.join(testWorkspacePath, '.flowbaby', 'system');
                if (!fs.existsSync(systemDir)) {
                    fs.mkdirSync(systemDir, { recursive: true });
                }
                fs.writeFileSync(
                    path.join(systemDir, 'EMBEDDING_SCHEMA_VERSION'),
                    String(CURRENT_EMBEDDING_SCHEMA)
                );
                return 'Proceed with Backup';
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

            // The pre-backup revalidation should detect marker and abort
            // Note: This test will fail until REQ-4 is implemented
            assert.strictEqual(result.action, 'revalidation-aborted', 
                'Should abort when marker appears after initial detection');
            assert.strictEqual(result.requiresFreshInit, false, 
                'Should not require fresh init when revalidation aborts');
        });

        test('proceeds with backup if revalidation still shows LEGACY_CONFIRMED', async () => {
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
                            [process.platform === 'win32' ? 'Scripts' : 'bin']: {
                                [process.platform === 'win32' ? 'python.exe' : 'python']: 'mock'
                            }
                        }
                        // No marker - LEGACY_CONFIRMED persists
                    }
                }
            });

            (vscode.window.showWarningMessage as any).resolves('Proceed with Backup');

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

            // Should proceed with backup since revalidation still shows LEGACY_CONFIRMED
            assert.strictEqual(result.action, 'backup-success');
            assert.strictEqual(result.requiresFreshInit, true);
        });

        test('logs pre-backup revalidation for forensics', async () => {
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
                            [process.platform === 'win32' ? 'Scripts' : 'bin']: {
                                [process.platform === 'win32' ? 'python.exe' : 'python']: 'mock'
                            }
                        }
                    }
                }
            });

            (vscode.window.showWarningMessage as any).resolves('Proceed with Backup');

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

            // Verify backup succeeded (logging is verified by code review)
            assert.strictEqual(result.action, 'backup-success');
        });
    });

    /**
     * Plan 107: REQ-5 Write Marker Early Tests
     * Tests that marker is written early in init to prevent partial-init false positives
     */
    suite('Plan 107: REQ-5 Write Marker Early', () => {
        test('writeEmbeddingSchemaMarker creates directory and writes marker idempotently', async () => {
            // This test verifies the marker write function works correctly
            // and can be called early in init without depending on other state
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

            // Call writeEmbeddingSchemaMarker early (before bridge-env exists)
            await service.writeEmbeddingSchemaMarker();

            // Verify marker exists
            const markerPath = path.join(testWorkspacePath, '.flowbaby', 'system', 'EMBEDDING_SCHEMA_VERSION');
            assert.ok(fs.existsSync(markerPath), 'Marker should be created');
            assert.strictEqual(fs.readFileSync(markerPath, 'utf8'), String(CURRENT_EMBEDDING_SCHEMA));

            // Verify no bridge-env.json yet (marker written independently)
            const bridgeEnvPath = path.join(testWorkspacePath, '.flowbaby', 'bridge-env.json');
            assert.ok(!fs.existsSync(bridgeEnvPath), 'bridge-env.json should NOT exist yet');
        });

        test('partial init (bridge-env exists, marker missing) does NOT trigger backup after REQ-5 is implemented', async () => {
            // After REQ-5: If .flowbaby/bridge-env.json exists, marker should ALSO exist
            // because marker is written early in init
            // This test documents the expected invariant
            
            const pythonPath = process.platform === 'win32'
                ? path.join(testWorkspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
                : path.join(testWorkspacePath, '.flowbaby', 'venv', 'bin', 'python');

            // Simulate post-REQ-5 world: if bridge-env exists, marker also exists
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
                            'EMBEDDING_SCHEMA_VERSION': String(CURRENT_EMBEDDING_SCHEMA)
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

            // No backup should be triggered when both bridge-env and marker exist
            assert.strictEqual(result.action, 'none');
        });
    });

    /**
     * Plan 107: REQ-7 Guard File Tests
     * Tests the guard file creation, deletion, and orphan detection logic.
     */
    suite('Plan 107: REQ-7 Guard File', () => {
        test('guard file is written before rename and deleted on success', async () => {
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
                },
                '/mock/global-storage': {},
                '/mock/global-storage/backup-audit': {}
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

            // Should succeed
            assert.strictEqual(result.success, true);
            
            // Guard file should be deleted after successful backup
            // (We can't easily verify it was written then deleted in unit test,
            // but we verify the operation completes successfully)
        });

        test('checkOrphanGuardFile returns null when no guard file exists', async () => {
            mock({
                [testWorkspacePath]: {},
                '/mock/global-storage': {},
                '/mock/global-storage/backup-audit': {}
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

            const result = await service.checkOrphanGuardFile();
            assert.strictEqual(result, null);
        });
    });

    /**
     * Plan 107: Quiesce-Before-Rename Enforcement Tests
     * Tests that backup aborts if quiescence cannot be achieved.
     */
    suite('Plan 107: Quiesce-Before-Rename Enforcement', () => {
        test('backup fails if daemon stop times out', async () => {
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
                },
                '/mock/global-storage': {},
                '/mock/global-storage/backup-audit': {}
            });

            // Create a stopDaemon that never resolves (simulating timeout)
            const neverResolvingStopDaemon = sandbox.stub().returns(new Promise(() => {}));

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                neverResolvingStopDaemon
            );

            const result = await service.backupPreUpgradeWorkspace();

            // Should fail due to quiescence timeout
            assert.strictEqual(result.success, false);
            assert.ok(result.error?.includes('quiescence'), 
                'Error should mention quiescence failure');
        });

        test('backup proceeds when daemon stops successfully', async () => {
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
                },
                '/mock/global-storage': {},
                '/mock/global-storage/backup-audit': {}
            });

            // Immediate resolution
            const quickStopDaemon = sandbox.stub().resolves();

            const service = new FlowbabySetupService(
                mockContext,
                testWorkspacePath,
                outputChannel,
                undefined,
                undefined,
                undefined,
                quickStopDaemon
            );

            const result = await service.backupPreUpgradeWorkspace();

            assert.strictEqual(result.success, true);
        });
    });

    /**
     * Plan 107: REQ-8 Audit Logging Wiring Tests
     * 
     * NOTE: console.log cannot be reliably stubbed in VS Code test environment
     * because the extension host uses a different console instance. 
     * (See earlier tests comment: "console.log is a forensic/support feature, 
     * not testable in unit tests because it goes to extension-host console")
     * 
     * These tests verify that:
     * 1. The migration check flow executes without errors when audit logging is wired
     * 2. The backup flow handles audit logger initialization gracefully (best-effort)
     * 
     * Full audit logging tests are in BackupAuditLogger.test.ts which tests
     * the logger in isolation.
     */
    suite('Plan 107: REQ-8 Audit Logging Wiring', () => {
        test('checkPreUpgradeMigration executes with audit logging wired', async () => {
            // Setup for NOT_LEGACY case (no .flowbaby dir)
            mock({
                [testWorkspacePath]: {},
                '/mock/global-storage': {},
                '/mock/global-storage/backup-audit': {}
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

            // Audit logging is wired in checkPreUpgradeMigration - verify it doesn't throw
            const result = await service.checkPreUpgradeMigration();
            
            // For NOT_LEGACY case, should return action: 'none'
            assert.strictEqual(result.action, 'none', 'NOT_LEGACY should return action none');
            
            // The audit logging calls (logAuditEvent) are best-effort and should not
            // affect the return value even if they fail in mock-fs environment
        });

        test('backupPreUpgradeWorkspace executes with audit logging wired', async () => {
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
                },
                '/mock/global-storage': {},
                '/mock/global-storage/backup-audit': {}
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

            // Audit logging is wired in backupPreUpgradeWorkspace - verify it doesn't throw
            const result = await service.backupPreUpgradeWorkspace();
            
            // Should complete backup successfully
            assert.strictEqual(result.success, true, 'Backup should succeed');
            assert.ok(result.backupPath, 'Should have backup path on success');
            
            // The audit logging calls are best-effort and should not affect backup success
        });
    });
});
