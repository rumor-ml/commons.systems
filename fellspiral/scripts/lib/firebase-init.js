/**
 * Shared Firebase initialization helper
 *
 * Supports multiple credential sources:
 * - Emulator mode (FIREBASE_AUTH_EMULATOR_HOST or FIRESTORE_EMULATOR_HOST set)
 * - GOOGLE_APPLICATION_CREDENTIALS_JSON (inline JSON, for CI/CD)
 * - GOOGLE_APPLICATION_CREDENTIALS (path to service account file)
 * - gcloud Application Default Credentials (requires FIREBASE_PROJECT_ID environment variable)
 *
 * @returns {boolean} - true if initialization succeeds or was already complete
 */

import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { readFileSync } from 'fs';

// TODO(#1357): Extract credential validation to allow graceful error recovery in server context
export function initializeFirebase() {
  if (getApps().length > 0) {
    return true;
  }

  // Detect emulator mode - no credentials needed
  const isEmulatorMode = !!(
    process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST
  );

  if (isEmulatorMode) {
    // Firebase Admin SDK automatically connects to emulators when env vars are set
    // Use GCP_PROJECT_ID from environment (set by allocate-test-ports.sh)
    // Each worktree gets a unique project ID like demo-test-314015698
    const projectId = process.env.GCP_PROJECT_ID || 'demo-test';
    initializeApp({
      projectId,
    });
    console.log(`Using Firebase emulators (projectId: ${projectId})`);
    return true;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    // Parse inline JSON credentials (useful for CI/CD)
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    } catch (error) {
      console.error('\n❌ Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON:', error.message);
      console.error('Your credentials JSON is malformed.');
      console.error('\nFull error details:', error);
      process.exit(1);
    }
    if (!serviceAccount.project_id) {
      console.error('\n❌ Service account JSON is missing required "project_id" field');
      console.error('Your service account is missing the project_id field.');
      process.exit(1);
    }
    try {
      initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
    } catch (initError) {
      console.error('\n❌ Firebase SDK initialization failed:', initError.message);
      if (initError.code === 'auth/invalid-credential') {
        console.error('Your credentials are invalid or malformed.');
      }
      console.error('\nFull error details:', initError);
      process.exit(1);
    }
    console.log('Using inline JSON credentials');
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    let credFileContent;
    try {
      credFileContent = readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
    } catch (error) {
      console.error(
        `\n❌ Failed to read credentials file at ${process.env.GOOGLE_APPLICATION_CREDENTIALS}:`,
        error.message
      );
      console.error('\nFull error details:', error);
      process.exit(1);
    }
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(credFileContent);
    } catch (error) {
      console.error('\n❌ Failed to parse credentials file:', error.message);
      console.error('Your credentials JSON is malformed.');
      console.error('\nFull error details:', error);
      process.exit(1);
    }

    // Check if this is a service account file (has project_id) or workload identity file
    if (serviceAccount.project_id) {
      // Traditional service account JSON
      try {
        initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
      } catch (initError) {
        console.error('\n❌ Firebase SDK initialization failed:', initError.message);
        if (initError.code === 'auth/invalid-credential') {
          console.error('Your credentials are invalid or malformed.');
        }
        console.error('\nFull error details:', initError);
        process.exit(1);
      }
      console.log('Using service account file credentials');
    } else {
      // Workload Identity Federation credentials (no project_id field)
      // Use Application Default Credentials with explicit project ID
      const projectId =
        process.env.FIRESTORE_PROJECT_ID ||
        process.env.FIREBASE_PROJECT_ID ||
        process.env.GCP_PROJECT_ID;
      if (!projectId) {
        console.error('\n❌ Project ID is required when using Workload Identity Federation');
        console.error('Set one of: FIRESTORE_PROJECT_ID, FIREBASE_PROJECT_ID, or GCP_PROJECT_ID');
        process.exit(1);
      }
      console.log(`Using Workload Identity Federation for project: ${projectId}`);
      try {
        initializeApp({
          credential: applicationDefault(),
          projectId: projectId,
        });
      } catch (initError) {
        console.error('\n❌ Firebase SDK initialization failed:', initError.message);
        if (initError.code === 'auth/invalid-credential') {
          console.error('Your credentials are invalid or malformed.');
        }
        console.error('\nFull error details:', initError);
        process.exit(1);
      }
    }
  } else {
    if (!process.env.FIREBASE_PROJECT_ID) {
      console.error(
        '\n❌ FIREBASE_PROJECT_ID environment variable is required when using Application Default Credentials'
      );
      console.error(
        'Set FIREBASE_PROJECT_ID to your Firebase project ID, or use one of these alternatives:'
      );
      console.error('  - GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable (inline JSON)');
      console.error(
        '  - GOOGLE_APPLICATION_CREDENTIALS environment variable (path to service account file)'
      );
      process.exit(1);
    }

    console.log(
      `Using gcloud Application Default Credentials for project: ${process.env.FIREBASE_PROJECT_ID}`
    );
    try {
      initializeApp({
        credential: applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID,
      });
    } catch (initError) {
      console.error('\n❌ Firebase SDK initialization failed:', initError.message);
      if (initError.code === 'auth/invalid-credential') {
        console.error('Your credentials are invalid or malformed.');
      } else {
        console.error('Ensure gcloud Application Default Credentials are configured:');
        console.error('  Run: gcloud auth application-default login');
      }
      console.error('\nFull error details:', initError);
      process.exit(1);
    }
  }

  return true; // Indicate successful initialization
}
