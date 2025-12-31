// printsync/tests/playwright.config.ts
import { createPlaywrightConfig } from '../../playwright.base.config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read port from environment, default to 8080
const port = parseInt(process.env.TEST_PORT || '8080', 10);

const config = createPlaywrightConfig({
  mode: 'web-server',
  siteName: 'printsync',
  port, // Now configurable!
  deployedUrl: 'https://printsync.commons.systems',
  webServerCommand: {
    local: 'cd ../site && air',
    ci: 'cd ../site && ./bin/printsync',
  },
  // Environment variables for Firebase emulators
  // These should match the ports in infrastructure/scripts/start-emulators.sh
  env: {
    FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099',
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8081',
    STORAGE_EMULATOR_HOST: process.env.STORAGE_EMULATOR_HOST || 'localhost:9199',
    GCP_PROJECT_ID: 'demo-test', // Must match the project ID used in test fixtures (test-helpers.ts)
    PORT: process.env.TEST_PORT || '8080', // Pass PORT to Go app
  },
  // Increase timeout for tests that interact with emulators
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
});

// Override base config for printsync: run tests serially to prevent
// race conditions with shared Firebase emulators
//
// WHY SERIAL EXECUTION?
// - PrintSync tests share a single Firestore emulator instance
// - Multiple tests writing to the same emulator in parallel cause race conditions:
//   * File metadata conflicts when multiple tests upload simultaneously
//   * Card data pollution when tests expect clean emulator state
//   * Firestore transaction conflicts between parallel test workers
//
// TRADE-OFFS:
// - Serial execution: 2-3 minutes with 100% stability
// - Parallel execution: 30-45 seconds with frequent flakiness and test pollution
// - Stability > Speed: Serial execution is the right choice for these integration tests
//
// FUTURE OPTIMIZATION:
// To parallelize in the future, consider:
// 1. Data namespace isolation per test (e.g., user-specific prefixes: "test-worker-1-*")
// 2. Separate emulator instances per worker (30-60s startup overhead per instance)
// 3. Mock Firestore instead of real emulators (loses integration testing value)
//
// For now, serial execution is intentional and correct. See TEST_STABILITY_GUIDE.md.
config.fullyParallel = false;
config.workers = 1;

// Add global setup to ensure emulators are running before tests
config.globalSetup = resolve(__dirname, './global-setup.ts');
config.globalTeardown = resolve(__dirname, './global-teardown.ts');

// Override reporter for CI visibility - use list for streaming output
// The base config uses JSON-only in CI which produces no output until completion
// This causes exit 137 (SIGKILL) scenarios to show no test progress
config.reporter = process.env.CI
  ? [['list'], ['json', { outputFile: 'test-results.json' }]]
  : [['list'], ['json', { outputFile: 'test-results.json' }]];

export default config;
