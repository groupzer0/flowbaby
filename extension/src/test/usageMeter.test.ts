/**
 * Tests for UsageMeter interface and implementation (Plan 090 M3.1)
 * 
 * TDD tests for the metering abstraction that centralizes credit consumption
 * behind a single boundary per DIP.
 */
import * as sinon from 'sinon';
import * as assert from 'assert';

// Import the metering abstraction
import { 
    IUsageMeter, 
    CloudUsageMeter, 
    NoOpUsageMeter,
    MeteringResult,
    getUsageMeter,
    initializeUsageMeter,
    resetUsageMeter
} from '../flowbaby-cloud/usageMeter';

suite('UsageMeter (Plan 090 M3.1)', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('IUsageMeter interface contract', () => {
        test('IUsageMeter defines recordOperation with correct signature', () => {
            // This test validates the interface contract exists
            const meter: IUsageMeter = new NoOpUsageMeter();
            assert.strictEqual(typeof meter.recordOperation, 'function');
        });

        test('recordOperation accepts operationType and idempotencyKey', async () => {
            const meter: IUsageMeter = new NoOpUsageMeter();
            const result = await meter.recordOperation('retrieve', 'test-key-123');
            assert.ok(result !== undefined, 'Should return a result');
        });
    });

    suite('NoOpUsageMeter', () => {
        test('returns success without calling backend', async () => {
            const meter = new NoOpUsageMeter();
            const result = await meter.recordOperation('retrieve', 'test-key');
            
            assert.deepStrictEqual(result, {
                success: true,
                skipped: true,
                reason: 'non-cloud mode'
            });
        });

        test('works for embed operations', async () => {
            const meter = new NoOpUsageMeter();
            const result = await meter.recordOperation('embed', 'test-key');
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.skipped, true);
        });

        test('never throws errors', async () => {
            const meter = new NoOpUsageMeter();
            
            // Should not throw even with unusual inputs
            await assert.doesNotReject(async () => {
                await meter.recordOperation('retrieve', '');
                await meter.recordOperation('embed', 'very-long-key'.repeat(100));
            });
        });
    });

    suite('CloudUsageMeter', () => {
        test('calls cloudClient.consume with correct parameters', async () => {
            const mockCloudClient = {
                consume: sandbox.stub().resolves({
                    success: true,
                    usedCredits: 1,
                    remaining: 99,
                    windowStart: '2026-01-01T00:00:00Z'
                })
            };
            const mockGetSessionToken = sandbox.stub().resolves('test-session-token');
            
            const meter = new CloudUsageMeter(mockCloudClient as any, mockGetSessionToken);
            const result = await meter.recordOperation('retrieve', 'idem-key-123');
            
            assert.ok(mockCloudClient.consume.calledOnce);
            assert.deepStrictEqual(mockCloudClient.consume.firstCall.args, [
                'test-session-token',
                'retrieve',
                'idem-key-123'
            ]);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.usedCredits, 1);
            assert.strictEqual(result.remaining, 99);
        });

        test('handles embed operation type', async () => {
            const mockCloudClient = {
                consume: sandbox.stub().resolves({
                    success: true,
                    usedCredits: 1,
                    remaining: 50,
                    windowStart: '2026-01-01T00:00:00Z'
                })
            };
            const mockGetSessionToken = sandbox.stub().resolves('session-abc');
            
            const meter = new CloudUsageMeter(mockCloudClient as any, mockGetSessionToken);
            await meter.recordOperation('embed', 'embed-key-456');
            
            assert.strictEqual(mockCloudClient.consume.firstCall.args[1], 'embed');
        });

        test('returns failure result when consume throws', async () => {
            const mockCloudClient = {
                consume: sandbox.stub().rejects(new Error('Network failure'))
            };
            const mockGetSessionToken = sandbox.stub().resolves('token');
            
            const meter = new CloudUsageMeter(mockCloudClient as any, mockGetSessionToken);
            const result = await meter.recordOperation('retrieve', 'key');
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error?.includes('Network failure'));
        });

        test('returns failure when no session token available', async () => {
            const mockCloudClient = {
                consume: sandbox.stub().resolves({ success: true })
            };
            const mockGetSessionToken = sandbox.stub().resolves(null);
            
            const meter = new CloudUsageMeter(mockCloudClient as any, mockGetSessionToken);
            const result = await meter.recordOperation('retrieve', 'key');
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error?.includes('session'));
            assert.ok(mockCloudClient.consume.notCalled);
        });

        test('does not propagate errors (fire-and-forget safe)', async () => {
            const mockCloudClient = {
                consume: sandbox.stub().rejects(new Error('Backend down'))
            };
            const mockGetSessionToken = sandbox.stub().resolves('token');
            
            const meter = new CloudUsageMeter(mockCloudClient as any, mockGetSessionToken);
            
            // Should not throw, just return failure result
            await assert.doesNotReject(async () => {
                await meter.recordOperation('retrieve', 'key');
            });
        });
    });

    suite('MeteringResult structure', () => {
        test('success result includes credit info', async () => {
            const mockCloudClient = {
                consume: sandbox.stub().resolves({
                    success: true,
                    usedCredits: 2,
                    remaining: 48,
                    windowStart: '2026-01-01T00:00:00Z'
                })
            };
            const mockGetSessionToken = sandbox.stub().resolves('token');
            
            const meter = new CloudUsageMeter(mockCloudClient as any, mockGetSessionToken);
            const result = await meter.recordOperation('embed', 'key');
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.usedCredits, 2);
            assert.strictEqual(result.remaining, 48);
            assert.strictEqual(result.windowStart, '2026-01-01T00:00:00Z');
        });

        test('failure result includes error message', async () => {
            const mockCloudClient = {
                consume: sandbox.stub().rejects(new Error('QUOTA_EXCEEDED'))
            };
            const mockGetSessionToken = sandbox.stub().resolves('token');
            
            const meter = new CloudUsageMeter(mockCloudClient as any, mockGetSessionToken);
            const result = await meter.recordOperation('retrieve', 'key');
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error);
        });
    });

    suite('getUsageMeter factory', () => {
        teardown(() => {
            // Reset to NoOp after each test
            resetUsageMeter();
        });

        test('returns NoOpUsageMeter by default', async () => {
            resetUsageMeter();
            const meter = getUsageMeter();
            const result = await meter.recordOperation('retrieve', 'test-key');
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.skipped, true);
            assert.strictEqual(result.reason, 'non-cloud mode');
        });

        test('returns CloudUsageMeter after initialization', async () => {
            const mockCloudClient = {
                consume: sandbox.stub().resolves({
                    success: true,
                    usedCredits: 1,
                    remaining: 99,
                    windowStart: '2026-01-01T00:00:00Z'
                })
            };
            const mockGetSessionToken = sandbox.stub().resolves('test-session');
            
            initializeUsageMeter(mockCloudClient as any, mockGetSessionToken);
            const meter = getUsageMeter();
            const result = await meter.recordOperation('retrieve', 'test-key');
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.usedCredits, 1);
            assert.ok(mockCloudClient.consume.calledOnce);
        });

        test('resetUsageMeter reverts to NoOpUsageMeter', async () => {
            const mockCloudClient = {
                consume: sandbox.stub().resolves({ success: true })
            };
            initializeUsageMeter(mockCloudClient as any, sandbox.stub().resolves('token'));
            
            // First call should use Cloud meter
            let meter = getUsageMeter();
            await meter.recordOperation('retrieve', 'key1');
            assert.ok(mockCloudClient.consume.calledOnce);
            
            // Reset and verify NoOp is used
            resetUsageMeter();
            meter = getUsageMeter();
            const result = await meter.recordOperation('retrieve', 'key2');
            
            assert.strictEqual(result.skipped, true);
            assert.ok(mockCloudClient.consume.calledOnce); // Still only 1 call
        });
    });
});
