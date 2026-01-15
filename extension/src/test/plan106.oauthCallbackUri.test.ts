/**
 * Plan 106: OAuth Callback URI for VS Code Variants
 *
 * TDD tests for dynamic OAuth callback URI generation.
 * These tests define the expected behavior BEFORE implementation.
 *
 * Requirements:
 * 1. Callback URI scheme must be derived from vscode.env.uriScheme
 * 2. Callback authority must be derived from runtime extension ID
 * 3. Only 'vscode' and 'vscode-insiders' schemes are allowed
 * 4. Unsupported schemes must fail-closed with explicit error
 *
 * @see agent-output/planning/106-oauth-callback-vscode-variants.md
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

// These imports will fail until we implement the functions (TDD Red phase)
import {
    getOAuthCallbackUri,
    SUPPORTED_URI_SCHEMES,
    UnsupportedUriSchemeError,
} from '../flowbaby-cloud/types';

import * as registrationHelper from '../lifecycle/registrationHelper';

suite('Plan 106: OAuth Callback URI for VS Code Variants', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        // Default: mock extension id from activation context
        sandbox.stub(registrationHelper, 'getActiveExtensionId').returns('Flowbaby.flowbaby');
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('SUPPORTED_URI_SCHEMES', () => {
        test('includes vscode scheme', () => {
            assert.ok(
                SUPPORTED_URI_SCHEMES.includes('vscode'),
                'vscode scheme must be in supported list'
            );
        });

        test('includes vscode-insiders scheme', () => {
            assert.ok(
                SUPPORTED_URI_SCHEMES.includes('vscode-insiders'),
                'vscode-insiders scheme must be in supported list'
            );
        });

        test('does not include arbitrary schemes', () => {
            // Cast to any to allow checking non-supported scheme strings
            const schemes = SUPPORTED_URI_SCHEMES as readonly string[];
            assert.ok(
                !schemes.includes('cursor'),
                'cursor scheme must NOT be in supported list (out of scope)'
            );
            assert.ok(
                !schemes.includes('vscodium'),
                'vscodium scheme must NOT be in supported list (out of scope)'
            );
        });

        test('contains exactly two schemes', () => {
            assert.strictEqual(
                SUPPORTED_URI_SCHEMES.length,
                2,
                'Only vscode and vscode-insiders are supported in v0.7.2'
            );
        });
    });

    suite('getOAuthCallbackUri', () => {
        test('returns URI with vscode scheme when running in VS Code stable', () => {
            // Arrange: Mock VS Code stable environment
            sandbox.stub(vscode.env, 'uriScheme').value('vscode');

            // Act
            const uri = getOAuthCallbackUri();

            // Assert
            assert.ok(uri.startsWith('vscode://'), `URI should start with vscode://, got: ${uri}`);
            assert.ok(uri.endsWith('/auth/callback'), `URI should end with /auth/callback, got: ${uri}`);
        });

        test('returns URI with vscode-insiders scheme when running in VS Code Insiders', () => {
            // Arrange: Mock VS Code Insiders environment
            sandbox.stub(vscode.env, 'uriScheme').value('vscode-insiders');

            // Act
            const uri = getOAuthCallbackUri();

            // Assert
            assert.ok(
                uri.startsWith('vscode-insiders://'),
                `URI should start with vscode-insiders://, got: ${uri}`
            );
            assert.ok(uri.endsWith('/auth/callback'), `URI should end with /auth/callback, got: ${uri}`);
        });

        test('derives authority from runtime extension ID (not hardcoded)', () => {
            // Arrange
            sandbox.stub(vscode.env, 'uriScheme').value('vscode');

            // Act
            const uri = getOAuthCallbackUri();

            // Assert: The authority should be the extension ID (Flowbaby.flowbaby)
            // This test validates the callback shape matches expected pattern
            const expectedPattern = /^vscode:\/\/[A-Za-z0-9-]+\.[A-Za-z0-9-]+\/auth\/callback$/;
            assert.ok(
                expectedPattern.test(uri),
                `URI should match pattern <scheme>://<publisher>.<name>/auth/callback, got: ${uri}`
            );
        });

        test('throws UnsupportedUriSchemeError for unsupported scheme', () => {
            // Arrange: Mock an unsupported editor (e.g., Cursor)
            sandbox.stub(vscode.env, 'uriScheme').value('cursor');

            // Act & Assert
            assert.throws(
                () => getOAuthCallbackUri(),
                UnsupportedUriSchemeError,
                'Should throw UnsupportedUriSchemeError for unsupported schemes'
            );
        });

        test('throws UnsupportedUriSchemeError for vscodium scheme', () => {
            // Arrange
            sandbox.stub(vscode.env, 'uriScheme').value('vscodium');

            // Act & Assert
            assert.throws(
                () => getOAuthCallbackUri(),
                UnsupportedUriSchemeError,
                'Should throw UnsupportedUriSchemeError for vscodium'
            );
        });

        test('UnsupportedUriSchemeError contains actionable message', () => {
            // Arrange
            sandbox.stub(vscode.env, 'uriScheme').value('windsurf');

            // Act & Assert
            try {
                getOAuthCallbackUri();
                assert.fail('Should have thrown UnsupportedUriSchemeError');
            } catch (error) {
                assert.ok(error instanceof UnsupportedUriSchemeError);
                const message = (error as Error).message;
                // Message should include the unsupported scheme for debugging
                assert.ok(
                    message.includes('windsurf'),
                    `Error message should include the unsupported scheme, got: ${message}`
                );
                // Message should provide actionable guidance
                assert.ok(
                    message.toLowerCase().includes('vs code') || message.toLowerCase().includes('insiders'),
                    `Error message should mention supported editors, got: ${message}`
                );
            }
        });
    });

    suite('Callback URI format consistency', () => {
        test('callback path is /auth/callback for all supported schemes', () => {
            for (const scheme of SUPPORTED_URI_SCHEMES) {
                sandbox.restore();
                sandbox = sinon.createSandbox();
                sandbox.stub(registrationHelper, 'getActiveExtensionId').returns('Flowbaby.flowbaby');
                sandbox.stub(vscode.env, 'uriScheme').value(scheme);

                const uri = getOAuthCallbackUri();
                const url = new URL(uri);

                assert.strictEqual(
                    url.pathname,
                    '/auth/callback',
                    `Callback path for ${scheme} should be /auth/callback`
                );
            }
        });

        test('authority matches extension ID pattern', () => {
            sandbox.stub(vscode.env, 'uriScheme').value('vscode');

            const uri = getOAuthCallbackUri();
            const url = new URL(uri);

            // Authority should be publisher.name format
            assert.ok(
                url.host.includes('.'),
                `Authority should be in publisher.name format, got: ${url.host}`
            );
        });

        test('throws error when extension context is not available', () => {
            sandbox.restore();
            sandbox = sinon.createSandbox();
            sandbox.stub(registrationHelper, 'getActiveExtensionId').returns(undefined);
            sandbox.stub(vscode.env, 'uriScheme').value('vscode');

            assert.throws(
                () => getOAuthCallbackUri(),
                /Extension context not available/,
                'Should throw when extension id is not available'
            );
        });
    });
});
