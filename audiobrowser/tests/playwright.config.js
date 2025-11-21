import { defineConfig, devices } from '@playwright/test';

const isDeployed = process.env.DEPLOYED === 'true';
const baseURL = isDeployed
  ? process.env.DEPLOYED_URL
  : 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: isDeployed ? undefined : {
    command: 'npm run dev --workspace=audiobrowser/site',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
