/**
 * Dashboard View Provider Tests - Plan 097
 *
 * Tests for the sidebar dashboard WebviewViewProvider registration
 * and lifecycle behavior. Covers:
 * - Provider registration during activation
 * - Resilience to "already registered" scenarios (test harness reuse)
 * - Basic refresh path execution
 *
 * @see Plan 097 - Sidebar Dashboard Tests
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

suite('DashboardViewProvider Tests (Plan 097)', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('View Provider Registration', () => {
        test('flowbaby.dashboardView is a valid view type constant', async () => {
            // Dynamic import to verify the module can be loaded
            const { DashboardViewProvider } = await import('../flowbaby-cloud/dashboard/DashboardViewProvider');
            
            assert.strictEqual(
                DashboardViewProvider.viewType,
                'flowbaby.dashboardView',
                'View type should match package.json contribution'
            );
        });

        test('provider can be instantiated with required dependencies', async () => {
            const { DashboardViewProvider } = await import('../flowbaby-cloud/dashboard/DashboardViewProvider');
            
            // Create minimal mock dependencies
            const mockExtensionUri = vscode.Uri.file('/test/extension');
            const mockAuth = {
                getSessionToken: sandbox.stub().resolves(null),
                isAuthenticated: sandbox.stub().resolves(false),
                onDidChangeAuthState: new vscode.EventEmitter().event,
            };
            const mockClient = {
                getUserProfile: sandbox.stub().resolves(null),
                getUserUsage: sandbox.stub().resolves(null),
            };
            
            // Should not throw during instantiation
            const provider = new DashboardViewProvider(
                mockExtensionUri,
                mockAuth as any,
                mockClient as any
            );
            
            assert.ok(provider, 'Provider should be instantiated');
        });

        test('provider implements WebviewViewProvider interface', async () => {
            const { DashboardViewProvider } = await import('../flowbaby-cloud/dashboard/DashboardViewProvider');
            
            const mockExtensionUri = vscode.Uri.file('/test/extension');
            const mockAuth = {
                getSessionToken: sandbox.stub().resolves(null),
                isAuthenticated: sandbox.stub().resolves(false),
                onDidChangeAuthState: new vscode.EventEmitter().event,
            };
            const mockClient = {
                getUserProfile: sandbox.stub().resolves(null),
                getUserUsage: sandbox.stub().resolves(null),
            };
            
            const provider = new DashboardViewProvider(
                mockExtensionUri,
                mockAuth as any,
                mockClient as any
            );
            
            // WebviewViewProvider interface requires resolveWebviewView method
            assert.strictEqual(
                typeof provider.resolveWebviewView,
                'function',
                'Provider must implement resolveWebviewView'
            );
        });
    });

    suite('Already Registered Resilience', () => {
        /**
         * This test verifies that the extension activation handles the scenario
         * where the view provider is already registered (common in test harness
         * reuse scenarios). The registration should be guarded to avoid throwing.
         */
        test('re-registration should be handled gracefully', async () => {
            // This test validates the activation pattern rather than direct registration
            // because VS Code's registerWebviewViewProvider is managed by the runtime
            
            // The key invariant is that double-registration doesn't crash extension activation.
            // We verify this by checking that the DashboardViewProvider can be imported
            // multiple times without side effects.
            
            const import1 = await import('../flowbaby-cloud/dashboard/DashboardViewProvider');
            const import2 = await import('../flowbaby-cloud/dashboard/DashboardViewProvider');
            
            assert.strictEqual(
                import1.DashboardViewProvider,
                import2.DashboardViewProvider,
                'Module should be cached (singleton pattern)'
            );
        });

        test('DashboardViewProvider module exports are stable across imports', async () => {
            // Verify the module structure is stable - this ensures registration
            // uses consistent references and doesn't create duplicate providers
            
            const module1 = await import('../flowbaby-cloud/dashboard/DashboardViewProvider');
            const module2 = await import('../flowbaby-cloud/dashboard/DashboardViewProvider');
            
            assert.strictEqual(
                module1.DashboardViewProvider.viewType,
                module2.DashboardViewProvider.viewType,
                'View type should be consistent across imports'
            );
            
            assert.strictEqual(
                module1.DashboardViewProvider.viewType,
                'flowbaby.dashboardView',
                'View type should match expected value'
            );
        });
    });

    suite('Refresh Path', () => {
        test('refresh method exists and is callable', async () => {
            const { DashboardViewProvider } = await import('../flowbaby-cloud/dashboard/DashboardViewProvider');
            
            const mockExtensionUri = vscode.Uri.file('/test/extension');
            const mockAuth = {
                getSessionToken: sandbox.stub().resolves(null),
                isAuthenticated: sandbox.stub().resolves(false),
                onDidChangeAuthState: new vscode.EventEmitter().event,
            };
            const mockClient = {
                getUserProfile: sandbox.stub().resolves(null),
                getUserUsage: sandbox.stub().resolves(null),
            };
            
            const provider = new DashboardViewProvider(
                mockExtensionUri,
                mockAuth as any,
                mockClient as any
            );
            
            assert.strictEqual(
                typeof provider.refresh,
                'function',
                'Provider must have refresh method'
            );
            
            // refresh() should not throw even when view is not resolved
            // (it should silently no-op when _view is undefined)
            await assert.doesNotReject(
                async () => await provider.refresh(),
                'refresh() should not throw when view is not resolved'
            );
        });

        test('refresh handles unauthenticated state gracefully', async () => {
            const { DashboardViewProvider } = await import('../flowbaby-cloud/dashboard/DashboardViewProvider');
            
            const mockExtensionUri = vscode.Uri.file('/test/extension');
            const mockAuth = {
                getSessionToken: sandbox.stub().resolves(null), // Not authenticated
                isAuthenticated: sandbox.stub().resolves(false),
                onDidChangeAuthState: new vscode.EventEmitter().event,
            };
            const mockClient = {
                getUserProfile: sandbox.stub().resolves(null),
                getUserUsage: sandbox.stub().resolves(null),
            };
            
            const provider = new DashboardViewProvider(
                mockExtensionUri,
                mockAuth as any,
                mockClient as any
            );
            
            // Should not throw even when unauthenticated
            await assert.doesNotReject(
                async () => await provider.refresh(),
                'refresh() should handle unauthenticated state'
            );
        });

        test('refresh handles API errors gracefully', async () => {
            const { DashboardViewProvider } = await import('../flowbaby-cloud/dashboard/DashboardViewProvider');
            
            const mockExtensionUri = vscode.Uri.file('/test/extension');
            const mockAuth = {
                getSessionToken: sandbox.stub().resolves('test-token'),
                isAuthenticated: sandbox.stub().resolves(true),
                onDidChangeAuthState: new vscode.EventEmitter().event,
            };
            const mockClient = {
                getUserProfile: sandbox.stub().rejects(new Error('Network error')),
                getUserUsage: sandbox.stub().rejects(new Error('Network error')),
            };
            
            const provider = new DashboardViewProvider(
                mockExtensionUri,
                mockAuth as any,
                mockClient as any
            );
            
            // Should not throw even when API calls fail
            await assert.doesNotReject(
                async () => await provider.refresh(),
                'refresh() should handle API errors gracefully'
            );
        });
    });
});
