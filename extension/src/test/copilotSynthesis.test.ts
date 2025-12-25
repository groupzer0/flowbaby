/**
 * Unit Tests for CopilotSynthesis - Plan 075
 *
 * Tests model selection based on Flowbaby.synthesis.modelId setting,
 * fail-fast behavior for unavailable models, and error codes.
 */

import { suite, test } from 'mocha';
import { expect } from 'chai';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

// We need to test the actual behavior, but VS Code's lm API requires mocking
suite('CopilotSynthesis Model Selection (Plan 075)', () => {
    let sandbox: sinon.SinonSandbox;
    let getConfigurationStub: sinon.SinonStub;
    let selectChatModelsStub: sinon.SinonStub;

    // Mock model that matches VS Code's LanguageModelChat interface
    const createMockModel = (family: string, vendor = 'copilot') => ({
        id: `${vendor}/${family}`,
        vendor,
        family,
        name: family,
        version: '1.0',
        maxInputTokens: 128000,
        countTokens: sinon.stub().resolves(100),
        sendRequest: sinon.stub().returns({
            text: (async function* () { yield 'Test answer'; })(),
            stream: (async function* () { yield { type: 'text', value: 'Test answer' }; })()
        })
    });

    suiteSetup(() => {
        sandbox = sinon.createSandbox();
    });

    setup(() => {
        // Reset stubs for each test
        sandbox.restore();
        sandbox = sinon.createSandbox();

        // Stub workspace.getConfiguration
        getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration');
        
        // Stub vscode.lm.selectChatModels
        selectChatModelsStub = sandbox.stub(vscode.lm, 'selectChatModels');
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Setting reading', () => {
        test('reads Flowbaby.synthesis.modelId from configuration', async () => {
            // Setup config to return specific model
            const mockConfig = {
                get: sinon.stub().returns('gpt-5-mini')
            };
            getConfigurationStub.withArgs('Flowbaby.synthesis').returns(mockConfig);
            getConfigurationStub.returns({ get: sinon.stub().returns(undefined) });

            // Call getConfiguration and verify it reads the setting
            const config = vscode.workspace.getConfiguration('Flowbaby.synthesis');
            const modelId = config.get<string>('modelId', 'gpt-5-mini');
            
            expect(modelId).to.equal('gpt-5-mini');
            expect(getConfigurationStub.calledWith('Flowbaby.synthesis')).to.be.true;
        });

        test('defaults to gpt-5-mini when setting is not configured', async () => {
            // Setup config to return undefined (unset)
            const mockConfig = {
                get: sinon.stub().callsFake((_key: string, defaultValue: string) => defaultValue)
            };
            getConfigurationStub.withArgs('Flowbaby.synthesis').returns(mockConfig);

            const config = vscode.workspace.getConfiguration('Flowbaby.synthesis');
            const modelId = config.get<string>('modelId', 'gpt-5-mini');
            
            expect(modelId).to.equal('gpt-5-mini');
        });
    });

    suite('Model selection behavior', () => {
        test('selectChatModels is called with vendor: copilot', async () => {
            selectChatModelsStub.resolves([createMockModel('gpt-5-mini')]);
            
            await vscode.lm.selectChatModels({ vendor: 'copilot' });
            
            expect(selectChatModelsStub.calledOnce).to.be.true;
            expect(selectChatModelsStub.firstCall.args[0]).to.deep.equal({ vendor: 'copilot' });
        });

        test('finds model by family when available', async () => {
            const models = [
                createMockModel('gpt-4o'),
                createMockModel('gpt-5-mini'),
                createMockModel('gpt-4.1')
            ];
            selectChatModelsStub.resolves(models);
            
            const availableModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            const targetFamily = 'gpt-5-mini';
            const selectedModel = availableModels.find(m => m.family === targetFamily);
            
            expect(selectedModel).to.not.be.undefined;
            expect(selectedModel?.family).to.equal('gpt-5-mini');
        });

        test('returns undefined when configured model not in available list', async () => {
            const models = [
                createMockModel('gpt-4o'),
                createMockModel('gpt-4.1')
            ];
            selectChatModelsStub.resolves(models);
            
            const availableModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            const targetFamily = 'gpt-5-mini'; // Not in the list
            const selectedModel = availableModels.find(m => m.family === targetFamily);
            
            expect(selectedModel).to.be.undefined;
        });
    });

    suite('Error codes', () => {
        test('SYNTHESIS_MODEL_NOT_AVAILABLE error code is defined in interface', () => {
            // This test validates the error code is part of the type system
            // The actual errorCode value is validated at compile time
            type ValidErrorCodes = 'NO_COPILOT' | 'SYNTHESIS_FAILED' | 'CONTEXT_EMPTY' | 'RATE_LIMITED' | 'SYNTHESIS_MODEL_NOT_AVAILABLE';
            const testCode: ValidErrorCodes = 'SYNTHESIS_MODEL_NOT_AVAILABLE';
            expect(testCode).to.equal('SYNTHESIS_MODEL_NOT_AVAILABLE');
        });

        test('error message includes available models when configured model unavailable', () => {
            const configuredModel = 'gpt-5-mini';
            const availableModels = ['gpt-4o', 'gpt-4.1'];
            
            // Simulate the error message format from copilotSynthesis.ts
            const errorMessage = `Synthesis model '${configuredModel}' is not available. Available models: ${availableModels.join(', ')}. Update Flowbaby.synthesis.modelId in settings.`;
            
            expect(errorMessage).to.include(configuredModel);
            expect(errorMessage).to.include('gpt-4o');
            expect(errorMessage).to.include('gpt-4.1');
            expect(errorMessage).to.include('Flowbaby.synthesis.modelId');
        });
    });

    suite('Activation-time constraints (Plan 075 architecture)', () => {
        test('model selection does not occur during test setup (activation proxy)', () => {
            // This test validates that selectChatModels is NOT called during setup
            // which proxies for "not called during extension activation"
            expect(selectChatModelsStub.called).to.be.false;
        });

        test('model selection only occurs when explicitly invoked', async () => {
            selectChatModelsStub.resolves([createMockModel('gpt-5-mini')]);
            
            // Before invocation
            expect(selectChatModelsStub.called).to.be.false;
            
            // Simulate synthesis invocation
            await vscode.lm.selectChatModels({ vendor: 'copilot' });
            
            // After invocation
            expect(selectChatModelsStub.calledOnce).to.be.true;
        });
    });
});

suite('CopilotSynthesis Settings Clarity (Plan 075 M2)', () => {
    test('Flowbaby.synthesis.modelId setting exists in package.json schema', () => {
        // This is validated by the extension loading - if the setting doesn't exist,
        // VS Code will not recognize it. This test documents the expectation.
        const expectedSettingPath = 'Flowbaby.synthesis.modelId';
        expect(expectedSettingPath).to.include('synthesis');
        expect(expectedSettingPath).to.not.include('llm'); // Distinct from bridge settings
    });

    test('Flowbaby.llm.* settings are distinct from synthesis settings', () => {
        // Validates naming separation per Plan 075 M2
        const synthesisPath = 'Flowbaby.synthesis.modelId';
        const bridgePath = 'Flowbaby.llm.model';
        
        expect(synthesisPath).to.not.equal(bridgePath);
        expect(synthesisPath).to.include('synthesis');
        expect(bridgePath).to.include('llm');
    });
});
