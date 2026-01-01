// {{APP_NAME}}/tests/playwright.config.ts
import { createPlaywrightConfig } from '../../playwright.base.config';

export default createPlaywrightConfig({
  mode: 'web-server',
  siteName: '{{APP_NAME}}',
  port: 8080,
  deployedUrl: 'https://{{APP_NAME}}.commons.systems',
  webServerCommand: {
    local: 'cd ../site && air',
    ci: 'cd ../site && ./{{APP_NAME}}',
  },
  // Environment variables for Firebase emulators
  // These should match your firebase.json configuration
  // When running tests locally, make sure emulators are running first:
  // firebase emulators:start
  env: {
    // Firestore emulator (default port: 8082)
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8082',
    // Storage emulator (default port: 9199)
    STORAGE_EMULATOR_HOST: process.env.STORAGE_EMULATOR_HOST || 'localhost:9199',
  },
  // Increase timeout for tests that interact with emulators
  // Emulator operations can be slower than normal API calls
  timeout: 60000, // 60 seconds per test
  expect: {
    timeout: 10000, // 10 seconds for assertions
  },
});
