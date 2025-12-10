/**
 * Plan 056 - Tool Registration Guard Tests
 * 
 * Tests for evidence-only guard semantics:
 * - Guard state set ONLY on concrete evidence (success or known duplicate error)
 * - vscode.lm.tools inventory used for diagnostics only, never as guard input
 * - All-or-nothing: setToolsRegistered(true) only if EVERY tool succeeds/duplicates
 * - No retry within same activation (Invariant 4.1.3)
 * - Tool and participant guards are independent (Invariant 4.5.4)
 * 
 * Architecture Reference: 056-fix-tool-registration-guards-and-restore-copilot-tools-architecture-findings.md
 */

import * as assert from 'assert';
import {
    areToolsRegistered,
    createHostToolSnapshot,
    isKnownDuplicateParticipantError,
    isKnownDuplicateToolError,
    isParticipantRegistered,
    resetRegistrationGuards,
    setParticipantRegistered,
    setToolsRegistered,
    __resetRegistrationHelperStateForTests
} from '../lifecycle/registrationHelper';

suite('Plan 056: Tool Registration Guard Tests', () => {

    setup(() => {
        // Reset all guard state before each test
        __resetRegistrationHelperStateForTests();
    });

    teardown(() => {
        // Clean up after each test
        __resetRegistrationHelperStateForTests();
    });

    suite('Duplicate-Error Classification', () => {
        
        test('isKnownDuplicateToolError recognizes "already registered" message', () => {
            const error = new Error('Tool with name flowbaby_storeMemory is already registered');
            assert.strictEqual(isKnownDuplicateToolError(error), true);
        });

        test('isKnownDuplicateToolError recognizes "Tool with name" message', () => {
            const error = new Error('Tool with name xyz already exists');
            assert.strictEqual(isKnownDuplicateToolError(error), true);
        });

        test('isKnownDuplicateToolError recognizes "duplicate tool" message', () => {
            const error = new Error('Cannot register duplicate tool');
            assert.strictEqual(isKnownDuplicateToolError(error), true);
        });

        test('isKnownDuplicateToolError recognizes error code', () => {
            const error = { code: 'tool_already_registered', message: 'some error' };
            assert.strictEqual(isKnownDuplicateToolError(error), true);
        });

        test('isKnownDuplicateToolError returns false for unknown errors', () => {
            const error = new Error('Network timeout connecting to tool service');
            assert.strictEqual(isKnownDuplicateToolError(error), false);
        });

        test('isKnownDuplicateToolError returns false for null/undefined', () => {
            assert.strictEqual(isKnownDuplicateToolError(null), false);
            assert.strictEqual(isKnownDuplicateToolError(undefined), false);
        });

        test('isKnownDuplicateParticipantError recognizes "already has implementation" message', () => {
            const error = new Error('Agent already has implementation');
            assert.strictEqual(isKnownDuplicateParticipantError(error), true);
        });

        test('isKnownDuplicateParticipantError recognizes "agent already" message', () => {
            const error = new Error('agent already registered for this scope');
            assert.strictEqual(isKnownDuplicateParticipantError(error), true);
        });

        test('isKnownDuplicateParticipantError recognizes "participant already registered" message', () => {
            const error = new Error('Chat participant already registered');
            assert.strictEqual(isKnownDuplicateParticipantError(error), true);
        });

        test('isKnownDuplicateParticipantError recognizes error code', () => {
            const error = { code: 'participant_already_registered', message: 'some error' };
            assert.strictEqual(isKnownDuplicateParticipantError(error), true);
        });

        test('isKnownDuplicateParticipantError returns false for unknown errors', () => {
            const error = new Error('Failed to create participant handler');
            assert.strictEqual(isKnownDuplicateParticipantError(error), false);
        });
    });

    suite('Guard State Behavior', () => {

        test('areToolsRegistered returns false initially', () => {
            assert.strictEqual(areToolsRegistered(), false);
        });

        test('isParticipantRegistered returns false initially', () => {
            assert.strictEqual(isParticipantRegistered(), false);
        });

        test('setToolsRegistered(true) sets guard to true', () => {
            setToolsRegistered(true);
            assert.strictEqual(areToolsRegistered(), true);
        });

        test('setParticipantRegistered(true) sets guard to true', () => {
            setParticipantRegistered(true);
            assert.strictEqual(isParticipantRegistered(), true);
        });

        test('resetRegistrationGuards resets both guards to false', () => {
            setToolsRegistered(true);
            setParticipantRegistered(true);
            
            resetRegistrationGuards();
            
            assert.strictEqual(areToolsRegistered(), false);
            assert.strictEqual(isParticipantRegistered(), false);
        });
    });

    suite('Tool and Participant Guard Independence (Invariant 4.5.4)', () => {

        test('Setting tool guard does not affect participant guard', () => {
            assert.strictEqual(areToolsRegistered(), false);
            assert.strictEqual(isParticipantRegistered(), false);
            
            setToolsRegistered(true);
            
            assert.strictEqual(areToolsRegistered(), true);
            assert.strictEqual(isParticipantRegistered(), false, 
                'Participant guard should remain false when tool guard is set');
        });

        test('Setting participant guard does not affect tool guard', () => {
            assert.strictEqual(areToolsRegistered(), false);
            assert.strictEqual(isParticipantRegistered(), false);
            
            setParticipantRegistered(true);
            
            assert.strictEqual(isParticipantRegistered(), true);
            assert.strictEqual(areToolsRegistered(), false, 
                'Tool guard should remain false when participant guard is set');
        });

        test('Both guards can be set independently to true', () => {
            setToolsRegistered(true);
            setParticipantRegistered(true);
            
            assert.strictEqual(areToolsRegistered(), true);
            assert.strictEqual(isParticipantRegistered(), true);
        });

        test('resetRegistrationGuards resets both guards atomically', () => {
            setToolsRegistered(true);
            setParticipantRegistered(true);
            
            resetRegistrationGuards();
            
            assert.strictEqual(areToolsRegistered(), false);
            assert.strictEqual(isParticipantRegistered(), false);
        });
    });

    suite('Host Tool Snapshot (Diagnostics Only - Invariant 4.3)', () => {

        test('createHostToolSnapshot returns correct structure for empty tools', () => {
            const snapshot = createHostToolSnapshot([]);
            
            assert.strictEqual(snapshot.totalTools, 0);
            assert.deepStrictEqual(snapshot.flowbabyTools, []);
        });

        test('createHostToolSnapshot returns correct structure for non-Flowbaby tools', () => {
            const tools = [
                { name: 'github_copilot_chat', description: 'Chat tool' },
                { name: 'some_other_tool', description: 'Other tool' }
            ];
            
            const snapshot = createHostToolSnapshot(tools);
            
            assert.strictEqual(snapshot.totalTools, 2);
            assert.deepStrictEqual(snapshot.flowbabyTools, []);
        });

        test('createHostToolSnapshot identifies Flowbaby tools', () => {
            const tools = [
                { name: 'github_copilot_chat', description: 'Chat tool' },
                { name: 'flowbaby_storeMemory', description: 'Store memory' },
                { name: 'flowbaby_retrieveMemory', description: 'Retrieve memory' }
            ];
            
            const snapshot = createHostToolSnapshot(tools);
            
            assert.strictEqual(snapshot.totalTools, 3);
            assert.strictEqual(snapshot.flowbabyTools.length, 2);
            assert.deepStrictEqual(snapshot.flowbabyTools, [
                { id: 'flowbaby_storeMemory', name: 'flowbaby_storeMemory' },
                { id: 'flowbaby_retrieveMemory', name: 'flowbaby_retrieveMemory' }
            ]);
        });

        test('Host snapshot does not affect guard state (diagnostics only)', () => {
            // This test verifies the invariant that snapshots are observational only
            const tools = [
                { name: 'flowbaby_storeMemory', description: 'Store' },
                { name: 'flowbaby_retrieveMemory', description: 'Retrieve' }
            ];
            
            // Create snapshot (would show Flowbaby tools present in host)
            const snapshot = createHostToolSnapshot(tools);
            
            // Guard state should remain unchanged - snapshot is diagnostic only
            assert.strictEqual(areToolsRegistered(), false, 
                'Guard should remain false - snapshot is diagnostic only per Invariant 4.3.1');
            assert.strictEqual(snapshot.flowbabyTools.length, 2, 
                'Snapshot should correctly identify tools for logging');
        });
    });

    suite('Evidence-Only Guard Setting (Invariants 4.2.1-4.2.4)', () => {

        test('Guard should only be set by explicit setToolsRegistered call', () => {
            // Before any evidence, guard is false
            assert.strictEqual(areToolsRegistered(), false);
            
            // Only explicit call should set it
            setToolsRegistered(true);
            assert.strictEqual(areToolsRegistered(), true);
            
            // Can be reset explicitly
            setToolsRegistered(false);
            assert.strictEqual(areToolsRegistered(), false);
        });

        test('Guard state is process-scoped (reset clears it)', () => {
            setToolsRegistered(true);
            assert.strictEqual(areToolsRegistered(), true);
            
            // Simulating what deactivate() does
            resetRegistrationGuards();
            
            assert.strictEqual(areToolsRegistered(), false, 
                'Guard should be false after reset (Invariant 4.2.1)');
        });
    });
});
