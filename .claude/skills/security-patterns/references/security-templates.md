# Security Document Templates

Templates for security assessment documentation.

---

## File Naming Convention

`agent-output/security/NNN-[topic]-security-[type].md`

Types:
- `architecture-security` — Architectural security review
- `code-audit` — Code security review
- `dependency-audit` — Dependency/supply chain review
- `pre-production-gate` — Pre-release security gate

---

## Security Assessment Template

```markdown
# Security Assessment: [Feature/Component Name]

## Metadata
| Field | Value |
|-------|-------|
| Assessment Date | YYYY-MM-DD |
| Assessor | Security Agent |
| Assessment Type | [Full Review / Architecture / Code Audit / Dependency / Targeted] |
| Mode Determination | [User-specified / Inferred (reason) / Clarification asked (question)] |
| Scope | [Files, endpoints, components covered] |
| Version/Commit | [Git SHA or version] |
| Status | [In Progress / Complete / Blocked] |

## Changelog
| Date | Change | Impact |
|------|--------|--------|
| YYYY-MM-DD | Initial assessment | N/A |

## Executive Summary
[2-3 sentence overview of security posture and key findings]

**Overall Risk Rating**: [CRITICAL | HIGH | MEDIUM | LOW]
**Verdict**: [APPROVED | APPROVED_WITH_CONTROLS | BLOCKED_PENDING_REMEDIATION | REJECTED]

## Threat Model Summary
[Brief STRIDE analysis results, key threats identified]

## Findings

### Critical Findings (Must Fix Before Production)
| ID | Title | Category | Location | Description | Remediation | CVSS |
|----|-------|----------|----------|-------------|-------------|------|
| C-001 | ... | ... | file:line | ... | ... | 9.x |

### High Findings (Fix Before Production Recommended)
| ID | Title | Category | Location | Description | Remediation | CVSS |
|----|-------|----------|----------|-------------|-------------|------|
| H-001 | ... | ... | file:line | ... | ... | 7.x-8.x |

### Medium Findings (Fix in Next Sprint)
| ID | Title | Category | Location | Description | Remediation | CVSS |
|----|-------|----------|----------|-------------|-------------|------|
| M-001 | ... | ... | file:line | ... | ... | 4.x-6.x |

### Low Findings (Track for Future)
| ID | Title | Category | Location | Description | Remediation | CVSS |
|----|-------|----------|----------|-------------|-------------|------|
| L-001 | ... | ... | file:line | ... | ... | 0.1-3.x |

### Informational / Best Practice Recommendations
[Security improvements that aren't vulnerabilities but enhance posture]

## Positive Findings
[Security controls implemented well - acknowledge good practices]

## Required Controls
[Specific controls that must be implemented for approval]

## Testing Recommendations
[Security tests that should be added: unit, integration, penetration]

## Compliance Mapping
| Requirement | Standard | Status | Notes |
|-------------|----------|--------|-------|
| ... | OWASP ASVS 4.0 | ✅/❌ | ... |

## Appendix
- Detailed scan outputs
- Data flow diagrams
- Attack trees
- References
```

---

## Quick Finding Format

For inline findings in code reviews:

```markdown
**[SEVERITY]** ID: [Category] - [Title]
- **Location**: `file.ts:123`
- **Issue**: [What's wrong]
- **Risk**: [Impact if exploited]
- **Fix**: [How to remediate]
- **CVSS**: [Score]
```

---

## Verdict Definitions

| Verdict | Meaning | Action |
|---------|---------|--------|
| `APPROVED` | No blocking issues | Proceed to next phase |
| `APPROVED_WITH_CONTROLS` | Issues found but mitigated | Proceed with specified controls |
| `BLOCKED_PENDING_REMEDIATION` | Issues must be fixed | Fix and re-review |
| `BLOCKED_PENDING_DESIGN_CHANGE` | Architectural issue | Redesign required |
| `REJECTED` | Fundamental security flaw | Major rework needed |
