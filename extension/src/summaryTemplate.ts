/**
 * Summary Template Module (Plan 014 Milestone 1)
 * 
 * Defines TypeScript interfaces and formatting functions for structured
 * conversation summaries following the Plan 014 schema.
 * 
 * Per §4.4.1 (Enriched Text Metadata Fallback), this module generates
 * enriched text with embedded metadata using deterministic section headings.
 * 
 * CRITICAL: Template version and section headings must stay synchronized with:
 * - extension/bridge/ingest.py
 * - extension/bridge/retrieve.py
 * - extension/bridge/DATAPOINT_SCHEMA.md
 */

/**
 * Template version for enriched text summaries.
 * 
 * MUST be incremented when section headings or metadata format changes.
 * Changes require synchronized updates across TypeScript and Python layers.
 */
export const TEMPLATE_VERSION = '1.1';

/**
 * Structured conversation summary following Plan 014 schema.
 * 
 * Includes both content fields (semantic core) and metadata fields
 * (for ranking, filtering, compaction).
 */
export interface ConversationSummary {
    // === CONTENT FIELDS ===
    
    /** Short title capturing the main focus of the conversation */
    topic: string;
    
    /** 1-3 sentence summary of what was being worked on and why */
    context: string;
    
    /** Key decisions or conclusions reached */
    decisions: string[];
    
    /** Explanations for why key decisions were made */
    rationale: string[];
    
    /** Unresolved questions, risks, or follow-ups */
    openQuestions: string[];
    
    /** Concrete next actions or tasks */
    nextSteps: string[];
    
    /** File paths, plan IDs, branches, issues, or other references */
    references: string[];
    
    /** Human-readable time range (e.g., 'Nov 17 14:00-16:30') */
    timeScope: string;
    
    // === METADATA FIELDS ===
    
    /** Stable identifier for this topic (UUID or slug); null for legacy memories per §4.4.1 */
    topicId: string | null;
    
    /** Identifier for the originating chat session (UUID or date-based) */
    sessionId: string | null;
    
    /** Associated plan number (e.g., '014' or 'plan-014') */
    planId: string | null;
    
    /** Summary lifecycle status; null for legacy memories per §4.4.1 */
    status: 'Active' | 'Superseded' | 'DecisionRecord' | null;

    /** Original creation timestamp derived from source content */
    sourceCreatedAt: Date | null;
    
    /** Timestamp when summary was created; null for legacy memories per §4.4.1 */
    createdAt: Date | null;
    
    /** Timestamp when summary was last updated; null for legacy memories per §4.4.1 */
    updatedAt: Date | null;
}

/**
 * Validate that a ConversationSummary has all required fields.
 * 
 * @param summary - Partial summary to validate
 * @throws Error if required fields are missing or invalid
 */
export function validateSummary(summary: Partial<ConversationSummary>): void {
    // Required content fields
    if (!summary.topic || summary.topic.trim().length === 0) {
        throw new Error('Summary must have a non-empty topic');
    }
    
    if (!summary.context || summary.context.trim().length === 0) {
        throw new Error('Summary must have a non-empty context');
    }
    
    // Required metadata fields (topicId can be null for legacy memories per §4.4.1)
    if (summary.topicId !== null && summary.topicId !== undefined && summary.topicId.trim().length === 0) {
        throw new Error('Summary topicId must be non-empty string or null');
    }
    
    // Status can be null for legacy memories per §4.4.1
    if (summary.status !== null && summary.status !== undefined && 
        !['Active', 'Superseded', 'DecisionRecord'].includes(summary.status)) {
        throw new Error('Summary status must be Active, Superseded, DecisionRecord, or null');
    }
    
    // Timestamps can be null for legacy memories per §4.4.1
    if (summary.createdAt !== null && summary.createdAt !== undefined && 
        !(summary.createdAt instanceof Date)) {
        throw new Error('Summary createdAt must be a Date or null');
    }
    
    if (summary.updatedAt !== null && summary.updatedAt !== undefined && 
        !(summary.updatedAt instanceof Date)) {
        throw new Error('Summary updatedAt must be a Date or null');
    }

    if (summary.sourceCreatedAt !== null && summary.sourceCreatedAt !== undefined &&
        !(summary.sourceCreatedAt instanceof Date)) {
        throw new Error('Summary sourceCreatedAt must be a Date or null');
    }
}

/**
 * Format a ConversationSummary as enriched markdown text following §4.4.1 template.
 * 
 * This function produces the enriched text format with embedded metadata that will be:
 * 1. Displayed to users for confirmation
 * 2. Stored via Flowbaby's memory system for semantic search
 * 3. Parsed by retrieve.py via regex to extract structured fields
 * 4. Retrieved and displayed in future sessions
 * 
 * CRITICAL per §4.4.1: Section headings must match DATAPOINT_SCHEMA.md exactly.
 * Any changes require synchronized updates to ingest.py and retrieve.py regex patterns.
 * 
 * @param summary - The structured summary to format
 * @returns Enriched markdown text with template version tag and embedded metadata
 */
export function formatSummaryAsText(summary: ConversationSummary): string {
    // Validate before formatting
    validateSummary(summary);
    
    // Format timestamps as ISO 8601 (or N/A for null timestamps per §4.4.1)
    const createdAt = summary.createdAt ? summary.createdAt.toISOString() : 'N/A';
    const updatedAt = summary.updatedAt ? summary.updatedAt.toISOString() : 'N/A';
    const sourceCreatedAt = summary.sourceCreatedAt ? summary.sourceCreatedAt.toISOString() : 'N/A';
    
    // Format list items
    const decisionsText = summary.decisions.length > 0
        ? summary.decisions.map(d => `- ${d}`).join('\n')
        : '(none)';
    
    const rationaleText = summary.rationale.length > 0
        ? summary.rationale.map(r => `- ${r}`).join('\n')
        : '(none)';
    
    const openQuestionsText = summary.openQuestions.length > 0
        ? summary.openQuestions.map(q => `- ${q}`).join('\n')
        : '(none)';
    
    const nextStepsText = summary.nextSteps.length > 0
        ? summary.nextSteps.map(s => `- ${s}`).join('\n')
        : '(none)';
    
    const referencesText = summary.references.length > 0
        ? summary.references.map(ref => `- ${ref}`).join('\n')
        : '(none)';
    
    // Format using enriched text template per §4.4.1
    // CRITICAL: Do not modify section headings without updating retrieve.py regex patterns
    return `<!-- Template: v${TEMPLATE_VERSION} -->
# Conversation Summary: ${summary.topic}

**Metadata:**
- Topic ID: ${summary.topicId || 'N/A'}
- Session ID: ${summary.sessionId || 'N/A'}
- Plan ID: ${summary.planId || 'N/A'}
- Status: ${summary.status || 'N/A'}
- Source Created: ${sourceCreatedAt}
- Created: ${createdAt}
- Updated: ${updatedAt}

## Context
${summary.context}

## Key Decisions
${decisionsText}

## Rationale
${rationaleText}

## Open Questions
${openQuestionsText}

## Next Steps
${nextStepsText}

## References
${referencesText}

## Time Scope
${summary.timeScope || '(not specified)'}`;
}

/**
 * Create a default ConversationSummary with minimal required fields.
 * 
 * Useful for initializing summaries before LLM generation or testing.
 * 
 * @param topic - The summary topic (required)
 * @param context - The summary context (required)
 * @returns A ConversationSummary with defaults for optional fields
 */
export function createDefaultSummary(topic: string, context: string): ConversationSummary {
    const now = new Date();
    
    return {
        topic,
        context,
        decisions: [],
        rationale: [],
        openQuestions: [],
        nextSteps: [],
        references: [],
        timeScope: '',
        topicId: generateTopicId(topic),
        sessionId: null,
        planId: null,
        status: 'Active',
        createdAt: now,
        updatedAt: now,
        sourceCreatedAt: now
    };
}

/**
 * Generate a stable topic ID from a topic string.
 * 
 * Uses a simple slug-based approach for human readability.
 * For production, consider using UUIDs instead.
 * 
 * @param topic - The topic string
 * @returns A stable identifier (slug format)
 */
function generateTopicId(topic: string): string {
    // Simple slug generation: lowercase, replace spaces/special chars with hyphens
    return topic
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
