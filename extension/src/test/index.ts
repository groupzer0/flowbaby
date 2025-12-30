import * as path from 'path';
import Mocha = require('mocha');
import { globSync } from 'glob';
import * as vscode from 'vscode';

function patchUriHandlerRegistrationForTests(): void {
	if (process.env.NODE_ENV !== 'test') {
		return;
	}

	const windowAny = vscode.window as unknown as {
		registerUriHandler?: (handler: vscode.UriHandler) => vscode.Disposable;
	};

	const original = windowAny.registerUriHandler;
	if (typeof original !== 'function') {
		return;
	}

	const safeRegister = (handler: vscode.UriHandler): vscode.Disposable => {
		try {
			return original(handler);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.toLowerCase().includes('protocol handler already registered')) {
				return new vscode.Disposable(() => undefined);
			}
			throw error;
		}
	};

	try {
		Object.defineProperty(vscode.window as unknown as object, 'registerUriHandler', {
			value: safeRegister,
			writable: true,
			configurable: true,
		});
	} catch {
		try {
			(windowAny as unknown as { registerUriHandler: typeof safeRegister }).registerUriHandler = safeRegister;
		} catch {
			// If patching fails (API is non-writable), tests may still fail due to duplicate registration.
		}
	}
}

export function run(): Promise<void> {
    process.env.FLOWBABY_SUPPRESS_PROMPTS = process.env.FLOWBABY_SUPPRESS_PROMPTS ?? 'true';
    process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
	patchUriHandlerRegistrationForTests();

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
