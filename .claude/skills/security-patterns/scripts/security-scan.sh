#!/bin/bash
# Security Scanning Script
# Runs available security tools and aggregates results
#
# Prerequisites: Install tools you want to use:
#   - gitleaks: brew install gitleaks / go install github.com/gitleaks/gitleaks/v8@latest
#   - semgrep: pip install semgrep
#   - npm audit: included with npm
#   - osv-scanner: go install github.com/google/osv-scanner/cmd/osv-scanner@latest
#
# Usage: ./security-scan.sh [path] [--quick]
#   path: Directory to scan (default: current directory)
#   --quick: Skip slow scans (semgrep)

set -euo pipefail

TARGET="${1:-.}"
QUICK_MODE=false
[[ "${2:-}" == "--quick" ]] && QUICK_MODE=true

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "Security Scan: $TARGET"
echo "========================================="
echo ""

ISSUES_FOUND=0

# Gitleaks - Secret Detection
if command -v gitleaks &> /dev/null; then
  echo -e "${YELLOW}[1/4] Running Gitleaks (secret detection)...${NC}"
  if gitleaks detect --source="$TARGET" --no-git 2>/dev/null; then
    echo -e "${GREEN}✓ No secrets detected${NC}"
  else
    echo -e "${RED}✗ Potential secrets found!${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
  fi
else
  echo -e "${YELLOW}[1/4] Gitleaks not installed (skipping)${NC}"
fi
echo ""

# npm audit - Dependency vulnerabilities (if package.json exists)
if [[ -f "$TARGET/package.json" ]] || [[ -f "$TARGET/package-lock.json" ]]; then
  echo -e "${YELLOW}[2/4] Running npm audit (dependency scan)...${NC}"
  pushd "$TARGET" > /dev/null
  if npm audit --audit-level=moderate 2>/dev/null; then
    echo -e "${GREEN}✓ No vulnerable dependencies${NC}"
  else
    echo -e "${RED}✗ Vulnerable dependencies found!${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
  fi
  popd > /dev/null
else
  echo -e "${YELLOW}[2/4] No package.json found (skipping npm audit)${NC}"
fi
echo ""

# OSV-Scanner - Multi-ecosystem vulnerability scan
if command -v osv-scanner &> /dev/null; then
  echo -e "${YELLOW}[3/4] Running OSV-Scanner (vulnerability database)...${NC}"
  if osv-scanner --recursive "$TARGET" 2>/dev/null; then
    echo -e "${GREEN}✓ No known vulnerabilities found${NC}"
  else
    echo -e "${RED}✗ Vulnerabilities detected!${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
  fi
else
  echo -e "${YELLOW}[3/4] OSV-Scanner not installed (skipping)${NC}"
fi
echo ""

# Semgrep - Static analysis (skip in quick mode)
if [[ "$QUICK_MODE" == "false" ]]; then
  if command -v semgrep &> /dev/null; then
    echo -e "${YELLOW}[4/4] Running Semgrep (static analysis)...${NC}"
    if semgrep scan --config=auto --quiet "$TARGET" 2>/dev/null; then
      echo -e "${GREEN}✓ No issues found${NC}"
    else
      echo -e "${RED}✗ Security issues detected!${NC}"
      ISSUES_FOUND=$((ISSUES_FOUND + 1))
    fi
  else
    echo -e "${YELLOW}[4/4] Semgrep not installed (skipping)${NC}"
  fi
else
  echo -e "${YELLOW}[4/4] Semgrep skipped (quick mode)${NC}"
fi
echo ""

# Summary
echo "========================================="
if [[ $ISSUES_FOUND -eq 0 ]]; then
  echo -e "${GREEN}Security scan complete: No issues found${NC}"
  exit 0
else
  echo -e "${RED}Security scan complete: $ISSUES_FOUND tool(s) found issues${NC}"
  exit 1
fi
