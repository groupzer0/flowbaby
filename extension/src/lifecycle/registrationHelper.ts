import * as vscode from 'vscode';
import { debugLog } from '../outputChannels';

type ActivationLedgerState = {
    activationId: number;
    activationStart: number;
    activationEnd?: number;
    initStart?: number;
    initEnd?: number;
    initDurationMs?: number;
    workspacePath?: string;
    healthStatus?: string;
    requirementsStatus?: string;
    initResult?: { success?: boolean; error?: string };
    toolsRegistered?: boolean;
    participantRegistered?: boolean;
    contextDisposedProbeFlag?: string;
    contextDisposedAtStart?: boolean;
    activationCountSinceLastDeactivation: number;
    suiteTag?: string;
    fallbackCountAtDeactivation?: number;
    firstRegistrationAt?: number;
};

type ActivationLedgerEvent = {
    activationId: number;
    eventType: 'start' | 'update' | 'end' | 'deactivate' | 'registration' | 'anomaly' | 'prompt';
    timestamp: number;
    workspacePath?: string;
    registrationKind?: RegistrationIntent['kind'];
    contextState?: {
        disposed?: boolean;
        flag?: string;
        probeSignals?: Array<[string, unknown]>;
        fallbackUsed?: boolean;
    };
    phase?: 'activation' | 'registration' | 'deactivation' | 'prompt';
    details?: Record<string, unknown>;
};

type ActivationLedgerEntry = {
    activationId: number;
    latest: ActivationLedgerState;
    events: ActivationLedgerEvent[];
};

type RegistrationIntent = {
    kind: 'command' | 'tool' | 'participant' | 'watcher' | 'other';
    id?: string;
    note?: string;
};

type HostToolSnapshot = {
    names?: string[];
    hasFlowbabyTools?: boolean;
    error?: string;
};

type SafePushOptions = {
    intent?: RegistrationIntent;
    hostTools?: HostToolSnapshot;
    stack?: string;
};

type ContextFingerprint = {
    constructorName?: string;
    ownPropertyNames: string[];
    ownSymbolNames: string[];
    booleanProperties: Array<{ key: string; value: boolean }>;
    prototypeChain: string[];
};

/**
 * Module-level state to track extension activation status.
 * This guards against async operations attempting to register disposables
 * after the extension has been deactivated.
 */
let isExtensionActive = false;
let activeContext: vscode.ExtensionContext | undefined;
let isActiveContextDisposed = false;
let activationSequence = 0;
let activeContextInfo: { activationId: number; activatedAt: number } | undefined;
let activeContextDisposalWatcher: vscode.Disposable | undefined;
let fallbackDisposables: vscode.Disposable[] = [];
let fallbackActivationId: number | undefined;
let activationsSinceLastDeactivation = 0;
const activationLedger = new Map<number, ActivationLedgerEntry>();

function getSuiteTag(): string | undefined {
    return process.env.FLOWBABY_TEST_SUITE || process.env.MOCHA_FILE || undefined;
}

function getActiveLedgerEntry(): ActivationLedgerEntry | undefined {
    if (!activeContextInfo?.activationId) {
        return undefined;
    }
    const existing = activationLedger.get(activeContextInfo.activationId);
    if (existing) {
        return existing;
    }
    const entry: ActivationLedgerEntry = {
        activationId: activeContextInfo.activationId,
        latest: {
            activationId: activeContextInfo.activationId,
            activationStart: Date.now(),
            activationCountSinceLastDeactivation: activationsSinceLastDeactivation,
            suiteTag: getSuiteTag()
        },
        events: []
    };
    activationLedger.set(activeContextInfo.activationId, entry);
    return entry;
}

function logLedgerEvent(event: ActivationLedgerEvent) {
    debugLog('Activation ledger event', event);
}

function appendLedgerEvent(eventType: ActivationLedgerEvent['eventType'], update: Partial<ActivationLedgerState> = {}, details?: Record<string, unknown>) {
    const entry = getActiveLedgerEntry();
    if (!entry) {
        return;
    }
    entry.latest = { ...entry.latest, ...update };
    const event: ActivationLedgerEvent = {
        activationId: entry.activationId,
        eventType,
        timestamp: Date.now(),
        workspacePath: entry.latest.workspacePath,
        registrationKind: (details?.intent as RegistrationIntent | undefined)?.kind,
        contextState: details?.contextState as ActivationLedgerEvent['contextState'],
        phase: details?.phase as ActivationLedgerEvent['phase'],
        details
    };
    if (eventType === 'registration' && !entry.latest.firstRegistrationAt) {
        entry.latest.firstRegistrationAt = event.timestamp;
    }
    entry.events.push(event);
    logLedgerEvent(event);
}

function startLedger(probeFlag?: string, disposedAtStart?: boolean) {
    const entry = getActiveLedgerEntry();
    if (!entry) {
        return;
    }
    entry.latest = {
        ...entry.latest,
        contextDisposedProbeFlag: probeFlag,
        contextDisposedAtStart: disposedAtStart,
        activationStart: Date.now(),
        activationCountSinceLastDeactivation: activationsSinceLastDeactivation,
        suiteTag: getSuiteTag()
    };
    appendLedgerEvent('start', entry.latest, { phase: 'activation' });
}

function endLedger(update: Partial<ActivationLedgerState>) {
    const entry = getActiveLedgerEntry();
    if (!entry) {
        return;
    }
    const latest = { ...entry.latest, ...update, activationEnd: Date.now() };
    entry.latest = latest;
    appendLedgerEvent('end', latest, { phase: 'activation' });
}

export function getActivationLedgerSnapshot(): ActivationLedgerEntry | undefined {
    const entry = getActiveLedgerEntry();
    if (!entry) {
        return undefined;
    }
    return {
        activationId: entry.activationId,
        latest: { ...entry.latest },
        events: [...entry.events]
    };
}

export function recordActivationMetadata(update: Partial<ActivationLedgerState>) {
    appendLedgerEvent('update', update, { phase: 'activation' });
}

export function recordActivationCompletion(update: Partial<ActivationLedgerState>) {
    endLedger(update);
}

export function recordDeactivationEvent(fallbackCount: number) {
    const entry = getActiveLedgerEntry();
    if (entry) {
        entry.latest = { ...entry.latest, fallbackCountAtDeactivation: fallbackCount };
        appendLedgerEvent('deactivate', entry.latest, { phase: 'deactivation', details: { fallbackCount } });
    }
    activationsSinceLastDeactivation = 0;
}

function createContextDisposalWatcher(context: vscode.ExtensionContext): vscode.Disposable {
    const activationId = activeContextInfo?.activationId;
    return new vscode.Disposable(() => {
        if (activeContext !== context) {
            return;
        }
        isActiveContextDisposed = true;
        isExtensionActive = false;
        debugLog('Extension context subscriptions disposed', { activationId });
    });
}

function disposeFallbackDisposables() {
    for (const disposable of fallbackDisposables) {
        try {
            disposable.dispose();
        } catch (error) {
            debugLog('Failed to dispose fallback disposable', { error: String(error) });
        }
    }
    fallbackDisposables = [];
    fallbackActivationId = undefined;
}

export function getFallbackDisposableCount(): number {
    return fallbackDisposables.length;
}

/**
 * Set the activation state of the extension.
 * Should be called at the very start of activate() and deactivate().
 */
export function setExtensionActive(active: boolean) {
    isExtensionActive = active;
}

/**
 * Record the current activation context so we can detect registrations
 * that target a disposed subscriptions store.
 */
export function setActiveContext(context: vscode.ExtensionContext) {
    const sameContext = activeContext === context;
    // Always treat a call to setActiveContext as a fresh activation boundary.
    // Tests reuse the same ExtensionContext instance across activate/deactivate cycles,
    // so we must clear disposed state even when the reference is unchanged.
    activeContext = context;
    isActiveContextDisposed = false;
    disposeFallbackDisposables();
    activationSequence += 1;
    activationsSinceLastDeactivation += 1;
    activeContextInfo = { activationId: activationSequence, activatedAt: Date.now() };
    fallbackActivationId = activationSequence;

    const probe = probeContextDisposed(context);
    if (probe.disposed) {
        isActiveContextDisposed = true;
        debugLog('Active context subscriptions appear disposed; using fallback registrations', {
            activationId: activationSequence,
            flag: probe.flag
        });
        startLedger(probe.flag, true);
    }

    if (!probe.disposed) {
        startLedger(probe.flag, false);
        const previousWatcher = activeContextDisposalWatcher;
        const tryPushResult = shouldRunTryPushProbe() ? runTryPushProbe(context.subscriptions as { push: (d: vscode.Disposable) => void }) : { success: true };
        if (!tryPushResult.success) {
            debugLog('Context subscriptions failed tryPushProbe; treating as disposed to avoid watcher push', {
                activationId: activationSequence,
                errorName: tryPushResult.errorName,
                errorMessage: tryPushResult.errorMessage
            });
            isActiveContextDisposed = true;
            appendLedgerEvent('update', { contextDisposedAtStart: true, contextDisposedProbeFlag: probe.flag }, { phase: 'activation', details: { tryPushResult } });
            if (previousWatcher) {
                previousWatcher.dispose();
            }
            return;
        }
        activeContextDisposalWatcher = createContextDisposalWatcher(context);
        try {
            context.subscriptions.push(activeContextDisposalWatcher);
        } catch (error) {
            debugLog('Failed to attach context disposal watcher', { error: String(error), activationId: activationSequence });
            activeContextDisposalWatcher = undefined;
            isActiveContextDisposed = true;
            appendLedgerEvent('update', { contextDisposedAtStart: true, contextDisposedProbeFlag: probe.flag }, { phase: 'activation' });
        }
        if (previousWatcher) {
            previousWatcher.dispose();
        }
    } else if (activeContextDisposalWatcher) {
        activeContextDisposalWatcher.dispose();
        activeContextDisposalWatcher = undefined;
    }
}

/**
 * Mark the previously recorded activation context as disposed.
 * This allows safePush to short-circuit rather than writing into
 * a disposed DisposableStore (which triggers VS Code warnings).
 */
export function markActiveContextDisposed() {
    isActiveContextDisposed = true;
    if (activeContextInfo) {
        activeContextInfo = { ...activeContextInfo, activatedAt: activeContextInfo.activatedAt };
    }
    if (activeContextDisposalWatcher) {
        activeContextDisposalWatcher.dispose();
        activeContextDisposalWatcher = undefined;
    }
    disposeFallbackDisposables();
}

/**
 * Check if the extension is currently active.
 */
export function isActive(): boolean {
    return isExtensionActive;
}

/**
 * Get the extension ID from the activation context.
 * 
 * Plan 106: Provides a non-hardcoded source for the extension ID.
 * Returns undefined if no activation context is available.
 * 
 * @returns The extension ID (e.g., 'Flowbaby.flowbaby') or undefined
 */
export function getActiveExtensionId(): string | undefined {
    return activeContext?.extension?.id;
}

/**
 * Return diagnostic details for the currently tracked activation context.
 */
export function getActiveContextDiagnostics(): {
    context: vscode.ExtensionContext | undefined;
    disposed: boolean;
    activationId: number | undefined;
    activatedAt: number | undefined;
    activationCountSinceLastDeactivation?: number;
    suiteTag?: string;
} {
    const ledger = getActivationLedgerSnapshot();
    return {
        context: activeContext,
        disposed: isActiveContextDisposed,
        activationId: activeContextInfo?.activationId,
        activatedAt: activeContextInfo?.activatedAt,
        activationCountSinceLastDeactivation: ledger?.latest.activationCountSinceLastDeactivation,
        suiteTag: ledger?.latest.suiteTag
    };
}

function detectSubscriptionsDisposed(subscriptions: unknown): { disposed: boolean; flag?: string; signals?: Array<[string, unknown]> } {
    if (!subscriptions) {
        return { disposed: false };
    }

    const results: Array<[string, unknown]> = [];
    const candidate = subscriptions as {
        isDisposed?: boolean | (() => boolean);
        _isDisposed?: boolean;
        disposed?: boolean;
    };

    if (typeof candidate.isDisposed === 'function') {
        try {
            results.push(['isDisposed()', candidate.isDisposed()]);
        } catch (error) {
            debugLog('safePush probe: failed to call isDisposed()', { error: String(error) });
        }
    } else if (typeof candidate.isDisposed !== 'undefined') {
        results.push(['isDisposed', candidate.isDisposed]);
    }

    if (typeof candidate._isDisposed !== 'undefined') {
        results.push(['_isDisposed', candidate._isDisposed]);
    }

    if (typeof candidate.disposed !== 'undefined') {
        results.push(['disposed', candidate.disposed]);
    }

    for (const symbol of Object.getOwnPropertySymbols(candidate)) {
        const value = (candidate as Record<symbol, unknown>)[symbol];
        if (typeof value === 'boolean') {
            results.push([`symbol:${String(symbol.description) || symbol.toString()}`, value]);
        } else if (typeof value === 'function') {
            try {
                results.push([`symbol-fn:${String(symbol.description) || symbol.toString()}`, value.call(candidate)]);
            } catch (error) {
                debugLog('safePush probe: failed to call symbol function', { symbol: String(symbol), error: String(error) });
            }
        }
    }

    const hit = results.find(([, value]) => value === true);
    return { disposed: Boolean(hit?.[1]), flag: hit?.[0], signals: results };
}

function fingerprintSubscriptions(subscriptions: unknown): ContextFingerprint | undefined {
    if (!subscriptions || typeof subscriptions !== 'object') {
        return undefined;
    }
    const target = subscriptions as Record<string | symbol, unknown>;
    const ownPropertyNames = Object.getOwnPropertyNames(target);
    const ownSymbolNames = Object.getOwnPropertySymbols(target).map(symbol => String(symbol.description || symbol.toString()));
    const booleanProperties: Array<{ key: string; value: boolean }> = [];

    for (const key of ownPropertyNames) {
        const value = target[key];
        if (typeof value === 'boolean') {
            booleanProperties.push({ key, value });
        }
    }
    for (const symbol of Object.getOwnPropertySymbols(target)) {
        const value = target[symbol];
        if (typeof value === 'boolean') {
            booleanProperties.push({ key: `symbol:${String(symbol.description) || symbol.toString()}`, value });
        }
    }

    const prototypeChain: string[] = [];
    const seen = new Set<unknown>();
    let proto: unknown = Object.getPrototypeOf(target);
    while (proto && typeof proto === 'object' && !seen.has(proto)) {
        const constructorName = (proto as { constructor?: { name?: string } }).constructor?.name;
        if (constructorName) {
            prototypeChain.push(constructorName);
        }
        seen.add(proto);
        proto = Object.getPrototypeOf(proto);
    }

    return {
        constructorName: (target as { constructor?: { name?: string } }).constructor?.name,
        ownPropertyNames,
        ownSymbolNames,
        booleanProperties,
        prototypeChain
    };
}

function stableHash(value: unknown): string | undefined {
    try {
        const json = JSON.stringify(value);
        let hash = 0;
        for (let i = 0; i < json.length; i++) {
            const chr = json.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0; // Convert to 32bit integer
        }
        return `h${Math.abs(hash)}`;
    } catch (error) {
        debugLog('Failed to hash fingerprint', { error: String(error) });
        return undefined;
    }
}

function shouldRunTryPushProbe(): boolean {
    return process.env.NODE_ENV === 'test';
}

function runTryPushProbe(subscriptions: { push: (d: vscode.Disposable) => void }): { success: boolean; errorName?: string; errorMessage?: string } {
    const noopDisposable = new vscode.Disposable(() => {});
    try {
        subscriptions.push(noopDisposable);
        noopDisposable.dispose();
        return { success: true };
    } catch (error) {
        return {
            success: false,
            errorName: error instanceof Error ? error.name : undefined,
            errorMessage: error instanceof Error ? error.message : String(error)
        };
    }
}

function addToFallback(disposable: vscode.Disposable, activationId: number | undefined, reason: string, intent?: RegistrationIntent) {
    fallbackDisposables.push(disposable);
    debugLog('Registered disposable in fallback store', { activationId, reason, intent, count: fallbackDisposables.length, fallbackActivationId });
}

export function probeContextDisposed(context: vscode.ExtensionContext | undefined): { disposed: boolean; flag?: string } {
    if (!context) {
        return { disposed: false };
    }

    const subscriptions = (context as unknown as { subscriptions?: unknown }).subscriptions;
    return detectSubscriptionsDisposed(subscriptions);
}

/**
 * Safely push a disposable to the extension context subscriptions.
 * If the extension has been deactivated, the disposable is disposed immediately
 * and a warning is logged with a stack trace.
 */
export function safePush(context: vscode.ExtensionContext, disposable: vscode.Disposable, options?: SafePushOptions) {
    const isKnownContext = activeContext && context === activeContext;
    const contextDisposed = isKnownContext && isActiveContextDisposed;
    const activationId = isKnownContext ? activeContextInfo?.activationId : undefined;
    const ledgerSnapshot = getActivationLedgerSnapshot();
    const suiteTag = ledgerSnapshot?.latest.suiteTag || getSuiteTag();
    const intent = options?.intent ?? { kind: 'other' as const };

    const buildAnomalyPayload = (reason: string, probe: ReturnType<typeof detectSubscriptionsDisposed>, error?: unknown, postProbe?: ReturnType<typeof detectSubscriptionsDisposed>) => {
        const fingerprint = shouldRunTryPushProbe() ? fingerprintSubscriptions(context.subscriptions) : undefined;
        const fingerprintHash = fingerprint ? stableHash(fingerprint) : undefined;
        const tryPush = shouldRunTryPushProbe() ? runTryPushProbe(context.subscriptions as { push: (d: vscode.Disposable) => void }) : undefined;
        const stack = options?.stack ?? new Error(`safePush anomaly: ${reason}`).stack;
        return {
            activationId,
            suiteTag,
            intent,
            probe: { pre: probe, post: postProbe },
            contextDisposed,
            isActiveContextDisposed,
            ledger: ledgerSnapshot,
            fingerprint,
            fingerprintHash,
            tryPush,
            hostTools: options?.hostTools,
            stack,
            error: error instanceof Error ? { name: error.name, message: error.message } : error ? { message: String(error) } : undefined
        };
    };

    if (!isExtensionActive) {
        const stack = options?.stack ?? new Error('Registration after deactivation').stack;
        console.warn('Attempted to register disposable after extension deactivation', stack);
        debugLog('Attempted to register disposable after deactivation', { stack, activationId, intent, ledger: ledgerSnapshot, suiteTag });
        disposable.dispose();
        return;
    }

    const subscriptions = context.subscriptions as unknown as { push: (d: vscode.Disposable) => void };
    const probe = detectSubscriptionsDisposed(subscriptions);
    const isDisposed = contextDisposed || probe.disposed;

    appendLedgerEvent('registration', {
        activationId: activationId ?? ledgerSnapshot?.latest.activationId ?? -1,
        activationStart: ledgerSnapshot?.latest.activationStart ?? Date.now(),
        activationCountSinceLastDeactivation: ledgerSnapshot?.latest.activationCountSinceLastDeactivation ?? activationsSinceLastDeactivation,
        suiteTag
    }, {
        phase: 'registration',
        registrationKind: intent.kind,
        contextState: { disposed: isDisposed, flag: probe.flag, probeSignals: probe.signals, fallbackUsed: false },
        details: { intent, hostTools: options?.hostTools, isActiveContextDisposed }
    });

    if (isDisposed) {
        const anomaly = buildAnomalyPayload('context-disposed', probe);
        console.warn('safePush short-circuited: context subscriptions disposed', { activationId, flag: probe.flag });
        debugLog('Attempted to register disposable on disposed context', anomaly);
        if (shouldRunTryPushProbe()) {
            console.warn('safePush anomaly detail (context-disposed)', anomaly);
        }
        addToFallback(disposable, activationId, 'probe-disposed', intent);
        appendLedgerEvent('anomaly', {
            activationId: activationId ?? ledgerSnapshot?.latest.activationId ?? -1,
            activationStart: ledgerSnapshot?.latest.activationStart ?? Date.now(),
            activationCountSinceLastDeactivation: ledgerSnapshot?.latest.activationCountSinceLastDeactivation ?? activationsSinceLastDeactivation,
            suiteTag
        }, {
            phase: 'registration',
            registrationKind: intent.kind,
            contextState: { disposed: true, flag: probe.flag, probeSignals: probe.signals, fallbackUsed: true },
            details: anomaly
        });
        if (isKnownContext) {
            isActiveContextDisposed = true;
        }
        return;
    }

    try {
        context.subscriptions.push(disposable);
        appendLedgerEvent('registration', {
            activationId: activationId ?? ledgerSnapshot?.latest.activationId ?? -1,
            activationStart: ledgerSnapshot?.latest.activationStart ?? Date.now(),
            activationCountSinceLastDeactivation: ledgerSnapshot?.latest.activationCountSinceLastDeactivation ?? activationsSinceLastDeactivation,
            suiteTag
        }, {
            phase: 'registration',
            registrationKind: intent.kind,
            contextState: { disposed: false, flag: probe.flag, probeSignals: probe.signals, fallbackUsed: false },
            details: { intent, hostTools: options?.hostTools, result: 'pushed', isActiveContextDisposed }
        });
    } catch (error) {
        const postProbe = detectSubscriptionsDisposed(subscriptions);
        const anomaly = buildAnomalyPayload('push-threw', probe, error, postProbe);
        console.warn('safePush failed: push threw (likely disposed)', { activationId, flag: probe.flag, error: error instanceof Error ? error.message : String(error) });
        debugLog('Failed to push to context.subscriptions', anomaly);
        if (shouldRunTryPushProbe()) {
            console.warn('safePush anomaly detail (push-threw)', anomaly);
        }
        if (isKnownContext) {
            isActiveContextDisposed = true;
        }
        addToFallback(disposable, activationId, 'push-threw', intent);
        appendLedgerEvent('anomaly', {
            activationId: activationId ?? ledgerSnapshot?.latest.activationId ?? -1,
            activationStart: ledgerSnapshot?.latest.activationStart ?? Date.now(),
            activationCountSinceLastDeactivation: ledgerSnapshot?.latest.activationCountSinceLastDeactivation ?? activationsSinceLastDeactivation,
            suiteTag
        }, {
            phase: 'registration',
            registrationKind: intent.kind,
            contextState: { disposed: true, flag: postProbe.flag, probeSignals: postProbe.signals, fallbackUsed: true },
            details: anomaly
        });
    }
}

export function recordRegistrationGuardEvent(kind: RegistrationIntent['kind'], details: Record<string, unknown>, contextState?: ActivationLedgerEvent['contextState']) {
    const snapshot = getActivationLedgerSnapshot();
    const update: Partial<ActivationLedgerState> = {
        activationId: snapshot?.latest.activationId ?? activeContextInfo?.activationId ?? -1,
        activationStart: snapshot?.latest.activationStart ?? Date.now(),
        activationCountSinceLastDeactivation: snapshot?.latest.activationCountSinceLastDeactivation ?? activationsSinceLastDeactivation,
        suiteTag: snapshot?.latest.suiteTag ?? getSuiteTag()
    };
    appendLedgerEvent('registration', update, {
        phase: 'registration',
        registrationKind: kind,
        contextState,
        details
    });
}

export function recordPromptEvent(reason: string, mode: 'scheduled' | 'suppressed', details?: Record<string, unknown>) {
    const snapshot = getActivationLedgerSnapshot();
    const update: Partial<ActivationLedgerState> = {
        activationId: snapshot?.latest.activationId ?? activeContextInfo?.activationId ?? -1,
        activationStart: snapshot?.latest.activationStart ?? Date.now(),
        activationCountSinceLastDeactivation: snapshot?.latest.activationCountSinceLastDeactivation ?? activationsSinceLastDeactivation,
        suiteTag: snapshot?.latest.suiteTag ?? getSuiteTag()
    };
    appendLedgerEvent('prompt', update, { phase: 'prompt', ...(details || {}), reason, mode });
}

/**
 * Helper to register a command and safely push it to subscriptions.
 */
export function registerCommand(
    context: vscode.ExtensionContext,
    commandId: string,
    callback: (...args: unknown[]) => unknown,
    thisArg?: unknown
) {
    const disposable = vscode.commands.registerCommand(commandId, callback, thisArg);
    safePush(context, disposable, { intent: { kind: 'command', id: commandId } });
}

// --- Idempotent Registration Guards ---

let toolsRegistered = false;
let participantRegistered = false;

/**
 * Check if language model tools are already registered in this host.
 */
export function areToolsRegistered(): boolean {
    return toolsRegistered;
}

/**
 * Mark language model tools as registered.
 */
export function setToolsRegistered(value: boolean) {
    toolsRegistered = value;
    appendLedgerEvent('registration', { toolsRegistered: value }, { phase: 'registration', registrationKind: 'tool' });
}

/**
 * Check if the chat participant is already registered in this host.
 */
export function isParticipantRegistered(): boolean {
    return participantRegistered;
}

/**
 * Mark the chat participant as registered.
 */
export function setParticipantRegistered(value: boolean) {
    participantRegistered = value;
    appendLedgerEvent('registration', { participantRegistered: value }, { phase: 'registration', registrationKind: 'participant' });
}

/**
 * Reset all registration guards.
 * Should be called at the end of deactivate() to allow re-registration
 * if the extension is reactivated in the same host (e.g. tests).
 */
export function resetRegistrationGuards() {
    toolsRegistered = false;
    participantRegistered = false;
    appendLedgerEvent('update', { toolsRegistered: false, participantRegistered: false }, { phase: 'activation', details: { reason: 'resetRegistrationGuards' } });
}

/**
 * Dispose any fallbacks created when context.subscriptions was already disposed.
 * Should be invoked during deactivate() to avoid leaks in long-running hosts.
 */
export function disposeFallbackRegistrations() {
    disposeFallbackDisposables();
}

// Test-only helper to reset module state between unit tests
export function __resetRegistrationHelperStateForTests() {
    if (process.env.NODE_ENV !== 'test') {
        return;
    }
    isExtensionActive = false;
    activeContext = undefined;
    isActiveContextDisposed = false;
    activationSequence = 0;
    activeContextInfo = undefined;
    if (activeContextDisposalWatcher) {
        activeContextDisposalWatcher.dispose();
    }
    activeContextDisposalWatcher = undefined;
    fallbackDisposables = [];
    fallbackActivationId = undefined;
    activationsSinceLastDeactivation = 0;
    activationLedger.clear();
    toolsRegistered = false;
    participantRegistered = false;
}

// --- Duplicate-Error Classification (Plan 056) ---
// Architecture Invariant 4.2.6: Centralized helpers encapsulate recognized
// host error codes/messages for "already registered and healthy" scenarios.
// These are the ONLY place allowed to classify errors as known duplicates.

/**
 * Known duplicate-registration error patterns for language model tools.
 * VS Code may throw these when a tool with the same name is already registered.
 * Update this list (with tests) when VS Code host behavior evolves.
 */
const KNOWN_DUPLICATE_TOOL_ERROR_PATTERNS: Array<{ code?: string; messageIncludes?: string }> = [
    { messageIncludes: 'already registered' },
    { messageIncludes: 'Tool with name' },
    { messageIncludes: 'duplicate tool' },
    { code: 'tool_already_registered' }
];

/**
 * Known duplicate-registration error patterns for chat participants.
 * VS Code may throw these when a participant with the same ID is already registered.
 */
const KNOWN_DUPLICATE_PARTICIPANT_ERROR_PATTERNS: Array<{ code?: string; messageIncludes?: string }> = [
    { messageIncludes: 'already has implementation' },
    { messageIncludes: 'agent already' },
    { messageIncludes: 'participant already registered' },
    { code: 'participant_already_registered' }
];

/**
 * Classify whether an error from vscode.lm.registerTool is a well-understood
 * duplicate-registration error indicating "tool already registered and healthy".
 * 
 * Per Plan 056 / Invariant 4.2.2: Only return true for clearly recognized patterns.
 * Unknown errors must return false so guards remain false and registration can retry.
 */
export function isKnownDuplicateToolError(error: unknown): boolean {
    if (!error) {
        return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string }).code;

    return KNOWN_DUPLICATE_TOOL_ERROR_PATTERNS.some(pattern => {
        if (pattern.code && code === pattern.code) {
            return true;
        }
        if (pattern.messageIncludes && message.toLowerCase().includes(pattern.messageIncludes.toLowerCase())) {
            return true;
        }
        return false;
    });
}

/**
 * Classify whether an error from vscode.chat.createChatParticipant is a
 * well-understood duplicate-registration error meaning "participant already registered and healthy".
 */
export function isKnownDuplicateParticipantError(error: unknown): boolean {
    if (!error) {
        return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string }).code;

    return KNOWN_DUPLICATE_PARTICIPANT_ERROR_PATTERNS.some(pattern => {
        if (pattern.code && code === pattern.code) {
            return true;
        }
        if (pattern.messageIncludes && message.toLowerCase().includes(pattern.messageIncludes.toLowerCase())) {
            return true;
        }
        return false;
    });
}

/**
 * Create a compact, schema-stable snapshot of the host tool inventory
 * for diagnostics and optional telemetry. Per Invariant 4.3.3, this data
 * is observational only and must never be used for guard decisions.
 */
export function createHostToolSnapshot(tools: ReadonlyArray<{ name: string; description?: string }>): {
    totalTools: number;
    flowbabyTools: Array<{ id: string; name: string }>;
} {
    const flowbabyTools = tools
        .filter(t => t.name.startsWith('flowbaby_'))
        .map(t => ({ id: t.name, name: t.name }));
    return {
        totalTools: tools.length,
        flowbabyTools
    };
}
