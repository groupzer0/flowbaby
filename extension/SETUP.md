# Flowbaby Extension - Development Setup

## Prerequisites

1. **Python 3.10–3.12** with pip
2. **Node.js 18+** with npm
3. **VS Code** 1.105 or later
4. **Microsoft Visual C++ Redistributable** (Windows only) - [Download here](https://aka.ms/vs/17/release/vc_redist.x64.exe)
5. **LLM API Key** (OpenAI, Anthropic, or other supported provider)

---

## Quick Start (Automatic Setup)

**Flowbaby v0.3.17+ manages its own Python environment automatically.** You no longer need to manually create virtual environments or install packages.

### 1. Initialize Workspace

1. Open your project folder in VS Code
2. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Run **"Flowbaby: Initialize Workspace"**
4. The extension will automatically:
   - Create an isolated `.flowbaby/venv` environment
   - Install `cognee` and `python-dotenv`
   - Verify the environment is ready

### 2. Configure API Key

**Option A: Global API Key (Recommended)**
1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **"Flowbaby: Set API Key"**
3. Enter your API key when prompted

This stores the key securely via VS Code's SecretStorage and applies to all workspaces.

**Option B: Workspace-Specific `.env` File**

Create a `.env` file in your workspace root:
```env
LLM_API_KEY=sk-your-key-here
```

**Priority Order**: Workspace `.env` > Global SecretStorage > System environment

### 3. Verify Setup

- Check status bar for **"Flowbaby: Ready"** (green checkmark)
- If you see **"Flowbaby: Setup Required"**, click it to run initialization

---

## Manual Setup (Advanced)

If you prefer to manage your own Python environment:

### 4. Install Extension Dependencies

```bash
cd extension
npm install
```

### 5. Compile Extension

```bash
npm run compile
```

Or for watch mode during development:
```bash
npm run watch
```

---

### Debug Configuration

The extension includes VS Code debug configuration for F5 launching.

**File**: `.vscode/launch.json`

**Configurations**:
- **Run Extension**: Launches Extension Development Host for manual testing
  - Press **F5** to start
  - Extension automatically compiles before launch
  - Debug Console shows activation logs
  
- **Extension Tests**: Runs automated test suite in Extension Host
  - Use for integration/e2e testing
  - Tests located in `out/test/` after compilation

**First-time Setup**:

The `.vscode/launch.json` file is included in the repository. If it's missing, the extension won't activate when you press F5.

**Important - Workspace Context**:

You must open the `extension/` folder in VS Code, not the repository root. The `${workspaceFolder}` variable in `launch.json` must resolve to the extension directory for proper activation.

**Troubleshooting**:
- **No console output**: Verify `launch.json` exists and contains correct configuration
- **Extension doesn't load**: Check Debug Console for activation errors (View → Debug Console)
- **Commands missing**: Ensure `npm run compile` completed successfully
- **Wrong folder opened**: Close VS Code and reopen the `extension/` folder specifically

---

## Testing the Extension

### Launch Extension Development Host

1. Open the `extension/` folder in VS Code
2. Press **F5** to launch Extension Development Host
3. **In the Extension Development Host window**:
   - File → Open Folder
   - Select a workspace that has:
     - ✅ `.venv/` directory with cognee installed
     - ✅ `.env` file with LLM_API_KEY

### Verify Workspace Setup

After opening a workspace in Extension Development Host:

1. Open **Output** panel (View → Output)
2. Select **"Cognee Memory"** from dropdown
3. Look for these messages:
   - ✅ `Cognee initialized for workspace: /path/to/workspace`
   - ✅ `Using Python interpreter: /path/to/workspace/.venv/bin/python`

If you see errors instead, check the "Common Issues" section below.

### Test Capture Command

**Keyboard Shortcut**: **Ctrl+Alt+C** (Windows/Linux) or **Cmd+Alt+C** (Mac)

**Or via Command Palette**:
1. Press Ctrl+Shift+P (Cmd+Shift+P on Mac)
2. Type "Cognee: Capture to Cognee Memory"
3. Press Enter

**Capture Workflow**:
1. Trigger the command (keyboard or palette)
2. Input box appears: "Enter text to capture..."
3. Either:
   - Type content to capture, OR
   - Leave empty and press Enter to use clipboard content
4. Success message appears if captured successfully

### Check Logs

- Open **Output** panel (View → Output)
- Select "Cognee Memory" from the dropdown
- View initialization status and capture logs

---

## Common Issues

### "LLM_API_KEY not found"

**Cause**: Missing or incorrectly placed `.env` file

**Solution**: 
1. Create `.env` file in your **workspace root** (not extension directory)
2. Add: `LLM_API_KEY=sk-your-key-here`
3. Reload the Extension Development Host window (Ctrl+R or Cmd+R)

**Note**: As of v0.2.1, `OPENAI_API_KEY` is no longer supported. Use `LLM_API_KEY` to align with Cognee 0.4.0.

### "Failed to import required module: No module named 'cognee'"

**Cause**: Workspace doesn't have proper Python virtual environment setup

**Solution**:
```bash
# In workspace root
python3 -m venv .venv
source .venv/bin/activate
pip install cognee python-dotenv
```

Then reload the Extension Development Host window.

### "Python interpreter not found" or "spawn python3 ENOENT"

**Cause**: No `.venv` in workspace, and system `python3` not available

**Solution**:
1. Set up workspace `.venv` as described in Setup Instructions
2. OR configure explicit Python path in settings:
   ```json
   {
     "Flowbaby.pythonPath": "/path/to/python"
   }
   ```

### Extension works in one workspace but not another

**Cause**: Each workspace needs its own setup

**Solution**: Repeat steps 1-3 of Setup Instructions for each workspace where you want to use the extension.

### Keyboard Shortcut Doesn't Work

**Issue**: Ctrl+Alt+C may conflict with other extensions

**Solution**:
1. Open Command Palette (Ctrl+Shift+P)
2. Search for "Preferences: Open Keyboard Shortcuts"
3. Search for "cognee.captureMessage"
4. Change keybinding if needed

## Development Workflow

### Running Tests

```bash
npm test
```

### Linting

```bash
npm run lint
```

### Package Extension

```bash
npx vsce package
```

This creates a `.vsix` file you can install or distribute.

---

## Python Environment Detection

The extension automatically detects your Python interpreter in this order:

1. **Explicit configuration**: `Flowbaby.pythonPath` setting
2. **Flowbaby environment**: `.flowbaby/venv/bin/python` (isolated from project venvs)
3. **Legacy workspace venv**: `.venv/bin/python` (Linux/Mac) or `.venv\Scripts\python.exe` (Windows)
4. **System Python**: `python3` command (will fail if cognee not installed globally)

**Recommended**: Use the automatic **"Flowbaby: Initialize Workspace"** command, which creates an isolated environment at `.flowbaby/venv` to avoid conflicts with project virtual environments or language servers.

---

## Data Storage Architecture

**Per-Workspace Isolation**:
- Each workspace gets a unique dataset name (hashed from workspace path)
- Flowbaby environment: `.flowbaby/venv/` (isolated Python environment)
- Your conversations are isolated per workspace

**Global Data Storage** (per Python install):
- Cognee data stored in: `.venv/lib/python3.12/site-packages/cognee/.flowbaby/system/databases/`
- Multiple workspaces using the same `.venv` share storage but have isolated datasets
- Typical size: ~50-100MB per workspace after normal usage

---

## Architecture Overview

```
extension/
├── src/
│   ├── extension.ts          # Main extension entry point
│   └── cogneeClient.ts        # Python bridge client
├── bridge/
│   ├── init.py               # Workspace initialization
│   ├── ingest.py             # Content ingestion
│   ├── retrieve.py           # Memory retrieval
│   └── workspace_utils.py    # Dataset isolation
└── package.json              # Extension manifest

Per Workspace:
workspace/
├── .venv/                    # Python virtual environment (required)
│   └── lib/.../cognee/       # Cognee package installation
│       └── .flowbaby/system/   # Global data storage
├── .env                      # OpenAI API key (required)
└── .flowbaby/                  # Workspace marker (created automatically)
```

## Validation Status

See `implementation/008-chat-participant-memory-integration-validation.md` for current validation progress.

**Current Status**:
- ✅ Keyboard shortcut capture implemented
- ⏳ Context menu (not available in VS Code API - using keyboard shortcut)
- ⏳ Ingestion format testing
- ⏳ Retrieval testing
- ⏳ @flowbaby participant (planned)

---

## Troubleshooting

### Extension Not Activating

Check Output > Cognee Memory for errors. Common causes:
- ❌ Missing workspace `.venv` with cognee installed
- ❌ Missing `.env` file with OpenAI API key
- ❌ Python not in PATH (system fallback)

**Solution**: Follow steps 1-3 of Setup Instructions for your workspace.

### Schema Migration Errors (v0.6.2+)

If you upgraded from an earlier version and see schema errors, Flowbaby will attempt automatic migration. If automatic migration fails:

**Error Codes:**
- `SCHEMA_MISMATCH_DETECTED`: Missing required columns - migration may help
- `SCHEMA_MIGRATION_FAILED`: Migration attempted but failed
- `SCHEMA_UNSUPPORTED_STATE`: Database structure is unexpected

**Manual Repair:**
```bash
# Check what needs migration (dry run)
python extension/bridge/migrate_cognee_0_5_schema.py /path/to/workspace --dry-run

# Apply migration
python extension/bridge/migrate_cognee_0_5_schema.py /path/to/workspace

# Check migration receipt
cat /path/to/workspace/.flowbaby/system/schema_migration_receipt.json
```

**If Migration Fails:**
1. Check `.flowbaby/system/schema_migration_receipt.json` for details
2. Back up your `.flowbaby/system/databases/` directory
3. Consider removing the database to start fresh: `rm -rf .flowbaby/system/databases/cognee_db`
4. Re-run "Flowbaby: Initialize Workspace"

### Capture Command Not Found

1. Check the extension activated successfully (Output > Cognee Memory)
2. Look for initialization errors
3. Verify workspace setup is complete
4. Reload Extension Development Host window (Ctrl+R or Cmd+R)

### Ingestion Fails

Check that:
1. ✅ Workspace has `.venv` with cognee: `.venv/bin/pip list | grep cognee`
2. ✅ OpenAI API key is valid in `.env` file
3. ✅ Internet connection is working (for OpenAI API calls)
4. ✅ Output Channel shows Python interpreter detected

### Different Workspaces Behave Differently

**This is expected!** Each workspace needs its own setup. If extension works in workspace A but not workspace B:

1. Ensure workspace B has `.venv/` with cognee installed
2. Ensure workspace B has `.env` with LLM_API_KEY
3. Check Output Channel in workspace B for specific errors

### Accidentally Committed .venv to Git

If you forgot to add `.venv/` to `.gitignore` and committed it:

```bash
# Remove from git (keeps local files)
git rm -r --cached .venv/
git rm --cached .env
git rm -r --cached .flowbaby/

# Add to .gitignore
echo ".venv/" >> .gitignore
echo ".env" >> .gitignore
echo ".flowbaby/" >> .gitignore

# Commit the removal
git add .gitignore
git commit -m "Remove Python venv and sensitive files from git"
```

**Note**: If `.env` with your API key was committed, **regenerate your OpenAI API key** immediately for security.

---

## Quick Reference: New Workspace Setup

Every time you want to use the extension in a new workspace:

```bash
# 1. Navigate to workspace
cd /path/to/new/workspace

# 2. Create and activate venv
python3 -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows

# 3. Install dependencies
pip install cognee python-dotenv

# 4. Add API key
echo "LLM_API_KEY=sk-your-key-here" > .env

# 5. Update .gitignore (IMPORTANT - avoids committing 10k+ files!)
echo ".venv/" >> .gitignore
echo ".env" >> .gitignore
echo ".flowbaby/" >> .gitignore

# 6. Open in VS Code and test
code .
# Press F5 if in extension dev, or use normally if extension installed
```

**⚠️ Git Ignore Configuration**:

The virtual environment (`.venv/`) contains **over 10,000 files** from Python packages. You must add these entries to your workspace `.gitignore` to avoid committing them:

```gitignore
# Cognee Extension - Python Environment
.venv/

# Cognee Extension - Sensitive Data
.env

# Cognee Extension - Workspace Memory
.flowbaby/
```

**Why ignore each**:
- `.venv/`: 10k+ files, ~50-100MB, should be recreated per environment
- `.env`: Contains your OpenAI API key (security risk if committed)
- `.flowbaby/`: Workspace-specific memory metadata (not needed in git)

**Time required**: 2-3 minutes per workspace

---

## Next Steps

- See `planning/008-chat-participant-memory-integration.md` for the full implementation plan
- See `implementation/008-chat-participant-memory-integration-validation.md` for validation status
- See `analysis/008-chat-participant-memory-integration-api-feasibility.md` for technical details
