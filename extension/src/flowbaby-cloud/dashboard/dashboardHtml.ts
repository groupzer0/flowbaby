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
 * Map backend tier display names to user-facing display names.
 * Backend uses "basic" internally, but we display "Pro" to users.
 */
function getTierDisplayName(backendTierName: string | undefined): string {
    if (!backendTierName) {
        return 'Pro'; // Default to Pro for missing tier
    }
    // Case-insensitive match for "basic" -> "Pro"
    if (backendTierName.toLowerCase() === 'basic') {
        return 'Pro';
    }
    return backendTierName;
}

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

        .section-subtitle {
            font-size: 0.9em;
            color: var(--fg-muted);
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

        /* Collapsible section */
        .collapsible-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            padding: 8px 0;
            user-select: none;
        }

        .collapsible-header:hover {
            opacity: 0.8;
        }

        .collapsible-arrow {
            transition: transform 0.2s ease;
            font-size: 0.8em;
        }

        .collapsible-arrow.expanded {
            transform: rotate(90deg);
        }

        .collapsible-content {
            display: none;
            padding-top: 8px;
        }

        .collapsible-content.expanded {
            display: block;
        }

        /* Command list */
        .command-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .command-item {
            display: flex;
            flex-direction: column;
            padding: 10px 12px;
            background: var(--button-secondary-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.15s, border-color 0.15s;
        }

        .command-item:hover {
            background: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-focusBorder);
        }

        .command-name {
            font-weight: 500;
            font-size: 0.9em;
            margin-bottom: 4px;
            color: var(--vscode-textLink-foreground);
        }

        .command-desc {
            font-size: 0.85em;
            color: var(--fg-muted);
            line-height: 1.4;
        }

        /* Help section */
        .help-item {
            display: flex;
            align-items: center;
            padding: 12px;
            background: var(--button-secondary-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.15s, border-color 0.15s;
            margin-bottom: 8px;
        }

        .help-item:last-child {
            margin-bottom: 0;
        }

        .help-item:hover {
            background: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-focusBorder);
        }

        .help-icon {
            font-size: 1.4em;
            margin-right: 12px;
            flex-shrink: 0;
        }

        .help-content {
            flex: 1;
        }

        .help-title {
            font-weight: 500;
            font-size: 0.9em;
            margin-bottom: 2px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .help-badge {
            font-size: 0.75em;
            padding: 2px 6px;
            border-radius: 4px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            font-weight: 500;
        }

        .help-subtitle {
            font-size: 0.85em;
            color: var(--fg-muted);
        }

        .help-arrow {
            color: var(--fg-muted);
            margin-left: 8px;
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

        // Handle collapsible sections
        document.querySelectorAll('.collapsible-header').forEach(header => {
            header.addEventListener('click', () => {
                const arrow = header.querySelector('.collapsible-arrow');
                const content = header.nextElementSibling;
                if (arrow && content) {
                    arrow.classList.toggle('expanded');
                    content.classList.toggle('expanded');
                }
            });
        });

        // Handle command item clicks
        document.querySelectorAll('.command-item').forEach(item => {
            item.addEventListener('click', () => {
                const commandId = item.getAttribute('data-command-id');
                if (commandId) {
                    sendCommand('executeCommand', commandId);
                }
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
            <span class="header-tier">${escapeHtml(getTierDisplayName(profile.tierDisplayName))}</span>
        </div>
        
        <!-- Welcome Message -->
        <div class="section">
            <div class="welcome-text">Thanks for using Flowbaby, <strong>${escapeHtml(profile.githubUsername)}</strong>!</div>
        </div>

        <!-- 1. Monthly Credits -->
        <div class="section">
            <div class="section-title">Monthly Credits</div>
            <div class="usage-text">${usage.credits.used} / ${usage.credits.limit} credits used (${percentUsed}%)</div>
            <div class="usage-bar-container">
                <progress class="usage-bar" value="${percentUsed}" max="100"></progress>
            </div>
            <div class="usage-period">Billing period: ${billingStart} - ${billingEnd}</div>
        </div>

        <!-- 2. Star and Review -->
        <div class="section">
            <div class="section-subtitle">Stars and reviews help others find Flowbaby!</div>
            <div class="button-row">
                <button class="btn btn-primary" data-command="openUrl" data-url="https://github.com/groupzer0/flowbaby">
                    ⭐ Star on GitHub
                </button>
                <button class="btn btn-primary" data-command="openUrl" data-url="https://marketplace.visualstudio.com/items?itemName=Flowbaby.flowbaby&ssr=false#review-details">
                    ⭐ Rate on Marketplace
                </button>
            </div>
        </div>

        <!-- 3. Manage Subscription -->
        <div class="section">
            <div class="section-title">Manage Subscription</div>
            <button class="btn btn-primary btn-full icon-external" data-command="openUrl" data-url="https://flowbaby.ai/dashboard">
                Manage Subscription
            </button>
        </div>

        <!-- 4. Need Help? (Support) -->
        <div class="section">
            <div class="section-title">Need Help? 💬</div>
            <div class="section-subtitle">We're here to help! Choose the best way to reach us:</div>
            <div class="help-item" data-command="openUrl" data-url="https://github.com/groupzer0/flowbaby/discussions">
                <span class="help-icon">💬</span>
                <div class="help-content">
                    <div class="help-title">GitHub Discussions <span class="help-badge">Recommended</span></div>
                    <div class="help-subtitle">Ask questions, share ideas, and connect with the community</div>
                </div>
                <span class="help-arrow">→</span>
            </div>
            <div class="help-item" data-command="openUrl" data-url="https://github.com/groupzer0/flowbaby/issues">
                <span class="help-icon">🐛</span>
                <div class="help-content">
                    <div class="help-title">Report an Issue</div>
                    <div class="help-subtitle">Found a bug? Let us know on GitHub Issues</div>
                </div>
                <span class="help-arrow">→</span>
            </div>
            <div class="help-item" data-command="openUrl" data-url="mailto:contact@flowbaby.ai">
                <span class="help-icon">✉️</span>
                <div class="help-content">
                    <div class="help-title">Email Support</div>
                    <div class="help-subtitle">contact@flowbaby.ai — for private or billing inquiries</div>
                </div>
                <span class="help-arrow">→</span>
            </div>
        </div>

        <!-- 5. Quick Actions -->
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

        <!-- 6. Commands Reference -->
        <div class="section">
            <div class="collapsible-header">
                <span class="section-title" style="margin-bottom: 0;">Commands Reference</span>
                <span class="collapsible-arrow">▶</span>
            </div>
            <div class="collapsible-content">
                <div class="command-list">
                    <div class="command-item" data-command-id="Flowbaby.captureMessage">
                        <div class="command-name">Capture to Memory</div>
                        <div class="command-desc">Save the current selection or chat context to workspace memory. Use Ctrl+Alt+F (Cmd+Alt+F on Mac).</div>
                    </div>
                    <div class="command-item" data-command-id="Flowbaby.initializeWorkspace">
                        <div class="command-name">Initialize Workspace</div>
                        <div class="command-desc">Set up the Flowbaby environment for a new workspace. Creates the Python venv and databases.</div>
                    </div>
                    <div class="command-item" data-command-id="Flowbaby.refreshDependencies">
                        <div class="command-name">Refresh Bridge Dependencies</div>
                        <div class="command-desc">Update Python packages in the managed environment. Use when dependencies are outdated.</div>
                    </div>
                    <div class="command-item" data-command-id="Flowbaby.diagnoseEnvironment">
                        <div class="command-name">Diagnose Environment</div>
                        <div class="command-desc">Generate a diagnostic report of your Flowbaby environment for troubleshooting.</div>
                    </div>
                    <div class="command-item" data-command-id="Flowbaby.clearMemory">
                        <div class="command-name">Clear Workspace Memory</div>
                        <div class="command-desc">Delete all stored memories from this workspace. Use with caution.</div>
                    </div>
                    <div class="command-item" data-command-id="Flowbaby.visualizeGraph">
                        <div class="command-name">Visualize Memory Graph</div>
                        <div class="command-desc">Open an interactive visualization of your workspace's knowledge graph.</div>
                    </div>
                    <div class="command-item" data-command-id="Flowbaby.backgroundStatus">
                        <div class="command-name">View Background Operations</div>
                        <div class="command-desc">See pending and completed background operations like memory ingestion.</div>
                    </div>
                    <div class="command-item" data-command-id="flowbaby.cloud.status">
                        <div class="command-name">Show Cloud Status</div>
                        <div class="command-desc">Display your Flowbaby Cloud connection status and account information.</div>
                    </div>
                    <div class="command-item" data-command-id="flowbaby.cloud.login">
                        <div class="command-name">Login with GitHub</div>
                        <div class="command-desc">Authenticate with Flowbaby Cloud using your GitHub account.</div>
                    </div>
                    <div class="command-item" data-command-id="flowbaby.cloud.logout">
                        <div class="command-name">Logout</div>
                        <div class="command-desc">Sign out of Flowbaby Cloud.</div>
                    </div>
                </div>
            </div>
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
