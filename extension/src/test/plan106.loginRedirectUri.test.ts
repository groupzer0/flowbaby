/**
 * Plan 106: OAuth Callback URI for VS Code Variants
 *
 * Integration-focused tests for FlowbabyCloudAuth.login() to ensure it:
 * - passes the dynamically computed callback URI as redirect_uri
 * - fails closed (and does not open a browser) for unsupported editor schemes
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { FlowbabyCloudAuth, MockAuthClient } from '../flowbaby-cloud';
import { UnsupportedUriSchemeError } from '../flowbaby-cloud/types';
import * as registrationHelper from '../lifecycle/registrationHelper';

suite('Plan 106: FlowbabyCloudAuth.login redirect_uri', () => {
    let sandbox: sinon.SinonSandbox;
    let storedSecrets: Map<string, string>;
    let mockSecretStorage: vscode.SecretStorage;
    let mockOutputChannel: vscode.OutputChannel;

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
            name: 'Flowbaby Cloud Test',
        };
    });

    teardown(() => {
        sandbox.restore();
    });

    test('passes computed callback URI as redirect_uri to /auth/login', async () => {
        sandbox.stub(vscode.env, 'uriScheme').value('vscode-insiders');
        sandbox.stub(registrationHelper, 'getActiveExtensionId').returns('Flowbaby.flowbaby');

        const openExternalStub = sandbox.stub(vscode.env, 'openExternal').resolves(true);

        const auth = new FlowbabyCloudAuth(mockSecretStorage, new MockAuthClient(), mockOutputChannel);
        sandbox.stub(auth as any, 'waitForOAuthCallback').resolves('test-code');

        await auth.login();

        assert.strictEqual(openExternalStub.calledOnce, true, 'Expected login() to open the browser once');

        const launched = openExternalStub.firstCall.args[0];
        const params = new URLSearchParams(launched.query);
        const redirectUri = params.get('redirect_uri');

        assert.strictEqual(
            redirectUri,
            'vscode-insiders://Flowbaby.flowbaby/auth/callback',
            'redirect_uri must match the dynamically computed callback URI'
        );

        auth.dispose();
    });

    test('fails closed and does not openExternal when scheme is unsupported', async () => {
        sandbox.stub(vscode.env, 'uriScheme').value('cursor');
        sandbox.stub(registrationHelper, 'getActiveExtensionId').returns('Flowbaby.flowbaby');

        const openExternalStub = sandbox.stub(vscode.env, 'openExternal').resolves(true);

        const auth = new FlowbabyCloudAuth(mockSecretStorage, new MockAuthClient(), mockOutputChannel);

        await assert.rejects(
            () => auth.login(),
            (err: unknown) => err instanceof UnsupportedUriSchemeError,
            'Expected login() to throw UnsupportedUriSchemeError for unsupported editor scheme'
        );

        assert.strictEqual(openExternalStub.called, false, 'Browser must not be opened when scheme is unsupported');

        auth.dispose();
    });
});
