#!/usr/bin/env python3
"""
Cognee Graph Visualization Script for VS Code Extension

Usage: python visualize.py <workspace_path> <output_path>

Generates a standalone HTML graph visualization from the Cognee knowledge graph:
1. Validates Cloud credentials from environment (AWS_ACCESS_KEY_ID)
2. Configures workspace-isolated Cognee directories
3. Calls cognee.visualize_graph() to generate HTML
4. Post-processes HTML to inline vendored D3 assets (offline-first)
5. Returns JSON result with output file path

Plan 083 M5: v0.7.0 is Cloud-only - uses AWS Bedrock via AWS_* env vars.

Returns JSON to stdout:
    Success: {"success": true, "output_path": "/path/to/graph.html", "node_count": 42}
    Failure: {"success": false, "error": "error message"}

Offline-First Guarantee:
    The generated HTML file bundles all JavaScript dependencies inline.
    No external CDN requests are made when viewing the visualization.
"""

import asyncio
import json
import logging
import os
import re
import sys
from pathlib import Path

# Add bridge directory to path to import bridge_logger and workspace_utils
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
# CRITICAL: Import bridge_env BEFORE any cognee import (Plan 074/091)
from bridge_env import apply_workspace_env, OntologyConfigError
import bridge_logger
from workspace_utils import canonicalize_workspace_path, generate_dataset_name
# Plan 093: Import shared user context helper for multi-user correctness
from user_context import ensure_user_context, UserContextError


# Path to vendored D3 assets relative to this script
ASSETS_DIR = Path(__file__).parent / 'assets' / 'd3'


def load_vendored_d3_assets() -> dict[str, str]:
    """Load vendored D3 library content for inlining.
    
    Returns:
        Dictionary mapping CDN URLs to their vendored content.
    """
    assets = {}
    
    d3_main_path = ASSETS_DIR / 'd3.v5.min.js'
    d3_contour_path = ASSETS_DIR / 'd3-contour.v1.min.js'
    
    if d3_main_path.exists():
        assets['https://d3js.org/d3.v5.min.js'] = d3_main_path.read_text(encoding='utf-8')
    
    if d3_contour_path.exists():
        assets['https://d3js.org/d3-contour.v1.min.js'] = d3_contour_path.read_text(encoding='utf-8')
    
    return assets


def inline_vendored_assets(html_content: str, assets: dict[str, str]) -> str:
    """Replace CDN script references with inline vendored content.
    
    This ensures the HTML file is fully self-contained and requires no
    external network requests to function.
    
    Args:
        html_content: The original HTML with CDN script references.
        assets: Dictionary mapping CDN URLs to their vendored JS content.
    
    Returns:
        HTML with external scripts replaced by inline script tags.
    """
    result = html_content
    
    for cdn_url, js_content in assets.items():
        # Match script tags with this CDN URL
        # Handles: <script src="https://d3js.org/d3.v5.min.js"></script>
        pattern = rf'<script\s+src=["\']({re.escape(cdn_url)})["\'][^>]*>\s*</script>'
        
        # Replace with inline script containing the vendored content
        # Use lambda to avoid regex interpretation of backslash sequences in JS content
        inline_script = f'<script>/* Vendored: {cdn_url} */\n{js_content}</script>'
        result = re.sub(pattern, lambda m: inline_script, result, flags=re.IGNORECASE)
    
    return result


def validate_no_external_scripts(html_content: str) -> list[str]:
    """Validate that no external http/https script references remain.
    
    Args:
        html_content: The post-processed HTML content.
    
    Returns:
        List of any remaining external script URLs (should be empty).
    """
    # Find all script src attributes that reference external URLs
    pattern = r'<script[^>]+src=["\']+(https?://[^"\']+)["\']'
    matches = re.findall(pattern, html_content, re.IGNORECASE)
    return matches


# Cognee logo SVG pattern (fixed position bottom-right)
COGNEE_LOGO_PATTERN = re.compile(
    r'<svg[^>]*style="[^"]*position:\s*fixed[^"]*bottom[^"]*right[^"]*"[^>]*viewBox="0 0 158 44"[^>]*>.*?</svg>',
    re.IGNORECASE | re.DOTALL
)

# Path to Flowbaby icon asset (base64-encoded PNG)
FLOWBABY_ICON_PATH = Path(__file__).parent / 'assets' / 'flowbaby-icon.b64'


def load_flowbaby_logo_html() -> str:
    """Load the Flowbaby logo as an inline HTML img tag with data URI.
    
    Returns:
        HTML img tag with embedded base64 PNG, or fallback text logo if asset missing.
    """
    if FLOWBABY_ICON_PATH.exists():
        icon_b64 = FLOWBABY_ICON_PATH.read_text(encoding='utf-8').strip()
        return f'''<a href="https://flowbaby.ai" target="_blank" rel="noopener noreferrer" style="position: fixed; bottom: 10px; right: 10px; z-index: 9999;"><img src="data:image/png;base64,{icon_b64}" alt="Flowbaby" style="width: 60px; height: auto; opacity: 0.9;" /></a>'''
    else:
        # Fallback to text-based SVG if icon file is missing
        return '''<a href="https://flowbaby.ai" target="_blank" rel="noopener noreferrer" style="position: fixed; bottom: 10px; right: 10px; z-index: 9999; text-decoration: none;"><svg style="width: 120px; height: auto;" viewBox="0 0 200 50" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <linearGradient id="flowbabyGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#8B5CF6;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#EC4899;stop-opacity:1" />
        </linearGradient>
    </defs>
    <text x="10" y="35" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="600" fill="url(#flowbabyGradient)">flowbaby</text>
</svg></a>'''


def replace_cognee_branding(html_content: str) -> str:
    """Replace Cognee logo with Flowbaby branding.
    
    This ensures the visualization is properly branded for Flowbaby users.
    The replacement uses an inline image with base64 data URI (no external dependencies).
    
    Args:
        html_content: The HTML content with potential Cognee branding.
    
    Returns:
        HTML with Flowbaby branding instead of Cognee logo.
    """
    flowbaby_logo = load_flowbaby_logo_html()
    
    # Try the specific pattern first
    result = COGNEE_LOGO_PATTERN.sub(flowbaby_logo, html_content)
    
    # If that didn't match, try a more general pattern for the Cognee SVG
    if result == html_content:
        # Match any SVG with the Cognee logo viewBox dimensions
        general_pattern = re.compile(
            r'<svg[^>]*viewBox="0 0 158 44"[^>]*>.*?</svg>',
            re.IGNORECASE | re.DOTALL
        )
        result = general_pattern.sub(flowbaby_logo, result)
    
    return result


async def visualize_graph(
    workspace_path: str,
    output_path: str
) -> dict:
    """Generate a standalone HTML graph visualization.
    
    Args:
        workspace_path: Path to the VS Code workspace.
        output_path: Path where the HTML file should be written.
    
    Returns:
        Result dictionary with success status and details.
    """
    # Initialize logger
    logger = bridge_logger.setup_logging(workspace_path, "visualize")
    
    # Gate debug output behind extension debugLogging setting
    debug_enabled = os.getenv('FLOWBABY_DEBUG_LOGGING', '').lower() in {'1', 'true', 'yes', 'on'}
    logger.setLevel(logging.DEBUG if debug_enabled else logging.INFO)
    
    try:
        workspace_dir = Path(workspace_path)
        output_file = Path(output_path)
        
        # Ensure output directory exists
        output_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Plan 083 M5: v0.7.0 is Cloud-only - AWS credentials required
        aws_access_key = os.getenv('AWS_ACCESS_KEY_ID')
        if not aws_access_key:
            error_payload = {
                'success': False,
                'error_code': 'NOT_AUTHENTICATED',
                'error_type': 'MISSING_CREDENTIALS',
                'message': 'Cloud login required',
                'user_message': 'Cloud login required. Use "Flowbaby Cloud: Login with GitHub" command.',
                'remediation': 'Run "Flowbaby Cloud: Login with GitHub" from Command Palette to authenticate.',
                'error': 'AWS_ACCESS_KEY_ID not found'
            }
            logger.error("Missing Cloud credentials", extra={'data': error_payload})
            return error_payload
        
        # Plan 091 M2: Use shared bridge_env module for all environment wiring
        # CRITICAL: This must happen BEFORE importing cognee
        try:
            env_config = apply_workspace_env(
                workspace_path,
                logger=logger,
                fail_on_missing_ontology=False  # Visualization can proceed without ontology
            )
            logger.info(f"Environment configured: {env_config.to_log_string()}")
        except OntologyConfigError as e:
            # Non-fatal for visualization - ontology is optional here
            logger.warning(f"Ontology configuration warning (non-fatal for visualization): {e}")
        except ValueError as e:
            return {
                'success': False,
                'error_code': 'INVALID_WORKSPACE',
                'error': str(e),
                'user_message': f'Invalid workspace path: {e}'
            }
        
        # Import cognee AFTER environment configuration
        logger.debug("Importing cognee SDK")
        import cognee
        
        # Configure workspace-local storage directories
        # CRITICAL: env vars alone are insufficient - must also call cognee.config API
        system_root = str(workspace_dir / '.flowbaby' / 'system')
        data_root = str(workspace_dir / '.flowbaby' / 'data')
        cognee.config.system_root_directory(system_root)
        cognee.config.data_root_directory(data_root)
        logger.debug(f"Configured Cognee storage: system={system_root}, data={data_root}")
        
        # Plan 083 M5: v0.7.0 is Cloud-only - Cognee uses AWS Bedrock via AWS_* env vars
        logger.debug("Cloud-only mode: Using AWS Bedrock via Cloud credentials")
        
        # Plan 093: Ensure multi-user context is established after env wiring
        # This sets the session_user ContextVar for consistent data isolation
        # and may be required for correct graph data scoping under multi-user mode
        logger.debug("Plan 093: Ensuring user context for multi-user correctness")
        user_context_result = await ensure_user_context(logger=logger)
        logger.debug(f"Plan 093: User context established for user {user_context_result.user_id}")
        
        # Generate dataset name for this workspace
        dataset_name, _ = generate_dataset_name(workspace_path)
        
        logger.info("Generating graph visualization", extra={'data': {
            'workspace_path': workspace_path,
            'output_path': str(output_file),
            'dataset_name': dataset_name
        }})
        
        # Load vendored D3 assets before calling visualize_graph
        d3_assets = load_vendored_d3_assets()
        if not d3_assets:
            logger.warning("No vendored D3 assets found - HTML may require network access")
        else:
            logger.debug(f"Loaded {len(d3_assets)} vendored D3 assets for inlining")
        
        # Call Cognee's visualize_graph function
        # This generates HTML with D3-based graph visualization
        try:
            await cognee.visualize_graph(destination_file_path=str(output_file))
        except Exception as viz_error:
            error_msg = str(viz_error).lower()
            
            # Check for common error conditions - Cognee uses various phrasings
            # e.g. "No graph data available" or "no data" or "empty"
            is_no_data = (
                'no data' in error_msg or 
                'no graph data' in error_msg or 
                'empty' in error_msg or
                'not found' in error_msg
            )
            if is_no_data:
                return {
                    'success': False,
                    'error_code': 'EMPTY_GRAPH',
                    'error': 'No graph data available in workspace',
                    'user_message': 'No graph data available. Ingest some memories first using @flowbaby chat.',
                    'node_count': 0,
                    'has_sentinel': False
                }
            
            logger.error(f"Cognee visualize_graph failed: {viz_error}")
            return {
                'success': False,
                'error_code': 'VISUALIZATION_ERROR',
                'error': f'Failed to generate graph: {viz_error}'
            }
        
        # Read the generated HTML
        if not output_file.exists():
            return {
                'success': False,
                'error_code': 'OUTPUT_MISSING',
                'error': 'Cognee did not generate the expected HTML file'
            }
        
        html_content = output_file.read_text(encoding='utf-8')
        original_size = len(html_content)
        
        # Post-process: inline vendored D3 assets
        if d3_assets:
            html_content = inline_vendored_assets(html_content, d3_assets)
            logger.debug(f"Inlined D3 assets: {original_size} -> {len(html_content)} bytes")
        
        # Post-process: replace Cognee branding with Flowbaby branding
        html_content = replace_cognee_branding(html_content)
        logger.debug("Replaced Cognee branding with Flowbaby branding")
        
        # Validate: no external scripts remain (FAIL-CLOSED requirement)
        external_scripts = validate_no_external_scripts(html_content)
        if external_scripts:
            # ARCHITECTURAL REQUIREMENT: Fail closed - delete output and return error
            logger.error(f"Offline-first violation: external scripts detected: {external_scripts}")
            # Delete the unsafe output file if it exists
            if output_file.exists():
                output_file.unlink()
                logger.info(f"Deleted unsafe output file: {output_file}")
            return {
                'success': False,
                'error_code': 'OFFLINE_VIOLATION',
                'error': f'Generated HTML contains external script references that could not be inlined: {external_scripts}',
                'user_message': 'Graph visualization failed: contains external dependencies that violate offline-first requirement.',
                'external_scripts': external_scripts
            }
        
        logger.info("Offline-first validation passed: no external script references")
        
        # Count nodes in the visualization (basic heuristic from HTML)
        # Look for node data in the D3 visualization
        node_count = html_content.count('"id":')  # Rough estimate from JSON data
        
        # Plan 091 M3: Fail-closed empty graph detection
        # Check for Cognee's "No graph data available" placeholder (sentinel)
        EMPTY_GRAPH_SENTINEL = "No graph data available"
        has_empty_sentinel = EMPTY_GRAPH_SENTINEL.lower() in html_content.lower()
        
        # Secondary heuristic: node count
        # If sentinel is present OR node count is suspiciously low, treat as empty
        is_empty_graph = has_empty_sentinel or node_count < 2
        
        if is_empty_graph:
            # FAIL-CLOSED: Don't return success for empty graphs
            logger.warning(f"Empty graph detected: sentinel={has_empty_sentinel}, node_count={node_count}")
            
            # Delete the empty output file
            if output_file.exists():
                output_file.unlink()
                logger.info(f"Deleted empty graph output: {output_file}")
            
            # Distinguish between "no data ingested" and "wrong store"
            # If we have *any* nodes but the sentinel is present, likely wrong store
            if has_empty_sentinel and node_count > 0:
                return {
                    'success': False,
                    'error_code': 'EMPTY_GRAPH_WRONG_STORE',
                    'error': 'Graph exists but visualization read from wrong store or produced empty output',
                    'user_message': 'Graph visualization failed: data may exist but was not read correctly. Try re-running the command.',
                    'node_count': node_count,
                    'has_sentinel': has_empty_sentinel
                }
            else:
                return {
                    'success': False,
                    'error_code': 'EMPTY_GRAPH',
                    'error': 'No graph data available in workspace',
                    'user_message': 'No graph data available. Ingest some memories first using @flowbaby chat.',
                    'node_count': node_count,
                    'has_sentinel': has_empty_sentinel
                }
        
        # Write the post-processed HTML (safe to write now)
        output_file.write_text(html_content, encoding='utf-8')
        
        logger.info("Graph visualization generated successfully", extra={'data': {
            'output_path': str(output_file),
            'file_size_bytes': len(html_content),
            'estimated_node_count': node_count
        }})
        
        return {
            'success': True,
            'output_path': str(output_file),
            'file_size_bytes': len(html_content),
            'node_count': node_count,
            'offline_safe': True  # Guaranteed: external scripts would have failed above
        }
        
    except UserContextError as e:
        # Plan 093: Return structured error envelope for user context failures
        error_payload = e.to_envelope()
        logger.error(f"Plan 093: User context error: {e.error_code}", extra={'data': error_payload})
        return error_payload
    except ImportError as e:
        logger.error(f"Failed to import required module: {e}")
        return {
            'success': False,
            'error_code': 'IMPORT_ERROR',
            'error': f'Failed to import required module: {e}',
            'user_message': 'Cognee is not installed. Run "Flowbaby: Setup" first.'
        }
    except Exception as e:
        logger.error(f"Unexpected error during visualization: {e}", exc_info=True)
        return {
            'success': False,
            'error_code': 'UNEXPECTED_ERROR',
            'error': str(e)
        }


def main():
    """Main entry point for command-line execution."""
    if len(sys.argv) < 3:
        result = {
            'success': False,
            'error': 'Usage: python visualize.py <workspace_path> <output_path>'
        }
        print(json.dumps(result))
        sys.exit(1)
    
    workspace_path = sys.argv[1]
    output_path = sys.argv[2]
    
    # Validate workspace path
    if not Path(workspace_path).is_dir():
        result = {
            'success': False,
            'error': f'Workspace path does not exist: {workspace_path}'
        }
        print(json.dumps(result))
        sys.exit(1)
    
    # Run visualization
    result = asyncio.run(visualize_graph(workspace_path, output_path))
    
    # Output JSON result
    print(json.dumps(result))
    
    # Exit with appropriate code
    sys.exit(0 if result['success'] else 1)


if __name__ == '__main__':
    main()
