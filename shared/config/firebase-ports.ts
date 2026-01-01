/**
 * Firebase Emulator Port Configuration
 *
 * SINGLE SOURCE OF TRUTH: firebase.json (root directory)
 * This file exports TypeScript constants validated against firebase.json
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
