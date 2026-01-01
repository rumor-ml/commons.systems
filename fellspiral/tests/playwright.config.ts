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
  },
  globalSetup: join(__dirname, 'global-setup.ts'),
});
