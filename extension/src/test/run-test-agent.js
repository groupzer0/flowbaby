#!/usr/bin/env node
/**
 * Automated test runner for test-agent extension (Plan 015 Milestone 4)
 * 
 * Runs test-agent scenarios in a controlled VS Code environment
 * and reports results for CI integration
 */

const { runTests } = require('@vscode/test-electron');
const path = require('path');

async function main() {
    try {
        // Path to extension
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        
        // Path to test-agent extension
        const testAgentPath = path.resolve(__dirname, '../../../test-agent');
        
        // Path to test runner script
        const extensionTestsPath = path.resolve(__dirname, './test-agent-runner');

        console.log('Starting test-agent automated test suite...');
        console.log(`Extension path: ${extensionDevelopmentPath}`);
        console.log(`Test-agent path: ${testAgentPath}`);

        // Download VS Code, unzip it and run the test
        const exitCode = await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                '--disable-extensions', // Disable other extensions
                '--install-extension', testAgentPath // Install test-agent
            ]
        });

        console.log(`Test-agent completed with exit code: ${exitCode}`);
        process.exit(exitCode);
    } catch (err) {
        console.error('Failed to run test-agent tests:', err);
        process.exit(1);
    }
}

main();
