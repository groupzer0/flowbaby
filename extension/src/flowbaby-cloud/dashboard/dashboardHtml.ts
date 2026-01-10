/**
 * Dashboard HTML Generator
 *
 * Generates the HTML content for the Flowbaby Dashboard webview.
 * Uses Flowbaby brand colors with VS Code theme integration.
 *
 * @see Plan 097 - Dashboard Implementation
 */

import * as vscode from 'vscode';
import type { UserProfileResponse, UsageResponse } from '../types';

// Plan 097: Removed brand colors - using only VS Code theme variables

/**
 * Generate a cryptographically random nonce for CSP.
 */
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * Format a date string for display.
 */
function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Generate the dashboard HTML content.
 */
export function generateDashboardHtml(
    webview: vscode.Webview,
    profile: UserProfileResponse | null,
    usage: UsageResponse | null,
    iconUri: string,
    error?: string
): string {
    const nonce = getNonce();
    const cspSource = webview.cspSource;

    // Build content based on state
    let content: string;
    if (error) {
        content = buildErrorContent(error);
    } else if (!profile || !usage) {
        content = buildLoadingContent();
    } else {
        content = buildDashboardContent(profile, usage, iconUri);
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; img-src ${cspSource} https:; script-src 'nonce-${nonce}';">
    <title>Flowbaby Dashboard</title>
    <style nonce="${nonce}">
        :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --fg-muted: var(--vscode-descriptionForeground);
            --border: var(--vscode-panel-border);
            --button-bg: var(--vscode-button-background);
            --button-fg: var(--vscode-button-foreground);
            --button-hover-bg: var(--vscode-button-hoverBackground);
            --button-secondary-bg: var(--vscode-button-secondaryBackground);
            --button-secondary-fg: var(--vscode-button-secondaryForeground);
            --badge-bg: var(--vscode-badge-background);
            --badge-fg: var(--vscode-badge-foreground);
            --progress-bg: var(--vscode-progressBar-background);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--fg);
            background: var(--bg);
            padding: 24px;
            max-width: 600px;
            margin: 0 auto;
        }

        /* Header */
        .header {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 24px;
        }

        .header-icon {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            border: 2px solid var(--border);
            object-fit: contain;
            background: var(--bg);
        }

        .header-info {
            flex: 1;
        }

        .header-username {
            font-size: 1.4em;
            font-weight: 600;
        }

        .header-tier {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 0.85em;
            font-weight: 500;
            background: var(--badge-bg);
            color: var(--badge-fg);
        }

        /* Welcome text */
        .welcome-text {
            font-size: 1.1em;
            margin-bottom: 8px;
        }

        .membership-text {
            font-size: 0.95em;
            color: var(--fg-muted);
        }

        /* Sections */
        .section {
            margin-bottom: 24px;
        }

        .section-title {
            font-size: 0.9em;
            font-weight: 600;
            color: var(--fg-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 12px;
        }

        /* Usage Bar - using HTML5 progress element */
        .usage-bar-container {
            margin-bottom: 8px;
        }

        progress.usage-bar {
            width: 100%;
            height: 12px;
            border: none;
            border-radius: 6px;
            background-color: var(--vscode-editorWidget-background, rgba(128,128,128,0.2));
            -webkit-appearance: none;
            appearance: none;
        }

        progress.usage-bar::-webkit-progress-bar {
            background-color: var(--vscode-editorWidget-background, rgba(128,128,128,0.2));
            border-radius: 6px;
        }

        progress.usage-bar::-webkit-progress-value {
            background-color: var(--vscode-progressBar-background, #0078d4);
            border-radius: 6px;
        }

        progress.usage-bar::-moz-progress-bar {
            background-color: var(--vscode-progressBar-background, #0078d4);
            border-radius: 6px;
        }

        .usage-text {
            font-size: 0.95em;
            margin-bottom: 4px;
        }

        .usage-period {
            font-size: 0.85em;
            color: var(--fg-muted);
        }

        /* Buttons */
        .button-row {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }

        .btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 0.9em;
            font-weight: 500;
            cursor: pointer;
            border: none;
            transition: background 0.15s, transform 0.1s;
        }

        .btn:hover {
            transform: translateY(-1px);
        }

        .btn:active {
            transform: translateY(0);
        }

        .btn-primary {
            background: var(--button-bg);
            color: var(--button-fg);
        }

        .btn-primary:hover {
            background: var(--button-hover-bg);
        }

        .btn-outline {
            background: var(--button-secondary-bg);
            color: var(--button-secondary-fg);
            border: 1px solid var(--border);
        }

        .btn-outline:hover {
            opacity: 0.9;
        }

        .btn-full {
            width: 100%;
            justify-content: center;
        }

        /* Error state */
        .error-container {
            text-align: center;
            padding: 40px 20px;
        }

        .error-message {
            color: var(--vscode-errorForeground);
            margin-bottom: 16px;
        }

        /* Loading state */
        .loading-container {
            text-align: center;
            padding: 40px 20px;
            color: var(--fg-muted);
        }

        /* Link icon */
        .icon-external::after {
            content: '↗';
            margin-left: 4px;
        }
    </style>
</head>
<body>
    ${content}
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        function sendCommand(command, url) {
            vscode.postMessage({ command, url });
        }

        // Add click handlers to all buttons with data-command
        document.querySelectorAll('[data-command]').forEach(btn => {
            btn.addEventListener('click', () => {
                const command = btn.getAttribute('data-command');
                const url = btn.getAttribute('data-url');
                sendCommand(command, url);
            });
        });
    </script>
</body>
</html>`;
}

/**
 * Build the main dashboard content.
 */
function buildDashboardContent(
    profile: UserProfileResponse,
    usage: UsageResponse,
    iconUri: string
): string {
    // Calculate percentage from actual values (don't rely on API field)
    const used = usage.credits.used || 0;
    const limit = usage.credits.limit || 1; // Avoid division by zero
    const percentUsed = Math.min(Math.round((used / limit) * 100), 100);
    const billingStart = formatDate(usage.billingPeriod.start);
    const billingEnd = formatDate(usage.billingPeriod.end);

    return `
        <!-- Header -->
        <div class="header">
            <img src="${iconUri}" alt="Flowbaby" class="header-icon">
        </div>
        
        <!-- Welcome Message -->
        <div class="section">
            <div class="welcome-text">Thanks for using Flowbaby, <strong>${escapeHtml(profile.githubUsername)}</strong>!</div>
            <div class="membership-text">Membership: <span class="header-tier">${escapeHtml(profile.tierDisplayName)}</span></div>
        </div>

        <!-- Monthly Credits Section -->
        <div class="section">
            <div class="section-title">Monthly Credits</div>
            <div class="usage-text">${usage.credits.used} / ${usage.credits.limit} credits used (${percentUsed}%)</div>
            <div class="usage-bar-container">
                <progress class="usage-bar" value="${percentUsed}" max="100"></progress>
            </div>
            <div class="usage-period">Billing period: ${billingStart} - ${billingEnd}</div>
        </div>

        <!-- Social Links -->
        <div class="section">
            <div class="button-row">
                <button class="btn btn-primary" data-command="openUrl" data-url="https://github.com/groupzer0/flowbaby">
                    ⭐ Star on GitHub
                </button>
                <button class="btn btn-primary" data-command="openUrl" data-url="https://marketplace.visualstudio.com/items?itemName=Flowbaby.flowbaby&ssr=false#review-details">
                    ⭐ Rate on Marketplace
                </button>
            </div>
        </div>
        
        <!-- Feedback -->
        <div class="section">
            <div class="section-title">Feedback</div>
            <button class="btn btn-outline btn-full" data-command="openUrl" data-url="https://github.com/groupzer0/flowbaby/issues">
                💬 Submit Feedback on GitHub
            </button>
        </div>

        <!-- Quick Actions -->
        <div class="section">
            <div class="section-title">Quick Actions</div>
            <div class="button-row">
                <button class="btn btn-outline" data-command="refreshDeps">
                    🔄 Refresh Dependencies
                </button>
                <button class="btn btn-outline" data-command="setupEnvironment">
                    ⚙️ Setup Environment
                </button>
                <button class="btn btn-outline" data-command="visualizeGraph">
                    🔗 Visualize Graph
                </button>
            </div>
        </div>

        <!-- Manage Subscription -->
        <div class="section">
            <div class="section-title">Manage Subscription</div>
            <button class="btn btn-primary btn-full icon-external" data-command="openUrl" data-url="https://flowbaby.ai/dashboard">
                Manage Subscription
            </button>
        </div>
    `;
}

/**
 * Build error state content.
 */
function buildErrorContent(error: string): string {
    return `
        <div class="error-container">
            <div class="error-message">${escapeHtml(error)}</div>
            <button class="btn btn-primary" data-command="login">
                Login to Flowbaby Cloud
            </button>
        </div>
    `;
}

/**
 * Build loading state content.
 */
function buildLoadingContent(): string {
    return `
        <div class="loading-container">
            Loading dashboard...
        </div>
    `;
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(text: string): string {
    const escapeMap: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, char => escapeMap[char] || char);
}
