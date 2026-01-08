#!/usr/bin/env node
/**
 * Seed Dev Environment with QA GitHub User and Cards
 *
 * Runs automatically before dev server starts (via predev hook).
 * Seeds Firebase Auth and Firestore emulators with QA test user and demo cards.
 *
 * Requirements:
 * - Firebase emulators must be running
 * - FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST must be set
 *
 * QA GitHub User:
 * - Email: qa-github@test.com
 * - Display Name: QA GitHub User
 * - UID: qa-github-user-id
 * - GitHub Provider UID: 12345678
 * - GitHub Username: qa-test-user
 */

import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeFirebase } from './lib/firebase-init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// QA GitHub User configuration
const QA_GITHUB_USER = {
  uid: 'qa-github-user-id',
  email: 'qa-github@test.com',
  displayName: 'QA GitHub User',
  photoURL: 'https://avatars.githubusercontent.com/u/12345678',
  // GitHub provider info
  githubUid: '12345678',
  githubUsername: 'qa-test-user',
};

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
 * Seed QA GitHub user to Auth emulator using batchCreate REST API
 * This is the only way to create users with OAuth provider data that shows
 * up in the emulator's OAuth popup (e.g., "Sign in with GitHub")
 */
async function seedQAGitHubUser() {
  try {
    // Check if user already exists with GitHub provider
    const existingUser = await auth.getUser(QA_GITHUB_USER.uid).catch(() => null);

    if (existingUser) {
      const hasGitHub = existingUser.providerData?.some((p) => p.providerId === 'github.com');
      if (hasGitHub) {
        console.log(`   ✓ QA GitHub user already exists (${QA_GITHUB_USER.email})`);
        return true;
      }
      // User exists but no GitHub provider - delete and recreate
      console.log('   ⏳ Recreating QA user with GitHub provider...');
      await auth.deleteUser(QA_GITHUB_USER.uid);
    }

    // Use batchCreate REST API to create user with GitHub provider
    // This is required for the OAuth provider to show in the emulator's popup
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    const projectId = 'demo-test';

    const response = await fetch(
      `http://${authHost}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:batchCreate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer owner',
        },
        body: JSON.stringify({
          users: [
            {
              localId: QA_GITHUB_USER.uid,
              email: QA_GITHUB_USER.email,
              displayName: QA_GITHUB_USER.displayName,
              photoUrl: QA_GITHUB_USER.photoURL,
              emailVerified: true,
              providerUserInfo: [
                {
                  providerId: 'github.com',
                  rawId: QA_GITHUB_USER.githubUid,
                  displayName: QA_GITHUB_USER.displayName,
                  email: QA_GITHUB_USER.email,
                  photoUrl: QA_GITHUB_USER.photoURL,
                  screenName: QA_GITHUB_USER.githubUsername,
                },
              ],
            },
          ],
        }),
      }
    );

    const result = await response.json();

    if (result.error && result.error.length > 0) {
      // Check if it's a duplicate error (user already exists with same rawId)
      const isDuplicate = result.error.some(
        (e) => e.message && e.message.includes('raw id exists')
      );
      if (isDuplicate) {
        console.log(`   ✓ QA GitHub user already exists (${QA_GITHUB_USER.email})`);
        return true;
      }
      throw new Error(result.error.map((e) => e.message).join(', '));
    }

    console.log(`   ✅ Created QA GitHub user: ${QA_GITHUB_USER.email}`);
    console.log(
      `      GitHub: @${QA_GITHUB_USER.githubUsername} (ID: ${QA_GITHUB_USER.githubUid})`
    );
    return true;
  } catch (error) {
    console.error('   ❌ Failed to seed QA GitHub user:', error.message);
    return false;
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
        createdBy: QA_GITHUB_USER.uid, // Link to QA GitHub user
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
    const authSuccess = await seedQAGitHubUser();
    const firestoreSuccess = await seedCards();

    if (authSuccess && firestoreSuccess) {
      console.log('✅ Dev environment ready!');
      console.log(`   QA GitHub user: ${QA_GITHUB_USER.email}`);
      console.log(`   GitHub: @${QA_GITHUB_USER.githubUsername}`);
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
