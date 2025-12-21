#!/bin/bash
# Test coverage analyzer
# Checks test coverage and identifies gaps
#
# Usage: ./check-coverage.sh [path] [--report]

set -euo pipefail

TARGET="${1:-.}"
REPORT=false
[[ "${2:-}" == "--report" ]] && REPORT=true

echo "Test Coverage Analysis: $TARGET"
echo "================================"
echo ""

# Node.js / Jest
if [[ -f "$TARGET/package.json" ]]; then
  if grep -qE '"jest"|"vitest"' "$TARGET/package.json" 2>/dev/null; then
    echo "📦 JavaScript/TypeScript coverage:"
    pushd "$TARGET" > /dev/null
    
    if grep -q '"vitest"' package.json 2>/dev/null; then
      RUNNER="vitest run --coverage"
    else
      RUNNER="jest --coverage --coverageReporters=text"
    fi
    
    if $REPORT; then
      npx $RUNNER 2>/dev/null || echo "  ⚠️  Coverage run failed or no tests"
    else
      npx $RUNNER --coverageReporters=text-summary 2>/dev/null || echo "  ⚠️  Coverage run failed or no tests"
    fi
    popd > /dev/null
    echo ""
  fi
fi

# Python
if [[ -f "$TARGET/requirements.txt" ]] || [[ -f "$TARGET/pyproject.toml" ]]; then
  if command -v coverage &> /dev/null || command -v pytest &> /dev/null; then
    echo "🐍 Python coverage:"
    pushd "$TARGET" > /dev/null
    
    if command -v pytest &> /dev/null && [[ -f "pyproject.toml" ]] && grep -q "pytest" pyproject.toml 2>/dev/null; then
      pytest --cov="$TARGET" --cov-report=term-missing 2>/dev/null || echo "  ⚠️  Coverage run failed or no tests"
    elif command -v coverage &> /dev/null; then
      coverage run -m pytest 2>/dev/null && coverage report 2>/dev/null || echo "  ⚠️  Coverage run failed"
    else
      echo "  ⚠️  Install pytest-cov: pip install pytest-cov"
    fi
    popd > /dev/null
    echo ""
  fi
fi

# Go
if [[ -f "$TARGET/go.mod" ]]; then
  echo "🐹 Go coverage:"
  pushd "$TARGET" > /dev/null
  go test -cover ./... 2>/dev/null || echo "  ⚠️  Coverage run failed or no tests"
  popd > /dev/null
  echo ""
fi

echo "================================"
echo "Review coverage gaps and add tests for critical paths"
