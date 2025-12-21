# Release Document Templates

## Deployment Document Template

Use in `agent-output/deployment/[version].md`:

```markdown
# Deployment Report: v[X.Y.Z]

**Plan Reference**: `agent-output/planning/[plan-name].md`
**Release Date**: [YYYY-MM-DD]
**Deployed By**: DevOps Agent

## Release Summary

| Field | Value |
|-------|-------|
| Version | X.Y.Z |
| Type | PATCH / MINOR / MAJOR |
| Environment | Production / Staging |
| Epic/Plan | [Reference] |

## Pre-Release Verification

### Approval Status
- [ ] QA Status: [QA Complete / QA Failed]
- [ ] UAT Status: [APPROVED FOR RELEASE / NOT APPROVED]

### Version Consistency
| File | Expected | Actual | Status |
|------|----------|--------|--------|
| package.json | X.Y.Z | | ✓/✗ |
| CHANGELOG.md | X.Y.Z | | ✓/✗ |
| [other] | X.Y.Z | | ✓/✗ |

### Packaging Integrity
- [ ] Build successful
- [ ] Package created
- [ ] All required assets included
- [ ] No debug artifacts

### Workspace Cleanliness
- [ ] No uncommitted changes
- [ ] All changes committed
- [ ] Ready for tagging

## User Confirmation

**Confirmation Requested**: [timestamp]
**Summary Presented**: [version, changes, target]
**User Response**: [yes/no]
**Confirmed By**: [user name]
**Confirmed At**: [timestamp]

## Release Execution

### Git Tagging
- **Command**: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
- **Result**: [success/failure]
- **Tag Pushed**: [yes/no]

### Package Publication
- **Registry**: [VS Code Marketplace / npm / PyPI]
- **Command**: [command executed]
- **Result**: [success/failure]
- **Published URL**: [link]

### Verification
- [ ] Version visible in registry
- [ ] Package installable
- [ ] Changelog visible
- [ ] Functionality verified

## Post-Release Status

**Final Status**: Deployment Complete / Deployment Failed / Aborted
**Completed At**: [timestamp]

### Known Issues
- [None / List issues]

### Rollback Plan
[If needed: steps to revert]

## Deployment History Entry

```json
{
  "version": "X.Y.Z",
  "date": "YYYY-MM-DD",
  "type": "PATCH|MINOR|MAJOR",
  "status": "success|failed|aborted",
  "registry": "[registry name]",
  "url": "[published URL]",
  "authorizedBy": "[user]"
}
```

## Next Actions
- [If aborted: required fixes]
- [If complete: none or hand off to retrospective]
```

---

## CHANGELOG Entry Template

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- Brief description of new feature (#issue)

### Changed
- Brief description of change (#issue)

### Fixed
- Brief description of bug fix (#issue)

### Security
- Brief description of security fix (#issue)
```

---

## Git Tag Message Template

```
Release vX.Y.Z

Key changes:
- Feature: Brief description
- Fix: Brief description

Full changelog: [link to CHANGELOG]
```
