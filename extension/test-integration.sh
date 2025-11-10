#!/bin/bash

# CogneeClient Integration Test
# Tests Python bridge scripts with correct paths and workspace isolation

set -e  # Exit on error

echo "=== CogneeClient Integration Test ==="
echo ""

# Use test workspace instead of main workspace
WORKSPACE_A="/tmp/cognee_test_workspace_a"
PYTHON_PATH="/home/luke/Documents/Github-projects/cognee/.venv/bin/python"
BRIDGE_DIR="/home/luke/Documents/Github-projects/cognee/extension/bridge"

# Create test workspace and copy .env
mkdir -p "$WORKSPACE_A"
cp /home/luke/Documents/Github-projects/cognee/.env "$WORKSPACE_A/" 2>/dev/null || echo "OPENAI_API_KEY=${OPENAI_API_KEY}" > "$WORKSPACE_A/.env"

# Test 1: Initialize
echo "Test 1: Initialize Cognee"
INIT_RESULT=$($PYTHON_PATH $BRIDGE_DIR/init.py $WORKSPACE_A)
echo "$INIT_RESULT" | jq .
if echo "$INIT_RESULT" | jq -e '.success == true' > /dev/null; then
    echo "✓ Initialize successful"
    # Store for later tests
    DATASET_NAME_A=$(echo "$INIT_RESULT" | jq -r '.dataset_name')
    echo "  Dataset name: $DATASET_NAME_A"
else
    echo "✗ Initialize failed"
    exit 1
fi
echo ""

# Test 2: Ingest
echo "Test 2: Ingest test conversation"
INGEST_RESULT=$($PYTHON_PATH $BRIDGE_DIR/ingest.py "$WORKSPACE_A" \
    "What is Python?" \
    "Python is a high-level programming language known for its simplicity and readability." \
    "0.5")
echo "$INGEST_RESULT" | jq .
if echo "$INGEST_RESULT" | jq -e '.success == true' > /dev/null; then
    echo "✓ Ingest successful ($(echo "$INGEST_RESULT" | jq -r '.ingested_chars') chars)"
else
    echo "✗ Ingest failed"
    exit 1
fi
echo ""

# Wait for cognify to complete (important for subsequent tests)
echo "Waiting for entity extraction to complete (30 seconds)..."
sleep 30

# Test 3: Retrieve
echo "Test 3: Retrieve context"
RETRIEVE_RESULT=$($PYTHON_PATH $BRIDGE_DIR/retrieve.py "$WORKSPACE_A" \
    "programming language" \
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

# Test 4: Workspace Isolation
echo "=== Test 4: Workspace Isolation ==="
echo "Testing that different workspaces have separate memories..."

# Create second test workspace
WORKSPACE_B="/tmp/cognee_test_workspace_b"
mkdir -p "$WORKSPACE_B"
cp "$WORKSPACE_A/.env" "$WORKSPACE_B/.env"

# Initialize second workspace
INIT_RESULT_B=$($PYTHON_PATH "$BRIDGE_DIR/init.py" "$WORKSPACE_B")
if ! echo "$INIT_RESULT_B" | jq -e '.success' > /dev/null 2>&1; then
    echo "❌ Failed to initialize workspace B"
    exit 1
fi
DATASET_NAME_B=$(echo "$INIT_RESULT_B" | jq -r '.dataset_name')
echo "✓ Workspace B initialized (dataset: $DATASET_NAME_B)"

# Verify different dataset names
if [ "$DATASET_NAME_A" == "$DATASET_NAME_B" ]; then
    echo "❌ Both workspaces have same dataset name (should be unique)"
    exit 1
fi
echo "✓ Workspaces have unique dataset names"

# Ingest different conversation in workspace B
INGEST_RESULT_B=$($PYTHON_PATH "$BRIDGE_DIR/ingest.py" "$WORKSPACE_B" \
    "What is TypeScript?" \
    "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript." \
    "0.5")

if ! echo "$INGEST_RESULT_B" | jq -e '.success' > /dev/null 2>&1; then
    echo "❌ Failed to ingest to workspace B"
    exit 1
fi
echo "✓ Conversation ingested to workspace B"

# Wait for cognify to complete
echo "Waiting for entity extraction to complete (30 seconds)..."
sleep 30

# Retrieve from workspace A (should only see Python conversation)
RETRIEVE_A=$($PYTHON_PATH "$BRIDGE_DIR/retrieve.py" "$WORKSPACE_A" \
    "programming language" 3 2000 0.3 0.2)

if echo "$RETRIEVE_A" | grep -q "TypeScript"; then
    echo "❌ Workspace A leaked data from workspace B"
    exit 1
fi
echo "✓ Workspace A isolated (no TypeScript data)"

# Retrieve from workspace B (should only see TypeScript conversation)
RETRIEVE_B=$($PYTHON_PATH "$BRIDGE_DIR/retrieve.py" "$WORKSPACE_B" \
    "programming language" 3 2000 0.3 0.2)

if echo "$RETRIEVE_B" | grep -q "Python" | grep -v "TypeScript"; then
    echo "❌ Workspace B leaked data from workspace A"
    exit 1
fi
echo "✓ Workspace B isolated (no Python data)"

# Verify marker files exist in local .cognee directories
if [ ! -f "$WORKSPACE_A/.cognee/.dataset_migration_complete" ]; then
    echo "❌ Workspace A migration marker not created"
    exit 1
fi

if [ ! -f "$WORKSPACE_B/.cognee/.dataset_migration_complete" ]; then
    echo "❌ Workspace B migration marker not created"
    exit 1
fi
echo "✓ Marker files exist in both workspaces"

echo "✓ Test 4 passed: Workspace isolation verified"
echo ""

# Test 5: Ontology Loading
echo "=== Test 5: Ontology Loading ==="
echo "Verifying chat ontology loaded correctly..."

# Check init.py response includes ontology info
ONTOLOGY_LOADED=$(echo "$INIT_RESULT" | jq -r '.ontology_loaded')
ENTITY_COUNT=$(echo "$INIT_RESULT" | jq -r '.ontology_entities')
RELATIONSHIP_COUNT=$(echo "$INIT_RESULT" | jq -r '.ontology_relationships')

if [ "$ONTOLOGY_LOADED" != "true" ]; then
    echo "❌ Ontology not loaded"
    exit 1
fi
echo "✓ Ontology loaded: true"

if [ "$ENTITY_COUNT" != "8" ]; then
    echo "❌ Expected 8 entities, got $ENTITY_COUNT"
    exit 1
fi
echo "✓ Entity count: 8"

if [ "$RELATIONSHIP_COUNT" != "12" ]; then
    echo "❌ Expected 12 relationships, got $RELATIONSHIP_COUNT"
    exit 1
fi
echo "✓ Relationship count: 12"

echo "✓ Test 5 passed: Ontology verification complete"
echo ""

# Test 5b: Re-initialization Safety
echo "=== Test 5b: Re-initialization Safety ==="
echo "Verifying re-initialization does not destroy data..."

# Call init.py AGAIN on same workspace
INIT_RESULT_2=$($PYTHON_PATH "$BRIDGE_DIR/init.py" "$WORKSPACE_A")
MIGRATION_PERFORMED_2=$(echo "$INIT_RESULT_2" | jq -r '.migration_performed')

if [ "$MIGRATION_PERFORMED_2" != "false" ]; then
    echo "❌ Re-initialization triggered migration (should be false)"
    exit 1
fi
echo "✓ Re-initialization safe: migration_performed=false"

# Verify marker file still exists
if [ ! -f "$WORKSPACE_A/.cognee/.dataset_migration_complete" ]; then
    echo "❌ Marker file .dataset_migration_complete not preserved"
    exit 1
fi
echo "✓ Marker file preserved: .dataset_migration_complete"

echo "✓ Test 5b passed: Re-initialization safety verified"
echo ""

# Cleanup
rm -rf "$WORKSPACE_A" "$WORKSPACE_B"

echo "=== All Tests Passed ==="
echo ""
echo "CogneeClient integration validated:"
echo "  - Python bridge scripts work correctly"
echo "  - Dataset-based workspace isolation working"
echo "  - Ontology loaded and scoped per workspace"
echo "  - Re-initialization safe (preserves data)"
echo "  - All scripts return valid JSON"
