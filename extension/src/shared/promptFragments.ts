/**
 * Shared Prompt Fragments for Flowbaby (Plan 063)
 *
 * Provides consistent framing text used across multiple retrieval surfaces
 * to reduce "memory over-trust" and ensure agents understand that memories
 * are supplementary, potentially outdated, and subordinate to current code.
 *
 * Usage:
 * - Chat participant: Prepend to augmented prompt before "Relevant Past Conversations"
 * - retrieveMemoryTool: Prepend to narrative returned to Copilot agents
 *
 * @module shared/promptFragments
 */

/**
 * Context framing instructions prepended to retrieved memory content.
 *
 * This prefix clarifies that:
 * 1. Memories are supplementary context, not authoritative source of truth
 * 2. Memories may be outdated if code/docs have changed since capture
 * 3. Current code and documentation take precedence over historical memories
 * 4. Conflicts between memory and visible code should defer to code
 *
 * Keep this text concise to avoid excessive token overhead (~400 chars).
 *
 * @constant
 */
export const MEMORY_CONTEXT_INSTRUCTIONS = `## Memory Context Guidance

The following memories are supplementary context retrieved from past conversations and decisions.
These memories may be outdated if the codebase or documentation has changed since they were captured.

**When using these memories:**
- Treat them as historical context, not as the authoritative source of truth
- If any memory conflicts with current code, documentation, or explicit user instructions, defer to the current sources
- Flag potential staleness when memory content references specific implementations that may have evolved
- Use memories to understand rationale and past decisions, but verify current state in code

`;
