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
    const config = vscode.workspace.getConfiguration('Flowbaby');
    const debugLoggingEnabled = config.get<boolean>('debugLogging', false);
    
    if (!debugLoggingEnabled) {
        return undefined;
    }
    
    if (!flowbabyDebugChannel) {
        flowbabyDebugChannel = vscode.window.createOutputChannel('Flowbaby Debug');
    }
    return flowbabyDebugChannel;
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
}
