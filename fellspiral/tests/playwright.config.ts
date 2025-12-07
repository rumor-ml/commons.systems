import { createPlaywrightConfig } from '../../playwright.base.config';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default createPlaywrightConfig({
  siteName: 'fellspiral',
  port: 3003,
  deployedUrl: 'https://fellspiral.commons.systems',
  webServerCommand: {
    local: 'cd ../site && npm run dev -- --port 3003',
    ci: 'npx http-server ../dist -p 3003 -s',
  },
  env: {
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8081',
    FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099',
  },
  globalSetup: join(__dirname, 'global-setup.ts'),
});
