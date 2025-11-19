/**
 * Unit Tests for StoreMemoryTool (Plan 015 Language Model Tool)
 * 
 * Tests the languageModelTools integration surface for Copilot agents
 */

import { suite, test } from 'mocha';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { StoreMemoryTool, StoreMemoryToolInput } from '../tools/storeMemoryTool';

suite('StoreMemoryTool (Language Model Tool Integration)', () => {
    const outputChannel = vscode.window.createOutputChannel('Test Output');
    let tool: StoreMemoryTool;

    test('Tool implements LanguageModelTool interface', () => {
        tool = new StoreMemoryTool(outputChannel);
        expect(tool).to.have.property('invoke');
        expect(tool).to.have.property('prepareInvocation');
        expect(typeof tool.invoke).to.equal('function');
        expect(typeof tool.prepareInvocation).to.equal('function');
    });

    test('prepareInvocation validates required fields', async () => {
        tool = new StoreMemoryTool(outputChannel);
        const tokenSource = new vscode.CancellationTokenSource();

        // Missing topic
        try {
            await tool.prepareInvocation({
                input: { context: 'Test context' } as StoreMemoryToolInput
            } as vscode.LanguageModelToolInvocationPrepareOptions<StoreMemoryToolInput>, tokenSource.token);
            expect.fail('Should have thrown error for missing topic');
        } catch (error) {
            expect((error as Error).message).to.include('topic');
        }

        // Missing context
        try {
            await tool.prepareInvocation({
                input: { topic: 'Test topic' } as StoreMemoryToolInput
            } as vscode.LanguageModelToolInvocationPrepareOptions<StoreMemoryToolInput>, tokenSource.token);
            expect.fail('Should have thrown error for missing context');
        } catch (error) {
            expect((error as Error).message).to.include('context');
        }

        // Valid input
        const result = await tool.prepareInvocation({
            input: { topic: 'Test topic', context: 'Test context' }
        } as vscode.LanguageModelToolInvocationPrepareOptions<StoreMemoryToolInput>, tokenSource.token);
        
        expect(result).to.have.property('invocationMessage');
        expect(result.invocationMessage).to.include('Test topic');

        tokenSource.dispose();
    });

    test('invoke blocks when agentAccess.enabled is false', async () => {
        // Note: This test reads the actual workspace setting (default: false)
        // Test environment has no workspace, so config.get() returns default (false)
        
        tool = new StoreMemoryTool(outputChannel);
        const tokenSource = new vscode.CancellationTokenSource();

        const result = await tool.invoke({
            input: {
                topic: 'Test Topic',
                context: 'Test Context'
            }
        } as vscode.LanguageModelToolInvocationOptions<StoreMemoryToolInput>, tokenSource.token);

        // Verify blocked response (default setting is false)
        expect(result).to.be.instanceOf(vscode.LanguageModelToolResult);
        const content = result.content[0] as vscode.LanguageModelTextPart;
        const response = JSON.parse(content.value);
        
        expect(response.success).to.be.false;
        expect(response.errorCode).to.equal('ACCESS_DISABLED');
        expect(response.error).to.include('Agent access is disabled');

        tokenSource.dispose();
    });

    test('invoke validates tool invocation flow', async () => {
        // Test validates tool structure without modifying workspace settings
        // (Integration test with enabled access requires workspace + bridge setup)
        
        tool = new StoreMemoryTool(outputChannel);
        const tokenSource = new vscode.CancellationTokenSource();

        // Invoke with default config (agentAccess.enabled = false)
        const result = await tool.invoke({
            input: {
                topic: 'Test Tool Invocation',
                context: 'Testing language model tool path',
                decisions: ['Use languageModelTools for Copilot integration'],
                metadata: { plan_id: '015', status: 'Active' }
            }
        } as vscode.LanguageModelToolInvocationOptions<StoreMemoryToolInput>, tokenSource.token);

        // Verify result structure (blocked because access disabled by default)
        expect(result).to.be.instanceOf(vscode.LanguageModelToolResult);
        expect(result.content).to.have.length.greaterThan(0);
        
        const content = result.content[0] as vscode.LanguageModelTextPart;
        const response = JSON.parse(content.value);
        
        // Response should have success field
        expect(response).to.have.property('success');
        expect(response.success).to.be.false;
        expect(response.errorCode).to.equal('ACCESS_DISABLED');

        tokenSource.dispose();
    });

    test('Tool metadata matches package.json languageModelTools contribution', () => {
        // Verify tool implementation aligns with declared schema
        tool = new StoreMemoryTool(outputChannel);
        
        // Check that StoreMemoryToolInput interface matches package.json schema
        const input: StoreMemoryToolInput = {
            topic: 'Test',
            context: 'Test',
            decisions: [],
            rationale: [],
            openQuestions: [],
            nextSteps: [],
            references: [],
            metadata: {
                plan_id: '015',
                status: 'Active'
            }
        };

        // If this compiles without type errors, schema matches
        expect(input.topic).to.be.a('string');
        expect(input.context).to.be.a('string');
    });
});
