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
 * - To update ports: modify firebase.json and this file, then run tests to verify consistency
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
// WARNING: TypeScript's structural type system cannot prevent branded type mixing via 'as' casts.
// These types provide documentation and IDE support, not compile-time guarantees.
// Use createPort() factory function to ensure runtime validation.
// TODO(#1231): TypeScript structural typing allows type mixing via 'as' casts - consider nominal types
export type FirestorePort = number & { readonly [FirestorePortBrand]: true };
export type AuthPort = number & { readonly [AuthPortBrand]: true };
export type StoragePort = number & { readonly [StoragePortBrand]: true };
export type UIPort = number & { readonly [UIPortBrand]: true };

/**
 * Validates a port number is in valid TCP/IP range (1-65535)
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
 * Exported to allow tests to verify validation behavior independently of FIREBASE_PORTS
 * TODO(#1232): Consider semantic validation of port-to-service mapping against firebase.json
 */
export function createPort<T extends FirestorePort | AuthPort | StoragePort | UIPort>(
  port: number,
  name: string
): T {
  validatePort(port, name);
  return port as T;
}

/**
 * Configuration for all Firebase emulator ports
 *
 * IMPORTANT: Do not construct this type directly. Use the FIREBASE_PORTS constant
 * or createPort() factory functions to ensure all ports are validated.
 */
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
