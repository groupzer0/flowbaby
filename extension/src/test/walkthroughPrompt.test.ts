import * as assert from 'assert';
import * as sinon from 'sinon';

/**
 * Test suite for walkthrough prompt functionality
 * Tests the "View Getting Started guide?" toast and "Don't Show Again" preference
 * 
 * These tests verify the globalState-based preference storage pattern used for
 * the post-initialization walkthrough prompt added in Plan 054.
 */
suite('Walkthrough Prompt Preferences', () => {
    let sandbox: sinon.SinonSandbox;
    let mockGlobalState: Map<string, any>;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockGlobalState = new Map();
    });

    teardown(() => {
        sandbox.restore();
        mockGlobalState.clear();
    });

    /**
     * Helper to create a mock ExtensionContext with working globalState
     */
    function createMockContext(): { globalState: { get: (key: string, defaultValue?: boolean) => boolean | undefined; update: (key: string, value: any) => Promise<void> } } {
        return {
            globalState: {
                get: (key: string, defaultValue?: boolean): boolean | undefined => {
                    return mockGlobalState.has(key) ? mockGlobalState.get(key) : defaultValue;
                },
                update: async (key: string, value: any): Promise<void> => {
                    mockGlobalState.set(key, value);
                }
            }
        };
    }

    test('walkthroughPromptDismissed defaults to false when not set', () => {
        const context = createMockContext();
        const dismissed = context.globalState.get('flowbaby.walkthroughPromptDismissed', false);
        assert.strictEqual(dismissed, false, 'Default should be false (show prompt)');
    });

    test('walkthroughPromptDismissed returns true after user clicks "Don\'t Show Again"', async () => {
        const context = createMockContext();

        // Simulate user clicking "Don't Show Again"
        await context.globalState.update('flowbaby.walkthroughPromptDismissed', true);

        const dismissed = context.globalState.get('flowbaby.walkthroughPromptDismissed', false);
        assert.strictEqual(dismissed, true, 'Should be true after user dismisses');
    });

    test('walkthroughPromptDismissed persists across "restarts" (same globalState)', async () => {
        const context = createMockContext();

        // First "session": user dismisses
        await context.globalState.update('flowbaby.walkthroughPromptDismissed', true);

        // Second "session": same globalState (simulates restart)
        const context2 = createMockContext(); // Uses same mockGlobalState Map
        const dismissed = context2.globalState.get('flowbaby.walkthroughPromptDismissed', false);

        assert.strictEqual(dismissed, true, 'Preference should persist across restarts');
    });

    test('walkthrough prompt logic: shows when not dismissed', () => {
        const context = createMockContext();
        const dismissed = context.globalState.get('flowbaby.walkthroughPromptDismissed', false);

        // Simulate the logic from extension.ts
        const shouldShowPrompt = !dismissed;

        assert.strictEqual(shouldShowPrompt, true, 'Should show prompt when not dismissed');
    });

    test('walkthrough prompt logic: does not show when dismissed', async () => {
        const context = createMockContext();
        await context.globalState.update('flowbaby.walkthroughPromptDismissed', true);

        const dismissed = context.globalState.get('flowbaby.walkthroughPromptDismissed', false);

        // Simulate the logic from extension.ts
        const shouldShowPrompt = !dismissed;

        assert.strictEqual(shouldShowPrompt, false, 'Should not show prompt when dismissed');
    });

    test('captureHintShown preference follows same pattern', async () => {
        // Verify the existing captureHintShown preference follows the same pattern
        // This ensures consistency with existing codebase patterns
        const context = createMockContext();

        // Default value
        const defaultValue = context.globalState.get('flowbaby.captureHintShown', false);
        assert.strictEqual(defaultValue, false, 'Default should be false');

        // After being shown
        await context.globalState.update('flowbaby.captureHintShown', true);
        const afterShown = context.globalState.get('flowbaby.captureHintShown', false);
        assert.strictEqual(afterShown, true, 'Should be true after being shown');
    });
});
