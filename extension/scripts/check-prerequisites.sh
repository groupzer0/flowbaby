#!/bin/bash
# Cognee Chat Memory - Prerequisites Validation Script
# Validates user environment before extension installation

set -e

echo "=================================================="
echo "  Cognee Chat Memory - Prerequisites Check"
echo "=================================================="
echo ""

# Track overall status
ALL_CHECKS_PASSED=true

# Check VS Code version
echo "📋 Checking VS Code installation..."
if command -v code &> /dev/null; then
    VS_CODE_VERSION=$(code --version 2>&1 | head -1)
    echo "   ✅ VS Code found: $VS_CODE_VERSION"
else
    echo "   ❌ VS Code not found in PATH"
    echo "      Install from: https://code.visualstudio.com"
    ALL_CHECKS_PASSED=false
fi
echo ""

# Check Python
echo "🐍 Checking Python installation..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
    PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
    PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)
    
    if [ "$PYTHON_MAJOR" -ge 3 ] && [ "$PYTHON_MINOR" -ge 8 ]; then
        echo "   ✅ Python $PYTHON_VERSION found (>= 3.8 required)"
    else
        echo "   ⚠️  Python $PYTHON_VERSION found, but 3.8+ is recommended"
        echo "      Update from: https://python.org"
    fi
else
    echo "   ❌ Python 3 not found"
    echo "      Install Python 3.8+: https://python.org"
    ALL_CHECKS_PASSED=false
fi
echo ""

# Check Cognee
echo "🧠 Checking Cognee installation..."
if command -v python3 &> /dev/null; then
    COGNEE_CHECK=$(python3 -c "import cognee; print(cognee.__version__)" 2>&1)
    if [ $? -eq 0 ]; then
        echo "   ✅ Cognee $COGNEE_CHECK found"
        
        # Check if it's the recommended version
        if [ "$COGNEE_CHECK" = "0.3.4" ]; then
            echo "      ✅ Version 0.3.4 (recommended)"
        else
            echo "      ⚠️  Version $COGNEE_CHECK found, but 0.3.4 is recommended"
            echo "      Update with: pip install cognee==0.3.4"
        fi
    else
        echo "   ❌ Cognee not installed"
        echo "      Install with: pip install cognee==0.3.4"
        ALL_CHECKS_PASSED=false
    fi
else
    echo "   ⚠️  Skipped (Python not found)"
fi
echo ""

# Check API key (optional warning)
echo "🔑 Checking for OpenAI API key..."
if [ -n "$OPENAI_API_KEY" ]; then
    KEY_PREFIX=$(echo $OPENAI_API_KEY | cut -c1-7)
    echo "   ✅ OPENAI_API_KEY found in environment ($KEY_PREFIX...)"
else
    echo "   ⚠️  OPENAI_API_KEY not set in environment"
    echo "      You'll need to create a .env file in your workspace with:"
    echo "      OPENAI_API_KEY=sk-your-key-here"
    echo ""
    echo "      This is not blocking, but required for extension operation."
fi
echo ""

# Final summary
echo "=================================================="
if [ "$ALL_CHECKS_PASSED" = true ]; then
    echo "✅ Prerequisites Check Complete - All Required Dependencies Found!"
    echo "=================================================="
    echo ""
    echo "Next steps:"
    echo "1. Download cognee-chat-memory-0.1.0.vsix from GitHub Releases"
    echo "2. Install in VS Code:"
    echo "   • Press Ctrl+Shift+P (or Cmd+Shift+P on macOS)"
    echo "   • Type 'Install from VSIX' and select the command"
    echo "   • Navigate to the .vsix file and select it"
    echo "3. Open a workspace folder"
    echo "4. Create .env file with OPENAI_API_KEY if not set"
    echo "5. Check Output → Cognee Memory for activation status"
    echo ""
    exit 0
else
    echo "❌ Prerequisites Check Failed - Missing Required Dependencies"
    echo "=================================================="
    echo ""
    echo "Please install the missing dependencies listed above and run this script again."
    echo ""
    exit 1
fi
