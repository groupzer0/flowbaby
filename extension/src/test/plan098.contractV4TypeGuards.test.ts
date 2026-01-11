/**
 * Plan 098: Contract v4.0.0 Auth/Refresh Type Guard Tests (TDD)
 *
 * These tests validate the v4 contract type guards work correctly for
 * fail-closed auth behavior on surface-specific responses.
 *
 * @see Plan 098 - Extension Contract v4.0.0 Auth/Refresh Cutover
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import {
    isExtensionAuthResponse,
    isWebAuthResponse,
    isExtensionRefreshResponse,
    isWebRefreshResponse,
    type AuthResponse,
    type RefreshResponse,
    type AuthRequest,
    FlowbabyCloudAuth,
    IAuthClient,
} from '../flowbaby-cloud';

suite('Plan 098: Contract v4.0.0 Type Guard Tests', () => {
    suite('isExtensionAuthResponse', () => {
        test('returns true for valid extension auth response with refreshToken', () => {
            const response: AuthResponse = {
                sessionToken: 'jwt-token',
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                tier: 'free',
                githubId: '12345',
                refreshToken: 'refresh-token-abc',
            };

            assert.strictEqual(isExtensionAuthResponse(response), true);
        });

        test('returns false for web auth response without refreshToken', () => {
            // Construct a response that matches WebAuthResponse shape
            const response: AuthResponse = {
                sessionToken: 'jwt-token',
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                tier: 'free',
                githubId: '12345',
            } as AuthResponse;

            assert.strictEqual(isExtensionAuthResponse(response), false);
        });

        test('returns false when refreshToken is undefined', () => {
            const response = {
                sessionToken: 'jwt-token',
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                tier: 'free',
                githubId: '12345',
                refreshToken: undefined,
            } as AuthResponse;

            assert.strictEqual(isExtensionAuthResponse(response), false);
        });
    });

    suite('isWebAuthResponse', () => {
        test('returns true for web response without refreshToken', () => {
            const response: AuthResponse = {
                sessionToken: 'jwt-token',
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                tier: 'free',
                githubId: '12345',
            } as AuthResponse;

            assert.strictEqual(isWebAuthResponse(response), true);
        });

        test('returns false for extension response with refreshToken', () => {
            const response: AuthResponse = {
                sessionToken: 'jwt-token',
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                tier: 'free',
                githubId: '12345',
                refreshToken: 'refresh-token-abc',
            };

            assert.strictEqual(isWebAuthResponse(response), false);
        });
    });

    suite('isExtensionRefreshResponse', () => {
        test('returns true for valid extension refresh response with refreshToken', () => {
            const response: RefreshResponse = {
                sessionToken: 'new-jwt-token',
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                tier: 'basic',
                githubId: '12345',
                refreshToken: 'new-rotated-refresh-token',
            };

            assert.strictEqual(isExtensionRefreshResponse(response), true);
        });

        test('returns false for web refresh response without refreshToken', () => {
            const response: RefreshResponse = {
                sessionToken: 'new-jwt-token',
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                tier: 'basic',
                githubId: '12345',
            } as RefreshResponse;

            assert.strictEqual(isExtensionRefreshResponse(response), false);
        });
    });

    suite('isWebRefreshResponse', () => {
        test('returns true for web response without refreshToken', () => {
            const response: RefreshResponse = {
                sessionToken: 'new-jwt-token',
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                tier: 'basic',
                githubId: '12345',
            } as RefreshResponse;

            assert.strictEqual(isWebRefreshResponse(response), true);
        });

        test('returns false for extension response with refreshToken', () => {
            const response: RefreshResponse = {
                sessionToken: 'new-jwt-token',
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                tier: 'basic',
                githubId: '12345',
                refreshToken: 'new-rotated-refresh-token',
            };

            assert.strictEqual(isWebRefreshResponse(response), false);
        });
    });

    /**
     * Plan 098 TDD Remediation: Fail-closed Integration Tests
     * 
     * These tests verify that FlowbabyCloudAuth correctly calls logout when
     * the type guards return false (server returns unexpected surface variant).
     */
    suite('Fail-Closed Behavior Integration', () => {
        let sandbox: sinon.SinonSandbox;
        let mockSecretStorage: vscode.SecretStorage;
        let mockOutputChannel: vscode.OutputChannel;
        let storedSecrets: Map<string, string>;

        setup(() => {
            sandbox = sinon.createSandbox();
            storedSecrets = new Map();

            // Pre-populate with a valid session for refresh tests
            storedSecrets.set('flowbaby.cloud.sessionToken', 'existing-token');
            storedSecrets.set('flowbaby.cloud.sessionExpiresAt', new Date(Date.now() + 3600000).toISOString());
            storedSecrets.set('flowbaby.cloud.refreshToken', 'existing-refresh-token');
            storedSecrets.set('flowbaby.cloud.userTier', 'free');
            storedSecrets.set('flowbaby.cloud.githubId', 'test-user');

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

            mockOutputChannel = {
                appendLine: sandbox.stub(),
                append: sandbox.stub(),
                clear: sandbox.stub(),
                dispose: sandbox.stub(),
                hide: sandbox.stub(),
                show: sandbox.stub() as unknown as vscode.OutputChannel['show'],
                replace: sandbox.stub(),
                name: 'Plan 098 Test',
            };
        });

        teardown(() => {
            sandbox.restore();
        });

        /**
         * Mock auth client that returns WEB responses (no refreshToken).
         * This simulates a server misconfiguration or attack scenario.
         */
        class WebSurfaceMockAuthClient implements IAuthClient {
            async exchangeOAuthCode(_code: string): Promise<AuthResponse> {
                // Return a web response (missing refreshToken) - should trigger fail-closed
                return {
                    sessionToken: 'web-session-token',
                    expiresAt: new Date(Date.now() + 3600000).toISOString(),
                    tier: 'free',
                    githubId: 'test-user',
                    // NO refreshToken - this is a WebAuthResponse
                } as AuthResponse;
            }

            async refreshSession(_refreshToken: string): Promise<RefreshResponse> {
                // Return a web refresh response (missing refreshToken) - should trigger fail-closed
                return {
                    sessionToken: 'web-refreshed-token',
                    expiresAt: new Date(Date.now() + 3600000).toISOString(),
                    tier: 'free',
                    githubId: 'test-user',
                    // NO refreshToken - this is a WebRefreshResponse
                } as RefreshResponse;
            }
        }

        test('tryRefreshSession calls logout when server returns web response (fail-closed)', async () => {
            // Arrange: Create auth with web-surface mock client
            const webClient = new WebSurfaceMockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, webClient, mockOutputChannel);

            // Act: Attempt to refresh session
            const result = await auth.tryRefreshSession();

            // Assert: Should fail and logout should be called (secrets cleared)
            assert.strictEqual(result, false, 'tryRefreshSession should return false on fail-closed');
            assert.strictEqual(storedSecrets.has('flowbaby.cloud.sessionToken'), false, 
                'Session token should be cleared by logout');
            assert.strictEqual(storedSecrets.has('flowbaby.cloud.refreshToken'), false,
                'Refresh token should be cleared by logout');

            // Verify fail-closed log message
            const logCalls = (mockOutputChannel.appendLine as sinon.SinonStub).getCalls();
            const failClosedLog = logCalls.find(call => 
                call.args[0]?.includes('FAIL CLOSED') && 
                call.args[0]?.includes('web refresh response')
            );
            assert.ok(failClosedLog, 'Should log FAIL CLOSED message for web refresh response');

            auth.dispose();
        });

        /**
         * Mock auth client that returns EXTENSION responses (with refreshToken).
         * This is the normal happy path.
         */
        class ExtensionSurfaceMockAuthClient implements IAuthClient {
            async exchangeOAuthCode(_code: string): Promise<AuthResponse> {
                return {
                    sessionToken: 'extension-session-token',
                    expiresAt: new Date(Date.now() + 3600000).toISOString(),
                    tier: 'free',
                    githubId: 'test-user',
                    refreshToken: 'extension-refresh-token',
                };
            }

            async refreshSession(_refreshToken: string): Promise<RefreshResponse> {
                return {
                    sessionToken: 'extension-refreshed-token',
                    expiresAt: new Date(Date.now() + 3600000).toISOString(),
                    tier: 'free',
                    githubId: 'test-user',
                    refreshToken: 'rotated-refresh-token',
                };
            }
        }

        test('tryRefreshSession succeeds and stores tokens when server returns extension response', async () => {
            // Arrange: Create auth with extension-surface mock client
            const extensionClient = new ExtensionSurfaceMockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, extensionClient, mockOutputChannel);

            // Act: Attempt to refresh session
            const result = await auth.tryRefreshSession();

            // Assert: Should succeed and update tokens
            assert.strictEqual(result, true, 'tryRefreshSession should return true on success');
            assert.strictEqual(storedSecrets.get('flowbaby.cloud.sessionToken'), 'extension-refreshed-token',
                'Session token should be updated');
            assert.strictEqual(storedSecrets.get('flowbaby.cloud.refreshToken'), 'rotated-refresh-token',
                'Refresh token should be rotated');

            auth.dispose();
        });

        test('fail-closed triggers onDidChangeAuthState with isAuthenticated: false', async () => {
            // Arrange
            const webClient = new WebSurfaceMockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, webClient, mockOutputChannel);
            
            let authStateEvent: { isAuthenticated: boolean } | undefined;
            const disposable = auth.onDidChangeAuthState(event => {
                authStateEvent = event;
            });

            // Act
            await auth.tryRefreshSession();

            // Assert: Should fire logout event
            assert.ok(authStateEvent, 'Should fire onDidChangeAuthState');
            assert.strictEqual(authStateEvent?.isAuthenticated, false, 
                'Auth state should indicate logged out');

            disposable.dispose();
            auth.dispose();
        });

        /**
         * Test that isExtensionAuthResponse correctly identifies web auth responses.
         * This validates the type guard that login() uses for fail-closed behavior.
         * 
         * Note: Testing the full login() flow requires mocking vscode.env.openExternal
         * and the URI handler callback, which is complex. This test validates the
         * type guard logic that login() depends on for fail-closed behavior.
         */
        test('isExtensionAuthResponse returns false for WebSurfaceMockAuthClient response (login fail-closed guard)', async () => {
            // Arrange: Get the response that WebSurfaceMockAuthClient returns
            const webClient = new WebSurfaceMockAuthClient();
            const response = await webClient.exchangeOAuthCode('test-code');

            // Assert: The type guard should return false for web responses
            assert.strictEqual(isExtensionAuthResponse(response), false,
                'isExtensionAuthResponse should return false for web auth response');
            
            // Verify it's missing refreshToken (the discriminant)
            assert.strictEqual((response as { refreshToken?: string }).refreshToken, undefined,
                'Web auth response should not have refreshToken');
        });
    });

    /**
     * Plan 098: AuthRequest Contract Type Tests
     * 
     * These tests verify that the contract types enforce clientType requirement.
     */
    suite('AuthRequest Contract Type', () => {
        test('AuthRequest type requires clientType field (compile-time contract enforcement)', () => {
            // This is a compile-time contract test.
            // If the contract changes to remove clientType, TypeScript will fail this.
            const validRequest: AuthRequest = {
                code: 'exchange-code-123',
                clientType: 'extension',
            };

            // Verify the request shape at runtime
            assert.strictEqual(validRequest.clientType, 'extension',
                'Extension should always use clientType: extension');
            assert.ok(validRequest.code, 'AuthRequest must include code');
        });

        test('clientType: extension is the only valid value for extensions', () => {
            // The extension MUST use 'extension', not 'web'
            const request: AuthRequest = {
                code: 'test-code',
                clientType: 'extension', // Contract v4.0.0 requires this for refresh tokens
            };

            // This test documents the contract requirement
            assert.strictEqual(request.clientType, 'extension',
                'Extensions must use clientType: extension to receive refreshToken');
        });
    });
});
