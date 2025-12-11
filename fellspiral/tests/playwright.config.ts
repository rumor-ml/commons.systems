import { createPlaywrightConfig } from '../../playwright.base.config';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default createPlaywrightConfig({
  siteName: 'fellspiral',
  port: 3000,
  deployedUrl: 'https://fellspiral.commons.systems',
  webServerCommand: {
    local: 'cd ../site && npm run dev',
    ci: 'npx http-server ../site/dist -p 3000 -s',
  },
  env: {
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '',
    FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || '',
    // Vite-prefixed vars so the client can access them
    VITE_FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '',
    VITE_FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || '',
    VITE_USE_FIREBASE_EMULATOR: 'true',
  },
  globalSetup: join(__dirname, 'global-setup.ts'),
});
