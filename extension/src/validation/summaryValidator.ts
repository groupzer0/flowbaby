/**
 * Validation helper for agent ingestion requests (Plan 015 Milestone 1)
 * 
 * Validates CogneeIngestRequest payloads before submitting to bridge.
 * Provides fast-fail feedback with detailed error messages.
 */

import { CogneeIngestRequest, SummaryStatus, ValidationResult } from '../types/agentIntegration';

/**
 * Validate an ingest request payload
 * 
 * @param payload - The payload to validate (unknown type for runtime safety)
 * @returns ValidationResult with valid flag and error messages
 * 
 * @example
 * ```typescript
 * const result = validateIngestRequest(payload);
 * if (!result.valid) {
 *   console.error('Validation failed:', result.errors);
 *   return { success: false, error: result.errors.join('; '), errorCode: 'INVALID_PAYLOAD' };
 * }
 * ```
 */
export function validateIngestRequest(payload: unknown): ValidationResult {
    const errors: string[] = [];

    // Type guard: payload must be an object
    if (!payload || typeof payload !== 'object') {
        return {
            valid: false,
            errors: ['Payload must be a non-null object']
        };
    }

    const req = payload as Partial<CogneeIngestRequest>;

    // Required field: topic (non-empty string)
    if (!req.topic || typeof req.topic !== 'string' || req.topic.trim() === '') {
        errors.push('Field "topic" is required and must be a non-empty string');
    }

    // Required field: context (non-empty string)
    if (!req.context || typeof req.context !== 'string' || req.context.trim() === '') {
        errors.push('Field "context" is required and must be a non-empty string');
    }

    // Optional field: metadata (will be auto-generated if missing)
    if (req.metadata !== undefined) {
        if (typeof req.metadata !== 'object' || req.metadata === null) {
            errors.push('Field "metadata" must be an object if provided');
        } else {
            // Validate metadata.topicId (optional, non-empty string if provided)
            if (req.metadata.topicId !== undefined && (typeof req.metadata.topicId !== 'string' || req.metadata.topicId.trim() === '')) {
                errors.push('Field "metadata.topicId" must be a non-empty string if provided');
            }

            // Validate metadata.createdAt (optional, ISO 8601 timestamp if provided)
            if (req.metadata.createdAt !== undefined) {
                if (typeof req.metadata.createdAt !== 'string') {
                    errors.push('Field "metadata.createdAt" must be an ISO 8601 timestamp string if provided');
                } else if (!isValidISO8601(req.metadata.createdAt)) {
                    errors.push(`Field "metadata.createdAt" is not a valid ISO 8601 timestamp: ${req.metadata.createdAt}`);
                }
            }

            // Validate metadata.sourceCreatedAt (optional ISO 8601 timestamp)
            if (req.metadata.sourceCreatedAt !== undefined) {
                if (typeof req.metadata.sourceCreatedAt !== 'string') {
                    errors.push('Field "metadata.sourceCreatedAt" must be an ISO 8601 timestamp string if provided');
                } else if (!isValidISO8601(req.metadata.sourceCreatedAt)) {
                    errors.push(`Field "metadata.sourceCreatedAt" is not a valid ISO 8601 timestamp: ${req.metadata.sourceCreatedAt}`);
                }
            }

            // Validate metadata.updatedAt (optional, ISO 8601 timestamp if provided)
            if (req.metadata.updatedAt !== undefined) {
                if (typeof req.metadata.updatedAt !== 'string') {
                    errors.push('Field "metadata.updatedAt" must be an ISO 8601 timestamp string if provided');
                } else if (!isValidISO8601(req.metadata.updatedAt)) {
                    errors.push(`Field "metadata.updatedAt" is not a valid ISO 8601 timestamp: ${req.metadata.updatedAt}`);
                }
            }

            // Validate metadata.sessionId (optional string)
            if (req.metadata.sessionId !== undefined && typeof req.metadata.sessionId !== 'string') {
                errors.push('Field "metadata.sessionId" must be a string if provided');
            }

            // Validate metadata.planId (optional string)
            if (req.metadata.planId !== undefined && typeof req.metadata.planId !== 'string') {
                errors.push('Field "metadata.planId" must be a string if provided');
            }

            // Validate metadata.status (optional enum)
            if (req.metadata.status !== undefined) {
                const validStatuses: SummaryStatus[] = ['Active', 'Superseded', 'DecisionRecord'];
                if (!validStatuses.includes(req.metadata.status as SummaryStatus)) {
                    errors.push(`Field "metadata.status" must be one of: ${validStatuses.join(', ')}. Got: ${req.metadata.status}`);
                }
            }
        }
    }

    // Optional field: decisions (array of strings)
    if (req.decisions !== undefined) {
        if (!Array.isArray(req.decisions)) {
            errors.push('Field "decisions" must be an array if provided');
        } else {
            req.decisions.forEach((item, idx) => {
                if (typeof item !== 'string') {
                    errors.push(`Field "decisions[${idx}]" must be a string. Got: ${typeof item}`);
                }
            });
        }
    }

    // Optional field: rationale (array of strings)
    if (req.rationale !== undefined) {
        if (!Array.isArray(req.rationale)) {
            errors.push('Field "rationale" must be an array if provided');
        } else {
            req.rationale.forEach((item, idx) => {
                if (typeof item !== 'string') {
                    errors.push(`Field "rationale[${idx}]" must be a string. Got: ${typeof item}`);
                }
            });
        }
    }

    // Optional field: openQuestions (array of strings)
    if (req.openQuestions !== undefined) {
        if (!Array.isArray(req.openQuestions)) {
            errors.push('Field "openQuestions" must be an array if provided');
        } else {
            req.openQuestions.forEach((item, idx) => {
                if (typeof item !== 'string') {
                    errors.push(`Field "openQuestions[${idx}]" must be a string. Got: ${typeof item}`);
                }
            });
        }
    }

    // Optional field: nextSteps (array of strings)
    if (req.nextSteps !== undefined) {
        if (!Array.isArray(req.nextSteps)) {
            errors.push('Field "nextSteps" must be an array if provided');
        } else {
            req.nextSteps.forEach((item, idx) => {
                if (typeof item !== 'string') {
                    errors.push(`Field "nextSteps[${idx}]" must be a string. Got: ${typeof item}`);
                }
            });
        }
    }

    // Optional field: references (array of strings)
    if (req.references !== undefined) {
        if (!Array.isArray(req.references)) {
            errors.push('Field "references" must be an array if provided');
        } else {
            req.references.forEach((item, idx) => {
                if (typeof item !== 'string') {
                    errors.push(`Field "references[${idx}]" must be a string. Got: ${typeof item}`);
                }
            });
        }
    }

    // Optional field: timeScope (string)
    if (req.timeScope !== undefined && typeof req.timeScope !== 'string') {
        errors.push('Field "timeScope" must be a string if provided');
    }

    // Optional field: agentName (string)
    if (req.agentName !== undefined && typeof req.agentName !== 'string') {
        errors.push('Field "agentName" must be a string if provided');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate ISO 8601 timestamp format
 * 
 * Accepts formats:
 * - 2025-11-19T08:12:44.734334Z (with fractional seconds and Z)
 * - 2025-11-19T08:12:44Z (without fractional seconds)
 * - 2025-11-19T08:12:44.734334+00:00 (with timezone offset)
 * - 2025-11-19T08:12:44+00:00 (without fractional seconds, with offset)
 * 
 * @param timestamp - The timestamp string to validate
 * @returns true if valid ISO 8601 format
 */
function isValidISO8601(timestamp: string): boolean {
    // Try parsing with Date constructor (supports ISO 8601)
    const date = new Date(timestamp);
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
        return false;
    }

    // Additional check: ISO 8601 format must include 'T' separator
    if (!timestamp.includes('T')) {
        return false;
    }

    // Additional check: Must have timezone indicator (Z or ±HH:MM)
    const hasTimezone = timestamp.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(timestamp);
    if (!hasTimezone) {
        return false;
    }

    return true;
}

/**
 * Generate default metadata for summaries
 * 
 * Useful for creating summaries when agents don't provide full metadata.
 * 
 * @param topicId - Unique identifier for the topic
 * @param options - Optional overrides for metadata fields
 * @returns Complete SummaryMetadata object with defaults
 * 
 * @example
 * ```typescript
 * const metadata = generateDefaultMetadata('plan-015-implementation', {
 *   status: 'Active',
 *   planId: '015'
 * });
 * ```
 */
export function generateDefaultMetadata(
    topicId: string,
    options?: {
        sessionId?: string;
        planId?: string;
        status?: SummaryStatus;
        createdAt?: string;
        sourceCreatedAt?: string;
        updatedAt?: string;
    }
): {
    topicId: string;
    sessionId?: string;
    planId?: string;
    status: SummaryStatus;
    createdAt: string;
    sourceCreatedAt?: string;
    updatedAt: string;
} {
    const now = new Date().toISOString();
    
    return {
        topicId,
        sessionId: options?.sessionId,
        planId: options?.planId,
        status: options?.status || 'Active',
        createdAt: options?.createdAt || now,
        sourceCreatedAt: options?.sourceCreatedAt || options?.createdAt || now,
        updatedAt: options?.updatedAt || now
    };
}
