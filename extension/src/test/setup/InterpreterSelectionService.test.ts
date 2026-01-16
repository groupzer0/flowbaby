/**
 * Plan 108: InterpreterSelectionService Tests
 * 
 * TDD: These tests define expected behavior BEFORE implementation.
 * Tests verify metadata-first interpreter selection from bridge-env.json.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as path from 'path';
import {
    InterpreterSelectionService,
    InterpreterSelectionResult,
    InterpreterSelectionReason
} from '../../setup/InterpreterSelectionService';

suite('InterpreterSelectionService Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let service: InterpreterSelectionService;
    let mockFs: {
        existsSync: sinon.SinonStub;
        promises: {
            readFile: sinon.SinonStub;
        };
    };
    let mockConfig: {
        get: sinon.SinonStub;
    };
    
    const workspacePath = '/test/workspace';
    const isWindows = process.platform === 'win32';
    
    // Expected paths
    const expectedManagedPython = isWindows
        ? path.join(workspacePath, '.flowbaby', 'venv', 'Scripts', 'python.exe')
        : path.join(workspacePath, '.flowbaby', 'venv', 'bin', 'python');
    
    setup(() => {
        sandbox = sinon.createSandbox();
        
        mockFs = {
            existsSync: sandbox.stub(),
            promises: {
                readFile: sandbox.stub()
            }
        };
        
        mockConfig = {
            get: sandbox.stub()
        };
        
        service = new InterpreterSelectionService(
            workspacePath,
            mockFs as any,
            mockConfig as any
        );
    });
    
    teardown(() => {
        sandbox.restore();
    });
    
    suite('Milestone 1: Metadata-first interpreter selection', () => {
        
        test('uses pythonPath from bridge-env.json when metadata exists (managed)', async () => {
            // Arrange: bridge-env.json exists with managed ownership
            const metadata = {
                pythonPath: '/custom/managed/venv/bin/python',
                ownership: 'managed',
                requirementsHash: 'abc123',
                createdAt: '2026-01-15T00:00:00Z',
                platform: 'linux'
            };
            
            mockFs.existsSync.withArgs(sinon.match(/bridge-env\.json$/)).returns(true);
            mockFs.promises.readFile.resolves(JSON.stringify(metadata));
            
            // Act
            const result = await service.selectInterpreter();
            
            // Assert
            assert.strictEqual(result.pythonPath, '/custom/managed/venv/bin/python');
            assert.strictEqual(result.reason, InterpreterSelectionReason.METADATA);
            assert.strictEqual(result.ownership, 'managed');
            assert.strictEqual(result.metadataExists, true);
        });
        
        test('uses pythonPath from bridge-env.json when metadata exists (external)', async () => {
            // Arrange: bridge-env.json exists with external ownership
            const metadata = {
                pythonPath: '/user/custom/python3',
                ownership: 'external',
                requirementsHash: 'def456',
                createdAt: '2026-01-15T00:00:00Z',
                platform: 'linux'
            };
            
            mockFs.existsSync.withArgs(sinon.match(/bridge-env\.json$/)).returns(true);
            mockFs.promises.readFile.resolves(JSON.stringify(metadata));
            
            // Act
            const result = await service.selectInterpreter();
            
            // Assert
            assert.strictEqual(result.pythonPath, '/user/custom/python3');
            assert.strictEqual(result.reason, InterpreterSelectionReason.METADATA);
            assert.strictEqual(result.ownership, 'external');
            assert.strictEqual(result.metadataExists, true);
        });
        
        test('falls back to .flowbaby/venv when metadata is missing but venv exists', async () => {
            // Arrange: no bridge-env.json, but .flowbaby/venv exists
            mockFs.existsSync.withArgs(sinon.match(/bridge-env\.json$/)).returns(false);
            mockFs.existsSync.withArgs(expectedManagedPython).returns(true);
            mockConfig.get.withArgs('pythonPath', '').returns('');
            
            // Act
            const result = await service.selectInterpreter();
            
            // Assert
            assert.strictEqual(result.pythonPath, expectedManagedPython);
            assert.strictEqual(result.reason, InterpreterSelectionReason.MANAGED_VENV_HEURISTIC);
            assert.strictEqual(result.ownership, undefined);
            assert.strictEqual(result.metadataExists, false);
        });
        
        test('falls back to explicit config when metadata missing and no managed venv', async () => {
            // Arrange: no bridge-env.json, no managed venv, but explicit config set
            mockFs.existsSync.withArgs(sinon.match(/bridge-env\.json$/)).returns(false);
            mockFs.existsSync.withArgs(expectedManagedPython).returns(false);
            mockConfig.get.withArgs('pythonPath', '').returns('/explicit/python3');
            
            // Act
            const result = await service.selectInterpreter();
            
            // Assert
            assert.strictEqual(result.pythonPath, '/explicit/python3');
            assert.strictEqual(result.reason, InterpreterSelectionReason.EXPLICIT_CONFIG);
            assert.strictEqual(result.metadataExists, false);
        });
        
        test('falls back to system python when no metadata, no venv, no config', async () => {
            // Arrange: nothing configured
            mockFs.existsSync.returns(false);
            mockConfig.get.withArgs('pythonPath', '').returns('');
            
            // Act
            const result = await service.selectInterpreter();
            
            // Assert
            const expectedSystemPython = isWindows ? 'python' : 'python3';
            assert.strictEqual(result.pythonPath, expectedSystemPython);
            assert.strictEqual(result.reason, InterpreterSelectionReason.SYSTEM_FALLBACK);
            assert.strictEqual(result.metadataExists, false);
        });
        
        test('explicit config does NOT override metadata when bridge-env.json exists', async () => {
            // Arrange: bridge-env.json exists, AND explicit config is set
            // Plan 108: metadata MUST take precedence
            const metadata = {
                pythonPath: '/managed/from/metadata',
                ownership: 'managed',
                requirementsHash: 'xyz789',
                createdAt: '2026-01-15T00:00:00Z',
                platform: 'linux'
            };
            
            mockFs.existsSync.withArgs(sinon.match(/bridge-env\.json$/)).returns(true);
            mockFs.promises.readFile.resolves(JSON.stringify(metadata));
            mockConfig.get.withArgs('pythonPath', '').returns('/explicit/should/be/ignored');
            
            // Act
            const result = await service.selectInterpreter();
            
            // Assert: metadata wins
            assert.strictEqual(result.pythonPath, '/managed/from/metadata');
            assert.strictEqual(result.reason, InterpreterSelectionReason.METADATA);
        });
        
        test('handles corrupted bridge-env.json gracefully with fallback', async () => {
            // Arrange: bridge-env.json exists but is invalid JSON
            mockFs.existsSync.withArgs(sinon.match(/bridge-env\.json$/)).returns(true);
            mockFs.promises.readFile.resolves('{ invalid json }');
            mockFs.existsSync.withArgs(expectedManagedPython).returns(true);
            mockConfig.get.withArgs('pythonPath', '').returns('');
            
            // Act
            const result = await service.selectInterpreter();
            
            // Assert: falls back to managed venv heuristic
            assert.strictEqual(result.pythonPath, expectedManagedPython);
            assert.strictEqual(result.reason, InterpreterSelectionReason.MANAGED_VENV_HEURISTIC);
            assert.strictEqual(result.metadataExists, false);
        });
        
        test('logs selection reason at Normal observability level', async () => {
            // Arrange
            const logSpy = sandbox.spy(service, 'logSelection' as any);
            const metadata = {
                pythonPath: '/test/python',
                ownership: 'managed',
                requirementsHash: 'hash',
                createdAt: '2026-01-15T00:00:00Z',
                platform: 'linux'
            };
            
            mockFs.existsSync.withArgs(sinon.match(/bridge-env\.json$/)).returns(true);
            mockFs.promises.readFile.resolves(JSON.stringify(metadata));
            
            // Act
            await service.selectInterpreter();
            
            // Assert: logging was called with selection details
            assert.ok(logSpy.called, 'logSelection should be called');
        });
    });
    
    suite('Result structure validation', () => {
        
        test('result includes all required fields', async () => {
            const metadata = {
                pythonPath: '/test/python',
                ownership: 'managed',
                requirementsHash: 'hash',
                createdAt: '2026-01-15T00:00:00Z',
                platform: 'linux'
            };
            
            mockFs.existsSync.withArgs(sinon.match(/bridge-env\.json$/)).returns(true);
            mockFs.promises.readFile.resolves(JSON.stringify(metadata));
            
            const result = await service.selectInterpreter();
            
            // Validate structure
            assert.ok('pythonPath' in result, 'result should have pythonPath');
            assert.ok('reason' in result, 'result should have reason');
            assert.ok('metadataExists' in result, 'result should have metadataExists');
            assert.ok('ownership' in result, 'result should have ownership');
        });
    });
});
