/**
 * Firebase Emulator Port Configuration
 *
 * IMPORTANT: firebase.json is the single source of truth for port values.
 * This file mirrors those values for compile-time type safety in TypeScript.
 *
 * Architecture:
 * - firebase.json defines emulator ports for Firebase CLI (source of truth)
 * - This file provides TypeScript constants with branded type safety
 * - infrastructure/scripts/generate-firebase-ports.sh automatically extracts ports for bash scripts
 * - Tests enforce consistency to catch configuration drift
 * - No manual synchronization required - just update firebase.json and run tests
 *
 * Used by test setup files, client-side code, and infrastructure scripts.
 * See generate-firebase-ports.sh for bash script integration.
 *
 * Validation:
 * - shared/config/firebase-ports.test.ts validates ports match firebase.json
 * - infrastructure/scripts/tests/config-consistency.test.sh validates bash integration
 */

// Unique symbols for compile-time type safety
const FirestorePortBrand: unique symbol = Symbol('FirestorePort');
const AuthPortBrand: unique symbol = Symbol('AuthPort');
const StoragePortBrand: unique symbol = Symbol('StoragePort');
const UIPortBrand: unique symbol = Symbol('UIPort');

// Branded types prevent mixing port types at compile time
// TODO(#1207): TypeScript structural typing allows type mixing via 'as' casts - consider nominal types
export type FirestorePort = number & { readonly [FirestorePortBrand]: true };
export type AuthPort = number & { readonly [AuthPortBrand]: true };
export type StoragePort = number & { readonly [StoragePortBrand]: true };
export type UIPort = number & { readonly [UIPortBrand]: true };

// Union of valid port brands for type safety
type ValidPortBrand = FirestorePort | AuthPort | StoragePort | UIPort;

/**
 * Validates a port number is in valid TCP/IP range (1-65535)
 * Does not validate correctness of port assignments (e.g., that 8081 is used for Firestore)
 * - firebase-ports.test.ts verifies port values match firebase.json
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
 * TODO(#1208): Consider semantic validation of port-to-service mapping against firebase.json
 */
export function createPort<T extends ValidPortBrand>(port: number, name: string): T {
  validatePort(port, name);
  return port as T;
}

// Explicit readonly type that preserves branded types
export type FirebasePorts = {
  readonly firestore: FirestorePort;
  readonly auth: AuthPort;
  readonly storage: StoragePort;
  readonly ui: UIPort;
};

export const FIREBASE_PORTS: FirebasePorts = {
  firestore: createPort<FirestorePort>(8081, 'Firestore'),
  auth: createPort<AuthPort>(9099, 'Auth'),
  storage: createPort<StoragePort>(9199, 'Storage'),
  ui: createPort<UIPort>(4000, 'UI'),
};
