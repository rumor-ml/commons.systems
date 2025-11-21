import { defineConfig, devices } from '@playwright/test';

// Determine if testing deployed site or local dev server
const isDeployed = process.env.DEPLOYED === 'true';
const baseURL = isDeployed
  ? process.env.DEPLOYED_URL || 'https://fellspiral.commons.systems'
  : 'http://localhost:3000';

// Configure remote browser connection
const useConfig = {
  baseURL,
  headless: true,
  trace: 'off',  // Disabled to reduce memory usage on server
  screenshot: 'only-on-failure',
  video: 'off',  // Disabled to reduce resource usage
};

// If PLAYWRIGHT_CDP_URL is set, use connectOverCDP for secure remote browsers
if (process.env.PLAYWRIGHT_CDP_URL) {
  useConfig.connectOptions = {
    wsEndpoint: process.env.PLAYWRIGHT_CDP_URL,
  };
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ['list'],  // Console output
    ['json', { outputFile: 'test-results.json' }]  // Machine-readable results
    // HTML reporter disabled to reduce server resource usage
  ],
  use: useConfig,

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Disable sandbox for Docker/container environments
        launchOptions: {
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        },
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
      ? 'npx http-server ../site/dist -p 3000 -s'
      : 'cd ../site && npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true, // Always reuse existing server to avoid port conflicts
    timeout: 120 * 1000,
  },
});
