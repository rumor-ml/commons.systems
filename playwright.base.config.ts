// playwright.base.config.ts
import { defineConfig, devices, PlaywrightTestConfig } from '@playwright/test';

// TODO(#486): Add runtime validation with zod for SiteConfig
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
  globalSetup?: string;
  globalTeardown?: string;
}

export function createPlaywrightConfig(site: SiteConfig): PlaywrightTestConfig {
  const isDeployed = process.env.DEPLOYED === 'true';
  // Use existing server by default to avoid sandbox port binding issues
  // Can be overridden with START_SERVER=true
  const shouldStartServer = process.env.START_SERVER === 'true';

  // Set environment variables for test process
  if (site.env) {
    Object.assign(process.env, site.env);
  }

  const baseURL = isDeployed
    ? process.env.DEPLOYED_URL || site.deployedUrl || `https://${site.siteName}.commons.systems`
    : `http://127.0.0.1:${site.port}`;

  return defineConfig({
    testDir: site.testDir || './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    // Retry strategy: 2 retries in CI for better stability with UI/timing-dependent tests
    // Database/API tests typically fail fast (deterministic), but UI tests benefit from retries
    // Individual test suites can override with test.describe().configure({ retries: N })
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 4 : undefined,
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
              use: {
                ...devices['Desktop Firefox'],
                launchOptions: {
                  firefoxUserPrefs: {
                    // Allow connections to localhost emulator ports
                    'network.proxy.allow_hijacking_localhost': true,
                    'network.websocket.allowInsecureFromHTTPS': true,
                  },
                },
              },
            },
            // Also enable Chromium for testing emulator connectivity
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

    webServer:
      isDeployed || !shouldStartServer
        ? undefined
        : {
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
