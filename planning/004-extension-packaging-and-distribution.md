# Implementation Plan: Extension Packaging and Distribution

**Plan ID**: 004  
**Created**: November 10, 2025  
**Status**: Active  
**Depends On**: Plan 003 (Workspace Isolation and Ontology Loading - Completed)

---

## Objective

Package the Cognee Chat Memory VS Code extension for distribution and create comprehensive installation documentation. This plan covers:

1. **Extension Packaging**: Build production-ready VSIX file with proper metadata and assets
2. **Installation Guide**: Create step-by-step instructions for end users
3. **Developer Setup**: Document contribution workflow and local development
4. **Distribution Options**: Prepare for multiple distribution channels (VSIX, Marketplace, GitHub Releases)
5. **Prerequisites Validation**: Ensure users can verify Python/Cognee setup before installation

**Note on Plan Content**: This plan focuses on creating documentation artifacts (README files, guides, scripts). The markdown examples, shell scripts, and configuration snippets shown are **example content for these documentation files**, not implementation code. The implementer has full freedom to improve wording, restructure sections, and adapt content to best serve users.

---

## Assumptions

1. **Plan 003 Complete**: Workspace isolation and ontology loading are working and tested
2. **TypeScript Build Working**: `npm run compile` produces working `dist/extension.js`
3. **Python Bridge Tested**: All bridge scripts (`init.py`, `ingest.py`, `retrieve.py`) function correctly
4. **Integration Tests Pass**: All 6 tests in `test-integration.sh` pass successfully
5. **No Marketplace Publishing Yet**: Initial distribution via VSIX files (GitHub Releases), Marketplace publishing deferred to future plan
6. **MIT License**: Extension will be released under MIT license
7. **User Has Technical Background**: Target audience is developers comfortable with command line, Python installation
8. **Local Installation Only**: Extension runs locally (no cloud services, no telemetry)

---

## Open Questions

**RESOLVED**: Distribute via GitHub Releases (VSIX downloads) initially; Marketplace publishing is separate future enhancement  
**RESOLVED**: Include Python dependency check in extension activation (show helpful error if Cognee not found) - Location: `extension/src/extension.ts` in `activate()` function, before CogneeClient initialization  
**RESOLVED**: Use semantic versioning starting at v0.1.0 (initial release)  
**RESOLVED**: Include icon and banner images in VSIX package for professional appearance  
**RESOLVED**: Prerequisites check: Extension should validate Python/Cognee on first activation and show setup instructions if missing  
**RESOLVED**: Root README.md will use minimal linking approach (not duplicate content) to avoid documentation drift

---

## Plan

### Milestone 1: Prepare Extension Metadata and Assets

**Objective**: Add all required metadata, icons, and documentation files for a professional extension package.

**Deliverables**:
- Extension icon (128x128 PNG)
- README with screenshots and installation instructions
- LICENSE file
- CHANGELOG documenting v0.1.0 features
- Updated package.json with complete metadata

**Steps**:

1. **Create `extension/media/` directory**:
   ```bash
   mkdir -p extension/media
   ```
   This directory will contain all visual assets for the extension.

2. **Create extension icon** at `extension/media/icon.png`:
   - 128x128 PNG image
   - Represents memory/knowledge graph concept (brain, graph nodes, or database icon)
   - Simple, recognizable design that works at small sizes
   - Use professional design tool or AI image generator
   - Ensure transparency and clean edges

3. **Create banner image** at `extension/media/banner.png`:
   - 640x320 PNG image for Marketplace header (if published later)
   - Same visual theme as icon
   - Include "Cognee Chat Memory" text
   - Optional for initial VSIX release

4. **Update `extension/package.json` metadata**:
   - Set `publisher` to actual publisher ID (change from "cognee" placeholder)
   - Add `icon` field: `"icon": "media/icon.png"`
   - Verify `repository` URL points to correct GitHub repo
   - Add `bugs` field: `"bugs": {"url": "https://github.com/lsalsich/cognee/issues"}`
   - Add `homepage` field: `"homepage": "https://github.com/lsalsich/cognee/tree/main/extension"`
   - Ensure `categories` and `keywords` are accurate for searchability

5. **Create `extension/LICENSE`**:
   - Copy MIT license text
   - Set copyright holder to "Cognee Team" or appropriate entity
   - Include year 2025

6. **Create `extension/CHANGELOG.md`**:
   
   **EXAMPLE CONTENT - ILLUSTRATIVE ONLY, NOT A REQUIREMENT**:
   The implementer should create appropriate changelog content. Below is a suggested structure:
   
   ```markdown
   # Changelog
   
   All notable changes to the Cognee Chat Memory extension will be documented in this file.
   
   ## [0.1.0] - 2025-11-10
   
   ### Added
   - Initial release of Cognee Chat Memory extension
   - Automatic capture of GitHub Copilot chat conversations
   - Automatic context retrieval from Cognee memory before responses
   - Workspace-isolated memory (each workspace has separate knowledge graph)
   - Chat-specific ontology (User, Question, Answer, Topic, Concept, Problem, Solution, Decision)
   - Hybrid graph-vector search combining relationships and semantic similarity
   - Recency and importance weighting for retrieved context
   - Configurable settings: maxContextResults, maxContextTokens, recencyWeight, importanceWeight
   - Integration test suite with 6 test cases
   - Python bridge scripts for Cognee communication
   - Output Channel logging for debugging
   
   ### Technical Details
   - Uses Cognee 0.3.4 dataset-based logical isolation
   - SHA1-hashed workspace identifiers for stable dataset naming
   - Global marker file prevents data loss during concurrent initialization
   - Stateless ontology configuration per ingestion
   ```

7. **Create `extension/.vscodeignore`** to exclude unnecessary files from VSIX:
   ```
   .vscode/**
   .vscode-test/**
   src/**
   node_modules/**
   out/test/**
   test/**
   .gitignore
   .eslintrc.json
   tsconfig.json
   esbuild.js
   test-*.js
   test-*.sh
   test-*.txt
   *.map
   **/*.ts
   ```
   
   **Critical**: Only include `dist/`, `bridge/`, `media/`, `README.md`, `LICENSE`, `CHANGELOG.md`, `package.json` in final VSIX

**Acceptance Criteria**:
- `extension/media/` directory created
- Extension icon exists at `extension/media/icon.png` (128x128 PNG)
- `package.json` has complete metadata (icon, publisher, repository, bugs, homepage)
- `LICENSE` file exists with MIT license text
- `CHANGELOG.md` documents v0.1.0 features
- `.vscodeignore` excludes source files and dev artifacts
- No placeholder values remain in `package.json` (publisher ID is real or documented as TODO)

---

### Milestone 2: Create Comprehensive User Documentation

**Objective**: Write installation guide and user documentation that non-contributors can follow to install and use the extension.

**Deliverables**:
- Updated `extension/README.md` with installation instructions
- Prerequisites validation script
- Troubleshooting guide
- Screenshots/GIFs demonstrating features

**Steps**:

1. **Update `extension/README.md`** with complete user guide:

   **DOCUMENTATION CONTENT - EXAMPLE TEXT**:
   The sections below show example content and structure for the user-facing README. The implementer has full freedom to reword, restructure, and improve this content for clarity and user experience. The goal is a comprehensive installation and usage guide—the text below is a starting point, not a requirement.

   **Required Sections**:
   
   - **Overview**: Brief description (2-3 sentences) of what the extension does
   - **Features**: Bullet list of key capabilities:
     - Automatic conversation capture
     - Context retrieval before responses
     - Workspace isolation
     - Hybrid graph-vector search
     - Customizable settings
   
   - **Prerequisites**: 
     - VS Code 1.85.0 or higher
     - Python 3.8+ installed and in PATH
     - Cognee 0.3.4 installed (`pip install cognee==0.3.4`)
     - OpenAI API key (or compatible LLM provider)
   
   - **Installation**:
     ```markdown
     ### Method 1: Install from VSIX (Recommended)
     
     1. Download the latest `.vsix` file from [GitHub Releases](https://github.com/lsalsich/cognee/releases)
     2. Open VS Code
     3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
     4. Type "Install from VSIX" and select the command
     5. Navigate to the downloaded `.vsix` file and select it
     6. Reload VS Code when prompted
     
     ### Method 2: Build from Source
     
     See [CONTRIBUTING.md](../CONTRIBUTING.md) for developer setup instructions.
     ```
   
   - **Setup** (First-time configuration):
     ```markdown
     1. **Verify Python and Cognee Installation**:
        ```bash
        python3 --version  # Should be 3.8 or higher
        python3 -c "import cognee; print(cognee.__version__)"  # Should print "0.3.4"
        ```
     
     2. **Configure API Key**:
        - Create a `.env` file in your workspace root
        - Add your API key: `OPENAI_API_KEY=sk-...`
        - Or set as environment variable before launching VS Code
     
     3. **Open a Workspace**:
        - The extension requires a workspace folder (doesn't work in single-file mode)
        - Open any folder in VS Code to create a workspace
     
     4. **Verify Extension Activation**:
        - Open Output panel (View → Output)
        - Select "Cognee Memory" from dropdown
        - You should see "Cognee initialized successfully" message
     ```
   
   - **Usage**:
     ```markdown
     ### Basic Usage
     
     1. Open GitHub Copilot Chat (`Ctrl+Alt+I` or click chat icon)
     2. Start typing your question
     3. The extension automatically:
        - Retrieves relevant context from past conversations
        - Shows "Retrieved N memories" indicator
        - Captures conversation after response completes
     
     ### Memory is Automatic
     
     - No special commands needed - memory works transparently
     - Each workspace has its own isolated memory
     - Context accumulates over time as you use Copilot
     
     ### Configuration
     
     Access settings via `File → Preferences → Settings → Extensions → Cognee Memory`:
     
     - `cogneeMemory.enabled` - Toggle memory on/off (default: true)
     - `cogneeMemory.maxContextResults` - Max results to retrieve (default: 3)
     - `cogneeMemory.maxContextTokens` - Token budget (default: 2000)
     - `cogneeMemory.recencyWeight` - Prioritize recent conversations (default: 0.3)
     - `cogneeMemory.importanceWeight` - Prioritize marked conversations (default: 0.2)
     - `cogneeMemory.pythonPath` - Python interpreter path (default: "python3")
     - `cogneeMemory.logLevel` - Debug verbosity (default: "info")
     ```
   
   - **Troubleshooting**:
     ```markdown
     ### Extension Not Activating
     
     **Check Output Channel**:
     - View → Output → Select "Cognee Memory"
     - Look for initialization errors
     
     **Common Issues**:
     
     1. **"OPENAI_API_KEY not found"**
        - Create `.env` file in workspace root
        - Add: `OPENAI_API_KEY=your_key_here`
        - Reload VS Code
     
     2. **"Python not found"** or **"cognee module not found"**
        - Verify Python installation: `python3 --version`
        - Install Cognee: `pip install cognee==0.3.4`
        - If using virtual environment, set `cogneeMemory.pythonPath` to venv Python
     
     3. **"No workspace folder open"**
        - Extension requires workspace (not single file mode)
        - Open a folder: File → Open Folder
     
     4. **Slow Performance**
        - Check `cogneeMemory.logLevel` is not "debug" (slows down)
        - Reduce `maxContextResults` to 1-2
        - Reduce `maxContextTokens` to 1000
     
     ### Memory Not Working
     
     1. **Verify Enabled**: Check `cogneeMemory.enabled` is true
     2. **Check Logs**: Output Channel shows retrieval attempts
     3. **Wait for First Ingest**: First conversation has no context (memory empty)
     4. **Check Workspace Isolation**: Each workspace has separate memory
     
     ### Clearing Memory
     
     To reset workspace memory:
     ```bash
     rm -rf .cognee/
     ```
     Extension will reinitialize on next activation.
     ```
   
   - **Architecture** (Brief technical overview):
     - TypeScript extension communicates with Python bridge scripts
     - Python scripts use Cognee library for knowledge graph operations
     - Each workspace gets unique dataset identifier (SHA1 hash)
     - Data stored in global Cognee database, logically isolated by dataset
     - Ontology defines chat entities (User, Question, Answer, Topic, etc.)
   
   - **Privacy and Data Storage**:
     ```markdown
     - All data stays on your local machine (no cloud services)
     - Memory stored in Cognee's database (typically `~/.local/share/cognee`)
     - Each workspace has isolated memory (no cross-project leakage)
     - No telemetry or analytics collected
     - API key never logged or transmitted except to LLM provider
     ```
   
   - **License**: MIT License - see LICENSE file
   
   - **Contributing**: See CONTRIBUTING.md for development setup
   
   - **Support**: 
     - GitHub Issues: https://github.com/lsalsich/cognee/issues
     - Documentation: https://docs.cognee.ai

2. **Create prerequisites validation script** at `extension/scripts/check-prerequisites.sh`:
   
   **EXAMPLE SCRIPT - ILLUSTRATIVE ONLY**:
   The implementer should create a script with appropriate validation logic. Below shows the intended functionality:
   
   ```bash
   #!/bin/bash
   # Validates user environment before extension installation
   
   set -e
   
   echo "=== Cognee Chat Memory - Prerequisites Check ==="
   echo ""
   
   # Check VS Code version
   echo "Checking VS Code version..."
   code --version | head -1 || {
       echo "❌ VS Code not found in PATH"
       echo "   Install from: https://code.visualstudio.com"
       exit 1
   }
   echo "✓ VS Code found"
   echo ""
   
   # Check Python
   echo "Checking Python installation..."
   PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
   if [ -z "$PYTHON_VERSION" ]; then
       echo "❌ Python 3 not found"
       echo "   Install Python 3.8+: https://python.org"
       exit 1
   fi
   echo "✓ Python $PYTHON_VERSION found"
   echo ""
   
   # Check Cognee
   echo "Checking Cognee installation..."
   COGNEE_VERSION=$(python3 -c "import cognee; print(cognee.__version__)" 2>&1)
   if [ $? -ne 0 ]; then
       echo "❌ Cognee not installed"
       echo "   Install with: pip install cognee==0.3.4"
       exit 1
   fi
   echo "✓ Cognee $COGNEE_VERSION found"
   echo ""
   
   # Check API key (optional warning)
   echo "Checking for OpenAI API key..."
   if [ -z "$OPENAI_API_KEY" ]; then
       echo "⚠️  OPENAI_API_KEY not set in environment"
       echo "   You'll need to create a .env file in your workspace"
       echo "   with: OPENAI_API_KEY=your_key_here"
   else
       echo "✓ OPENAI_API_KEY found in environment"
   fi
   echo ""
   
   echo "=== Prerequisites Check Complete ==="
   echo "✅ All required dependencies found"
   echo ""
   echo "Next steps:"
   echo "1. Download cognee-chat-memory-0.1.0.vsix"
   echo "2. Install in VS Code: Extensions → ... → Install from VSIX"
   echo "3. Open a workspace folder"
   echo "4. Check Output → Cognee Memory for activation status"
   ```

3. **Create screenshots** for README:
   - Screenshot 1: Extension in action showing "Retrieved 2 memories" indicator
   - Screenshot 2: Settings panel with all configuration options
   - Screenshot 3: Output Channel showing successful initialization logs
   - Optional: GIF showing full workflow (ask question → context retrieved → response → follow-up)

4. **Add screenshots to README**:
   ```markdown
   ## Screenshots
   
   ### Automatic Context Retrieval
   ![Context Retrieval](media/screenshot-retrieval.png)
   
   ### Configuration Options
   ![Settings](media/screenshot-settings.png)
   
   ### Initialization Logs
   ![Output Channel](media/screenshot-output.png)
   ```

**Acceptance Criteria**:
- `extension/README.md` includes all required sections listed above
- Prerequisites validation script works on Linux and macOS (Windows optional)
- Installation instructions are clear and testable by non-contributor
- Troubleshooting section covers at least 5 common issues
- Screenshots demonstrate key features (at least 3 images)
- Privacy and data storage section clearly explains local-only operation
- Architecture section provides high-level technical overview without excessive detail

**Implementation Note**:
- Internal prerequisite check should be added to `extension/src/extension.ts` in the `activate()` function, after workspace folder validation and before `CogneeClient` initialization
- Check should validate Python availability and Cognee installation by calling Python bridge scripts
- Show user-friendly error dialog with setup instructions if prerequisites are missing

---

### Milestone 3: Package Extension as VSIX

**Objective**: Build production VSIX file ready for distribution.

**Deliverables**:
- Compiled TypeScript extension bundle
- VSIX package file
- Package validation checklist

**Steps**:

1. **Install VSCE (Visual Studio Code Extension) packaging tool**:
   ```bash
   npm install -g @vscode/vsce
   ```

2. **Clean and rebuild extension**:
   ```bash
   cd extension/
   rm -rf dist/ node_modules/
   npm install
   npm run compile
   ```
   
   **Verify**: `dist/extension.js` exists and is minified (production build)

3. **Run final tests before packaging**:
   ```bash
   ./test-integration.sh
   ```
   
   **Verify**: All 6 integration tests pass

4. **Package extension**:
   ```bash
   vsce package
   ```
   
   **Expected Output**: `cognee-chat-memory-0.1.0.vsix` file created
   
   **Troubleshooting**:
   - If "publisher cannot be empty" error: Update `package.json` with real publisher ID
   - If icon errors: Verify `media/icon.png` exists and is 128x128 PNG
   - If size warnings: Review `.vscodeignore` to ensure source files excluded

5. **Validate VSIX contents**:
   ```bash
   # Extract VSIX (it's a ZIP file) for inspection
   unzip -l cognee-chat-memory-0.1.0.vsix
   ```
   
   **Required Files Checklist**:
   - ✅ `extension/dist/extension.js` (bundled TypeScript)
   - ✅ `extension/bridge/*.py` (all 3 Python scripts)
   - ✅ `extension/bridge/ontology.json`
   - ✅ `extension/bridge/requirements.txt`
   - ✅ `extension/media/icon.png`
   - ✅ `extension/package.json`
   - ✅ `extension/README.md`
   - ✅ `extension/LICENSE`
   - ✅ `extension/CHANGELOG.md`
   
   **Excluded Files Checklist** (should NOT be in VSIX):
   - ❌ `src/*.ts` files (TypeScript source)
   - ❌ `node_modules/` directory
   - ❌ `test-*.js`, `test-*.sh`, `test-*.txt`
   - ❌ `.eslintrc.json`, `tsconfig.json`, `esbuild.js`
   - ❌ `.vscode/` directory

6. **Test VSIX installation in clean VS Code**:
   ```bash
   # Install in current VS Code instance
   code --install-extension cognee-chat-memory-0.1.0.vsix
   
   # Or open new window for isolated test
   code --disable-extensions --install-extension cognee-chat-memory-0.1.0.vsix
   ```
   
   **Manual Verification**:
   - Extension appears in Extensions panel
   - Extension activates when workspace opened
   - Output Channel "Cognee Memory" shows logs
   - Settings appear under Extensions → Cognee Memory
   - No console errors in Developer Tools

**Acceptance Criteria**:
- VSIX file builds without errors
- VSIX size is reasonable (<5 MB excluding node_modules, ideally <1 MB)
- All required files present in VSIX (use unzip checklist)
- No source files or dev artifacts in VSIX
- Extension installs successfully from VSIX in clean VS Code
- Extension activates and initializes in test workspace
- No runtime errors after VSIX installation

---

### Milestone 4: Create Distribution Guide and Release Process

**Objective**: Document how to distribute the extension and prepare for initial release.

**Deliverables**:
- Distribution guide for maintainers
- GitHub Release preparation instructions
- Version bumping workflow
- Future Marketplace publishing outline

**Steps**:

1. **Create `extension/DISTRIBUTION.md`** for maintainers:

   **DOCUMENTATION CONTENT - EXAMPLE TEXT**:
   The markdown below shows example content for the distribution guide. The implementer should adapt this content to match the actual distribution workflow, improving clarity and adding any necessary details.

   ```markdown
   # Distribution Guide
   
   This document explains how to package and distribute the Cognee Chat Memory extension.
   
   ## Prerequisites
   
   - `@vscode/vsce` installed globally: `npm install -g @vscode/vsce`
   - Git repository clean (no uncommitted changes)
   - All tests passing: `./test-integration.sh`
   - CHANGELOG.md updated with new version
   
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
   - New feature
   ### Fixed
   - Bug fix
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
   
   # Run tests
   ./test-integration.sh
   
   # Package extension
   vsce package
   ```
   
   This creates `cognee-chat-memory-0.2.0.vsix`.
   
   ### 3. Test VSIX Locally
   
   ```bash
   # Test in clean VS Code instance
   code --disable-extensions
   # Then: Extensions → ... → Install from VSIX
   ```
   
   Verify:
   - Extension activates
   - All settings present
   - Integration tests pass
   - No console errors
   
   ### 4. Create GitHub Release
   
   1. Go to: https://github.com/lsalsich/cognee/releases
   2. Click "Draft a new release"
   3. Tag: `v0.2.0` (must match git tag)
   4. Title: "Cognee Chat Memory v0.2.0"
   5. Description: Copy from CHANGELOG.md for this version
   6. Attach `cognee-chat-memory-0.2.0.vsix` file
   7. Click "Publish release"
   
   ### 5. Announce Release
   
   - Update main README.md with latest version link
   - Post to project Discord/community channels
   - Update documentation site if applicable
   
   ## Distribution Channels
   
   ### Current: GitHub Releases (VSIX Downloads)
   
   - Manual installation from `.vsix` file
   - Users download from GitHub Releases page
   - Suitable for early adopters and testing
   
   ### Future: VS Code Marketplace
   
   Prerequisites:
   - Create publisher account: https://marketplace.visualstudio.com/manage
   - Set `publisher` field in package.json to verified publisher ID
   - Generate personal access token for publishing
   
   Publishing command:
   ```bash
   vsce publish
   ```
   
   See: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
   
   ## Versioning Guidelines
   
   Follow semantic versioning (semver):
   
   - **Patch (0.1.1)**: Bug fixes, small improvements, no breaking changes
   - **Minor (0.2.0)**: New features, no breaking changes
   - **Major (1.0.0)**: Breaking changes, major milestones
   
   ## Rollback Process
   
   If release has critical bugs:
   
   1. Mark GitHub Release as "pre-release"
   2. Add warning to release notes
   3. Publish patch version with fix
   4. Test thoroughly before removing warning
   
   ## Troubleshooting
   
   **"Publisher cannot be empty" error**:
   - Set `publisher` in package.json to your Marketplace publisher ID
   - Or use `vsce package --allow-missing-publisher` for local testing
   
   **VSIX too large (>50 MB)**:
   - Check `.vscodeignore` is excluding node_modules
   - Verify production build (minified code)
   - Remove unnecessary assets from media/
   
   **Extension won't activate after installation**:
   - Check package.json `activationEvents`
   - Verify `main` points to correct bundle path
   - Check Developer Tools console for errors
   ```

2. **Create `CONTRIBUTING.md`** at repository root for developers:

   **DOCUMENTATION CONTENT - EXAMPLE TEXT**:
   The markdown below provides example content for the contributor guide. The implementer should adapt this to match the actual development workflow and conventions used in the project.

   ```markdown
   # Contributing to Cognee Chat Memory
   
   Thank you for your interest in contributing!
   
   ## Development Setup
   
   ### Prerequisites
   
   - Node.js 18+ and npm
   - Python 3.8+ with Cognee 0.3.4 installed
   - VS Code 1.85+
   - Git
   
   ### Clone and Install
   
   ```bash
   git clone https://github.com/lsalsich/cognee.git
   cd cognee/extension
   npm install
   ```
   
   ### Build Extension
   
   ```bash
   # Development build (with source maps)
   npm run compile
   
   # Watch mode (rebuild on save)
   npm run watch
   ```
   
   ### Run Tests
   
   ```bash
   # Integration tests (requires Python + Cognee)
   ./test-integration.sh
   
   # TypeScript linting
   npm run lint
   ```
   
   ### Debug Extension
   
   1. Open `extension/` folder in VS Code
   2. Press F5 to launch Extension Development Host
   3. Set breakpoints in TypeScript files
   4. Extension reloads on code changes (if watch mode running)
   
   ## Project Structure
   
   ```
   extension/
   ├── src/                 # TypeScript source
   │   ├── extension.ts     # Main entry point
   │   ├── cogneeClient.ts  # Python bridge client
   │   └── chatParticipant.ts # Chat integration (future)
   ├── bridge/              # Python scripts
   │   ├── init.py          # Workspace initialization
   │   ├── ingest.py        # Conversation capture
   │   ├── retrieve.py      # Context retrieval
   │   └── ontology.json    # Chat entity schema
   ├── dist/                # Compiled output (gitignored)
   └── test-integration.sh  # Integration test suite
   ```
   
   ## Making Changes
   
   ### Branch Naming
   
   - Features: `feature/short-description`
   - Bugs: `fix/short-description`
   - Documentation: `docs/short-description`
   
   ### Commit Messages
   
   Follow conventional commits:
   - `feat: add new feature`
   - `fix: resolve bug`
   - `docs: update README`
   - `test: add test case`
   - `chore: update dependencies`
   
   ### Pull Request Process
   
   1. Create feature branch from `main`
   2. Make changes with descriptive commits
   3. Run tests: `npm run lint && ./test-integration.sh`
   4. Push branch and open PR
   5. Address review feedback
   6. Maintainer will merge when approved
   
   ## Testing Guidelines
   
   - All new features must include integration tests
   - Update `test-integration.sh` with new test cases
   - Verify Python bridge changes work with subprocess calls
   - Test in real VS Code workspace before submitting PR
   
   ## Documentation Updates
   
   When adding features:
   - Update `README.md` with usage examples
   - Add to `CHANGELOG.md` under "Unreleased" section
   - Update configuration section if adding settings
   - Include screenshots for UI changes
   
   ## Code Style
   
   - TypeScript: Follow ESLint rules (enforced by `npm run lint`)
   - Python: Follow PEP 8 style guide
   - Use meaningful variable names
   - Add comments for complex logic
   - Keep functions focused and testable
   
   ## Questions or Issues?
   
   - Open GitHub Issue: https://github.com/lsalsich/cognee/issues
   - Check existing issues first to avoid duplicates
   - Provide reproduction steps for bugs
   - Include logs from Output Channel ("Cognee Memory")
   ```

3. **Update root `README.md`** to link to extension:

   Update the existing extension section (under `### 🔌 Extension (VS Code Integration)`) to reflect release status:
   
   ```markdown
   ### 🔌 Extension (VS Code Integration)
   A VS Code extension that automatically captures GitHub Copilot chat conversations and retrieves relevant context from Cognee memory.
   
   **Location**: [`extension/`](extension/)  
   **Status**: v0.1.0 Released! [Download from GitHub Releases](https://github.com/lsalsich/cognee/releases)
   
   📖 **[Installation Guide](extension/README.md#installation)** - Step-by-step setup instructions  
   ⚙️ **[Configuration](extension/README.md#setup)** - First-time configuration  
   🔧 **[Troubleshooting](extension/README.md#troubleshooting)** - Common issues and solutions  
   🤝 **[Contributing](CONTRIBUTING.md)** - Developer setup and contribution guidelines
   
   **Quick Install**: Download the `.vsix` file from [Releases](https://github.com/lsalsich/cognee/releases), then in VS Code: `Ctrl+Shift+P` → "Install from VSIX"
   ```
   
   **Note**: This approach keeps the root README concise and avoids duplicating detailed instructions that live in `extension/README.md`, reducing documentation maintenance burden.

4. **Create release checklist** at `extension/RELEASE_CHECKLIST.md`:

   **DOCUMENTATION CONTENT - EXAMPLE TEXT**:
   The checklist below provides example release process steps. The implementer should adapt this to match the actual project workflow and tools.

   ```markdown
   # Release Checklist
   
   Use this checklist when preparing a new release.
   
   ## Pre-Release
   
   - [ ] All integration tests pass (`./test-integration.sh`)
   - [ ] No uncommitted changes (`git status` clean)
   - [ ] CHANGELOG.md updated with new version and changes
   - [ ] package.json version bumped (follow semver)
   - [ ] README.md screenshots updated if UI changed
   - [ ] All dependencies up to date and secure
   - [ ] No console errors or warnings in extension
   
   ## Build
   
   - [ ] Clean build completed (`rm -rf dist/ node_modules/ && npm install && npm run compile`)
   - [ ] Production bundle created (`dist/extension.js` exists and is minified)
   - [ ] VSIX packaged successfully (`vsce package`)
   - [ ] VSIX size is reasonable (<5 MB)
   
   ## Testing
   
   - [ ] VSIX installs in clean VS Code instance
   - [ ] Extension activates on workspace open
   - [ ] Output Channel shows successful initialization
   - [ ] Settings panel loads correctly
   - [ ] Integration tests pass after VSIX installation
   - [ ] No runtime errors in Developer Tools console
   
   ## Git
   
   - [ ] Version bump committed (`git commit -m "chore: bump version to X.Y.Z"`)
   - [ ] Git tag created (`git tag vX.Y.Z`)
   - [ ] Changes pushed to main (`git push origin main --tags`)
   
   ## GitHub Release
   
   - [ ] Release draft created at https://github.com/lsalsich/cognee/releases
   - [ ] Tag matches package.json version (vX.Y.Z)
   - [ ] Release title: "Cognee Chat Memory vX.Y.Z"
   - [ ] Description copied from CHANGELOG.md
   - [ ] VSIX file attached to release
   - [ ] Release published (not draft)
   
   ## Post-Release
   
   - [ ] Root README.md updated with latest version link
   - [ ] Installation tested by downloading from GitHub Release
   - [ ] Release announced (Discord, community channels, etc.)
   - [ ] GitHub Issues milestone closed (if applicable)
   
   ## Rollback (if needed)
   
   - [ ] Mark release as pre-release
   - [ ] Add warning to release notes
   - [ ] Create hotfix branch
   - [ ] Publish patch version with fix
   ```

**Acceptance Criteria**:
- `extension/DISTRIBUTION.md` documents complete release workflow
- `CONTRIBUTING.md` at root provides developer setup instructions
- Root `README.md` extension section updated with release status and links (minimal, no content duplication)
- `extension/RELEASE_CHECKLIST.md` provides step-by-step release process
- All distribution documents reference correct GitHub repository URLs
- Release workflow is testable by non-maintainer
- Future Marketplace publishing process outlined but marked as optional

---

### Milestone 5: Create Initial GitHub Release

**Objective**: Publish v0.1.0 release with VSIX download and installation instructions.

**Deliverables**:
- GitHub Release v0.1.0 published
- VSIX file available for download
- Release notes with installation instructions

**Steps**:

1. **Final validation before release**:
   - Run complete release checklist from `extension/RELEASE_CHECKLIST.md`
   - Verify all tests pass
   - Verify VSIX installs cleanly
   - Verify no sensitive data in repository (API keys, secrets)

2. **Create git tag**:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. **Create GitHub Release**:
   - Navigate to: https://github.com/lsalsich/cognee/releases
   - Click "Draft a new release"
   - Select tag: `v0.1.0`
   - Release title: "Cognee Chat Memory v0.1.0 - Initial Release"
   
   **DOCUMENTATION CONTENT - EXAMPLE RELEASE NOTES**:
   The markdown below provides example release notes. The implementer should adapt wording and details to match the actual release.
   
   ```markdown
   # Cognee Chat Memory v0.1.0
   
   **Initial release** of the Cognee Chat Memory VS Code extension! 🎉
   
   This extension provides automatic memory for GitHub Copilot chat using Cognee knowledge graphs. Conversations are captured and retrieved automatically without any manual commands.
   
   ## Features
   
   - ✅ Automatic capture of GitHub Copilot chat conversations
   - ✅ Automatic context retrieval before responses
   - ✅ Workspace-isolated memory (no cross-project leakage)
   - ✅ Hybrid graph-vector search combining relationships and semantics
   - ✅ Recency and importance weighting for context relevance
   - ✅ Chat-specific ontology (User, Question, Answer, Topic, Concept, etc.)
   - ✅ Configurable settings for tuning behavior
   
   ## Installation
   
   ### Prerequisites
   
   - VS Code 1.85.0 or higher
   - Python 3.8+ installed and in PATH
   - Cognee 0.3.4: `pip install cognee==0.3.4`
   - OpenAI API key (or compatible LLM provider)
   
   ### Quick Start
   
   1. Download `cognee-chat-memory-0.1.0.vsix` (attached below)
   2. Open VS Code
   3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   4. Type "Install from VSIX" and select the command
   5. Navigate to the downloaded `.vsix` file and select it
   6. Reload VS Code when prompted
   7. Open a workspace folder
   8. Create `.env` file with: `OPENAI_API_KEY=your_key_here`
   9. Check Output panel → "Cognee Memory" for activation status
   
   **[Full Installation Guide](extension/README.md)** | **[Troubleshooting](extension/README.md#troubleshooting)**
   
   ## What's New
   
   This is the first public release. See [CHANGELOG](extension/CHANGELOG.md) for complete feature list.
   
   ## Known Limitations
   
   - Requires workspace folder (doesn't work in single-file mode)
   - Only captures GitHub Copilot chat (not inline completions)
   - Python/Cognee must be installed separately (not bundled)
   - First conversation has no context (memory starts empty)
   
   ## Feedback
   
   - 🐛 Report bugs: [GitHub Issues](https://github.com/lsalsich/cognee/issues)
   - 💡 Request features: [GitHub Discussions](https://github.com/lsalsich/cognee/discussions)
   - 📖 Read docs: [Extension README](extension/README.md)
   
   ## Technical Details
   
   - Uses Cognee 0.3.4 dataset-based logical isolation
   - SHA1-hashed workspace identifiers for stable naming
   - Global marker file prevents concurrent initialization conflicts
   - Stateless ontology configuration per ingestion
   - Comprehensive integration test suite (6 test cases)
   
   ---
   
   **Full Changelog**: [CHANGELOG.md](extension/CHANGELOG.md)
   ```

4. **Attach VSIX file to release**:
   - Drag `cognee-chat-memory-0.1.0.vsix` to release attachments
   - Ensure filename is visible and downloadable

5. **Publish release**:
   - Click "Publish release" (not "Save draft")
   - Verify release appears at https://github.com/lsalsich/cognee/releases
   - Test download link works

6. **Post-release validation**:
   - Download VSIX from GitHub Release page (not local copy)
   - Install in fresh VS Code instance
   - Verify extension works end-to-end
   - Check that release notes render correctly on GitHub

**Acceptance Criteria**:
- Git tag v0.1.0 created and pushed
- GitHub Release published at https://github.com/lsalsich/cognee/releases/tag/v0.1.0
- VSIX file attached and downloadable
- Release notes include installation instructions
- Release notes link to full documentation
- Known limitations documented
- Release is public (not draft, not pre-release)
- VSIX from GitHub Release installs and works correctly

---

## Validation

### Pre-Implementation Checklist

- [ ] Plan 003 complete and all tests passing
- [ ] TypeScript extension compiles without errors (`npm run compile`)
- [ ] All 6 integration tests pass (`./test-integration.sh`)
- [ ] Python bridge scripts tested independently
- [ ] No uncommitted changes in repository
- [ ] OpenAI API key available for testing

### Implementation Validation

**Milestone 1 (Extension Metadata)**:
- [ ] Extension icon created (128x128 PNG) at `extension/media/icon.png`
- [ ] `package.json` has complete metadata (no placeholder values)
- [ ] LICENSE file exists with MIT license
- [ ] CHANGELOG.md documents v0.1.0 features
- [ ] `.vscodeignore` excludes source files and dev artifacts

**Milestone 2 (User Documentation)**:
- [ ] README.md includes all required sections
- [ ] Prerequisites validation script works on Linux/macOS
- [ ] Installation instructions tested by non-contributor
- [ ] Troubleshooting covers at least 5 common issues
- [ ] At least 3 screenshots demonstrate features
- [ ] Privacy section explains local-only operation

**Milestone 3 (VSIX Packaging)**:
- [ ] VSIX builds without errors (`vsce package`)
- [ ] VSIX size <5 MB (ideally <1 MB)
- [ ] All required files in VSIX (dist/, bridge/, media/, docs)
- [ ] No source files in VSIX (*.ts excluded)
- [ ] VSIX installs in clean VS Code
- [ ] Extension activates after VSIX installation

**Milestone 4 (Distribution Guide)**:
- [ ] `extension/DISTRIBUTION.md` documents release workflow
- [ ] `CONTRIBUTING.md` provides developer setup
- [ ] Root README links to extension
- [ ] Release checklist is complete and testable

**Milestone 5 (GitHub Release)**:
- [ ] Git tag v0.1.0 created and pushed
- [ ] GitHub Release published with VSIX attachment
- [ ] Release notes include installation instructions
- [ ] VSIX downloads and installs from GitHub

### Manual Testing

1. **Fresh Installation Test**:
   - Use clean VS Code installation (or `--disable-extensions`)
   - Download VSIX from GitHub Release
   - Install from VSIX
   - Open workspace
   - Verify initialization in Output Channel
   - Send chat message (if Chat Participant implemented)

2. **Prerequisites Validation Test**:
   - Run `extension/scripts/check-prerequisites.sh`
   - Verify all checks pass (VS Code, Python, Cognee)
   - Test with missing prerequisites to verify error messages

3. **Documentation Test**:
   - Follow README installation instructions step-by-step
   - Verify each step works as documented
   - Test troubleshooting steps for common issues
   - Verify all links resolve correctly

4. **VSIX Content Test**:
   - Extract VSIX: `unzip -l cognee-chat-memory-0.1.0.vsix`
   - Verify required files present
   - Verify source files excluded
   - Check file sizes are reasonable

---

## Risks

### High Severity

1. **Publisher ID Not Set**: VSCE requires valid publisher ID for Marketplace
   - **Mitigation**: Use `--allow-missing-publisher` flag for local VSIX builds; document publisher setup for Marketplace in future plan

2. **Large VSIX Size**: Including node_modules could make VSIX >50 MB
   - **Mitigation**: Ensure `.vscodeignore` excludes node_modules; use production build (minified); verify VSIX size <5 MB

3. **Missing Prerequisites Not Detected**: Users install extension without Python/Cognee
   - **Mitigation**: Add activation check that validates Python/Cognee and shows helpful error message; include prerequisites validation script

4. **Broken Installation Instructions**: Users unable to follow README
   - **Mitigation**: Test instructions with non-contributor; include screenshots; provide troubleshooting section

5. **VSIX Doesn't Install**: Package corruption or missing files
   - **Mitigation**: Test VSIX installation before release; validate contents with unzip; use release checklist

### Medium Severity

1. **Screenshots Out of Date**: UI changes make screenshots inaccurate
   - **Mitigation**: Update screenshots before each release; automate screenshot generation if possible

2. **Documentation Drift**: README doesn't match current behavior
   - **Mitigation**: Review documentation during release checklist; include docs update in PR requirements

3. **Icon Quality Issues**: Icon doesn't scale well or looks unprofessional
   - **Mitigation**: Use professional design tool; test at multiple sizes; get feedback before release

4. **Cross-Platform Issues**: Installation works on Linux but fails on Windows
   - **Mitigation**: Test on multiple platforms; document platform-specific requirements; use platform-agnostic paths

---

## Success Criteria

**Plan 004 Complete When**:
- ✅ VSIX file builds successfully
- ✅ VSIX size <5 MB (ideally <1 MB)
- ✅ Extension installs from VSIX in clean VS Code
- ✅ GitHub Release v0.1.0 published with VSIX download
- ✅ README includes complete installation instructions
- ✅ Distribution guide documents release workflow
- ✅ Prerequisites validation script works
- ✅ At least 3 screenshots demonstrate features
- ✅ All required files in VSIX, no source files
- ✅ Release tested end-to-end (download → install → activate)

**Ready for Users When**:
- ✅ All above criteria met
- ✅ Installation instructions tested by non-contributor
- ✅ Troubleshooting section covers common issues
- ✅ No critical bugs in initial testing
- ✅ Extension activates and shows helpful errors if misconfigured

---

## Timeline Estimate

- **Milestone 1** (Metadata): 45-60 minutes
- **Milestone 2** (Documentation): 90-120 minutes
- **Milestone 3** (Packaging): 30-45 minutes
- **Milestone 4** (Distribution Guide): 45-60 minutes
- **Milestone 5** (GitHub Release): 15-30 minutes

**Total Estimate**: 3.5-5 hours

---

## Next Steps

1. **Immediate**: Begin Milestone 1 (prepare metadata and assets)
2. **After Milestone 3**: Test VSIX installation locally before proceeding to release
3. **After Milestone 5**: Monitor GitHub Issues for user feedback and bug reports
4. **Future Plans**: Plan 005 (VS Code Marketplace Publishing), Plan 006 (Chat Participant Implementation per Plan 002 Milestone 5)

This plan prepares the extension for initial distribution via GitHub Releases. Marketplace publishing is deferred to a future plan after gathering user feedback on v0.1.0.
