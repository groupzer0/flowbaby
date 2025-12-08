import { expect } from 'chai';
import * as sinon from 'sinon';
import {
    areToolsRegistered,
    isParticipantRegistered,
    setToolsRegistered,
    setParticipantRegistered,
    setExtensionActive,
    isActive,
    __resetRegistrationHelperStateForTests
} from '../lifecycle/registrationHelper';

suite('Plan 052: double activation guard', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        __resetRegistrationHelperStateForTests();
    });

    teardown(() => {
        sandbox.restore();
        __resetRegistrationHelperStateForTests();
    });

    test('registration guards prevent double registration', () => {
        // Initially not registered
        expect(areToolsRegistered()).to.equal(false);
        expect(isParticipantRegistered()).to.equal(false);

        // First registration succeeds
        setToolsRegistered(true);
        setParticipantRegistered(true);

        expect(areToolsRegistered()).to.equal(true);
        expect(isParticipantRegistered()).to.equal(true);

        // Second registration attempts should see guards are already set
        // In real code, these guards prevent calling vscode.lm.registerTool again
        const shouldSkipToolReg = areToolsRegistered();
        const shouldSkipParticipantReg = isParticipantRegistered();

        expect(shouldSkipToolReg).to.equal(true, 'Guard should prevent second tool registration');
        expect(shouldSkipParticipantReg).to.equal(true, 'Guard should prevent second participant registration');
    });

    test('activation guard tracks extension active state', () => {
        expect(isActive()).to.equal(false);

        setExtensionActive(true);
        expect(isActive()).to.equal(true);

        // Second activation should see isActive=true and skip
        const wasActive = isActive();
        expect(wasActive).to.equal(true, 'Should detect already active');

        setExtensionActive(false);
        expect(isActive()).to.equal(false);
    });

    test('reset function clears all state for test isolation', () => {
        setExtensionActive(true);
        setToolsRegistered(true);
        setParticipantRegistered(true);

        __resetRegistrationHelperStateForTests();

        expect(isActive()).to.equal(false);
        expect(areToolsRegistered()).to.equal(false);
        expect(isParticipantRegistered()).to.equal(false);
    });
});
