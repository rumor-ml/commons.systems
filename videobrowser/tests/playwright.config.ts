import { createPlaywrightConfig } from '../../playwright.base.config';

export default createPlaywrightConfig({
  mode: 'web-server',
  siteName: 'videobrowser',
  port: 3001,
  deployedUrl: 'https://videobrowser.commons.systems',
  webServerCommand: {
    local: 'cd ../site && npm run dev',
    ci: 'npx http-server ../site/dist -p 3001 -s',
  },
});
