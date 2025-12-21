#!/bin/bash
# Lint runner - runs available linters across project
# 
# Usage: ./run-linters.sh [path]

set -euo pipefail

TARGET="${1:-.}"

echo "Running linters on: $TARGET"
echo "================================"
echo ""

ISSUES=0

# ESLint (JavaScript/TypeScript)
if [[ -f "$TARGET/package.json" ]] && grep -q "eslint" "$TARGET/package.json" 2>/dev/null; then
  echo "📦 ESLint:"
  pushd "$TARGET" > /dev/null
  if npx eslint . --ext .ts,.tsx,.js,.jsx --max-warnings=0 2>/dev/null; then
    echo "  ✓ No ESLint issues"
  else
    echo "  ✗ ESLint issues found"
    ISSUES=$((ISSUES + 1))
  fi
  popd > /dev/null
  echo ""
elif command -v eslint &> /dev/null; then
  echo "📦 ESLint (global):"
  if eslint "$TARGET" --ext .ts,.tsx,.js,.jsx 2>/dev/null; then
    echo "  ✓ No ESLint issues"
  else
    echo "  ✗ ESLint issues found"
    ISSUES=$((ISSUES + 1))
  fi
  echo ""
fi

# Prettier check
if [[ -f "$TARGET/package.json" ]] && grep -q "prettier" "$TARGET/package.json" 2>/dev/null; then
  echo "🎨 Prettier:"
  pushd "$TARGET" > /dev/null
  if npx prettier --check . 2>/dev/null; then
    echo "  ✓ Code is formatted"
  else
    echo "  ⚠️  Formatting issues (run: npx prettier --write .)"
    ISSUES=$((ISSUES + 1))
  fi
  popd > /dev/null
  echo ""
fi

# TypeScript compiler
if [[ -f "$TARGET/tsconfig.json" ]]; then
  echo "📘 TypeScript:"
  pushd "$TARGET" > /dev/null
  if npx tsc --noEmit 2>/dev/null; then
    echo "  ✓ No type errors"
  else
    echo "  ✗ Type errors found"
    ISSUES=$((ISSUES + 1))
  fi
  popd > /dev/null
  echo ""
fi

# Python linters
if [[ -f "$TARGET/requirements.txt" ]] || find "$TARGET" -name "*.py" -type f | head -1 | grep -q .; then
  # Ruff (fast Python linter)
  if command -v ruff &> /dev/null; then
    echo "🐍 Ruff (Python):"
    if ruff check "$TARGET" 2>/dev/null; then
      echo "  ✓ No Ruff issues"
    else
      echo "  ✗ Ruff issues found"
      ISSUES=$((ISSUES + 1))
    fi
    echo ""
  # Fallback to flake8
  elif command -v flake8 &> /dev/null; then
    echo "🐍 Flake8 (Python):"
    if flake8 "$TARGET" 2>/dev/null; then
      echo "  ✓ No Flake8 issues"
    else
      echo "  ✗ Flake8 issues found"
      ISSUES=$((ISSUES + 1))
    fi
    echo ""
  fi
  
  # mypy (Python type checking)
  if command -v mypy &> /dev/null && [[ -f "$TARGET/pyproject.toml" ]]; then
    echo "📘 mypy (Python types):"
    if mypy "$TARGET" 2>/dev/null; then
      echo "  ✓ No type errors"
    else
      echo "  ⚠️  Type issues found"
    fi
    echo ""
  fi
fi

# Go
if [[ -f "$TARGET/go.mod" ]]; then
  echo "🐹 Go:"
  pushd "$TARGET" > /dev/null
  if go vet ./... 2>/dev/null; then
    echo "  ✓ go vet passed"
  else
    echo "  ✗ go vet issues found"
    ISSUES=$((ISSUES + 1))
  fi
  
  if command -v staticcheck &> /dev/null; then
    if staticcheck ./... 2>/dev/null; then
      echo "  ✓ staticcheck passed"
    else
      echo "  ✗ staticcheck issues found"
      ISSUES=$((ISSUES + 1))
    fi
  fi
  popd > /dev/null
  echo ""
fi

# Summary
echo "================================"
if [[ $ISSUES -eq 0 ]]; then
  echo "✓ All linters passed"
  exit 0
else
  echo "✗ $ISSUES linter(s) reported issues"
  exit 1
fi
