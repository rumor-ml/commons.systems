/**
 * Shared Firebase initialization helper
 *
 * Supports multiple credential sources:
 * - GOOGLE_APPLICATION_CREDENTIALS_JSON (inline JSON, for CI/CD)
 * - GOOGLE_APPLICATION_CREDENTIALS (path to service account file)
 * - gcloud Application Default Credentials (fallback)
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { readFileSync } from 'fs';

export function initializeFirebase() {
  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      // CI/CD: parse inline JSON
      let serviceAccount;
      try {
        serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      } catch (error) {
        throw new Error(`Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON: ${error.message}`);
      }
      initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
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
      initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
      console.log('Using service account file credentials');
    } else {
      // Use gcloud Application Default Credentials
      console.log('Using gcloud Application Default Credentials');
      initializeApp({ credential: applicationDefault(), projectId: 'chalanding' });
    }
  } catch (error) {
    console.error('\n❌ Failed to initialize Firebase:', error.message);
    console.error('Ensure one of the following is configured:');
    console.error('  - GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable');
    console.error('  - GOOGLE_APPLICATION_CREDENTIALS environment variable');
    console.error('  - gcloud Application Default Credentials (run: gcloud auth application-default login)');
    process.exit(1);
  }
}
