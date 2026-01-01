import { createPlaywrightConfig } from '../../playwright.base.config';

export default createPlaywrightConfig({
  mode: 'web-server',
  siteName: 'budget',
  port: 5173,
  deployedUrl: 'https://budget.commons.systems',
  webServerCommand: {
    local: 'cd ../site && pnpm dev',
    ci: 'cd ../site && pnpm preview',
  },
});
