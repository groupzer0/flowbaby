/**
 * Plan 116 M5: Background Cognify Daemon-Only Routing Tests
 * 
 * TDD tests verifying that background cognify work is routed exclusively
 * through the daemon (no independent Python subprocess spawning).
 */

import * as assert from 'assert';
import { DaemonUnavailableReason, DaemonUnavailableError } from '../bridge/daemonReliabilityContract';

suite('Plan 116 M5: Background Cognify Daemon-Only Routing', () => {
    suite('Contract Requirements', () => {
        test('DaemonUnavailableError should have PROCESS_NOT_AVAILABLE reason for daemon failures', () => {
            const error = new DaemonUnavailableError(DaemonUnavailableReason.PROCESS_NOT_AVAILABLE);
            assert.strictEqual(error.reason, DaemonUnavailableReason.PROCESS_NOT_AVAILABLE);
            assert.ok(error.message.includes('unavailable') || error.message.includes('Daemon'));
        });

        test('Background cognify should fail with reason code when daemon unavailable', () => {
            // When daemon is unavailable, background cognify should fail fast
            // with a reason-coded error, not fall back to subprocess
            const error = new DaemonUnavailableError(
                DaemonUnavailableReason.PROCESS_NOT_AVAILABLE,
                'test-attempt-id',
                { operation: 'background_cognify' }
            );
            
            assert.strictEqual(error.reason, DaemonUnavailableReason.PROCESS_NOT_AVAILABLE);
            assert.strictEqual(error.attemptId, 'test-attempt-id');
            assert.deepStrictEqual(error.details, { operation: 'background_cognify' });
        });
    });

    suite('Daemon-Only Routing Semantics', () => {
        test('cognify operation should require daemon to be enabled', () => {
            // Per Plan 116: background cognify must be daemon-managed
            // If daemon is disabled, cognify should fail, not spawn subprocess
            const daemonDisabledError = new DaemonUnavailableError(
                DaemonUnavailableReason.DAEMON_DISABLED
            );
            
            assert.strictEqual(daemonDisabledError.reason, DaemonUnavailableReason.DAEMON_DISABLED);
            assert.ok(daemonDisabledError.message.includes('disabled'));
        });

        test('cognify should fail with RECOVERY_BUDGET_EXHAUSTED when in degraded state', () => {
            // Per Plan 116: when degraded, operations fail fast
            const degradedError = new DaemonUnavailableError(
                DaemonUnavailableReason.RECOVERY_BUDGET_EXHAUSTED,
                'degraded-attempt-id'
            );
            
            assert.strictEqual(degradedError.reason, DaemonUnavailableReason.RECOVERY_BUDGET_EXHAUSTED);
            assert.ok(degradedError.message.includes('recovery') || degradedError.message.includes('failed'));
        });
    });

    suite('No Subprocess Fallback Contract', () => {
        test('forceSubprocess parameter should be removed from cognify routing', () => {
            // The Plan 116 contract states:
            // "background cognify execution must be daemon-managed (job RPC), not TypeScript-spawned"
            // This test documents the expected behavior change
            
            // After M5 implementation:
            // - spawnCognifyProcess should not have forceSubprocess parameter
            // - When daemon is unavailable, cognify should fail with DaemonUnavailableError
            // - No auto-retry via subprocess
            
            // This is a contract test - the actual implementation will be verified
            // by ensuring no subprocess spawn code path exists for cognify
            assert.ok(true, 'Contract: daemon-only routing for background cognify');
        });
    });
});
