#!/usr/bin/env node
/**
 * Plan 094: Verify package.json zone enum matches API contract GEOGRAPHIC_ZONES
 * 
 * This script validates that the flowbaby.cloud.preferredZone enum in package.json
 * matches the GEOGRAPHIC_ZONES array from @groupzer0/flowbaby-api-contract.
 * 
 * Run as part of build/test to prevent drift between UI and backend zone list.
 * 
 * Exit codes:
 *   0 - Success: enum matches contract zones
 *   1 - Failure: mismatch detected (hard failure, no warnings-only mode)
 */

const fs = require('fs');
const path = require('path');

// Import the contract zone list
let GEOGRAPHIC_ZONES;
try {
    const contract = require('@groupzer0/flowbaby-api-contract');
    GEOGRAPHIC_ZONES = contract.GEOGRAPHIC_ZONES;
} catch (e) {
    console.error('ERROR: Could not import @groupzer0/flowbaby-api-contract');
    console.error('  Make sure npm install has been run.');
    process.exit(1);
}

if (!Array.isArray(GEOGRAPHIC_ZONES)) {
    console.error('ERROR: GEOGRAPHIC_ZONES not found or not an array in contract');
    console.error('  Expected @groupzer0/flowbaby-api-contract to export GEOGRAPHIC_ZONES');
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

// Get the preferredZone config
const preferredZoneConfig = packageJson?.contributes?.configuration?.properties?.['flowbaby.cloud.preferredZone'];
if (!preferredZoneConfig) {
    console.error('ERROR: flowbaby.cloud.preferredZone not found in package.json');
    process.exit(1);
}

const packageJsonEnum = preferredZoneConfig.enum;
if (!Array.isArray(packageJsonEnum)) {
    console.error('ERROR: flowbaby.cloud.preferredZone.enum is not an array');
    process.exit(1);
}

// The package.json enum includes "" (empty string) for "backend default"
// Filter that out for comparison
const packageJsonZones = packageJsonEnum.filter(z => z !== '');

// Sort both for comparison
const sortedPackageJson = [...packageJsonZones].sort();
const sortedContract = [...GEOGRAPHIC_ZONES].sort();

// Compare
const match = JSON.stringify(sortedPackageJson) === JSON.stringify(sortedContract);

if (match) {
    console.log('✓ Zone allowlist check PASSED');
    console.log(`  package.json enum: [${sortedPackageJson.join(', ')}]`);
    console.log(`  contract zones: [${sortedContract.join(', ')}]`);
    process.exit(0);
} else {
    console.error('✗ Zone allowlist check FAILED');
    console.error('  package.json enum:', sortedPackageJson);
    console.error('  contract zones:', sortedContract);
    
    // Show specific differences
    const inPackageNotContract = packageJsonZones.filter(z => !GEOGRAPHIC_ZONES.includes(z));
    const inContractNotPackage = GEOGRAPHIC_ZONES.filter(z => !packageJsonZones.includes(z));
    
    if (inPackageNotContract.length > 0) {
        console.error(`  In package.json but not in contract: [${inPackageNotContract.join(', ')}]`);
    }
    if (inContractNotPackage.length > 0) {
        console.error(`  In contract but not in package.json: [${inContractNotPackage.join(', ')}]`);
    }
    
    console.error('');
    console.error('  To fix: Update extension/package.json flowbaby.cloud.preferredZone enum');
    console.error('  to match GEOGRAPHIC_ZONES from @groupzer0/flowbaby-api-contract');
    
    process.exit(1);
}
