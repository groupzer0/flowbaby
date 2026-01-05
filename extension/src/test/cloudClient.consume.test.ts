/**
 * FlowbabyCloudClient Consume Tests
 *
 * Unit tests for the consume() method added in Plan 090.
 * Tests credit consumption metering after successful Bedrock operations.
 *
 * @see Plan 090 - Cloud Credit Usage Integration
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import { FlowbabyCloudClient, resetCloudClient } from '../flowbaby-cloud/client';
import { FlowbabyCloudError, ConsumeResponse } from '../flowbaby-cloud/types';

suite('FlowbabyCloudClient Consume Tests (Plan 090)', () => {
    let sandbox: sinon.SinonSandbox;
    let fetchStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        resetCloudClient();

        // Stub global fetch
        fetchStub = sandbox.stub(global, 'fetch');
    });

    teardown(() => {
        sandbox.restore();
        resetCloudClient();
    });

    suite('consume() method', () => {
        test('calls /usage/consume with correct operationType for retrieve', async () => {
            const mockResponse: ConsumeResponse = {
                success: true,
                usedCredits: 1,
                remaining: 99,
                windowStart: '2026-01-01T00:00:00Z',
            };

            fetchStub.resolves({
                ok: true,
                status: 200,
                text: () => Promise.resolve(JSON.stringify(mockResponse)),
            });

            const client = new FlowbabyCloudClient({ apiBaseUrl: 'https://api.test.com' });
            const result = await client.consume('test-session-token', 'retrieve', 'test-idempotency-key');

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.usedCredits, 1);
            assert.strictEqual(result.remaining, 99);

            // Verify fetch was called with correct arguments
            assert.ok(fetchStub.calledOnce, 'fetch should be called once');
            const [url, options] = fetchStub.firstCall.args;
            assert.strictEqual(url, 'https://api.test.com/usage/consume');
            assert.strictEqual(options.method, 'POST');

            const body = JSON.parse(options.body);
            assert.strictEqual(body.operationType, 'retrieve');

            // Verify headers
            assert.strictEqual(options.headers['Authorization'], 'Bearer test-session-token');
            assert.strictEqual(options.headers['X-Idempotency-Key'], 'test-idempotency-key');
        });

        test('calls /usage/consume with correct operationType for embed', async () => {
            const mockResponse: ConsumeResponse = {
                success: true,
                usedCredits: 1,
                remaining: 50,
                windowStart: '2026-01-01T00:00:00Z',
            };

            fetchStub.resolves({
                ok: true,
                status: 200,
                text: () => Promise.resolve(JSON.stringify(mockResponse)),
            });

            const client = new FlowbabyCloudClient({ apiBaseUrl: 'https://api.test.com' });
            const result = await client.consume('test-session-token', 'embed', 'embed-key-123');

            assert.strictEqual(result.success, true);

            const [, options] = fetchStub.firstCall.args;
            const body = JSON.parse(options.body);
            assert.strictEqual(body.operationType, 'embed');
            assert.strictEqual(options.headers['X-Idempotency-Key'], 'embed-key-123');
        });

        test('throws FlowbabyCloudError with INVALID_REQUEST on 400', async () => {
            fetchStub.resolves({
                ok: false,
                status: 400,
                text: () => Promise.resolve(JSON.stringify({
                    error: true,
                    code: 'INVALID_REQUEST',
                    message: 'Missing X-Idempotency-Key header',
                })),
            });

            const client = new FlowbabyCloudClient({ apiBaseUrl: 'https://api.test.com' });

            try {
                await client.consume('test-token', 'retrieve', '');
                assert.fail('Should have thrown an error');
            } catch (error) {
                assert.ok(error instanceof FlowbabyCloudError);
                assert.strictEqual(error.code, 'INVALID_REQUEST');
                assert.ok(error.message.includes('Missing'));
            }
        });

        test('throws FlowbabyCloudError with QUOTA_EXCEEDED when out of credits', async () => {
            fetchStub.resolves({
                ok: false,
                status: 403,
                text: () => Promise.resolve(JSON.stringify({
                    error: true,
                    code: 'QUOTA_EXCEEDED',
                    message: 'Monthly credit limit reached',
                })),
            });

            const client = new FlowbabyCloudClient({ apiBaseUrl: 'https://api.test.com' });

            try {
                await client.consume('test-token', 'embed', 'key-123');
                assert.fail('Should have thrown an error');
            } catch (error) {
                assert.ok(error instanceof FlowbabyCloudError);
                assert.strictEqual(error.code, 'QUOTA_EXCEEDED');
            }
        });

        test('throws FlowbabyCloudError with SESSION_EXPIRED on 401', async () => {
            fetchStub.resolves({
                ok: false,
                status: 401,
                text: () => Promise.resolve(JSON.stringify({
                    error: true,
                    code: 'SESSION_EXPIRED',
                    message: 'Session token has expired',
                })),
            });

            const client = new FlowbabyCloudClient({ apiBaseUrl: 'https://api.test.com' });

            try {
                await client.consume('expired-token', 'retrieve', 'key-123');
                assert.fail('Should have thrown an error');
            } catch (error) {
                assert.ok(error instanceof FlowbabyCloudError);
                assert.strictEqual(error.code, 'SESSION_EXPIRED');
            }
        });

        test('throws NETWORK_ERROR on fetch failure', async () => {
            fetchStub.rejects(new Error('Network unreachable'));

            const client = new FlowbabyCloudClient({
                apiBaseUrl: 'https://api.test.com',
                maxRetries: 0, // Disable retries for this test
            });

            try {
                await client.consume('test-token', 'retrieve', 'key-123');
                assert.fail('Should have thrown an error');
            } catch (error) {
                assert.ok(error instanceof FlowbabyCloudError);
                assert.strictEqual(error.code, 'NETWORK_ERROR');
            }
        });
    });

    suite('isValidErrorCode with INVALID_REQUEST', () => {
        test('recognizes INVALID_REQUEST as valid error code', async () => {
            // Test that the client correctly parses INVALID_REQUEST from API responses
            fetchStub.resolves({
                ok: false,
                status: 400,
                text: () => Promise.resolve(JSON.stringify({
                    error: true,
                    code: 'INVALID_REQUEST',
                    message: 'Invalid operationType',
                })),
            });

            const client = new FlowbabyCloudClient({ apiBaseUrl: 'https://api.test.com' });

            try {
                await client.consume('token', 'retrieve', 'key');
                assert.fail('Should have thrown');
            } catch (error) {
                assert.ok(error instanceof FlowbabyCloudError);
                // If INVALID_REQUEST is recognized, code should be INVALID_REQUEST, not INTERNAL_ERROR
                assert.strictEqual(error.code, 'INVALID_REQUEST', 'Should recognize INVALID_REQUEST as valid error code');
            }
        });
    });
});
