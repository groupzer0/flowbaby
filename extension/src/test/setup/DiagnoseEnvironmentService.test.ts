/**
 * Plan 108 Milestone 4: Tests for Diagnose Environment command
 * 
 * TDD: Tests written FIRST before implementation.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { DiagnoseEnvironmentService, DiagnoseReport } from '../../setup/DiagnoseEnvironmentService';
import { PreflightVerificationService, PreflightStatus, PreflightResult } from '../../setup/PreflightVerificationService';
import { InterpreterSelectionService, InterpreterSelectionResult, InterpreterSelectionReason } from '../../setup/InterpreterSelectionService';

suite('DiagnoseEnvironmentService', () => {
    let sandbox: sinon.SinonSandbox;
    
    setup(() => {
        sandbox = sinon.createSandbox();
    });
    
    teardown(() => {
        sandbox.restore();
    });
    
    suite('generateReport', () => {
        test('should generate markdown report with environment details', async () => {
            // Arrange: Mock interpreter selection
            const mockInterpreterService = {
                selectInterpreter: async (): Promise<InterpreterSelectionResult> => ({
                    pythonPath: '/test/.flowbaby/venv/bin/python',
                    reason: InterpreterSelectionReason.METADATA,
                    metadataExists: true,
                    ownership: 'managed',
                    requirementsHash: 'abc123'
                })
            } as InterpreterSelectionService;
            
            // Mock preflight verification
            const mockPreflightService = {
                verify: async (): Promise<PreflightResult> => ({
                    status: PreflightStatus.HEALTHY,
                    cogneeImportable: true,
                    cogneeVersion: '0.1.40',
                    pythonPath: '/test/.flowbaby/venv/bin/python',
                    ownership: 'managed',
                    durationMs: 50,
                    cached: false
                }),
                invalidateCache: () => {}
            } as unknown as PreflightVerificationService;
            
            // Act
            const service = new DiagnoseEnvironmentService(
                '/test/workspace',
                '/test/bridge',
                mockInterpreterService,
                mockPreflightService
            );
            const report = await service.generateReport();
            
            // Assert: Report contains required sections
            assert.ok(report.markdown.includes('# Flowbaby Environment Diagnostics'));
            assert.ok(report.markdown.includes('## Summary'));
            assert.ok(report.markdown.includes('## Interpreter Selection'));
            assert.ok(report.markdown.includes('## Preflight Verification'));
            assert.ok(report.markdown.includes('cognee'));
        });
        
        test('should indicate healthy environment when cognee is importable', async () => {
            // Arrange
            const mockInterpreterService = {
                selectInterpreter: async (): Promise<InterpreterSelectionResult> => ({
                    pythonPath: '/test/python',
                    reason: InterpreterSelectionReason.MANAGED_VENV_HEURISTIC,
                    metadataExists: false,
                    ownership: 'managed'
                })
            } as InterpreterSelectionService;
            
            const mockPreflightService = {
                verify: async (): Promise<PreflightResult> => ({
                    status: PreflightStatus.HEALTHY,
                    cogneeImportable: true,
                    cogneeVersion: '0.1.40',
                    pythonPath: '/test/python',
                    durationMs: 10,
                    cached: true
                }),
                invalidateCache: () => {}
            } as unknown as PreflightVerificationService;
            
            // Act
            const service = new DiagnoseEnvironmentService(
                '/test/workspace',
                '/test/bridge',
                mockInterpreterService,
                mockPreflightService
            );
            const report = await service.generateReport();
            
            // Assert
            assert.strictEqual(report.healthy, true);
            assert.ok(report.markdown.includes('✅'));
        });
        
        test('should indicate unhealthy environment when cognee is missing', async () => {
            // Arrange
            const mockInterpreterService = {
                selectInterpreter: async (): Promise<InterpreterSelectionResult> => ({
                    pythonPath: '/usr/bin/python3',
                    reason: InterpreterSelectionReason.SYSTEM_FALLBACK,
                    metadataExists: false,
                    ownership: 'external'
                })
            } as InterpreterSelectionService;
            
            const mockPreflightService = {
                verify: async (): Promise<PreflightResult> => ({
                    status: PreflightStatus.COGNEE_MISSING,
                    cogneeImportable: false,
                    pythonPath: '/usr/bin/python3',
                    ownership: 'external',
                    error: 'No module named \'cognee\'',
                    durationMs: 100,
                    cached: false
                }),
                invalidateCache: () => {}
            } as unknown as PreflightVerificationService;
            
            // Act
            const service = new DiagnoseEnvironmentService(
                '/test/workspace',
                '/test/bridge',
                mockInterpreterService,
                mockPreflightService
            );
            const report = await service.generateReport();
            
            // Assert
            assert.strictEqual(report.healthy, false);
            assert.ok(report.markdown.includes('❌'));
            assert.ok(report.markdown.includes('cognee'));
        });
        
        test('should include remediation guidance when environment is unhealthy', async () => {
            // Arrange
            const mockInterpreterService = {
                selectInterpreter: async (): Promise<InterpreterSelectionResult> => ({
                    pythonPath: '/test/.flowbaby/venv/bin/python',
                    reason: InterpreterSelectionReason.MANAGED_VENV_HEURISTIC,
                    metadataExists: true,
                    ownership: 'managed'
                })
            } as InterpreterSelectionService;
            
            const mockPreflightService = {
                verify: async (): Promise<PreflightResult> => ({
                    status: PreflightStatus.COGNEE_MISSING,
                    cogneeImportable: false,
                    pythonPath: '/test/.flowbaby/venv/bin/python',
                    ownership: 'managed',
                    error: 'No module named \'cognee\'',
                    remediation: {
                        action: 'refresh-dependencies' as never,
                        message: 'Run "Flowbaby: Refresh Bridge Dependencies"',
                        commandId: 'flowbaby.refreshBridgeDependencies'
                    },
                    durationMs: 50,
                    cached: false
                }),
                invalidateCache: () => {}
            } as unknown as PreflightVerificationService;
            
            // Act
            const service = new DiagnoseEnvironmentService(
                '/test/workspace',
                '/test/bridge',
                mockInterpreterService,
                mockPreflightService
            );
            const report = await service.generateReport();
            
            // Assert
            assert.ok(report.markdown.includes('## Recommended Actions'));
            assert.ok(report.markdown.includes('Refresh Bridge Dependencies'));
        });
    });
});
