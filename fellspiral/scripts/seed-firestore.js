#!/usr/bin/env node
/**
 * Seed Firestore with cards from rules.md
 *
 * Usage: node seed-firestore.js
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS environment variable
 * or GOOGLE_APPLICATION_CREDENTIALS_JSON for JSON credentials
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

      // Check if card exists (with nested try/catch for Firestore operations)
      let cardDoc;
      try {
        cardDoc = await cardRef.get();
      } catch (firestoreError) {
        console.error(`  ✗ Firestore error checking "${card.title}":`, firestoreError.message);
        console.error('This likely means a network or permission issue.');
        skipped++;
        continue;
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
