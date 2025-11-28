#!/usr/bin/env node
/**
 * Seed Firestore with cards from rules.md
 *
 * Usage: node seed-firestore.js
 *
 * Uses Firebase credentials from one of:
 * - GOOGLE_APPLICATION_CREDENTIALS_JSON (inline JSON)
 * - GOOGLE_APPLICATION_CREDENTIALS (path to service account file)
 * - gcloud Application Default Credentials
 */

import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeFirebase } from './lib/firebase-init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

  if (error.code === 'ENOENT') {
    console.error('The cards.json file does not exist.');
    console.error('Run "node scripts/parse-cards.js" first to generate cards.json');
  } else if (error instanceof SyntaxError) {
    console.error('The cards.json file contains invalid JSON.');
    console.error('Try regenerating it with "node scripts/parse-cards.js"');
  } else {
    console.error('Ensure the file exists and is readable.');
  }

  process.exit(1);
}

console.log(`\n📦 Seeding Firestore with ${cards.length} cards from rules.md\n`);

// Seed cards to Firestore
async function seedCards() {
  // Validate all cards before processing
  const validationErrors = [];
  for (const card of cards) {
    if (!card.id) {
      validationErrors.push(`Card "${card.title || 'unknown'}" is missing id field`);
    }
    if (!card.title) {
      validationErrors.push(`Card with id "${card.id || 'unknown'}" is missing title field`);
    }
  }

  if (validationErrors.length > 0) {
    console.error('\n❌ Card validation failed:');
    validationErrors.forEach(err => console.error(`  - ${err}`));
    console.error('\nFix these errors before seeding.');
    process.exit(1);
  }

  const BATCH_SIZE = 500;
  const cardsCollection = db.collection('cards');

  let batch = db.batch();
  let batchCount = 0;
  let created = 0;
  let updated = 0;

  for (const card of cards) {
    // Use card.id (already sanitized during parsing)
    const docId = card.id;
    const cardRef = cardsCollection.doc(docId);

    // Separate error handling for Firestore read operation
    let cardDoc;
    try {
      cardDoc = await cardRef.get();
    } catch (firestoreError) {
      console.error(`\n❌ Firestore error checking card "${card.title}":`, firestoreError.message);

      // Categorize the error
      if (firestoreError.code === 'unavailable' || firestoreError.code === 'deadline-exceeded') {
        console.error('Network or timeout error. Aborting to prevent data loss.');
        console.error('Please retry the operation.');
        process.exit(1);
      } else if (firestoreError.code === 'permission-denied') {
        console.error('Permission error. Check Firebase security rules and service account permissions.');
        process.exit(1);
      } else {
        console.error('Unexpected Firestore error. Aborting to prevent data inconsistency.');
        console.error('Full error:', firestoreError);
        process.exit(1);
      }
    }

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

    batchCount++;

    // Commit batch if we've reached the batch size limit
    if (batchCount >= BATCH_SIZE) {
      try {
        await batch.commit();
        console.log(`  Committed batch of ${batchCount} operations`);
      } catch (error) {
        console.error(`\n❌ Error committing batch write to Firestore:`, error.message);
        console.error(`Attempted to write ${batchCount} operations`);
        console.error('This likely means a Firebase permission or quota issue.');
        console.error('Full error:', error);
        process.exit(1);
      }
      batch = db.batch();
      batchCount = 0;
    }
  }

  // Check if any cards were processed
  if (created === 0 && updated === 0) {
    console.error(`\n❌ No cards were processed successfully.`);
    console.error('This indicates a systemic problem with card data or Firestore connection.');
    process.exit(1);
  }

  // Commit remaining batch
  if (batchCount > 0) {
    try {
      await batch.commit();
      console.log(`  Committed final batch of ${batchCount} operations`);
    } catch (error) {
      console.error(`\n❌ Error committing final batch write to Firestore:`, error.message);
      console.error(`Attempted to write ${batchCount} operations`);
      console.error('This likely means a Firebase permission or quota issue.');
      console.error('Full error:', error);
      process.exit(1);
    }
  }

  console.log(`\n✅ Seeding complete!`);
  console.log(`   Created: ${created}`);
  console.log(`   Updated: ${updated}`);
}

// Run seeding
seedCards()
  .then(() => {
    console.log('\n✨ Done!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error during seeding:');

    // Categorize error types to help with debugging
    if (error.code && error.code.startsWith('auth/')) {
      console.error('Authentication error:', error.message);
      console.error('Check that your Firebase credentials are valid and have the correct permissions.');
    } else if (error.code && error.code.includes('permission-denied')) {
      console.error('Permission denied:', error.message);
      console.error('Check your Firestore security rules and service account permissions.');
    } else if (error.message && error.message.includes('ECONNREFUSED')) {
      console.error('Network error:', error.message);
      console.error('Check your internet connection and Firebase project settings.');
    } else if (error instanceof TypeError || error instanceof ReferenceError) {
      console.error('JavaScript error:', error.message);
      console.error('This is likely a bug in the script. Stack trace:');
      console.error(error.stack);
    } else {
      console.error('Unknown error:', error.message);
      console.error('Full error:', error);
    }

    process.exit(1);
  });
