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

### 2. Login to Flowbaby Cloud

Flowbaby v0.7.0+ uses **Flowbaby Cloud** for LLM operations. No API key configuration needed.

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **"Flowbaby Cloud: Login"**
3. Complete authentication in your browser

Your Cloud session applies to all workspaces automatically.

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
   - Select any workspace
   - Run **"Flowbaby Cloud: Login"** if not already authenticated

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

### Windows: Refresh fails with EPERM rename of `.flowbaby\\venv`

**Symptom**

You run **"Flowbaby: Refresh Bridge Dependencies"** and see something like:

```
[Setup] Refresh failed: EPERM: operation not permitted, rename
   '...\\.flowbaby\\venv' -> '...\\.flowbaby\\venv.backup'
```

**Why this happens (Windows-specific)**

On Windows, directories can’t be renamed while another process has an open handle inside them. In Flowbaby, the most common cause is the **Python bridge daemon** (`daemon.py`) still running and using the interpreter at `.flowbaby\\venv\\Scripts\\python.exe`.

This is often invisible on Linux/macOS because rename semantics and open-file behavior differ.

**Fix / Workarounds**

1. **Reload VS Code window** (Command Palette → **Developer: Reload Window**), then re-run refresh.
2. **Close all VS Code windows that have this workspace open**, wait ~2 seconds, then re-open and run refresh.
3. If you want to verify the lock, check for a running process using the venv:

    ```powershell
    Get-CimInstance Win32_Process |
       Where-Object { $_.Name -in @('python.exe','pythonw.exe') -and $_.CommandLine -match '\\.flowbaby\\venv' } |
       Select-Object Name,ProcessId,CommandLine
    ```

    If you see one, stop it (last resort):

    ```powershell
    Stop-Process -Id <PID> -Force
    ```

4. If a previous refresh created `.flowbaby\\venv.backup`, delete it (only if you’re sure you don’t need it):

    ```powershell
    Remove-Item -Recurse -Force .\.flowbaby\\venv.backup
    ```

**Engineering note (for Windows compatibility reviews)**

The extension refresh flow should stop the bridge daemon (if running) before backing up/renaming the venv, and it should retry renames briefly to tolerate transient file locks (AV scanning, delayed handle release).

### "Cloud login required" / "NOT_AUTHENTICATED"

**Cause**: Not logged in to Flowbaby Cloud

**Solution**:
1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **"Flowbaby Cloud: Login"**
3. Complete authentication in your browser

**Note**: As of v0.7.0, Flowbaby uses Cloud authentication. Legacy `LLM_API_KEY` configuration is no longer supported.

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
1. ✅ Workspace has been initialized (run **"Flowbaby: Initialize Workspace"**)
2. ✅ You are logged in to Flowbaby Cloud (run **"Flowbaby Cloud: Login"**)
3. ✅ Internet connection is working (for Cloud API calls)
4. ✅ Output Channel shows Python interpreter detected

### Different Workspaces Behave Differently

**This is expected!** Each workspace needs its own initialization. If extension works in workspace A but not workspace B:

1. Run **"Flowbaby: Initialize Workspace"** in workspace B
2. Ensure you are logged in to Flowbaby Cloud (login is shared across workspaces)
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

1. **Open workspace in VS Code**
2. **Initialize workspace**: Run **"Flowbaby: Initialize Workspace"** from Command Palette
3. **Login to Cloud** (first time only): Run **"Flowbaby Cloud: Login"**
4. **Update .gitignore** (recommended):

```gitignore
# Flowbaby workspace data
.flowbaby/
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
- `.env`: May contain sensitive configuration (if present)
- `.flowbaby/`: Workspace-specific memory metadata (not needed in git)

**Time required**: 2-3 minutes per workspace

---

## Next Steps

- See `planning/008-chat-participant-memory-integration.md` for the full implementation plan
- See `implementation/008-chat-participant-memory-integration-validation.md` for validation status
- See `analysis/008-chat-participant-memory-integration-api-feasibility.md` for technical details
