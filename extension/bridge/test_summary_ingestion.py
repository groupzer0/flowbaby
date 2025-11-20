#!/usr/bin/env python3
"""
Integration test for summary ingestion (Plan 014 Milestone 3).

This test verifies that ingest.py --summary mode works end-to-end.
Requires a workspace with .env containing LLM_API_KEY.

Usage:
    python test_summary_ingestion.py <workspace_path>
"""

import json
import subprocess
import sys
from pathlib import Path
from datetime import datetime
import pytest


@pytest.mark.manual
def test_summary_ingestion(workspace_path: str) -> bool:
    """
    Test ingest.py --summary mode with a sample summary.
    
    Args:
        workspace_path: Path to workspace with .env file
        
    Returns:
        bool: True if test passes, False otherwise
    """
    # Create sample summary JSON (camelCase to match TypeScript interface)
    summary_json = {
        "workspace_path": workspace_path,
        "topic": "Test Summary Ingestion",
        "context": "Testing Plan 014 Milestone 3 implementation",
        "decisions": ["Use enriched text format", "Embed metadata in text"],
        "rationale": ["Cognee 0.3.4 doesn't expose DataPoint class"],
        "openQuestions": [],
        "nextSteps": ["Implement Milestone 4 retrieval"],
        "references": ["Plan 014 documentation"],
        "timeScope": "2025-11-18T11:00:00Z to 2025-11-18T11:30:00Z (10 turns)",
        "topicId": "test-summary-ingestion",
        "sessionId": "test-session-001",
        "planId": "014",
        "status": "Active",
        "createdAt": datetime.now().isoformat() + "Z",
        "updatedAt": datetime.now().isoformat() + "Z"
    }
    
    # Serialize to JSON string
    summary_json_str = json.dumps(summary_json)
    
    # Get script path
    script_path = Path(__file__).parent / 'ingest.py'
    
    print(f"Testing summary ingestion to workspace: {workspace_path}")
    print(f"Summary topic: {summary_json['topic']}")
    print(f"Topic ID: {summary_json['topicId']}")
    
    # Determine Python path (prefer venv if exists)
    venv_python = Path(workspace_path) / '.venv' / 'bin' / 'python'
    python_path = str(venv_python) if venv_python.exists() else 'python3'
    
    print(f"Using Python: {python_path}\n")
    
    # Run ingest.py --summary
    try:
        result = subprocess.run(
            [python_path, str(script_path), '--summary', '--summary-json', summary_json_str],
            cwd=workspace_path,
            capture_output=True,
            text=True,
            timeout=60
        )
        
        print(f"\nReturn code: {result.returncode}")
        print(f"Stdout: {result.stdout}")
        print(f"Stderr (last 500 chars): {result.stderr[-500:]}")
        
        if result.returncode != 0:
            print(f"\n❌ Test FAILED: ingest.py exited with code {result.returncode}")
            return False
        
        # Parse JSON response
        try:
            response = json.loads(result.stdout)
        except json.JSONDecodeError as e:
            print(f"\n❌ Test FAILED: Could not parse JSON response: {e}")
            print(f"Raw stdout: {result.stdout}")
            return False
        
        # Verify success
        if not response.get('success'):
            print(f"\n❌ Test FAILED: ingestion returned success=false")
            print(f"Error: {response.get('error')}")
            return False
        
        # Verify response fields
        required_fields = ['success', 'ingested_chars', 'timestamp', 'metadata']
        missing_fields = [f for f in required_fields if f not in response]
        if missing_fields:
            print(f"\n⚠️  Warning: Response missing fields: {missing_fields}")
        
        # Verify metadata in response
        if 'metadata' in response:
            metadata = response['metadata']
            assert metadata['topic_id'] == summary_json['topicId']
            assert metadata['session_id'] == summary_json['sessionId']
            assert metadata['plan_id'] == summary_json['planId']
            assert metadata['status'] == summary_json['status']
            print(f"\n✅ Metadata validated:")
            print(f"   - Topic ID: {metadata['topic_id']}")
            print(f"   - Session ID: {metadata['session_id']}")
            print(f"   - Status: {metadata['status']}")
        
        # Success metrics
        print(f"\n✅ Test PASSED:")
        print(f"   - Ingested {response['ingested_chars']} characters")
        print(f"   - Timestamp: {response['timestamp']}")
        if 'ingestion_duration_sec' in response:
            print(f"   - Duration: {response['ingestion_duration_sec']:.2f} seconds")
        
        return True
        
    except subprocess.TimeoutExpired:
        print(f"\n❌ Test FAILED: ingest.py timed out after 60 seconds")
        return False
    except Exception as e:
        print(f"\n❌ Test FAILED: Exception: {e}")
        return False


def main():
    if len(sys.argv) < 2:
        print("Usage: python test_summary_ingestion.py <workspace_path>")
        print("\nExample:")
        print("  python test_summary_ingestion.py /home/luke/Documents/Github-projects/cognee")
        sys.exit(1)
    
    workspace_path = sys.argv[1]
    
    # Validate workspace path
    if not Path(workspace_path).is_dir():
        print(f"❌ Error: Workspace path does not exist: {workspace_path}")
        sys.exit(1)
    
    # Check for .env file
    env_file = Path(workspace_path) / '.env'
    if not env_file.exists():
        print(f"⚠️  Warning: No .env file found at {env_file}")
        print("   Summary ingestion may fail without LLM_API_KEY")
    
    # Run test
    success = test_summary_ingestion(workspace_path)
    
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
