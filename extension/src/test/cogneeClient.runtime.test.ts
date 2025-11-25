import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import mock = require('mock-fs');
import { CogneeClient } from '../cogneeClient';

/**
 * Creates a mock VS Code ExtensionContext for testing.
 * Only includes the properties actually used by CogneeClient.
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

suite('CogneeClient Runtime Behaviors', () => {
    const testWorkspacePath = '/tmp/test-workspace-runtime';
    let mockContext: vscode.ExtensionContext;

    setup(() => {
        mockContext = createMockContext();
    });

    suiteTeardown(() => {
        // Ensure mock FS is restored in case of failures
        try { mock.restore(); } catch {}
    });

    test('clearMemory deletes .cognee directory and returns true', async () => {
        // Arrange: mock workspace with .cognee directory and a file
        mock({
            [testWorkspacePath]: {
                '.cognee': {
                    'db.sqlite': 'data'
                },
                '.venv': {
                    'bin': {
                        'python': ''
                    }
                }
            }
        });

        // Stub configuration to avoid surprises
        const mockConfig = {
            get: (_key: string, defaultValue?: unknown) => defaultValue
        } as unknown as vscode.WorkspaceConfiguration;
        const getConfigStub = (vscode.workspace.getConfiguration as unknown as Function)
            = () => mockConfig;

        const client = new CogneeClient(testWorkspacePath, mockContext);

        // Act
        const result = await client.clearMemory();

        // Assert
        assert.strictEqual(result, true);
        assert.strictEqual(fs.existsSync(path.join(testWorkspacePath, '.cognee')), false);

        // Cleanup
        mock.restore();
        // Reset configuration get if stubbed differently elsewhere
        (vscode.workspace.getConfiguration as unknown as any) = getConfigStub;
    });

    test('clearMemory returns true when no .cognee directory exists', async () => {
        // Arrange: empty workspace
        mock({
            [testWorkspacePath]: {}
        });

        const client = new CogneeClient(testWorkspacePath, mockContext);

        // Act
        const result = await client.clearMemory();

        // Assert: still true and nothing throws
        assert.strictEqual(result, true);

        // Cleanup
        mock.restore();
    });

    test('validateConfiguration reports missing .env, then passes when present', async () => {
        // Arrange: workspace without .env
        mock({
            [testWorkspacePath]: {}
        });
        const client = new CogneeClient(testWorkspacePath, mockContext);

        // Act: missing .env
        const invalid = await client.validateConfiguration();
        
        // Assert
        assert.strictEqual(invalid.valid, false);
        assert.ok(invalid.errors.find(e => e.includes('.env')));

        // Arrange: add .env
        mock({
            [testWorkspacePath]: {
                '.env': 'OPENAI_API_KEY=sk-test'
            }
        });

        // Act: now valid
        const valid = await client.validateConfiguration();

        // Assert
        assert.strictEqual(valid.valid, true);
        assert.strictEqual(valid.errors.length, 0);

        // Cleanup
        mock.restore();
    });
});
