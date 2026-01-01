/**
 * Firebase Emulator Port Configuration
 *
 * IMPORTANT: Port values are duplicated here from firebase.json for TypeScript type safety.
 * These values MUST be manually kept in sync with firebase.json (root directory).
 *
 * Architecture:
 * - firebase.json defines actual emulator ports (source of truth for Firebase CLI)
 * - This file duplicates those ports for TypeScript imports
 * - Tests enforce consistency to prevent configuration drift
 *
 * Used by:
 * - fellspiral/site/src/scripts/firebase.js (client-side emulator connection)
 * - fellspiral/tests/global-setup.ts (test setup)
 * - printsync/tests/global-setup.ts (test setup)
 * - infrastructure/scripts/allocate-test-ports.sh (via generate-firebase-ports.sh)
 *
 * Validation:
 * - shared/config/firebase-ports.test.ts validates ports match firebase.json
 * - infrastructure/scripts/tests/config-consistency.test.sh validates bash integration
 *
 * See also:
 * - infrastructure/scripts/generate-firebase-ports.sh (bash port generation)
 */

// Branded types prevent mixing port types at compile time
export type FirestorePort = number & { readonly __brand: 'FirestorePort' };
export type AuthPort = number & { readonly __brand: 'AuthPort' };
export type StoragePort = number & { readonly __brand: 'StoragePort' };
export type UIPort = number & { readonly __brand: 'UIPort' };

/**
 * Factory functions with runtime validation
 * These ensure port values are correct and create branded types
 */
function createFirestorePort(port: number): FirestorePort {
  if (port !== 8081) {
    throw new Error(`Invalid Firestore port: ${port}, expected 8081`);
  }
  return port as FirestorePort;
}

function createAuthPort(port: number): AuthPort {
  if (port !== 9099) {
    throw new Error(`Invalid Auth port: ${port}, expected 9099`);
  }
  return port as AuthPort;
}

function createStoragePort(port: number): StoragePort {
  if (port !== 9199) {
    throw new Error(`Invalid Storage port: ${port}, expected 9199`);
  }
  return port as StoragePort;
}

function createUIPort(port: number): UIPort {
  if (port !== 4000) {
    throw new Error(`Invalid UI port: ${port}, expected 4000`);
  }
  return port as UIPort;
}

export const FIREBASE_PORTS = {
  firestore: createFirestorePort(8081),
  auth: createAuthPort(9099),
  storage: createStoragePort(9199),
  ui: createUIPort(4000),
} as const;
