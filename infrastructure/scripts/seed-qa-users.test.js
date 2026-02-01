/**
 * TODO(#1621): Add tests for seed-qa-users.js when infrastructure test framework is set up
 *
 * Currently, infrastructure scripts don't have a test runner configured.
 * The test infrastructure is set up per-app (e.g., fellspiral/tests, printsync/tests)
 * but not for infrastructure/scripts.
 *
 * When infrastructure testing is configured, implement these test scenarios:
 *
 * 1. Environment Validation
 *    - Skips seeding when FIREBASE_AUTH_EMULATOR_HOST is not set
 *    - Runs when FIREBASE_AUTH_EMULATOR_HOST is set
 *
 * 2. Exit Code Behavior (HIGH PRIORITY)
 *    - Exits with code 1 when seeding fails (default blocking)
 *    - Exits with code 0 when seeding fails with QA_SEED_BLOCKING=false
 *    - Exits with code 0 on success
 *
 * 3. Error Messages (HIGH PRIORITY)
 *    - Provides detailed error context for fetch failures
 *    - Includes URL, Auth Host, Project ID in error output
 *    - Lists possible causes for network errors
 *
 * 4. User Creation (Integration Tests - requires running emulator)
 *    - Creates QA user with GitHub provider
 *    - Skips creation if user already exists with GitHub provider
 *    - Recreates user if exists without GitHub provider
 *    - Handles duplicate rawId errors gracefully
 *    - Idempotency: can run multiple times without errors
 *
 * 5. Documentation Validation
 *    - JSDoc requirements are accurate (no "monorepo root" requirement)
 *    - Mentions FIREBASE_AUTH_EMULATOR_HOST and GCP_PROJECT_ID
 *    - Documents batchCreate API requirement
 *    - Explains OAuth provider uniqueness constraint
 *
 * Test Implementation Notes:
 * - Use vitest or similar test runner
 * - Mock firebase-admin auth methods for unit tests
 * - Mock fetch for batchCreate API tests
 * - Integration tests need actual Firebase Auth emulator running
 * - Test exit codes using child_process.execSync
 * - Verify console output contains expected messages
 *
 * Example test structure:
 *
 * import { describe, it, expect, beforeEach, vi } from 'vitest';
 * import { execSync } from 'child_process';
 *
 * describe('seed-qa-users.js', () => {
 *   describe('Exit Code Behavior', () => {
 *     it('exits with code 1 when seeding fails (default)', () => {
 *       process.env.FIREBASE_AUTH_EMULATOR_HOST = 'invalid:9999';
 *       try {
 *         execSync('node seed-qa-users.js', { stdio: 'pipe' });
 *         expect(true).toBe(false); // Should not reach
 *       } catch (error) {
 *         expect(error.status).toBe(1);
 *       }
 *     });
 *
 *     it('exits with code 0 with QA_SEED_BLOCKING=false', () => {
 *       process.env.FIREBASE_AUTH_EMULATOR_HOST = 'invalid:9999';
 *       process.env.QA_SEED_BLOCKING = 'false';
 *       const result = execSync('node seed-qa-users.js', { encoding: 'utf8' });
 *       expect(result).toContain('non-blocking mode');
 *     });
 *   });
 * });
 */

// Placeholder export to make this a valid module
export const TODO_TESTS_PENDING = true;
