#!/usr/bin/env node
/**
 * Seed Dev Environment with Cards (QA user seeding delegated to shared script)
 *
 * Runs automatically before dev server starts (via predev hook).
 * Seeds Firestore emulator with demo cards.
 * QA user seeding is now handled by the shared seed-qa-users.js script.
 *
 * Requirements:
 * - Firebase emulators must be running
 * - FIRESTORE_EMULATOR_HOST must be set
 */

import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeFirebase } from './lib/firebase-init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// QA user UID for linking card ownership
const QA_GITHUB_USER_UID = 'qa-github-user-id';

// Check if running in emulator mode
const isEmulatorMode = !!process.env.FIRESTORE_EMULATOR_HOST;

if (!isEmulatorMode) {
  console.log('⏭️  Skipping dev environment seeding - not in emulator mode');
  console.log('   Set FIRESTORE_EMULATOR_HOST to enable');
  process.exit(0);
}

console.log('🔧 Seeding dev environment...');

// Initialize Firebase Admin (emulator mode detected automatically)
initializeFirebase();

const db = getFirestore();

/**
 * Seed cards to Firestore emulator
 */
async function seedCards() {
  try {
    // Load cards from cards.json
    const cardsPath = join(__dirname, '../site/src/data/cards.json');
    const cardsContent = readFileSync(cardsPath, 'utf8');
    const cards = JSON.parse(cardsContent);

    if (!Array.isArray(cards) || cards.length === 0) {
      console.error('   ❌ Invalid or empty cards.json');
      return false;
    }

    // Use 'cards' collection (not worker-scoped)
    const cardsCollection = db.collection('cards');

    // Check if collection already has data (idempotent)
    const snapshot = await cardsCollection.limit(1).get();
    if (!snapshot.empty) {
      console.log(`   ✓ Cards already seeded (${cards.length} cards in cards.json)`);
      return true;
    }

    // Seed cards with QA user as creator
    const batch = db.batch();
    let count = 0;

    for (const card of cards) {
      if (!card.id) {
        console.warn(`   ⚠️  Skipping card without id: ${card.title || 'unknown'}`);
        continue;
      }

      const docRef = cardsCollection.doc(card.id);
      batch.set(docRef, {
        ...card,
        isPublic: true, // Make all dev cards public
        createdBy: QA_GITHUB_USER_UID, // Link to QA GitHub user
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      count++;
    }

    await batch.commit();
    console.log(`   ✅ Seeded ${count} cards to Firestore`);
    return true;
  } catch (error) {
    console.error('   ❌ Failed to seed cards:', error.message);
    return false;
  }
}

/**
 * Main seeding workflow
 */
async function main() {
  try {
    const firestoreSuccess = await seedCards();

    if (firestoreSuccess) {
      console.log('✅ Dev environment ready!');
      console.log('   Cards seeded to Firestore');
      console.log('   QA user seeding handled by shared seed-qa-users.js');
      process.exit(0);
    } else {
      console.error('⚠️  Dev environment seeding completed with errors');
      process.exit(0); // Don't block dev server startup
    }
  } catch (error) {
    console.error('❌ Fatal error during dev environment seeding:');
    console.error('   ', error.message);
    process.exit(0); // Don't block dev server startup
  }
}

main();
