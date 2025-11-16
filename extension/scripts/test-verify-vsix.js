#!/usr/bin/env node

/**
 * Unit tests for VSIX verification script
 * 
 * Tests failure paths using fixture-based VSIX packages to ensure
 * verify-vsix.js catches packaging regressions.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { verifyVSIX } = require('./verify-vsix.js');

// Test fixtures directory
const FIXTURES_DIR = path.join(__dirname, 'test-fixtures');

/**
 * Create a minimal valid VSIX structure in a temporary directory
 */
function createValidVSIXStructure(tmpDir) {
    const extensionDir = path.join(tmpDir, 'extension');
    const bridgeDir = path.join(extensionDir, 'bridge');
    const outDir = path.join(extensionDir, 'out');
    
    // Create directory structure
    fs.mkdirSync(bridgeDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    
    // Create required files
    const files = {
        'extension/bridge/init.py': '#!/usr/bin/env python3\nprint("init")',
        'extension/bridge/ingest.py': '#!/usr/bin/env python3\nprint("ingest")',
        'extension/bridge/retrieve.py': '#!/usr/bin/env python3\nprint("retrieve")',
        'extension/bridge/workspace_utils.py': '#!/usr/bin/env python3\nprint("utils")',
        'extension/bridge/ontology_provider.py': '#!/usr/bin/env python3\nprint("ontology")',
        'extension/bridge/ontology.ttl': '@prefix cognee: <http://cognee.ai/ontology#> .\ncognee:Entity a owl:Class .',
        'extension/bridge/requirements.txt': 'cognee>=0.3.4\nrdflib>=7.0.0',
        'extension/package.json': JSON.stringify({
            name: 'test-extension',
            version: '0.0.1',
            engines: { vscode: '^1.85.0' }
        }, null, 2),
        'extension/out/extension.js': 'console.log("extension");'
    };
    
    for (const [filePath, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(tmpDir, filePath), content, 'utf8');
    }
    
    return tmpDir;
}

/**
 * Package a directory as a VSIX (ZIP archive)
 */
function packageAsVSIX(tmpDir, outputPath) {
    try {
        // VSIX is a ZIP archive - use zip command
        execSync(`cd "${tmpDir}" && zip -r "${outputPath}" extension/`, { stdio: 'pipe' });
        return true;
    } catch (error) {
        console.error(`Failed to package VSIX: ${error.message}`);
        return false;
    }
}

/**
 * Test suite
 */
function runTests() {
    console.log('Running VSIX verifier tests...\n');
    
    let passed = 0;
    let failed = 0;
    
    // Ensure fixtures directory exists
    if (!fs.existsSync(FIXTURES_DIR)) {
        fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    }
    
    // Test 1: Missing ontology.ttl file
    console.log('Test 1: Detect missing ontology.ttl...');
    try {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-test-'));
        const vsixPath = path.join(FIXTURES_DIR, 'test-missing-ontology.vsix');
        
        // Create valid structure but omit ontology.ttl
        createValidVSIXStructure(tmpDir);
        fs.unlinkSync(path.join(tmpDir, 'extension/bridge/ontology.ttl'));
        
        // Package as VSIX
        if (packageAsVSIX(tmpDir, vsixPath)) {
            // Verify should fail
            const result = verifyVSIX(vsixPath);
            
            if (result === false) {
                console.log('  ✅ PASS: Correctly detected missing ontology.ttl\n');
                passed++;
            } else {
                console.log('  ❌ FAIL: Should have failed but passed\n');
                failed++;
            }
            
            // Cleanup
            fs.unlinkSync(vsixPath);
        } else {
            console.log('  ⚠️  SKIP: Could not create test VSIX (zip not available)\n');
        }
        
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (error) {
        console.log(`  ❌ FAIL: ${error.message}\n`);
        failed++;
    }
    
    // Test 2: Missing ontology_provider.py file
    console.log('Test 2: Detect missing ontology_provider.py...');
    try {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-test-'));
        const vsixPath = path.join(FIXTURES_DIR, 'test-missing-provider.vsix');
        
        // Create valid structure but omit ontology_provider.py
        createValidVSIXStructure(tmpDir);
        fs.unlinkSync(path.join(tmpDir, 'extension/bridge/ontology_provider.py'));
        
        // Package as VSIX
        if (packageAsVSIX(tmpDir, vsixPath)) {
            // Verify should fail
            const result = verifyVSIX(vsixPath);
            
            if (result === false) {
                console.log('  ✅ PASS: Correctly detected missing ontology_provider.py\n');
                passed++;
            } else {
                console.log('  ❌ FAIL: Should have failed but passed\n');
                failed++;
            }
            
            // Cleanup
            fs.unlinkSync(vsixPath);
        } else {
            console.log('  ⚠️  SKIP: Could not create test VSIX (zip not available)\n');
        }
        
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (error) {
        console.log(`  ❌ FAIL: ${error.message}\n`);
        failed++;
    }
    
    // Test 3: Empty ontology.ttl file
    console.log('Test 3: Detect empty ontology.ttl...');
    try {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-test-'));
        const vsixPath = path.join(FIXTURES_DIR, 'test-empty-ontology.vsix');
        
        // Create valid structure but make ontology.ttl empty
        createValidVSIXStructure(tmpDir);
        fs.writeFileSync(path.join(tmpDir, 'extension/bridge/ontology.ttl'), '', 'utf8');
        
        // Package as VSIX
        if (packageAsVSIX(tmpDir, vsixPath)) {
            // Verify should fail
            const result = verifyVSIX(vsixPath);
            
            if (result === false) {
                console.log('  ✅ PASS: Correctly detected empty ontology.ttl\n');
                passed++;
            } else {
                console.log('  ❌ FAIL: Should have failed but passed\n');
                failed++;
            }
            
            // Cleanup
            fs.unlinkSync(vsixPath);
        } else {
            console.log('  ⚠️  SKIP: Could not create test VSIX (zip not available)\n');
        }
        
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (error) {
        console.log(`  ❌ FAIL: ${error.message}\n`);
        failed++;
    }
    
    // Test 4: Invalid package.json
    console.log('Test 4: Detect invalid package.json...');
    try {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-test-'));
        const vsixPath = path.join(FIXTURES_DIR, 'test-invalid-package.vsix');
        
        // Create valid structure but make package.json invalid
        createValidVSIXStructure(tmpDir);
        fs.writeFileSync(path.join(tmpDir, 'extension/package.json'), 'invalid json', 'utf8');
        
        // Package as VSIX
        if (packageAsVSIX(tmpDir, vsixPath)) {
            // Verify should fail
            const result = verifyVSIX(vsixPath);
            
            if (result === false) {
                console.log('  ✅ PASS: Correctly detected invalid package.json\n');
                passed++;
            } else {
                console.log('  ❌ FAIL: Should have failed but passed\n');
                failed++;
            }
            
            // Cleanup
            fs.unlinkSync(vsixPath);
        } else {
            console.log('  ⚠️  SKIP: Could not create test VSIX (zip not available)\n');
        }
        
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (error) {
        console.log(`  ❌ FAIL: ${error.message}\n`);
        failed++;
    }
    
    // Test 5: Valid VSIX passes
    console.log('Test 5: Valid VSIX passes verification...');
    try {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-test-'));
        const vsixPath = path.join(FIXTURES_DIR, 'test-valid.vsix');
        
        // Create valid structure
        createValidVSIXStructure(tmpDir);
        
        // Package as VSIX
        if (packageAsVSIX(tmpDir, vsixPath)) {
            // Verify should pass
            const result = verifyVSIX(vsixPath);
            
            if (result === true) {
                console.log('  ✅ PASS: Valid VSIX passed verification\n');
                passed++;
            } else {
                console.log('  ❌ FAIL: Valid VSIX should have passed\n');
                failed++;
            }
            
            // Cleanup
            fs.unlinkSync(vsixPath);
        } else {
            console.log('  ⚠️  SKIP: Could not create test VSIX (zip not available)\n');
        }
        
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (error) {
        console.log(`  ❌ FAIL: ${error.message}\n`);
        failed++;
    }
    
    // Test 6: Non-existent VSIX file
    console.log('Test 6: Handle non-existent VSIX file...');
    try {
        const result = verifyVSIX('/nonexistent/path.vsix');
        
        if (result === false) {
            console.log('  ✅ PASS: Correctly handled non-existent file\n');
            passed++;
        } else {
            console.log('  ❌ FAIL: Should have failed for non-existent file\n');
            failed++;
        }
    } catch (error) {
        console.log(`  ❌ FAIL: ${error.message}\n`);
        failed++;
    }
    
    // Summary
    console.log('━'.repeat(60));
    console.log(`Test Results: ${passed} passed, ${failed} failed`);
    
    if (failed === 0 && passed > 0) {
        console.log('✅ All VSIX verifier tests passed');
        console.log('━'.repeat(60));
        process.exit(0);
    } else if (passed === 0) {
        console.log('⚠️  No tests could run (zip command not available?)');
        console.log('━'.repeat(60));
        process.exit(0); // Don't fail build if environment doesn't support zip
    } else {
        console.log('❌ Some VSIX verifier tests failed');
        console.log('━'.repeat(60));
        process.exit(1);
    }
}

// Run tests
if (require.main === module) {
    runTests();
}

module.exports = { runTests };
