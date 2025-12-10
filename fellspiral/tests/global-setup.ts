/**
 * Playwright Global Setup
 * Runs once before all tests to seed Firestore emulator with test data
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function globalSetup() {
  console.log('🔧 Running global test setup...');

  // Get emulator host from environment or use default
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8081';
  const [host, port] = firestoreHost.split(':');

  console.log(`📦 Seeding Firestore emulator at ${firestoreHost}...`);

  try {
    // Load cards data
    const cardsPath = join(__dirname, '../site/src/data/cards.json');
    const cardsData = JSON.parse(readFileSync(cardsPath, 'utf-8'));

    console.log(`   Found ${cardsData.length} cards to seed`);

    // Import Firestore Admin SDK
    const adminModule = await import('firebase-admin');
    const admin = adminModule.default;

    // Initialize Firebase Admin with emulator
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId: 'demo-test',
      });
    }

    // Connect to Firestore emulator
    const db = admin.firestore();
    db.settings({
      host: `${host}:${port}`,
      ssl: false,
    });

    const cardsCollection = db.collection('cards');

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

    console.log(`✓ Successfully seeded ${cardsData.length} cards`);
    console.log('✓ Global setup complete');
  } catch (error) {
    console.error('❌ Error during global setup:', error);
    // Don't fail setup if seeding fails - tests can handle empty state
    console.log('⚠️  Continuing without test data seeding');
  }
}

export default globalSetup;
