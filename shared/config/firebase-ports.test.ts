/**
 * Configuration consistency tests for Firebase emulator ports
 *
 * Ensures that hardcoded ports in firebase-ports.ts match the ports
 * defined in firebase.json (the source of truth for Firebase emulators).
 *
 * This prevents configuration drift where:
 * - Developer changes firebase.json but forgets to update firebase-ports.ts
 * - Client-side code tries to connect to wrong emulator ports
 * - Tests fail with confusing "connection refused" errors
 *
 * Related files:
 * - firebase.json: Source of truth for emulator configuration
 * - shared/config/firebase-ports.ts: TypeScript constants exported to apps
 * - fellspiral/site/src/scripts/firebase.js: Uses FIREBASE_PORTS for emulator connection
 * - fellspiral/tests/global-setup.ts: Uses FIREBASE_PORTS for test setup
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIREBASE_PORTS } from './firebase-ports.ts';

describe('Firebase port configuration consistency', () => {
  test('firebase-ports.ts matches firebase.json emulator ports', () => {
    // Read firebase.json from repository root
    const firebaseJsonPath = join(process.cwd(), 'firebase.json');
    const firebaseJsonContent = readFileSync(firebaseJsonPath, 'utf-8');
    const firebaseConfig = JSON.parse(firebaseJsonContent);

    // Extract emulator ports from firebase.json
    const emulators = firebaseConfig.emulators;
    assert.ok(emulators, 'firebase.json must have emulators configuration');

    // Verify each port matches
    assert.strictEqual(
      FIREBASE_PORTS.firestore,
      emulators.firestore.port,
      `Firestore port mismatch: firebase-ports.ts=${FIREBASE_PORTS.firestore}, firebase.json=${emulators.firestore.port}`
    );

    assert.strictEqual(
      FIREBASE_PORTS.auth,
      emulators.auth.port,
      `Auth port mismatch: firebase-ports.ts=${FIREBASE_PORTS.auth}, firebase.json=${emulators.auth.port}`
    );

    assert.strictEqual(
      FIREBASE_PORTS.storage,
      emulators.storage.port,
      `Storage port mismatch: firebase-ports.ts=${FIREBASE_PORTS.storage}, firebase.json=${emulators.storage.port}`
    );

    assert.strictEqual(
      FIREBASE_PORTS.ui,
      emulators.ui.port,
      `UI port mismatch: firebase-ports.ts=${FIREBASE_PORTS.ui}, firebase.json=${emulators.ui.port}`
    );
  });

  test('firebase-ports.ts exports expected port structure', () => {
    // Verify the FIREBASE_PORTS object has all required fields
    assert.ok(FIREBASE_PORTS.firestore, 'FIREBASE_PORTS must export firestore port');
    assert.ok(FIREBASE_PORTS.auth, 'FIREBASE_PORTS must export auth port');
    assert.ok(FIREBASE_PORTS.storage, 'FIREBASE_PORTS must export storage port');
    assert.ok(FIREBASE_PORTS.ui, 'FIREBASE_PORTS must export ui port');

    // Verify they are valid port numbers (1-65535)
    assert.ok(
      FIREBASE_PORTS.firestore > 0 && FIREBASE_PORTS.firestore <= 65535,
      'Firestore port must be valid (1-65535)'
    );
    assert.ok(
      FIREBASE_PORTS.auth > 0 && FIREBASE_PORTS.auth <= 65535,
      'Auth port must be valid (1-65535)'
    );
    assert.ok(
      FIREBASE_PORTS.storage > 0 && FIREBASE_PORTS.storage <= 65535,
      'Storage port must be valid (1-65535)'
    );
    assert.ok(
      FIREBASE_PORTS.ui > 0 && FIREBASE_PORTS.ui <= 65535,
      'UI port must be valid (1-65535)'
    );
  });
});
