#!/bin/bash
# Pre-commit review checklist validator
# Checks for common issues before code review
#
# Usage: ./pre-review-check.sh [path]

set -euo pipefail

TARGET="${1:-.}"

echo "Pre-Review Checklist: $TARGET"
echo "================================"
echo ""

ISSUES=0
WARNINGS=0

# Check for debug statements
echo "🔍 Debug statements:"
DEBUG_PATTERNS='console\.log|console\.debug|debugger|print\(|pdb\.set_trace|binding\.pry'
DEBUG_FOUND=$(grep -rniE "$DEBUG_PATTERNS" "$TARGET" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --include="*.py" --include="*.rb" 2>/dev/null | grep -v "node_modules" | head -10 || true)

if [[ -n "$DEBUG_FOUND" ]]; then
  echo "  ⚠️  Debug statements found:"
  echo "$DEBUG_FOUND" | sed 's/^/    /'
  WARNINGS=$((WARNINGS + 1))
else
  echo "  ✓ No debug statements"
fi
echo ""

# Check for TODO/FIXME comments
echo "📝 TODO/FIXME comments:"
TODO_FOUND=$(grep -rniE "(TODO|FIXME|XXX|HACK):" "$TARGET" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --include="*.py" --include="*.go" 2>/dev/null | grep -v "node_modules" | head -10 || true)

if [[ -n "$TODO_FOUND" ]]; then
  COUNT=$(echo "$TODO_FOUND" | wc -l)
  echo "  ⚠️  $COUNT TODO/FIXME items found"
  WARNINGS=$((WARNINGS + 1))
else
  echo "  ✓ No TODO/FIXME comments"
fi
echo ""

# Check for console errors being swallowed
echo "🚫 Swallowed errors:"
SWALLOWED=$(grep -rniE "catch\s*\([^)]*\)\s*\{\s*\}" "$TARGET" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" 2>/dev/null \
  | grep -v "node_modules" | head -5 || true)

if [[ -n "$SWALLOWED" ]]; then
  echo "  ⚠️  Empty catch blocks found:"
  echo "$SWALLOWED" | sed 's/^/    /'
  ISSUES=$((ISSUES + 1))
else
  echo "  ✓ No empty catch blocks"
fi
echo ""

# Check for hardcoded URLs
echo "🌐 Hardcoded URLs:"
URL_FOUND=$(grep -rniE "https?://[a-zA-Z0-9]+(localhost|127\.0\.0\.1|staging|dev\.|test\.)" "$TARGET" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --include="*.py" 2>/dev/null | grep -v "node_modules" | head -5 || true)

if [[ -n "$URL_FOUND" ]]; then
  echo "  ⚠️  Hardcoded dev/staging URLs found:"
  echo "$URL_FOUND" | sed 's/^/    /'
  WARNINGS=$((WARNINGS + 1))
else
  echo "  ✓ No hardcoded dev URLs"
fi
echo ""

# Check for any() type usage (TypeScript)
echo "📐 TypeScript any usage:"
ANY_FOUND=$(grep -rniE ": any\b|as any\b|<any>" "$TARGET" \
  --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "node_modules" | grep -v "\.d\.ts" | head -5 || true)

if [[ -n "$ANY_FOUND" ]]; then
  COUNT=$(echo "$ANY_FOUND" | wc -l)
  echo "  ⚠️  $COUNT 'any' type usages found"
  WARNINGS=$((WARNINGS + 1))
else
  echo "  ✓ No 'any' type usage"
fi
echo ""

# Summary
echo "================================"
echo "Summary:"
if [[ $ISSUES -gt 0 ]]; then
  echo "  ❌ Issues requiring attention: $ISSUES"
fi
if [[ $WARNINGS -gt 0 ]]; then
  echo "  ⚠️  Warnings to review: $WARNINGS"
fi
if [[ $ISSUES -eq 0 ]] && [[ $WARNINGS -eq 0 ]]; then
  echo "  ✓ All pre-review checks passed"
fi

exit $ISSUES
