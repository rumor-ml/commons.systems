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
  // Use 127.0.0.1 explicitly to avoid IPv6 connection issues (::1)
  // Some systems/browsers may have permission issues connecting to IPv6 localhost
  const firestoreHost = '127.0.0.1';
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

    // Validate that test data contains all required card types
    // Note: Only require types that are actually tested (Foe is in VALID_CARD_TYPES but not tested)
    const requiredTypes = ['Equipment', 'Skill', 'Upgrade', 'Origin'];
    const typeCount = {};

    cardsData.forEach((card) => {
      const type = card.type || 'Unknown';
      typeCount[type] = (typeCount[type] || 0) + 1;
    });

    // Fail fast if test data is incomplete
    const missingTypes = [];
    for (const type of requiredTypes) {
      if (!typeCount[type] || typeCount[type] === 0) {
        missingTypes.push(type);
      }
    }

    if (missingTypes.length > 0) {
      throw new Error(
        `Test data missing required card types: ${missingTypes.join(', ')}. ` +
          `Found types: ${Object.keys(typeCount).join(', ')}`
      );
    }

    console.log(`   ✓ Verified test data contains all required types:`);
    requiredTypes.forEach((type) => {
      console.log(`     - ${type}: ${typeCount[type]} cards`);
    });

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
        // For emulator: bypass security rules by setting auth variable override
        // This allows Admin SDK to write test data without authentication
        databaseAuthVariableOverride: null,
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

    // Determine number of workers for parallel test execution
    // Limit to 2 workers for stability (balances speed vs resource usage)
    const workerCount = 2;
    console.log(`   Seeding collections for ${workerCount} worker(s)...`);

    // Helper function to validate and seed a collection
    async function seedWorkerCollection(
      db: any,
      admin: any,
      collectionName: string,
      cardsData: any[]
    ) {
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

      // Clear existing cards data to ensure fresh state
      const existingCards = await cardsCollection.get();

      if (!existingCards.empty) {
        const deleteBatch = db.batch();
        let deleteCount = 0;
        existingCards.docs.forEach((doc: any) => {
          deleteBatch.delete(doc.ref);
          deleteCount++;
        });
        await deleteBatch.commit();
        console.log(`     Deleted ${deleteCount} existing cards from ${collectionName}`);
      }

      // Batch write cards to Firestore
      const batch = db.batch();

      for (const card of cardsData) {
        const docRef = cardsCollection.doc(card.id);
        batch.set(docRef, {
          ...card,
          isPublic: true, // Required by security rules for READ access
          createdBy: 'qa-test-user-id', // Match the QA test user created in Auth emulator
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

      if (batchWriteResult.length === 0) {
        throw new Error(
          'Batch write completed but no write results returned - expected results for all operations'
        );
      }

      if (batchWriteResult.length !== cardsData.length) {
        throw new Error(
          `Batch write mismatch: wrote ${batchWriteResult.length} documents but expected ${cardsData.length}`
        );
      }

      // Verify all documents were actually written
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

      console.log(`     ✓ Seeded ${verifyWritten.size} cards to ${collectionName}`);
    }

    // Seed collections for all workers in parallel
    const seedPromises = [];
    for (let workerId = 0; workerId < workerCount; workerId++) {
      // Temporarily set TEST_PARALLEL_INDEX to get correct collection name for this worker
      const originalIndex = process.env.TEST_PARALLEL_INDEX;
      process.env.TEST_PARALLEL_INDEX = String(workerId);
      const collectionName = getCardsCollectionName();
      process.env.TEST_PARALLEL_INDEX = originalIndex; // Restore original value

      console.log(`   Seeding worker ${workerId} collection: ${collectionName}`);
      seedPromises.push(seedWorkerCollection(db, admin, collectionName, cardsData));
    }

    await Promise.all(seedPromises);
    console.log(
      `✅ SUCCESS: Seeded ${cardsData.length} cards to ${workerCount} worker collection(s)`
    );

    // Seed QA test user in Auth emulator
    console.log('📦 Seeding Auth emulator with QA test user...');

    try {
      // Use Firebase Admin SDK to create test user in Auth emulator
      const auth = admin.auth();

      try {
        // Check if user already exists
        await auth.getUserByEmail('qa@test.com');
        console.log('   ✓ QA test user already exists');
      } catch (error) {
        // User doesn't exist, create it
        await auth.createUser({
          uid: 'qa-test-user-id',
          email: 'qa@test.com',
          password: 'testpassword123',
          displayName: 'QA Test User',
        });
        console.log('✅ SUCCESS: Seeded QA test user (qa@test.com) to Auth emulator');
      }
    } catch (authError) {
      console.warn(
        '⚠️  WARNING: Failed to seed QA test user:',
        authError instanceof Error ? authError.message : String(authError)
      );
    }

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
