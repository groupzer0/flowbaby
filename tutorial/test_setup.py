#!/usr/bin/env python3
"""Quick test to verify setup is working."""

import sys
from pathlib import Path

print("=" * 60)
print("TESTING COGNEE SETUP")
print("=" * 60)

# Test 1: Environment variables
print("\n1. Testing environment variables...")
from dotenv import load_dotenv
import os
load_dotenv()
api_key = os.getenv("OPENAI_API_KEY")
if api_key and api_key != "your_openai_api_key_here":
    print(f"   ✓ OPENAI_API_KEY configured (length: {len(api_key)})")
else:
    print("   ✗ OPENAI_API_KEY not configured")
    sys.exit(1)

# Test 2: Cognee import
print("\n2. Testing cognee import...")
try:
    import cognee
    print(f"   ✓ Cognee imported successfully (version: {cognee.__version__ if hasattr(cognee, '__version__') else 'unknown'})")
except ImportError as e:
    print(f"   ✗ Failed to import cognee: {e}")
    sys.exit(1)

# Test 3: Utils import
print("\n3. Testing utils import...")
sys.path.insert(0, str(Path(__file__).parent))
try:
    from utils.asset_helpers import download_remote_assets, preview_downloaded_assets
    print("   ✓ Utils imported successfully")
except ImportError as e:
    print(f"   ✗ Failed to import utils: {e}")
    sys.exit(1)

# Test 4: Artifacts directory
print("\n4. Testing artifacts directory...")
artifacts_dir = Path("artifacts")
if artifacts_dir.exists():
    print(f"   ✓ Artifacts directory exists: {artifacts_dir.absolute()}")
else:
    print(f"   ✗ Artifacts directory not found")

# Test 5: Data directory
print("\n5. Testing data directory...")
data_dir = Path("data/sample")
if data_dir.exists():
    files = list(data_dir.glob("*"))
    print(f"   ✓ Data directory exists with {len(files)} files:")
    for f in files:
        if f.is_file():
            print(f"     - {f.name} ({f.stat().st_size} bytes)")
else:
    print(f"   ✗ Data directory not found")

print("\n" + "=" * 60)
print("SETUP TEST COMPLETE")
print("=" * 60)
print("\nAll basic tests passed! Ready to run walkthrough.")
print("\nNext step: python download_data.py")
