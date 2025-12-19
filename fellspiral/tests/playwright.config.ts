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
    // Backend uses 127.0.0.1 to ensure IPv4 (Node.js admin SDK)
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:11980',
    FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:10980',
    // Browser uses 127.0.0.1 to avoid IPv6 ::1 resolution (emulator only binds to IPv4)
    VITE_FIRESTORE_EMULATOR_HOST: process.env.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1:11980',
    VITE_FIREBASE_AUTH_EMULATOR_HOST:
      process.env.VITE_FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:10980',
    VITE_USE_FIREBASE_EMULATOR: 'true',
  },
  globalSetup: join(__dirname, 'global-setup.ts'),
});
