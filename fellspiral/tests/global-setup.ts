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

const PROJECT_ID = 'demo-test';
const QA_TEST_USER = {
  uid: 'qa-test-user-id',
  email: 'qa@test.com',
  password: 'testpassword123',
  displayName: 'QA Test User',
};

/**
 * Seed QA test user in Auth emulator (creates if not exists)
 * @throws Error if user creation fails or unexpected auth errors occur
 */
async function seedQaTestUser(admin: typeof import('firebase-admin')): Promise<void> {
  try {
    const auth = admin.auth();
    await auth.getUserByEmail(QA_TEST_USER.email);
    console.log('   ✓ QA test user already exists');
  } catch (error: unknown) {
    const errorObj = error as { code?: string; message?: string };

    if (errorObj.code === 'auth/user-not-found') {
      // Expected - user doesn't exist yet, create it
      try {
        await admin.auth().createUser(QA_TEST_USER);
        console.log(`✅ SUCCESS: Seeded QA test user (${QA_TEST_USER.email}) to Auth emulator`);
      } catch (createError: unknown) {
        // Failed to create user - this is fatal
        const createMsg = createError instanceof Error ? createError.message : String(createError);
        throw new Error(
          `Failed to create QA test user:\n` +
            `   Email: ${QA_TEST_USER.email}\n` +
            `   Error: ${createMsg}\n` +
            `   Emulator: ${process.env.FIREBASE_AUTH_EMULATOR_HOST || 'not set'}\n` +
            `   Action: Check that Firebase Auth emulator is running and healthy`
        );
      }
    } else {
      // Unexpected error - fail setup immediately
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to check QA test user (unexpected error):\n` +
          `   Email: ${QA_TEST_USER.email}\n` +
          `   Error code: ${errorObj.code || 'unknown'}\n` +
          `   Error: ${errorMsg}\n` +
          `   Emulator: ${process.env.FIREBASE_AUTH_EMULATOR_HOST || 'not set'}\n` +
          `   Common causes:\n` +
          `     - Auth emulator not running (run: ./infrastructure/scripts/start-emulators.sh)\n` +
          `     - FIREBASE_AUTH_EMULATOR_HOST not set or misconfigured\n` +
          `     - Network connectivity issues\n` +
          `   All tests requiring authentication will fail if this is not fixed.`
      );
    }
  }
}

async function globalSetup() {
  console.log('🔧 Running global test setup...');
  console.log(`   Environment: ${process.env.CI ? 'CI' : 'Local'}`);
  console.log(`   Working directory: ${process.cwd()}`);

  // Skip seeding when testing deployed site (E2E tests use production Firestore)
  if (process.env.DEPLOYED_URL) {
    console.log('Skipping data seeding - testing deployed site with production Firestore');
    console.log(`   Deployed URL: ${process.env.DEPLOYED_URL}`);
    console.log('Global setup complete (no seeding needed)');
    return;
  }

  // Firebase emulator port from shared config
  const firestoreHost = 'localhost';
  const firestorePort = FIREBASE_PORTS.firestore;

  console.log(`📦 Seeding Firestore emulator at ${firestoreHost}:${firestorePort}...`);

  // Step 1: Load cards data
  const cardsPath = join(__dirname, '../site/src/data/cards.json');
  const absoluteCardsPath = resolve(cardsPath);
  console.log(`   Checking for cards.json at: ${absoluteCardsPath}`);

  let cardsData: Array<{ id: string; [key: string]: unknown }>;
  try {
    if (!existsSync(absoluteCardsPath)) {
      throw new Error(`File not found`);
    }
    cardsData = JSON.parse(readFileSync(cardsPath, 'utf-8'));
    if (!Array.isArray(cardsData) || cardsData.length === 0) {
      throw new Error(`Invalid data: expected non-empty array, got ${typeof cardsData}`);
    }
    console.log(`   ✓ Loaded ${cardsData.length} cards from file`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to load cards data:\n` +
        `   Path: ${absoluteCardsPath}\n` +
        `   Error: ${errorMsg}\n` +
        `   Action: Ensure cards.json exists and contains a valid JSON array`
    );
  }

  // Step 2: Import Firebase Admin SDK
  console.log(`   Importing Firebase Admin SDK...`);
  let admin: typeof import('firebase-admin');
  try {
    const adminModule = await import('firebase-admin');

    // Validate that firebase-admin module loaded correctly
    if (!adminModule || !adminModule.default) {
      throw new Error(
        'Failed to import firebase-admin module - module is undefined or missing default export'
      );
    }

    admin = adminModule.default;

    // Validate admin object has required methods
    if (typeof admin.initializeApp !== 'function' || typeof admin.firestore !== 'function') {
      throw new Error(
        'firebase-admin module is missing required methods (initializeApp or firestore)'
      );
    }

    // Initialize Firebase Admin with emulator
    // Use hardcoded project ID to match browser client initialization
    // Browser client uses hardcoded 'demo-test' in firebase-config.ts
    const projectId = 'demo-test';
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId,
      });
      console.log(`   ✓ Initialized Firebase Admin (projectId: ${projectId})`);
    } else {
      console.log(`   ✓ Using existing Firebase Admin app`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to initialize Firebase Admin SDK:\n` +
        `   Error: ${errorMsg}\n` +
        `   Action: Run 'pnpm install' to install dependencies`
    );
  }

  // Step 3: Connect to Firestore emulator
  console.log(`   Connecting to Firestore emulator...`);
  let db: FirebaseFirestore.Firestore;
  let cardsCollection: FirebaseFirestore.CollectionReference;
  try {
    db = admin.firestore();
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

    cardsCollection = db.collection(collectionName);
    console.log(`   Using collection: ${collectionName}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to connect to Firestore emulator:\n` +
        `   Host: ${firestoreHost}:${firestorePort}\n` +
        `   Error: ${errorMsg}\n` +
        `   Action: Run './infrastructure/scripts/start-emulators.sh' to start emulator`
    );
  }

  // Step 4: Clear existing cards
  console.log('   Clearing existing cards from emulator...');
  try {
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
        console.log('   ✓ All existing cards cleared');
      }
    } else {
      console.log('   No existing cards found');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to clear existing cards from Firestore:\n` +
        `   Host: ${firestoreHost}:${firestorePort}\n` +
        `   Error: ${errorMsg}\n` +
        `   Action: Check Firestore emulator connectivity`
    );
  }

  // Step 5: Seed cards to Firestore
  console.log(`   Writing ${cardsData.length} cards to Firestore...`);
  try {
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
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to seed cards to Firestore:\n` +
        `   Cards count: ${cardsData.length}\n` +
        `   Host: ${firestoreHost}:${firestorePort}\n` +
        `   Error: ${errorMsg}\n` +
        `   Action: Check Firestore emulator connectivity and batch write limits`
    );
  }

  // Step 6: Seed QA test user (seedQaTestUser throws on failure)
  console.log('Seeding Auth emulator with QA test user...');
  await seedQaTestUser(admin);

  console.log('✅ Global setup complete');
}

export default globalSetup;
