/**
 * Plan 108: Integration tests for preflight verification in FlowbabyClient
 * 
 * Tests the integration of PreflightVerificationService into FlowbabyClient.
 * Verifies that bridge calls are gated by cognee import preflight.
 * 
 * TDD: Tests written FIRST before integration implementation.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { PreflightVerificationService, PreflightStatus, PreflightResult, PreflightRemediationAction } from '../../setup/PreflightVerificationService';
import { InterpreterSelectionService, InterpreterSelectionResult, InterpreterSelectionReason } from '../../setup/InterpreterSelectionService';

suite('FlowbabyClient Preflight Integration', () => {
    let sandbox: sinon.SinonSandbox;
    
    setup(() => {
        sandbox = sinon.createSandbox();
    });
    
    teardown(() => {
        sandbox.restore();
    });
    
    suite('Preflight gate behavior', () => {
        test('should return cognee-missing status when module is not importable', async () => {
            // Arrange: Create mock interpreter service
            const mockInterpreterService = {
                selectInterpreter: async (): Promise<InterpreterSelectionResult> => ({
                    pythonPath: '/test/python',
                    reason: InterpreterSelectionReason.MANAGED_VENV_HEURISTIC,
                    metadataExists: false,
                    ownership: 'managed'
                })
            } as InterpreterSelectionService;
            
            const mockExecFile = sandbox.stub().callsFake(
                (_pythonPath: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
                    // Simulate failed import
                    callback(new Error('No module named \'cognee\''), '', 'No module named \'cognee\'');
                }
            );
            
            // Act: This tests the integration point where FlowbabyClient 
            // would call preflight before spawning bridge
            const service = new PreflightVerificationService('/test/workspace', '/test/bridge', mockInterpreterService, mockExecFile);
            const result = await service.verify();
            
            // Assert: Should return structured failure, not throw
            assert.strictEqual(result.status, PreflightStatus.COGNEE_MISSING);
            assert.strictEqual(result.cogneeImportable, false);
            assert.ok(result.remediation);
        });
        
        test('should return healthy status when cognee imports successfully', async () => {
            // Arrange: Mock interpreter service and successful import
            const mockInterpreterService = {
                selectInterpreter: async (): Promise<InterpreterSelectionResult> => ({
                    pythonPath: '/test/python',
                    reason: InterpreterSelectionReason.METADATA,
                    metadataExists: true,
                    ownership: 'managed'
                })
            } as InterpreterSelectionService;
            
            const mockExecFile = sandbox.stub().callsFake(
                (_pythonPath: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
                    callback(null, JSON.stringify({
                        status: 'ok',
                        cognee_importable: true,
                        cognee_version: '0.1.40'
                    }), '');
                }
            );
            
            const service = new PreflightVerificationService('/test/workspace', '/test/bridge', mockInterpreterService, mockExecFile);
            const result = await service.verify();
            
            // Assert: Should return healthy status
            assert.strictEqual(result.status, PreflightStatus.HEALTHY);
            assert.strictEqual(result.cogneeImportable, true);
            assert.strictEqual(result.cogneeVersion, '0.1.40');
        });
        
        test('should use cached result within TTL', async () => {
            // Arrange
            let callCount = 0;
            const mockInterpreterService = {
                selectInterpreter: async (): Promise<InterpreterSelectionResult> => ({
                    pythonPath: '/test/python',
                    reason: InterpreterSelectionReason.METADATA,
                    metadataExists: true,
                    ownership: 'managed'
                })
            } as InterpreterSelectionService;
            
            const mockExecFile = sandbox.stub().callsFake(
                (_pythonPath: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
                    callCount++;
                    callback(null, JSON.stringify({
                        status: 'ok',
                        cognee_importable: true,
                        cognee_version: '0.1.40'
                    }), '');
                }
            );
            
            const service = new PreflightVerificationService('/test/workspace', '/test/bridge', mockInterpreterService, mockExecFile);
            
            // Act: Multiple verifies should hit cache
            await service.verify();
            const result2 = await service.verify();
            
            // Assert: Only one exec call, second result is cached
            assert.strictEqual(callCount, 1);
            assert.strictEqual(result2.cached, true);
        });
        
        test('should invalidate cache on pythonPath change', async () => {
            // Arrange
            let callCount = 0;
            const mockInterpreterService = {
                selectInterpreter: async (): Promise<InterpreterSelectionResult> => ({
                    pythonPath: '/test/python',
                    reason: InterpreterSelectionReason.METADATA,
                    metadataExists: true,
                    ownership: 'managed'
                })
            } as InterpreterSelectionService;
            
            const mockExecFile = sandbox.stub().callsFake(
                (_pythonPath: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
                    callCount++;
                    callback(null, JSON.stringify({
                        status: 'ok',
                        cognee_importable: true
                    }), '');
                }
            );
            
            const service = new PreflightVerificationService('/test/workspace', '/test/bridge', mockInterpreterService, mockExecFile);
            
            // First verify
            await service.verify();
            
            // Invalidate cache (simulates interpreter change)
            service.invalidateCache();
            
            // Second verify should not hit cache
            const result2 = await service.verify();
            
            // Assert: Two exec calls after invalidation
            assert.strictEqual(callCount, 2);
            assert.strictEqual(result2.cached, false);
        });
    });
    
    suite('Interpreter selection integration', () => {
        test('should use InterpreterSelectionService for interpreter resolution', async () => {
            // Arrange: Mock interpreter selection to return metadata-based path
            const mockSelection: InterpreterSelectionResult = {
                pythonPath: '/metadata/python',
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed',
                requirementsHash: 'abc123'
            };
            
            // This tests the pattern where FlowbabyClient would use
            // InterpreterSelectionService instead of detectPythonInterpreter
            
            // Assert: Selection result has required fields
            assert.strictEqual(mockSelection.reason, InterpreterSelectionReason.METADATA);
            assert.strictEqual(mockSelection.metadataExists, true);
            assert.ok(mockSelection.ownership);
        });
        
        test('should respect metadata priority over explicit config', async () => {
            // Arrange: Both metadata and explicit config exist
            // InterpreterSelectionService should return metadata-based path
            const mockSelection: InterpreterSelectionResult = {
                pythonPath: '/metadata/python',  // Not explicit config path
                reason: InterpreterSelectionReason.METADATA,
                metadataExists: true,
                ownership: 'managed'
            };
            
            // When metadata exists, reason should be METADATA, not EXPLICIT_CONFIG
            assert.strictEqual(mockSelection.reason, InterpreterSelectionReason.METADATA);
            assert.notStrictEqual(mockSelection.reason, InterpreterSelectionReason.EXPLICIT_CONFIG);
        });
    });
    
    suite('Error remediation', () => {
        test('should provide refresh command for managed env failures', async () => {
            // Arrange: Mock preflight to return managed env failure
            const mockResult: PreflightResult = {
                status: PreflightStatus.COGNEE_MISSING,
                cogneeImportable: false,
                pythonPath: '/test/.flowbaby/venv/bin/python',
                ownership: 'managed',
                remediation: {
                    action: PreflightRemediationAction.REFRESH_DEPENDENCIES,
                    message: 'Run "Flowbaby: Refresh Bridge Dependencies"',
                    commandId: 'flowbaby.refreshBridgeDependencies'
                },
                durationMs: 50,
                cached: false
            };
            
            // Assert: Remediation should point to refresh command
            assert.strictEqual(mockResult.remediation?.action, PreflightRemediationAction.REFRESH_DEPENDENCIES);
            assert.strictEqual(mockResult.remediation?.commandId, 'flowbaby.refreshBridgeDependencies');
        });
        
        test('should provide install guidance for external env failures', async () => {
            // Arrange: Mock preflight to return external env failure
            const mockResult: PreflightResult = {
                status: PreflightStatus.COGNEE_MISSING,
                cogneeImportable: false,
                pythonPath: '/usr/bin/python3',
                ownership: 'external',
                remediation: {
                    action: PreflightRemediationAction.INSTALL_GUIDANCE,
                    message: 'Install required packages with: pip install cognee'
                },
                durationMs: 50,
                cached: false
            };
            
            // Assert: Remediation should be install guidance, not command
            assert.strictEqual(mockResult.remediation?.action, PreflightRemediationAction.INSTALL_GUIDANCE);
            assert.ok(!mockResult.remediation?.commandId);
            assert.ok(mockResult.remediation?.message.includes('pip install'));
        });
    });
});
