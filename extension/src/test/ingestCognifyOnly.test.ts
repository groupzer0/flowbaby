import * as assert from 'assert';
import * as path from 'path';
import { spawnSync } from 'child_process';

function pickPythonCommandForTest(): string | null {
    const candidates = process.platform === 'win32'
        ? ['python', 'py']
        : ['python3', 'python'];

    for (const cmd of candidates) {
        const probe = spawnSync(cmd, ['--version'], { encoding: 'utf-8' });
        if (probe.status === 0) {
            return cmd;
        }
    }
    return null;
}

suite('Ingest Script Cognify-Only Mode', () => {
    const ingestScriptPath = path.resolve(__dirname, '../../bridge/ingest.py');
    const workspacePath = path.resolve(__dirname, '../../..'); // Root of repo

    test('cognify-only mode should fail gracefully without API key (not crash)', function () {
        // We expect it to fail because we aren't providing an API key,
        // BUT we expect it to fail with a JSON error, not a python crash (exit code 1 + traceback).
        // The bug was that it crashed with UnboundLocalError before even checking API key.

        const pythonCmd = pickPythonCommandForTest();
        if (!pythonCmd) {
            this.skip();
            return;
        }
        
        const result = spawnSync(pythonCmd, [
            ingestScriptPath,
            '--mode', 'cognify-only',
            '--operation-id', '123e4567-e89b-12d3-a456-426614174000',
            workspacePath
        ], {
            encoding: 'utf-8',
            env: { ...process.env, LLM_API_KEY: '' } // Ensure no API key to trigger graceful failure path
        });

        // It should exit with code 1 (error) but print a JSON error, not a traceback
        assert.strictEqual(result.status, 1, 'Script should exit with error code 1');
        
        // Check stdout/stderr for JSON error
        const output = result.stdout + result.stderr;
        console.log('Script output:', output);

        // Should NOT contain UnboundLocalError
        assert.ok(!output.includes('UnboundLocalError'), 'Script crashed with UnboundLocalError');
        
        // Should contain MISSING_API_KEY error code
        assert.ok(output.includes('MISSING_API_KEY'), 'Script did not report MISSING_API_KEY error');
    });
});
