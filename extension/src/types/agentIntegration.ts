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
export interface CogneeIngestRequest {
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
export interface CogneeIngestResponse {
    /**
     * Whether ingestion succeeded
     */
    success: boolean;

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
        created_at: string;
        updated_at: string;
    };

    /**
     * Ingestion duration in seconds (on success)
     */
    ingestion_duration_sec?: number;

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
export interface CogneeRetrieveRequest {
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

    /**
     * Weight for recency score 0.0-1.0 (optional, default: 0.3)
     */
    recencyWeight?: number;

    /**
     * Weight for importance score 0.0-1.0 (optional, default: 0.2)
     */
    importanceWeight?: number;

    /**
     * Optional caller hint for audit logs
     */
    agentName?: string;
}

/**
 * Single retrieval result
 */
export interface CogneeRetrievalResult {
    /**
     * Retrieved text content
     */
    text: string;

    /**
     * Metadata (if available)
     */
    metadata?: Record<string, any>;

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
export interface CogneeRetrieveResponse {
    /**
     * Whether retrieval succeeded
     */
    success: boolean;

    /**
     * Array of retrieval results (on success)
     */
    results?: CogneeRetrievalResult[];

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
export interface CogneeContextRequest {
    /** Natural language query for memory search */
    query: string;
    
    /** Maximum number of results to return (default: 3) */
    maxResults?: number;
    
    /** Token budget limit for results (default: 2000) */
    maxTokens?: number;
    
    /** Contextual hints to help refine search (optional) */
    contextHints?: string[];
}

/**
 * Single memory entry with structured metadata per RETRIEVE_CONTRACT.md (Plan 016)
 * 
 * Supports mixed-mode retrieval:
 * - Enriched summaries have full metadata (topicId, status, timestamps)
 * - Legacy memories have null metadata fields
 */
export interface CogneeContextEntry {
    /** Full formatted summary text (markdown template) */
    summaryText: string;
    
    /** Key decisions captured in the summary */
    decisions?: string[];
    
    /** Rationale behind decisions */
    rationale?: string[];
    
    /** Short title or topic */
    topic?: string;
    
    /** UUID or stable identifier for the summary's topic */
    topicId?: string | null;
    
    /** Plan number associated with this summary (e.g., "014") */
    planId?: string | null;
    
    /** ISO 8601 timestamp when summary was created */
    createdAt?: string | null;
    
    /** Final relevance score (0.0 to 1.0+) */
    score: number;
}

/**
 * Response structure for agent retrieval operations (Plan 016)
 */
export interface CogneeContextResponse {
    /** Ordered list of memory entries (highest score first) */
    entries: CogneeContextEntry[];
    
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
