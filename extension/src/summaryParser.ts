/**
 * Summary Parser Module (Plan 014 Milestone 1)
 * 
 * Parses enriched markdown summaries back into structured ConversationSummary objects.
 * Per §4.4.1 (Enriched Text Metadata Fallback), supports:
 * 1. Enriched text with **Metadata:** block and template version tag
 * 2. Legacy raw-text memories (mixed-mode: returns partial object with null metadata)
 * 3. Template version validation (logs warning on version mismatch)
 * 4. Deterministic section heading parsing matching DATAPOINT_SCHEMA.md
 */

import { ConversationSummary, createDefaultSummary, TEMPLATE_VERSION } from './summaryTemplate';

/**
 * Parse enriched markdown text into a ConversationSummary object.
 * 
 * Per §4.4.1, handles two modes:
 * 1. **Enriched summaries**: Parse **Metadata:** block first, then content sections
 * 2. **Legacy memories**: No metadata block; return partial object with null metadata
 * 
 * Enriched text format:
 * ```
 * <!-- Template: v1.1 -->
 * # Conversation Summary: {topic}
 * 
 * **Metadata:**
 * - Topic ID: {uuid}
 * - Status: Active
 * - Created: {ISO timestamp}
 * ...
 * 
 * ## Context
 * {context}
 * 
 * ## Key Decisions
 * - {decision 1}
 * ...
 * ```
 * 
 * @param text - Enriched markdown or legacy raw text
 * @returns Parsed ConversationSummary with full or partial metadata, or null if parsing fails
 */
export function parseSummaryFromText(text: string): ConversationSummary | null {
    if (!text || text.trim().length === 0) {
        return null;
    }
    
    try {
        // Check for enriched text (§4.4.1: detect **Metadata:** block)
        const hasMetadata = text.includes('**Metadata:**');
        
        if (hasMetadata) {
            // Enriched mode: parse template version, metadata, and content sections
            return parseEnrichedSummary(text);
        } else {
            // Legacy mode: return partial summary with null metadata
            return parseLegacySummary(text);
        }
        
    } catch (error) {
        console.error('Error parsing summary:', error);
        return null;
    }
}

/**
 * Parse enriched summary with **Metadata:** block per §4.4.1.
 */
function parseEnrichedSummary(text: string): ConversationSummary | null {
    // Validate template version
    const versionMatch = text.match(/<!-- Template: v([\d.]+) -->/);
    if (versionMatch) {
        const version = versionMatch[1];
        if (version !== TEMPLATE_VERSION) {
            console.warn(`Template version mismatch: expected v${TEMPLATE_VERSION}, got v${version}`);
        }
    }
    
    // Extract topic from heading
    const topicMatch = text.match(/^# Conversation Summary:\s*(.+)$/m);
    if (!topicMatch) {
        console.warn('Failed to parse enriched summary: missing topic heading');
        return null;
    }
    const topic = topicMatch[1].trim();
    
    // Parse metadata block using regex patterns from DATAPOINT_SCHEMA.md
    const topicIdMatch = text.match(/- Topic ID:\s*(N\/A|[a-zA-Z0-9\-]+)/i);
    const sessionIdMatch = text.match(/- Session ID:\s*(N\/A|[a-zA-Z0-9\-]+)/);
    const planIdMatch = text.match(/- Plan ID:\s*(N\/A|[\w\-]+)/);
    const statusMatch = text.match(/- Status:\s*(N\/A|Active|Superseded|DecisionRecord)/i);
    const sourceCreatedMatch = text.match(/- Source Created:\s*(N\/A|[\d\-T:Z.]+)/i);
    const createdAtMatch = text.match(/- Created:\s*(N\/A|[\d\-T:Z.]+)/i);
    const updatedAtMatch = text.match(/- Updated:\s*(N\/A|[\d\-T:Z.]+)/i);
    
    if (!topicIdMatch || !statusMatch || !createdAtMatch || !updatedAtMatch) {
        console.warn('Failed to parse enriched summary: missing required metadata fields');
        return null;
    }
    
    // Parse context section
    const contextMatch = text.match(/## Context\n([\s\S]+?)(?=\n##|$)/);
    if (!contextMatch) {
        console.warn('Failed to parse enriched summary: missing Context section');
        return null;
    }
    const context = contextMatch[1].trim();
    
    // Create summary with parsed metadata
    const summary: ConversationSummary = {
        topic,
        context,
        decisions: extractSection(text, 'Key Decisions'),
        rationale: extractSection(text, 'Rationale'),
        openQuestions: extractSection(text, 'Open Questions'),
        nextSteps: extractSection(text, 'Next Steps'),
        references: extractSection(text, 'References'),
        timeScope: extractTimeScopeSection(text),
        topicId: topicIdMatch && topicIdMatch[1] !== 'N/A' ? topicIdMatch[1] : null,
        sessionId: sessionIdMatch && sessionIdMatch[1] !== 'N/A' ? sessionIdMatch[1] : null,
        planId: planIdMatch && planIdMatch[1] !== 'N/A' ? planIdMatch[1] : null,
        status: statusMatch && statusMatch[1] !== 'N/A' ? statusMatch[1] as 'Active' | 'Superseded' | 'DecisionRecord' : null,
        sourceCreatedAt: sourceCreatedMatch && sourceCreatedMatch[1] !== 'N/A'
            ? new Date(sourceCreatedMatch[1])
            : (createdAtMatch && createdAtMatch[1] !== 'N/A' ? new Date(createdAtMatch[1]) : null),
        createdAt: createdAtMatch && createdAtMatch[1] !== 'N/A' ? new Date(createdAtMatch[1]) : null,
        updatedAt: updatedAtMatch && updatedAtMatch[1] !== 'N/A' ? new Date(updatedAtMatch[1]) : null
    };
    
    return summary;
}

/**
 * Parse legacy raw-text memory per §4.4.1 mixed-mode support.
 * 
 * Returns partial ConversationSummary with null metadata.
 */
function parseLegacySummary(text: string): ConversationSummary | null {
    // For legacy text, try to extract topic and context if structured
    // Otherwise, use raw text as context
    const topicMatch = text.match(/^Summary:\s*(.+)$/m) || text.match(/^Topic:\s*(.+)$/m);
    const contextMatch = text.match(/^Context:\s*(.+)$/m);
    
    const topic = topicMatch ? topicMatch[1].trim() : 'Legacy Memory';
    const context = contextMatch ? contextMatch[1].trim() : text.substring(0, 200);
    
    // Create summary with null metadata (mixed-mode per §4.4.1)
    const summary = createDefaultSummary(topic, context);
    
    // Override metadata fields to null for legacy mode per §4.4.1
    summary.topicId = null; // Legacy memories don't have stable IDs
    summary.sessionId = null;
    summary.planId = null;
    summary.status = null; // Legacy memories don't have status tracking
    summary.createdAt = null; // Legacy memories don't have timestamp metadata
    summary.updatedAt = null;
    summary.sourceCreatedAt = null;
    
    // Try to parse list sections if present
    if (text.includes('Decisions:')) {
        summary.decisions = extractListSection(text, 'Decisions');
    }
    if (text.includes('Rationale:')) {
        summary.rationale = extractListSection(text, 'Rationale');
    }
    if (text.includes('Open Questions:')) {
        summary.openQuestions = extractListSection(text, 'Open Questions');
    }
    if (text.includes('Next Steps:')) {
        summary.nextSteps = extractListSection(text, 'Next Steps');
    }
    if (text.includes('References:')) {
        summary.references = extractListSection(text, 'References');
    }
    
    return summary;
}

/**
 * Extract a section with deterministic heading per §4.4.1.
 */
function extractSection(text: string, sectionName: string): string[] {
    const sectionRegex = new RegExp(`## ${sectionName}\\n([\\s\\S]+?)(?=\\n##|$)`);
    const match = text.match(sectionRegex);
    
    if (!match) {
        return [];
    }
    
    const sectionText = match[1].trim();
    
    // Check for (none) marker
    if (sectionText === '(none)') {
        return [];
    }
    
    // Extract bullet points
    const lines = sectionText.split('\n');
    const items: string[] = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        const bulletMatch = trimmed.match(/^[-*]\s*(.+)$/);
        if (bulletMatch) {
            items.push(bulletMatch[1].trim());
        }
    }
    
    return items;
}

/**
 * Extract Time Scope section (special format).
 */
function extractTimeScopeSection(text: string): string {
    const match = text.match(/## Time Scope\n([\s\S]+?)(?=\n##|$)/);
    if (!match) {
        return '';
    }
    return match[1].trim();
}

/**
 * Extract a bulleted list section from markdown text.
 * 
 * Finds the section header and extracts all bullet points until
 * the next section header or end of text.
 * 
 * @param text - Full markdown text
 * @param sectionName - Name of the section to extract (e.g., 'Decisions')
 * @returns Array of list items (without bullet markers)
 */
function extractListSection(text: string, sectionName: string): string[] {
    // Find section header
    const sectionRegex = new RegExp(`^${sectionName}:\\s*$`, 'm');
    const sectionMatch = text.match(sectionRegex);
    
    if (!sectionMatch || sectionMatch.index === undefined) {
        return [];
    }
    
    // Extract text after section header
    const startIndex = sectionMatch.index + sectionMatch[0].length;
    const remainingText = text.substring(startIndex);
    
    // Find end of section (next header or end of text)
    const nextSectionMatch = remainingText.match(/^[A-Z][^:\n]+:\s*$/m);
    const endIndex = nextSectionMatch && nextSectionMatch.index !== undefined
        ? nextSectionMatch.index
        : remainingText.length;
    
    const sectionText = remainingText.substring(0, endIndex);
    
    // Extract bullet points
    const lines = sectionText.split('\n');
    const items: string[] = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip empty lines and "None" markers
        if (!trimmed || trimmed.toLowerCase() === '- none' || trimmed.toLowerCase() === 'none') {
            continue;
        }
        
        // Extract bullet point content
        const bulletMatch = trimmed.match(/^[-*]\s*(.+)$/);
        if (bulletMatch) {
            items.push(bulletMatch[1].trim());
        }
    }
    
    return items;
}



/**
 * Validate that a parsed summary round-trips correctly.
 * 
 * Useful for testing: format a summary, parse it back, and verify
 * that the content is preserved.
 * 
 * @param original - Original ConversationSummary
 * @param parsed - Parsed ConversationSummary
 * @returns True if round-trip is valid, false otherwise
 */
export function validateRoundTrip(
    original: ConversationSummary,
    parsed: ConversationSummary
): boolean {
    // Check core content fields
    if (original.topic !== parsed.topic) {
        console.warn('Round-trip validation failed: topic mismatch');
        return false;
    }
    
    if (original.context !== parsed.context) {
        console.warn('Round-trip validation failed: context mismatch');
        return false;
    }
    
    // Check list fields (order-independent)
    if (!arraysEqual(original.decisions, parsed.decisions)) {
        console.warn('Round-trip validation failed: decisions mismatch');
        return false;
    }
    
    if (!arraysEqual(original.rationale, parsed.rationale)) {
        console.warn('Round-trip validation failed: rationale mismatch');
        return false;
    }
    
    if (!arraysEqual(original.openQuestions, parsed.openQuestions)) {
        console.warn('Round-trip validation failed: openQuestions mismatch');
        return false;
    }
    
    if (!arraysEqual(original.nextSteps, parsed.nextSteps)) {
        console.warn('Round-trip validation failed: nextSteps mismatch');
        return false;
    }
    
    if (!arraysEqual(original.references, parsed.references)) {
        console.warn('Round-trip validation failed: references mismatch');
        return false;
    }
    
    // Check metadata fields per §4.4.1
    if (original.topicId !== parsed.topicId) {
        console.warn('Round-trip validation failed: topicId mismatch');
        return false;
    }
    
    if (original.sessionId !== parsed.sessionId) {
        console.warn('Round-trip validation failed: sessionId mismatch');
        return false;
    }
    
    if (original.planId !== parsed.planId) {
        console.warn('Round-trip validation failed: planId mismatch');
        return false;
    }
    
    if (original.status !== parsed.status) {
        console.warn('Round-trip validation failed: status mismatch');
        return false;
    }

    const originalSource = original.sourceCreatedAt ? original.sourceCreatedAt.toISOString() : null;
    const parsedSource = parsed.sourceCreatedAt ? parsed.sourceCreatedAt.toISOString() : null;
    if (originalSource !== parsedSource) {
        console.warn('Round-trip validation failed: sourceCreatedAt mismatch');
        return false;
    }
    
    return true;
}

/**
 * Compare two arrays for equality (order-independent).
 */
function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    
    return sortedA.every((val, index) => val === sortedB[index]);
}
