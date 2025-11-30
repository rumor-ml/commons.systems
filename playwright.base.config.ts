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
  env?: Record<string, string>;
  timeout?: number;
  expect?: { timeout?: number };
}

export function createPlaywrightConfig(site: SiteConfig): PlaywrightTestConfig {
  const isDeployed = process.env.DEPLOYED === 'true';

  // Set environment variables for test process
  if (site.env) {
    Object.assign(process.env, site.env);
  }

  const baseURL = isDeployed
    ? process.env.DEPLOYED_URL || site.deployedUrl || `https://${site.siteName}.commons.systems`
    : `http://localhost:${site.port}`;

  return defineConfig({
    testDir: site.testDir || './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 4 : undefined,
    timeout: site.timeout || 60000,

    reporter: process.env.CI
      ? [['json']]  // JSON to stdout in CI
      : [
          ['list'],
          ['json', { outputFile: 'test-results.json' }],
        ],

    use: {
      baseURL,
      trace: 'off',
      screenshot: 'only-on-failure',
      video: 'off',
      headless: true,
      ...(site.env || {}),
    },

    expect: site.expect,

    projects: [
      {
        name: 'chromium',
        use: {
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
      env: {
        ...process.env,
        ...(site.env || {}),
      },
    },
  });
}
