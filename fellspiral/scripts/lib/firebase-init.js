/**
 * Shared Firebase initialization helper
 *
 * Supports multiple credential sources:
 * - GOOGLE_APPLICATION_CREDENTIALS_JSON (inline JSON, for CI/CD)
 * - GOOGLE_APPLICATION_CREDENTIALS (path to service account file)
 * - gcloud Application Default Credentials (defaults to 'chalanding' project unless FIREBASE_PROJECT_ID is set)
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { readFileSync } from 'fs';

export function initializeFirebase() {
  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      // Parse inline JSON credentials (useful for CI/CD)
      let serviceAccount;
      try {
        serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      } catch (error) {
        throw new Error(`Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON: ${error.message}`);
      }
      if (!serviceAccount.project_id) {
        throw new Error('Service account JSON is missing required "project_id" field');
      }
      try {
        initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
      } catch (initError) {
        throw new Error(`Firebase SDK initialization failed: ${initError.message}`);
      }
      console.log('Using inline JSON credentials');
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // Explicit service account file
      let credFileContent;
      try {
        credFileContent = readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
      } catch (error) {
        throw new Error(`Failed to read credentials file at ${process.env.GOOGLE_APPLICATION_CREDENTIALS}: ${error.message}`);
      }
      let serviceAccount;
      try {
        serviceAccount = JSON.parse(credFileContent);
      } catch (error) {
        throw new Error(`Failed to parse credentials file: ${error.message}`);
      }
      if (!serviceAccount.project_id) {
        throw new Error('Service account JSON is missing required "project_id" field');
      }
      try {
        initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
      } catch (initError) {
        throw new Error(`Firebase SDK initialization failed: ${initError.message}`);
      }
      console.log('Using service account file credentials');
    } else {
      // Use gcloud Application Default Credentials
      const projectId = process.env.FIREBASE_PROJECT_ID || 'chalanding';

      if (!process.env.FIREBASE_PROJECT_ID) {
        console.log('⚠️  WARNING: FIREBASE_PROJECT_ID not set, defaulting to "chalanding"');
        console.log('Set FIREBASE_PROJECT_ID environment variable to use a different project.\n');
      }

      console.log(`Using gcloud Application Default Credentials for project: ${projectId}`);
      try {
        initializeApp({ credential: applicationDefault(), projectId });
      } catch (initError) {
        throw new Error(`Firebase SDK initialization failed: ${initError.message}`);
      }
    }
  } catch (error) {
    console.error('\n❌ Failed to initialize Firebase:', error.message);

    // Provide specific guidance based on error type
    if (error.code === 'auth/invalid-credential') {
      console.error('Your credentials are invalid or malformed.');
    } else if (error.message && error.message.includes('project_id')) {
      console.error('Your service account is missing the project_id field.');
    } else if (error instanceof SyntaxError || (error.message && error.message.includes('parse'))) {
      console.error('Your credentials JSON is malformed.');
    } else if (error instanceof TypeError || error instanceof ReferenceError) {
      console.error('This is a bug in the initialization script. Please report this error:');
      console.error(error.stack);
    } else {
      console.error('Ensure one of the following is configured:');
      console.error('  - GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable');
      console.error('  - GOOGLE_APPLICATION_CREDENTIALS environment variable');
      console.error('  - gcloud Application Default Credentials (run: gcloud auth application-default login)');
    }

    console.error('\nFull error details:', error);
    process.exit(1);
  }

  return true; // Indicate successful initialization
}
