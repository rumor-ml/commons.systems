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
import {
  FIREBASE_PORTS,
  createPort,
  type FirestorePort,
  type AuthPort,
  type StoragePort,
  type UIPort,
} from './firebase-ports.ts';

describe('Firebase port configuration consistency', () => {
  test('firebase-ports.ts matches firebase.json emulator ports', () => {
    // Read firebase.json from repository root
    const firebaseJsonPath = join(process.cwd(), 'firebase.json');
    let firebaseJsonContent: string;
    try {
      firebaseJsonContent = readFileSync(firebaseJsonPath, 'utf-8');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      throw new Error(
        `Failed to read firebase.json: ${err.message}\n` +
          `Expected path: ${firebaseJsonPath}\n` +
          `This file is required for Firebase emulator configuration.\n` +
          `Check that:\n` +
          `1. firebase.json exists in the repository root\n` +
          `2. The file has read permissions\n` +
          `3. You're running tests from the correct directory`
      );
    }

    let firebaseConfig: any;
    try {
      firebaseConfig = JSON.parse(firebaseJsonContent);
    } catch (error) {
      throw new Error(
        `Failed to parse firebase.json: ${error instanceof Error ? error.message : String(error)}\n` +
          `File path: ${firebaseJsonPath}\n` +
          `Check for JSON syntax errors (trailing commas, missing brackets, etc.)`
      );
    }

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

  test('factory function validates correct port values', () => {
    // These should succeed with valid port numbers
    assert.doesNotThrow(
      () => createPort<FirestorePort>(8081, 'Firestore'),
      'createPort should accept valid Firestore port 8081'
    );
    assert.doesNotThrow(
      () => createPort<AuthPort>(9099, 'Auth'),
      'createPort should accept valid Auth port 9099'
    );
    assert.doesNotThrow(
      () => createPort<StoragePort>(9199, 'Storage'),
      'createPort should accept valid Storage port 9199'
    );
    assert.doesNotThrow(
      () => createPort<UIPort>(4000, 'UI'),
      'createPort should accept valid UI port 4000'
    );

    // Verify the factory function returns the expected values
    assert.strictEqual(createPort<FirestorePort>(8081, 'Firestore'), 8081);
    assert.strictEqual(createPort<AuthPort>(9099, 'Auth'), 9099);
    assert.strictEqual(createPort<StoragePort>(9199, 'Storage'), 9199);
    assert.strictEqual(createPort<UIPort>(4000, 'UI'), 4000);
  });

  test('factory function rejects invalid port values with helpful error messages', () => {
    // Test invalid port values (out of range)
    assert.throws(
      () => createPort<FirestorePort>(0, 'Firestore'),
      {
        name: 'Error',
        message: /Invalid Firestore port: 0 \(must be integer 1-65535\)/,
      },
      'createPort should throw error for port 0'
    );

    assert.throws(
      () => createPort<AuthPort>(65536, 'Auth'),
      {
        name: 'Error',
        message: /Invalid Auth port: 65536 \(must be integer 1-65535\)/,
      },
      'createPort should throw error for port above 65535'
    );

    assert.throws(
      () => createPort<StoragePort>(-1, 'Storage'),
      {
        name: 'Error',
        message: /Invalid Storage port: -1 \(must be integer 1-65535\)/,
      },
      'createPort should throw error for negative port'
    );

    assert.throws(
      () => createPort<UIPort>(1.5, 'UI'),
      {
        name: 'Error',
        message: /Invalid UI port: 1.5 \(must be integer 1-65535\)/,
      },
      'createPort should throw error for non-integer port'
    );

    // Verify error message includes helpful guidance
    try {
      createPort<FirestorePort>(0, 'Firestore');
      assert.fail('Should have thrown error');
    } catch (error) {
      assert.ok(
        error instanceof Error && error.message.includes('firebase.json'),
        'Error message should reference firebase.json for troubleshooting'
      );
    }
  });
});
