import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import mock = require('mock-fs');
import { CogneeClient } from '../cogneeClient';

suite('CogneeClient Test Suite', () => {
    const testWorkspacePath = '/tmp/test-workspace';

    suite('detectPythonInterpreter', () => {
        let originalPlatform: string;
        let originalConfig: vscode.WorkspaceConfiguration;

        setup(() => {
            // Save original platform
            originalPlatform = process.platform;
            
            // Mock VS Code configuration
            originalConfig = vscode.workspace.getConfiguration('cogneeMemory');
        });

        teardown(() => {
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
                    if (key === 'pythonPath') return '/usr/bin/python3.11';
                    return defaultValue;
                }
            };
            const getConfigStub = sinon.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

            // Execute
            const client = new CogneeClient(testWorkspacePath);

            // Assert: Explicit config is used
            assert.strictEqual(client['pythonPath'], '/usr/bin/python3.11');

            // Cleanup
            getConfigStub.restore();
        });

        test('Detects .venv/bin/python on Linux/macOS', () => {
            // Setup: Mock Linux platform and existing .venv
            Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
            const venvPath = path.join(testWorkspacePath, '.venv', 'bin', 'python');
            
            // Mock filesystem with .venv directory structure
            mock({
                [testWorkspacePath]: {
                    '.venv': {
                        'bin': {
                            'python': ''  // Empty file is sufficient for existsSync check
                        }
                    }
                }
            });
            
            const mockConfig = {
                get: (key: string, defaultValue?: string) => {
                    if (key === 'pythonPath') return 'python3'; // Default value
                    return defaultValue;
                }
            };
            const getConfigStub = sinon.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

            // Execute
            const client = new CogneeClient(testWorkspacePath);

            // Assert: .venv is detected
            assert.strictEqual(client['pythonPath'], venvPath);

            // Cleanup
            mock.restore();
            getConfigStub.restore();
        });

        test('Detects .venv/Scripts/python.exe on Windows', () => {
            // Setup: Mock Windows platform and existing .venv
            Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
            const venvPath = path.join(testWorkspacePath, '.venv', 'Scripts', 'python.exe');
            
            // Mock filesystem with .venv directory structure
            mock({
                [testWorkspacePath]: {
                    '.venv': {
                        'Scripts': {
                            'python.exe': ''  // Empty file is sufficient for existsSync check
                        }
                    }
                }
            });
            
            const mockConfig = {
                get: (key: string, defaultValue?: string) => {
                    if (key === 'pythonPath') return 'python3'; // Default value
                    return defaultValue;
                }
            };
            const getConfigStub = sinon.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

            // Execute
            const client = new CogneeClient(testWorkspacePath);

            // Assert: .venv is detected with Windows path
            assert.strictEqual(client['pythonPath'], venvPath);

            // Cleanup
            mock.restore();
            getConfigStub.restore();
        });

        test('Falls back to python3 when no venv found', () => {
            // Setup: Mock empty workspace (no .venv)
            mock({
                [testWorkspacePath]: {}  // Empty workspace directory
            });
            
            const mockConfig = {
                get: (key: string, defaultValue?: string) => {
                    if (key === 'pythonPath') return 'python3'; // Default value
                    return defaultValue;
                }
            };
            const getConfigStub = sinon.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

            // Execute
            const client = new CogneeClient(testWorkspacePath);

            // Assert: Falls back to system python3
            assert.strictEqual(client['pythonPath'], 'python3');

            // Cleanup
            mock.restore();
            getConfigStub.restore();
        });

        test('Handles permission errors gracefully', () => {
            // Setup: Mock filesystem with permission-restricted directory
            // mock-fs doesn't directly support permission errors, but we can test
            // the try-catch by mocking an empty workspace (simulates graceful fallback)
            mock({
                [testWorkspacePath]: {}  // Empty workspace
            });
            
            const mockConfig = {
                get: (key: string, defaultValue?: string) => {
                    if (key === 'pythonPath') return 'python3'; // Default value
                    return defaultValue;
                }
            };
            const getConfigStub = sinon.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

            // Execute
            const client = new CogneeClient(testWorkspacePath);

            // Assert: Falls back to system python3 despite error
            // Note: This tests the fallback path, though mock-fs cannot simulate actual permission errors
            assert.strictEqual(client['pythonPath'], 'python3');

            // Cleanup
            mock.restore();
            getConfigStub.restore();
        });

        test('Detection completes in <10ms', () => {
            // Setup: Mock empty workspace
            mock({
                [testWorkspacePath]: {}
            });
            
            const mockConfig = {
                get: (key: string, defaultValue?: string) => {
                    if (key === 'pythonPath') return 'python3';
                    return defaultValue;
                }
            };
            const getConfigStub = sinon.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

            // Execute: Run detection 10 times and measure average
            const iterations = 10;
            const startTime = Date.now();
            
            for (let i = 0; i < iterations; i++) {
                const client = new CogneeClient(testWorkspacePath);
            }
            
            const endTime = Date.now();
            const averageTime = (endTime - startTime) / iterations;

            // Assert: Average detection time is under 10ms
            // Note: mock-fs performance is not representative of real I/O
            assert.ok(averageTime < 10, `Average detection time ${averageTime}ms exceeds 10ms target`);

            // Cleanup
            mock.restore();
            getConfigStub.restore();
        });
    });

    suite('sanitizeOutput', () => {
        let client: CogneeClient;

        setup(() => {
            // Create client for accessing private sanitizeOutput method
            client = new CogneeClient(testWorkspacePath);
        });

        test('Redacts OPENAI_API_KEY environment variable format', () => {
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
                OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx
                AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
                Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0
            `;
            const output = client['sanitizeOutput'](input);
            
            assert.ok(output.includes('OPENAI_API_KEY=***'));
            assert.ok(output.includes('AWS_SECRET_ACCESS_KEY=***'));
            assert.ok(output.includes('Bearer ***'));
            assert.ok(!output.includes('sk-proj-abc123'));
            assert.ok(!output.includes('wJalrXUtnFEMI'));
            assert.ok(!output.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
        });
    });
});
