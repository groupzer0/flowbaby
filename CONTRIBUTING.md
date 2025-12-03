# Contributing to Flowbaby

Thank you for contributing to the Cognee Chat Memory extension! This guide covers development setup, coding standards, and the pull request process.

## Table of Contents

- [Development Environment Setup](#development-environment-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)
- [Branch Naming Conventions](#branch-naming-conventions)
- [Commit Message Format](#commit-message-format)
- [Documentation Guidelines](#documentation-guidelines)
- [Release Process](#release-process)

## Development Environment Setup

### Prerequisites

- **VS Code**: Version 1.85 or later
- **Node.js**: Version 18.x or later (for extension development)
- **Python**: Version 3.8 or later
- **Git**: For version control
- **OpenAI API Key**: Required for testing (set as `OPENAI_API_KEY` environment variable)

### Initial Setup

1. **Clone the repository**:

   ```bash
   git clone https://github.com/groupzer0/flowbaby.git
   cd flowbaby/extension
   ```

2. **Install Node.js dependencies**:

   ```bash
   npm install
   ```

3. **Install Python dependencies**:

   ```bash
   cd bridge/
   pip install -r requirements.txt
   cd ..
   ```

4. **Verify Cognee installation**:

   ```bash
   python3 -c "import cognee; print(cognee.__version__)"
   # Should output: 0.3.4 (or later)
   ```

5. **Configure API key**:

   ```bash
   # Add to ~/.bashrc or ~/.zshrc
   export OPENAI_API_KEY="your-api-key-here"
   ```

### Running the Extension

1. **Open extension folder in VS Code**:

   ```bash
   code /path/to/cognee/extension
   ```

2. **Start development build**:

   - Press `F5` or click **Run → Start Debugging**
   - This opens a new "Extension Development Host" VS Code window

3. **Test the extension**:

   - Open a workspace in the Extension Development Host window
   - Open a chat conversation: **View → Chat** or `Ctrl+Alt+I`
   - Type: `@workspace` to trigger memory capture
   - Check Output Channel **"Cognee Memory"** for logs

### Running Integration Tests

```bash
cd extension/
./test-integration.sh
```

**Expected Output**:

```
✓ Test 1: Initialize Cognee
✓ Test 2: Ingest Data  
✓ Test 3: Retrieve Context
✓ Test 4: Workspace Isolation
✓ Test 5: Ontology Loading
✓ Test 6: Error Handling
```

If tests fail, check:

- Python environment has Cognee 0.3.4 installed
- OpenAI API key is set
- No leftover marker files: `rm /tmp/cognee_*`

## Project Structure

```
extension/
├── src/
│   ├── extension.ts           # Main extension entry point
│   └── cogneeClient.ts        # Python bridge client
├── bridge/
│   ├── init.py                # Initialize Cognee for workspace
│   ├── ingest.py              # Ingest chat messages
│   ├── retrieve.py            # Retrieve relevant context
│   ├── ontology.json          # Default entity ontology
│   └── requirements.txt       # Python dependencies
├── dist/
│   └── extension.js           # Compiled production bundle (generated)
├── media/
│   └── icon.png               # Extension icon (128x128 PNG)
├── scripts/
│   └── check-prerequisites.sh # Environment validation script
├── test-integration.sh        # Integration test suite
├── package.json               # Extension manifest
├── tsconfig.json              # TypeScript configuration
├── esbuild.js                 # Production build script
├── README.md                  # User-facing documentation
├── CHANGELOG.md               # Version history
├── DISTRIBUTION.md            # Release and packaging guide
├── LICENSE                    # MIT License
└── RELEASE_CHECKLIST.md       # Pre-release checklist
```

## Coding Standards

### TypeScript

- **Style**: Follow [TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
- **Formatting**: Use Prettier (configured in project)
- **Linting**: ESLint rules configured in `.eslintrc.json`

**Example**:

```typescript
// Good: Clear function with JSDoc
/**
 * Ingests chat messages into Cognee memory.
 * @param workspaceId Unique workspace identifier
 * @param messages Chat messages to ingest
 * @returns Ingest response from Cognee
 */
async function ingestMessages(
    workspaceId: string,
    messages: string[]
): Promise<IngestResponse> {
    // Implementation
}

// Bad: No types, unclear name
function doIt(id, msgs) {
    // Implementation
}
```

### Python

- **Style**: Follow [PEP 8](https://peps.python.org/pep-0008/)
- **Type Hints**: Use type annotations for function signatures
- **Docstrings**: Include for all public functions

**Example**:

```python
# Good: Type hints and docstring
def ingest_data(dataset_name: str, data: str) -> dict:
    """
    Ingest data into Cognee dataset.
    
    Args:
        dataset_name: Name of the dataset to ingest into
        data: Text data to ingest
    
    Returns:
        Dictionary with ingest results
    """
    # Implementation
    pass

# Bad: No types or documentation
def ingest(dataset, data):
    pass
```

### General Principles

- **Simplicity**: Prefer simple solutions over clever ones
- **Error Handling**: Always handle errors gracefully with informative messages
- **Logging**: Use VS Code Output Channel for debugging (not console.log)
- **Security**: Never commit API keys, secrets, or sensitive data

## Testing Requirements

### Unit Tests

Currently, unit tests are minimal. When adding features, consider adding unit tests for:

- Pure utility functions
- Data transformation logic
- Validation functions

### Integration Tests

**All PRs must pass integration tests** before merging. Tests are located in `test-integration.sh`.

**How to run**:

```bash
cd extension/
./test-integration.sh
```

**What they test**:

1. **Initialization**: Cognee initializes with unique dataset per workspace
2. **Ingestion**: Chat messages are ingested successfully
3. **Retrieval**: Relevant context is retrieved based on query
4. **Workspace Isolation**: Different workspaces don't share memory
5. **Ontology Loading**: Custom ontology loads correctly
6. **Error Handling**: Graceful error messages for common failures

### Manual Testing Checklist

Before submitting PR, verify:

- [ ] Extension activates on workspace open
- [ ] Chat participant `@workspace` responds correctly
- [ ] Output Channel "Cognee Memory" shows clear logs
- [ ] No errors in Developer Tools Console
- [ ] Settings changes take effect immediately
- [ ] Workspace isolation works (test with multiple workspaces)

## Pull Request Process

### 1. Create Feature Branch

```bash
git checkout -b feat/descriptive-feature-name
```

See [Branch Naming Conventions](#branch-naming-conventions) for naming guidelines.

### 2. Make Changes

- Write code following [Coding Standards](#coding-standards)
- Add tests if introducing new functionality
- Update documentation (README, CHANGELOG, etc.)

### 3. Test Changes

```bash
# Run integration tests
./test-integration.sh

# Test manually in VS Code Extension Development Host (F5)
```

### 4. Commit Changes

```bash
git add .
git commit -m "feat: add automatic context retrieval"
```

See [Commit Message Format](#commit-message-format) for guidelines.

### 5. Push and Open PR

```bash
git push origin feat/descriptive-feature-name
```

Open pull request on GitHub: <https://github.com/groupzer0/flowbaby/pulls>

**PR Template**:

```markdown
## Description
Brief description of changes.

## Changes Made
- Added X feature
- Fixed Y bug
- Updated Z documentation

## Testing
- [ ] Integration tests pass
- [ ] Manually tested in Extension Development Host
- [ ] No console errors

## Checklist
- [ ] Code follows project style guidelines
- [ ] Documentation updated (if applicable)
- [ ] CHANGELOG.md updated (if user-facing change)
- [ ] No API keys or secrets committed
```

### 6. Code Review

- Maintainers will review your PR
- Address feedback by pushing new commits to the same branch
- Once approved, maintainers will merge

## Branch Naming Conventions

Use descriptive branch names with prefixes:

- `feat/` - New feature (e.g., `feat/add-ontology-loading`)
- `fix/` - Bug fix (e.g., `fix/workspace-isolation`)
- `docs/` - Documentation updates (e.g., `docs/update-readme`)
- `refactor/` - Code refactoring (e.g., `refactor/simplify-bridge`)
- `test/` - Test improvements (e.g., `test/add-unit-tests`)
- `chore/` - Maintenance tasks (e.g., `chore/update-dependencies`)

**Examples**:

- `feat/automatic-memory-capture`
- `fix/handle-empty-workspace`
- `docs/add-troubleshooting-guide`

## Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring (no feature change)
- `test`: Adding or updating tests
- `chore`: Maintenance (dependencies, build, etc.)

### Examples

```
feat(bridge): add ontology loading from workspace

- Added ontology.json support in workspace root
- Falls back to default ontology if not found
- Updated documentation

Closes #42
```

```
fix(extension): handle empty workspace folder

- Check workspace.workspaceFolders is defined
- Show error message if no workspace open
- Add test case for empty workspace scenario

Fixes #38
```

## Documentation Guidelines

### User-Facing Documentation

Update `README.md` when:

- Adding new features
- Changing settings or commands
- Updating installation process
- Adding troubleshooting steps

### Developer Documentation

Update this file (`CONTRIBUTING.md`) when:

- Changing development setup
- Adding new testing requirements
- Updating code style guidelines

### Changelog

**Always update `CHANGELOG.md`** for user-facing changes:

```markdown
## [Unreleased]

### Added
- Automatic context retrieval from chat history

### Fixed
- Workspace isolation issue causing data leakage

### Changed
- Updated Cognee dependency to 0.3.5
```

## Release Process

Releases are managed by maintainers. See [DISTRIBUTION.md](extension/DISTRIBUTION.md) for full release workflow.

### For Contributors

When your PR is merged:

1. Changes appear in `main` branch
2. Maintainers will include your changes in next release
3. You will be credited in release notes

### For Maintainers

See [DISTRIBUTION.md](extension/DISTRIBUTION.md) and [RELEASE_CHECKLIST.md](extension/RELEASE_CHECKLIST.md).

## Getting Help

- **Questions**: Open a GitHub Discussion
- **Bug Reports**: Open a GitHub Issue with reproduction steps
- **Feature Requests**: Open a GitHub Issue with use case description

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on improving the project

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing!**  
If you have questions about this guide, please open an issue or discussion on GitHub.
