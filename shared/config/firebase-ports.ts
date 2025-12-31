/**
 * Firebase Emulator Port Configuration
 *
 * NOTE: This is a centralized reference for Firebase emulator ports.
 * However, not all parts of the codebase can import TypeScript files directly.
 *
 * TODO(#TBD): Integrate this config into build process so firebase.js can use it
 *
 * For now, these ports must be manually kept in sync with:
 * - fellspiral/firebase.json (emulators section)
 * - fellspiral/site/src/scripts/firebase.js
 * - fellspiral/tests/global-setup.ts
 * - infrastructure/scripts/allocate-test-ports.sh
 */

export type FirestorePort = 8081;
export type AuthPort = 9099;
export type StoragePort = 9199;
export type UIPort = 4000;

export const FIREBASE_PORTS = {
  firestore: 8081 as FirestorePort,
  auth: 9099 as AuthPort,
  storage: 9199 as StoragePort,
  ui: 4000 as UIPort,
} as const;

// Validate ports are valid network ports
type ValidPort = number & { __brand: 'ValidPort' };
function assertValidPort(port: number): asserts port is ValidPort {
  if (port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }
}

Object.values(FIREBASE_PORTS).forEach(assertValidPort);
