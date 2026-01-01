// playwright.base.config.ts
import { defineConfig, devices, PlaywrightTestConfig } from '@playwright/test';

// Base configuration shared by both modes
interface BaseSiteConfig {
  siteName: string;
  deployedUrl?: string;
  testDir?: string;
}

// Modern: Uses Firebase Hosting emulator (no web server command needed)
export interface HostingEmulatorConfig extends BaseSiteConfig {
  mode: 'hosting-emulator';
  port: number; // Port where hosting emulator is running
}

// Legacy: Uses custom web server command
export interface WebServerConfig extends BaseSiteConfig {
  mode: 'web-server';
  port: number; // Port where web server will run
  webServerCommand: {
    local: string;
    ci: string;
  };
}

// Discriminated union: only valid state combinations are representable
export type SiteConfig = HostingEmulatorConfig | WebServerConfig;

export function createPlaywrightConfig(site: SiteConfig): PlaywrightTestConfig {
  const isDeployed = process.env.DEPLOYED === 'true';

  const baseURL = isDeployed
    ? process.env.DEPLOYED_URL || site.deployedUrl || `https://${site.siteName}.commons.systems`
    : `http://localhost:${site.port}`;

  return defineConfig({
    testDir: site.testDir || './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 4 : undefined,
    timeout: 60000,

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
    },

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

    webServer: isDeployed
      ? undefined
      : site.mode === 'web-server'
        ? {
            command: process.env.CI ? site.webServerCommand.ci : site.webServerCommand.local,
            url: `http://localhost:${site.port}`,
            reuseExistingServer: true,
            timeout: 120 * 1000,
          }
        : undefined, // Modern: No webServer needed, emulators started externally
  });
}
