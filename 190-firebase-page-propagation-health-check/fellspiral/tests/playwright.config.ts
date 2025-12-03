import { createPlaywrightConfig } from '../../playwright.base.config';

export default createPlaywrightConfig({
  siteName: 'fellspiral',
  port: 3000,
  deployedUrl: 'https://fellspiral.commons.systems',
  webServerCommand: {
    local: 'cd ../site && npm run dev',
    ci: 'npx http-server ../site/dist -p 3000 -s',
  },
});
