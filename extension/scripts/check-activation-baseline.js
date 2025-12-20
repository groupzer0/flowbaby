#!/usr/bin/env node
/**
 * Activation Integration Check — Plan 062
 * 
 * Verifies that all expected registrations from .activation-baseline.json
 * are present in the compiled extension. This is a lightweight CI-friendly
 * check that doesn't require running VS Code.
 * 
 * Usage:
 *   node scripts/check-activation-baseline.js
 * 
 * Exit codes:
 *   0 - All registrations found
 *   1 - Missing registrations or baseline file
 */

const fs = require('fs');
const path = require('path');

const BASELINE_PATH = path.join(__dirname, '..', '.activation-baseline.json');
const EXTENSION_SRC = path.join(__dirname, '..', 'src', 'extension.ts');
const ACTIVATION_SRC = path.join(__dirname, '..', 'src', 'activation', 'registrations.ts');
const INIT_SRC = path.join(__dirname, '..', 'src', 'activation', 'init.ts');
const PACKAGE_JSON = path.join(__dirname, '..', 'package.json');

function main() {
    console.log('🔍 Activation Integration Check (Plan 062)\n');

    // Load baseline
    if (!fs.existsSync(BASELINE_PATH)) {
        console.error('❌ Baseline file not found:', BASELINE_PATH);
        process.exit(1);
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
    
    // Handle both old (array) and new (object) command format
    const baselineCommands = Array.isArray(baseline.commands) 
        ? baseline.commands 
        : [...(baseline.commands.registered || []), ...(baseline.commands.internal || [])];
    
    console.log(`📋 Baseline version: ${baseline.version}`);
    console.log(`   Commands: ${baselineCommands.length}`);
    console.log(`   LM Tools: ${baseline.languageModelTools.length}`);
    console.log(`   Chat Participants: ${baseline.chatParticipants.length}\n`);

    // Load package.json for cross-validation
    if (!fs.existsSync(PACKAGE_JSON)) {
        console.error('❌ package.json not found:', PACKAGE_JSON);
        process.exit(1);
    }
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf-8'));

    // Load extension source (combined extension.ts + activation/registrations.ts)
    if (!fs.existsSync(EXTENSION_SRC)) {
        console.error('❌ Extension source not found:', EXTENSION_SRC);
        process.exit(1);
    }
    let extensionSource = fs.readFileSync(EXTENSION_SRC, 'utf-8');
    
    // Plan 062: Also include activation modules in search
    if (fs.existsSync(ACTIVATION_SRC)) {
        extensionSource += '\n' + fs.readFileSync(ACTIVATION_SRC, 'utf-8');
    }
    if (fs.existsSync(INIT_SRC)) {
        extensionSource += '\n' + fs.readFileSync(INIT_SRC, 'utf-8');
    }

    let errors = [];
    let warnings = [];

    // Check commands in package.json
    const pkgCommands = (pkg.contributes?.commands || []).map(c => c.command);
    console.log('📦 package.json commands:', pkgCommands.length);
    
    // Only check registered commands against package.json (internal commands may not be there)
    const registeredCommands = Array.isArray(baseline.commands) 
        ? baseline.commands 
        : (baseline.commands.registered || []);
    
    for (const cmd of registeredCommands) {
        if (!pkgCommands.includes(cmd)) {
            warnings.push(`Command "${cmd}" in baseline but not in package.json`);
        }
    }

    // Check commands are registered in source
    console.log('\n🔎 Checking command registrations in source...');
    for (const cmd of baselineCommands) {
        // Look for registerCommand('CommandId' or registerCommand("CommandId"
        const pattern = new RegExp(`registerCommand\\s*\\(\\s*['"\`]${escapeRegex(cmd)}['"\`]`);
        if (!pattern.test(extensionSource)) {
            errors.push(`Command "${cmd}" not found in extension source`);
        } else {
            console.log(`   ✓ ${cmd}`);
        }
    }

    // Check LM tools in package.json
    // VS Code schema uses 'name' not 'toolId' for languageModelTools
    const pkgTools = (pkg.contributes?.languageModelTools || []).map(t => t.name || t.toolId);
    console.log('\n📦 package.json LM tools:', pkgTools.length);

    for (const tool of baseline.languageModelTools) {
        if (!pkgTools.includes(tool)) {
            warnings.push(`LM tool "${tool}" in baseline but not in package.json`);
        }
    }

    // Check LM tools are registered in source
    console.log('\n🔎 Checking LM tool registrations in source...');
    for (const tool of baseline.languageModelTools) {
        const pattern = new RegExp(`registerTool\\s*\\(\\s*['"\`]${escapeRegex(tool)}['"\`]`);
        if (!pattern.test(extensionSource)) {
            errors.push(`LM tool "${tool}" not found in extension source`);
        } else {
            console.log(`   ✓ ${tool}`);
        }
    }

    // Check chat participants in package.json
    const pkgParticipants = (pkg.contributes?.chatParticipants || []).map(p => p.id);
    console.log('\n📦 package.json chat participants:', pkgParticipants.length);

    for (const participant of baseline.chatParticipants) {
        if (!pkgParticipants.includes(participant)) {
            warnings.push(`Chat participant "${participant}" in baseline but not in package.json`);
        }
    }

    // Check chat participants are registered in source
    console.log('\n🔎 Checking chat participant registrations in source...');
    for (const participant of baseline.chatParticipants) {
        const pattern = new RegExp(`createChatParticipant\\s*\\(\\s*['"\`]${escapeRegex(participant)}['"\`]`);
        if (!pattern.test(extensionSource)) {
            errors.push(`Chat participant "${participant}" not found in extension source`);
        } else {
            console.log(`   ✓ ${participant}`);
        }
    }

    // Report results
    console.log('\n' + '='.repeat(50));
    
    if (warnings.length > 0) {
        console.log(`\n⚠️  Warnings (${warnings.length}):`);
        for (const w of warnings) {
            console.log(`   - ${w}`);
        }
    }

    if (errors.length > 0) {
        console.log(`\n❌ Errors (${errors.length}):`);
        for (const e of errors) {
            console.log(`   - ${e}`);
        }
        console.log('\n❌ Activation integration check FAILED');
        process.exit(1);
    }

    console.log('\n✅ Activation integration check PASSED');
    console.log(`   ${baselineCommands.length} commands verified`);
    console.log(`   ${baseline.languageModelTools.length} LM tools verified`);
    console.log(`   ${baseline.chatParticipants.length} chat participants verified`);
    process.exit(0);
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main();
