/**
 * Unit tests for summaryValidator (Plan 015 Milestone 4)
 * 
 * Tests validation logic for agent ingestion payloads
 */

import { expect } from 'chai';
import { validateIngestRequest, generateDefaultMetadata } from '../validation/summaryValidator';

suite('summaryValidator', () => {
    suite('validateIngestRequest', () => {
        test('accepts valid minimal payload with all required fields', () => {
            const payload = {
                topic: 'Test Topic',
                context: 'Test context',
                metadata: {
                    topicId: 'test-001',
                    createdAt: '2025-11-19T10:00:00Z',
                    updatedAt: '2025-11-19T10:00:00Z'
                }
            };

            const result = validateIngestRequest(payload);

            expect(result.valid).to.be.true;
            expect(result.errors).to.be.empty;
        });

        test('accepts valid full payload with all optional fields', () => {
            const payload = {
                topic: 'Full Test Topic',
                context: 'Full test context',
                decisions: ['Decision 1', 'Decision 2'],
                rationale: ['Rationale 1'],
                openQuestions: ['Question 1'],
                nextSteps: ['Step 1', 'Step 2'],
                references: ['Ref 1'],
                timeScope: '2025-11-19T08:00:00Z to 09:00:00Z',
                metadata: {
                    topicId: 'test-full-001',
                    sessionId: 'session-001',
                    planId: '015',
                    status: 'Active' as const,
                    createdAt: '2025-11-19T10:00:00Z',
                    updatedAt: '2025-11-19T10:00:00Z'
                },
                agentName: 'Test Agent'
            };

            const result = validateIngestRequest(payload);

            expect(result.valid).to.be.true;
            expect(result.errors).to.be.empty;
        });

        test('rejects payload without topic field', () => {
            const payload = {
                context: 'Test context',
                metadata: {
                    topicId: 'test-001',
                    createdAt: '2025-11-19T10:00:00Z',
                    updatedAt: '2025-11-19T10:00:00Z'
                }
            };

            const result = validateIngestRequest(payload);

            expect(result.valid).to.be.false;
            expect(result.errors).to.include('Field "topic" is required and must be a non-empty string');
        });

        test('rejects payload with empty topic string', () => {
            const payload = {
                topic: '   ',
                context: 'Test context',
                metadata: {
                    topicId: 'test-001',
                    createdAt: '2025-11-19T10:00:00Z',
                    updatedAt: '2025-11-19T10:00:00Z'
                }
            };

            const result = validateIngestRequest(payload);

            expect(result.valid).to.be.false;
            expect(result.errors).to.include('Field "topic" is required and must be a non-empty string');
        });

        test('rejects payload without context field', () => {
            const payload = {
                topic: 'Test Topic',
                metadata: {
                    topicId: 'test-001',
                    createdAt: '2025-11-19T10:00:00Z',
                    updatedAt: '2025-11-19T10:00:00Z'
                }
            };

            const result = validateIngestRequest(payload);

            expect(result.valid).to.be.false;
            expect(result.errors).to.include('Field "context" is required and must be a non-empty string');
        });

        test('accepts payload without metadata field (will be auto-generated)', () => {
            const payload = {
                topic: 'Test Topic',
                context: 'Test context'
            };

            const result = validateIngestRequest(payload);

            expect(result.valid).to.be.true;
            expect(result.errors).to.be.empty;
        });

        test('accepts payload without metadata.topicId (will be auto-generated)', () => {
            const payload = {
                topic: 'Test Topic',
                context: 'Test context',
                metadata: {
                    createdAt: '2025-11-19T10:00:00Z',
                    updatedAt: '2025-11-19T10:00:00Z'
                }
            };

            const result = validateIngestRequest(payload);

            expect(result.valid).to.be.true;
            expect(result.errors).to.be.empty;
        });

        test('accepts payload without metadata.createdAt (will be auto-generated)', () => {
            const payload = {
                topic: 'Test Topic',
                context: 'Test context',
                metadata: {
                    topicId: 'test-001',
                    updatedAt: '2025-11-19T10:00:00Z'
                }
            };

            const result = validateIngestRequest(payload);

            expect(result.valid).to.be.true;
            expect(result.errors).to.be.empty;
        });

        test('rejects payload with invalid ISO 8601 timestamp in createdAt', () => {
            const payload = {
                topic: 'Test Topic',
                context: 'Test context',
                metadata: {
                    topicId: 'test-001',
                    createdAt: '2025-11-19 10:00:00',
                    updatedAt: '2025-11-19T10:00:00Z'
                }
            };

            const result = validateIngestRequest(payload);

            expect(result.valid).to.be.false;
            expect(result.errors.some(e => e.includes('metadata.createdAt'))).to.be.true;
        });

        test('rejects payload with invalid status enum', () => {
            const payload = {
                topic: 'Test Topic',
                context: 'Test context',
                metadata: {
                    topicId: 'test-001',
                    status: 'InvalidStatus',
                    createdAt: '2025-11-19T10:00:00Z',
                    updatedAt: '2025-11-19T10:00:00Z'
                }
            };

            const result = validateIngestRequest(payload);

            expect(result.valid).to.be.false;
            expect(result.errors.some(e => e.includes('metadata.status'))).to.be.true;
        });

        test('rejects payload with non-array decisions field', () => {
            const payload = {
                topic: 'Test Topic',
                context: 'Test context',
                decisions: 'Not an array',
                metadata: {
                    topicId: 'test-001',
                    createdAt: '2025-11-19T10:00:00Z',
                    updatedAt: '2025-11-19T10:00:00Z'
                }
            };

            const result = validateIngestRequest(payload);

            expect(result.valid).to.be.false;
            expect(result.errors).to.include('Field "decisions" must be an array if provided');
        });

        test('rejects payload with non-string items in decisions array', () => {
            const payload = {
                topic: 'Test Topic',
                context: 'Test context',
                decisions: ['Valid decision', 123, 'Another valid'],
                metadata: {
                    topicId: 'test-001',
                    createdAt: '2025-11-19T10:00:00Z',
                    updatedAt: '2025-11-19T10:00:00Z'
                }
            };

            const result = validateIngestRequest(payload);

            expect(result.valid).to.be.false;
            expect(result.errors.some(e => e.includes('decisions[1]'))).to.be.true;
        });

        test('accepts all valid status enum values', () => {
            const statuses: Array<'Active' | 'Superseded' | 'DecisionRecord'> = ['Active', 'Superseded', 'DecisionRecord'];

            statuses.forEach(status => {
                const payload = {
                    topic: 'Test Topic',
                    context: 'Test context',
                    metadata: {
                        topicId: 'test-001',
                        status,
                        createdAt: '2025-11-19T10:00:00Z',
                        updatedAt: '2025-11-19T10:00:00Z'
                    }
                };

                const result = validateIngestRequest(payload);

                expect(result.valid, `Status "${status}" should be valid`).to.be.true;
            });
        });

        test('rejects non-object payload', () => {
            const result = validateIngestRequest('not an object');

            expect(result.valid).to.be.false;
            expect(result.errors).to.include('Payload must be a non-null object');
        });

        test('rejects null payload', () => {
            const result = validateIngestRequest(null);

            expect(result.valid).to.be.false;
            expect(result.errors).to.include('Payload must be a non-null object');
        });
    });

    suite('generateDefaultMetadata', () => {
        test('generates metadata with required topicId', () => {
            const metadata = generateDefaultMetadata('test-topic-id');

            expect(metadata.topicId).to.equal('test-topic-id');
            expect(metadata.status).to.equal('Active');
            expect(metadata.createdAt).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(metadata.updatedAt).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });

        test('allows overriding status', () => {
            const metadata = generateDefaultMetadata('test-id', { status: 'Superseded' });

            expect(metadata.status).to.equal('Superseded');
        });

        test('allows overriding timestamps', () => {
            const customTime = '2025-01-01T00:00:00Z';
            const metadata = generateDefaultMetadata('test-id', {
                createdAt: customTime,
                updatedAt: customTime
            });

            expect(metadata.createdAt).to.equal(customTime);
            expect(metadata.updatedAt).to.equal(customTime);
        });

        test('includes optional fields when provided', () => {
            const metadata = generateDefaultMetadata('test-id', {
                sessionId: 'session-123',
                planId: '015'
            });

            expect(metadata.sessionId).to.equal('session-123');
            expect(metadata.planId).to.equal('015');
        });
    });
});
