/**
 * Firebase Emulator Port Configuration
 *
 * TODO(#1081): Integrate firebase-ports config into build process
 *
 * Centralized port configuration used by:
 * - fellspiral/site/src/scripts/firebase.js (client-side emulator connection)
 * - fellspiral/tests/global-setup.ts (test setup)
 * - fellspiral/firebase.json (emulator configuration)
 * - infrastructure/scripts/allocate-test-ports.sh (port allocation)
 */

// TODO(#1087): FirestorePort, AuthPort, StoragePort, UIPort - Literal types provide no safety over number
export type FirestorePort = 8081;
export type AuthPort = 9099;
export type StoragePort = 9199;
export type UIPort = 4000;

// TODO(#1088): FIREBASE_PORTS - Type assertions defeat the port validation
export const FIREBASE_PORTS = {
  firestore: 8081 as FirestorePort,
  auth: 9099 as AuthPort,
  storage: 9199 as StoragePort,
  ui: 4000 as UIPort,
} as const;
