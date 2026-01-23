#!/usr/bin/env node
/**
 * Seed Firestore with budget demo data from transactions.json
 *
 * Usage: node seed-firestore.js
 *
 * Uses Firebase credentials from one of:
 * - GOOGLE_APPLICATION_CREDENTIALS_JSON (inline JSON)
 * - GOOGLE_APPLICATION_CREDENTIALS (path to service account file)
 * - gcloud Application Default Credentials
 */

import { getFirestore } from 'firebase-admin/firestore';
import { initializeFirebase } from './lib/firebase-init.js';
import {
  getTransactionsCollectionName,
  getStatementsCollectionName,
  getAccountsCollectionName,
  getInstitutionsCollectionName,
} from './lib/collection-names.js';
import { loadTransactionData, validateFirestoreData } from './lib/data-loader.js';

// Initialize Firebase Admin
initializeFirebase();

let db;
try {
  db = getFirestore();
} catch (error) {
  console.error('\n❌ Failed to initialize Firestore:', error.message);
  console.error('Ensure Firestore is enabled in your Firebase project.');
  console.error('Visit: https://console.firebase.google.com/project/_/firestore');
  console.error('Full error:', error);
  process.exit(1);
}

// Load data
const data = loadTransactionData();

// Get collection names based on environment
const collectionsConfig = {
  transactions: getTransactionsCollectionName(),
  statements: getStatementsCollectionName(),
  accounts: getAccountsCollectionName(),
  institutions: getInstitutionsCollectionName(),
};

console.log(`\nUsing collections:`);
console.log(`   Transactions: ${collectionsConfig.transactions}`);
console.log(`   Statements: ${collectionsConfig.statements}`);
console.log(`   Accounts: ${collectionsConfig.accounts}`);
console.log(`   Institutions: ${collectionsConfig.institutions}`);

/**
 * Seed a collection with data
 * @param {string} collectionName - Name of the collection
 * @param {Array<Object>} items - Array of items to seed (each item must have an 'id' field)
 * @param {string} itemType - Type of item (for logging)
 * @returns {Promise<void>} Resolves when seeding is complete
 * @throws {Error} Exits process with code 1 if validation fails, Firestore errors occur, or no items are processed
 */
async function seedCollection(collectionName, items, itemType) {
  console.log(`\n📝 Seeding ${itemType}...`);

  // Validate all items before processing
  const validationErrors = [];
  for (const item of items) {
    if (!item.id) {
      validationErrors.push(`${itemType} is missing id field: ${JSON.stringify(item)}`);
    }

    // Validate Firestore compatibility
    const firestoreErrors = validateFirestoreData(item, `${itemType}[${item.id || 'unknown'}]`);
    if (firestoreErrors.length > 0) {
      validationErrors.push(...firestoreErrors);
    }
  }

  if (validationErrors.length > 0) {
    console.error(`\n❌ ${itemType} validation failed:`);
    validationErrors.forEach((err) => console.error(`  - ${err}`));
    console.error('\nFix these errors before seeding.');
    process.exit(1);
  }

  // Firestore allows up to 500 operations per batch write
  const BATCH_SIZE = 500;
  const collection = db.collection(collectionName);

  let batch = db.batch();
  let batchCount = 0;
  let batchItemIds = []; // Track items in current batch for error reporting
  let created = 0;
  let updated = 0;

  for (const item of items) {
    const docId = item.id;
    const docRef = collection.doc(docId);

    let doc;
    try {
      doc = await docRef.get();
    } catch (firestoreError) {
      console.error(
        `\n❌ Firestore error checking ${itemType} "${docId}":`,
        firestoreError.message
      );

      // Handle specific error types with contextual messages
      if (firestoreError.code === 'unavailable' || firestoreError.code === 'deadline-exceeded') {
        console.error('Network or timeout error. Aborting to prevent data loss.');
        console.error('Please retry the operation.');
        process.exit(1);
      } else if (firestoreError.code === 'permission-denied') {
        console.error(
          'Permission error. Check Firebase security rules and service account permissions.'
        );
        process.exit(1);
      } else {
        console.error('Unexpected Firestore error. Aborting to prevent data inconsistency.');
        console.error('Full error:', firestoreError);
        process.exit(1);
      }
    }

    if (doc.exists) {
      // Update existing item (preserve createdAt, update updatedAt timestamp)
      const existingCreatedAt = doc.data().createdAt || null;

      batch.update(docRef, {
        ...item,
        createdAt: existingCreatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      updated++;
      console.log(`  ✓ Updating: ${docId}`);
    } else {
      // Create new item
      batch.set(docRef, {
        ...item,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      created++;
      console.log(`  + Creating: ${docId}`);
    }

    batchCount++;
    batchItemIds.push(docId);

    // Commit batch if we've reached the batch size limit
    if (batchCount >= BATCH_SIZE) {
      try {
        await batch.commit();
        console.log(`  Committed batch of ${batchCount} operations`);
      } catch (error) {
        console.error(`\n❌ Error committing batch write to Firestore:`, error.message);
        console.error(`Attempted to write ${batchCount} operations`);
        console.error(`Items in failed batch: ${batchItemIds.join(', ')}`);
        console.error('This likely means a Firebase permission or quota issue.');
        console.error('Full error:', error);
        process.exit(1);
      }
      batch = db.batch();
      batchCount = 0;
      batchItemIds = [];
    }
  }

  // Check if any items were processed
  if (created === 0 && updated === 0) {
    console.error(`\n❌ No ${itemType} were processed successfully.`);
    console.error('This indicates a systemic problem with data or Firestore connection.');
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
      console.error(`Items in failed batch: ${batchItemIds.join(', ')}`);
      console.error('This likely means a Firebase permission or quota issue.');
      console.error('Full error:', error);
      process.exit(1);
    }
  }

  console.log(`\n✅ ${itemType} seeding complete!`);
  console.log(`   Created: ${created}`);
  console.log(`   Updated: ${updated}`);
}

// Seed all collections
async function seedAllCollections() {
  // Seed in order: institutions -> accounts -> statements -> transactions
  // This ensures referential integrity
  await seedCollection(collectionsConfig.institutions, data.institutions, 'institutions');
  await seedCollection(collectionsConfig.accounts, data.accounts, 'accounts');
  await seedCollection(collectionsConfig.statements, data.statements, 'statements');
  await seedCollection(collectionsConfig.transactions, data.transactions, 'transactions');
}

// Run seeding
seedAllCollections()
  .then(() => {
    console.log('\n✨ All collections seeded successfully!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error during seeding:');

    // Categorize error types to help with debugging
    if (error.code && error.code.startsWith('auth/')) {
      console.error('Authentication error:', error.message);
      console.error(
        'Check that your Firebase credentials are valid and have the correct permissions.'
      );
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
