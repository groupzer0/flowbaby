/**
 * Plan 104 Tests: Cloud Auth Session Persistence
 *
 * Tests for preventing unexpected logouts after VS Code restart.
 * Implements TDD for:
 * - Side-effect-free auth state queries (Milestone 1)
 * - Refresh coordinator with singleflight + throttling (Milestone 2)
 * - Bounded activation-time refresh (Milestone 3)
 * - TTL-aware threshold logic (Milestone 4)
 * - Fail-closed logout semantics (Milestone 5)
 *
 * @see Plan 104 - Prevent Unexpected Flowbaby Cloud Logouts After VS Code Restart
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
    FlowbabyCloudAuth,
    MockAuthClient,
    SECRET_KEYS,
    type AuthState,
    type AuthStateInfo,
} from '../flowbaby-cloud';

suite('Plan 104: Cloud Auth Session Persistence', () => {
    let sandbox: sinon.SinonSandbox;
    let mockSecretStorage: vscode.SecretStorage;
    let mockOutputChannel: vscode.OutputChannel;
    let storedSecrets: Map<string, string>;

    setup(() => {
        sandbox = sinon.createSandbox();
        storedSecrets = new Map();

        // Mock SecretStorage
        mockSecretStorage = {
            get: sandbox.stub().callsFake((key: string) => Promise.resolve(storedSecrets.get(key))),
            store: sandbox.stub().callsFake((key: string, value: string) => {
                storedSecrets.set(key, value);
                return Promise.resolve();
            }),
            delete: sandbox.stub().callsFake((key: string) => {
                storedSecrets.delete(key);
                return Promise.resolve();
            }),
            keys: sandbox.stub().callsFake(() => Promise.resolve([...storedSecrets.keys()])),
            onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
        };

        // Mock OutputChannel
        mockOutputChannel = {
            appendLine: sandbox.stub(),
            append: sandbox.stub(),
            clear: sandbox.stub(),
            dispose: sandbox.stub(),
            hide: sandbox.stub(),
            show: sandbox.stub() as unknown as vscode.OutputChannel['show'],
            replace: sandbox.stub(),
            name: 'Flowbaby Cloud Test',
        };
    });

    teardown(() => {
        sandbox.restore();
    });

    // =========================================================================
    // Milestone 1: Side-Effect-Free Auth State Query
    // =========================================================================

    suite('Milestone 1: getAuthState() - Side-Effect-Free Auth State Query', () => {
        test('getAuthState() returns "logged_out" when no refresh token exists', async () => {
            const mockClient = new MockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);

            // No secrets stored
            const state = await auth.getAuthState();

            assert.strictEqual(state.state, 'logged_out');
            assert.strictEqual(state.refreshTokenPresent, false);
            auth.dispose();
        });

        test('getAuthState() returns "valid" when access token is not expired', async () => {
            const mockClient = new MockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);

            // Store valid session (expires in 10 minutes)
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
            storedSecrets.set(SECRET_KEYS.SESSION_TOKEN, 'valid-token');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, expiresAt);
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');

            const state = await auth.getAuthState();

            assert.strictEqual(state.state, 'valid');
            assert.strictEqual(state.refreshTokenPresent, true);
            assert.ok(state.remainingTtlMs !== undefined && state.remainingTtlMs > 0);
            auth.dispose();
        });

        test('getAuthState() returns "expired_refreshable" when token expired but refresh token exists', async () => {
            const mockClient = new MockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);

            // Store expired session with refresh token
            const expiresAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // Expired 5 min ago
            storedSecrets.set(SECRET_KEYS.SESSION_TOKEN, 'expired-token');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, expiresAt);
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');

            const state = await auth.getAuthState();

            assert.strictEqual(state.state, 'expired_refreshable');
            assert.strictEqual(state.refreshTokenPresent, true);
            // Secrets should NOT be cleared - this is the key invariant
            assert.ok(storedSecrets.has(SECRET_KEYS.SESSION_TOKEN), 'Session token should NOT be cleared');
            assert.ok(storedSecrets.has(SECRET_KEYS.REFRESH_TOKEN), 'Refresh token should NOT be cleared');
            auth.dispose();
        });

        test('getAuthState() returns "login_required" when token expired and no refresh token', async () => {
            const mockClient = new MockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);

            // Store expired session WITHOUT refresh token
            const expiresAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            storedSecrets.set(SECRET_KEYS.SESSION_TOKEN, 'expired-token');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, expiresAt);
            // No refresh token

            const state = await auth.getAuthState();

            assert.strictEqual(state.state, 'login_required');
            assert.strictEqual(state.refreshTokenPresent, false);
            auth.dispose();
        });

        test('getAuthState() MUST NOT clear secrets when session is expired', async () => {
            const mockClient = new MockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);

            // Store expired session with refresh token
            const expiresAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
            storedSecrets.set(SECRET_KEYS.SESSION_TOKEN, 'expired-token');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, expiresAt);
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');
            storedSecrets.set(SECRET_KEYS.USER_TIER, 'free');
            storedSecrets.set(SECRET_KEYS.GITHUB_ID, 'test-user');

            // Call getAuthState multiple times (simulating readiness polling)
            await auth.getAuthState();
            await auth.getAuthState();
            await auth.getAuthState();

            // All secrets should still be present
            assert.ok(storedSecrets.has(SECRET_KEYS.SESSION_TOKEN), 'Session token must be preserved');
            assert.ok(storedSecrets.has(SECRET_KEYS.REFRESH_TOKEN), 'Refresh token must be preserved');
            assert.ok(storedSecrets.has(SECRET_KEYS.USER_TIER), 'User tier must be preserved');
            assert.ok(storedSecrets.has(SECRET_KEYS.GITHUB_ID), 'GitHub ID must be preserved');
            auth.dispose();
        });

        test('getAuthState() treats "near expiry" (≤2 min remaining) as expired_refreshable', async () => {
            const mockClient = new MockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);

            // Store session expiring in 90 seconds (within 2-minute "near expiry" window)
            const expiresAt = new Date(Date.now() + 90 * 1000).toISOString();
            storedSecrets.set(SECRET_KEYS.SESSION_TOKEN, 'near-expiry-token');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, expiresAt);
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');

            const state = await auth.getAuthState();

            // Near-expiry should be treated as expired_refreshable to trigger proactive refresh
            assert.strictEqual(state.state, 'expired_refreshable');
            auth.dispose();
        });
    });

    // =========================================================================
    // Milestone 2: Refresh Coordinator (Singleflight + Throttling)
    // =========================================================================

    suite('Milestone 2: RefreshCoordinator - Singleflight + Throttling', () => {
        test('requestRefresh() enforces singleflight - concurrent calls share one request', async () => {
            const mockClient = new MockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);

            // Store valid refresh token
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, new Date(Date.now() - 1000).toISOString());

            // Spy on refreshSession to count actual network calls
            const refreshSpy = sandbox.spy(mockClient, 'refreshSession');

            // Trigger 5 concurrent refresh requests
            const results = await Promise.all([
                auth.requestRefresh(),
                auth.requestRefresh(),
                auth.requestRefresh(),
                auth.requestRefresh(),
                auth.requestRefresh(),
            ]);

            // All should succeed (or fail together)
            const successCount = results.filter(r => r.success).length;
            assert.ok(successCount === 5 || successCount === 0, 'All concurrent calls should share same outcome');

            // Only ONE actual network call should have been made
            assert.strictEqual(refreshSpy.callCount, 1, 'Singleflight: only one network call for concurrent requests');
            auth.dispose();
        });

        test('requestRefresh() applies throttling/backoff after failures', async () => {
            // Create mock client that always fails
            const failingClient: MockAuthClient = new MockAuthClient();
            sandbox.stub(failingClient, 'refreshSession').rejects(new Error('Network error'));

            const auth = new FlowbabyCloudAuth(mockSecretStorage, failingClient, mockOutputChannel);
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');

            // First refresh attempt
            const result1 = await auth.requestRefresh();
            assert.strictEqual(result1.success, false);

            // Immediate second attempt should be throttled
            const result2 = await auth.requestRefresh();
            assert.strictEqual(result2.throttled, true, 'Second immediate attempt should be throttled');

            auth.dispose();
        });

        test('getAuthState() returns "refresh_in_progress" when coordinator has active refresh', async () => {
            const mockClient = new MockAuthClient();
            // Make refresh take a long time
            sandbox.stub(mockClient, 'refreshSession').callsFake(async () => {
                await new Promise(resolve => setTimeout(resolve, 500));
                return {
                    sessionToken: 'new-token',
                    refreshToken: 'new-refresh',
                    expiresAt: new Date(Date.now() + 600000).toISOString(),
                    tier: 'free',
                    githubId: 'test-user',
                };
            });

            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, new Date(Date.now() - 1000).toISOString());

            // Start refresh but don't await
            const refreshPromise = auth.requestRefresh();

            // Check state while refresh is in progress
            await new Promise(resolve => setTimeout(resolve, 50)); // Let refresh start
            const state = await auth.getAuthState();

            assert.strictEqual(state.state, 'refresh_in_progress');

            // Clean up
            await refreshPromise;
            auth.dispose();
        });
    });

    // =========================================================================
    // Milestone 3: Bounded Activation-Time Refresh
    // =========================================================================

    suite('Milestone 3: Bounded Activation-Time Refresh', () => {
        test('activationRefresh() respects 2-second time budget', async () => {
            const mockClient = new MockAuthClient();
            // Make refresh take 5 seconds (longer than budget)
            sandbox.stub(mockClient, 'refreshSession').callsFake(async () => {
                await new Promise(resolve => setTimeout(resolve, 5000));
                return {
                    sessionToken: 'new-token',
                    refreshToken: 'new-refresh',
                    expiresAt: new Date(Date.now() + 600000).toISOString(),
                    tier: 'free',
                    githubId: 'test-user',
                };
            });

            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, new Date(Date.now() - 1000).toISOString());

            const startTime = Date.now();
            const result = await auth.activationRefresh();
            const elapsed = Date.now() - startTime;

            // Should return within ~2 seconds (with some tolerance)
            assert.ok(elapsed < 2500, `activationRefresh() took ${elapsed}ms, should be ≤2000ms`);
            assert.strictEqual(result.timedOut, true, 'Should indicate timeout');
            assert.strictEqual(result.secretsCleared, false, 'Secrets should NOT be cleared on timeout');

            auth.dispose();
        });

        test('activationRefresh() does NOT clear secrets on timeout', async () => {
            const mockClient = new MockAuthClient();
            sandbox.stub(mockClient, 'refreshSession').callsFake(async () => {
                await new Promise(resolve => setTimeout(resolve, 5000));
                throw new Error('Timeout simulated');
            });

            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);
            storedSecrets.set(SECRET_KEYS.SESSION_TOKEN, 'existing-token');
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, new Date(Date.now() - 1000).toISOString());

            await auth.activationRefresh();

            // Secrets must still be present
            assert.ok(storedSecrets.has(SECRET_KEYS.SESSION_TOKEN), 'Session token must be preserved after timeout');
            assert.ok(storedSecrets.has(SECRET_KEYS.REFRESH_TOKEN), 'Refresh token must be preserved after timeout');
            auth.dispose();
        });

        test('activationRefresh() is no-op when user is logged out (no refresh token)', async () => {
            const mockClient = new MockAuthClient();
            const refreshSpy = sandbox.spy(mockClient, 'refreshSession');

            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);
            // No secrets stored = logged out

            const result = await auth.activationRefresh();

            assert.strictEqual(result.attempted, false, 'Should not attempt refresh when logged out');
            assert.strictEqual(refreshSpy.callCount, 0, 'No network call when logged out');
            auth.dispose();
        });

        test('activationRefresh() triggers refresh when expired or near-expiry', async () => {
            const mockClient = new MockAuthClient();
            const refreshSpy = sandbox.spy(mockClient, 'refreshSession');

            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');
            // Expired 30 seconds ago
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, new Date(Date.now() - 30000).toISOString());

            const result = await auth.activationRefresh();

            assert.strictEqual(result.attempted, true, 'Should attempt refresh when expired');
            assert.strictEqual(refreshSpy.callCount, 1, 'Should make network call');
            auth.dispose();
        });
    });

    // =========================================================================
    // Milestone 4: TTL-Aware Threshold Logic
    // =========================================================================

    suite('Milestone 4: TTL-Aware Refresh Threshold', () => {
        test('checkAndRefreshIfNeeded() schedules refresh using actual stored expiry, not hardcoded 24h', async () => {
            const mockClient = new MockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);

            // Store session with 10-minute TTL (valid, not near-expiry)
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
            storedSecrets.set(SECRET_KEYS.SESSION_TOKEN, 'valid-token');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, expiresAt);
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');

            // Trigger schedule setup via checkAndRefreshIfNeeded
            await auth.checkAndRefreshIfNeeded();

            // Verify refresh is scheduled (timer is active)
            const scheduleInfo = auth.getRefreshScheduleInfo();
            assert.ok(scheduleInfo.scheduled, 'Refresh should be scheduled for valid session');
            auth.dispose();
        });

        test('checkAndRefreshIfNeeded() treats ≤2 min remaining as requiring prompt refresh', async () => {
            const mockClient = new MockAuthClient();
            const refreshSpy = sandbox.spy(mockClient, 'refreshSession');

            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');
            // Expires in 90 seconds (within 2-min near-expiry window)
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, new Date(Date.now() + 90 * 1000).toISOString());

            await auth.checkAndRefreshIfNeeded();

            assert.strictEqual(refreshSpy.callCount, 1, 'Should trigger immediate refresh for near-expiry session');
            auth.dispose();
        });
    });

    // =========================================================================
    // Milestone 5: Fail-Closed Logout Semantics
    // =========================================================================

    suite('Milestone 5: Fail-Closed Logout Semantics', () => {
        test('secrets are cleared when refresh fails due to invalid refresh token', async () => {
            const mockClient = new MockAuthClient();
            // Simulate invalid refresh token error
            sandbox.stub(mockClient, 'refreshSession').rejects(
                Object.assign(new Error('Invalid refresh token'), { code: 'INVALID_REFRESH' })
            );

            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);
            storedSecrets.set(SECRET_KEYS.SESSION_TOKEN, 'expired-token');
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'invalid-refresh');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, new Date(Date.now() - 1000).toISOString());

            const result = await auth.requestRefresh();

            assert.strictEqual(result.success, false);
            // Secrets should be cleared for INVALID_REFRESH
            assert.ok(!storedSecrets.has(SECRET_KEYS.SESSION_TOKEN), 'Session token should be cleared');
            assert.ok(!storedSecrets.has(SECRET_KEYS.REFRESH_TOKEN), 'Refresh token should be cleared');
            auth.dispose();
        });

        test('secrets are NOT cleared for transient network errors', async () => {
            const mockClient = new MockAuthClient();
            // Simulate transient network error
            sandbox.stub(mockClient, 'refreshSession').rejects(new Error('Network timeout'));

            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);
            storedSecrets.set(SECRET_KEYS.SESSION_TOKEN, 'expired-token');
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, new Date(Date.now() - 1000).toISOString());

            const result = await auth.requestRefresh();

            assert.strictEqual(result.success, false);
            // Secrets should be PRESERVED for transient errors
            assert.ok(storedSecrets.has(SECRET_KEYS.SESSION_TOKEN), 'Session token should be preserved');
            assert.ok(storedSecrets.has(SECRET_KEYS.REFRESH_TOKEN), 'Refresh token should be preserved');
            auth.dispose();
        });

        test('user-initiated logout() always clears all secrets', async () => {
            const mockClient = new MockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);
            storedSecrets.set(SECRET_KEYS.SESSION_TOKEN, 'valid-token');
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, new Date(Date.now() + 600000).toISOString());
            storedSecrets.set(SECRET_KEYS.USER_TIER, 'free');
            storedSecrets.set(SECRET_KEYS.GITHUB_ID, 'test-user');

            await auth.logout();

            assert.ok(!storedSecrets.has(SECRET_KEYS.SESSION_TOKEN));
            assert.ok(!storedSecrets.has(SECRET_KEYS.REFRESH_TOKEN));
            assert.ok(!storedSecrets.has(SECRET_KEYS.USER_TIER));
            assert.ok(!storedSecrets.has(SECRET_KEYS.GITHUB_ID));
            auth.dispose();
        });

        test('expired timestamp alone does NOT clear secrets (requires refresh attempt)', async () => {
            const mockClient = new MockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);

            // Store expired session with valid refresh token
            storedSecrets.set(SECRET_KEYS.SESSION_TOKEN, 'expired-token');
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, new Date(Date.now() - 60000).toISOString());

            // Just query state (don't trigger refresh)
            const state = await auth.getAuthState();

            assert.strictEqual(state.state, 'expired_refreshable');
            // Secrets must still be present - no clearing until refresh is actually attempted
            assert.ok(storedSecrets.has(SECRET_KEYS.SESSION_TOKEN));
            assert.ok(storedSecrets.has(SECRET_KEYS.REFRESH_TOKEN));
            auth.dispose();
        });
    });

    // =========================================================================
    // Milestone 6: Regression Tests for Side-Effect-Free Integration
    // =========================================================================

    suite('Milestone 6: Regression - Side-Effect-Free Integration', () => {
        test('FlowbabyCloudCredentials uses getAuthState() not isAuthenticated() for auth check', async () => {
            // This test validates that credential vending does NOT call the
            // side-effecting isAuthenticated() method, which would log out
            // when session expires even if refresh token is available.
            //
            // We verify this by checking that the credentials module imports
            // and uses getAuthState() which is side-effect-free.
            const { FlowbabyCloudCredentials, FlowbabyCloudAuth, MockAuthClient } = await import('../flowbaby-cloud');

            const mockClient = new MockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);

            // Spy on getAuthState to confirm it's called
            const getAuthStateSpy = sandbox.spy(auth, 'getAuthState');
            // Spy on isAuthenticated to confirm it's NOT called
            const isAuthenticatedSpy = sandbox.spy(auth, 'isAuthenticated');

            // Store expired session with valid refresh token
            storedSecrets.set(SECRET_KEYS.SESSION_TOKEN, 'expired-token');
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, new Date(Date.now() - 60000).toISOString());

            // Create mock credential client that would fail (we just want to verify auth check)
            const mockCredentialClient = {
                vendCredentials: sandbox.stub().rejects(new Error('Expected - testing auth path only')),
            };

            const credentials = new FlowbabyCloudCredentials(
                auth,
                mockCredentialClient as any,
                mockOutputChannel
            );

            // Try to refresh credentials - will fail at vend, but that's ok
            try {
                await credentials.refreshCredentials();
            } catch {
                // Expected to fail - we just want to verify which auth method was called
            }

            // CRITICAL: getAuthState should be called, NOT isAuthenticated
            assert.ok(getAuthStateSpy.called, 'getAuthState() should be called for auth check');
            assert.strictEqual(isAuthenticatedSpy.callCount, 0, 'isAuthenticated() should NOT be called (side-effecting)');

            // Secrets must still be present (no logout triggered)
            assert.ok(storedSecrets.has(SECRET_KEYS.SESSION_TOKEN), 'Session token must be preserved');
            assert.ok(storedSecrets.has(SECRET_KEYS.REFRESH_TOKEN), 'Refresh token must be preserved');

            credentials.dispose();
            auth.dispose();
        });

        test('FlowbabyCloudAuth.activationRefresh() method exists and is callable', async () => {
            // Regression test: activationRefresh must exist as a public method
            // for extension.ts activation wiring
            const mockClient = new MockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);

            assert.ok(typeof auth.activationRefresh === 'function', 'activationRefresh should be a function');

            // Should be callable without throwing
            const result = await auth.activationRefresh();
            assert.ok(result !== undefined, 'activationRefresh should return a result');
            assert.ok('attempted' in result, 'Result should have attempted field');

            auth.dispose();
        });

        test('CloudReadinessService.evaluateAuth uses getAuthState internally', async () => {
            // This test confirms readiness uses the side-effect-free auth state
            const { CloudReadinessService, FlowbabyCloudAuth, FlowbabyCloudCredentials, MockAuthClient } = await import('../flowbaby-cloud');

            const mockClient = new MockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockClient, mockOutputChannel);

            // Spy on getAuthState
            const getAuthStateSpy = sandbox.spy(auth, 'getAuthState');

            const mockCredentialClient = {
                vendCredentials: sandbox.stub().rejects(new Error('not testing vend')),
            };
            const credentials = new FlowbabyCloudCredentials(
                auth,
                mockCredentialClient as any,
                mockOutputChannel
            );

            const readinessService = new CloudReadinessService(
                auth,
                credentials,
                undefined, // no bridge checker
                mockOutputChannel
            );

            // Store expired session with refresh token
            storedSecrets.set(SECRET_KEYS.SESSION_TOKEN, 'expired-token');
            storedSecrets.set(SECRET_KEYS.REFRESH_TOKEN, 'valid-refresh');
            storedSecrets.set(SECRET_KEYS.SESSION_EXPIRES_AT, new Date(Date.now() - 60000).toISOString());

            // Evaluate readiness
            await readinessService.evaluateReadiness({ skipBridgeCheck: true });

            // getAuthState should have been called (not isAuthenticated)
            assert.ok(getAuthStateSpy.called, 'evaluateReadiness should use getAuthState internally');

            // Secrets must still be present
            assert.ok(storedSecrets.has(SECRET_KEYS.SESSION_TOKEN), 'Session token must be preserved after readiness eval');
            assert.ok(storedSecrets.has(SECRET_KEYS.REFRESH_TOKEN), 'Refresh token must be preserved after readiness eval');

            readinessService.dispose();
            credentials.dispose();
            auth.dispose();
        });
    });
});
