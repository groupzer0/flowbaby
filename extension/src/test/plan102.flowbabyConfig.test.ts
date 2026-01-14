import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

import * as flowbabyConfig from '../config/flowbabyConfig';

type ConfigStore = Record<string, unknown>;

const makeConfig = (store: ConfigStore) => ({
    get: (key: string, defaultValue?: unknown) => {
        return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : defaultValue;
    }
}) as unknown as vscode.WorkspaceConfiguration;

suite('Plan 102 flowbabyConfig', () => {
    let sandbox: sinon.SinonSandbox;

    let flowbabyStore: ConfigStore;
    let rankingStore: ConfigStore;
    let advancedSearchStore: ConfigStore;
    let sessionStore: ConfigStore;
    let synthesisStore: ConfigStore;
    let cloudStore: ConfigStore;
    let notificationsStore: ConfigStore;

    setup(() => {
        sandbox = sinon.createSandbox();

        flowbabyStore = {};
        rankingStore = {};
        advancedSearchStore = {};
        sessionStore = {};
        synthesisStore = {};
        cloudStore = {};
        notificationsStore = {};

        sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
            if (section === 'Flowbaby') {return makeConfig(flowbabyStore);}
            if (section === 'Flowbaby.ranking') {return makeConfig(rankingStore);}
            if (section === 'Flowbaby.advancedSearch') {return makeConfig(advancedSearchStore);}
            if (section === 'Flowbaby.sessionManagement') {return makeConfig(sessionStore);}
            if (section === 'Flowbaby.synthesis') {return makeConfig(synthesisStore);}
            if (section === 'flowbaby.cloud') {return makeConfig(cloudStore);}
            if (section === 'flowbaby.notifications') {return makeConfig(notificationsStore);}
            if (section === 'flowbaby') {return makeConfig(flowbabyStore);}
            return makeConfig({});
        });
    });

    teardown(() => {
        sandbox.restore();
        delete process.env.FLOWBABY_CLOUD_API_URL;
    });

    test('getRankingHalfLifeDays clamps to [0.5, 90]', () => {
        rankingStore = { halfLifeDays: 0.1 };
        assert.strictEqual(flowbabyConfig.getRankingHalfLifeDays(), 0.5);

        rankingStore = { halfLifeDays: 100 };
        assert.strictEqual(flowbabyConfig.getRankingHalfLifeDays(), 90);

        rankingStore = { halfLifeDays: 7 };
        assert.strictEqual(flowbabyConfig.getRankingHalfLifeDays(), 7);
    });

    test('getDaemonIdleTimeoutMinutes clamps to [1, 60]', () => {
        flowbabyStore = { daemonIdleTimeoutMinutes: 0 };
        assert.strictEqual(flowbabyConfig.getDaemonIdleTimeoutMinutes(), 1);

        flowbabyStore = { daemonIdleTimeoutMinutes: 999 };
        assert.strictEqual(flowbabyConfig.getDaemonIdleTimeoutMinutes(), 60);

        flowbabyStore = { daemonIdleTimeoutMinutes: 30 };
        assert.strictEqual(flowbabyConfig.getDaemonIdleTimeoutMinutes(), 30);
    });

    test('getLogLevel normalizes invalid values to info', () => {
        flowbabyStore = { logLevel: 'debug' };
        assert.strictEqual(flowbabyConfig.getLogLevel(), 'debug');

        flowbabyStore = { logLevel: 'DEBUG' };
        assert.strictEqual(flowbabyConfig.getLogLevel(), 'info');

        flowbabyStore = { logLevel: 'nope' };
        assert.strictEqual(flowbabyConfig.getLogLevel(), 'info');

        flowbabyStore = {};
        assert.strictEqual(flowbabyConfig.getLogLevel(), 'info');
    });

    test('getBridgeMode returns spawn only when explicitly set', () => {
        flowbabyStore = { bridgeMode: 'spawn' };
        assert.strictEqual(flowbabyConfig.getBridgeMode(), 'spawn');

        flowbabyStore = { bridgeMode: 'daemon' };
        assert.strictEqual(flowbabyConfig.getBridgeMode(), 'daemon');

        flowbabyStore = { bridgeMode: 'unknown' };
        assert.strictEqual(flowbabyConfig.getBridgeMode(), 'daemon');

        flowbabyStore = {};
        assert.strictEqual(flowbabyConfig.getBridgeMode(), 'daemon');
    });

    test('getCloudApiEndpoint uses precedence: setting > env var > default', () => {
        cloudStore = { apiEndpoint: '  https://example.test  ' };
        assert.strictEqual(flowbabyConfig.getCloudApiEndpoint(), 'https://example.test');

        cloudStore = { apiEndpoint: '' };
        process.env.FLOWBABY_CLOUD_API_URL = 'https://env.test';
        assert.strictEqual(flowbabyConfig.getCloudApiEndpoint(), 'https://env.test');

        cloudStore = { apiEndpoint: '' };
        delete process.env.FLOWBABY_CLOUD_API_URL;
        assert.strictEqual(flowbabyConfig.getCloudApiEndpoint(), 'https://api.flowbaby.ai');
    });

    test('getRetrievalConfig aggregates retrieval-related values', () => {
        flowbabyStore = {
            maxContextResults: 9,
            maxContextTokens: 123,
            searchTopK: 42
        };
        rankingStore = { halfLifeDays: 0.1 };
        advancedSearchStore = {
            wideSearchTopK: 222,
            tripletDistancePenalty: 4.5
        };

        const cfg = flowbabyConfig.getRetrievalConfig();
        assert.deepStrictEqual(cfg, {
            maxContextResults: 9,
            maxContextTokens: 123,
            searchTopK: 42,
            halfLifeDays: 0.5,
            wideSearchTopK: 222,
            tripletDistancePenalty: 4.5
        });
    });

    test('agent access constants are hardcoded architectural limits', () => {
        const cfg = flowbabyConfig.getAgentAccessConfig();
        assert.deepStrictEqual(cfg, {
            maxConcurrentRequests: 5,
            maxQueueSize: 5,
            rateLimitPerMinute: 30
        });
    });
});
