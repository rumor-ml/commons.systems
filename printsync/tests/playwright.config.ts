// printsync/tests/playwright.config.ts
import { createPlaywrightConfig } from '../../playwright.base.config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read port from environment, default to 8080
const port = parseInt(process.env.TEST_PORT || '8080', 10);

const config = createPlaywrightConfig({
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
config.fullyParallel = false;
config.workers = 1;

// Add global setup to ensure emulators are running before tests
config.globalSetup = resolve(__dirname, './global-setup.ts');
config.globalTeardown = resolve(__dirname, './global-teardown.ts');

export default config;
