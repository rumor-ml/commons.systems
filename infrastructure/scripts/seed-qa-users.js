#!/usr/bin/env node
/**
 * Seed QA Users - App-agnostic QA user seeding for emulators
 *
 * Seeds Firebase Auth emulator with QA test user for development.
 * Designed to work across all apps in the monorepo.
 *
 * Requirements:
 * - Firebase emulators must be running
 * - FIREBASE_AUTH_EMULATOR_HOST and GCP_PROJECT_ID environment variables must be set
 * - Script must be located at infrastructure/scripts/ (for relative import path to firebase-init.js)
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
 *
 * IMPORTANT: firebase-admin's createUser() cannot create users with OAuth provider
 * data that appears in the emulator's OAuth popup. The batchCreate REST API is the
 * ONLY way to create users that show up when testing "Sign in with GitHub" flows.
 *
 * This is why we use raw fetch() instead of the admin SDK for this operation.
 */
async function seedQAGitHubUser() {
  try {
    // Check if user already exists with GitHub provider
    let existingUser;
    try {
      existingUser = await auth.getUser(QA_GITHUB_USER.uid);
    } catch (getUserError) {
      // Check if it's "user not found" (expected) vs actual error
      if (getUserError.code === 'auth/user-not-found') {
        // Expected - user doesn't exist yet
        existingUser = null;
      } else {
        // Unexpected error - fail fast with context
        console.error('   ❌ Error checking for existing user');
        console.error(`      UID: ${QA_GITHUB_USER.uid}`);
        console.error(`      Error Code: ${getUserError.code}`);
        console.error(`      Error Message: ${getUserError.message}`);
        console.error('');
        console.error('   This usually indicates:');
        console.error('      - Auth emulator not fully started');
        console.error('      - Admin SDK misconfigured');
        console.error('      - Network connectivity issue');
        throw new Error(`Failed to check existing user: ${getUserError.message}`);
      }
    }

    if (existingUser) {
      const hasGitHub = existingUser.providerData?.some((p) => p.providerId === 'github.com');
      if (hasGitHub) {
        console.log(`   ✓ QA GitHub user already exists (${QA_GITHUB_USER.email})`);
        return true;
      }

      // User exists but no GitHub provider - delete and recreate
      console.log('   ⏳ Recreating QA user with GitHub provider...');
      try {
        await auth.deleteUser(QA_GITHUB_USER.uid);
        console.log('   ✓ Deleted existing user without GitHub provider');
      } catch (deleteError) {
        console.error('   ❌ Failed to delete existing user');
        console.error(`      UID: ${QA_GITHUB_USER.uid}`);
        console.error(`      Error: ${deleteError.message}`);
        throw new Error(`User deletion failed: ${deleteError.message}`);
      }
    }

    // Use batchCreate REST API to create user with GitHub provider
    // This is required for the OAuth provider to show in the emulator's popup
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    // Use GCP_PROJECT_ID from environment (set by allocate-test-ports.sh)
    // Each worktree gets a unique project ID like demo-test-314015698
    const projectId = process.env.GCP_PROJECT_ID || 'demo-test';
    const apiUrl = `http://${authHost}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:batchCreate`;

    console.log(`   Calling batchCreate API: ${apiUrl}`);

    let response;
    try {
      response = await fetch(apiUrl, {
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
      });
    } catch (fetchError) {
      console.error(`   ❌ Network error calling batchCreate API`);
      console.error(`      URL: ${apiUrl}`);
      console.error(`      Auth Host: ${authHost}`);
      console.error(`      Project ID: ${projectId}`);
      console.error(`      Error: ${fetchError.message}`);
      console.error('');
      console.error('   Possible causes:');
      console.error('      - Auth emulator not running (check FIREBASE_AUTH_EMULATOR_HOST)');
      console.error('      - Network/firewall blocking localhost connections');
      console.error('      - Invalid host format in FIREBASE_AUTH_EMULATOR_HOST');
      throw new Error(`Network error: ${fetchError.message}`);
    }

    // Check HTTP status BEFORE attempting JSON parse
    if (!response.ok) {
      const statusText = response.statusText || 'Unknown Error';
      let errorBody;

      try {
        // Try to parse as JSON first (structured error)
        errorBody = await response.json();
        const errorMsg = errorBody.error?.message || JSON.stringify(errorBody);
        throw new Error(`HTTP ${response.status}: ${errorMsg}`);
      } catch (jsonError) {
        // Not JSON - get as text
        try {
          errorBody = await response.text();
          // Truncate long HTML error pages
          const truncated =
            errorBody.length > 200 ? errorBody.substring(0, 200) + '...' : errorBody;
          throw new Error(`HTTP ${response.status} ${statusText}: ${truncated}`);
        } catch (textError) {
          // Can't read body at all
          throw new Error(`HTTP ${response.status} ${statusText} (body unreadable)`);
        }
      }
    }

    // Response is OK - attempt JSON parse with error handling
    let result;
    try {
      result = await response.json();
    } catch (parseError) {
      console.error('   ❌ Failed to parse API response as JSON');
      console.error(`      Status: ${response.status}`);
      console.error(`      Parse Error: ${parseError.message}`);

      // Try to show raw response for debugging
      try {
        const rawBody = await response.text();
        console.error(`      Raw Response (first 500 chars): ${rawBody.substring(0, 500)}`);
      } catch {
        console.error('      (Unable to read response body)');
      }

      throw new Error(`Invalid JSON response from Auth emulator: ${parseError.message}`);
    }

    // Now check for application-level errors in the JSON
    if (result.error && result.error.length > 0) {
      // Check if it's a duplicate error (OAuth provider rawId already exists)
      // Firebase enforces uniqueness on providerUserInfo[].rawId (GitHub UID 12345678)
      // This is separate from the localId check above and catches race conditions
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
      console.error('   E2E tests may fail with authentication errors');

      // Check if we should block (default: block in test environments)
      const shouldBlock = process.env.QA_SEED_BLOCKING !== 'false';

      if (shouldBlock) {
        console.error('');
        console.error('Set QA_SEED_BLOCKING=false to make this non-blocking');
        process.exit(1); // Fail to prevent tests from running with bad data
      } else {
        console.error('   (non-blocking mode: QA_SEED_BLOCKING=false)');
        process.exit(0);
      }
    }
  } catch (error) {
    console.error('❌ Fatal error during QA user seeding:');
    console.error('   ', error.message);
    console.error('   E2E tests WILL fail with authentication errors');

    const shouldBlock = process.env.QA_SEED_BLOCKING !== 'false';

    if (shouldBlock) {
      console.error('');
      console.error('Set QA_SEED_BLOCKING=false to make this non-blocking');
      process.exit(1);
    } else {
      console.error('   (non-blocking mode: QA_SEED_BLOCKING=false)');
      process.exit(0);
    }
  }
}

main();
