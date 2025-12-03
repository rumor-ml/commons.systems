// {{APP_NAME}}/tests/playwright.config.ts
import { createPlaywrightConfig } from '../../playwright.base.config';

export default createPlaywrightConfig({
  siteName: '{{APP_NAME}}',
  port: 8080,
  deployedUrl: 'https://{{APP_NAME}}.commons.systems',
  webServerCommand: {
    local: 'cd ../site && air',
    ci: 'cd ../site && ./{{APP_NAME}}',
  },
});
