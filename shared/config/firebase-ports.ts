/**
 * Firebase Emulator Port Configuration
 *
 * IMPORTANT: Port values must be manually synchronized with firebase.json.
 * Tests in firebase-ports.test.ts automatically verify consistency.
 *
 * Architecture:
 * - firebase.json defines emulator ports for Firebase CLI
 * - This file mirrors those ports for TypeScript with branded type safety
 * - infrastructure/scripts/generate-firebase-ports.sh extracts ports for bash scripts
 * - Both TypeScript and bash must be kept in sync with firebase.json manually
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

// Unique symbols for compile-time type safety
const FirestorePortBrand: unique symbol = Symbol('FirestorePort');
const AuthPortBrand: unique symbol = Symbol('AuthPort');
const StoragePortBrand: unique symbol = Symbol('StoragePort');
const UIPortBrand: unique symbol = Symbol('UIPort');

// Branded types prevent mixing port types at compile time
export type FirestorePort = number & { readonly [FirestorePortBrand]: true };
export type AuthPort = number & { readonly [AuthPortBrand]: true };
export type StoragePort = number & { readonly [StoragePortBrand]: true };
export type UIPort = number & { readonly [UIPortBrand]: true };

/**
 * Validates a port number is in valid range (1-65535)
 * Does NOT validate specific port assignments - tests verify consistency with firebase.json
 */
function validatePort(port: number, name: string): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid ${name} port: ${port} (must be integer 1-65535). ` +
        `Check emulators.${name.toLowerCase()}.port in firebase.json`
    );
  }
}

/**
 * Generic factory function for creating branded port types
 * Validates port range (1-65535) and creates branded type
 *
 * Used by FIREBASE_PORTS constant and exported for testing validation logic
 */
export function createPort<T extends number>(port: number, name: string): T {
  validatePort(port, name);
  return port as T;
}

export const FIREBASE_PORTS = {
  firestore: createPort<FirestorePort>(8081, 'Firestore'),
  auth: createPort<AuthPort>(9099, 'Auth'),
  storage: createPort<StoragePort>(9199, 'Storage'),
  ui: createPort<UIPort>(4000, 'UI'),
} as const;
