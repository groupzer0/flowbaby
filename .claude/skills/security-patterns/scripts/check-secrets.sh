#!/bin/bash
# Check for hardcoded secrets patterns
# Lightweight, no external dependencies
#
# Usage: ./check-secrets.sh [path]

set -euo pipefail

TARGET="${1:-.}"

echo "Checking for hardcoded secrets in: $TARGET"
echo ""

ISSUES=0

# Patterns to detect
PATTERNS=(
  # AWS
  'AKIA[0-9A-Z]{16}'
  'aws_secret_access_key\s*=\s*["\047][^"]+["\047]'
  # Generic API keys
  'api[_-]?key\s*[=:]\s*["\047][a-zA-Z0-9]{20,}["\047]'
  'apikey\s*[=:]\s*["\047][a-zA-Z0-9]{20,}["\047]'
  # Passwords in config
  'password\s*[=:]\s*["\047][^"]{8,}["\047]'
  'passwd\s*[=:]\s*["\047][^"]{8,}["\047]'
  # Private keys
  '-----BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----'
  # GitHub tokens
  'gh[pousr]_[A-Za-z0-9_]{36,}'
  # Generic secrets
  'secret\s*[=:]\s*["\047][^"]{8,}["\047]'
  # JWT
  'eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*'
)

# File extensions to check
EXTENSIONS="ts,tsx,js,jsx,py,go,java,rb,php,yaml,yml,json,env,ini,conf,config"

for pattern in "${PATTERNS[@]}"; do
  MATCHES=$(grep -rniE "$pattern" "$TARGET" \
    --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
    --include="*.py" --include="*.go" --include="*.java" --include="*.rb" \
    --include="*.yaml" --include="*.yml" --include="*.json" --include="*.env" \
    --include="*.ini" --include="*.conf" --include="*.config" \
    2>/dev/null || true)
  
  if [[ -n "$MATCHES" ]]; then
    echo "⚠️  Potential secret pattern found:"
    echo "$MATCHES" | head -5
    echo ""
    ISSUES=$((ISSUES + 1))
  fi
done

# Check for .env files that shouldn't be committed
ENV_FILES=$(find "$TARGET" -name ".env" -o -name ".env.local" -o -name ".env.production" 2>/dev/null || true)
if [[ -n "$ENV_FILES" ]]; then
  echo "⚠️  Found .env files (ensure not committed):"
  echo "$ENV_FILES"
  ISSUES=$((ISSUES + 1))
fi

echo ""
if [[ $ISSUES -eq 0 ]]; then
  echo "✓ No obvious secrets detected"
  exit 0
else
  echo "✗ Found $ISSUES potential secret pattern(s) - review manually"
  exit 1
fi
