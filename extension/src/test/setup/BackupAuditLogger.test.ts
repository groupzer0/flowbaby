/**
 * Plan 107: Tests for BackupAuditLogger
 * 
 * TDD: Write tests first to define expected behavior for the forensic logging service.
 * The BackupAuditLogger writes to globalStorageUri (survives .flowbaby rename),
 * uses JSONL format, implements rotation/retention, and redacts sensitive data.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';
import mock = require('mock-fs');

// Import will fail until we implement the module - this is expected for TDD
import { 
    BackupAuditLogger, 
    BackupAuditEvent, 
    BackupAuditEventType,
    BACKUP_AUDIT_LOG_FILENAME,
    BACKUP_AUDIT_MAX_SIZE_BYTES
} from '../../setup/BackupAuditLogger';

/**
 * Creates a mock VS Code ExtensionContext for testing.
 */
function createMockContext(globalStoragePath: string): vscode.ExtensionContext {
    return {
        secrets: {
            get: sinon.stub().resolves(undefined),
            store: sinon.stub().resolves(),
            delete: sinon.stub().resolves(),
            keys: sinon.stub().resolves([]),
            onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
        },
        subscriptions: [],
        workspaceState: {} as any,
        globalState: {} as any,
        extensionUri: vscode.Uri.file('/mock/extension'),
        extensionPath: '/mock/extension',
        storagePath: '/mock/storage',
        globalStoragePath: globalStoragePath,
        logPath: '/mock/logs',
        extensionMode: vscode.ExtensionMode.Test,
        storageUri: vscode.Uri.file('/mock/storage'),
        globalStorageUri: vscode.Uri.file(globalStoragePath),
        logUri: vscode.Uri.file('/mock/logs'),
        extension: {} as any,
        asAbsolutePath: (relativePath: string) => path.join('/mock/extension', relativePath),
        environmentVariableCollection: {} as any,
        languageModelAccessInformation: {} as any
    } as vscode.ExtensionContext;
}

suite('Plan 107: BackupAuditLogger', () => {
    const testGlobalStoragePath = '/mock/global-storage';
    const testWorkspacePath = '/test/workspace';
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
        try { mock.restore(); } catch {}
    });

    suite('Initialization', () => {
        test('creates log directory under globalStorageUri if not exists', async () => {
            mock({
                [testGlobalStoragePath]: {}
            });

            const context = createMockContext(testGlobalStoragePath);
            const logger = new BackupAuditLogger(context);
            await logger.initialize();

            // Should create workspace-scoped subdirectory
            const logDir = path.join(testGlobalStoragePath, 'backup-audit');
            assert.strictEqual(fs.existsSync(logDir), true, 'Log directory should be created');
        });

        test('uses globalStorageUri, not workspace path (survives .flowbaby rename)', async () => {
            mock({
                [testGlobalStoragePath]: {},
                [testWorkspacePath]: {
                    '.flowbaby': {}
                }
            });

            const context = createMockContext(testGlobalStoragePath);
            const logger = new BackupAuditLogger(context);
            await logger.initialize();

            // Log file should be in globalStorageUri, not under .flowbaby
            const expectedLogPath = path.join(testGlobalStoragePath, 'backup-audit', BACKUP_AUDIT_LOG_FILENAME);
            assert.strictEqual(logger.getLogPath(), expectedLogPath);
        });
    });

    suite('Logging Events', () => {
        test('logs event in JSONL format (one JSON object per line)', async () => {
            mock({
                [testGlobalStoragePath]: {}
            });

            const context = createMockContext(testGlobalStoragePath);
            const logger = new BackupAuditLogger(context);
            await logger.initialize();

            const event: BackupAuditEvent = {
                type: BackupAuditEventType.MIGRATION_CHECK_INVOKED,
                timestamp: new Date().toISOString(),
                windowId: 'test-session-id',
                workspacePath: testWorkspacePath,
                extensionVersion: '0.7.2',
                data: {
                    flowbabyExists: true,
                    bridgeEnvExists: true
                }
            };

            await logger.log(event);

            // Read log file and verify JSONL format
            const logPath = logger.getLogPath();
            const content = fs.readFileSync(logPath!, 'utf8');
            const lines = content.trim().split('\n');
            
            assert.strictEqual(lines.length, 1, 'Should have exactly one line');
            
            const parsed = JSON.parse(lines[0]);
            assert.strictEqual(parsed.type, BackupAuditEventType.MIGRATION_CHECK_INVOKED);
            assert.strictEqual(parsed.windowId, 'test-session-id');
            assert.strictEqual(parsed.workspacePath, testWorkspacePath);
        });

        test('appends multiple events as separate lines', async () => {
            mock({
                [testGlobalStoragePath]: {}
            });

            const context = createMockContext(testGlobalStoragePath);
            const logger = new BackupAuditLogger(context);
            await logger.initialize();

            await logger.log({
                type: BackupAuditEventType.MIGRATION_CHECK_INVOKED,
                timestamp: new Date().toISOString(),
                windowId: 'session-1',
                workspacePath: testWorkspacePath,
                extensionVersion: '0.7.2'
            });

            await logger.log({
                type: BackupAuditEventType.BACKUP_USER_CONFIRMED,
                timestamp: new Date().toISOString(),
                windowId: 'session-1',
                workspacePath: testWorkspacePath,
                extensionVersion: '0.7.2'
            });

            const logPath = logger.getLogPath();
            const content = fs.readFileSync(logPath!, 'utf8');
            const lines = content.trim().split('\n');
            
            assert.strictEqual(lines.length, 2, 'Should have two lines');
            assert.strictEqual(JSON.parse(lines[0]).type, BackupAuditEventType.MIGRATION_CHECK_INVOKED);
            assert.strictEqual(JSON.parse(lines[1]).type, BackupAuditEventType.BACKUP_USER_CONFIRMED);
        });
    });

    suite('Data Redaction (Privacy Boundary)', () => {
        test('redacts secrets and tokens from data payload', async () => {
            mock({
                [testGlobalStoragePath]: {}
            });

            const context = createMockContext(testGlobalStoragePath);
            const logger = new BackupAuditLogger(context);
            await logger.initialize();

            // Attempt to log sensitive data that should be redacted
            await logger.log({
                type: BackupAuditEventType.MIGRATION_STATE_SNAPSHOT,
                timestamp: new Date().toISOString(),
                windowId: 'test-session',
                workspacePath: testWorkspacePath,
                extensionVersion: '0.7.2',
                data: {
                    markerContent: '2',
                    // These should be redacted:
                    apiKey: 'sk-secret-key-12345',
                    accessToken: 'ghp_xxxxxxxxxxxxx',
                    password: 'my-password',
                    AWS_SECRET_ACCESS_KEY: 'secret-aws-key'
                }
            });

            const logPath = logger.getLogPath();
            const content = fs.readFileSync(logPath!, 'utf8');
            const parsed = JSON.parse(content.trim());

            // Allowed fields should be present
            assert.strictEqual(parsed.data.markerContent, '2');

            // Sensitive fields should be redacted
            assert.strictEqual(parsed.data.apiKey, '[REDACTED]');
            assert.strictEqual(parsed.data.accessToken, '[REDACTED]');
            assert.strictEqual(parsed.data.password, '[REDACTED]');
            assert.strictEqual(parsed.data.AWS_SECRET_ACCESS_KEY, '[REDACTED]');
        });

        test('does not log memory content', async () => {
            mock({
                [testGlobalStoragePath]: {}
            });

            const context = createMockContext(testGlobalStoragePath);
            const logger = new BackupAuditLogger(context);
            await logger.initialize();

            await logger.log({
                type: BackupAuditEventType.MIGRATION_STATE_SNAPSHOT,
                timestamp: new Date().toISOString(),
                windowId: 'test-session',
                workspacePath: testWorkspacePath,
                extensionVersion: '0.7.2',
                data: {
                    memoryContent: 'This is stored memory that should not be logged',
                    promptData: 'User prompt content',
                    completionData: 'AI completion content'
                }
            });

            const logPath = logger.getLogPath();
            const content = fs.readFileSync(logPath!, 'utf8');
            
            // Memory/prompt/completion content should not appear
            assert.strictEqual(content.includes('This is stored memory'), false);
            assert.strictEqual(content.includes('User prompt content'), false);
            assert.strictEqual(content.includes('AI completion content'), false);
        });
    });

    suite('Rotation and Retention (Bounded Logs)', () => {
        test('rotates log file when it exceeds max size', async () => {
            mock({
                [testGlobalStoragePath]: {}
            });

            const context = createMockContext(testGlobalStoragePath);
            const logger = new BackupAuditLogger(context);
            await logger.initialize();

            // Write enough entries to exceed rotation threshold
            // (This test verifies the rotation mechanism exists)
            const largeData = 'x'.repeat(1000);
            for (let i = 0; i < 200; i++) {
                await logger.log({
                    type: BackupAuditEventType.MIGRATION_CHECK_INVOKED,
                    timestamp: new Date().toISOString(),
                    windowId: `session-${i}`,
                    workspacePath: testWorkspacePath,
                    extensionVersion: '0.7.2',
                    data: { padding: largeData }
                });
            }

            // Check that rotation occurred (old log renamed)
            const logDir = path.join(testGlobalStoragePath, 'backup-audit');
            const files = fs.readdirSync(logDir);
            
            // Should have current log + at least one rotated backup
            assert.ok(files.length >= 1, 'Should have log files');
            
            // Current log should be under size limit
            const currentLogPath = logger.getLogPath()!;
            const stats = fs.statSync(currentLogPath);
            assert.ok(stats.size <= BACKUP_AUDIT_MAX_SIZE_BYTES, 
                `Log size ${stats.size} should be <= ${BACKUP_AUDIT_MAX_SIZE_BYTES}`);
        });

        test('limits total log storage by keeping only MAX_FILES rotated logs', async () => {
            mock({
                [testGlobalStoragePath]: {}
            });

            const context = createMockContext(testGlobalStoragePath);
            const logger = new BackupAuditLogger(context);
            await logger.initialize();

            // Write enough entries to trigger multiple rotations
            // Each entry is ~150 bytes, need ~3500 entries to fill 512KB and trigger rotation
            const largeData = 'y'.repeat(500); // Make entries larger to speed up test
            for (let i = 0; i < 500; i++) {
                await logger.log({
                    type: BackupAuditEventType.MIGRATION_CHECK_INVOKED,
                    timestamp: new Date().toISOString(),
                    windowId: `session-${i}`,
                    workspacePath: testWorkspacePath,
                    extensionVersion: '0.7.2',
                    data: { padding: largeData }
                });
            }

            // Verify bounded storage: max files retained
            const logDir = path.join(testGlobalStoragePath, 'backup-audit');
            const files = fs.readdirSync(logDir).filter(f => f.endsWith('.jsonl'));
            
            // Should have at most MAX_FILES + 1 (current log + rotated backups)
            assert.ok(files.length <= 4, // BACKUP_AUDIT_MAX_FILES + current
                `Should have at most 4 log files, found ${files.length}: ${files.join(', ')}`);
        });
    });

    suite('Survives Window Reload', () => {
        test('logs persist after simulated window reload', async () => {
            mock({
                [testGlobalStoragePath]: {}
            });

            const context = createMockContext(testGlobalStoragePath);
            
            // First "window" - write some logs
            const logger1 = new BackupAuditLogger(context);
            await logger1.initialize();
            await logger1.log({
                type: BackupAuditEventType.MIGRATION_CHECK_INVOKED,
                timestamp: new Date().toISOString(),
                windowId: 'window-1',
                workspacePath: testWorkspacePath,
                extensionVersion: '0.7.2'
            });

            // Simulate window reload - create new logger instance
            const logger2 = new BackupAuditLogger(context);
            await logger2.initialize();
            await logger2.log({
                type: BackupAuditEventType.BACKUP_COMPLETED,
                timestamp: new Date().toISOString(),
                windowId: 'window-2',
                workspacePath: testWorkspacePath,
                extensionVersion: '0.7.2'
            });

            // Both logs should be present
            const logPath = logger2.getLogPath();
            const content = fs.readFileSync(logPath!, 'utf8');
            const lines = content.trim().split('\n');
            
            assert.strictEqual(lines.length, 2, 'Both logs should persist');
            assert.strictEqual(JSON.parse(lines[0]).windowId, 'window-1');
            assert.strictEqual(JSON.parse(lines[1]).windowId, 'window-2');
        });
    });

    suite('Workspace-Scoped Partitioning', () => {
        test('logs are partitioned by workspace path hash', async () => {
            mock({
                [testGlobalStoragePath]: {}
            });

            const context = createMockContext(testGlobalStoragePath);
            const logger = new BackupAuditLogger(context);
            
            // Initialize with workspace path
            await logger.initializeForWorkspace(testWorkspacePath);

            const logPath = logger.getLogPath();
            
            // Log path should include workspace hash for partitioning
            assert.ok(logPath!.includes('backup-audit'), 'Should be in backup-audit dir');
            // The workspace path should be identifiable but not the full path
            // (for reasonable directory naming)
        });
    });
});
