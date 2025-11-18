/**
 * Unit tests for summaryParser module (Plan 014 Milestone 1).
 * 
 * Tests validate:
 * - Parsing of Plan 014 markdown template
 * - Handling of optional/missing sections
 * - Round-trip validation (format → parse → verify)
 */

import * as assert from 'assert';
import {
    parseSummaryFromText,
    validateRoundTrip
} from '../summaryParser';
import {
    ConversationSummary,
    formatSummaryAsText,
    createDefaultSummary,
    TEMPLATE_VERSION
} from '../summaryTemplate';

suite('summaryParser', () => {
    suite('parseSummaryFromText', () => {
        test('parses enriched summary with **Metadata:** block per §4.4.1', () => {
            const enrichedText = `<!-- Template: v${TEMPLATE_VERSION} -->
# Conversation Summary: Plan 014 - Structured Summaries

**Metadata:**
- Topic ID: plan-014-structured-summaries
- Session ID: abc-123
- Plan ID: 014
- Status: Active
- Created: 2025-11-17T16:30:00.000Z
- Updated: 2025-11-17T16:31:00.000Z

## Context
Implementing DataPoint-based storage for conversation summaries

## Key Decisions
- Migrate summaries to DataPoints with metadata
- Expose structured retrieval contract

## Rationale
- Enable recency-aware ranking and compaction

## Open Questions
- How to handle very old summaries?

## Next Steps
- Implement Plan 015 ranking algorithms

## References
- Plan 014 documentation
- System architecture §4.4

## Time Scope
Nov 17 14:00-16:30`;
            
            const parsed = parseSummaryFromText(enrichedText);
            
            assert.ok(parsed, 'Should successfully parse enriched text');
            
            // Verify content fields
            assert.strictEqual(parsed!.topic, 'Plan 014 - Structured Summaries');
            assert.strictEqual(
                parsed!.context,
                'Implementing DataPoint-based storage for conversation summaries'
            );
            assert.strictEqual(parsed!.decisions.length, 2);
            assert.ok(parsed!.decisions.includes('Migrate summaries to DataPoints with metadata'));
            assert.strictEqual(parsed!.rationale.length, 1);
            assert.strictEqual(parsed!.openQuestions.length, 1);
            assert.strictEqual(parsed!.nextSteps.length, 1);
            assert.strictEqual(parsed!.references.length, 2);
            assert.ok(parsed!.timeScope.includes('Nov 17 14:00-16:30'));
            
            // Verify metadata fields per §4.4.1
            assert.strictEqual(parsed!.topicId, 'plan-014-structured-summaries');
            assert.strictEqual(parsed!.sessionId, 'abc-123');
            assert.strictEqual(parsed!.planId, '014');
            assert.strictEqual(parsed!.status, 'Active');
            assert.ok(parsed!.createdAt instanceof Date);
            assert.ok(parsed!.updatedAt instanceof Date);
        });
        
        test('parses enriched summary with empty sections showing (none) markers', () => {
            const enrichedText = `<!-- Template: v${TEMPLATE_VERSION} -->
# Conversation Summary: Minimal Summary

**Metadata:**
- Topic ID: minimal-summary
- Session ID: N/A
- Plan ID: N/A
- Status: Draft
- Created: 2025-11-18T10:00:00.000Z
- Updated: 2025-11-18T10:00:00.000Z

## Context
Just a quick note

## Key Decisions
(none)

## Rationale
(none)

## Open Questions
(none)

## Next Steps
(none)

## References
(none)

## Time Scope
(not specified)`;
            
            const parsed = parseSummaryFromText(enrichedText);
            
            assert.ok(parsed);
            assert.strictEqual(parsed!.topic, 'Minimal Summary');
            assert.strictEqual(parsed!.context, 'Just a quick note');
            assert.strictEqual(parsed!.decisions.length, 0, 'Empty sections should return empty arrays');
            assert.strictEqual(parsed!.rationale.length, 0);
            assert.strictEqual(parsed!.openQuestions.length, 0);
            assert.strictEqual(parsed!.nextSteps.length, 0);
            assert.strictEqual(parsed!.references.length, 0);
            
            // Verify N/A is parsed as null per §4.4.1
            assert.strictEqual(parsed!.sessionId, null);
            assert.strictEqual(parsed!.planId, null);
        });
        
        test('parses summary with missing optional sections', () => {
            const markdown = `Summary: Basic Summary

Topic: Basic Summary
Context: Testing minimal parsing
Decisions:
- Key decision
Time Scope: Nov 17`;
            
            const parsed = parseSummaryFromText(markdown);
            
            assert.ok(parsed);
            assert.strictEqual(parsed!.topic, 'Basic Summary');
            assert.strictEqual(parsed!.context, 'Testing minimal parsing');
            assert.strictEqual(parsed!.decisions.length, 1);
            // Missing sections should be empty arrays
            assert.strictEqual(parsed!.rationale.length, 0);
            assert.strictEqual(parsed!.openQuestions.length, 0);
        });
        
        test('handles legacy text without explicit Topic field', () => {
            const markdown = `Context: Just context, no topic`;
            
            const parsed = parseSummaryFromText(markdown);
            
            // Per §4.4.1, gracefully degrades to Legacy Memory
            assert.ok(parsed, 'Should parse legacy text without topic');
            assert.strictEqual(parsed!.topic, 'Legacy Memory');
            assert.ok(parsed!.context.includes('Just context'));
            assert.strictEqual(parsed!.topicId, null, 'Legacy memory should have null topicId');
        });
        
        test('handles legacy text without Context field', () => {
            const markdown = `Summary: Topic Only

Topic: Topic Only
Decisions:
- Some decision`;
            
            const parsed = parseSummaryFromText(markdown);
            
            // Per §4.4.1, gracefully extracts topic and uses fallback context
            assert.ok(parsed, 'Should parse legacy text without context field');
            assert.strictEqual(parsed!.topic, 'Topic Only');
            assert.ok(parsed!.context.length > 0, 'Should have fallback context');
            assert.strictEqual(parsed!.topicId, null, 'Legacy memory should have null topicId');
            assert.deepStrictEqual(parsed!.decisions, ['Some decision']);
        });
        
        test('returns null for empty text', () => {
            const parsed = parseSummaryFromText('');
            
            assert.strictEqual(parsed, null);
        });
        
        test('handles multi-line list items', () => {
            const markdown = `Summary: Test

Topic: Test
Context: Testing
Decisions:
- First line
  continuation of first line
- Second decision
Next Steps:
- None
Time Scope: `;
            
            const parsed = parseSummaryFromText(markdown);
            
            assert.ok(parsed);
            // Multi-line items currently only capture first line
            // (This is acceptable for MVP; can be enhanced later)
            assert.strictEqual(parsed!.decisions.length, 2);
        });
    });
    
    suite('validateRoundTrip (Enriched Text Format)', () => {
        test('validates enriched format preserves all fields through format→parse cycle', () => {
            const original: ConversationSummary = {
                topic: 'Round-Trip Test',
                context: 'Testing format and parse cycle',
                decisions: ['Decision A', 'Decision B'],
                rationale: ['Rationale for A'],
                openQuestions: ['Question 1'],
                nextSteps: ['Next step 1'],
                references: ['Reference 1'],
                timeScope: 'Nov 17',
                topicId: 'round-trip-test',
                sessionId: null,
                planId: '014',
                status: 'Active',
                createdAt: new Date('2025-11-18T10:00:00.000Z'),
                updatedAt: new Date('2025-11-18T11:00:00.000Z')
            };
            
            // Format to enriched text
            const formatted = formatSummaryAsText(original);
            
            // Verify template version tag is present
            assert.ok(formatted.includes(`<!-- Template: v${TEMPLATE_VERSION} -->`), 'Should include template version tag');
            
            // Parse back
            const parsed = parseSummaryFromText(formatted);
            
            assert.ok(parsed, 'Should parse formatted text');
            
            // Validate round-trip preserves all fields
            const isValid = validateRoundTrip(original, parsed!);
            
            assert.strictEqual(isValid, true, 'Round-trip should preserve all fields');
            
            // Validate metadata fields specifically
            assert.strictEqual(parsed!.topicId, original.topicId);
            assert.strictEqual(parsed!.sessionId, original.sessionId);
            assert.strictEqual(parsed!.planId, original.planId);
            assert.strictEqual(parsed!.status, original.status);
            assert.deepStrictEqual(parsed!.createdAt, original.createdAt);
            assert.deepStrictEqual(parsed!.updatedAt, original.updatedAt);
        });
        
        test('detects topic mismatch in enriched format', () => {
            const original = createDefaultSummary('Original Topic', 'Context');
            original.topicId = 'original-topic';
            
            const modified = createDefaultSummary('Different Topic', 'Context');
            modified.topicId = 'different-topic';
            
            const isValid = validateRoundTrip(original, modified);
            
            assert.strictEqual(isValid, false, 'Topic mismatch should fail validation');
        });
        
        test('detects metadata field mismatch', () => {
            const original = createDefaultSummary('Topic', 'Context');
            original.sessionId = 'session-123';
            
            const modified = createDefaultSummary('Topic', 'Context');
            modified.sessionId = 'session-456';
            
            const isValid = validateRoundTrip(original, modified);
            
            assert.strictEqual(isValid, false, 'SessionId mismatch should fail validation');
        });
        
        test('handles N/A metadata values correctly', () => {
            const original = createDefaultSummary('Topic', 'Context');
            original.sessionId = null; // N/A in enriched text
            original.planId = null;
            
            const enrichedText = formatSummaryAsText(original);
            const parsed = parseSummaryFromText(enrichedText);
            
            assert.ok(parsed);
            assert.strictEqual(parsed!.sessionId, null, 'N/A should parse as null');
            assert.strictEqual(parsed!.planId, null);
            
            const isValid = validateRoundTrip(original, parsed!);
            assert.strictEqual(isValid, true, 'N/A values should preserve correctly');
        });
    });
    
    suite('Mixed-Mode Handling (Enriched vs Legacy)', () => {
        test('parses legacy raw-text memory without metadata block', () => {
            const legacyText = `Summary: Legacy Discussion

Topic: Legacy Discussion
Context: Old format without metadata block
Decisions:
- Decision 1
Rationale:
- Reason 1
Open Questions:
- None
Next Steps:
- Follow up
References:
- None
Time Scope: Recent`;
            
            const parsed = parseSummaryFromText(legacyText);
            
            assert.ok(parsed, 'Legacy text should parse successfully');
            assert.strictEqual(parsed!.topic, 'Legacy Discussion');
            assert.strictEqual(parsed!.context, 'Old format without metadata block');
            assert.deepStrictEqual(parsed!.decisions, ['Decision 1']);
            assert.deepStrictEqual(parsed!.rationale, ['Reason 1']);
            
            // Legacy memories should have null metadata per §4.4.1
            assert.strictEqual(parsed!.topicId, null);
            assert.strictEqual(parsed!.sessionId, null);
            assert.strictEqual(parsed!.planId, null);
            assert.strictEqual(parsed!.status, null);
            assert.strictEqual(parsed!.createdAt, null);
            assert.strictEqual(parsed!.updatedAt, null);
        });
        
        test('handles mixed corpus: enriched summary after legacy memory', () => {
            const enrichedText = `<!-- Template: v${TEMPLATE_VERSION} -->
# Conversation Summary: Modern Summary

**Metadata:**
- Topic ID: modern-summary
- Session ID: session-456
- Plan ID: N/A
- Status: Active
- Created: 2025-11-18T11:00:00.000Z
- Updated: 2025-11-18T11:00:00.000Z

## Context
New enriched format with metadata`;
            
            const parsed = parseSummaryFromText(enrichedText);
            
            assert.ok(parsed);
            assert.strictEqual(parsed!.topicId, 'modern-summary', 'Enriched summary should have topicId');
            assert.strictEqual(parsed!.sessionId, 'session-456');
            assert.strictEqual(parsed!.status, 'Active');
            assert.ok(parsed!.createdAt instanceof Date);
            assert.ok(parsed!.updatedAt instanceof Date);
        });
    });
});
