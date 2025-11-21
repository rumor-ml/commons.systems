#!/usr/bin/env node
/**
 * Seed Firestore with cards from rules.md
 *
 * Usage: node seed-firestore.js
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS environment variable
 * or GOOGLE_APPLICATION_CREDENTIALS_JSON for JSON credentials
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin
let serviceAccount;

if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  // Parse credentials from JSON string (used in CI/CD)
  serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  // Load from file path
  serviceAccount = JSON.parse(
    readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')
  );
} else {
  console.error('Error: GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS_JSON not set');
  process.exit(1);
}

initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id
});

const db = getFirestore();

// Load cards from parsed rules.md
const cardsPath = join(__dirname, '../site/src/data/cards.json');
const cards = JSON.parse(readFileSync(cardsPath, 'utf8'));

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
      // Use title as document ID (sanitized)
      const docId = card.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
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
    console.error(`\n❌ Error committing batch:`, error);
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
