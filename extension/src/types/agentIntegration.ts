/**
 * TypeScript interfaces for Agent Integration (Plan 015)
 * 
 * These types define the contract for agent ingestion and retrieval
 * commands. They mirror the bridge contract defined in:
 * extension/bridge/INGEST_CONTRACT.md
 */

/**
 * Status enum for conversation summaries
 */
export type SummaryStatus = 'Active' | 'Superseded' | 'DecisionRecord';

/**
 * Metadata for conversation summaries
 */
export interface SummaryMetadata {
    /**
     * Unique identifier for this topic (e.g., "plan-015-implementation")
     */
    topicId: string;

    /**
     * Session identifier (optional, e.g., "session-2025-11-19-001")
     */
    sessionId?: string;

    /**
     * Plan or project identifier (optional, e.g., "015")
     */
    planId?: string;

    /**
     * Summary status
     */
    status?: SummaryStatus;

    /**
     * ISO 8601 timestamp when summary was created
     */
    createdAt: string;

    /**
     * ISO 8601 timestamp for original source creation (optional)
     */
    sourceCreatedAt?: string;

    /**
     * ISO 8601 timestamp when summary was last updated
     */
    updatedAt: string;
}

/**
 * Request payload for agent ingestion
 * 
 * This interface matches the JSON schema expected by ingest.py --summary
 * All field names use camelCase to match TypeScript conventions.
 * 
 * @see extension/bridge/INGEST_CONTRACT.md for complete schema documentation
 */
export interface FlowbabyIngestRequest {
    /**
     * Summary topic/title (required, non-empty)
     */
    topic: string;

    /**
     * Summary context/description (required, non-empty)
     */
    context: string;

    /**
     * List of key decisions made (optional)
     */
    decisions?: string[];

    /**
     * List of rationale items explaining decisions (optional)
     */
    rationale?: string[];

    /**
     * List of open questions remaining (optional)
     */
    openQuestions?: string[];

    /**
     * List of next steps to take (optional)
     */
    nextSteps?: string[];

    /**
     * List of references/links (optional)
     */
    references?: string[];

    /**
     * Time scope description (optional, e.g., "2025-11-19T08:00:00Z to 09:30:00Z (15 turns)")
     */
    timeScope?: string;

    /**
     * Metadata (topicId, sessionId, planId, status, timestamps)
     * 
     * Note: createdAt and updatedAt are required by the bridge contract
     */
    metadata: SummaryMetadata;

    /**
     * Optional caller hint for audit logs (e.g., "GitHub Copilot", "Custom Agent")
     * This is for logging only; VS Code does not expose extension identity
     */
    agentName?: string;
}

/**
 * Response from agent ingestion command
 */
export interface FlowbabyIngestResponse {
    /**
     * Whether ingestion succeeded
     */
    success: boolean;

    /**
     * Whether data was staged (async mode) - Plan 017
     */
    staged?: boolean;

    /**
     * Background operation ID (async mode) - Plan 017
     */
    operationId?: string;

    /**
     * Number of characters ingested (on success)
     */
    ingested_chars?: number;

    /**
     * ISO 8601 timestamp of ingestion (on success)
     */
    timestamp?: string;

    /**
     * Metadata confirmation (on success)
     */
    metadata?: {
        topic_id: string;
        session_id?: string;
        plan_id?: string;
        status: string;
        source_created_at?: string;
        created_at: string;
        updated_at: string;
    };

    /**
     * Ingestion duration in seconds (on success, sync mode)
     */
    ingestion_duration_sec?: number;

    /**
     * Staging duration in seconds (on success, async mode) - Plan 017
     */
    staging_duration_sec?: number;

    /**
     * Detailed performance metrics (on success)
     */
    ingestion_metrics?: Record<string, number>;

    /**
     * Error message (on failure)
     */
    error?: string;

    /**
     * Error code for programmatic handling (on failure)
     */
    errorCode?: string;
}

/**
 * Request payload for agent retrieval
 * 
 * This interface matches the expected parameters for retrieve.py
 * 
 * @see extension/bridge/RETRIEVE_CONTRACT.md for complete schema documentation
 */
export interface FlowbabyRetrieveRequest {
    /**
     * Search query string
     */
    query: string;

    /**
     * Maximum number of results to return (optional, default: 3)
     */
    maxResults?: number;

    /**
     * Maximum total tokens across results (optional, default: 2000)
     */
    maxTokens?: number;

    /** Include superseded summaries (default: false) */
    includeSuperseded?: boolean;

    /** Half-life parameter (days) for recency decay; derives decay alpha internally */
    halfLifeDays?: number;

    /**
     * Optional caller hint for audit logs
     */
    agentName?: string;
}

/**
 * Single retrieval result
 */
export interface FlowbabyRetrievalResult {
    /**
     * Retrieved text content
     */
    text: string;

    /**
     * Metadata (if available) - contains dynamic JSON from Python bridge
     */
    metadata?: Record<string, unknown>;

    /**
     * Final weighted score
     */
    score: number;

    /**
     * Base relevance score from Cognee
     */
    base_score?: number;

    /**
     * Recency score (0.0-1.0)
     */
    recency_score?: number;

    /**
     * Importance score (0.0-1.0)
     */
    importance_score?: number;
}

/**
 * Response from agent retrieval command
 */
export interface FlowbabyRetrieveResponse {
    /**
     * Whether retrieval succeeded
     */
    success: boolean;

    /**
     * Array of retrieval results (on success)
     */
    results?: FlowbabyRetrievalResult[];

    /**
     * Number of results returned (on success)
     */
    result_count?: number;

    /**
     * Total tokens across all results (on success)
     */
    total_tokens?: number;

    /**
     * Retrieval duration in seconds (on success)
     */
    retrieval_duration_sec?: number;

    /**
     * Error message (on failure)
     */
    error?: string;

    /**
     * Error code for programmatic handling (on failure)
     */
    errorCode?: string;
}

/**
 * Validation result for ingest requests
 */
export interface ValidationResult {
    /**
     * Whether validation passed
     */
    valid: boolean;

    /**
     * Array of error messages (if validation failed)
     */
    errors: string[];
}

/**
 * Request structure for agent retrieval operations (Plan 016)
 */
export interface FlowbabyContextRequest {
    /** Natural language query for memory search */
    query: string;
    
    /** Maximum number of results to return (default: 3) */
    maxResults?: number;
    
    /** Token budget limit for results (default: 2000) */
    maxTokens?: number;
    
    /** Contextual hints to help refine search (optional) */
    contextHints?: string[];

    /** Whether to include Superseded entries (default: false) */
    includeSuperseded?: boolean;

    /** Half-life parameter for recency decay (days, default configured value) */
    halfLifeDays?: number;
}

/**
 * Single memory entry with structured metadata per RETRIEVE_CONTRACT.md (Plan 016)
 * 
 * Supports mixed-mode retrieval:
 * - Enriched summaries have full metadata (topicId, status, timestamps)
 * - Legacy memories have null metadata fields
 */
export interface FlowbabyContextEntry {
    /** Full formatted summary text (markdown template) */
    summaryText: string;
    
    /** Key decisions captured in the summary */
    decisions?: string[];
    
    /** Rationale behind decisions */
    rationale?: string[];

    /** Open questions still unresolved */
    openQuestions?: string[];

    /** Next steps or follow-up actions */
    nextSteps?: string[];

    /** Reference links or citations */
    references?: string[];
    
    /** Short title or topic */
    topic?: string;
    
    /** UUID or stable identifier for the summary's topic */
    topicId?: string | null;
    
    /** Session identifier for traceability */
    sessionId?: string | null;

    /** Plan number associated with this summary (e.g., "014") */
    planId?: string | null;

    /** Summary status indicator */
    status?: SummaryStatus | null;
    
    /** ISO 8601 timestamp when summary was created */
    createdAt?: string | null;

    /** ISO 8601 timestamp when source content was created */
    sourceCreatedAt?: string | null;

    /** ISO 8601 timestamp when summary was last updated */
    updatedAt?: string | null;
    
    /** Final relevance score (0.0 to 1.0+) */
    finalScore: number;

    /** @deprecated Use finalScore instead */
    score?: number;

    /** Confidence label for qualitative display */
    confidenceLabel?: 'synthesized_high' | 'normal';

    /** Estimated tokens consumed by this entry */
    tokens?: number;
}

/**
 * Response structure for agent retrieval operations (Plan 016)
 */
export interface FlowbabyContextResponse {
    /** Ordered list of memory entries (highest score first) */
    entries: FlowbabyContextEntry[];
    
    /** Total number of results considered */
    totalResults: number;
    
    /** Approximate token count of all returned results */
    tokensUsed: number;
}

/**
 * Error codes for agent integration operations (Plan 016)
 * Aligned with Epic 0.2.3.1 global error taxonomy
 */
export enum AgentErrorCode {
    /** Agent access is disabled via settings */
    ACCESS_DISABLED = 'ACCESS_DISABLED',
    
    /** Rate limit exceeded (requests per minute) */
    RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
    
    /** Concurrency limit exceeded (max in-flight requests) */
    QUEUE_FULL = 'QUEUE_FULL',
    
    /** Bridge operation timed out */
    BRIDGE_TIMEOUT = 'BRIDGE_TIMEOUT',
    
    /** Invalid request payload (malformed JSON, missing fields) */
    INVALID_REQUEST = 'INVALID_REQUEST'
}

/**
 * Structured error response for agent operations (Plan 016)
 */
export interface AgentErrorResponse {
    /** Machine-readable error code */
    error: AgentErrorCode;
    
    /** Human-readable error message */
    message: string;
    
    /** Optional details for debugging */
    details?: string;
}
