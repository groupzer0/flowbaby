/**
 * Plan 108: PreflightVerificationService Tests
 * 
 * TDD: These tests define expected behavior BEFORE implementation.
 * Tests verify fail-fast preflight gating for all bridge entrypoints.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import {
    PreflightVerificationService,
    PreflightResult,
    PreflightStatus,
    PreflightRemediationAction,
    PreflightReasonCode
} from '../../setup/PreflightVerificationService';
import { InterpreterSelectionResult, InterpreterSelectionReason } from '../../setup/InterpreterSelectionService';

suite('PreflightVerificationService Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let service: PreflightVerificationService;
    let mockInterpreterService: {
        selectInterpreter: sinon.SinonStub;
    };
    let mockExecFile: sinon.SinonStub;
    
    const workspacePath = '/test/workspace';
    const bridgePath = '/ext/bridge';
    
    setup(() => {
        sandbox = sinon.createSandbox();
        
        mockInterpreterService = {
            selectInterpreter: sandbox.stub()
        };
        
        mockExecFile = sandbox.stub();
        
        service = new PreflightVerificationService(
            workspacePath,
            bridgePath,
            mockInterpreterService as any,
            mockExecFile
        );
    });
    
    teardown(() => {
        sandbox.restore();
    });
    
    suite('Milestone 2: Fail-fast preflight verification', () => {
        
        test('returns HEALTHY when cognee imports successfully (managed)', async () => {
            // Arrange: interpreter selected, cognee imports successfully
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/managed/venv/bin/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed',
                requirementsHash: 'abc123'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            // Mock successful cognee import check
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'ok',
                    cognee_importable: true,
                    cognee_version: '0.5.15'
                }), '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert
            assert.strictEqual(result.status, PreflightStatus.HEALTHY);
            assert.strictEqual(result.cogneeImportable, true);
            assert.strictEqual(result.cogneeVersion, '0.5.15');
            assert.strictEqual(result.ownership, 'managed');
        });
        
        test('returns HEALTHY when cognee imports successfully (external)', async () => {
            // Arrange
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/user/custom/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'external'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'ok',
                    cognee_importable: true,
                    cognee_version: '0.5.15'
                }), '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert
            assert.strictEqual(result.status, PreflightStatus.HEALTHY);
            assert.strictEqual(result.ownership, 'external');
        });
        
        test('returns COGNEE_MISSING with REFRESH remediation for managed env', async () => {
            // Arrange: managed env, cognee not importable
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/managed/venv/bin/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            // Mock cognee import failure
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'error',
                    cognee_importable: false,
                    error: "No module named 'cognee'"
                }), '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert
            assert.strictEqual(result.status, PreflightStatus.COGNEE_MISSING);
            assert.strictEqual(result.cogneeImportable, false);
            assert.strictEqual(result.remediation?.action, PreflightRemediationAction.REFRESH_DEPENDENCIES);
            assert.ok(result.remediation?.message.includes('Refresh'));
        });
        
        test('returns COGNEE_MISSING with INSTALL_GUIDANCE for external env', async () => {
            // Arrange: external env, cognee not importable
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/user/custom/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'external'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'error',
                    cognee_importable: false,
                    error: "No module named 'cognee'"
                }), '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert
            assert.strictEqual(result.status, PreflightStatus.COGNEE_MISSING);
            assert.strictEqual(result.remediation?.action, PreflightRemediationAction.INSTALL_GUIDANCE);
            assert.ok(result.remediation?.message.includes('install'));
        });
        
        test('returns INTERPRETER_NOT_RUNNABLE when python command fails', async () => {
            // Arrange
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/nonexistent/python',
                reason: InterpreterSelectionReason.SYSTEM_FALLBACK,
                metadataExists: false
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            // Mock python execution failure
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                const error = new Error('ENOENT: spawn /nonexistent/python failed') as NodeJS.ErrnoException;
                error.code = 'ENOENT';
                cb(error, '', '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert
            assert.strictEqual(result.status, PreflightStatus.INTERPRETER_NOT_RUNNABLE);
            assert.strictEqual(result.cogneeImportable, false);
            assert.ok(result.error?.includes('not found') || result.error?.includes('ENOENT'));
        });
        
        test('caches healthy result briefly to avoid duplicate probes', async () => {
            // Arrange
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/managed/venv/bin/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'ok',
                    cognee_importable: true,
                    cognee_version: '0.5.15'
                }), '');
            });
            
            // Act: call verify twice in quick succession
            const result1 = await service.verify();
            const result2 = await service.verify();
            
            // Assert: second call should use cache, execFile only called once
            assert.strictEqual(result1.status, PreflightStatus.HEALTHY);
            assert.strictEqual(result2.status, PreflightStatus.HEALTHY);
            assert.strictEqual(mockExecFile.callCount, 1, 'execFile should only be called once due to caching');
        });
        
        test('invalidates cache when interpreter path changes', async () => {
            // Arrange: first call with one interpreter
            const interpreter1: InterpreterSelectionResult = {
                pythonPath: '/first/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            const interpreter2: InterpreterSelectionResult = {
                pythonPath: '/second/python',  // Different path
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            
            mockInterpreterService.selectInterpreter
                .onFirstCall().resolves(interpreter1)
                .onSecondCall().resolves(interpreter2);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'ok',
                    cognee_importable: true,
                    cognee_version: '0.5.15'
                }), '');
            });
            
            // Act
            await service.verify();
            await service.verify();
            
            // Assert: cache invalidated due to path change, execFile called twice
            assert.strictEqual(mockExecFile.callCount, 2, 'execFile should be called twice after interpreter change');
        });
        
        test('invalidates cache when ownership changes', async () => {
            // Arrange
            const interpreter1: InterpreterSelectionResult = {
                pythonPath: '/same/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            const interpreter2: InterpreterSelectionResult = {
                pythonPath: '/same/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'external'  // Changed ownership
            };
            
            mockInterpreterService.selectInterpreter
                .onFirstCall().resolves(interpreter1)
                .onSecondCall().resolves(interpreter2);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'ok',
                    cognee_importable: true,
                    cognee_version: '0.5.15'
                }), '');
            });
            
            // Act
            await service.verify();
            await service.verify();
            
            // Assert
            assert.strictEqual(mockExecFile.callCount, 2, 'execFile should be called twice after ownership change');
        });
        
        test('invalidateCache forces re-verification', async () => {
            // Arrange
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/managed/venv/bin/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'ok',
                    cognee_importable: true,
                    cognee_version: '0.5.15'
                }), '');
            });
            
            // Act
            await service.verify();
            service.invalidateCache();  // Explicit invalidation
            await service.verify();
            
            // Assert
            assert.strictEqual(mockExecFile.callCount, 2, 'execFile should be called twice after invalidateCache');
        });
        
        test('logs preflight results at Normal observability level', async () => {
            // Arrange
            const logSpy = sandbox.spy(service, 'logPreflight' as any);
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/managed/venv/bin/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'ok',
                    cognee_importable: true,
                    cognee_version: '0.5.15'
                }), '');
            });
            
            // Act
            await service.verify();
            
            // Assert
            assert.ok(logSpy.called, 'logPreflight should be called');
        });
    });
    
    suite('External ownership behavior (Plan 108 critique Finding 4)', () => {
        
        test('external env failure provides install guidance, not mutation', async () => {
            // Arrange
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/user/conda/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'external'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'error',
                    cognee_importable: false,
                    error: "No module named 'cognee'"
                }), '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert: remediation should NOT be REFRESH (which mutates)
            assert.strictEqual(result.remediation?.action, PreflightRemediationAction.INSTALL_GUIDANCE);
            assert.notStrictEqual(result.remediation?.action, PreflightRemediationAction.REFRESH_DEPENDENCIES);
            assert.ok(!result.remediation?.message.includes('Refresh Bridge Dependencies'), 
                'External env should not suggest refresh');
        });
        
        test('external env remediation includes pip install instructions', async () => {
            // Arrange
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/user/conda/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'external'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'error',
                    cognee_importable: false
                }), '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert
            assert.ok(result.remediation?.message.includes('pip install') || 
                      result.remediation?.message.includes('requirements.txt'),
                'Should include install instructions');
        });
    });
    
    suite('Result structure validation', () => {
        
        test('result includes all required fields', async () => {
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/test/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'ok',
                    cognee_importable: true,
                    cognee_version: '0.5.15'
                }), '');
            });
            
            const result = await service.verify();
            
            // Validate structure
            assert.ok('status' in result, 'result should have status');
            assert.ok('cogneeImportable' in result, 'result should have cogneeImportable');
            assert.ok('pythonPath' in result, 'result should have pythonPath');
            assert.ok('ownership' in result, 'result should have ownership');
            assert.ok('durationMs' in result, 'result should have durationMs');
        });
        
        test('isHealthy() helper returns correct boolean', async () => {
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/test/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'ok',
                    cognee_importable: true,
                    cognee_version: '0.5.15'
                }), '');
            });
            
            const result = await service.verify();
            
            assert.strictEqual(service.isHealthy(result), true);
        });
    });

    suite('Plan 115: reasonCode classification', () => {
        
        test('healthy result has no reasonCode', async () => {
            // Arrange: healthy probe response
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/managed/venv/bin/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'ok',
                    cognee_importable: true,
                    cognee_version: '0.5.15'
                }), '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert: healthy results should have undefined reasonCode
            assert.strictEqual(result.status, PreflightStatus.HEALTHY);
            assert.strictEqual(result.reasonCode, undefined);
        });
        
        test('ENOENT error maps to PYTHON_NOT_FOUND reasonCode', async () => {
            // Arrange
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/nonexistent/python',
                reason: InterpreterSelectionReason.SYSTEM_FALLBACK,
                metadataExists: false
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                const error = new Error('ENOENT: spawn /nonexistent/python failed') as NodeJS.ErrnoException;
                error.code = 'ENOENT';
                cb(error, '', '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert
            assert.strictEqual(result.status, PreflightStatus.INTERPRETER_NOT_RUNNABLE);
            assert.strictEqual(result.reasonCode, PreflightReasonCode.PYTHON_NOT_FOUND);
        });
        
        test('cognee import failure maps to COGNEE_DEP_NOT_FOUND reasonCode', async () => {
            // Arrange: No module named 'cognee' is specifically a dependency not found issue
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/managed/venv/bin/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'error',
                    cognee_importable: false,
                    error: "No module named 'cognee'"
                }), '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert: "No module named" maps to DEP_NOT_FOUND, not generic IMPORT_FAILED
            assert.strictEqual(result.status, PreflightStatus.COGNEE_MISSING);
            assert.strictEqual(result.reasonCode, PreflightReasonCode.COGNEE_DEP_NOT_FOUND);
        });
        
        test('generic import error maps to COGNEE_IMPORT_FAILED reasonCode', async () => {
            // Arrange: ImportError that's not a missing module
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/managed/venv/bin/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'error',
                    cognee_importable: false,
                    error: "ImportError: cannot import name 'something' from 'cognee'"
                }), '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert: generic ImportError (not "no module named") maps to IMPORT_FAILED
            assert.strictEqual(result.reasonCode, PreflightReasonCode.COGNEE_IMPORT_FAILED);
        });
        
        test('DLL load failure maps to DLL_LOAD_FAILED reasonCode', async () => {
            // Arrange: simulate DLL load error (Windows-specific issue)
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/managed/venv/bin/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'error',
                    cognee_importable: false,
                    error: "ImportError: DLL load failed while importing _sqlite3"
                }), '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert
            assert.strictEqual(result.reasonCode, PreflightReasonCode.DLL_LOAD_FAILED);
        });
        
        test('database locked error maps to DB_LOCKED_OR_BUSY reasonCode', async () => {
            // Arrange
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/managed/venv/bin/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'error',
                    cognee_importable: false,
                    error: "sqlite3.OperationalError: database is locked"
                }), '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert
            assert.strictEqual(result.reasonCode, PreflightReasonCode.DB_LOCKED_OR_BUSY);
        });
        
        test('permission denied error maps to PERMISSION_DENIED reasonCode', async () => {
            // Arrange
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/managed/venv/bin/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                const error = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
                error.code = 'EACCES';
                cb(error, '', '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert
            assert.strictEqual(result.reasonCode, PreflightReasonCode.PERMISSION_DENIED);
        });
        
        test('timeout error maps to PYTHON_TIMEOUT reasonCode', async () => {
            // Arrange: simulate timeout (ETIMEDOUT or similar kill signal)
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/managed/venv/bin/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                const error = new Error('Process timed out') as any;
                error.killed = true;
                error.signal = 'SIGTERM';
                cb(error, '', '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert
            assert.strictEqual(result.reasonCode, PreflightReasonCode.PYTHON_TIMEOUT);
        });
        
        test('result includes reasonCode field when failure occurs', async () => {
            // Arrange
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/nonexistent/python',
                reason: InterpreterSelectionReason.SYSTEM_FALLBACK,
                metadataExists: false
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                const error = new Error('spawn failed') as NodeJS.ErrnoException;
                error.code = 'ENOENT';
                cb(error, '', '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert: result structure includes reasonCode
            assert.ok('reasonCode' in result, 'result should have reasonCode field');
            assert.ok(Object.values(PreflightReasonCode).includes(result.reasonCode!), 
                'reasonCode should be a valid PreflightReasonCode enum value');
        });
    });

    suite('Plan 115: path redaction in error messages', () => {
        
        test('error messages with paths still allow reasonCode classification', async () => {
            // Arrange: error message contains absolute Unix path, but we can still classify
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/managed/venv/bin/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            // Simulate error with path in message - reasonCode classification still works
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'error',
                    cognee_importable: false,
                    error: "No module named 'cognee' at /home/user/project/file.py"
                }), '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert: reasonCode is correctly classified despite path in message
            assert.strictEqual(result.status, PreflightStatus.COGNEE_MISSING);
            assert.strictEqual(result.reasonCode, PreflightReasonCode.COGNEE_DEP_NOT_FOUND);
            assert.ok(result.error, 'result should have error message');
        });

        test('Windows path patterns in error do not break reasonCode classification', async () => {
            // Arrange: error message contains Windows path
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: 'C:\\Python311\\python.exe',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            // Simulate DLL error with Windows path
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                cb(null, JSON.stringify({
                    status: 'error',
                    cognee_importable: false,
                    error: "DLL load failed at C:\\Windows\\System32\\vcruntime140.dll"
                }), '');
            });
            
            // Act
            const result = await service.verify();
            
            // Assert: DLL_LOAD_FAILED reasonCode is correctly identified
            assert.strictEqual(result.status, PreflightStatus.COGNEE_MISSING);
            assert.strictEqual(result.reasonCode, PreflightReasonCode.DLL_LOAD_FAILED);
        });
        
        test('stderr with paths is bounded and redacted before logging', async () => {
            // Arrange: long stderr with many paths
            const interpreterResult: InterpreterSelectionResult = {
                pythonPath: '/managed/venv/bin/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            mockInterpreterService.selectInterpreter.resolves(interpreterResult);
            
            // Create a very long stderr (over 500 chars)
            const longPath = '/home/user/very/deep/nested/path/to/some/file.py';
            const longStderr = `Error: ${longPath}\n`.repeat(100);
            
            mockExecFile.callsFake((cmd: string, args: string[], opts: any, cb: Function) => {
                const error = new Error('Import failed');
                cb(error, '', longStderr);
            });
            
            // Act
            const result = await service.verify();
            
            // Assert: error was processed without crashing
            assert.strictEqual(result.status, PreflightStatus.COGNEE_MISSING);
            // The error message should be bounded (not contain the full 5KB+ of stderr)
            assert.ok(result.error!.length < 1000, 
                'Error message should be bounded, not include full stderr');
        });
    });
});
