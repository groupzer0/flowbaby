import * as path from 'path';
import Mocha = require('mocha');
import { globSync } from 'glob';

export function run(): Promise<void> {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd',
		color: true,
		timeout: 10000, // 10 seconds timeout for tests
		reporter: 'spec' // Use spec reporter for clear output
	});

	const testsRoot = path.resolve(__dirname, '.');

	return new Promise((resolve, reject) => {
		try {
			// Find all test files (excluding test-agent-scenarios which requires special runner)
			const files = globSync('**/**.test.js', { cwd: testsRoot, ignore: ['**/test-agent-scenarios.test.js'] });

			// Add files to the test suite
			files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

			// Run the mocha test
			mocha.run((failures: number) => {
				if (failures > 0) {
					reject(new Error(`${failures} tests failed.`));
				} else {
					resolve();
				}
			});
		} catch (err) {
			console.error('Error running tests:', err);
			reject(err);
		}
	});
}
