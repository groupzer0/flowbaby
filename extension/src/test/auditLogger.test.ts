import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import mock = require('mock-fs');
import { AuditLogger, getAuditLogger, AuditEvent } from '../audit/AuditLogger';

suite('AuditLogger (Plan 039 M6)', () => {
    const testWorkspacePath = '/tmp/test-workspace-audit';
    let logger: AuditLogger;

    setup(() => {
        // Reset singleton for each test
        (AuditLogger as any).instance = null;
        logger = getAuditLogger();
    });

    teardown(() => {
        try { mock.restore(); } catch {}
        (AuditLogger as any).instance = null;
    });

    test('getInstance returns singleton instance', () => {
        const instance1 = AuditLogger.getInstance();
        const instance2 = AuditLogger.getInstance();
        assert.strictEqual(instance1, instance2);
    });

    test('getAuditLogger returns same instance as getInstance', () => {
        const instance1 = getAuditLogger();
        const instance2 = AuditLogger.getInstance();
        assert.strictEqual(instance1, instance2);
    });

    test('initialize creates logs directory and sets log file path', () => {
        mock({
            [testWorkspacePath]: {
                '.flowbaby': {}
            }
        });

        logger.initialize(testWorkspacePath);

        const logsDir = path.join(testWorkspacePath, '.flowbaby', 'logs');
        assert.strictEqual(fs.existsSync(logsDir), true);
        
        mock.restore();
    });

    test('logApiKeySet writes event to audit log', () => {
        mock({
            [testWorkspacePath]: {
                '.flowbaby': {}
            }
        });

        logger.initialize(testWorkspacePath);
        logger.logApiKeySet(true, 'command');

        const logPath = path.join(testWorkspacePath, '.flowbaby', 'logs', 'audit.jsonl');
        assert.strictEqual(fs.existsSync(logPath), true);
        
        const content = fs.readFileSync(logPath, 'utf8');
        const event = JSON.parse(content.trim()) as AuditEvent;
        
        assert.strictEqual(event.category, 'API_KEY');
        assert.strictEqual(event.event, 'api_key_set');
        assert.strictEqual(event.success, true);
        assert.ok(event.timestamp);

        mock.restore();
    });

    test('logApiKeyClear writes event to audit log', () => {
        mock({
            [testWorkspacePath]: {
                '.flowbaby': {}
            }
        });

        logger.initialize(testWorkspacePath);
        logger.logApiKeyClear(true);

        const logPath = path.join(testWorkspacePath, '.flowbaby', 'logs', 'audit.jsonl');
        const content = fs.readFileSync(logPath, 'utf8');
        const event = JSON.parse(content.trim()) as AuditEvent;
        
        assert.strictEqual(event.category, 'API_KEY');
        assert.strictEqual(event.event, 'api_key_clear');
        assert.strictEqual(event.success, true);

        mock.restore();
    });

    test('logMemoryClear writes event with soft-delete method', () => {
        mock({
            [testWorkspacePath]: {
                '.flowbaby': {}
            }
        });

        logger.initialize(testWorkspacePath);
        logger.logMemoryClear(true, 'soft');

        const logPath = path.join(testWorkspacePath, '.flowbaby', 'logs', 'audit.jsonl');
        const content = fs.readFileSync(logPath, 'utf8');
        const event = JSON.parse(content.trim()) as AuditEvent;
        
        assert.strictEqual(event.category, 'MEMORY');
        assert.strictEqual(event.event, 'memory_clear');
        assert.strictEqual(event.severity, 'WARN');
        assert.strictEqual(event.details?.method, 'soft');

        mock.restore();
    });

    test('logEnvironmentInit writes event to audit log', () => {
        mock({
            [testWorkspacePath]: {
                '.flowbaby': {}
            }
        });

        logger.initialize(testWorkspacePath);
        logger.logEnvironmentInit(true, { venvPath: '.flowbaby/venv' });

        const logPath = path.join(testWorkspacePath, '.flowbaby', 'logs', 'audit.jsonl');
        const content = fs.readFileSync(logPath, 'utf8');
        const event = JSON.parse(content.trim()) as AuditEvent;
        
        assert.strictEqual(event.category, 'ENVIRONMENT');
        assert.strictEqual(event.event, 'environment_init');
        assert.strictEqual(event.success, true);
        assert.strictEqual(event.details?.venvPath, '.flowbaby/venv');

        mock.restore();
    });

    test('log sanitizes sensitive data in details', () => {
        mock({
            [testWorkspacePath]: {
                '.flowbaby': {}
            }
        });

        logger.initialize(testWorkspacePath);
        logger.log('INFO', 'CONFIG', 'test_event', true, {
            api_key: 'sk-secret123',
            password: 'supersecret',
            normal_field: 'visible'
        });

        const logPath = path.join(testWorkspacePath, '.flowbaby', 'logs', 'audit.jsonl');
        const content = fs.readFileSync(logPath, 'utf8');
        const event = JSON.parse(content.trim()) as AuditEvent;
        
        assert.strictEqual(event.details?.api_key, '[REDACTED]');
        assert.strictEqual(event.details?.password, '[REDACTED]');
        assert.strictEqual(event.details?.normal_field, 'visible');

        mock.restore();
    });

    test('log redacts OpenAI-style keys in string values', () => {
        mock({
            [testWorkspacePath]: {
                '.flowbaby': {}
            }
        });

        logger.initialize(testWorkspacePath);
        logger.log('INFO', 'CONFIG', 'test_event', true, {
            message: 'Using key sk-abc123def456ghi789jkl012mno345pqr'
        });

        const logPath = path.join(testWorkspacePath, '.flowbaby', 'logs', 'audit.jsonl');
        const content = fs.readFileSync(logPath, 'utf8');
        const event = JSON.parse(content.trim()) as AuditEvent;
        
        assert.strictEqual(event.details?.message, 'Using key sk-***');

        mock.restore();
    });

    test('getRecentEvents returns events in reverse chronological order', () => {
        mock({
            [testWorkspacePath]: {
                '.flowbaby': {}
            }
        });

        logger.initialize(testWorkspacePath);
        logger.logApiKeySet(true, 'command');
        logger.logApiKeyClear(true);
        logger.logMemoryClear(true, 'soft');

        const events = logger.getRecentEvents(10);
        
        assert.strictEqual(events.length, 3);
        // Most recent first
        assert.strictEqual(events[0].event, 'memory_clear');
        assert.strictEqual(events[1].event, 'api_key_clear');
        assert.strictEqual(events[2].event, 'api_key_set');

        mock.restore();
    });

    test('getRecentEvents respects limit', () => {
        mock({
            [testWorkspacePath]: {
                '.flowbaby': {}
            }
        });

        logger.initialize(testWorkspacePath);
        logger.logApiKeySet(true, 'command');
        logger.logApiKeyClear(true);
        logger.logMemoryClear(true, 'soft');

        const events = logger.getRecentEvents(2);
        
        assert.strictEqual(events.length, 2);

        mock.restore();
    });

    test('getRecentEvents returns empty array when no log file', () => {
        mock({
            [testWorkspacePath]: {}
        });

        // Don't initialize to skip log file creation
        const events = logger.getRecentEvents();
        assert.strictEqual(events.length, 0);

        mock.restore();
    });

    test('log does not throw when logger not initialized', () => {
        // Should not throw, just silently skip
        assert.doesNotThrow(() => {
            logger.logApiKeySet(true, 'command');
        });
    });
});
