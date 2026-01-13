import { createPlaywrightConfig } from '../../playwright.base.config';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default createPlaywrightConfig({
  mode: 'hosting-emulator',
  siteName: 'fellspiral',
  port: parseInt(process.env.HOSTING_PORT || '5002'), // Per-worktree port from allocate-test-ports.sh (fallback: 5002 for local dev)
  deployedUrl: 'https://fellspiral.commons.systems',
  // No webServerCommand - emulators started externally by run-e2e-tests.sh
  // Hosting emulator serves the built static files
  env: {
    // Enable Firebase emulator mode in the application
    VITE_USE_FIREBASE_EMULATOR: 'true',
    // Pass emulator projectId to the application
    VITE_GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || '',
    // Ensure test helpers use correct collection (falls back to cards-worker-0)
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8081',
    // Enable auth emulator mode detection for tests
    FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099',
  },
  globalSetup: join(__dirname, 'global-setup.ts'),
});
