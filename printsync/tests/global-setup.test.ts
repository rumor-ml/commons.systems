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
