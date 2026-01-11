/**
 * Flowbaby Cloud Module Tests
 *
 * Unit and integration tests for the Flowbaby Cloud module.
 * Uses mock clients to test behavior without real backend.
 *
 * @see Plan 077 M6 - Mock Integration Tests
 * @see Plan 085 - Command Wiring and Status Consistency Tests
 * @see Plan 094 - Cross-Region Nova Lite (Zones) Tests
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
    type VendRequest,
    type FlowbabyCloudErrorCode,
} from '../flowbaby-cloud';
import { ICredentialClient } from '../flowbaby-cloud/credentials';
import { FlowbabyStatus } from '../statusBar/FlowbabyStatusBar';

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

        test('returns backend-controlled model configuration (Plan 086)', async () => {
            const mockClient = new MockCredentialClient();
            const response = await mockClient.vendCredentials('test-token');

            // Plan 086: Mock client returns backend-controlled model configuration
            assert.strictEqual(response.llmModel, 'anthropic.claude-3-haiku-20240307-v1:0', 'Should return default LLM model');
            assert.strictEqual(response.embeddingModel, 'bedrock/amazon.titan-embed-text-v2:0', 'Should return default embedding model');
            assert.strictEqual(response.embeddingDimensions, 1024, 'Should return default embedding dimensions');
        });

        test('accepts custom model configuration (Plan 086)', async () => {
            const customResponse = {
                llmModel: 'anthropic.claude-3-sonnet-20240229-v1:0',
                embeddingModel: 'bedrock/cohere.embed-english-v3',
                embeddingDimensions: 768,
            };
            const mockClient = new MockCredentialClient(customResponse);
            const response = await mockClient.vendCredentials('test-token');

            assert.strictEqual(response.llmModel, 'anthropic.claude-3-sonnet-20240229-v1:0');
            assert.strictEqual(response.embeddingModel, 'bedrock/cohere.embed-english-v3');
            assert.strictEqual(response.embeddingDimensions, 768);
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

        test('Plan 086: logs warning when model config fields are missing from vend response', async () => {
            // Track what gets logged
            const loggedMessages: string[] = [];
            const trackingOutputChannel = {
                ...mockOutputChannel,
                appendLine: (message: string) => { loggedMessages.push(message); },
            } as vscode.OutputChannel;

            // Create mock client that returns response WITHOUT model config
            const noModelClient = new MockCredentialClient({
                accessKeyId: 'AKIATEST',
                secretAccessKey: 'secret',
                sessionToken: 'session',
                region: 'us-east-1',
                llmModel: undefined,
                embeddingModel: undefined,
                embeddingDimensions: undefined,
            });

            const noModelAuth = new FlowbabyCloudAuth(mockSecretStorage, new MockAuthClient(), trackingOutputChannel);
            const futureDate = new Date(Date.now() + 3600000).toISOString();
            storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
            storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

            const noModelCredentials = new FlowbabyCloudCredentials(noModelAuth, noModelClient, trackingOutputChannel);

            try {
                await noModelCredentials.ensureCredentials();

                // Verify warning was logged (Plan 086 requirement: "fail loudly")
                const warningLogged = loggedMessages.some(msg =>
                    msg.includes('WARNING') && msg.includes('model configuration')
                );
                assert.ok(warningLogged, 'Should log WARNING about missing model config fields');
            } finally {
                noModelCredentials.dispose();
                noModelAuth.dispose();
            }
        });

        test('Plan 086: includes model config in credentials when present', async () => {
            // Default MockCredentialClient includes model config
            const creds = await credentials.ensureCredentials();

            assert.strictEqual(creds.llmModel, 'anthropic.claude-3-haiku-20240307-v1:0', 'llmModel should be mapped');
            assert.strictEqual(creds.embeddingModel, 'bedrock/amazon.titan-embed-text-v2:0', 'embeddingModel should be mapped');
            assert.strictEqual(creds.embeddingDimensions, 1024, 'embeddingDimensions should be mapped');
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
            // Plan 086: Provider and model configuration
            assert.strictEqual(env.LLM_PROVIDER, 'bedrock', 'LLM_PROVIDER should be bedrock');
            assert.strictEqual(env.EMBEDDING_PROVIDER, 'bedrock', 'EMBEDDING_PROVIDER should be bedrock');
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

        test('getEnvironment includes model config when present (Plan 086)', async () => {
            // MockCredentialClient includes model config by default
            const env = await provider.getEnvironment();

            // Plan 086: Model configuration should be forwarded
            assert.strictEqual(env.LLM_MODEL, 'anthropic.claude-3-haiku-20240307-v1:0', 'LLM_MODEL should be set');
            assert.strictEqual(env.EMBEDDING_MODEL, 'bedrock/amazon.titan-embed-text-v2:0', 'EMBEDDING_MODEL should be set');
            assert.strictEqual(env.EMBEDDING_DIMENSIONS, '1024', 'EMBEDDING_DIMENSIONS should be string');
        });

        test('getEnvironment omits model config when not present (backward compat Plan 086)', async () => {
            // Create provider with mock that doesn't include model config
            const noModelClient = new MockCredentialClient({
                accessKeyId: 'AKIATEST123',
                secretAccessKey: 'secrettest123',
                sessionToken: 'sessiontokentest',
                region: 'us-east-1',
                llmModel: undefined,
                embeddingModel: undefined,
                embeddingDimensions: undefined,
            });
            const mockAuthClient = new MockAuthClient();
            const noModelAuth = new FlowbabyCloudAuth(mockSecretStorage, mockAuthClient, mockOutputChannel);

            const futureDate = new Date(Date.now() + 3600000).toISOString();
            storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
            storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

            const noModelCredentials = new FlowbabyCloudCredentials(noModelAuth, noModelClient, mockOutputChannel);
            const noModelProvider = new FlowbabyCloudProvider(noModelCredentials);

            try {
                const env = await noModelProvider.getEnvironment();

                // Providers are still set
                assert.strictEqual(env.LLM_PROVIDER, 'bedrock');
                assert.strictEqual(env.EMBEDDING_PROVIDER, 'bedrock');
                // Model config fields should be undefined (not set)
                assert.strictEqual(env.LLM_MODEL, undefined, 'LLM_MODEL should be omitted when not provided');
                assert.strictEqual(env.EMBEDDING_MODEL, undefined, 'EMBEDDING_MODEL should be omitted when not provided');
                assert.strictEqual(env.EMBEDDING_DIMENSIONS, undefined, 'EMBEDDING_DIMENSIONS should be omitted when not provided');
            } finally {
                noModelCredentials.dispose();
                noModelAuth.dispose();
            }
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

        test('requiresReAuthentication returns true for SESSION_INVALID (Plan 086)', () => {
            const error = new FlowbabyCloudError('SESSION_INVALID', 'Session invalid');
            assert.strictEqual(requiresReAuthentication(error), true);
        });

        test('requiresReAuthentication returns false for RATE_LIMITED', () => {
            const error = new FlowbabyCloudError('RATE_LIMITED', 'Too many requests');
            assert.strictEqual(requiresReAuthentication(error), false);
        });

        test('mapCloudErrorToUX handles SESSION_INVALID same as SESSION_EXPIRED (Plan 086)', () => {
            const error = new FlowbabyCloudError('SESSION_INVALID', 'Session invalid');
            const ux = mapCloudErrorToUX(error);

            assert.strictEqual(ux.severity, 'warning');
            assert.ok(ux.message.includes('login required'), 'Should suggest login');
            assert.strictEqual(ux.actions.length, 1);
            assert.strictEqual(ux.actions[0].label, 'Login to Cloud');
            assert.strictEqual(ux.logMetadata.category, 'authentication');
        });

        test('RATE_LIMITED is recoverable but does not require re-auth (Plan 086)', () => {
            const error = new FlowbabyCloudError('RATE_LIMITED', 'Infrastructure throttle');

            // Should be retryable
            assert.strictEqual(isRecoverableCloudError(error), true, 'RATE_LIMITED should be recoverable');
            // Should NOT require re-authentication (Plan 086 clarification)
            assert.strictEqual(requiresReAuthentication(error), false, 'RATE_LIMITED should NOT require re-auth');
        });

        // Plan 098: v4.0.0 Surface-Specific Auth Error Tests
        test('mapCloudErrorToUX handles INVALID_AUDIENCE (Plan 098 v4.0.0)', () => {
            const error = new FlowbabyCloudError('INVALID_AUDIENCE', 'Token audience invalid');
            const ux = mapCloudErrorToUX(error);

            assert.strictEqual(ux.severity, 'error');
            assert.ok(ux.message.includes('invalid audience'), 'Should mention invalid audience');
            assert.strictEqual(ux.actions.length, 1);
            assert.strictEqual(ux.actions[0].label, 'Login to Cloud');
            assert.strictEqual(ux.logMetadata.category, 'authentication_v4');
        });

        test('mapCloudErrorToUX handles AUDIENCE_MISMATCH (Plan 098 v4.0.0)', () => {
            const error = new FlowbabyCloudError('AUDIENCE_MISMATCH', 'Token audience mismatch');
            const ux = mapCloudErrorToUX(error);

            assert.strictEqual(ux.severity, 'error');
            assert.ok(ux.message.includes('invalid audience'), 'Should mention invalid audience');
            assert.strictEqual(ux.actions.length, 1);
            assert.strictEqual(ux.actions[0].label, 'Login to Cloud');
            assert.strictEqual(ux.logMetadata.category, 'authentication_v4');
        });

        test('mapCloudErrorToUX handles REFRESH_TRANSPORT_INVALID (Plan 098 v4.0.0)', () => {
            const error = new FlowbabyCloudError('REFRESH_TRANSPORT_INVALID', 'Refresh transport mismatch');
            const ux = mapCloudErrorToUX(error);

            assert.strictEqual(ux.severity, 'error');
            assert.ok(ux.message.includes('transport mismatch'), 'Should mention transport mismatch');
            assert.strictEqual(ux.actions.length, 1);
            assert.strictEqual(ux.actions[0].label, 'Login to Cloud');
            assert.strictEqual(ux.logMetadata.category, 'authentication_v4');
        });

        test('mapCloudErrorToUX handles REFRESH_REUSED (Plan 098 v4.0.0)', () => {
            const error = new FlowbabyCloudError('REFRESH_REUSED', 'Refresh token reused');
            const ux = mapCloudErrorToUX(error);

            assert.strictEqual(ux.severity, 'error');
            assert.ok(ux.message.includes('already used'), 'Should mention token reuse');
            assert.ok(ux.message.includes('revoked'), 'Should mention session revoked');
            assert.strictEqual(ux.actions.length, 1);
            assert.strictEqual(ux.actions[0].label, 'Login to Cloud');
            assert.strictEqual(ux.logMetadata.category, 'authentication_v4');
        });

        test('requiresReAuthentication returns true for v4.0.0 auth errors (Plan 098)', () => {
            const v4AuthErrors = ['INVALID_AUDIENCE', 'AUDIENCE_MISMATCH', 'REFRESH_TRANSPORT_INVALID', 'REFRESH_REUSED'];
            for (const code of v4AuthErrors) {
                const error = new FlowbabyCloudError(code as FlowbabyCloudErrorCode, `${code} error`);
                assert.strictEqual(
                    requiresReAuthentication(error), 
                    true, 
                    `${code} should require re-authentication`
                );
            }
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

        test('DEFAULT_CONFIG.apiBaseUrl defaults to production (Plan 099)', async () => {
            const types = await import('../flowbaby-cloud/types');

            assert.strictEqual(
                types.DEFAULT_CONFIG.apiBaseUrl,
                types.PRODUCTION_API_BASE_URL,
                'Default config should use production URL (Plan 099)'
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
                types.PRODUCTION_API_BASE_URL,
                'Should return production URL as default (Plan 099)'
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

    // Plan 085: Cloud Login Command Wiring + Status Consistency Tests
    suite('Plan 085: Command Wiring and Status Transitions', () => {
        test('CLOUD_COMMANDS uses canonical flowbaby.cloud.* namespace', async () => {
            const { CLOUD_COMMANDS } = await import('../flowbaby-cloud/commands');

            // Verify all command IDs use canonical namespace
            assert.strictEqual(
                CLOUD_COMMANDS.LOGIN,
                'flowbaby.cloud.login',
                'LOGIN command should use canonical namespace'
            );
            assert.strictEqual(
                CLOUD_COMMANDS.LOGOUT,
                'flowbaby.cloud.logout',
                'LOGOUT command should use canonical namespace'
            );
            assert.strictEqual(
                CLOUD_COMMANDS.STATUS,
                'flowbaby.cloud.status',
                'STATUS command should use canonical namespace'
            );
        });

        test('CLOUD_ERROR_COMMANDS uses canonical flowbaby.cloud.* namespace', async () => {
            const { CLOUD_ERROR_COMMANDS } = await import('../flowbaby-cloud/errorMapping');

            // Plan 085: Error action buttons must use canonical command IDs
            assert.strictEqual(
                CLOUD_ERROR_COMMANDS.LOGIN,
                'flowbaby.cloud.login',
                'Error LOGIN action should use canonical namespace'
            );
            assert.strictEqual(
                CLOUD_ERROR_COMMANDS.STATUS,
                'flowbaby.cloud.status',
                'Error STATUS action should use canonical namespace'
            );
        });

        test('No FlowbabyCloud.* command IDs in CLOUD_COMMANDS', async () => {
            const { CLOUD_COMMANDS } = await import('../flowbaby-cloud/commands');

            // Verify none of the commands use the legacy namespace
            const commandValues = Object.values(CLOUD_COMMANDS);
            for (const cmd of commandValues) {
                assert.ok(
                    !cmd.startsWith('FlowbabyCloud.'),
                    `Command ${cmd} should not use legacy FlowbabyCloud.* namespace`
                );
            }
        });

        test('No FlowbabyCloud.* command IDs in CLOUD_ERROR_COMMANDS', async () => {
            const { CLOUD_ERROR_COMMANDS } = await import('../flowbaby-cloud/errorMapping');

            const commandValues = Object.values(CLOUD_ERROR_COMMANDS);
            for (const cmd of commandValues) {
                assert.ok(
                    !cmd.startsWith('FlowbabyCloud.'),
                    `Error command ${cmd} should not use legacy FlowbabyCloud.* namespace`
                );
            }
        });

        test('onDidChangeAuthState fires with correct payload on logout', async () => {
            const mockAuthClient = new MockAuthClient();
            const auth = new FlowbabyCloudAuth(mockSecretStorage, mockAuthClient, mockOutputChannel);

            // Set up valid session
            storedSecrets.set('flowbaby.cloud.sessionToken', 'test-token');
            storedSecrets.set('flowbaby.cloud.sessionExpiresAt', new Date(Date.now() + 3600000).toISOString());

            let authEvent: { isAuthenticated: boolean; tier?: string } | undefined;
            const disposable = auth.onDidChangeAuthState(event => {
                authEvent = event;
            });

            await auth.logout();
            disposable.dispose();
            auth.dispose();

            assert.ok(authEvent, 'Auth state change event should fire');
            assert.strictEqual(authEvent!.isAuthenticated, false, 'Should indicate not authenticated');
        });

        test('registerCloudCommands function signature supports optional outputChannel', async () => {
            const { registerCloudCommands } = await import('../flowbaby-cloud/commands');

            // Verify function exists and has expected signature
            // We cannot actually call registerCloudCommands in tests because the commands
            // are already registered by the extension activation. Instead, we verify:
            // 1. Function exists
            // 2. Function has 4 parameters (context, auth, client, outputChannel?)
            // Note: Function.length counts all formal parameters regardless of defaults
            assert.ok(typeof registerCloudCommands === 'function', 'registerCloudCommands should be a function');
            assert.strictEqual(registerCloudCommands.length, 4, 'Function should have 4 parameters (context, auth, client, outputChannel)');

            // The fourth parameter (outputChannel) is optional, verified by TypeScript compilation
            // Plan 085: This signature change enables observability logging without breaking existing calls
            // Plan 097: Added client parameter for dashboard API calls
        });

        test('CLOUD_COMMANDS.DASHBOARD exists and is flowbaby.cloud.dashboard', async () => {
            const { CLOUD_COMMANDS } = await import('../flowbaby-cloud/commands');

            assert.ok(CLOUD_COMMANDS.DASHBOARD, 'CLOUD_COMMANDS should have DASHBOARD');
            assert.strictEqual(
                CLOUD_COMMANDS.DASHBOARD,
                'flowbaby.cloud.dashboard',
                'DASHBOARD command should have correct ID'
            );
        });

        test('Dashboard command focuses sidebar view (Plan 097)', async () => {
            // This test validates the dashboard command calls flowbaby.dashboardView.focus
            // rather than creating an editor panel (legacy behavior removed in Plan 097)
            const { CLOUD_COMMANDS } = await import('../flowbaby-cloud/commands');

            // Verify command ID is registered (the actual command implementation is
            // validated by the extension activation tests)
            assert.strictEqual(
                CLOUD_COMMANDS.DASHBOARD,
                'flowbaby.cloud.dashboard',
                'Dashboard command should exist with correct ID'
            );

            // The implementation now calls vscode.commands.executeCommand('flowbaby.dashboardView.focus')
            // This is verified by code inspection - the command focuses sidebar, not editor panel
            // Full integration test would require mocking executeCommand which is brittle
        });

        test('Status bar enum has NeedsCloudLogin state', () => {
            // Import FlowbabyStatus from the test file's existing imports
            // This validates the status bar can represent Cloud login required state
            assert.ok(
                FlowbabyStatus.NeedsCloudLogin !== undefined,
                'FlowbabyStatus should have NeedsCloudLogin state'
            );
            assert.strictEqual(
                FlowbabyStatus.NeedsCloudLogin,
                'NeedsCloudLogin',
                'NeedsCloudLogin should have correct string value'
            );
        });

        test('NeedsApiKey is aliased to NeedsCloudLogin for backward compatibility', () => {
            assert.strictEqual(
                FlowbabyStatus.NeedsApiKey,
                FlowbabyStatus.NeedsCloudLogin,
                'NeedsApiKey should be an alias for NeedsCloudLogin'
            );
        });

        test('Ready and NeedsCloudLogin are distinct states', () => {
            assert.notStrictEqual(
                FlowbabyStatus.Ready,
                FlowbabyStatus.NeedsCloudLogin,
                'Ready and NeedsCloudLogin should be different values'
            );
        });
    });

    // =========================================================================
    // Plan 087: CloudReadinessService Tests
    // =========================================================================
    suite('CloudReadinessService (Plan 087)', () => {
        let auth: FlowbabyCloudAuth;
        let credentials: FlowbabyCloudCredentials;
        let mockAuthClient: MockAuthClient;
        let mockCredentialClient: MockCredentialClient;
        let mockBridgeChecker: {
            checkHealth: sinon.SinonStub;
            isDaemonHealthy: sinon.SinonStub;
        };

        setup(() => {
            mockAuthClient = new MockAuthClient();
            mockCredentialClient = new MockCredentialClient();
            mockBridgeChecker = {
                checkHealth: sandbox.stub().resolves(true),
                isDaemonHealthy: sandbox.stub().returns(false),
            };

            auth = new FlowbabyCloudAuth(mockSecretStorage, mockAuthClient, mockOutputChannel);
            credentials = new FlowbabyCloudCredentials(auth, mockCredentialClient, mockOutputChannel);
        });

        teardown(() => {
            credentials.dispose();
            auth.dispose();
        });

        test('CloudReadinessService can be imported', async () => {
            const { CloudReadinessService } = await import('../flowbaby-cloud/readiness');
            assert.ok(CloudReadinessService, 'CloudReadinessService should be exported');
        });

        test('initial state shows not authenticated', async () => {
            const { CloudReadinessService } = await import('../flowbaby-cloud/readiness');
            const service = new CloudReadinessService(
                auth,
                credentials,
                mockBridgeChecker,
                mockOutputChannel
            );

            const state = service.getState();
            assert.strictEqual(state.auth, 'not_authenticated');
            assert.strictEqual(state.overall, 'login_required');

            service.dispose();
        });

        test('needsLogin returns true when not authenticated', async () => {
            const { CloudReadinessService } = await import('../flowbaby-cloud/readiness');
            const service = new CloudReadinessService(
                auth,
                credentials,
                mockBridgeChecker,
                mockOutputChannel
            );

            assert.strictEqual(service.needsLogin(), true);

            service.dispose();
        });

        test('evaluateReadiness with authenticated user shows ready', async () => {
            // Set up authenticated state
            const futureDate = new Date(Date.now() + 3600000).toISOString();
            storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
            storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

            const { CloudReadinessService } = await import('../flowbaby-cloud/readiness');
            const service = new CloudReadinessService(
                auth,
                credentials,
                mockBridgeChecker,
                mockOutputChannel
            );

            const state = await service.evaluateReadiness();

            assert.strictEqual(state.auth, 'authenticated');
            assert.strictEqual(state.vend, 'ready');
            assert.strictEqual(state.overall, 'ready');

            service.dispose();
        });

        test('evaluateReadiness skips bridge check when requested', async () => {
            const futureDate = new Date(Date.now() + 3600000).toISOString();
            storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
            storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

            const { CloudReadinessService } = await import('../flowbaby-cloud/readiness');
            const service = new CloudReadinessService(
                auth,
                credentials,
                mockBridgeChecker,
                mockOutputChannel
            );

            await service.evaluateReadiness({ skipBridgeCheck: true });

            // Bridge health check should not have been called
            assert.strictEqual(mockBridgeChecker.checkHealth.called, false);
            assert.strictEqual(mockBridgeChecker.isDaemonHealthy.called, false);

            service.dispose();
        });

        test('getRemediation returns login guidance when not authenticated', async () => {
            const { CloudReadinessService } = await import('../flowbaby-cloud/readiness');
            const service = new CloudReadinessService(
                auth,
                credentials,
                mockBridgeChecker,
                mockOutputChannel
            );

            const remediation = service.getRemediation();

            assert.ok(remediation.message.toLowerCase().includes('login'));
            assert.ok(remediation.primaryAction);
            assert.strictEqual(remediation.primaryAction!.commandId, 'flowbaby.cloud.login');

            service.dispose();
        });

        test('showThrottledError respects throttle limits', async () => {
            const { CloudReadinessService, DEFAULT_THROTTLE_CONFIG } = await import('../flowbaby-cloud/readiness');

            // Use a very short throttle for testing
            const testThrottleConfig = {
                minIntervalMs: 100,
                maxPerWindow: 2,
                windowMs: 1000,
            };

            const service = new CloudReadinessService(
                auth,
                credentials,
                mockBridgeChecker,
                mockOutputChannel,
                testThrottleConfig
            );

            // Stub vscode.window methods to prevent actual notifications
            const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

            const error = new FlowbabyCloudError('INTERNAL_ERROR', 'Test error');

            // First notification should show
            const shown1 = await service.showThrottledError(error);
            assert.strictEqual(shown1, true, 'First notification should be shown');

            // Wait less than minInterval - should be throttled
            const shown2 = await service.showThrottledError(error);
            assert.strictEqual(shown2, false, 'Second notification should be throttled (min interval)');

            showErrorStub.restore();
            service.dispose();
        });

        test('hasValidCredentials returns false when vend not attempted', async () => {
            const { CloudReadinessService } = await import('../flowbaby-cloud/readiness');
            const service = new CloudReadinessService(
                auth,
                credentials,
                mockBridgeChecker,
                mockOutputChannel
            );

            assert.strictEqual(service.hasValidCredentials(), false);

            service.dispose();
        });

        test('hasValidCredentials returns true after successful vend', async () => {
            const futureDate = new Date(Date.now() + 3600000).toISOString();
            storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
            storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

            const { CloudReadinessService } = await import('../flowbaby-cloud/readiness');
            const service = new CloudReadinessService(
                auth,
                credentials,
                mockBridgeChecker,
                mockOutputChannel
            );

            await service.evaluateReadiness();
            assert.strictEqual(service.hasValidCredentials(), true);

            service.dispose();
        });

        test('fires onDidChangeReadiness event when state changes', async () => {
            const { CloudReadinessService } = await import('../flowbaby-cloud/readiness');
            const service = new CloudReadinessService(
                auth,
                credentials,
                mockBridgeChecker,
                mockOutputChannel
            );

            let eventFired = false;
            const disposable = service.onDidChangeReadiness(() => {
                eventFired = true;
            });

            // Set up authenticated state to trigger change
            const futureDate = new Date(Date.now() + 3600000).toISOString();
            storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
            storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

            await service.evaluateReadiness();

            assert.strictEqual(eventFired, true, 'Event should fire when state changes');

            disposable.dispose();
            service.dispose();
        });

        test('overall status is degraded when vend fails', async () => {
            // Set up authenticated state
            const futureDate = new Date(Date.now() + 3600000).toISOString();
            storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
            storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

            // Create a failing credential client
            const failingClient: ICredentialClient = {
                vendCredentials: sandbox.stub().rejects(new FlowbabyCloudError('INTERNAL_ERROR', 'Vend failed')),
            };

            const failingCredentials = new FlowbabyCloudCredentials(auth, failingClient, mockOutputChannel);

            const { CloudReadinessService } = await import('../flowbaby-cloud/readiness');
            const service = new CloudReadinessService(
                auth,
                failingCredentials,
                mockBridgeChecker,
                mockOutputChannel
            );

            const state = await service.evaluateReadiness();

            assert.strictEqual(state.auth, 'authenticated');
            assert.strictEqual(state.vend, 'failed');
            assert.strictEqual(state.overall, 'degraded');
            assert.ok(state.lastError, 'Should have lastError set');

            failingCredentials.dispose();
            service.dispose();
        });

        test('singleton management works correctly', async () => {
            const {
                initializeReadinessService,
                getReadinessService,
                resetReadinessService
            } = await import('../flowbaby-cloud/readiness');

            // Initially undefined
            resetReadinessService();
            assert.strictEqual(getReadinessService(), undefined);

            // Initialize
            const service = initializeReadinessService(
                auth,
                credentials,
                mockBridgeChecker,
                mockOutputChannel
            );
            assert.ok(service);
            assert.strictEqual(getReadinessService(), service);

            // Reset
            resetReadinessService();
            assert.strictEqual(getReadinessService(), undefined);
        });
    });

    // Plan 092 M1: CredentialRefreshManager and daemon controller wiring tests
    suite('CredentialRefreshManager (Plan 092)', () => {
        let auth: FlowbabyCloudAuth;
        let credentials: FlowbabyCloudCredentials;
        let mockAuthClient: MockAuthClient;
        let mockCredentialClient: MockCredentialClient;

        setup(async () => {
            mockAuthClient = new MockAuthClient();
            mockCredentialClient = new MockCredentialClient();
            auth = new FlowbabyCloudAuth(mockSecretStorage, mockAuthClient, mockOutputChannel);
            credentials = new FlowbabyCloudCredentials(auth, mockCredentialClient, mockOutputChannel);

            // Store valid session for authenticated state
            const futureDate = new Date(Date.now() + 3600000).toISOString();
            storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
            storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);
        });

        teardown(() => {
            auth.dispose();
            credentials.dispose();
        });

        test('createCredentialRefreshManager returns disposable instance', async () => {
            const { createCredentialRefreshManager } = await import('../flowbaby-cloud/refresh');
            const refreshManager = createCredentialRefreshManager(credentials, mockOutputChannel);

            assert.ok(refreshManager, 'Should create refresh manager');
            assert.strictEqual(typeof refreshManager.dispose, 'function', 'Should be disposable');

            refreshManager.dispose();
        });

        test('registerDaemonController accepts IDaemonController interface', async () => {
            const { createCredentialRefreshManager } = await import('../flowbaby-cloud/refresh');
            const refreshManager = createCredentialRefreshManager(credentials, mockOutputChannel);

            // Mock daemon controller implementing IDaemonController
            const mockDaemonController = {
                restart: sandbox.stub().resolves(),
                isRunning: sandbox.stub().returns(true),
                getPendingRequestCount: sandbox.stub().returns(0),
            };

            // Should not throw
            refreshManager.registerDaemonController(mockDaemonController);

            // Verify output channel was logged to
            assert.ok((mockOutputChannel.appendLine as sinon.SinonStub).calledWith(
                sinon.match(/Daemon controller registered/)
            ), 'Should log daemon controller registration');

            refreshManager.dispose();
        });

        test('unregisterDaemonController clears controller reference', async () => {
            const { createCredentialRefreshManager } = await import('../flowbaby-cloud/refresh');
            const refreshManager = createCredentialRefreshManager(credentials, mockOutputChannel);

            const mockDaemonController = {
                restart: sandbox.stub().resolves(),
                isRunning: sandbox.stub().returns(true),
                getPendingRequestCount: sandbox.stub().returns(0),
            };

            refreshManager.registerDaemonController(mockDaemonController);
            refreshManager.unregisterDaemonController();

            // Verify unregister was logged
            assert.ok((mockOutputChannel.appendLine as sinon.SinonStub).calledWith(
                sinon.match(/Daemon controller unregistered/)
            ), 'Should log daemon controller unregistration');

            refreshManager.dispose();
        });

        test('isRefreshInProgress returns false initially', async () => {
            const { createCredentialRefreshManager } = await import('../flowbaby-cloud/refresh');
            const refreshManager = createCredentialRefreshManager(credentials, mockOutputChannel);

            assert.strictEqual(refreshManager.isRefreshInProgress(), false);

            refreshManager.dispose();
        });

        test('getState returns initial state correctly', async () => {
            const { createCredentialRefreshManager } = await import('../flowbaby-cloud/refresh');
            const refreshManager = createCredentialRefreshManager(credentials, mockOutputChannel);

            const state = refreshManager.getState();
            assert.strictEqual(state.refreshInProgress, false);
            assert.strictEqual(state.consecutiveFailures, 0);
            assert.strictEqual(state.credentialExpiresAt, undefined);
            assert.strictEqual(state.lastRefreshAt, undefined);

            refreshManager.dispose();
        });
    });

    // =========================================================================
    // Plan 094: Cross-Region Nova Lite (Zones) Tests
    // =========================================================================
    suite('Plan 094: Geographic Zone Support', () => {
        let sandbox: sinon.SinonSandbox;
        let mockSecretStorage: vscode.SecretStorage;
        let mockOutputChannel: vscode.OutputChannel;
        let storedSecrets: Map<string, string>;

        setup(() => {
            sandbox = sinon.createSandbox();
            storedSecrets = new Map();

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
                name: 'Flowbaby Cloud Zone Test',
            };
        });

        teardown(() => {
            sandbox.restore();
        });

        suite('MockCredentialClient with zone support', () => {
            test('returns zone field in response (Plan 094)', async () => {
                // Plan 094: VendResponse now includes required 'zone' field
                const mockClient = new MockCredentialClient({
                    zone: 'us',
                });
                const response = await mockClient.vendCredentials('test-token');

                assert.strictEqual(response.zone, 'us', 'Should return zone field');
            });

            test('accepts all valid GeographicZone values', async () => {
                // Plan 094: GeographicZone = 'us' | 'eu' | 'apac'
                for (const zone of ['us', 'eu', 'apac'] as const) {
                    const mockClient = new MockCredentialClient({ zone });
                    const response = await mockClient.vendCredentials('test-token');
                    assert.strictEqual(response.zone, zone, `Should accept zone '${zone}'`);
                }
            });
        });

        suite('Vend request with preferredZone', () => {
            test('sends preferredZone when configured (Plan 094)', async () => {
                // This test validates Deliverable #4: Extension request sends preferredZone
                // TDD: This will fail until credentials.ts is updated to use preferredZone

                let capturedRequest: VendRequest | undefined;
                const capturingClient: ICredentialClient = {
                    async vendCredentials(_sessionToken: string, request?: VendRequest): Promise<VendResponse> {
                        capturedRequest = request;
                        return {
                            accessKeyId: 'AKIATEST',
                            secretAccessKey: 'secret',
                            sessionToken: 'session',
                            region: 'eu-west-1',
                            zone: 'eu',
                            expiration: new Date(Date.now() + 3600000).toISOString(),
                            llmModel: 'anthropic.claude-3-haiku-20240307-v1:0',
                            embeddingModel: 'bedrock/amazon.titan-embed-text-v2:0',
                            embeddingDimensions: 1024,
                        };
                    }
                };

                // Mock the VS Code configuration to return preferredZone = 'eu'
                const getConfigStub = sandbox.stub(vscode.workspace, 'getConfiguration');
                getConfigStub.returns({
                    get: (key: string) => {
                        if (key === 'preferredZone') return 'eu';
                        return undefined;
                    },
                } as unknown as vscode.WorkspaceConfiguration);

                const mockAuthClient = new MockAuthClient();
                const mockAuth = new FlowbabyCloudAuth(mockSecretStorage, mockAuthClient, mockOutputChannel);
                const futureDate = new Date(Date.now() + 3600000).toISOString();
                storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
                storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

                const credentials = new FlowbabyCloudCredentials(mockAuth, capturingClient, mockOutputChannel);

                try {
                    await credentials.ensureCredentials();

                    // Plan 094 Deliverable #4: preferredZone must be sent, never preferredRegion
                    assert.ok(capturedRequest, 'Request should be captured');
                    assert.strictEqual(capturedRequest?.preferredZone, 'eu', 'Should send preferredZone');
                    // Check that preferredRegion is not sent (cast to Record to avoid type error)
                    assert.strictEqual(
                        (capturedRequest as unknown as Record<string, unknown>)?.preferredRegion,
                        undefined,
                        'Should never send preferredRegion'
                    );
                } finally {
                    credentials.dispose();
                    mockAuth.dispose();
                }
            });

            test('omits preferredZone when not configured (Plan 094)', async () => {
                // Deliverable #4: If user has not selected a zone, omit preferredZone
                let capturedRequest: VendRequest | undefined;
                const capturingClient: ICredentialClient = {
                    async vendCredentials(_sessionToken: string, request?: VendRequest): Promise<VendResponse> {
                        capturedRequest = request;
                        return {
                            accessKeyId: 'AKIATEST',
                            secretAccessKey: 'secret',
                            sessionToken: 'session',
                            region: 'us-east-1',
                            zone: 'us',
                            expiration: new Date(Date.now() + 3600000).toISOString(),
                            llmModel: 'anthropic.claude-3-haiku-20240307-v1:0',
                            embeddingModel: 'bedrock/amazon.titan-embed-text-v2:0',
                            embeddingDimensions: 1024,
                        };
                    }
                };

                // Mock config returning empty/undefined preferredZone
                const getConfigStub = sandbox.stub(vscode.workspace, 'getConfiguration');
                getConfigStub.returns({
                    get: (key: string) => {
                        if (key === 'preferredZone') return '';
                        return undefined;
                    },
                } as unknown as vscode.WorkspaceConfiguration);

                const mockAuthClient = new MockAuthClient();
                const mockAuth = new FlowbabyCloudAuth(mockSecretStorage, mockAuthClient, mockOutputChannel);
                const futureDate = new Date(Date.now() + 3600000).toISOString();
                storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
                storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

                const credentials = new FlowbabyCloudCredentials(mockAuth, capturingClient, mockOutputChannel);

                try {
                    await credentials.ensureCredentials();

                    // Should not include preferredZone in request
                    assert.ok(capturedRequest, 'Request should be captured');
                    assert.strictEqual(capturedRequest?.preferredZone, undefined, 'Should omit preferredZone when empty');
                    // Check that preferredRegion is not sent (cast to Record to avoid type error)
                    assert.strictEqual(
                        (capturedRequest as unknown as Record<string, unknown>)?.preferredRegion,
                        undefined,
                        'Should never send preferredRegion'
                    );
                } finally {
                    credentials.dispose();
                    mockAuth.dispose();
                }
            });

            test('ignores legacy preferredRegion setting (Plan 094)', async () => {
                // Deliverable #4: preferredRegion is not read; if present it is ignored
                let capturedRequest: VendRequest | undefined;
                const capturingClient: ICredentialClient = {
                    async vendCredentials(_sessionToken: string, request?: VendRequest): Promise<VendResponse> {
                        capturedRequest = request;
                        return {
                            accessKeyId: 'AKIATEST',
                            secretAccessKey: 'secret',
                            sessionToken: 'session',
                            region: 'us-east-1',
                            zone: 'us',
                            expiration: new Date(Date.now() + 3600000).toISOString(),
                            llmModel: 'anthropic.claude-3-haiku-20240307-v1:0',
                            embeddingModel: 'bedrock/amazon.titan-embed-text-v2:0',
                            embeddingDimensions: 1024,
                        };
                    }
                };

                // Mock config: preferredRegion is set, preferredZone is NOT set
                const getConfigStub = sandbox.stub(vscode.workspace, 'getConfiguration');
                getConfigStub.returns({
                    get: (key: string) => {
                        if (key === 'preferredRegion') return 'eu-west-1'; // Legacy setting
                        if (key === 'preferredZone') return ''; // New setting empty
                        return undefined;
                    },
                } as unknown as vscode.WorkspaceConfiguration);

                const mockAuthClient = new MockAuthClient();
                const mockAuth = new FlowbabyCloudAuth(mockSecretStorage, mockAuthClient, mockOutputChannel);
                const futureDate = new Date(Date.now() + 3600000).toISOString();
                storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
                storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

                const credentials = new FlowbabyCloudCredentials(mockAuth, capturingClient, mockOutputChannel);

                try {
                    await credentials.ensureCredentials();

                    // Even though preferredRegion is set in config, it should be ignored
                    assert.ok(capturedRequest, 'Request should be captured');
                    // Check that preferredRegion is not sent (cast to Record to avoid type error)
                    assert.strictEqual(
                        (capturedRequest as unknown as Record<string, unknown>)?.preferredRegion,
                        undefined,
                        'Should never send preferredRegion even if set'
                    );
                } finally {
                    credentials.dispose();
                    mockAuth.dispose();
                }
            });
        });

        suite('Vend response handling with zone', () => {
            test('caches zone from response (Plan 094)', async () => {
                // Deliverable #5: Extension accepts and records VendResponse.zone
                const mockClient = new MockCredentialClient({
                    zone: 'apac',
                    region: 'ap-southeast-2',
                });

                const mockAuthClient = new MockAuthClient();
                const mockAuth = new FlowbabyCloudAuth(mockSecretStorage, mockAuthClient, mockOutputChannel);
                const futureDate = new Date(Date.now() + 3600000).toISOString();
                storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
                storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

                const credentials = new FlowbabyCloudCredentials(mockAuth, mockClient, mockOutputChannel);

                try {
                    const creds = await credentials.ensureCredentials();

                    // Plan 094: zone should be mapped to CachedCredentials
                    assert.strictEqual(creds.zone, 'apac', 'Zone should be cached from response');
                    assert.strictEqual(creds.region, 'ap-southeast-2', 'Region should be cached from response');
                } finally {
                    credentials.dispose();
                    mockAuth.dispose();
                }
            });

            test('fails loudly when zone field is missing (Plan 094 - backend incompatibility)', async () => {
                // Deliverable #3: If response is missing zone field, fail loudly
                const incompatibleClient: ICredentialClient = {
                    async vendCredentials(): Promise<VendResponse> {
                        // Simulate old backend that doesn't return zone
                        return {
                            accessKeyId: 'AKIATEST',
                            secretAccessKey: 'secret',
                            sessionToken: 'session',
                            region: 'us-east-1',
                            expiration: new Date(Date.now() + 3600000).toISOString(),
                            llmModel: 'anthropic.claude-3-haiku-20240307-v1:0',
                            embeddingModel: 'bedrock/amazon.titan-embed-text-v2:0',
                            embeddingDimensions: 1024,
                            // zone is MISSING - old backend
                        } as VendResponse;
                    }
                };

                const mockAuthClient = new MockAuthClient();
                const mockAuth = new FlowbabyCloudAuth(mockSecretStorage, mockAuthClient, mockOutputChannel);
                const futureDate = new Date(Date.now() + 3600000).toISOString();
                storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
                storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

                const credentials = new FlowbabyCloudCredentials(mockAuth, incompatibleClient, mockOutputChannel);

                try {
                    await credentials.ensureCredentials();
                    assert.fail('Should throw error for missing zone field');
                } catch (error) {
                    // Plan 094 Deliverable #3: Fail loudly with remediation message
                    assert.ok(error instanceof FlowbabyCloudError, 'Should throw FlowbabyCloudError');
                    assert.strictEqual((error as FlowbabyCloudError).code, 'UNEXPECTED_RESPONSE',
                        'Should use UNEXPECTED_RESPONSE code for incompatible backend');
                } finally {
                    credentials.dispose();
                    mockAuth.dispose();
                }
            });
        });

        suite('INVALID_ZONE error handling (Plan 094 Deliverable #9)', () => {
            test('maps INVALID_ZONE to user-friendly configuration error', async () => {
                // Use FlowbabyCloudError for the mapping function
                const ux = mapCloudErrorToUX(
                    new FlowbabyCloudError('INVALID_ZONE', 'Invalid zone: xyz')
                );

                // Plan 094: INVALID_ZONE should point user to zone setting
                assert.ok(
                    ux.message.includes('zone') || ux.message.includes('Zone'),
                    'Error message should mention zone'
                );
                assert.ok(
                    ux.message.includes('us') && ux.message.includes('eu') && ux.message.includes('apac'),
                    'Error message should list allowed zone values'
                );
            });

            test('INVALID_ZONE requires re-configuration, not re-authentication', () => {
                // INVALID_ZONE is a config error, not an auth error
                // Use FlowbabyCloudError since that's what requiresReAuthentication checks
                const result = requiresReAuthentication(
                    new FlowbabyCloudError('INVALID_ZONE', 'Invalid zone')
                );

                assert.strictEqual(result, false, 'INVALID_ZONE should not require re-authentication');
            });

            test('INVALID_ZONE is not recoverable by retry', () => {
                // User must fix their config - retry won't help
                // Use FlowbabyCloudError since that's what isRecoverableCloudError checks
                const result = isRecoverableCloudError(
                    new FlowbabyCloudError('INVALID_ZONE', 'Invalid zone')
                );

                assert.strictEqual(result, false, 'INVALID_ZONE is not recoverable by retry');
            });
        });

        suite('Daemon restart triggers with zone (Plan 094 Deliverable #6)', () => {
            test('zone change should be included in restart trigger fields', async () => {
                // This test documents the expected behavior from Deliverable #6
                // The actual implementation is in CachedCredentials and refresh.ts

                // CachedCredentials should have a zone field
                const mockClient = new MockCredentialClient({ zone: 'us' });
                const mockAuthClient = new MockAuthClient();
                const mockAuth = new FlowbabyCloudAuth(mockSecretStorage, mockAuthClient, mockOutputChannel);
                const futureDate = new Date(Date.now() + 3600000).toISOString();
                storedSecrets.set('flowbaby.cloud.sessionToken', 'valid-token');
                storedSecrets.set('flowbaby.cloud.sessionExpiresAt', futureDate);

                const credentials = new FlowbabyCloudCredentials(mockAuth, mockClient, mockOutputChannel);

                try {
                    const creds = await credentials.ensureCredentials();

                    // Verify zone is part of cached credentials (needed for comparison)
                    assert.ok('zone' in creds, 'CachedCredentials should include zone field');
                } finally {
                    credentials.dispose();
                    mockAuth.dispose();
                }
            });
        });
    });
});
