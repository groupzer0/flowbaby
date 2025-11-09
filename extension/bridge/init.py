#!/usr/bin/env python3
"""
Cognee Initialization Script for VS Code Extension

Usage: python init.py <workspace_path>

Initializes Cognee for a workspace by:
1. Loading environment variables from workspace .env file
2. Configuring Cognee with OpenAI API key
3. Setting up workspace-local .cognee/ directory

Returns JSON to stdout:
  Success: {"success": true, "cognee_dir": "/path/to/.cognee"}
  Failure: {"success": false, "error": "error message"}
"""

import asyncio
import json
import os
import sys
from pathlib import Path


async def initialize_cognee(workspace_path: str) -> dict:
    """
    Initialize Cognee for the given workspace.
    
    Args:
        workspace_path: Absolute path to VS Code workspace root
        
    Returns:
        Dictionary with success status and cognee_dir or error message
    """
    try:
        # Import cognee
        import cognee
        from dotenv import load_dotenv
        
        # Load workspace .env file if it exists
        workspace_dir = Path(workspace_path)
        env_file = workspace_dir / '.env'
        
        if env_file.exists():
            load_dotenv(env_file)
        
        # Check for API key
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            return {
                'success': False,
                'error': 'OPENAI_API_KEY not found in environment or .env file'
            }
        
        # Configure Cognee with API key
        cognee.config.set_llm_api_key(api_key)
        cognee.config.set_llm_provider('openai')
        
        # Set workspace-local storage directory
        cognee_dir = workspace_dir / '.cognee'
        cognee_dir.mkdir(parents=True, exist_ok=True)
        
        # Configure Cognee to use workspace-local directory
        # Note: Cognee will use its default location, but we create .cognee/ for future use
        
        return {
            'success': True,
            'cognee_dir': str(cognee_dir.absolute())
        }
        
    except ImportError as e:
        return {
            'success': False,
            'error': f'Failed to import required module: {str(e)}'
        }
    except Exception as e:
        return {
            'success': False,
            'error': f'Initialization failed: {str(e)}'
        }


def main():
    """Main entry point for the script."""
    # Check command-line arguments
    if len(sys.argv) < 2:
        result = {
            'success': False,
            'error': 'Missing required argument: workspace_path'
        }
        print(json.dumps(result))
        sys.exit(1)
    
    workspace_path = sys.argv[1]
    
    # Validate workspace path exists
    if not Path(workspace_path).is_dir():
        result = {
            'success': False,
            'error': f'Workspace path does not exist: {workspace_path}'
        }
        print(json.dumps(result))
        sys.exit(1)
    
    # Run initialization
    result = asyncio.run(initialize_cognee(workspace_path))
    
    # Output JSON result
    print(json.dumps(result))
    
    # Exit with appropriate code
    sys.exit(0 if result['success'] else 1)


if __name__ == '__main__':
    main()
