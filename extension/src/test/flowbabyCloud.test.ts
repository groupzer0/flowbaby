/**
 * Flowbaby Cloud Module Tests
 *
 * Unit and integration tests for the Flowbaby Cloud module.
 * Uses mock clients to test behavior without real backend.
 *
 * @see Plan 077 M6 - Mock Integration Tests
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
    FlowbabyCloudAuth,
    FlowbabyCloudCredentials,
    FlowbabyCloudProvider,
    MockAuthClient,
    MockCredentialClient,
    FlowbabyCloudError,
    mapCloudErrorToUX,
    isRecoverableCloudError,
    requiresReAuthentication,
    type AuthResponse,
    type ApiError,
    type VendResponse,
} from '../flowbaby-cloud';
import { ICredentialClient } from '../flowbaby-cloud/credentials';

suite('Flowbaby Cloud Module Tests', () => {
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

    suite('MockAuthClient', () => {
        test('returns mock response for exchangeOAuthCode', async () => {
            const mockClient = new MockAuthClient();
            const response = await mockClient.exchangeOAuthCode('test-code');

            assert.ok(response.sessionToken, 'Should return session token');
            assert.ok(response.expiresAt, 'Should return expiry timestamp');
            assert.strictEqual(response.tier, 'free', 'Should return free tier');
            assert.strictEqual(response.githubId, 'mock-github-user', 'Should return mock github ID');
        });

        test('accepts custom mock response', async () => {
            const customResponse: Partial<AuthResponse> = {
                sessionToken: 'custom-token',
                tier: 'basic',
                githubId: 'custom-user',
            };
            const mockClient = new MockAuthClient(customResponse);
            const response = await mockClient.exchangeOAuthCode('test-code');

            assert.strictEqual(response.sessionToken, 'custom-token');
            assert.strictEqual(response.tier, 'basic');
            assert.strictEqual(response.githubId, 'custom-user');
        });
    });

    suite('MockCredentialClient', () => {
        test('returns mock credentials', async () => {
            const mockClient = new MockCredentialClient();
            const response = await mockClient.vendCredentials('test-token');

            assert.ok(response.accessKeyId, 'Should return access key');
            assert.ok(response.secretAccessKey, 'Should return secret key');
            assert.ok(response.sessionToken, 'Should return session token');
            assert.ok(response.region, 'Should return region');
            assert.ok(response.expiration, 'Should return expiration');
        });

        test('tracks call count', async () => {
            const mockClient = new MockCredentialClient();

            assert.strictEqual(mockClient.getCallCount(), 0);
            
            await mockClient.vendCredentials('token');
            assert.strictEqual(mockClient.getCallCount(), 1);
            
            await mockClient.vendCredentials('token');
            assert.strictEqual(mockClient.getCallCount(), 2);

            mockClient.resetCallCount();
            assert.strictEqual(mockClient.getCallCount(), 0);
        });
    });

    suite('FlowbabyCloudAuth', () => {
        let auth: FlowbabyCloudAuth;
        let mockAuthClient: MockAuthClient;

        setup(() => {
            mockAuthClient = new MockAuthClient();
            auth = new FlowbabyCloudAuth(mockSecretStorage, mockAuthClient, mockOutputChannel);
        });

        teardown(() => {
            auth.dispose();
        });

        test('isAuthenticated returns false when no token stored', async () => {
            const result = await auth.isAuthenticated();
            assert.strictEqual(result, false);
        });

        test('isAuthenticated returns false when session expired', async () => {
            // Store expired session
            const expiredDate = new Date(Date.now() - 60000).toISOString();
            storedSecrets.set('flowbaby.cloud.sessionToken', 'test-token');
            storedSecrets.set('flowbaby.cloud.sessionExpiresAt', expiredDate);

            const result = await auth.isAuthenticated();
            assert.strictEqual(result, false);
            
            // Should have cleared the expired token
            assert.strictEqual(storedSecrets.has('flowbaby.cloud.sessionToken'), false);
        });

        test('isAuthenticated returns true with valid session', async () => {
            const futureDate = new Date(Date.now() + 3600000).toISOString();
            storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
            storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

            const result = await auth.isAuthenticated();
            assert.strictEqual(result, true);
        });

        test('logout clears all stored credentials', async () => {
            storedSecrets.set('flowbaby.cloud.sessionToken', 'test-token');
            storedSecrets.set('flowbaby.cloud.sessionExpiresAt', 'test-date');
            storedSecrets.set('flowbaby.cloud.userTier', 'pro');

            await auth.logout();

            assert.strictEqual(storedSecrets.size, 0);
        });

        test('onDidChangeAuthState fires on logout', async () => {
            storedSecrets.set('flowbaby.cloud.sessionToken', 'test-token');
            
            let eventFired = false;
            const disposable = auth.onDidChangeAuthState(event => {
                eventFired = true;
                assert.strictEqual(event.isAuthenticated, false);
            });

            await auth.logout();
            disposable.dispose();

            assert.strictEqual(eventFired, true, 'Auth state change event should fire');
        });
    });

    suite('FlowbabyCloudCredentials', () => {
        let credentials: FlowbabyCloudCredentials;
        let mockAuth: FlowbabyCloudAuth;
        let mockCredentialClient: MockCredentialClient;

        setup(() => {
            mockCredentialClient = new MockCredentialClient();
            
            // Create a mock auth that appears authenticated
            const mockAuthClient = new MockAuthClient();
            mockAuth = new FlowbabyCloudAuth(mockSecretStorage, mockAuthClient, mockOutputChannel);
            
            // Set up valid session
            const futureDate = new Date(Date.now() + 3600000).toISOString();
            storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
            storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

            credentials = new FlowbabyCloudCredentials(mockAuth, mockCredentialClient, mockOutputChannel);
        });

        teardown(() => {
            credentials.dispose();
            mockAuth.dispose();
        });

        test('hasValidCredentials returns false initially', () => {
            assert.strictEqual(credentials.hasValidCredentials(), false);
        });

        test('ensureCredentials fetches new credentials', async () => {
            const creds = await credentials.ensureCredentials();

            assert.ok(creds.accessKeyId);
            assert.ok(creds.secretAccessKey);
            assert.ok(creds.sessionToken);
            assert.ok(creds.region);
            assert.ok(creds.expiresAt instanceof Date);
            assert.ok(creds.fetchedAt instanceof Date);
        });

        test('ensureCredentials returns cached credentials', async () => {
            // First call fetches
            await credentials.ensureCredentials();
            assert.strictEqual(mockCredentialClient.getCallCount(), 1);

            // Second call uses cache
            await credentials.ensureCredentials();
            assert.strictEqual(mockCredentialClient.getCallCount(), 1, 'Should use cached credentials');
        });

        test('clearCredentials clears cache', async () => {
            await credentials.ensureCredentials();
            assert.strictEqual(credentials.hasValidCredentials(), true);

            credentials.clearCredentials();
            assert.strictEqual(credentials.hasValidCredentials(), false);
        });

        test('Plan 083: single-flight guard prevents concurrent vend requests', async () => {
            // Verify the mock client tracks calls correctly
            assert.strictEqual(mockCredentialClient.getCallCount(), 0, 'No calls yet');

            // Issue 3 concurrent credential requests (simulating spawn + daemon + background)
            const [creds1, creds2, creds3] = await Promise.all([
                credentials.ensureCredentials(),
                credentials.ensureCredentials(),
                credentials.ensureCredentials(),
            ]);

            // All three should have returned the same credentials
            assert.strictEqual(creds1.accessKeyId, creds2.accessKeyId);
            assert.strictEqual(creds2.accessKeyId, creds3.accessKeyId);

            // But only ONE actual vend request should have been made
            assert.strictEqual(
                mockCredentialClient.getCallCount(),
                1,
                'Single-flight guard should prevent multiple concurrent vend requests'
            );
        });

        test('Plan 083: FlowbabyCloudError codes are preserved end-to-end', async () => {
            // Create credentials with a mock client that throws FlowbabyCloudError
            const errorClient: ICredentialClient = {
                async vendCredentials(): Promise<VendResponse> {
                    throw new FlowbabyCloudError('RATE_LIMITED', 'Too many requests', 60);
                }
            };

            const errorCredentials = new FlowbabyCloudCredentials(
                mockAuth,
                errorClient,
                mockOutputChannel
            );

            // Ensure the error is preserved with its original code
            try {
                await errorCredentials.ensureCredentials();
                assert.fail('Should have thrown FlowbabyCloudError');
            } catch (error) {
                assert.ok(error instanceof FlowbabyCloudError, 'Error should be FlowbabyCloudError');
                assert.strictEqual((error as FlowbabyCloudError).code, 'RATE_LIMITED', 'Error code should be preserved');
                assert.strictEqual((error as FlowbabyCloudError).retryAfter, 60, 'retryAfter should be preserved');
            } finally {
                errorCredentials.dispose();
            }
        });

        test('onDidRefreshCredentials fires on refresh', async () => {
            let eventFired = false;
            const disposable = credentials.onDidRefreshCredentials(event => {
                eventFired = true;
                assert.ok(event.credentials);
                assert.strictEqual(event.isRefresh, false, 'First fetch is not a refresh');
            });

            await credentials.ensureCredentials();
            disposable.dispose();

            assert.strictEqual(eventFired, true);
        });
    });

    suite('FlowbabyCloudProvider', () => {
        let provider: FlowbabyCloudProvider;
        let credentials: FlowbabyCloudCredentials;
        let mockAuth: FlowbabyCloudAuth;
        let mockCredentialClient: MockCredentialClient;

        setup(() => {
            mockCredentialClient = new MockCredentialClient({
                accessKeyId: 'AKIATEST123',
                secretAccessKey: 'secrettest123',
                sessionToken: 'sessiontokentest',
                region: 'us-east-1',
            });
            
            const mockAuthClient = new MockAuthClient();
            mockAuth = new FlowbabyCloudAuth(mockSecretStorage, mockAuthClient, mockOutputChannel);
            
            const futureDate = new Date(Date.now() + 3600000).toISOString();
            storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
            storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

            credentials = new FlowbabyCloudCredentials(mockAuth, mockCredentialClient, mockOutputChannel);
            provider = new FlowbabyCloudProvider(credentials);
        });

        teardown(() => {
            credentials.dispose();
            mockAuth.dispose();
        });

        test('isReady returns false when no credentials cached', () => {
            assert.strictEqual(provider.isReady(), false);
        });

        test('getEnvironment returns AWS environment variables', async () => {
            const env = await provider.getEnvironment();

            assert.strictEqual(env.AWS_ACCESS_KEY_ID, 'AKIATEST123');
            assert.strictEqual(env.AWS_SECRET_ACCESS_KEY, 'secrettest123');
            assert.strictEqual(env.AWS_SESSION_TOKEN, 'sessiontokentest');
            assert.strictEqual(env.AWS_REGION, 'us-east-1');
            assert.strictEqual(env.FLOWBABY_CLOUD_MODE, 'true');
        });

        test('getCachedEnvironment returns undefined when no cache', () => {
            const env = provider.getCachedEnvironment();
            assert.strictEqual(env, undefined);
        });

        test('getCachedEnvironment returns env when cached', async () => {
            // Prime the cache
            await provider.getEnvironment();

            const env = provider.getCachedEnvironment();
            assert.ok(env);
            assert.strictEqual(env.FLOWBABY_CLOUD_MODE, 'true');
        });
    });

    suite('FlowbabyCloudError', () => {
        test('creates error with code and message', () => {
            const error = new FlowbabyCloudError('NOT_AUTHENTICATED', 'Please log in');
            
            assert.strictEqual(error.code, 'NOT_AUTHENTICATED');
            assert.strictEqual(error.message, 'Please log in');
            assert.strictEqual(error.name, 'FlowbabyCloudError');
        });

        test('includes retryAfter when provided', () => {
            const error = new FlowbabyCloudError('RATE_LIMITED', 'Too many requests', 60);
            
            assert.strictEqual(error.retryAfter, 60);
        });

        test('fromApiError creates error from API response', () => {
            const apiError: ApiError = {
                error: true,
                code: 'QUOTA_EXCEEDED',
                message: 'Monthly quota exceeded',
            };
            
            const error = FlowbabyCloudError.fromApiError(apiError);
            
            assert.strictEqual(error.code, 'QUOTA_EXCEEDED');
            assert.strictEqual(error.message, 'Monthly quota exceeded');
        });
    });

    suite('Error Mapping (Plan 083 M3)', () => {
        test('mapCloudErrorToUX handles NOT_AUTHENTICATED', () => {
            const error = new FlowbabyCloudError('NOT_AUTHENTICATED', 'Please log in');
            const ux = mapCloudErrorToUX(error);
            
            assert.strictEqual(ux.severity, 'warning');
            assert.ok(ux.message.includes('login required'));
            assert.strictEqual(ux.actions.length, 1);
            assert.strictEqual(ux.actions[0].label, 'Login to Cloud');
            assert.strictEqual(ux.logMetadata.category, 'authentication');
        });

        test('mapCloudErrorToUX handles RATE_LIMITED with retryAfter', () => {
            const error = new FlowbabyCloudError('RATE_LIMITED', 'Too many requests', 30);
            const ux = mapCloudErrorToUX(error);
            
            assert.strictEqual(ux.severity, 'warning');
            assert.ok(ux.message.includes('30 seconds'));
            assert.strictEqual(ux.logMetadata.retryAfter, 30);
        });

        test('mapCloudErrorToUX handles QUOTA_EXCEEDED', () => {
            const error = new FlowbabyCloudError('QUOTA_EXCEEDED', 'Quota exceeded');
            const ux = mapCloudErrorToUX(error);
            
            assert.strictEqual(ux.severity, 'error');
            assert.ok(ux.message.includes('quota'));
            assert.strictEqual(ux.actions.length, 1);
            assert.strictEqual(ux.actions[0].label, 'Check Status');
        });

        test('mapCloudErrorToUX handles generic Error', () => {
            const error = new Error('Something went wrong');
            const ux = mapCloudErrorToUX(error);
            
            assert.strictEqual(ux.severity, 'error');
            assert.ok(ux.message.includes('Something went wrong'));
            assert.strictEqual(ux.actions.length, 0);
        });

        test('mapCloudErrorToUX includes context suffix', () => {
            const error = new FlowbabyCloudError('NETWORK_ERROR', 'Failed to connect');
            const ux = mapCloudErrorToUX(error, 'during retrieval');
            
            assert.ok(ux.message.includes('during retrieval'));
        });

        test('isRecoverableCloudError returns true for RATE_LIMITED', () => {
            const error = new FlowbabyCloudError('RATE_LIMITED', 'Too many requests');
            assert.strictEqual(isRecoverableCloudError(error), true);
        });

        test('isRecoverableCloudError returns false for QUOTA_EXCEEDED', () => {
            const error = new FlowbabyCloudError('QUOTA_EXCEEDED', 'Quota exceeded');
            assert.strictEqual(isRecoverableCloudError(error), false);
        });

        test('requiresReAuthentication returns true for SESSION_EXPIRED', () => {
            const error = new FlowbabyCloudError('SESSION_EXPIRED', 'Session expired');
            assert.strictEqual(requiresReAuthentication(error), true);
        });

        test('requiresReAuthentication returns false for RATE_LIMITED', () => {
            const error = new FlowbabyCloudError('RATE_LIMITED', 'Too many requests');
            assert.strictEqual(requiresReAuthentication(error), false);
        });
    });

    suite('Endpoint Resolution (Plan 084)', () => {
        let originalEnv: NodeJS.ProcessEnv;
        let configGetStub: sinon.SinonStub;

        setup(() => {
            // Save original environment
            originalEnv = { ...process.env };
            // Clear any existing env override
            delete process.env.FLOWBABY_CLOUD_API_URL;
        });

        teardown(() => {
            // Restore original environment
            process.env = originalEnv;
            if (configGetStub) {
                configGetStub.restore();
            }
        });

        test('STAGING_API_BASE_URL is correct staging domain', async () => {
            // Import the constant directly
            const types = await import('../flowbaby-cloud/types');
            
            assert.strictEqual(
                types.STAGING_API_BASE_URL, 
                'https://api-staging.flowbaby.ai',
                'Staging URL should be api-staging.flowbaby.ai (Plan 084 fix)'
            );
            // Ensure it's not the old incorrect URL
            assert.notStrictEqual(
                types.STAGING_API_BASE_URL,
                'https://api.flowbaby.dev',
                'Should NOT be the old incorrect api.flowbaby.dev URL'
            );
        });

        test('PRODUCTION_API_BASE_URL is correct production domain', async () => {
            const types = await import('../flowbaby-cloud/types');
            
            assert.strictEqual(
                types.PRODUCTION_API_BASE_URL,
                'https://api.flowbaby.ai',
                'Production URL should be api.flowbaby.ai'
            );
        });

        test('EXECUTE_API_FALLBACK_URL is the raw API Gateway URL', async () => {
            const types = await import('../flowbaby-cloud/types');
            
            assert.ok(
                types.EXECUTE_API_FALLBACK_URL.includes('execute-api.us-east-1.amazonaws.com'),
                'Fallback URL should be the execute-api gateway URL'
            );
        });

        test('DEFAULT_CONFIG.apiBaseUrl defaults to staging (not api.flowbaby.dev)', async () => {
            const types = await import('../flowbaby-cloud/types');
            
            assert.strictEqual(
                types.DEFAULT_CONFIG.apiBaseUrl,
                types.STAGING_API_BASE_URL,
                'Default config should use staging URL'
            );
            assert.notStrictEqual(
                types.DEFAULT_CONFIG.apiBaseUrl,
                'https://api.flowbaby.dev',
                'Default config should NOT use the old incorrect URL'
            );
        });

        test('getApiBaseUrl returns default when no setting or env var', async () => {
            const types = await import('../flowbaby-cloud/types');
            
            // Clear environment to ensure no override
            delete process.env.FLOWBABY_CLOUD_API_URL;
            
            // Stub VS Code config to return undefined
            configGetStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns({
                get: sandbox.stub().returns(undefined),
                has: sandbox.stub().returns(false),
                inspect: sandbox.stub().returns(undefined),
                update: sandbox.stub().resolves(),
            } as any);
            
            const result = types.getApiBaseUrl();
            
            assert.strictEqual(
                result,
                types.STAGING_API_BASE_URL,
                'Should return staging URL as default'
            );
        });

        test('getApiBaseUrl returns env var when set (precedence level 2)', async () => {
            const types = await import('../flowbaby-cloud/types');
            const customUrl = 'https://custom-api.example.com';
            
            // Set environment variable
            process.env.FLOWBABY_CLOUD_API_URL = customUrl;
            
            // Stub VS Code config to return undefined (no setting override)
            configGetStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns({
                get: sandbox.stub().returns(undefined),
                has: sandbox.stub().returns(false),
                inspect: sandbox.stub().returns(undefined),
                update: sandbox.stub().resolves(),
            } as any);
            
            const result = types.getApiBaseUrl();
            
            assert.strictEqual(
                result,
                customUrl,
                'Should return env var when setting is not configured'
            );
        });

        test('getApiBaseUrl returns VS Code setting when set (precedence level 1 - highest)', async () => {
            const types = await import('../flowbaby-cloud/types');
            const settingUrl = 'https://setting-api.example.com';
            const envUrl = 'https://env-api.example.com';
            
            // Set both env var and VS Code setting
            process.env.FLOWBABY_CLOUD_API_URL = envUrl;
            
            // Stub VS Code config to return the setting value
            configGetStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns({
                get: sandbox.stub().callsFake((key: string) => {
                    if (key === 'apiEndpoint') {
                        return settingUrl;
                    }
                    return undefined;
                }),
                has: sandbox.stub().returns(true),
                inspect: sandbox.stub().returns(undefined),
                update: sandbox.stub().resolves(),
            } as any);
            
            const result = types.getApiBaseUrl();
            
            assert.strictEqual(
                result,
                settingUrl,
                'VS Code setting should take precedence over env var'
            );
        });

        test('getApiBaseUrl ignores empty/whitespace-only setting', async () => {
            const types = await import('../flowbaby-cloud/types');
            const envUrl = 'https://env-api.example.com';
            
            process.env.FLOWBABY_CLOUD_API_URL = envUrl;
            
            // Stub VS Code config to return whitespace-only value
            configGetStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns({
                get: sandbox.stub().callsFake((key: string) => {
                    if (key === 'apiEndpoint') {
                        return '   ';  // Whitespace only
                    }
                    return undefined;
                }),
                has: sandbox.stub().returns(true),
                inspect: sandbox.stub().returns(undefined),
                update: sandbox.stub().resolves(),
            } as any);
            
            const result = types.getApiBaseUrl();
            
            assert.strictEqual(
                result,
                envUrl,
                'Whitespace-only setting should fall through to env var'
            );
        });

        test('getApiBaseUrl trims whitespace from valid setting', async () => {
            const types = await import('../flowbaby-cloud/types');
            const settingUrl = 'https://trimmed-api.example.com';
            
            // Stub VS Code config with whitespace-padded URL
            configGetStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns({
                get: sandbox.stub().callsFake((key: string) => {
                    if (key === 'apiEndpoint') {
                        return `  ${settingUrl}  `;  // Whitespace padded
                    }
                    return undefined;
                }),
                has: sandbox.stub().returns(true),
                inspect: sandbox.stub().returns(undefined),
                update: sandbox.stub().resolves(),
            } as any);
            
            const result = types.getApiBaseUrl();
            
            assert.strictEqual(
                result,
                settingUrl,
                'Should trim whitespace from valid setting value'
            );
        });

        test('getApiBaseUrl uses execute-api fallback when env var set to it', async () => {
            const types = await import('../flowbaby-cloud/types');
            
            // Set env var to the fallback URL (common during CDK transition)
            process.env.FLOWBABY_CLOUD_API_URL = types.EXECUTE_API_FALLBACK_URL;
            
            // No VS Code setting
            configGetStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns({
                get: sandbox.stub().returns(undefined),
                has: sandbox.stub().returns(false),
                inspect: sandbox.stub().returns(undefined),
                update: sandbox.stub().resolves(),
            } as any);
            
            const result = types.getApiBaseUrl();
            
            assert.strictEqual(
                result,
                types.EXECUTE_API_FALLBACK_URL,
                'Should allow execute-api fallback via env var'
            );
        });

        test('endpoint constants are all valid HTTPS URLs', async () => {
            const types = await import('../flowbaby-cloud/types');
            
            // Verify all endpoint constants are valid URLs
            const urlPattern = /^https:\/\/[a-z0-9][a-z0-9.-]*[a-z0-9]\.[a-z]{2,}(\/.*)?$/i;
            
            assert.ok(
                urlPattern.test(types.STAGING_API_BASE_URL),
                `STAGING_API_BASE_URL should be valid HTTPS URL: ${types.STAGING_API_BASE_URL}`
            );
            assert.ok(
                urlPattern.test(types.PRODUCTION_API_BASE_URL),
                `PRODUCTION_API_BASE_URL should be valid HTTPS URL: ${types.PRODUCTION_API_BASE_URL}`
            );
            assert.ok(
                urlPattern.test(types.EXECUTE_API_FALLBACK_URL),
                `EXECUTE_API_FALLBACK_URL should be valid HTTPS URL: ${types.EXECUTE_API_FALLBACK_URL}`
            );
        });

        test('endpoint constants have no trailing slashes', async () => {
            const types = await import('../flowbaby-cloud/types');
            
            assert.ok(
                !types.STAGING_API_BASE_URL.endsWith('/'),
                'STAGING_API_BASE_URL should not end with /'
            );
            assert.ok(
                !types.PRODUCTION_API_BASE_URL.endsWith('/'),
                'PRODUCTION_API_BASE_URL should not end with /'
            );
            assert.ok(
                !types.EXECUTE_API_FALLBACK_URL.endsWith('/'),
                'EXECUTE_API_FALLBACK_URL should not end with /'
            );
        });
    });
});
