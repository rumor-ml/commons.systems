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

  // Get emulator host from environment or use default
  // Use 127.0.0.1 instead of localhost to avoid IPv6 ::1 which sandbox blocks
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8081';
  const [host, port] = firestoreHost.split(':');

  console.log(`📦 Seeding Firestore emulator at ${firestoreHost}...`);

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
    const admin = adminModule.default;

    // CRITICAL: Delete GOOGLE_APPLICATION_CREDENTIALS when using emulator
    // In CI, this env var points to a service account key file. Firebase Admin SDK
    // tries to load it BEFORE checking if we're connecting to an emulator, causing
    // invalid custom tokens. The emulator doesn't need credentials.
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log('   ⚠️  Removing GOOGLE_APPLICATION_CREDENTIALS to use emulator');
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }

    // Initialize Firebase Admin with emulator
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId: 'demo-test',
      });
      console.log(`   ✓ Initialized Firebase Admin (projectId: demo-test)`);
    } else {
      console.log(`   ✓ Using existing Firebase Admin app`);
    }

    // Connect to Firestore emulator
    const db = admin.firestore();
    db.settings({
      host: `${host}:${port}`,
      ssl: false,
    });
    console.log(`   ✓ Connected to Firestore emulator at ${host}:${port}`);

    const collectionName = getCardsCollectionName();
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

    await batch.commit();

    console.log(`✅ SUCCESS: Seeded ${cardsData.length} cards to Firestore`);

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
