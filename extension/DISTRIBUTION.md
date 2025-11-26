# Distribution Guide

This document explains how to package and distribute the Flowbaby Chat Memory extension.

## Prerequisites

- `@vscode/vsce` installed globally: `npm install -g @vscode/vsce`
- Git repository clean (no uncommitted changes)
- All integration tests passing: `./test-integration.sh`
- CHANGELOG.md updated with new version
- Extension icon created at `media/icon.png` (128x128 PNG)

## Release Workflow

### 1. Version Bump

Update version in `package.json`:

```json
{
  "version": "0.2.0"  // Increment according to semver
}
```

Update `CHANGELOG.md` with new version section:

```markdown
## [0.2.0] - YYYY-MM-DD

### Added
- New feature description

### Fixed
- Bug fix description

### Changed
- Breaking changes or modifications
```

Commit version bump:

```bash
git add package.json CHANGELOG.md
git commit -m "chore: bump version to 0.2.0"
git tag v0.2.0
git push origin main --tags
```

### 2. Build and Package

```bash
cd extension/

# Clean build
rm -rf dist/ node_modules/
npm install
npm run compile

# Run integration tests
./test-integration.sh

# Package extension
vsce package
```

This creates `flowbaby-0.3.9.vsix`.

### 3. Test VSIX Locally

```bash
# Test in clean VS Code instance
code --disable-extensions
# Then: Extensions → ... → Install from VSIX
```

**Verification Checklist**:

- [ ] Extension activates on workspace open
- [ ] All settings appear in Settings UI
- [ ] Integration tests pass in installed extension
- [ ] No console errors in Developer Tools
- [ ] Output Channel "Flowbaby Memory" shows logs correctly

### 4. Create GitHub Release

1. Navigate to: <https://github.com/lsalsich/cognee/releases>
2. Click **"Draft a new release"**
3. **Tag**: `v0.2.0` (must match git tag)
4. **Title**: "Flowbaby Chat Memory v0.3.9"
5. **Description**: Copy relevant section from CHANGELOG.md
6. **Attach** `flowbaby-0.3.9.vsix` file
7. Click **"Publish release"**

### 5. Announce Release

- Update main README.md with latest version link
- Post to project community channels (if applicable)
- Update documentation site (if applicable)

## Distribution Channels

### Current: GitHub Releases (VSIX Downloads)

- **Method**: Manual installation from `.vsix` file
- **Location**: GitHub Releases page
- **Audience**: Early adopters, testers, and developers
- **Advantages**: Full control, no approval process, immediate distribution

Users install by:

1. Downloading `.vsix` from Releases page
2. Running `code --install-extension <file>.vsix` or using VS Code's "Install from VSIX" command

### Future: VS Code Marketplace

**Prerequisites**:

- Create publisher account: <https://marketplace.visualstudio.com/manage>
- Set `publisher` field in package.json to verified publisher ID
- Generate Personal Access Token (PAT) for publishing

**Publishing Command**:

```bash
vsce publish
```

**References**:

- [Publishing Extension Documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [VS Code Marketplace Management](https://marketplace.visualstudio.com/manage)

## Versioning Guidelines

Follow [Semantic Versioning](https://semver.org/) (semver):

- **Patch (0.1.1)**: Bug fixes, small improvements, no breaking changes
- **Minor (0.2.0)**: New features, no breaking changes, backward compatible
- **Major (1.0.0)**: Breaking changes, API changes, major milestones

### Examples

- `0.1.0 → 0.1.1`: Fixed workspace isolation bug
- `0.1.0 → 0.2.0`: Added new chat participant command
- `0.1.0 → 1.0.0`: Changed Python bridge API (breaking change)

## Rollback Process

If a release has critical bugs:

1. **Mark GitHub Release as "pre-release"** to warn users
2. **Add warning banner** to release notes explaining the issue
3. **Create hotfix branch** from the problematic release tag
4. **Fix the bug** and create patch version (e.g., 0.1.1)
5. **Test thoroughly** before publishing patch release
6. **Publish patch release** and update release notes
7. **Remove pre-release flag** from fixed version

## Troubleshooting

### "Publisher cannot be empty" error

**Problem**: `vsce package` fails with publisher validation error.

**Solution**:

- For local testing: `vsce package --allow-missing-publisher`
- For Marketplace: Set `publisher` in package.json to your verified publisher ID

### VSIX too large (>50 MB)

**Problem**: Package size exceeds reasonable limits.

**Solutions**:

- Verify `.vscodeignore` is excluding `node_modules/`
- Ensure production build is used (minified code)
- Remove unnecessary assets from `media/`
- Check for accidentally included large files

### Extension won't activate after installation

**Problem**: Extension installs but doesn't activate.

**Debug Steps**:

1. Check `package.json` `activationEvents` are correct
2. Verify `main` field points to correct bundle path (`dist/extension.js`)
3. Open Developer Tools console for errors: **Help → Toggle Developer Tools**
4. Check Output Channel "Cognee Memory" for initialization errors

### Integration tests fail during packaging

**Problem**: Tests pass locally but fail during release workflow.

**Debug Steps**:

1. Ensure clean environment: `rm -rf node_modules/ dist/ && npm install`
2. Check Python environment is activated (if using venv)
3. Verify Cognee 0.3.4 is installed: `python3 -c "import cognee; print(cognee.__version__)"`
4. Run tests with verbose output: Add `set -x` to test script
5. Check for workspace isolation issues (different workspaces interfering)

## Build Artifacts

After successful build, you should have:

- `dist/extension.js` - Bundled and minified TypeScript code (~6-10 KB)
- `flowbaby-X.Y.Z.vsix` - Installable extension package

**VSIX Contents** (verify with `unzip -l <file>.vsix`):

- `extension/dist/extension.js`
- `extension/bridge/*.py` (Python bridge scripts)
- `extension/bridge/ontology.json`
- `extension/bridge/requirements.txt`
- `extension/media/icon.png`
- `extension/package.json`
- `extension/README.md`
- `extension/LICENSE`
- `extension/CHANGELOG.md`

## Security Considerations

Before releasing:

- [ ] No API keys or secrets in code or configuration
- [ ] No sensitive user data in test fixtures
- [ ] Dependencies have no known vulnerabilities (`npm audit`)
- [ ] Python dependencies are pinned to known-good versions

## Post-Release Monitoring

After publishing a release:

1. **Monitor GitHub Issues** for bug reports
2. **Track download statistics** on GitHub Releases page
3. **Watch for common installation problems** in issue tracker
4. **Gather user feedback** for next version planning

---

**Maintained by**: Cognee Team  
**Last Updated**: November 10, 2025
