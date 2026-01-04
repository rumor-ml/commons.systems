// playwright.base.config.ts
import { defineConfig, devices, PlaywrightTestConfig } from '@playwright/test';

// Base configuration shared by both modes
interface BaseSiteConfig {
  siteName: string;
  deployedUrl?: string;
  testDir?: string;
  env?: Record<string, string>;
  timeout?: number;
  expect?: { timeout?: number };
  globalSetup?: string;
  globalTeardown?: string;
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
    // Retry strategy: 2 retries in CI for better stability with UI/timing-dependent tests
    // Database/API tests typically fail fast (deterministic), but UI tests benefit from retries
    // Individual test suites can override with test.describe().configure({ retries: N })
    // TODO(#1089): Comment explains retry strategy but doesn't mention when 0 retries is appropriate
    retries: process.env.CI ? 2 : 0,
    // Limit to 2 workers for stability (balances speed vs resource usage)
    // Each worker gets isolated Firestore collection via TEST_PARALLEL_INDEX
    workers: process.env.CI ? 2 : 1,
    timeout: site.timeout || 60000,
    globalSetup: site.globalSetup,
    globalTeardown: site.globalTeardown,

    reporter: process.env.CI
      ? [['list'], ['json', { outputFile: 'test-results.json' }], ['github']]
      : [['list'], ['json', { outputFile: 'test-results.json' }]],

    use: {
      baseURL,
      trace: 'off',
      screenshot: 'only-on-failure',
      video: 'off',
      headless: true,
      ...(site.env || {}),
    },

    expect: site.expect,

    projects:
      process.platform === 'darwin'
        ? [
            // On macOS, use Firefox to avoid chrome-headless-shell Mach port issues
            {
              name: 'firefox',
              use: { ...devices['Desktop Firefox'] },
            },
          ]
        : [
            {
              name: 'chromium',
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
            },
          ],

    webServer: isDeployed
      ? undefined
      : site.mode === 'web-server'
        ? {
            // Legacy: Apps still using webServerCommand (not yet migrated to hosting emulator)
            command: process.env.CI ? site.webServerCommand.ci : site.webServerCommand.local,
            url: `http://localhost:${site.port}`,
            reuseExistingServer: true,
            timeout: 120 * 1000,
            env: {
              // Filter out undefined values from process.env
              ...(Object.fromEntries(
                Object.entries(process.env).filter(([_, v]) => v !== undefined)
              ) as Record<string, string>),
              ...(site.env || {}),
            },
          }
        : undefined, // Modern: No webServer needed, emulators started externally
  });
}
