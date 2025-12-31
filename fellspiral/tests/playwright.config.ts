import { createPlaywrightConfig } from '../../playwright.base.config';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default createPlaywrightConfig({
  siteName: 'fellspiral',
  port: parseInt(process.env.HOSTING_PORT || '5002'), // Dynamic per-worktree port from allocate-test-ports.sh
  deployedUrl: 'https://fellspiral.commons.systems',
  // No webServerCommand - emulators started externally by run-e2e-tests.sh
  // Hosting emulator serves built files and proxies backend emulator calls
  env: {
    // Build-time flag to enable Firebase emulator mode
    VITE_USE_FIREBASE_EMULATOR: 'true',
  },
  globalSetup: join(__dirname, 'global-setup.ts'),
});
