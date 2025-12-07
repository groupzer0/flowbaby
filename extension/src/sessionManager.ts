import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';

/**
 * Internal envelope contract for bridge payloads.
 * This interface owns all hidden/internal fields injected into bridge calls.
 */
export interface InternalBridgeEnvelope {
    /**
     * Canonical user session ID.
     * - For chat threads: derived from thread ID, persisted across restarts.
     * - For standalone agent runs: unique per run (or synthetic stable ID).
     */
    __user_session_id?: string;

    /**
     * Allow other properties to pass through (the actual payload).
     */
    [key: string]: unknown;
}

/**
 * Manages the lifecycle of user_session_id.
 * Responsibilities:
 * - Create/lookup session IDs by chat thread ID.
 * - Persist mappings across VS Code restarts via globalState.
 * - Provide session IDs for standalone agent runs.
 * - Graceful degradation (log only) on failure.
 */
export class SessionManager {
    private static readonly STORAGE_KEY_PREFIX = 'flowbaby.session.';
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Retrieves or creates a stable session ID for a given chat thread.
     * Persists the mapping so the same thread gets the same ID across restarts.
     */
    public getSessionIdForChatThread(threadId: string): string {
        try {
            const storageKey = `${SessionManager.STORAGE_KEY_PREFIX}${threadId}`;
            let sessionId = this.context.globalState.get<string>(storageKey);

            if (!sessionId) {
                sessionId = uuidv4();
                this.context.globalState.update(storageKey, sessionId).then(
                    () => {}, // Success
                    (error) => {
                        console.error(`[SessionManager] Failed to persist session ID for thread ${threadId}:`, error);
                    }
                );
            }

            return sessionId;
        } catch (error) {
            console.error(`[SessionManager] Error retrieving session ID for thread ${threadId}:`, error);
            // Graceful degradation: return a temporary ID if persistence fails, or undefined to skip session binding
            // Returning a temp ID ensures the current operation works, even if continuity is lost across restarts.
            return uuidv4(); 
        }
    }

    /**
     * Generates a unique session ID for a standalone agent run (no chat thread).
     * Currently mints a new UUID per run.
     */
    public getSessionIdForAgentRun(): string {
        return uuidv4();
    }

    /**
     * Wraps a payload in the internal bridge envelope, injecting the session ID.
     */
    public wrapPayload<T extends Record<string, unknown>>(payload: T, sessionId?: string): InternalBridgeEnvelope & T {
        const envelope: InternalBridgeEnvelope & T = { ...payload };
        if (sessionId) {
            envelope.__user_session_id = sessionId;
        }
        return envelope;
    }
}
