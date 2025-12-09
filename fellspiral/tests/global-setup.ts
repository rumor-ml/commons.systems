/**
 * Playwright Global Setup
 * Runs once before all tests to seed Firestore emulator with test data
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function globalSetup() {
  console.log('🔧 Running global test setup...');
  console.log(`   Environment: ${process.env.CI ? 'CI' : 'Local'}`);
  console.log(`   Working directory: ${process.cwd()}`);

  // Get emulator host from environment or use default
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8081';
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

    // Batch write cards to Firestore
    console.log(`   Writing ${cardsData.length} cards to Firestore...`);
    const batch = db.batch();
    const cardsCollection = db.collection('cards');

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
