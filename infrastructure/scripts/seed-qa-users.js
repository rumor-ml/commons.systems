#!/usr/bin/env node
/**
 * Seed QA Users - App-agnostic QA user seeding for emulators
 *
 * Seeds Firebase Auth emulator with QA test user for development.
 * Designed to work across all apps in the monorepo.
 *
 * Requirements:
 * - Firebase emulators must be running
 * - FIREBASE_AUTH_EMULATOR_HOST must be set
 * - Must be run from monorepo root or have access to shared firebase-init
 *
 * QA GitHub User:
 * - Email: qa-github@test.com
 * - Display Name: QA GitHub User
 * - UID: qa-github-user-id
 * - GitHub Provider UID: 12345678
 * - GitHub Username: qa-test-user
 */

import { getAuth } from 'firebase-admin/auth';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { initializeFirebase } from '../../fellspiral/scripts/lib/firebase-init.js';

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
const isEmulatorMode = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (!isEmulatorMode) {
  console.log('⏭️  Skipping QA user seeding - not in emulator mode');
  console.log('   Set FIREBASE_AUTH_EMULATOR_HOST to enable');
  process.exit(0);
}

console.log('🔧 Seeding QA users...');

// Initialize Firebase Admin (emulator mode detected automatically)
initializeFirebase();

const auth = getAuth();

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
    // Use GCP_PROJECT_ID from environment (set by allocate-test-ports.sh)
    // Each worktree gets a unique project ID like demo-test-314015698
    const projectId = process.env.GCP_PROJECT_ID || 'demo-test';

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
 * Main seeding workflow
 */
async function main() {
  try {
    const authSuccess = await seedQAGitHubUser();

    if (authSuccess) {
      console.log('✅ QA users ready!');
      console.log(`   QA GitHub user: ${QA_GITHUB_USER.email}`);
      console.log(`   GitHub: @${QA_GITHUB_USER.githubUsername}`);
      process.exit(0);
    } else {
      console.error('⚠️  QA user seeding completed with errors');
      process.exit(0); // Don't block dev server startup
    }
  } catch (error) {
    console.error('❌ Fatal error during QA user seeding:');
    console.error('   ', error.message);
    process.exit(0); // Don't block dev server startup
  }
}

main();
