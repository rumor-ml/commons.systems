/**
 * Firebase Configuration for Printsync
 *
 * IMPORTANT: These are FAKE credentials for emulator use only
 *
 * - Development (localhost): Connects to Firebase Auth emulator
 * - E2E Tests: Connects to emulators with test-specific ports
 * - Production: Would need real credentials (not implemented yet)
 *
 * This configuration is safe to expose publicly as it only identifies
 * the Firebase project. Access control is managed via Firestore security
 * rules (firestore.rules).
 */

// Firebase configuration - fake credentials with valid format for emulator use
export const firebaseConfig = {
  apiKey: 'AIzaSyDemoKeyForEmulatorUseOnly123456789',
  authDomain: 'demo-test.firebaseapp.com',
  projectId: 'demo-test', // Must match GCP_PROJECT_ID in playwright.config.ts
  storageBucket: 'demo-test.firebasestorage.app',
  messagingSenderId: '123456789012',
  appId: '1:123456789012:web:abc123def456ghi789',
};
