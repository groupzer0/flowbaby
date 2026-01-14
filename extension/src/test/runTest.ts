import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runTests } from '@vscode/test-electron';

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');

		// The path to the extension test script
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './index');

		// Create test workspace path (parent directory of extension)
		// This allows workspace configuration updates during testing
		const testWorkspace = path.resolve(extensionDevelopmentPath, '..');

		// Use an isolated VS Code user data dir so tests can run even if another
		// VS Code instance is open.
		const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowbaby-vscode-test-user-data-'));

		// Download VS Code, unzip it and run the integration test
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: [
				testWorkspace, // Open workspace for configuration tests
				'--disable-extensions', // Disable other extensions during testing
				`--user-data-dir=${userDataDir}`,
				'--disable-workspace-trust' // Disable workspace trust dialog
			]
		});
	} catch (err) {
		console.error('Failed to run tests:', err);
		process.exit(1);
	}
}

main();
