// playwright.fixtures.ts
import { test as base } from '@playwright/test';

interface AuthTokens {
  wsEndpoint: string;
}

async function getRemoteBrowserEndpoint(): Promise<string | null> {
  const serverUrl = process.env.PLAYWRIGHT_SERVER_URL;
  if (!serverUrl) return null;

  // Get OIDC token from environment (set by CI) or gcloud
  let oidcToken = process.env.PLAYWRIGHT_OIDC_TOKEN;

  if (!oidcToken && process.env.CI) {
    // In CI, token should be pre-set
    throw new Error('PLAYWRIGHT_OIDC_TOKEN not set in CI environment');
  }

  if (!oidcToken) {
    // Local dev: get token via gcloud (requires gcloud auth)
    const { execSync } = await import('child_process');
    try {
      const accessToken = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
      const audience = `https://${new URL(serverUrl).host}`;
      oidcToken = execSync(
        `gcloud auth print-identity-token --audiences=${audience}`,
        { encoding: 'utf8' }
      ).trim();
    } catch (e) {
      console.warn('Could not get OIDC token, falling back to local browser');
      return null;
    }
  }

  // Exchange OIDC token for WebSocket endpoint
  const response = await fetch(`${serverUrl}/api/browser-endpoint`, {
    headers: { 'Authorization': `Bearer ${oidcToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to get browser endpoint: ${response.status}`);
  }

  const data = await response.json();
  return data.wsEndpoint;
}

// Extended test with automatic remote browser setup
export const test = base.extend<{}, { remoteBrowser: void }>({
  remoteBrowser: [async ({}, use, workerInfo) => {
    // Only set up once per worker
    if (workerInfo.workerIndex === 0 && !process.env.PLAYWRIGHT_WS_ENDPOINT) {
      const wsEndpoint = await getRemoteBrowserEndpoint();
      if (wsEndpoint) {
        process.env.PLAYWRIGHT_WS_ENDPOINT = wsEndpoint;
      }
    }
    await use();
  }, { scope: 'worker', auto: true }],
});

export { expect } from '@playwright/test';
