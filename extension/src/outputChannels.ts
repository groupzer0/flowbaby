/**
 * Output Channel Singletons for Flowbaby Extension
 * 
 * This module provides singleton factories for output channels to prevent
 * duplicate channel entries in VS Code's Output dropdown.
 * 
 * Plan 028 Milestone 1: Fix Duplicate Output Channel
 * Plan 028 Milestone 2: Add Debug Logging Channel (lazy creation)
 * Plan 030: Rebrand to Flowbaby
 * 
 * @module outputChannels
 */
import * as vscode from 'vscode';

// Module-level singleton instances (lazy initialization)
let flowbabyOutputChannel: vscode.OutputChannel | undefined;
let flowbabyDebugChannel: vscode.OutputChannel | undefined;
let flowbabyAgentOutputChannel: vscode.OutputChannel | undefined;

/**
 * Get the singleton Flowbaby output channel.
 * Creates the channel lazily on first call.
 * 
 * @returns The Flowbaby output channel
 */
export function getFlowbabyOutputChannel(): vscode.OutputChannel {
    if (!flowbabyOutputChannel) {
        flowbabyOutputChannel = vscode.window.createOutputChannel('Flowbaby');
    }
    return flowbabyOutputChannel;
}

/**
 * Get the singleton Flowbaby Debug output channel.
 * Creates the channel lazily only if debug logging is enabled.
 * 
 * Per Plan 028 Milestone 2: Debug channel is created only when
 * Flowbaby.debugLogging setting is true.
 * 
 * @returns The Flowbaby Debug output channel, or undefined if debug logging is disabled
 */
export function getFlowbabyDebugChannel(): vscode.OutputChannel | undefined {
    let debugLoggingEnabled = false;
    try {
        const config = vscode.workspace?.getConfiguration?.('Flowbaby');
        const configFlag = config?.get<boolean>('debugLogging', false) ?? false;
        debugLoggingEnabled = configFlag
            || process.env.FLOWBABY_DEBUG_LOGGING === 'true'
            || process.env.NODE_ENV === 'test';
    } catch {
        // In tests or early activation, workspace configuration may not be available.
        // Fall back to environment-based flags only.
        debugLoggingEnabled = process.env.FLOWBABY_DEBUG_LOGGING === 'true'
            || process.env.NODE_ENV === 'test';
    }
    
    if (!debugLoggingEnabled) {
        return undefined;
    }
    
    if (!flowbabyDebugChannel) {
        flowbabyDebugChannel = vscode.window.createOutputChannel('Flowbaby Debug');
    }
    return flowbabyDebugChannel;
}

/**
 * Get the singleton Flowbaby Agent Activity channel.
 * This is used for agent instrumentation and should not create duplicate entries.
 */
export function getFlowbabyAgentOutputChannel(): vscode.OutputChannel {
    if (!flowbabyAgentOutputChannel) {
        flowbabyAgentOutputChannel = vscode.window.createOutputChannel('Flowbaby Agent Activity');
    }
    return flowbabyAgentOutputChannel;
}

/**
 * Log a message to the debug channel if debug logging is enabled.
 * This is a convenience function that handles the conditional check.
 * 
 * @param message The message to log
 * @param data Optional structured data to include
 */
export function debugLog(message: string, data?: Record<string, unknown>): void {
    const channel = getFlowbabyDebugChannel();
    if (channel) {
        const timestamp = new Date().toISOString();
        let logLine = `[${timestamp}] ${message}`;
        if (data) {
            logLine += ` ${JSON.stringify(data)}`;
        }
        channel.appendLine(logLine);
    }
}

/**
 * Check if debug logging is enabled.
 * Useful for callers that want to conditionally include debug output.
 * 
 * @returns true if debug logging is enabled
 */
export function isDebugLoggingEnabled(): boolean {
    try {
        const config = vscode.workspace?.getConfiguration?.('Flowbaby');
        const configFlag = config?.get<boolean>('debugLogging', false) ?? false;
        return configFlag
            || process.env.FLOWBABY_DEBUG_LOGGING === 'true'
            || process.env.NODE_ENV === 'test';
    } catch {
        // In tests or early activation, workspace configuration may not be available.
        return process.env.FLOWBABY_DEBUG_LOGGING === 'true'
            || process.env.NODE_ENV === 'test';
    }
}

/**
 * Strip ANSI escape codes from a string.
 * These codes are used for terminal colors/formatting and should be
 * removed when logging to VS Code output channels.
 * 
 * Handles:
 * - SGR sequences: ESC[...m (colors, bold, etc.)
 * - CSI sequences: ESC[...X (cursor movement, etc.)
 * - OSC sequences: ESC]...BEL or ESC]...ESC\ (terminal titles, etc.)
 * 
 * @param text The string potentially containing ANSI codes
 * @returns The string with all ANSI codes removed
 */
export function stripAnsiCodes(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
               .replace(/\x1b\][^\x07]*\x07/g, '')      // OSC with BEL
               .replace(/\x1b\][^\x1b]*\x1b\\/g, '');   // OSC with ST
}

/**
 * Dispose all output channels.
 * Should be called during extension deactivation.
 */
export function disposeOutputChannels(): void {
    if (flowbabyOutputChannel) {
        flowbabyOutputChannel.dispose();
        flowbabyOutputChannel = undefined;
    }
    if (flowbabyDebugChannel) {
        flowbabyDebugChannel.dispose();
        flowbabyDebugChannel = undefined;
    }
    if (flowbabyAgentOutputChannel) {
        flowbabyAgentOutputChannel.dispose();
        flowbabyAgentOutputChannel = undefined;
    }
}
