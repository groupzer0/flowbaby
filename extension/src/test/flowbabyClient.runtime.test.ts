import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import mock = require('mock-fs');
import { FlowbabyClient } from '../flowbabyClient';
import * as cloudProvider from '../flowbaby-cloud/provider';

// Sandbox for stubbing Cloud provider
let sandbox: sinon.SinonSandbox;

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

suite('FlowbabyClient Runtime Behaviors', () => {
    const testWorkspacePath = '/tmp/test-workspace-runtime';
    let mockContext: vscode.ExtensionContext;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockContext = createMockContext();
        
        // Plan 083: Default Cloud provider stubs - not initialized (requires explicit login)
        sandbox.stub(cloudProvider, 'isProviderInitialized').returns(false);
        sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({});
    });
    
    teardown(() => {
        sandbox.restore();
    });

    suiteTeardown(() => {
        // Ensure mock FS is restored in case of failures
        try { mock.restore(); } catch {}
    });

    test('clearMemory soft-deletes data directories to .trash and returns true', async () => {
        // Arrange: mock workspace with .flowbaby directory containing data
        // Plan 039 M7: clearMemory now uses soft-delete (moves to .trash)
        mock({
            [testWorkspacePath]: {
                '.flowbaby': {
                    'system': {
                        'db.sqlite': 'data'
                    },
                    'data': {
                        'files.txt': 'content'
                    }
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

        const client = new FlowbabyClient(testWorkspacePath, mockContext);

        // Act
        const result = await client.clearMemory();

        // Assert: returns true and data moved to .trash
        assert.strictEqual(result, true);
        // .flowbaby directory still exists (contains .trash)
        assert.strictEqual(fs.existsSync(path.join(testWorkspacePath, '.flowbaby')), true);
        // .trash directory should exist
        assert.strictEqual(fs.existsSync(path.join(testWorkspacePath, '.flowbaby', '.trash')), true);
        // Original data directories should be gone
        assert.strictEqual(fs.existsSync(path.join(testWorkspacePath, '.flowbaby', 'system')), false);
        assert.strictEqual(fs.existsSync(path.join(testWorkspacePath, '.flowbaby', 'data')), false);

        // Cleanup
        mock.restore();
        // Reset configuration get if stubbed differently elsewhere
        (vscode.workspace.getConfiguration as unknown as any) = getConfigStub;
    });

    test('clearMemory returns true when no .flowbaby directory exists', async () => {
        // Arrange: empty workspace
        mock({
            [testWorkspacePath]: {}
        });

        const client = new FlowbabyClient(testWorkspacePath, mockContext);

        // Act
        const result = await client.clearMemory();

        // Assert: still true and nothing throws
        assert.strictEqual(result, true);

        // Cleanup
        mock.restore();
    });

    test('validateConfiguration reports missing API key', async () => {
        // Arrange: workspace without API key in SecretStorage (default mock returns undefined)
        // Also need to ensure no API key in process.env (it's Priority 2 fallback)
        const originalEnvKey = process.env.LLM_API_KEY;
        delete process.env.LLM_API_KEY;
        
        mock({
            [testWorkspacePath]: {}
        });
        const client = new FlowbabyClient(testWorkspacePath, mockContext);

        // Act: missing API key (SecretStorage returns undefined, process.env cleared)
        const result = await client.validateConfiguration();
        
        // Assert: should fail with Cloud login error (Plan 083)
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.find(e => e.includes('Cloud login')));

        // Cleanup
        mock.restore();
        if (originalEnvKey) {
            process.env.LLM_API_KEY = originalEnvKey;
        }
    });

    test('validateConfiguration passes when Cloud provider is initialized (Plan 083)', async () => {
        // Arrange: workspace with Cloud provider initialized
        mock({
            [testWorkspacePath]: {}
        });
        
        // Plan 083: Cloud-only mode - reset and re-stub Cloud provider as initialized with credentials
        sandbox.restore();
        sandbox = sinon.createSandbox();
        sandbox.stub(cloudProvider, 'isProviderInitialized').returns(true);
        sandbox.stub(cloudProvider, 'getFlowbabyCloudEnvironment').resolves({
            AWS_ACCESS_KEY_ID: 'test-access-key',
            AWS_SECRET_ACCESS_KEY: 'test-secret-key',
            AWS_SESSION_TOKEN: 'test-session-token',
            AWS_REGION: 'us-east-1',
            FLOWBABY_CLOUD_MODE: 'true'
        });
        
        const client = new FlowbabyClient(testWorkspacePath, mockContext);

        // Act: Cloud credentials available via provider
        const result = await client.validateConfiguration();

        // Assert
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.errors.length, 0);

        // Cleanup
        mock.restore();
    });
});
