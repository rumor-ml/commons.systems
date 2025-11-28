#!/usr/bin/env node
/**
 * Quick verification script to check if cards are in Firestore
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

// Helper function to initialize Firebase with proper error handling
function initializeFirebase() {
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

// Initialize Firebase Admin
initializeFirebase();

const db = getFirestore();

async function verifyCards() {
  // Get sample cards
  const cardsSnapshot = await db.collection('cards').limit(5).get();
  console.log(`\nFound ${cardsSnapshot.size} cards (showing first 5):\n`);

  cardsSnapshot.forEach(doc => {
    const data = doc.data();
    console.log(`- ${data.title} (${data.type} - ${data.subtype})`);
  });

  // Get total count
  const allCardsSnapshot = await db.collection('cards').count().get();
  console.log(`\nTotal cards in Firestore: ${allCardsSnapshot.data().count}\n`);
}

verifyCards()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ Error querying Firestore:', error.message);
    console.error('This likely means Firebase is not configured or the cards collection does not exist.');
    console.error('Full error:', error);
    process.exit(1);
  });
