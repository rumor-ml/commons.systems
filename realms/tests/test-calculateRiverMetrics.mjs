#!/usr/bin/env node
/**
 * Test to verify that calculateRiverMetrics method exists and works correctly
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the React component file
const componentPath = join(__dirname, '../site/src/islands/MythicBastionlandRealms.jsx');
const componentCode = readFileSync(componentPath, 'utf-8');

console.log('Testing calculateRiverMetrics method...\n');

let allPassed = true;

// Test 1: Method exists in the component
console.log('Test 1: Checking if calculateRiverMetrics method exists');
if (componentCode.includes('calculateRiverMetrics()')) {
  console.log('✓ PASS: calculateRiverMetrics() method found in component');
} else {
  console.log('✗ FAIL: calculateRiverMetrics() method not found');
  allPassed = false;
}

// Test 2: Method returns correct properties
console.log('\nTest 2: Checking if method returns networkCount, tributaryCount, and span');
const methodMatch = componentCode.match(/calculateRiverMetrics\(\)\s*{[\s\S]*?return\s*{[\s\S]*?}/);
if (methodMatch) {
  const methodBody = methodMatch[0];
  const hasNetworkCount = methodBody.includes('networkCount');
  const hasTributaryCount = methodBody.includes('tributaryCount');
  const hasSpan = methodBody.includes('span');

  if (hasNetworkCount && hasTributaryCount && hasSpan) {
    console.log('✓ PASS: Method returns networkCount, tributaryCount, and span');
  } else {
    console.log('✗ FAIL: Method missing required return properties');
    console.log(`  networkCount: ${hasNetworkCount ? '✓' : '✗'}`);
    console.log(`  tributaryCount: ${hasTributaryCount ? '✓' : '✗'}`);
    console.log(`  span: ${hasSpan ? '✓' : '✗'}`);
    allPassed = false;
  }
} else {
  console.log('✗ FAIL: Could not parse method body');
  allPassed = false;
}

// Test 3: Method is called in expected places
console.log('\nTest 3: Checking if method is called in getConstraintReport and StatePanel');
const getConstraintReportCalls = componentCode.match(/this\.calculateRiverMetrics\(\)/g);
const statePanelCalls = componentCode.match(/generator\.calculateRiverMetrics\(\)/g);

if (getConstraintReportCalls && getConstraintReportCalls.length >= 1) {
  console.log('✓ PASS: Method called in getConstraintReport');
} else {
  console.log('✗ FAIL: Method not called in getConstraintReport');
  allPassed = false;
}

if (statePanelCalls && statePanelCalls.length >= 1) {
  console.log('✓ PASS: Method called in StatePanel');
} else {
  console.log('✗ FAIL: Method not called in StatePanel');
  allPassed = false;
}

// Test 4: Method uses this.rivers array
console.log('\nTest 4: Checking if method uses this.rivers array');
if (methodMatch && methodMatch[0].includes('this.rivers')) {
  console.log('✓ PASS: Method uses this.rivers array');
} else {
  console.log('✗ FAIL: Method does not use this.rivers array');
  allPassed = false;
}

// Test 5: Method calls calculateRiverNetworkSpan
console.log('\nTest 5: Checking if method uses calculateRiverNetworkSpan');
if (methodMatch && methodMatch[0].includes('calculateRiverNetworkSpan')) {
  console.log('✓ PASS: Method calls calculateRiverNetworkSpan()');
} else {
  console.log('✗ FAIL: Method does not call calculateRiverNetworkSpan()');
  allPassed = false;
}

console.log(`\n${allPassed ? '✓ All tests PASSED' : '✗ Some tests FAILED'}`);
process.exit(allPassed ? 0 : 1);
