/**
 * Playwright Global Setup
 * Runs once before all tests to seed Firestore emulator with test data
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getCardsCollectionName } from '../scripts/lib/collection-names.js';

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

  // Track setup state for debugging partial failures
  const setupState = {
    cardsLoaded: false,
    adminImported: false,
    adminInitialized: false,
    firestoreConnected: false,
    existingCardsCleared: false,
    cardsSeeded: false,
    qaUserSeeded: false,
  };

  // Get emulator host from environment or use default
  // Use 127.0.0.1 instead of localhost to avoid IPv6 ::1 which sandbox blocks
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8081';
  const [host, port] = firestoreHost.split(':');

  console.log(`Seeding Firestore emulator at ${firestoreHost}...`);

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
    setupState.cardsLoaded = true;
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
    admin = adminModule.default;
    setupState.adminImported = true;
    console.log(`   ✓ Imported firebase-admin`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to import firebase-admin:\n` +
        `   Error: ${errorMsg}\n` +
        `   Setup state: ${JSON.stringify(setupState)}\n` +
        `   Action: Run 'pnpm install' to install dependencies`
    );
  }

  // Step 3: Initialize Firebase Admin
  console.log(`   Initializing Firebase Admin...`);
  try {
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: PROJECT_ID });
      console.log(`   ✓ Initialized Firebase Admin (projectId: ${PROJECT_ID})`);
    } else {
      console.log(`   ✓ Using existing Firebase Admin app`);
    }
    setupState.adminInitialized = true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to initialize Firebase Admin SDK:\n` +
        `   Project ID: ${PROJECT_ID}\n` +
        `   Error: ${errorMsg}\n` +
        `   Setup state: ${JSON.stringify(setupState)}\n` +
        `   Action: Check Firebase Admin SDK installation`
    );
  }

  // Step 4: Connect to Firestore emulator
  console.log(`   Connecting to Firestore emulator...`);
  let db: FirebaseFirestore.Firestore;
  let cardsCollection: FirebaseFirestore.CollectionReference;
  try {
    db = admin.firestore();
    db.settings({
      host: `${host}:${port}`,
      ssl: false,
    });
    const collectionName = getCardsCollectionName();
    cardsCollection = db.collection(collectionName);
    setupState.firestoreConnected = true;
    console.log(`   ✓ Connected to Firestore emulator at ${host}:${port}`);
    console.log(`   Using collection: ${collectionName}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to connect to Firestore emulator:\n` +
        `   Host: ${firestoreHost}\n` +
        `   Error: ${errorMsg}\n` +
        `   Setup state: ${JSON.stringify(setupState)}\n` +
        `   Action: Run './infrastructure/scripts/start-emulators.sh' to start emulator`
    );
  }

  // Step 5: Clear existing cards
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
    setupState.existingCardsCleared = true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to clear existing cards from Firestore:\n` +
        `   Host: ${firestoreHost}\n` +
        `   Error: ${errorMsg}\n` +
        `   Setup state: ${JSON.stringify(setupState)}\n` +
        `   Action: Check Firestore emulator connectivity`
    );
  }

  // Step 6: Seed cards to Firestore
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
    await batch.commit();
    setupState.cardsSeeded = true;
    console.log(`SUCCESS: Seeded ${cardsData.length} cards to Firestore`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to seed cards to Firestore:\n` +
        `   Cards count: ${cardsData.length}\n` +
        `   Host: ${firestoreHost}\n` +
        `   Error: ${errorMsg}\n` +
        `   Setup state: ${JSON.stringify(setupState)}\n` +
        `   Action: Check Firestore emulator connectivity and batch write limits`
    );
  }

  // Step 7: Seed QA test user (seedQaTestUser throws on failure)
  console.log('Seeding Auth emulator with QA test user...');
  try {
    await seedQaTestUser(admin);
    setupState.qaUserSeeded = true;
  } catch (error) {
    // Re-throw with setup state context
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`${errorMsg}\n` + `   Setup state: ${JSON.stringify(setupState)}`);
  }

  console.log('Global setup complete');
  console.log(`   Final state: ${JSON.stringify(setupState)}`);
}

export default globalSetup;
