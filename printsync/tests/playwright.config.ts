// printsync/tests/playwright.config.ts
import { createPlaywrightConfig } from '../../playwright.base.config';

export default createPlaywrightConfig({
  siteName: 'printsync',
  port: 8080,
  deployedUrl: 'https://printsync.commons.systems',
  webServerCommand: {
    local: 'cd ../site && air',
    ci: 'cd ../site && ./printsync',
  },
});
