import { expect } from 'chai';
import * as vscode from 'vscode';
import {
    __resetRegistrationHelperStateForTests,
    safePush,
    setActiveContext,
    setExtensionActive,
    getActivationLedgerSnapshot,
    recordPromptEvent
} from '../lifecycle/registrationHelper';

class FakeSubscriptions {
    public disposables: vscode.Disposable[] = [];
    public _isDisposed = false;

    push(disposable: vscode.Disposable) {
        if (this._isDisposed) {
            throw new Error('disposed');
        }
        this.disposables.push(disposable);
    }
}

function createFakeContext(subscriptions: FakeSubscriptions): vscode.ExtensionContext {
    return {
        subscriptions
    } as unknown as vscode.ExtensionContext;
}

suite('registrationHelper – Plan 052 lifecycle and diagnostics', () => {
    setup(() => {
        process.env.NODE_ENV = 'test';
        __resetRegistrationHelperStateForTests();
    });

    test('logs a registration event for successful safePush and records first registration timestamp', () => {
        const subs = new FakeSubscriptions();
        const ctx = createFakeContext(subs);
        setExtensionActive(true);
        setActiveContext(ctx);

        const disposable = new vscode.Disposable(() => undefined);
        safePush(ctx, disposable, { intent: { kind: 'command', id: 'test.command' } });

        expect(subs.disposables.length).to.be.greaterThan(0);
        expect(subs.disposables.includes(disposable)).to.equal(true);
        const snapshot = getActivationLedgerSnapshot();
        expect(snapshot).to.not.be.undefined;
        if (snapshot) {
            const registrationEvents = snapshot.events.filter(e => e.eventType === 'registration' && (e.details as any)?.details?.result === 'pushed');
            expect(registrationEvents.length).to.be.greaterThan(0);
            const lastRegistration = registrationEvents[registrationEvents.length - 1];
            expect((lastRegistration.details as any)?.details?.intent?.id).to.equal('test.command');
            expect(snapshot.latest.firstRegistrationAt).to.be.a('number');
        }
    });

    test('emits an anomaly event and uses fallback when context subscriptions are disposed', () => {
        const subs = new FakeSubscriptions();
        subs._isDisposed = true;
        const ctx = createFakeContext(subs);
        setExtensionActive(true);
        setActiveContext(ctx);

        const disposable = new vscode.Disposable(() => undefined);
        safePush(ctx, disposable, { intent: { kind: 'command', id: 'test.disposed' } });

        const snapshot = getActivationLedgerSnapshot();
        expect(snapshot).to.not.be.undefined;
        if (snapshot) {
            const anomalyEvents = snapshot.events.filter(e => e.eventType === 'anomaly');
            expect(anomalyEvents.length).to.be.greaterThan(0);
            const firstAnomaly = anomalyEvents[0];
            expect(firstAnomaly.contextState?.disposed).to.equal(true);
            expect(firstAnomaly.contextState?.fallbackUsed).to.equal(true);
        }
    });

    test('records prompt events with mode metadata', () => {
        const subs = new FakeSubscriptions();
        const ctx = createFakeContext(subs);
        setExtensionActive(true);
        setActiveContext(ctx);

        recordPromptEvent('test_prompt', 'scheduled', { source: 'unit_test' });

        const snapshot = getActivationLedgerSnapshot();
        expect(snapshot).to.not.be.undefined;
        if (snapshot) {
            const promptEvents = snapshot.events.filter(e => e.eventType === 'prompt');
            expect(promptEvents.length).to.be.greaterThan(0);
            expect(promptEvents[0].details?.mode).to.equal('scheduled');
            expect(promptEvents[0].details?.reason).to.equal('test_prompt');
            expect(promptEvents[0].details?.source).to.equal('unit_test');
        }
    });
});
