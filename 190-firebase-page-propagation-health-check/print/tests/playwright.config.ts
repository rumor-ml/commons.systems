import { createPlaywrightConfig } from '../../playwright.base.config';

export default createPlaywrightConfig({
  mode: 'web-server',
  siteName: 'print',
  port: 3002,
  deployedUrl: 'https://print.commons.systems',
  webServerCommand: {
    local: 'cd ../site && npm run dev',
    ci: 'npx http-server ../site/dist -p 3002 -s',
  },
});
