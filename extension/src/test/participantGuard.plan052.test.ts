import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
    __resetRegistrationHelperStateForTests,
    isParticipantRegistered,
    setParticipantRegistered
} from '../lifecycle/registrationHelper';

// Focused Plan 052 test: verify that "agent already has implementation" from
// createChatParticipant is treated as a host-participant-present guard signal.

suite('Plan 052: host-aware participant guard', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        process.env.NODE_ENV = 'test';
        __resetRegistrationHelperStateForTests();
    });

    teardown(() => {
        sandbox.restore();
        __resetRegistrationHelperStateForTests();
    });

    test('host duplication error marks participant as present without re-registering', async () => {
        // Arrange: simulate createChatParticipant throwing host duplication error
        const flowbabyError = new Error('Agent already has implementation: "flowbaby"');
        const createStub = sandbox
            .stub(vscode.chat, 'createChatParticipant')
            .throws(flowbabyError);

        // Import after stubbing so registerFlowbabyParticipant picks up stubbed API
        const extensionMod = await import('../extension');
        const registerFlowbabyParticipant = (extensionMod as any).registerFlowbabyParticipant as
            | ((ctx: vscode.ExtensionContext) => void)
            | undefined;

        expect(registerFlowbabyParticipant).to.be.a('function');
        expect(isParticipantRegistered()).to.equal(false);

        const fakeContext = { subscriptions: [] } as unknown as vscode.ExtensionContext;

        // Act: attempt to register participant via the focused helper
        registerFlowbabyParticipant!(fakeContext);

        // Assert: guard should treat host error as evidence of existing participant
        expect(isParticipantRegistered()).to.equal(true, 'participantRegistered flag should be set');
        expect(createStub.calledOnce).to.equal(true, 'createChatParticipant should have been invoked once');

        // Cleanup explicit to avoid leaking guard state across tests
        setParticipantRegistered(false);
    });
});
