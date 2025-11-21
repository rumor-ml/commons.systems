import { defineConfig, devices } from '@playwright/test';

// Determine if testing deployed site or local dev server
const isDeployed = process.env.DEPLOYED === 'true';
const baseURL = isDeployed
  ? process.env.DEPLOYED_URL || 'https://videobrowser.commons.systems'
  : 'http://localhost:3001';

// Configure remote browser connection
const useConfig = {
  baseURL,
  headless: true,
  trace: 'on-first-retry',
  screenshot: 'only-on-failure',
};

// If PLAYWRIGHT_CDP_URL is set, use connectOverCDP for secure remote browsers
if (process.env.PLAYWRIGHT_CDP_URL) {
  useConfig.connectOptions = {
    wsEndpoint: process.env.PLAYWRIGHT_CDP_URL,
    timeout: 30000, // 30-second connection timeout
  };
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CDP connections require single worker (one browser instance)
  workers: process.env.PLAYWRIGHT_CDP_URL ? 1 : (process.env.CI ? 4 : undefined),
  timeout: 60000, // 60-second timeout per test
  reporter: [
    ['html'],
    ['list'],
    ['json', { outputFile: 'test-results.json' }]
  ],
  use: useConfig,

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Only use launchOptions when NOT connecting via CDP
        ...(!process.env.PLAYWRIGHT_CDP_URL && {
          launchOptions: {
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
            ],
          },
        }),
      },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  webServer: isDeployed ? undefined : {
    command: process.env.CI
      ? 'npx http-server ../site/dist -p 3001 -s'
      : 'cd ../site && npm run dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
