#!/bin/bash
# Test runner - runs tests across package managers
#
# Usage: ./run-tests.sh [path] [--watch]

set -euo pipefail

TARGET="${1:-.}"
WATCH=false
[[ "${2:-}" == "--watch" ]] && WATCH=true

echo "Running tests in: $TARGET"
echo "================================"
echo ""

EXIT_CODE=0

# Node.js
if [[ -f "$TARGET/package.json" ]]; then
  echo "📦 Node.js tests:"
  pushd "$TARGET" > /dev/null
  
  # Detect test runner
  if grep -q '"vitest"' package.json 2>/dev/null; then
    RUNNER="vitest"
  elif grep -q '"jest"' package.json 2>/dev/null; then
    RUNNER="jest"
  elif grep -q '"mocha"' package.json 2>/dev/null; then
    RUNNER="mocha"
  else
    RUNNER=""
  fi
  
  if [[ -n "$RUNNER" ]]; then
    if [[ "$WATCH" == "true" ]] && [[ "$RUNNER" != "mocha" ]]; then
      npx $RUNNER --watch
    else
      if npx $RUNNER 2>/dev/null; then
        echo "  ✓ All tests passed"
      else
        echo "  ✗ Tests failed"
        EXIT_CODE=1
      fi
    fi
  elif npm run test 2>/dev/null; then
    echo "  ✓ npm test passed"
  else
    echo "  ⚠️  No test runner configured or tests failed"
    EXIT_CODE=1
  fi
  
  popd > /dev/null
  echo ""
fi

# Python
if [[ -f "$TARGET/requirements.txt" ]] || [[ -f "$TARGET/pyproject.toml" ]] || [[ -f "$TARGET/setup.py" ]]; then
  echo "🐍 Python tests:"
  pushd "$TARGET" > /dev/null
  
  if command -v pytest &> /dev/null; then
    if [[ "$WATCH" == "true" ]] && command -v pytest-watch &> /dev/null; then
      ptw
    else
      if pytest -v 2>/dev/null; then
        echo "  ✓ All tests passed"
      else
        echo "  ✗ Tests failed"
        EXIT_CODE=1
      fi
    fi
  elif python -m unittest discover 2>/dev/null; then
    echo "  ✓ unittest passed"
  else
    echo "  ⚠️  No test runner or tests failed"
    EXIT_CODE=1
  fi
  
  popd > /dev/null
  echo ""
fi

# Go
if [[ -f "$TARGET/go.mod" ]]; then
  echo "🐹 Go tests:"
  pushd "$TARGET" > /dev/null
  
  if go test -v ./... 2>/dev/null; then
    echo "  ✓ All tests passed"
  else
    echo "  ✗ Tests failed"
    EXIT_CODE=1
  fi
  
  popd > /dev/null
  echo ""
fi

# Summary
echo "================================"
if [[ $EXIT_CODE -eq 0 ]]; then
  echo "✓ All test suites passed"
else
  echo "✗ Some tests failed"
fi

exit $EXIT_CODE
