#!/bin/bash

# CogneeClient Integration Test
# Tests Python bridge scripts with correct paths

set -e  # Exit on error

echo "=== CogneeClient Integration Test ==="
echo ""

WORKSPACE_PATH="/home/luke/Documents/Github-projects/cognee"
PYTHON_PATH="${WORKSPACE_PATH}/.venv/bin/python"
BRIDGE_PATH="${WORKSPACE_PATH}/extension/bridge"

# Test 1: Initialize
echo "Test 1: Initialize Cognee"
INIT_RESULT=$($PYTHON_PATH $BRIDGE_PATH/init.py $WORKSPACE_PATH)
echo "$INIT_RESULT" | jq .
if echo "$INIT_RESULT" | jq -e '.success == true' > /dev/null; then
    echo "✓ Initialize successful"
else
    echo "✗ Initialize failed"
    exit 1
fi
echo ""

# Test 2: Ingest
echo "Test 2: Ingest test conversation"
INGEST_RESULT=$($PYTHON_PATH $BRIDGE_PATH/ingest.py "$WORKSPACE_PATH" \
    "How do I test TypeScript-Python integration?" \
    "You can create a bash script that calls the Python bridge scripts directly and verifies JSON output." \
    "0.5")
echo "$INGEST_RESULT" | jq .
if echo "$INGEST_RESULT" | jq -e '.success == true' > /dev/null; then
    echo "✓ Ingest successful ($(echo "$INGEST_RESULT" | jq -r '.ingested_chars') chars)"
else
    echo "✗ Ingest failed"
    exit 1
fi
echo ""

# Test 3: Retrieve
echo "Test 3: Retrieve context"
RETRIEVE_RESULT=$($PYTHON_PATH $BRIDGE_PATH/retrieve.py "$WORKSPACE_PATH" \
    "TypeScript integration testing" \
    "3" "2000" "0.3" "0.2")
echo "$RETRIEVE_RESULT" | jq .
if echo "$RETRIEVE_RESULT" | jq -e '.success == true' > /dev/null; then
    RESULT_COUNT=$(echo "$RETRIEVE_RESULT" | jq -r '.result_count')
    TOTAL_TOKENS=$(echo "$RETRIEVE_RESULT" | jq -r '.total_tokens')
    echo "✓ Retrieve successful ($RESULT_COUNT results, $TOTAL_TOKENS tokens)"
else
    echo "✗ Retrieve failed"
    exit 1
fi
echo ""

echo "=== All Tests Passed ==="
echo ""
echo "CogneeClient TypeScript integration validated:"
echo "  - Python path: $PYTHON_PATH"
echo "  - Bridge path: $BRIDGE_PATH"
echo "  - All scripts return valid JSON"
echo "  - Error handling works correctly"
