/**
 * Plan 106: OAuth Callback URI for VS Code Variants
 *
 * Tests for verifyOAuthCallbackUri() helper.
 * Ensures the helper correctly validates extension identity and fails closed.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { verifyOAuthCallbackUri } from '../flowbaby-cloud/types';
import * as registrationHelper from '../lifecycle/registrationHelper';

suite('Plan 106: verifyOAuthCallbackUri', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('returns true when callback authority matches extensionId (case-insensitive) under supported scheme', () => {
        sandbox.stub(vscode.env, 'uriScheme').value('vscode');
        sandbox.stub(registrationHelper, 'getActiveExtensionId').returns('Flowbaby.flowbaby');

        assert.strictEqual(verifyOAuthCallbackUri('flowbaby.Flowbaby'), true);
    });

    test('returns false when callback authority does not match extensionId', () => {
        sandbox.stub(vscode.env, 'uriScheme').value('vscode');
        sandbox.stub(registrationHelper, 'getActiveExtensionId').returns('Other.publisher');

        assert.strictEqual(verifyOAuthCallbackUri('Flowbaby.flowbaby'), false);
    });

    test('returns false (fail-closed) when scheme is unsupported', () => {
        sandbox.stub(vscode.env, 'uriScheme').value('cursor');
        sandbox.stub(registrationHelper, 'getActiveExtensionId').returns('Flowbaby.flowbaby');

        assert.strictEqual(verifyOAuthCallbackUri('Flowbaby.flowbaby'), false);
    });

    test('returns false when extension context is not available', () => {
        sandbox.stub(vscode.env, 'uriScheme').value('vscode');
        sandbox.stub(registrationHelper, 'getActiveExtensionId').returns(undefined);

        assert.strictEqual(verifyOAuthCallbackUri('Flowbaby.flowbaby'), false);
    });
});
