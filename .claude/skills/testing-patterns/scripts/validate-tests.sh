#!/bin/bash
# Test file validator
# Ensures tests exist for source files and follow naming conventions
#
# Usage: ./validate-tests.sh [path]

set -euo pipefail

TARGET="${1:-.}"

echo "Test File Validation: $TARGET"
echo "================================"
echo ""

MISSING=0
TOTAL=0

# JavaScript/TypeScript
echo "📦 JavaScript/TypeScript:"

# Find source files (exclude test files, node_modules, etc.)
for src in $(find "$TARGET" -name "*.ts" -o -name "*.tsx" 2>/dev/null | \
  grep -v "node_modules" | \
  grep -v "\.test\." | \
  grep -v "\.spec\." | \
  grep -v "__tests__" | \
  grep -v "\.d\.ts" | \
  grep -v "/test/" | \
  head -50); do
  
  TOTAL=$((TOTAL + 1))
  
  # Check for corresponding test file
  basename=$(basename "$src" | sed 's/\.tsx\?$//')
  dirname=$(dirname "$src")
  
  # Check common test patterns
  has_test=false
  for pattern in \
    "$dirname/$basename.test.ts" \
    "$dirname/$basename.test.tsx" \
    "$dirname/$basename.spec.ts" \
    "$dirname/$basename.spec.tsx" \
    "$dirname/__tests__/$basename.test.ts" \
    "$dirname/__tests__/$basename.test.tsx"; do
    if [[ -f "$pattern" ]]; then
      has_test=true
      break
    fi
  done
  
  if [[ "$has_test" == "false" ]]; then
    echo "  ⚠️  No test: $src"
    MISSING=$((MISSING + 1))
  fi
done

if [[ $TOTAL -eq 0 ]]; then
  echo "  No TypeScript source files found"
else
  COVERED=$((TOTAL - MISSING))
  echo ""
  echo "  Files: $TOTAL | Tested: $COVERED | Missing: $MISSING"
fi
echo ""

# Python
echo "🐍 Python:"
PY_MISSING=0
PY_TOTAL=0

for src in $(find "$TARGET" -name "*.py" 2>/dev/null | \
  grep -v "__pycache__" | \
  grep -v "test_" | \
  grep -v "_test\.py" | \
  grep -v "conftest" | \
  grep -v "/tests/" | \
  head -50); do
  
  PY_TOTAL=$((PY_TOTAL + 1))
  
  basename=$(basename "$src" .py)
  dirname=$(dirname "$src")
  
  has_test=false
  for pattern in \
    "$dirname/test_$basename.py" \
    "$dirname/${basename}_test.py" \
    "$dirname/tests/test_$basename.py"; do
    if [[ -f "$pattern" ]]; then
      has_test=true
      break
    fi
  done
  
  if [[ "$has_test" == "false" ]] && [[ "$basename" != "__init__" ]]; then
    echo "  ⚠️  No test: $src"
    PY_MISSING=$((PY_MISSING + 1))
  fi
done

if [[ $PY_TOTAL -eq 0 ]]; then
  echo "  No Python source files found"
else
  PY_COVERED=$((PY_TOTAL - PY_MISSING))
  echo ""
  echo "  Files: $PY_TOTAL | Tested: $PY_COVERED | Missing: $PY_MISSING"
fi
echo ""

# Summary
TOTAL_MISSING=$((MISSING + PY_MISSING))
echo "================================"
if [[ $TOTAL_MISSING -eq 0 ]]; then
  echo "✓ All source files have corresponding tests"
else
  echo "⚠️  $TOTAL_MISSING source file(s) missing tests"
  echo "   Consider adding tests for critical business logic"
fi
