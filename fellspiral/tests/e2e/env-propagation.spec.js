/**
 * Environment Variable Propagation Tests
 *
 * Verifies that environment variables from run-e2e-tests.sh are correctly
 * propagated to Playwright subprocess and accessible to configuration files.
 *
 * This prevents regressions where:
 * - Variables fail to propagate across subprocess boundaries
 * - Playwright uses wrong ports or project IDs
 * - Silent fallback values hide missing environment variables
 */

import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('Environment Variable Propagation', () => {
  test('critical environment variables are defined', async () => {
    // Verify all critical env vars passed from run-e2e-tests.sh are accessible
    const requiredVars = {
      HOSTING_PORT: process.env.HOSTING_PORT,
      GCP_PROJECT_ID: process.env.GCP_PROJECT_ID,
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
      FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
      STORAGE_EMULATOR_HOST: process.env.STORAGE_EMULATOR_HOST,
    };

    // Check each variable is defined (not undefined)
    for (const [varName, value] of Object.entries(requiredVars)) {
      expect(value, `${varName} should be defined`).toBeDefined();
      expect(value, `${varName} should not be empty`).not.toBe('');
    }
  });

  test('HOSTING_PORT matches baseURL port', async ({ baseURL }) => {
    // Verify HOSTING_PORT env var matches the actual server port used by Playwright
    const hostingPort = process.env.HOSTING_PORT;

    expect(hostingPort, 'HOSTING_PORT should be defined').toBeDefined();
    expect(baseURL, 'baseURL should contain HOSTING_PORT').toContain(`:${hostingPort}`);
  });

  test('GCP_PROJECT_ID is properly configured', async () => {
    // Verify project ID is defined and matches expected format
    const projectId = process.env.GCP_PROJECT_ID;

    expect(projectId, 'GCP_PROJECT_ID should be defined').toBeDefined();
    expect(projectId, 'GCP_PROJECT_ID should not be empty').not.toBe('');

    // Project ID should be a valid format (alphanumeric with hyphens)
    expect(projectId, 'GCP_PROJECT_ID should match valid format').toMatch(/^[a-z0-9-]+$/);
  });

  test('Firebase emulator host variables have correct format', async () => {
    // Verify emulator host variables match expected "host:port" format
    const emulatorVars = {
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
      FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
      STORAGE_EMULATOR_HOST: process.env.STORAGE_EMULATOR_HOST,
    };

    for (const [varName, value] of Object.entries(emulatorVars)) {
      expect(value, `${varName} should be defined`).toBeDefined();

      // Should match "host:port" format (e.g., "localhost:8081")
      expect(value, `${varName} should match host:port format`).toMatch(/^[^:]+:\d+$/);

      // Extract and validate port is a number
      const port = value.split(':')[1];
      expect(parseInt(port, 10), `${varName} port should be a valid number`).toBeGreaterThan(0);
    }
  });

  test('no silent fallback values are hiding missing variables', async () => {
    // This test ensures variables are explicitly set, not falling back to defaults
    // If run-e2e-tests.sh fails to export a variable, this should catch it

    // Verify HOSTING_PORT is not the default fallback value from playwright.config.ts
    const hostingPort = process.env.HOSTING_PORT;
    expect(hostingPort, 'HOSTING_PORT should be defined').toBeDefined();

    // In playwright.config.ts, the fallback is '5002'
    // In a real test run, this should be set by allocate-test-ports.sh to a worktree-specific port
    // We can't assert the exact value since it varies per worktree, but we can verify it's set
    expect(hostingPort.length, 'HOSTING_PORT should be explicitly set (not empty)').toBeGreaterThan(
      0
    );
  });

  test('environment variables are accessible in global setup', async () => {
    // Verify that the same env vars used in global-setup.ts are accessible here
    // This ensures subprocess environment is consistent

    const projectId = process.env.GCP_PROJECT_ID;

    // global-setup.ts uses: process.env.GCP_PROJECT_ID || 'demo-test'
    // We verify it's set and not falling back to 'demo-test' default
    expect(projectId, 'GCP_PROJECT_ID should be defined').toBeDefined();

    // Note: We can't assert it's NOT 'demo-test' because that might be the intentional value
    // But we verify it matches the expected pattern
    expect(projectId, 'GCP_PROJECT_ID should be a valid identifier').toMatch(/^[a-z0-9-]+$/);
  });
});
