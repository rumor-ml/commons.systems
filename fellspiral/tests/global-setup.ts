/**
 * Playwright Global Setup
 * Runs once before all tests to seed Firestore emulator with test data
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getCardsCollectionName } from '../scripts/lib/collection-names.js';
import { FIREBASE_PORTS } from '../../shared/config/firebase-ports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function globalSetup() {
  console.log('🔧 Running global test setup...');
  console.log(`   Environment: ${process.env.CI ? 'CI' : 'Local'}`);
  console.log(`   Working directory: ${process.cwd()}`);

  // Skip seeding when testing deployed site (E2E tests use production Firestore)
  if (process.env.DEPLOYED_URL) {
    console.log('⏭️  Skipping data seeding - testing deployed site with production Firestore');
    console.log(`   Deployed URL: ${process.env.DEPLOYED_URL}`);
    console.log('✅ Global setup complete (no seeding needed)');
    return;
  }

  // Firebase emulator port from shared config
  const firestoreHost = 'localhost';
  const firestorePort = FIREBASE_PORTS.firestore;

  console.log(`📦 Seeding Firestore emulator at ${firestoreHost}:${firestorePort}...`);

  try {
    // Load cards data with detailed path logging
    const cardsPath = join(__dirname, '../site/src/data/cards.json');
    const absoluteCardsPath = resolve(cardsPath);

    console.log(`   Checking for cards.json at: ${absoluteCardsPath}`);

    if (!existsSync(absoluteCardsPath)) {
      throw new Error(`cards.json not found at ${absoluteCardsPath}`);
    }

    console.log(`   ✓ Found cards.json file`);

    const cardsData = JSON.parse(readFileSync(cardsPath, 'utf-8'));

    if (!Array.isArray(cardsData) || cardsData.length === 0) {
      throw new Error(`Invalid cards data: expected non-empty array, got ${typeof cardsData}`);
    }

    console.log(`   ✓ Loaded ${cardsData.length} cards from file`);

    // Import Firestore Admin SDK
    console.log(`   Connecting to Firestore Admin SDK...`);
    const adminModule = await import('firebase-admin');

    // Validate that firebase-admin module loaded correctly
    if (!adminModule || !adminModule.default) {
      throw new Error(
        'Failed to import firebase-admin module - module is undefined or missing default export'
      );
    }

    const admin = adminModule.default;

    // Validate admin object has required methods
    if (typeof admin.initializeApp !== 'function' || typeof admin.firestore !== 'function') {
      throw new Error(
        'firebase-admin module is missing required methods (initializeApp or firestore)'
      );
    }

    // Initialize Firebase Admin with emulator
    // Use per-worktree project ID for data isolation
    // Integration tests in infrastructure/scripts/tests/firestore-isolation.test.sh verify
    // that different project IDs correctly isolate Firestore data when using the same emulator.
    const projectId = process.env.GCP_PROJECT_ID || 'demo-test';
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId,
      });
      console.log(`   ✓ Initialized Firebase Admin (projectId: ${projectId})`);
    } else {
      console.log(`   ✓ Using existing Firebase Admin app`);
    }

    // Connect to Firestore emulator
    const db = admin.firestore();
    db.settings({
      host: `${firestoreHost}:${firestorePort}`,
      ssl: false,
    });
    console.log(`   ✓ Connected to Firestore emulator at ${firestoreHost}:${firestorePort}`);

    const collectionName = getCardsCollectionName();

    // Validate collection name is not empty or invalid
    if (!collectionName || typeof collectionName !== 'string' || collectionName.trim() === '') {
      throw new Error(
        'Invalid collection name returned from getCardsCollectionName() - expected non-empty string'
      );
    }

    // Validate collection name format (Firestore requires specific format)
    // Collection names must not contain: / \ . (anywhere), start/end with __, or be longer than 1500 bytes
    if (
      collectionName.includes('/') ||
      collectionName.includes('\\') ||
      collectionName.includes('.')
    ) {
      throw new Error(
        `Invalid collection name format: "${collectionName}" - cannot contain / \\ or .`
      );
    }

    if (collectionName.startsWith('__') || collectionName.endsWith('__')) {
      throw new Error(
        `Invalid collection name format: "${collectionName}" - cannot start or end with __`
      );
    }

    if (Buffer.byteLength(collectionName, 'utf8') > 1500) {
      throw new Error(`Invalid collection name: "${collectionName}" - exceeds 1500 bytes`);
    }

    const cardsCollection = db.collection(collectionName);
    console.log(`   Using collection: ${collectionName}`);

    // Clear existing cards data to ensure fresh state
    console.log('   Clearing existing cards from emulator...');
    const existingCards = await cardsCollection.get();

    if (!existingCards.empty) {
      const deleteBatch = db.batch();
      let deleteCount = 0;
      existingCards.docs.forEach((doc) => {
        deleteBatch.delete(doc.ref);
        deleteCount++;
      });
      await deleteBatch.commit();
      console.log(`   Deleted ${deleteCount} existing cards`);

      // Verify deletion was successful
      const verifyCards = await cardsCollection.get();
      if (!verifyCards.empty) {
        console.warn(`   WARNING: Still ${verifyCards.size} cards after deletion!`);
      } else {
        console.log('   Verified: All existing cards cleared');
      }
    } else {
      console.log('   No existing cards found');
    }

    // Batch write cards to Firestore
    console.log(`   Writing ${cardsData.length} cards to Firestore...`);
    const batch = db.batch();

    for (const card of cardsData) {
      const docRef = cardsCollection.doc(card.id);
      batch.set(docRef, {
        ...card,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Commit batch and validate the write succeeded
    const batchWriteResult = await batch.commit();

    // Validate batch write result
    if (!batchWriteResult || !Array.isArray(batchWriteResult)) {
      throw new Error(
        'Batch write returned invalid result - expected array of WriteResult objects'
      );
    }

    // Firestore batch.commit() returns array of WriteResult, one per operation
    // Empty array would indicate no writes occurred
    if (batchWriteResult.length === 0) {
      throw new Error(
        'Batch write completed but no write results returned - expected results for all operations'
      );
    }

    // Expected number of writes should match number of cards
    if (batchWriteResult.length !== cardsData.length) {
      throw new Error(
        `Batch write mismatch: wrote ${batchWriteResult.length} documents but expected ${cardsData.length}`
      );
    }

    // Verify all documents were actually written by querying the collection
    console.log('   Verifying batch write success...');
    const verifyWritten = await cardsCollection.get();

    if (verifyWritten.empty) {
      throw new Error(
        'Batch write verification failed - no documents found in collection after write'
      );
    }

    if (verifyWritten.size !== cardsData.length) {
      throw new Error(
        `Batch write verification failed - found ${verifyWritten.size} documents but expected ${cardsData.length}`
      );
    }

    console.log(`   ✓ Verified ${verifyWritten.size} cards written successfully`);
    console.log(`✅ SUCCESS: Seeded ${cardsData.length} cards to Firestore`);
    console.log('✅ Global setup complete');
  } catch (error) {
    console.error('❌ FAILURE: Error during global setup');
    console.error('   Error details:', error);
    console.error('   Error message:', error instanceof Error ? error.message : String(error));
    console.error(
      '   Error stack:',
      error instanceof Error ? error.stack : 'No stack trace available'
    );

    // Don't fail setup silently - throw the error to make it visible
    throw new Error(
      `Global setup failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export default globalSetup;
