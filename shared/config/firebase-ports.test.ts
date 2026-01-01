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
 * TODO(#1167): Verify fellspiral paths exist and actually use FIREBASE_PORTS
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
      const code = err.code ?? 'UNKNOWN';

      let troubleshooting = '';
      if (code === 'ENOENT') {
        troubleshooting =
          `File not found. Check that:\n` +
          `1. firebase.json exists in the repository root\n` +
          `2. You're running tests from the correct directory`;
      } else if (code === 'EACCES' || code === 'EPERM') {
        troubleshooting =
          `Permission denied. Check that:\n` +
          `1. The file has read permissions\n` +
          `2. Parent directories are accessible`;
      } else {
        troubleshooting =
          `Unexpected filesystem error (${code}). This may indicate:\n` +
          `- Filesystem corruption\n` +
          `- Insufficient memory\n` +
          `- Hardware problems`;
      }

      throw new Error(
        `Failed to read firebase.json: ${err.message}\n` +
          `Expected path: ${firebaseJsonPath}\n` +
          `Error code: ${code}\n` +
          `${troubleshooting}`
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
    // Port validity is guaranteed by createPort factory function
    assert.ok('firestore' in FIREBASE_PORTS, 'FIREBASE_PORTS must export firestore port');
    assert.ok('auth' in FIREBASE_PORTS, 'FIREBASE_PORTS must export auth port');
    assert.ok('storage' in FIREBASE_PORTS, 'FIREBASE_PORTS must export storage port');
    assert.ok('ui' in FIREBASE_PORTS, 'FIREBASE_PORTS must export ui port');
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

  test('factory function enforces boundary values correctly', () => {
    // Valid boundary values (1 and 65535 are the min and max valid TCP/IP ports)
    assert.doesNotThrow(
      () => createPort<FirestorePort>(1, 'Firestore'),
      'createPort should accept minimum valid port 1'
    );
    assert.strictEqual(
      createPort<FirestorePort>(1, 'Firestore'),
      1,
      'createPort should return port 1 unchanged'
    );

    assert.doesNotThrow(
      () => createPort<AuthPort>(65535, 'Auth'),
      'createPort should accept maximum valid port 65535'
    );
    assert.strictEqual(
      createPort<AuthPort>(65535, 'Auth'),
      65535,
      'createPort should return port 65535 unchanged'
    );

    // Invalid boundary values (0 and 65536 are outside valid range)
    assert.throws(
      () => createPort<FirestorePort>(0, 'Firestore'),
      {
        name: 'Error',
        message: /Invalid Firestore port: 0 \(must be integer 1-65535\)/,
      },
      'createPort should throw error for port 0 (below minimum)'
    );

    assert.throws(
      () => createPort<StoragePort>(65536, 'Storage'),
      {
        name: 'Error',
        message: /Invalid Storage port: 65536 \(must be integer 1-65535\)/,
      },
      'createPort should throw error for port 65536 (above maximum)'
    );
  });

  test('branded types document intent and provide runtime behavior', () => {
    // Branded types in firebase-ports.ts serve as type documentation to indicate
    // each port's intended usage (FirestorePort, AuthPort, etc.)
    // Note: TypeScript's structural type system means these don't prevent mixing
    // at compile time, but they improve code readability and IDE support

    // Type guard function that documents FirestorePort usage
    function expectFirestorePort(port: FirestorePort): FirestorePort {
      return port;
    }

    // Valid: passing correct branded type works as expected
    assert.doesNotThrow(
      () => expectFirestorePort(FIREBASE_PORTS.firestore),
      'Should accept FirestorePort where FirestorePort is expected'
    );

    // Runtime verification: branded types are still numbers
    // This is important for compatibility with existing code
    assert.strictEqual(typeof FIREBASE_PORTS.firestore, 'number');
    assert.strictEqual(typeof FIREBASE_PORTS.auth, 'number');
    assert.strictEqual(typeof FIREBASE_PORTS.storage, 'number');
    assert.strictEqual(typeof FIREBASE_PORTS.ui, 'number');

    // Verify each port type can be used as a number
    const firestoreNum: number = FIREBASE_PORTS.firestore;
    const authNum: number = FIREBASE_PORTS.auth;
    assert.ok(firestoreNum > 0);
    assert.ok(authNum > 0);
  });
});
