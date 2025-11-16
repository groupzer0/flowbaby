# Release Checklist

Use this checklist when preparing and publishing a new release of the Cognee Chat Memory extension.

## Pre-Release

### Code Quality

- [ ] All integration tests pass: `./test-integration.sh`
- [ ] No ESLint warnings: `npm run lint`
- [ ] No TypeScript compilation errors: `npm run compile`
- [ ] No console errors in Extension Development Host (F5)
- [ ] Extension activates correctly on workspace open
- [ ] All settings work as documented

### Version Management

- [ ] Version bumped in `package.json` (follow semver)
- [ ] `CHANGELOG.md` updated with new version section
- [ ] All user-facing changes documented in CHANGELOG
- [ ] Git repository is clean (no uncommitted changes)

### Documentation

- [ ] `README.md` reflects current features and installation process
- [ ] Troubleshooting section covers known issues
- [ ] Configuration table lists all settings accurately
- [ ] Screenshots/GIFs are up-to-date (if applicable)
- [ ] Known limitations section is current
- [ ] Links to GitHub URLs are correct

### Assets

- [ ] Extension icon exists at `media/icon.png` (128x128 PNG)
- [ ] Icon is professional and represents the product well
- [ ] LICENSE file is present and correct
- [ ] No sensitive data or API keys in codebase

## Build and Package

### Clean Build

- [ ] Remove old artifacts: `rm -rf dist/ node_modules/`
- [ ] Fresh install: `npm install`
- [ ] Compile production bundle: `npm run compile`
- [ ] Verify bundle size: `dist/extension.js` should be ~5-10 KB

### Integration Testing

Run full test suite:

```bash
./test-integration.sh
```

Verify all tests pass:

- [ ] Test 1: Initialize Cognee ✓
- [ ] Test 2: Ingest Data ✓
- [ ] Test 3: Retrieve Context ✓
- [ ] Test 4: Workspace Isolation ✓
- [ ] Test 5: Ontology Loading ✓
- [ ] Test 6: Error Handling ✓

### Package Extension

```bash
npm run package
```

Verify:

- [ ] VSIX created: `cognee-chat-memory-X.Y.Z.vsix`
- [ ] File size is reasonable (<5 MB)
- [ ] No warnings during packaging

### Automated VSIX Verification (NEW - Plan 012)

Run automated verification script:

```bash
npm run verify:vsix
```

**This step is critical** - it prevents packaging regressions like the v0.2.1 ontology.ttl issue.

Verify:

- [ ] All required files present and non-empty
- [ ] No excluded files accidentally included
- [ ] Package metadata valid (name, version, engines)
- [ ] Script exits with code 0 (success)

**Rationale**: See `agent-output/planning/012-fix-initialization-regression.md` for context on why this step was added.

### Manual VSIX Contents Check (Optional - verify:vsix should catch issues)

If you want to manually inspect:

```bash
unzip -l cognee-chat-memory-X.Y.Z.vsix
```

Confirm these files are included:

- [ ] `extension/dist/extension.js` (production bundle)
- [ ] `extension/bridge/*.py` (all Python scripts including ontology_provider.py)
- [ ] `extension/bridge/ontology.ttl` (NOT ontology.json - TTL is canonical format)
- [ ] `extension/bridge/requirements.txt`
- [ ] `extension/media/icon.png`
- [ ] `extension/package.json`
- [ ] `extension/README.md`
- [ ] `extension/LICENSE`
- [ ] `extension/CHANGELOG.md`

Confirm these files are **NOT** included:

- [ ] `extension/src/` (TypeScript source files)
- [ ] `extension/node_modules/`
- [ ] `extension/test*.js` or `test*.sh`
- [ ] `extension/tsconfig.json`
- [ ] `extension/esbuild.js`
- [ ] `extension/.vscode/`

## Test Installation

### Clean VS Code Instance (CRITICAL - Plan 012)

Test in a clean environment to catch initialization regressions:

```bash
code --disable-extensions
```

**Before installation, clean up any existing state**:

```bash
# Remove workspace-local Cognee directories
rm -rf .cognee/ .cognee_system/ .cognee_data/
```

Install from VSIX:

- [ ] Extensions → ... menu → "Install from VSIX"
- [ ] Select `cognee-chat-memory-X.Y.Z.vsix`
- [ ] Extension appears in Extensions list
- [ ] No installation errors
- [ ] **CRITICAL**: Extension initializes successfully (check Output Channel)
- [ ] **CRITICAL**: Ontology loads without "file not found" errors
- [ ] **CRITICAL**: API key guidance references `LLM_API_KEY` (not deprecated `OPENAI_API_KEY`)

**Rationale**: v0.2.1 failed fresh installs due to missing ontology.ttl. This step verifies packaging is correct. See `agent-output/planning/012-fix-initialization-regression.md` for context.

### Functional Testing

- [ ] Extension activates on workspace open
- [ ] Output Channel "Cognee Memory" appears
- [ ] All settings appear in Settings UI
- [ ] Chat participant `@workspace` responds correctly
- [ ] Memory capture works in actual Copilot chat
- [ ] Context retrieval returns relevant results
- [ ] No errors in Developer Tools Console

### Prerequisites Validation

Run the prerequisites script:

```bash
./scripts/check-prerequisites.sh
```

Verify:

- [ ] Script detects VS Code correctly
- [ ] Script validates Python version
- [ ] Script confirms Cognee installation
- [ ] Script provides clear next steps

## Git and GitHub

### Create Git Tag

```bash
git add package.json CHANGELOG.md
git commit -m "chore: release v0.X.Y"
git tag v0.X.Y
git push origin main --tags
```

Verify:

- [ ] Tag created: `git tag -l`
- [ ] Tag pushed to GitHub
- [ ] Commit appears on main branch

### Create GitHub Release

1. Navigate to: <https://github.com/lsalsich/cognee/releases>
2. Click **"Draft a new release"**

Fill in release form:

- [ ] **Tag**: `v0.X.Y` (select existing tag)
- [ ] **Title**: "Cognee Chat Memory v0.X.Y"
- [ ] **Description**: Copy from CHANGELOG.md (format as needed)
- [ ] **Attach binary**: Upload `cognee-chat-memory-X.Y.Z.vsix`

Preview release:

- [ ] Tag is correct
- [ ] Title matches version
- [ ] Description is clear and formatted correctly
- [ ] VSIX file is attached

### Publish Release

- [ ] Click **"Publish release"** (NOT "Save draft")
- [ ] Release appears on Releases page
- [ ] VSIX download link works

## Post-Release Validation

### End-to-End Test

Simulate a new user:

1. Download VSIX from GitHub Releases page
2. Install: `code --install-extension <file>.vsix`
3. Configure settings (API key, etc.)
4. Test in real workspace with Copilot chat

Verify:

- [ ] VSIX downloads correctly from GitHub
- [ ] Installation succeeds
- [ ] Configuration process matches README instructions
- [ ] Extension works end-to-end

### Documentation Links

Check all documentation links work:

- [ ] README links to GitHub Releases work
- [ ] CHANGELOG link in README works
- [ ] Contributing link in README works
- [ ] License link in README works
- [ ] Bug report URL in package.json works
- [ ] Homepage URL in package.json works

### Communication

- [ ] Update root `README.md` with new release link (if needed)
- [ ] Post release announcement (if applicable)
- [ ] Close any GitHub issues fixed in this release
- [ ] Update project board/milestones (if applicable)

## Rollback Plan

If critical issues are discovered after release:

- [ ] Mark GitHub Release as "pre-release" to warn users
- [ ] Add warning banner to release notes
- [ ] Document the issue in GitHub Issues
- [ ] Create hotfix branch: `git checkout -b hotfix/v0.X.Y+1`
- [ ] Fix the bug and create patch release
- [ ] Test thoroughly before publishing patch

## Notes

- This checklist should be used for every release
- Check off each item as you complete it
- If you skip any items, document why in release notes
- Keep this checklist updated as release process evolves

---

**Version**: 1.0  
**Last Updated**: November 10, 2025  
**Next Review**: After v0.2.0 release
