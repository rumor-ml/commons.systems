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
 *   - GOOGLE_APPLICATION_CREDENTIALS environment variable set to service account JSON path
 *   - Service account must have Firestore write permissions for the target project
 */

import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Firestore batch size limit */
export const BATCH_SIZE = 500;

/**
 * Identify cards that need migration (missing isPublic field)
 * @param {Object[]} cards - Array of card documents with id and data() method
 * @returns {{ cardsNeedingUpdate: Object[], cardsAlreadyHaveField: string[] }}
 */
export function identifyCardsNeedingMigration(cards) {
  const cardsNeedingUpdate = [];
  const cardsAlreadyHaveField = [];

  cards.forEach((doc) => {
    const data = typeof doc.data === 'function' ? doc.data() : doc;
    const id = doc.id;

    if (data.isPublic === undefined) {
      cardsNeedingUpdate.push({
        id,
        title: data.title || '(untitled)',
        createdBy: data.createdBy || '(unknown)',
      });
    } else {
      cardsAlreadyHaveField.push(id);
    }
  });

  return { cardsNeedingUpdate, cardsAlreadyHaveField };
}

/**
 * Split cards into batches for Firestore batch writes
 * @param {Object[]} cards - Array of card objects to batch
 * @param {number} batchSize - Maximum batch size (default: BATCH_SIZE)
 * @returns {Object[][]} - Array of card arrays, each at most batchSize length
 */
export function splitIntoBatches(cards, batchSize = BATCH_SIZE) {
  const batches = [];
  for (let i = 0; i < cards.length; i += batchSize) {
    batches.push(cards.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Execute batch migration with fail-fast error handling
 * @param {Object} db - Firestore database instance
 * @param {Object} cardsRef - Firestore collection reference
 * @param {Object[]} cardsNeedingUpdate - Cards to update
 * @param {Object} options - Migration options
 * @param {boolean} options.dryRun - If true, don't actually write to database
 * @param {Function} options.getServerTimestamp - Function returning server timestamp
 * @returns {Promise<{ success: boolean, updatedCount: number, error?: Error, failedBatchNum?: number }>}
 */
export async function executeBatchMigration(db, cardsRef, cardsNeedingUpdate, options = {}) {
  const {
    dryRun = false,
    getServerTimestamp = () => admin.firestore.FieldValue.serverTimestamp(),
  } = options;

  if (dryRun) {
    return { success: true, updatedCount: 0, dryRun: true };
  }

  const batches = splitIntoBatches(cardsNeedingUpdate);
  let updatedCount = 0;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batchCards = batches[batchIndex];
    const batchNum = batchIndex + 1;
    const batch = db.batch();

    batchCards.forEach((card) => {
      const docRef = cardsRef.doc(card.id);
      batch.update(docRef, {
        isPublic: true,
        _migratedIsPublic: getServerTimestamp(),
      });
    });

    try {
      await batch.commit();
      updatedCount += batchCards.length;
    } catch (error) {
      return {
        success: false,
        updatedCount,
        error,
        failedBatchNum: batchNum,
        failedCardIds: batchCards.map((c) => c.id),
      };
    }
  }

  return { success: true, updatedCount };
}

// Only run main script logic when executed directly (not imported for testing)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
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
      dryRun
        ? 'MODE: DRY RUN (no changes will be made)\n'
        : 'MODE: LIVE (changes will be applied)\n'
    );

    const cardsRef = db.collection('cards');

    try {
      // DEPLOYMENT SEQUENCE (CRITICAL - follow this order to prevent data access issues):
      // 1. Run THIS migration script to backfill isPublic on existing cards
      // 2. Verify migration completed successfully (all cards now have isPublic field)
      // 3. Deploy NEW security rules (require isPublic field)
      // If migration fails mid-way, DO NOT deploy security rules until ALL cards are migrated
      // Get all cards (no query filter - we need to check all cards)
      const snapshot = await cardsRef.get();

      console.log(`Found ${snapshot.size} total cards in collection`);

      // Use exported function for card identification
      const cards = [];
      snapshot.forEach((doc) => cards.push(doc));
      const { cardsNeedingUpdate, cardsAlreadyHaveField } = identifyCardsNeedingMigration(cards);

      console.log(`\nCards already with isPublic field: ${cardsAlreadyHaveField.length}`);
      console.log(`Cards needing migration: ${cardsNeedingUpdate.length}\n`);

      if (cardsNeedingUpdate.length === 0) {
        console.log('No cards need migration. All cards already have isPublic field.');
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

      // Use exported function for batch migration
      const result = await executeBatchMigration(db, cardsRef, cardsNeedingUpdate, {
        dryRun,
        getServerTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
      });

      if (!result.success) {
        // Stop immediately on first batch failure to prevent inconsistent database state
        console.error(
          `\nCRITICAL: Batch ${result.failedBatchNum} FAILED - Migration stopped immediately!`,
          {
            error: result.error?.message || String(result.error),
            code: result.error?.code || 'UNKNOWN',
            cardIds: result.failedCardIds,
          }
        );
        console.error('\nDATABASE STATE IS INCONSISTENT:');
        console.error(`  Successfully updated: ${result.updatedCount} cards`);
        console.error(`  Failed batch: batch ${result.failedBatchNum}`);
        console.error('\nDO NOT DEPLOY security rules until ALL batches succeed!');
        console.error('  Fix the error and re-run this script.');
        process.exit(1);
      }

      console.log(`\nMigration complete! All ${result.updatedCount} cards updated successfully.`);
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
}
