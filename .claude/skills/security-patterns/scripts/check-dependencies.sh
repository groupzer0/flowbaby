#!/bin/bash
# Dependency vulnerability check
# Checks for vulnerable dependencies across package managers
#
# Usage: ./check-dependencies.sh [path]

set -euo pipefail

TARGET="${1:-.}"

echo "Checking dependencies in: $TARGET"
echo ""

ISSUES=0

# npm/Node.js
if [[ -f "$TARGET/package-lock.json" ]] || [[ -f "$TARGET/package.json" ]]; then
  echo "📦 Node.js dependencies:"
  pushd "$TARGET" > /dev/null
  if npm audit --audit-level=moderate 2>/dev/null; then
    echo "  ✓ No vulnerable packages"
  else
    echo "  ✗ Vulnerabilities found"
    ISSUES=$((ISSUES + 1))
  fi
  popd > /dev/null
  echo ""
fi

# Python
if [[ -f "$TARGET/requirements.txt" ]]; then
  echo "🐍 Python dependencies:"
  if command -v pip-audit &> /dev/null; then
    if pip-audit -r "$TARGET/requirements.txt" 2>/dev/null; then
      echo "  ✓ No vulnerable packages"
    else
      echo "  ✗ Vulnerabilities found"
      ISSUES=$((ISSUES + 1))
    fi
  elif command -v safety &> /dev/null; then
    if safety check -r "$TARGET/requirements.txt" 2>/dev/null; then
      echo "  ✓ No vulnerable packages"
    else
      echo "  ✗ Vulnerabilities found"  
      ISSUES=$((ISSUES + 1))
    fi
  else
    echo "  ⚠ Install pip-audit or safety: pip install pip-audit"
  fi
  echo ""
fi

# Go
if [[ -f "$TARGET/go.mod" ]]; then
  echo "🐹 Go dependencies:"
  pushd "$TARGET" > /dev/null
  if command -v govulncheck &> /dev/null; then
    if govulncheck ./... 2>/dev/null; then
      echo "  ✓ No vulnerable packages"
    else
      echo "  ✗ Vulnerabilities found"
      ISSUES=$((ISSUES + 1))
    fi
  else
    echo "  ⚠ Install govulncheck: go install golang.org/x/vuln/cmd/govulncheck@latest"
  fi
  popd > /dev/null
  echo ""
fi

# Summary
echo "================================"
if [[ $ISSUES -eq 0 ]]; then
  echo "✓ Dependency check complete"
  exit 0
else
  echo "✗ Found issues in $ISSUES package manager(s)"
  exit 1
fi
