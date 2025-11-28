/**
 * Shared Firebase initialization helper
 *
 * Supports multiple credential sources:
 * - GOOGLE_APPLICATION_CREDENTIALS_JSON (inline JSON, for CI/CD)
 * - GOOGLE_APPLICATION_CREDENTIALS (path to service account file)
 * - gcloud Application Default Credentials (requires FIREBASE_PROJECT_ID environment variable)
 */

import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { readFileSync } from 'fs';

export function initializeFirebase() {
  // Return early if already initialized
  if (getApps().length > 0) {
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
    // Explicit service account file
    let credFileContent;
    try {
      credFileContent = readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
    } catch (error) {
      console.error(`\n❌ Failed to read credentials file at ${process.env.GOOGLE_APPLICATION_CREDENTIALS}:`, error.message);
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
    console.log('Using service account file credentials');
  } else {
    // Use gcloud Application Default Credentials
    if (!process.env.FIREBASE_PROJECT_ID) {
      console.error('\n❌ FIREBASE_PROJECT_ID environment variable is required when using Application Default Credentials');
      console.error('Set FIREBASE_PROJECT_ID to your Firebase project ID, or use one of these alternatives:');
      console.error('  - GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable (inline JSON)');
      console.error('  - GOOGLE_APPLICATION_CREDENTIALS environment variable (path to service account file)');
      process.exit(1);
    }

    console.log(`Using gcloud Application Default Credentials for project: ${process.env.FIREBASE_PROJECT_ID}`);
    try {
      initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID });
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
