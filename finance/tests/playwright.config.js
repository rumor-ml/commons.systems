import { defineConfig, devices } from '@playwright/test';

const isDeployed = process.env.DEPLOYED === 'true';
const baseURL = isDeployed
  ? process.env.DEPLOYED_URL
  : 'http://localhost:5173'; // Vite default port

// Remote browser server configuration
const browserServerURL = process.env.PLAYWRIGHT_SERVER_URL;
const connectOptions = browserServerURL ? {
  wsEndpoint: browserServerURL.replace(/^https?:\/\//, 'ws://') + '/ws?token=' + encodeURIComponent(process.env.PLAYWRIGHT_TOKEN || ''),
  timeout: 60000,
  headers: browserServerURL.includes('run.app') ? {
    'Authorization': `Bearer ${process.env.PLAYWRIGHT_TOKEN || ''}`
  } : undefined
} : undefined;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['list']
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    connectOptions,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Local dev server - only start if not deployed and not using remote browser
  webServer: isDeployed || browserServerURL ? undefined : {
    command: 'npm run dev --workspace=finance/site',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
