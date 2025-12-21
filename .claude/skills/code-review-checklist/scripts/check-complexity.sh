#!/bin/bash
# Code complexity check
# Identifies files that may need refactoring
#
# Usage: ./check-complexity.sh [path]

set -euo pipefail

TARGET="${1:-.}"

echo "Checking code complexity in: $TARGET"
echo ""

# Large files (potential God objects)
echo "📏 Large files (>500 lines):"
LARGE_FILES=$(find "$TARGET" \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.java" \) \
  -exec wc -l {} \; 2>/dev/null | awk '$1 > 500 {print}' | sort -rn | head -10)

if [[ -n "$LARGE_FILES" ]]; then
  echo "$LARGE_FILES"
else
  echo "  ✓ No excessively large files"
fi
echo ""

# Files with many imports (high coupling)
echo "🔗 High import count (>15 imports):"
for ext in ts tsx js jsx; do
  find "$TARGET" -name "*.$ext" -exec sh -c '
    count=$(grep -c "^import " "$1" 2>/dev/null || echo 0)
    if [ "$count" -gt 15 ]; then
      echo "  $count imports: $1"
    fi
  ' _ {} \; 2>/dev/null
done | sort -rn | head -10

for pyfile in $(find "$TARGET" -name "*.py" 2>/dev/null); do
  count=$(grep -cE "^(import |from .+ import )" "$pyfile" 2>/dev/null || echo 0)
  if [[ "$count" -gt 15 ]]; then
    echo "  $count imports: $pyfile"
  fi
done | head -10
echo ""

# Deeply nested functions (complexity indicator)
echo "🪆 Deep nesting (4+ levels):"
find "$TARGET" \( -name "*.ts" -o -name "*.js" -o -name "*.py" \) -exec sh -c '
  if grep -qE "^(\s{16}|\t{4})" "$1" 2>/dev/null; then
    echo "  Deep nesting found: $1"
  fi
' _ {} \; 2>/dev/null | head -10
echo ""

# Long functions (>50 lines between function/def and closing)
echo "📜 Long functions detected:"
if command -v grep &> /dev/null; then
  # Simple heuristic: files with function + 50 lines on same indentation
  find "$TARGET" \( -name "*.ts" -o -name "*.js" \) -exec sh -c '
    if grep -qE "^[^/]*function.*\{" "$1" 2>/dev/null || grep -qE "^[^/]*=>.*\{" "$1" 2>/dev/null; then
      total=$(wc -l < "$1")
      funcs=$(grep -cE "(function|=>.*\{)" "$1" 2>/dev/null || echo 1)
      avg=$((total / (funcs + 1)))
      if [ "$avg" -gt 50 ]; then
        echo "  Avg ~$avg lines/function: $1"
      fi
    fi
  ' _ {} \; 2>/dev/null | head -10
fi
echo ""

echo "================================"
echo "Review flagged files for potential refactoring"
