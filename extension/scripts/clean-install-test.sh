#!/bin/bash

# Clean-Install Smoke Test for Cognee Chat Memory Extension
# 
# This script automates the pre-installation cleanup and provides
# step-by-step instructions for manual verification in VS Code.
#
# Purpose: Validate that fresh installation works without errors
# (tests the original v0.2.1 regression scenario)

set -e

EXTENSION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_WORKSPACE="/tmp/cognee-clean-install-test"
VSIX_FILE="${EXTENSION_DIR}/cognee-chat-memory-0.2.1.vsix"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Cognee Chat Memory: Clean-Install Smoke Test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# Step 1: Check if VSIX exists
echo "Step 1: Checking for VSIX package..."
if [ ! -f "$VSIX_FILE" ]; then
    echo "❌ VSIX not found: $VSIX_FILE"
    echo "   Run: npm run package"
    exit 1
fi
echo "✅ Found VSIX: $VSIX_FILE"
echo

# Step 2: Create clean test workspace
echo "Step 2: Creating clean test workspace..."
if [ -d "$TEST_WORKSPACE" ]; then
    echo "   Removing existing test workspace..."
    rm -rf "$TEST_WORKSPACE"
fi
mkdir -p "$TEST_WORKSPACE"
echo "✅ Created: $TEST_WORKSPACE"
echo

# Step 3: Remove all Cognee data directories
echo "Step 3: Removing all Cognee data directories..."
rm -rf "$TEST_WORKSPACE/.cognee"*
echo "✅ Cleaned: .cognee* directories"
echo

# Step 4: Create test .env file with API key
echo "Step 4: Creating test .env file..."
cat > "$TEST_WORKSPACE/.env" << 'EOF'
# Test environment for Cognee Chat Memory
LLM_API_KEY=sk-test-clean-install-key-12345
EOF
echo "✅ Created: $TEST_WORKSPACE/.env"
echo

# Step 5: Manual verification steps
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "MANUAL VERIFICATION REQUIRED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "Please complete the following steps manually in VS Code:"
echo
echo "1. Install the VSIX extension:"
echo "   code --install-extension $VSIX_FILE"
echo
echo "2. Open the test workspace:"
echo "   code $TEST_WORKSPACE"
echo
echo "3. Verify in VS Code:"
echo "   a. Open Output channel: View > Output > Select 'Cognee Memory'"
echo "   b. Look for initialization message:"
echo "      [INFO] Initialized workspace [...]"
echo "   c. Check status bar shows: 'Cognee Memory: Initialized'"
echo "   d. Verify NO errors about missing ontology or API key"
echo
echo "4. Expected Output Channel content:"
echo "   ✅ '[INFO] CogneeClient initialized'"
echo "   ✅ '[INFO] Initialized workspace [...]'"
echo "   ✅ '[INFO] Ontology configuration'"
echo "   ✅ 'ontology_loaded: true'"
echo "   ✅ 'ontology_entities: 8'"
echo "   ✅ 'ontology_relationships: 12'"
echo
echo "5. Test basic functionality:"
echo "   a. Open any text file in the workspace"
echo "   b. Trigger chat participant: Type '@cognee-memory test'"
echo "   c. Verify participant responds without errors"
echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "VERIFICATION CHECKLIST"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "Mark each item as you verify:"
echo
echo "[ ] Extension installs without errors"
echo "[ ] Workspace opens without errors"
echo "[ ] Output channel shows successful initialization"
echo "[ ] Status bar shows 'Cognee Memory: Initialized'"
echo "[ ] No missing ontology errors"
echo "[ ] No missing API key errors"
echo "[ ] Ontology loaded with 8 entities and 12 relationships"
echo "[ ] Chat participant responds to queries"
echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "CLEANUP (after verification)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "To clean up after testing:"
echo "  rm -rf $TEST_WORKSPACE"
echo
echo "To uninstall extension:"
echo "  code --uninstall-extension lsalsich.cognee-chat-memory"
echo

# Test workspace path for easy access
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Quick Commands (copy-paste ready):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "# Install extension"
echo "code --install-extension $VSIX_FILE"
echo
echo "# Open test workspace"
echo "code $TEST_WORKSPACE"
echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
