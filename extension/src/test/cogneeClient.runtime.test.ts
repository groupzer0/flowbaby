import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import mock = require('mock-fs');
import { CogneeClient } from '../cogneeClient';

suite('CogneeClient Runtime Behaviors', () => {
    const testWorkspacePath = '/tmp/test-workspace-runtime';

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

        const client = new CogneeClient(testWorkspacePath);

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

        const client = new CogneeClient(testWorkspacePath);

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
        const client = new CogneeClient(testWorkspacePath);

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
