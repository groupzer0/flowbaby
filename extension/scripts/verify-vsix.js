#!/usr/bin/env node

/**
 * VSIX Packaging Verification Script
 * 
 * Validates that the packaged .vsix file contains all required assets
 * before release. This prevents packaging regressions like the v0.2.1
 * ontology.json -> ontology.ttl mismatch.
 * 
 * Usage: node scripts/verify-vsix.js path/to/extension.vsix
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

// Required files that must be present in the VSIX
const REQUIRED_FILES = [
    // Bridge Python scripts
    'extension/bridge/init.py',
    'extension/bridge/ingest.py',
    'extension/bridge/retrieve.py',
    'extension/bridge/workspace_utils.py',
    'extension/bridge/ontology_provider.py',
    
    // Bridge assets
    'extension/bridge/ontology.ttl',
    'extension/bridge/requirements.txt',
    
    // Extension metadata
    'extension/package.json',
    
    // Compiled extension code
    'extension/out/extension.js'
];

// Files that should NOT be present (source files, tests, etc.)
const EXCLUDED_FILES = [
    'extension/src/',
    'extension/test/',
    'extension/.vscode/',
    'extension/node_modules/',
    'extension/tsconfig.json',
    'extension/esbuild.js'
];

/**
 * Extract VSIX to temporary directory
 * VSIX files are ZIP archives, so we use unzip
 */
function extractVSIX(vsixPath) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-verify-'));
    
    try {
        // VSIX is a ZIP archive, extract it
        execSync(`unzip -q "${vsixPath}" -d "${tmpDir}"`, { stdio: 'pipe' });
        return tmpDir;
    } catch (error) {
        throw new Error(`Failed to extract VSIX: ${error.message}`);
    }
}

/**
 * Check if required files exist and pass basic integrity checks
 */
function verifyRequiredFiles(extractedDir) {
    const results = {
        missing: [],
        empty: [],
        invalid: []
    };
    
    for (const requiredFile of REQUIRED_FILES) {
        const fullPath = path.join(extractedDir, requiredFile);
        
        // Check existence
        if (!fs.existsSync(fullPath)) {
            results.missing.push(requiredFile);
            continue;
        }
        
        // Check non-empty
        const stats = fs.statSync(fullPath);
        if (stats.size === 0) {
            results.empty.push(requiredFile);
            continue;
        }
        
        // Check readable (valid UTF-8 for text files)
        if (requiredFile.endsWith('.py') || requiredFile.endsWith('.ttl') || requiredFile.endsWith('.json')) {
            try {
                const content = fs.readFileSync(fullPath, 'utf8');
                // Basic sanity check: non-empty after trim
                if (content.trim().length === 0) {
                    results.empty.push(requiredFile);
                }
            } catch (error) {
                results.invalid.push(`${requiredFile}: ${error.message}`);
            }
        }
    }
    
    return results;
}

/**
 * Check that excluded files are NOT present
 */
function verifyExcludedFiles(extractedDir) {
    const found = [];
    
    for (const excludedPattern of EXCLUDED_FILES) {
        const fullPath = path.join(extractedDir, excludedPattern);
        
        if (fs.existsSync(fullPath)) {
            found.push(excludedPattern);
        }
    }
    
    return found;
}

/**
 * Verify package.json version matches expectations
 */
function verifyPackageMetadata(extractedDir) {
    const packageJsonPath = path.join(extractedDir, 'extension/package.json');
    
    if (!fs.existsSync(packageJsonPath)) {
        return { valid: false, error: 'package.json not found' };
    }
    
    try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        
        // Verify required fields
        if (!packageJson.name || !packageJson.version || !packageJson.engines) {
            return {
                valid: false,
                error: 'package.json missing required fields (name, version, or engines)'
            };
        }
        
        return {
            valid: true,
            name: packageJson.name,
            version: packageJson.version,
            engines: packageJson.engines
        };
    } catch (error) {
        return { valid: false, error: `Failed to parse package.json: ${error.message}` };
    }
}

/**
 * Clean up temporary directory
 */
function cleanup(tmpDir) {
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (error) {
        console.warn(`Warning: Failed to clean up temp directory ${tmpDir}: ${error.message}`);
    }
}

/**
 * Main verification function
 */
function verifyVSIX(vsixPath) {
    console.log(`Verifying VSIX: ${vsixPath}\n`);
    
    // Check VSIX file exists
    if (!fs.existsSync(vsixPath)) {
        console.error(`❌ VSIX file not found: ${vsixPath}`);
        return false;
    }
    
    let tmpDir;
    let success = true;
    
    try {
        // Extract VSIX
        console.log('📦 Extracting VSIX...');
        tmpDir = extractVSIX(vsixPath);
        console.log(`   Extracted to: ${tmpDir}\n`);
        
        // Verify package metadata
        console.log('🔍 Verifying package metadata...');
        const metadataResult = verifyPackageMetadata(tmpDir);
        if (!metadataResult.valid) {
            console.error(`   ❌ ${metadataResult.error}`);
            success = false;
        } else {
            console.log(`   ✅ ${metadataResult.name} v${metadataResult.version}`);
            console.log(`   ✅ VS Code engine: ${JSON.stringify(metadataResult.engines)}\n`);
        }
        
        // Verify required files
        console.log('🔍 Verifying required files...');
        const fileResults = verifyRequiredFiles(tmpDir);
        
        if (fileResults.missing.length > 0) {
            console.error('   ❌ Missing required files:');
            fileResults.missing.forEach(file => console.error(`      - ${file}`));
            success = false;
        }
        
        if (fileResults.empty.length > 0) {
            console.error('   ❌ Empty files (should contain content):');
            fileResults.empty.forEach(file => console.error(`      - ${file}`));
            success = false;
        }
        
        if (fileResults.invalid.length > 0) {
            console.error('   ❌ Invalid/unreadable files:');
            fileResults.invalid.forEach(msg => console.error(`      - ${msg}`));
            success = false;
        }
        
        if (fileResults.missing.length === 0 && fileResults.empty.length === 0 && fileResults.invalid.length === 0) {
            console.log(`   ✅ All ${REQUIRED_FILES.length} required files present and valid\n`);
        } else {
            console.log('');
        }
        
        // Verify excluded files
        console.log('🔍 Verifying excluded files...');
        const excludedFound = verifyExcludedFiles(tmpDir);
        
        if (excludedFound.length > 0) {
            console.warn('   ⚠️  Found files that should be excluded:');
            excludedFound.forEach(file => console.warn(`      - ${file}`));
            console.warn('   (These may increase VSIX size unnecessarily)\n');
            // Don't fail build for this, just warn
        } else {
            console.log('   ✅ No excluded files found\n');
        }
        
    } catch (error) {
        console.error(`❌ Verification failed: ${error.message}`);
        success = false;
    } finally {
        // Clean up
        if (tmpDir) {
            cleanup(tmpDir);
        }
    }
    
    // Summary
    console.log('━'.repeat(60));
    if (success) {
        console.log('✅ VSIX verification PASSED');
        console.log('   Package is ready for release');
    } else {
        console.log('❌ VSIX verification FAILED');
        console.log('   Fix the issues above before releasing');
    }
    console.log('━'.repeat(60));
    
    return success;
}

// CLI entry point
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.error('Usage: node verify-vsix.js <path-to-vsix>');
        console.error('Example: node verify-vsix.js cognee-chat-memory-0.2.1.vsix');
        process.exit(1);
    }
    
    const vsixPath = args[0];
    const success = verifyVSIX(vsixPath);
    
    process.exit(success ? 0 : 1);
}

module.exports = { verifyVSIX };
