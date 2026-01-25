/**
 * Tests for Daemon Reliability Contract - Plan 116
 * 
 * Tests the reason codes, error structures, and state machine
 * invariants defined in the Plan 116 reliability contract.
 */

import * as assert from 'assert';
import {
    DaemonUnavailableReason,
    DaemonUnavailableError,
    getDaemonUnavailableMessage,
    DaemonState,
    isTerminalState,
    canTransitionTo
} from '../bridge/daemonReliabilityContract';

suite('Daemon Reliability Contract - Plan 116', () => {

    suite('DaemonUnavailableReason', () => {
        test('should have all expected reason codes', () => {
            // Verify all reason codes exist and are strings
            const expectedReasons = [
                'STARTUP_TIMEOUT',
                'STARTUP_HUNG',
                'SPAWN_FAILED',
                'STDIO_UNAVAILABLE',
                'HANDSHAKE_FAILED',
                'PROTOCOL_ERROR',
                'IMMEDIATE_EXIT',
                'LOCK_HELD',
                'LOCK_ACQUISITION_FAILED',
                'VENV_MUTATION_BLOCKED',
                'DAEMON_DISABLED',
                'RECOVERY_BUDGET_EXHAUSTED',
                'PROCESS_NOT_AVAILABLE',
                'REQUEST_TIMEOUT',
                'STARTUP_IN_PROGRESS'
            ];

            for (const reason of expectedReasons) {
                assert.strictEqual(
                    typeof DaemonUnavailableReason[reason as keyof typeof DaemonUnavailableReason],
                    'string',
                    `Reason code ${reason} should exist`
                );
            }
        });

        test('reason codes should be unique', () => {
            const values = Object.values(DaemonUnavailableReason);
            const uniqueValues = new Set(values);
            assert.strictEqual(values.length, uniqueValues.size, 'All reason codes should be unique');
        });
    });

    suite('getDaemonUnavailableMessage', () => {
        test('should return user-friendly message for each reason code', () => {
            for (const reason of Object.values(DaemonUnavailableReason)) {
                const message = getDaemonUnavailableMessage(reason);
                assert.ok(message, `Message for ${reason} should not be empty`);
                assert.ok(message.length > 10, `Message for ${reason} should be descriptive`);
            }
        });

        test('startup failure messages should include diagnose guidance', () => {
            const startupFailureReasons = [
                DaemonUnavailableReason.STARTUP_TIMEOUT,
                DaemonUnavailableReason.STARTUP_HUNG,
                DaemonUnavailableReason.HANDSHAKE_FAILED,
                DaemonUnavailableReason.RECOVERY_BUDGET_EXHAUSTED
            ];

            for (const reason of startupFailureReasons) {
                const message = getDaemonUnavailableMessage(reason);
                assert.ok(
                    message.toLowerCase().includes('diagnose'),
                    `Message for ${reason} should include diagnose guidance`
                );
            }
        });

        test('lock-related message should mention other windows', () => {
            const message = getDaemonUnavailableMessage(DaemonUnavailableReason.LOCK_HELD);
            assert.ok(
                message.toLowerCase().includes('window'),
                'LOCK_HELD message should mention other windows'
            );
        });
    });

    suite('DaemonUnavailableError', () => {
        test('should create error with reason code', () => {
            const error = new DaemonUnavailableError(DaemonUnavailableReason.STARTUP_TIMEOUT);
            assert.strictEqual(error.reason, DaemonUnavailableReason.STARTUP_TIMEOUT);
            assert.strictEqual(error.name, 'DaemonUnavailableError');
            assert.ok(error.message.toLowerCase().includes('timed out'), 'Message should mention timed out');
        });

        test('should include attemptId when provided', () => {
            const attemptId = 'test-attempt-123';
            const error = new DaemonUnavailableError(
                DaemonUnavailableReason.STARTUP_HUNG,
                attemptId
            );
            assert.strictEqual(error.attemptId, attemptId);
        });

        test('should include details when provided', () => {
            const details = { phase: 'handshake', elapsed_ms: 5000 };
            const error = new DaemonUnavailableError(
                DaemonUnavailableReason.HANDSHAKE_FAILED,
                'attempt-456',
                details
            );
            assert.deepStrictEqual(error.details, details);
        });

        test('should be instanceof Error', () => {
            const error = new DaemonUnavailableError(DaemonUnavailableReason.SPAWN_FAILED);
            assert.ok(error instanceof Error);
        });
    });

    suite('DaemonState', () => {
        test('should have all expected states', () => {
            const expectedStates = [
                'stopped',
                'starting',
                'running',
                'stopping',
                'crashed',
                'failed_startup',
                'degraded'
            ];

            for (const state of expectedStates) {
                assert.ok(
                    Object.values(DaemonState).includes(state as DaemonState),
                    `State ${state} should exist`
                );
            }
        });
    });

    suite('isTerminalState', () => {
        test('stopped should be terminal', () => {
            assert.strictEqual(isTerminalState(DaemonState.STOPPED), true);
        });

        test('degraded should be terminal', () => {
            assert.strictEqual(isTerminalState(DaemonState.DEGRADED), true);
        });

        test('running should not be terminal', () => {
            assert.strictEqual(isTerminalState(DaemonState.RUNNING), false);
        });

        test('starting should not be terminal', () => {
            assert.strictEqual(isTerminalState(DaemonState.STARTING), false);
        });
    });

    suite('canTransitionTo', () => {
        test('stopped can transition to starting', () => {
            assert.strictEqual(canTransitionTo(DaemonState.STOPPED, DaemonState.STARTING), true);
        });

        test('starting can transition to running', () => {
            assert.strictEqual(canTransitionTo(DaemonState.STARTING, DaemonState.RUNNING), true);
        });

        test('starting can transition to failed_startup', () => {
            assert.strictEqual(canTransitionTo(DaemonState.STARTING, DaemonState.FAILED_STARTUP), true);
        });

        test('running can transition to crashed', () => {
            assert.strictEqual(canTransitionTo(DaemonState.RUNNING, DaemonState.CRASHED), true);
        });

        test('running can transition to stopping', () => {
            assert.strictEqual(canTransitionTo(DaemonState.RUNNING, DaemonState.STOPPING), true);
        });

        test('crashed can transition to starting (recovery)', () => {
            assert.strictEqual(canTransitionTo(DaemonState.CRASHED, DaemonState.STARTING), true);
        });

        test('failed_startup can transition to degraded', () => {
            assert.strictEqual(canTransitionTo(DaemonState.FAILED_STARTUP, DaemonState.DEGRADED), true);
        });

        test('failed_startup can transition to stopped (retry)', () => {
            assert.strictEqual(canTransitionTo(DaemonState.FAILED_STARTUP, DaemonState.STOPPED), true);
        });

        test('degraded cannot transition to starting directly', () => {
            // Degraded requires manual reset to stopped first
            assert.strictEqual(canTransitionTo(DaemonState.DEGRADED, DaemonState.STARTING), false);
        });

        test('degraded can transition to stopped (manual reset)', () => {
            assert.strictEqual(canTransitionTo(DaemonState.DEGRADED, DaemonState.STOPPED), true);
        });

        test('running cannot transition to starting (invalid)', () => {
            assert.strictEqual(canTransitionTo(DaemonState.RUNNING, DaemonState.STARTING), false);
        });
    });
});
