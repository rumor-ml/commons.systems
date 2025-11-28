#!/usr/bin/env node
/**
 * Seed Firestore with cards from rules.md
 *
 * Usage: node seed-firestore.js
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS environment variable
 * or GOOGLE_APPLICATION_CREDENTIALS_JSON for JSON credentials
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Load cards from parsed rules.md
const cardsPath = join(__dirname, '../site/src/data/cards.json');
let cards;
try {
  const cardsContent = readFileSync(cardsPath, 'utf8');
  cards = JSON.parse(cardsContent);
} catch (error) {
  console.error(`\n❌ Failed to load cards from ${cardsPath}:`, error.message);
  console.error('Run "node scripts/parse-cards.js" first to generate cards.json');
  process.exit(1);
}

console.log(`\n📦 Seeding Firestore with ${cards.length} cards from rules.md\n`);

// Seed cards to Firestore
async function seedCards() {
  const batch = db.batch();
  const cardsCollection = db.collection('cards');

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const card of cards) {
    try {
      // Use card.id (already sanitized during parsing)
      const docId = card.id;
      const cardRef = cardsCollection.doc(docId);

      // Check if card exists
      const cardDoc = await cardRef.get();

      if (cardDoc.exists) {
        // Update existing card
        batch.update(cardRef, {
          ...card,
          updatedAt: new Date().toISOString()
        });
        updated++;
        console.log(`  ✓ Updating: ${card.title}`);
      } else {
        // Create new card
        batch.set(cardRef, {
          ...card,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        created++;
        console.log(`  + Creating: ${card.title}`);
      }
    } catch (error) {
      console.error(`  ✗ Error processing "${card.title}":`, error.message);
      console.error('Stack trace:', error.stack);
      skipped++;
    }
  }

  // Commit batch
  try {
    await batch.commit();
    console.log(`\n✅ Seeding complete!`);
    console.log(`   Created: ${created}`);
    console.log(`   Updated: ${updated}`);
    if (skipped > 0) {
      console.log(`   Skipped: ${skipped}`);
    }
  } catch (error) {
    console.error(`\n❌ Error committing batch write to Firestore:`, error.message);
    console.error('This likely means a Firebase permission or quota issue.');
    console.error('Full error:', error);
    process.exit(1);
  }
}

// Run seeding
seedCards()
  .then(() => {
    console.log('\n✨ Done!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
