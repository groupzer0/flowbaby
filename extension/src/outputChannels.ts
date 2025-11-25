/**
 * Output Channel Singletons for RecallFlow Extension
 * 
 * This module provides singleton factories for output channels to prevent
 * duplicate channel entries in VS Code's Output dropdown.
 * 
 * Plan 028 Milestone 1: Fix Duplicate Output Channel
 * Plan 028 Milestone 2: Add Debug Logging Channel (lazy creation)
 * 
 * @module outputChannels
 */
import * as vscode from 'vscode';

// Module-level singleton instances (lazy initialization)
let recallFlowOutputChannel: vscode.OutputChannel | undefined;
let recallFlowDebugChannel: vscode.OutputChannel | undefined;

/**
 * Get the singleton RecallFlow Memory output channel.
 * Creates the channel lazily on first call.
 * 
 * @returns The RecallFlow Memory output channel
 */
export function getRecallFlowOutputChannel(): vscode.OutputChannel {
    if (!recallFlowOutputChannel) {
        recallFlowOutputChannel = vscode.window.createOutputChannel('RecallFlow Memory');
    }
    return recallFlowOutputChannel;
}

/**
 * Get the singleton RecallFlow Debug output channel.
 * Creates the channel lazily only if debug logging is enabled.
 * 
 * Per Plan 028 Milestone 2: Debug channel is created only when
 * cogneeMemory.debugLogging setting is true.
 * 
 * @returns The RecallFlow Debug output channel, or undefined if debug logging is disabled
 */
export function getRecallFlowDebugChannel(): vscode.OutputChannel | undefined {
    const config = vscode.workspace.getConfiguration('cogneeMemory');
    const debugLoggingEnabled = config.get<boolean>('debugLogging', false);
    
    if (!debugLoggingEnabled) {
        return undefined;
    }
    
    if (!recallFlowDebugChannel) {
        recallFlowDebugChannel = vscode.window.createOutputChannel('RecallFlow Debug');
    }
    return recallFlowDebugChannel;
}

/**
 * Log a message to the debug channel if debug logging is enabled.
 * This is a convenience function that handles the conditional check.
 * 
 * @param message The message to log
 * @param data Optional structured data to include
 */
export function debugLog(message: string, data?: Record<string, unknown>): void {
    const channel = getRecallFlowDebugChannel();
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
    if (recallFlowOutputChannel) {
        recallFlowOutputChannel.dispose();
        recallFlowOutputChannel = undefined;
    }
    if (recallFlowDebugChannel) {
        recallFlowDebugChannel.dispose();
        recallFlowDebugChannel = undefined;
    }
}
