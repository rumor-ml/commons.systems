import { createPlaywrightConfig } from '../../playwright.base.config';

export default createPlaywrightConfig({
  siteName: 'audiobrowser',
  port: 3002,
  deployedUrl: 'https://audiobrowser.commons.systems',
  webServerCommand: {
    local: 'cd ../site && npm run dev',
    ci: 'npx http-server ../site/dist -p 3002 -s',
  },
});
