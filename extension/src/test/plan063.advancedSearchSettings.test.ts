import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import { FlowbabyClient } from '../flowbabyClient';

type ConfigStore = Record<string, unknown>;

suite('Plan 063 Advanced Search Settings', () => {
    let sandbox: sinon.SinonSandbox;

    let advancedSearchStore: ConfigStore;

    const makeConfig = (store: ConfigStore) => ({
        get: (key: string, defaultValue?: unknown) => {
            return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : defaultValue;
        }
    }) as unknown as vscode.WorkspaceConfiguration;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Defaults (can be overridden per test)
        advancedSearchStore = {};

        // Mock Output Channel (FlowbabyClient uses the singleton output channel)
        const mockOutputChannel: vscode.LogOutputChannel = {
            name: 'Flowbaby',
            logLevel: vscode.LogLevel.Info,
            onDidChangeLogLevel: new vscode.EventEmitter<vscode.LogLevel>().event,
            appendLine: () => undefined,
            append: () => undefined,
            replace: () => undefined,
            clear: () => undefined,
            show: () => undefined,
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            trace: sandbox.stub(),
            debug: sandbox.stub(),
            info: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub()
        };
        sandbox.stub(vscode.window, 'createOutputChannel').returns(mockOutputChannel);

        // Mock VS Code configuration lookup
        const flowbabyConfigStore: ConfigStore = {
            // Avoid real daemon usage in unit tests
            bridgeMode: 'spawn',
            // Keep logs quiet unless explicitly testing logging
            debugLogging: false,
            // Let detectPythonInterpreter pick python3 on Unix
            pythonPath: ''
        };

        const rankingConfigStore: ConfigStore = {};
        const sessionConfigStore: ConfigStore = { enabled: false };

        sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
            if (section === 'Flowbaby') {return makeConfig(flowbabyConfigStore);}
            if (section === 'Flowbaby.ranking') {return makeConfig(rankingConfigStore);}
            if (section === 'Flowbaby.sessionManagement') {return makeConfig(sessionConfigStore);}
            if (section === 'Flowbaby.advancedSearch') {return makeConfig(advancedSearchStore);}
            return makeConfig({});
        });

        // validatePythonVersion() calls execFileSync(pythonPath, ['--version'], ...)
        sandbox.stub(FlowbabyClient.prototype as any, 'execFileSync').returns('Python 3.11.0');
    });

    teardown(() => {
        sandbox.restore();
    });

    const makeClient = () => {
        const mockContext = {
            secrets: {
                get: sandbox.stub().resolves(undefined),
                store: sandbox.stub().resolves(),
                delete: sandbox.stub().resolves(),
                onDidChange: new vscode.EventEmitter().event
            },
            subscriptions: [],
            extensionUri: vscode.Uri.file('/mock/extension'),
            asAbsolutePath: (p: string) => path.join('/mock/extension', p)
        } as unknown as vscode.ExtensionContext;

        return new FlowbabyClient('/test/workspace', mockContext);
    };

    test('retrieve payload includes configured advanced search settings', async () => {
        advancedSearchStore = {
            wideSearchTopK: 222,
            tripletDistancePenalty: 4.5
        };

        const client = makeClient();

        const runPythonScriptStub = sandbox.stub(client as any, 'runPythonScript').callsFake(
            async (...callArgs: any[]) => {
                const args = callArgs[1] as string[];

                assert.strictEqual(args[0], '--json');
                const payload = JSON.parse(args[1]);

                assert.strictEqual(payload.wide_search_top_k, 222);
                assert.strictEqual(payload.triplet_distance_penalty, 4.5);

                return {
                    success: true,
                    results: [],
                    result_count: 0
                };
            }
        );

        await client.retrieve('test query');
        assert.ok(runPythonScriptStub.called, 'Expected retrieve() to invoke runPythonScript()');
    });

    test('retrieve payload falls back to defaults when settings are unset', async () => {
        advancedSearchStore = {};

        const client = makeClient();

        const runPythonScriptStub = sandbox.stub(client as any, 'runPythonScript').callsFake(
            async (...callArgs: any[]) => {
                const args = callArgs[1] as string[];

                assert.strictEqual(args[0], '--json');
                const payload = JSON.parse(args[1]);

                assert.strictEqual(payload.wide_search_top_k, 150);
                assert.strictEqual(payload.triplet_distance_penalty, 3.0);

                return {
                    success: true,
                    results: [],
                    result_count: 0
                };
            }
        );

        await client.retrieve('test query');
        assert.ok(runPythonScriptStub.called, 'Expected retrieve() to invoke runPythonScript()');
    });
});
