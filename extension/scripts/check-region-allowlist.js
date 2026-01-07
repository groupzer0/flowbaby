#!/usr/bin/env node
/**
 * Plan 091 M4: Verify package.json region enum matches API contract allowlist
 * 
 * This script validates that the flowbaby.cloud.preferredRegion enum in package.json
 * matches the ENABLED_BEDROCK_REGIONS allowlist from @groupzer0/flowbaby-api-contract.
 * 
 * Run as part of build/test to prevent drift between UI and backend allowlist.
 * 
 * Exit codes:
 *   0 - Success: enum matches allowlist
 *   1 - Failure: mismatch detected
 */

const fs = require('fs');
const path = require('path');

// Import the contract allowlist
let ENABLED_BEDROCK_REGIONS;
try {
    const contract = require('@groupzer0/flowbaby-api-contract');
    ENABLED_BEDROCK_REGIONS = contract.ENABLED_BEDROCK_REGIONS;
} catch (e) {
    console.error('ERROR: Could not import @groupzer0/flowbaby-api-contract');
    console.error('  Make sure npm install has been run.');
    process.exit(1);
}

// Read package.json
const packageJsonPath = path.join(__dirname, '..', 'package.json');
let packageJson;
try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
} catch (e) {
    console.error(`ERROR: Could not read package.json at ${packageJsonPath}`);
    process.exit(1);
}

// Get the preferredRegion config
const preferredRegionConfig = packageJson?.contributes?.configuration?.properties?.['flowbaby.cloud.preferredRegion'];
if (!preferredRegionConfig) {
    console.error('ERROR: flowbaby.cloud.preferredRegion not found in package.json');
    process.exit(1);
}

const packageJsonEnum = preferredRegionConfig.enum;
if (!Array.isArray(packageJsonEnum)) {
    console.error('ERROR: flowbaby.cloud.preferredRegion.enum is not an array');
    process.exit(1);
}

// The package.json enum includes "" (empty string) for "backend default"
// Filter that out for comparison
const packageJsonRegions = packageJsonEnum.filter(r => r !== '');

// Convert contract allowlist to array if needed and sort for comparison
const contractRegions = Array.isArray(ENABLED_BEDROCK_REGIONS) 
    ? [...ENABLED_BEDROCK_REGIONS] 
    : [];

// Sort both for comparison
const sortedPackageJson = [...packageJsonRegions].sort();
const sortedContract = [...contractRegions].sort();

// Compare
const match = JSON.stringify(sortedPackageJson) === JSON.stringify(sortedContract);

if (match) {
    console.log('✓ Region allowlist check PASSED');
    console.log(`  package.json enum: [${sortedPackageJson.join(', ')}]`);
    console.log(`  contract allowlist: [${sortedContract.join(', ')}]`);
    process.exit(0);
} else {
    console.error('✗ Region allowlist check FAILED');
    console.error('  package.json enum:', sortedPackageJson);
    console.error('  contract allowlist:', sortedContract);
    
    // Show specific differences
    const inPackageNotContract = packageJsonRegions.filter(r => !contractRegions.includes(r));
    const inContractNotPackage = contractRegions.filter(r => !packageJsonRegions.includes(r));
    
    if (inPackageNotContract.length > 0) {
        console.error(`  In package.json but not in contract: [${inPackageNotContract.join(', ')}]`);
    }
    if (inContractNotPackage.length > 0) {
        console.error(`  In contract but not in package.json: [${inContractNotPackage.join(', ')}]`);
    }
    
    console.error('');
    console.error('  To fix: Update extension/package.json flowbaby.cloud.preferredRegion enum');
    console.error('  to match ENABLED_BEDROCK_REGIONS from @groupzer0/flowbaby-api-contract');
    
    process.exit(1);
}
