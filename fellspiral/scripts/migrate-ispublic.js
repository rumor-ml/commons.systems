#!/usr/bin/env node

/**
 * Migration script to backfill isPublic field on existing cards
 *
 * Context: PR #244 adds isPublic field requirement to Firestore security rules.
 * Existing cards without this field will become unreadable after rule deployment.
 *
 * This script:
 * 1. Queries all cards in the main collection
 * 2. Identifies cards missing the isPublic field
 * 3. Updates them with isPublic: true (maintains existing behavior)
 *
 * Usage:
 *   node fellspiral/scripts/migrate-ispublic.js [--dry-run]
 *
 * Options:
 *   --dry-run    Show what would be updated without making changes
 *
 * Prerequisites:
 *   - Firebase Admin SDK credentials configured (GOOGLE_APPLICATION_CREDENTIALS env var)
 *   - Or run with: firebase-admin permissions
 */

import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// Initialize Firebase Admin
let app;
try {
  // Try to use existing app or initialize from service account
  app = admin.app();
} catch (error) {
  // Initialize new app
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (serviceAccountPath) {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    console.error('ERROR: GOOGLE_APPLICATION_CREDENTIALS environment variable not set');
    console.error('Please set it to point to your Firebase service account JSON file');
    process.exit(1);
  }
}

const db = admin.firestore();

/**
 * Migrate cards collection to add isPublic field
 */
async function migrateCards() {
  console.log('Starting isPublic field migration...');
  console.log(
    dryRun ? 'MODE: DRY RUN (no changes will be made)\n' : 'MODE: LIVE (changes will be applied)\n'
  );

  const cardsRef = db.collection('cards');

  try {
    // Get all cards (no query filter - we need to check all cards)
    const snapshot = await cardsRef.get();

    console.log(`Found ${snapshot.size} total cards in collection`);

    const cardsNeedingUpdate = [];
    const cardsAlreadyHaveField = [];

    // Identify cards needing migration
    snapshot.forEach((doc) => {
      const data = doc.data();

      if (data.isPublic === undefined) {
        cardsNeedingUpdate.push({
          id: doc.id,
          title: data.title || '(untitled)',
          createdBy: data.createdBy || '(unknown)',
        });
      } else {
        cardsAlreadyHaveField.push(doc.id);
      }
    });

    console.log(`\nCards already with isPublic field: ${cardsAlreadyHaveField.length}`);
    console.log(`Cards needing migration: ${cardsNeedingUpdate.length}\n`);

    if (cardsNeedingUpdate.length === 0) {
      console.log('✅ No cards need migration. All cards already have isPublic field.');
      return;
    }

    // Show cards that will be updated
    console.log('Cards to update:');
    cardsNeedingUpdate.forEach((card, index) => {
      console.log(`  ${index + 1}. ${card.id} - "${card.title}" (created by: ${card.createdBy})`);
    });
    console.log('');

    if (dryRun) {
      console.log('DRY RUN: No changes made. Run without --dry-run to apply changes.');
      return;
    }

    // Perform migration using batch updates
    const batchSize = 500; // Firestore batch limit
    let updatedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < cardsNeedingUpdate.length; i += batchSize) {
      const batch = db.batch();
      const batchCards = cardsNeedingUpdate.slice(i, i + batchSize);

      batchCards.forEach((card) => {
        const docRef = cardsRef.doc(card.id);
        batch.update(docRef, {
          isPublic: true,
          // Add migration metadata for audit trail
          _migratedIsPublic: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      try {
        await batch.commit();
        updatedCount += batchCards.length;
        console.log(`Updated batch ${Math.floor(i / batchSize) + 1}: ${batchCards.length} cards`);
      } catch (error) {
        errorCount += batchCards.length;
        console.error(`Error updating batch ${Math.floor(i / batchSize) + 1}:`, error.message);
      }
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`  Updated: ${updatedCount} cards`);
    if (errorCount > 0) {
      console.log(`  Errors: ${errorCount} cards`);
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateCards()
  .then(() => {
    console.log('\nMigration script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
