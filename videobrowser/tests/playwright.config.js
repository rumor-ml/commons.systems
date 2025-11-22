import { defineConfig, devices } from '@playwright/test';

// Determine if testing deployed site or local dev server
const isDeployed = process.env.DEPLOYED === 'true';
const baseURL = isDeployed
  ? process.env.DEPLOYED_URL || 'https://videobrowser.commons.systems'
  : 'http://localhost:3001';

// Configure remote browser connection
const useConfig = {
  baseURL,
  trace: 'on-first-retry',
  screenshot: 'only-on-failure',
};

// Add headless setting only when NOT using remote browser server
if (!process.env.PLAYWRIGHT_WS_ENDPOINT) {
  useConfig.headless = true;
}

// If PLAYWRIGHT_WS_ENDPOINT is set, use Playwright's browser server
if (process.env.PLAYWRIGHT_WS_ENDPOINT) {
  useConfig.connectOptions = {
    wsEndpoint: process.env.PLAYWRIGHT_WS_ENDPOINT,
    timeout: 30000, // 30-second connection timeout
  };
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Remote browser connections work best with single worker
  workers: process.env.PLAYWRIGHT_WS_ENDPOINT ? 1 : (process.env.CI ? 4 : undefined),
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
      // When using remote browser, omit 'use' to avoid overriding parent connectOptions
      ...(process.env.PLAYWRIGHT_WS_ENDPOINT
        ? {}
        : {
            use: {
              ...devices['Desktop Chrome'],
              launchOptions: {
                args: [
                  '--no-sandbox',
                  '--disable-setuid-sandbox',
                  '--disable-dev-shm-usage',
                  '--disable-gpu',
                ],
              },
            },
          }),
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
