// playwright.base.config.ts
import { defineConfig, devices, PlaywrightTestConfig } from '@playwright/test';

export interface SiteConfig {
  siteName: string;
  port: number;
  deployedUrl?: string;
  testDir?: string;
  webServerCommand?: {
    local: string;
    ci: string;
  };
}

export function createPlaywrightConfig(site: SiteConfig): PlaywrightTestConfig {
  const isDeployed = process.env.DEPLOYED === 'true';
  const isRemoteBrowser = !!process.env.PLAYWRIGHT_WS_ENDPOINT;

  const baseURL = isDeployed
    ? process.env.DEPLOYED_URL || site.deployedUrl || `https://${site.siteName}.commons.systems`
    : `http://localhost:${site.port}`;

  return defineConfig({
    testDir: site.testDir || './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: isRemoteBrowser ? 4 : (process.env.CI ? 4 : undefined),
    timeout: 60000,

    reporter: [
      ['list'],
      ['json', { outputFile: 'test-results.json' }],
    ],

    use: {
      baseURL,
      trace: 'off',
      screenshot: 'only-on-failure',
      video: 'off',
      ...(isRemoteBrowser ? {
        connectOptions: {
          wsEndpoint: process.env.PLAYWRIGHT_WS_ENDPOINT!,
          timeout: 30000,
        },
      } : {
        headless: true,
      }),
    },

    projects: [
      {
        name: 'chromium',
        use: isRemoteBrowser ? {} : {
          ...devices['Desktop Chrome'],
          launchOptions: {
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
          },
        },
      },
      // Additional browsers can be enabled per-project if needed
    ],

    webServer: isDeployed ? undefined : {
      command: process.env.CI
        ? site.webServerCommand?.ci || `cd ../site && npm run preview`
        : site.webServerCommand?.local || `cd ../site && npm run dev`,
      url: `http://localhost:${site.port}`,
      reuseExistingServer: true,
      timeout: 120 * 1000,
    },
  });
}
