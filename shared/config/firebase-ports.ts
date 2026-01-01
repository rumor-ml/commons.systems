/**
 * Firebase Emulator Port Configuration
 *
 * IMPORTANT: Port values are defined here with runtime validation.
 * firebase.json is the single source of truth - tests enforce consistency automatically.
 *
 * Architecture:
 * - firebase.json defines actual emulator ports (source of truth for Firebase CLI)
 * - This file exports those ports for TypeScript with branded type safety
 * - infrastructure/scripts/generate-firebase-ports.sh extracts ports for bash scripts
 * - Tests enforce consistency automatically (no manual synchronization needed)
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
 * Validates a port number is in valid range
 * Does NOT validate against hardcoded values - firebase.json is the single source of truth
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
 * Validates port range but not specific values (firebase.json is source of truth)
 *
 * Exported for testing purposes to verify validation logic
 */
export function createPort<T extends number & { readonly __brand: string }>(
  port: number,
  name: string
): T {
  validatePort(port, name);
  return port as T;
}

export const FIREBASE_PORTS = {
  firestore: createPort<FirestorePort>(8081, 'Firestore'),
  auth: createPort<AuthPort>(9099, 'Auth'),
  storage: createPort<StoragePort>(9199, 'Storage'),
  ui: createPort<UIPort>(4000, 'UI'),
} as const;
