#!/usr/bin/env node
/**
 * Seed Dev Environment with QA User and Cards
 *
 * Runs automatically before dev server starts (via predev hook).
 * Seeds Firebase Auth and Firestore emulators with QA test user and demo cards.
 *
 * Requirements:
 * - Firebase emulators must be running
 * - FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST must be set
 *
 * QA User Credentials:
 * - Email: qa@test.com
 * - Password: testpassword123
 * - UID: qa-test-user-id
 */

import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeFirebase } from './lib/firebase-init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check if running in emulator mode
const isEmulatorMode = !!(
  process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST
);

if (!isEmulatorMode) {
  console.log('⏭️  Skipping dev environment seeding - not in emulator mode');
  console.log('   Set FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST to enable');
  process.exit(0);
}

console.log('🔧 Seeding dev environment...');

// Initialize Firebase Admin (emulator mode detected automatically)
initializeFirebase();

const auth = getAuth();
const db = getFirestore();

/**
 * Seed QA test user to Auth emulator
 */
async function seedQAUser() {
  try {
    // Check if user already exists
    await auth.getUserByEmail('qa@test.com');
    console.log('   ✓ QA user already exists (qa@test.com)');
    return true;
  } catch (error) {
    // User doesn't exist, create it
    if (error.code === 'auth/user-not-found') {
      try {
        await auth.createUser({
          uid: 'qa-test-user-id',
          email: 'qa@test.com',
          password: 'testpassword123',
          displayName: 'QA Test User',
        });
        console.log('   ✅ Created QA user: qa@test.com / testpassword123');
        return true;
      } catch (createError) {
        console.error('   ❌ Failed to create QA user:', createError.message);
        return false;
      }
    } else {
      console.error('   ❌ Error checking for QA user:', error.message);
      return false;
    }
  }
}

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
        createdBy: 'qa-test-user-id', // Link to QA user
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
    const authSuccess = await seedQAUser();
    const firestoreSuccess = await seedCards();

    if (authSuccess && firestoreSuccess) {
      console.log('✅ Dev environment ready!');
      console.log('   QA user: qa@test.com / testpassword123');
      console.log('   Emulator UI: http://localhost:4000');
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
