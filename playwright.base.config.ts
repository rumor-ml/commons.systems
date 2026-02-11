// playwright.base.config.ts
import { defineConfig, devices, PlaywrightTestConfig } from '@playwright/test';

// Base configuration shared by both modes
interface BaseSiteConfig {
  readonly siteName: string;
  readonly deployedUrl?: string;
  readonly testDir?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeout?: number;
  readonly expect?: { readonly timeout?: number };
  readonly globalSetup?: string;
  readonly globalTeardown?: string;
}

// Modern: Uses Firebase Hosting emulator (no web server command needed)
export interface HostingEmulatorConfig extends BaseSiteConfig {
  readonly mode: 'hosting-emulator';
  readonly port: number; // Port where hosting emulator is running
  readonly webServerCommand?: never; // Explicitly exclude to strengthen discriminated union
}

// Legacy: Uses custom web server command
export interface WebServerConfig extends BaseSiteConfig {
  readonly mode: 'web-server';
  readonly port: number; // Port where web server will run
  readonly webServerCommand: {
    readonly local: string;
    readonly ci: string;
  };
}

// Discriminated union: only valid state combinations are representable
export type SiteConfig = HostingEmulatorConfig | WebServerConfig;

/**
 * Validates SiteConfig invariants at runtime.
 * Throws an error if the configuration violates constraints.
 */
export function validateSiteConfig(config: SiteConfig): void {
  // Validate port range
  if (config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid port: ${config.port}. Port must be between 1 and 65535.`);
  }

  // Validate env values (no undefined values allowed in Record<string, string>)
  if (config.env) {
    for (const [key, value] of Object.entries(config.env)) {
      if (value === undefined) {
        throw new Error(
          `Environment variable "${key}" has undefined value. All env values must be strings.`
        );
      }
    }
  }

  // Validate mode-specific requirements
  if (config.mode === 'web-server') {
    if (!config.webServerCommand?.local || !config.webServerCommand?.ci) {
      throw new Error('WebServerConfig requires both local and ci webServerCommand values.');
    }
  }
}

/**
 * Gets web server configuration with proper type narrowing.
 * Returns undefined for hosting-emulator mode or when using deployed URL.
 */
function getWebServerConfig(site: SiteConfig): PlaywrightTestConfig['webServer'] {
  if (site.mode === 'hosting-emulator') {
    // Modern: No webServer needed, emulators started externally
    return undefined;
  }

  // TypeScript now knows site is WebServerConfig due to discriminated union
  return {
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
  };
}

export function createPlaywrightConfig(site: SiteConfig): PlaywrightTestConfig {
  // Validate configuration before use
  validateSiteConfig(site);

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
    // Worker configuration:
    // - CI with sharding: 1 worker per shard for isolation (shards run in parallel on separate machines)
    // - CI without sharding: 2 workers for parallel execution
    // - Local development: 2 workers for faster test execution
    // Each worker gets isolated Firestore collection via TEST_PARALLEL_INDEX
    workers: process.env.CI && process.env.PLAYWRIGHT_SHARD ? 1 : 2,
    timeout: site.timeout || 60000,
    maxFailures: 1, // Stop on first test failure
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

    webServer: isDeployed ? undefined : getWebServerConfig(site),
  });
}
