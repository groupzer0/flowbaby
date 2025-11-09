#!/usr/bin/env node

/**
 * Simple test script for CogneeClient
 * 
 * Tests initialize(), ingest(), and retrieve() methods
 */

// Mock vscode module for Node.js testing
const vscode = {
    workspace: {
        getConfiguration: (section) => {
            return {
                get: (key, defaultValue) => {
                    // Return default values for all settings
                    if (key === 'pythonPath') return '.venv/bin/python';
                    if (key === 'maxContextResults') return 3;
                    if (key === 'maxContextTokens') return 2000;
                    if (key === 'recencyWeight') return 0.3;
                    if (key === 'importanceWeight') return 0.2;
                    if (key === 'logLevel') return 'debug';
                    if (key === 'enabled') return true;
                    return defaultValue;
                }
            };
        }
    },
    window: {
        createOutputChannel: (name) => {
            return {
                appendLine: (line) => {
                    console.log(`[OUTPUT CHANNEL: ${name}] ${line}`);
                }
            };
        },
        showWarningMessage: (message) => {
            console.warn(`[WARNING] ${message}`);
        }
    }
};

// Inject mock vscode module
global.vscode = vscode;

// Import CogneeClient after mocking vscode
const { CogneeClient } = require('../dist/extension.js');

async function testCogneeClient() {
    console.log('=== CogneeClient Integration Test ===\n');

    const workspacePath = '/home/luke/Documents/Github-projects/cognee';
    
    try {
        // Test 1: Create client
        console.log('Test 1: Creating CogneeClient...');
        const client = new CogneeClient(workspacePath);
        console.log('✓ CogneeClient created\n');

        // Test 2: Initialize
        console.log('Test 2: Initializing Cognee...');
        const initialized = await client.initialize();
        console.log(`✓ Initialize result: ${initialized}\n`);

        if (!initialized) {
            console.error('✗ Initialization failed, stopping tests');
            process.exit(1);
        }

        // Test 3: Ingest conversation
        console.log('Test 3: Ingesting test conversation...');
        const ingested = await client.ingest(
            'How do I test TypeScript-Python integration?',
            'You can create a Node.js test script that mocks the vscode module and calls the CogneeClient methods directly.',
            0.5
        );
        console.log(`✓ Ingest result: ${ingested}\n`);

        // Test 4: Retrieve context
        console.log('Test 4: Retrieving context...');
        const contexts = await client.retrieve('TypeScript integration testing');
        console.log(`✓ Retrieved ${contexts.length} contexts:`);
        contexts.forEach((ctx, i) => {
            console.log(`  ${i + 1}. ${ctx.substring(0, 100)}...`);
        });
        console.log();

        // Test 5: Check if enabled
        console.log('Test 5: Checking if enabled...');
        const enabled = client.isEnabled();
        console.log(`✓ Enabled: ${enabled}\n`);

        // Test 6: Validate configuration
        console.log('Test 6: Validating configuration...');
        const validation = await client.validateConfiguration();
        console.log(`✓ Valid: ${validation.valid}`);
        if (validation.errors.length > 0) {
            console.log(`  Errors: ${validation.errors.join(', ')}`);
        }
        console.log();

        console.log('=== All Tests Passed ===');
    } catch (error) {
        console.error('✗ Test failed:', error);
        process.exit(1);
    }
}

testCogneeClient();
