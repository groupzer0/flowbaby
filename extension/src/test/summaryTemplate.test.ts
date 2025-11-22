/**
 * Unit tests for summaryTemplate module (Plan 014 Milestone 1).
 * 
 * Tests validate:
 * - ConversationSummary interface and validation
 * - formatSummaryAsText produces correct markdown
 * - Default summary creation
 */

import * as assert from 'assert';
import {
    ConversationSummary,
    formatSummaryAsText,
    validateSummary,
    createDefaultSummary,
    TEMPLATE_VERSION
} from '../summaryTemplate';

suite('summaryTemplate', () => {
    suite('validateSummary', () => {
        test('accepts valid summary with all required fields', () => {
            const summary: ConversationSummary = {
                topic: 'Test Topic',
                context: 'Test context about what we were doing',
                decisions: ['Decision 1'],
                rationale: ['Rationale 1'],
                openQuestions: [],
                nextSteps: [],
                references: [],
                timeScope: 'Nov 17 14:00-16:30',
                topicId: 'test-topic',
                sessionId: null,
                planId: null,
                status: 'Active',
                createdAt: new Date(),
                updatedAt: new Date(),
                sourceCreatedAt: new Date()
            };
            
            // Should not throw
            assert.doesNotThrow(() => {
                validateSummary(summary);
            });
        });
        
        test('rejects summary without topic', () => {
            const summary = {
                topic: '',
                context: 'Test context',
                topicId: 'test',
                status: 'Active',
                createdAt: new Date(),
                updatedAt: new Date(),
                sourceCreatedAt: new Date()
            } as Partial<ConversationSummary>;
            
            assert.throws(
                () => validateSummary(summary),
                /Summary must have a non-empty topic/
            );
        });
        
        test('rejects summary without context', () => {
            const summary = {
                topic: 'Test',
                context: '',
                topicId: 'test',
                status: 'Active',
                createdAt: new Date(),
                updatedAt: new Date(),
                sourceCreatedAt: new Date()
            } as Partial<ConversationSummary>;
            
            assert.throws(
                () => validateSummary(summary),
                /Summary must have a non-empty context/
            );
        });
        
        test('rejects summary with invalid status', () => {
            const summary = {
                topic: 'Test',
                context: 'Context',
                topicId: 'test',
                status: 'Invalid',
                createdAt: new Date(),
                updatedAt: new Date(),
                sourceCreatedAt: new Date()
            } as any;
            
            assert.throws(
                () => validateSummary(summary),
                /Summary status must be Active, Superseded, DecisionRecord, or null/
            );
        });
        
        test('rejects summary with empty topicId string', () => {
            const summary = {
                topic: 'Test',
                context: 'Context',
                topicId: '',
                status: 'Active',
                createdAt: new Date(),
                updatedAt: new Date(),
                sourceCreatedAt: new Date()
            } as Partial<ConversationSummary>;
            
            assert.throws(
                () => validateSummary(summary),
                /Summary topicId must be non-empty string or null/
            );
        });
    });
    
    suite('formatSummaryAsText', () => {
        test('formats enriched summary with template version tag and metadata block per §4.4.1', () => {
            const summary: ConversationSummary = {
                topic: 'Plan 014 - Structured Summaries',
                context: 'Implementing DataPoint-based storage for conversation summaries',
                decisions: [
                    'Migrate summaries to DataPoints with metadata',
                    'Expose structured retrieval contract'
                ],
                rationale: [
                    'Enable recency-aware ranking and compaction'
                ],
                openQuestions: [
                    'How to handle very old summaries?'
                ],
                nextSteps: [
                    'Implement Plan 015 ranking algorithms'
                ],
                references: [
                    'Plan 014 documentation',
                    'System architecture §4.4'
                ],
                timeScope: 'Nov 17 14:00-16:30',
                topicId: 'plan-014-structured-summaries',
                sessionId: 'abc-123',
                planId: '014',
                status: 'Active',
                createdAt: new Date('2025-11-17T16:30:00Z'),
                updatedAt: new Date('2025-11-17T16:31:00Z'),
                sourceCreatedAt: new Date('2025-11-16T20:00:00Z')
            };
            
            const formatted = formatSummaryAsText(summary);
            
            // Check template version tag (§4.4.1 requirement)
            assert.ok(formatted.startsWith(`<!-- Template: v${TEMPLATE_VERSION} -->`), 
                'Enriched text must start with template version tag');
            
            // Check enriched text structure
            assert.ok(formatted.includes('# Conversation Summary: Plan 014 - Structured Summaries'));
            
            // Check **Metadata:** block (§4.4.1 requirement)
            assert.ok(formatted.includes('**Metadata:**'));
            assert.ok(formatted.includes('- Topic ID: plan-014-structured-summaries'));
            assert.ok(formatted.includes('- Session ID: abc-123'));
            assert.ok(formatted.includes('- Plan ID: 014'));
            assert.ok(formatted.includes('- Status: Active'));
            assert.ok(formatted.includes('- Source Created: 2025-11-16T20:00:00.000Z'));
            assert.ok(formatted.includes('- Created: 2025-11-17T16:30:00.000Z'));
            assert.ok(formatted.includes('- Updated: 2025-11-17T16:31:00.000Z'));
            
            // Check deterministic section headings (§4.4.1 requirement)
            assert.ok(formatted.includes('## Context'));
            assert.ok(formatted.includes('## Key Decisions'));
            assert.ok(formatted.includes('## Rationale'));
            assert.ok(formatted.includes('## Open Questions'));
            assert.ok(formatted.includes('## Next Steps'));
            assert.ok(formatted.includes('## References'));
            assert.ok(formatted.includes('## Time Scope'));
            
            // Check content appears after headings
            assert.ok(formatted.includes('Implementing DataPoint-based storage'));
            assert.ok(formatted.includes('- Migrate summaries to DataPoints with metadata'));
            assert.ok(formatted.includes('- Enable recency-aware ranking'));
            assert.ok(formatted.includes('- How to handle very old summaries?'));
            assert.ok(formatted.includes('- Implement Plan 015 ranking algorithms'));
            assert.ok(formatted.includes('- Plan 014 documentation'));
        });
        
        test('formats summary with empty list fields showing (none) markers', () => {
            const summary: ConversationSummary = {
                topic: 'Minimal Summary',
                context: 'Just a quick note',
                decisions: [],
                rationale: [],
                openQuestions: [],
                nextSteps: [],
                references: [],
                timeScope: '',
                topicId: 'minimal-summary',
                sessionId: null,
                planId: null,
                status: 'DecisionRecord',
                createdAt: new Date(),
                updatedAt: new Date(),
                sourceCreatedAt: null
            };
            
            const formatted = formatSummaryAsText(summary);
            
            // Empty lists should show "(none)" per §4.4.1 template
            assert.ok(formatted.includes('## Key Decisions\n(none)'));
            assert.ok(formatted.includes('## Rationale\n(none)'));
            assert.ok(formatted.includes('## Open Questions\n(none)'));
            assert.ok(formatted.includes('## Next Steps\n(none)'));
            assert.ok(formatted.includes('## References\n(none)'));
            
            // null sessionId/planId should show as N/A in metadata
            assert.ok(formatted.includes('- Session ID: N/A'));
            assert.ok(formatted.includes('- Plan ID: N/A'));
        });
        
        test('throws error for invalid summary', () => {
            const invalidSummary = {
                topic: '',
                context: 'Context',
                decisions: [],
                rationale: [],
                openQuestions: [],
                nextSteps: [],
                references: [],
                timeScope: '',
                topicId: 'test',
                sessionId: null,
                planId: null,
                status: 'Active',
                sourceCreatedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date()
            } as ConversationSummary;
            
            assert.throws(
                () => formatSummaryAsText(invalidSummary),
                /Summary must have a non-empty topic/
            );
        });
    });
    
    suite('createDefaultSummary', () => {
        test('creates summary with minimal required fields', () => {
            const topic = 'Test Topic';
            const context = 'Test context';
            
            const summary = createDefaultSummary(topic, context);
            
            assert.strictEqual(summary.topic, topic);
            assert.strictEqual(summary.context, context);
            assert.strictEqual(summary.status, 'Active');
            assert.strictEqual(summary.decisions.length, 0);
            assert.strictEqual(summary.rationale.length, 0);
            assert.strictEqual(summary.openQuestions.length, 0);
            assert.strictEqual(summary.nextSteps.length, 0);
            assert.strictEqual(summary.references.length, 0);
            assert.ok(summary.createdAt instanceof Date);
            assert.ok(summary.updatedAt instanceof Date);
            assert.ok(summary.sourceCreatedAt instanceof Date);
        });
        
        test('generates topic ID from topic string', () => {
            const summary = createDefaultSummary('Plan 014 - Structured Summaries', 'Context');
            
            // Should be a slug
            assert.strictEqual(summary.topicId, 'plan-014-structured-summaries');
        });
        
        test('handles special characters in topic', () => {
            const summary = createDefaultSummary('Test: Topic! (v1.0)', 'Context');
            
            // Special chars replaced with hyphens
            assert.strictEqual(summary.topicId, 'test-topic-v1-0');
        });
    });
});
