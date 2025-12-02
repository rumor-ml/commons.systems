// printsync/tests/playwright.config.ts
import { createPlaywrightConfig } from '../../playwright.base.config';

const config = createPlaywrightConfig({
  siteName: 'printsync',
  port: 8080,
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
  },
  // Increase timeout for tests that interact with emulators
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
});

// Add global setup to ensure emulators are running before tests
config.globalSetup = require.resolve('./global-setup.ts');

export default config;
