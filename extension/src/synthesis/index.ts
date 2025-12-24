/**
 * Synthesis Module - Plan 073
 * 
 * Provides TypeScript-side synthesis for Flowbaby retrieval using VS Code's
 * Copilot Language Model API. This eliminates the LLM bottleneck in Cognee's
 * GRAPH_COMPLETION search.
 * 
 * @module synthesis
 */

export {
    synthesizeWithCopilot,
    isCopilotAvailable,
    isNoRelevantContext,
    NO_RELEVANT_CONTEXT_SENTINEL,
    type SynthesisResult
} from './copilotSynthesis';
