/**
 * Runtime integration test for global-setup.ts
 * Verifies that the global setup uses ports from FIREBASE_PORTS configuration
 * rather than hardcoded port numbers.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('global-setup uses ports from FIREBASE_PORTS, not hardcoded values', async () => {
  // Read the global-setup.ts source file
  const globalSetupPath = path.join(__dirname, 'global-setup.ts');
  const sourceCode = await readFile(globalSetupPath, 'utf-8');

  // Verify FIREBASE_PORTS is imported
  assert.ok(
    sourceCode.includes("from '../../shared/config/firebase-ports.js'") ||
      sourceCode.includes("from '../../shared/config/firebase-ports.ts'"),
    'global-setup.ts must import FIREBASE_PORTS from shared/config/firebase-ports'
  );

  // Verify it uses FIREBASE_PORTS.auth, FIREBASE_PORTS.firestore, FIREBASE_PORTS.storage
  assert.ok(
    sourceCode.includes('FIREBASE_PORTS.auth'),
    'global-setup.ts must use FIREBASE_PORTS.auth'
  );
  assert.ok(
    sourceCode.includes('FIREBASE_PORTS.firestore'),
    'global-setup.ts must use FIREBASE_PORTS.firestore'
  );
  assert.ok(
    sourceCode.includes('FIREBASE_PORTS.storage'),
    'global-setup.ts must use FIREBASE_PORTS.storage'
  );

  // TODO(#1169): Replace hardcoded ports with dynamic extraction from firebase.json
  // Define known Firebase emulator ports (from various firebase.json configs)
  const knownEmulatorPorts = [
    9099, // Auth emulator (common default)
    8080, // Firestore emulator (common default)
    9199, // Storage emulator (common default)
    5001, // Functions emulator
    9000, // Hosting emulator
    4000, // Emulator UI
  ];

  // Check for hardcoded port numbers in isPortInUse calls
  // Pattern: isPortInUse(NNNN) where NNNN is a number literal
  const hardcodedPortPattern = /isPortInUse\s*\(\s*(\d+)\s*\)/g;
  const matches = [...sourceCode.matchAll(hardcodedPortPattern)];

  for (const match of matches) {
    const portNumber = parseInt(match[1], 10);
    if (knownEmulatorPorts.includes(portNumber)) {
      assert.fail(
        `Found hardcoded port number ${portNumber} in isPortInUse() call. ` +
          `Should use FIREBASE_PORTS.* instead. ` +
          `Match: ${match[0]}`
      );
    }
  }

  // Verify no hardcoded ports in socket.connect() calls
  // Pattern: socket.connect(NNNN, ...) where NNNN is a number literal
  const hardcodedConnectPattern = /socket\.connect\s*\(\s*(\d+)\s*,/g;
  const connectMatches = [...sourceCode.matchAll(hardcodedConnectPattern)];

  for (const match of connectMatches) {
    const portNumber = parseInt(match[1], 10);
    if (knownEmulatorPorts.includes(portNumber)) {
      assert.fail(
        `Found hardcoded port number ${portNumber} in socket.connect() call. ` +
          `Should use FIREBASE_PORTS.* instead. ` +
          `Match: ${match[0]}`
      );
    }
  }

  console.log('✓ global-setup.ts uses FIREBASE_PORTS configuration');
  console.log('✓ No hardcoded emulator port numbers found');
  console.log('✓ Verified uses FIREBASE_PORTS.auth, .firestore, and .storage');
});

test('global-setup uses correct FIREBASE_PORTS properties in runtime checks', async () => {
  // This test verifies that global-setup.ts uses the correct FIREBASE_PORTS properties
  // in isPortInUse() calls (e.g., FIREBASE_PORTS.auth, not FIREBASE_PORTS.typo)

  // Read the global-setup source to find which FIREBASE_PORTS properties are used
  const globalSetupPath = path.join(__dirname, 'global-setup.ts');
  const sourceCode = await readFile(globalSetupPath, 'utf-8');

  // Extract the port checks from the source code
  // Looking for patterns like: await isPortInUse(FIREBASE_PORTS.auth)
  const portCheckPattern = /await\s+isPortInUse\s*\(\s*FIREBASE_PORTS\.(\w+)\s*\)/g;
  const portChecks = [...sourceCode.matchAll(portCheckPattern)];

  assert.ok(
    portChecks.length > 0,
    'Should find at least one FIREBASE_PORTS usage in isPortInUse calls'
  );

  // Extract the property names being used
  const propertiesUsed = new Set<string>();
  for (const match of portChecks) {
    const property = match[1]; // e.g., "auth", "firestore", "storage"
    propertiesUsed.add(property);
  }

  // Verify the expected properties are used (matching the standard Firebase emulators)
  assert.ok(propertiesUsed.has('auth'), 'Should check FIREBASE_PORTS.auth');
  assert.ok(propertiesUsed.has('firestore'), 'Should check FIREBASE_PORTS.firestore');
  assert.ok(propertiesUsed.has('storage'), 'Should check FIREBASE_PORTS.storage');

  // Verify only valid property names are used (no typos)
  const validProperties = new Set([
    'auth',
    'firestore',
    'storage',
    'functions',
    'hosting',
    'ui',
    'logging',
  ]);

  for (const prop of propertiesUsed) {
    assert.ok(
      validProperties.has(prop),
      `FIREBASE_PORTS.${prop} should be a valid Firebase emulator port property`
    );
  }

  console.log('✓ Verified FIREBASE_PORTS properties used in isPortInUse calls');
  console.log(`✓ Properties checked: ${Array.from(propertiesUsed).sort().join(', ')}`);
  console.log('✓ All properties are valid Firebase emulator port names');
});
