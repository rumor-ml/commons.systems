import { test, expect } from '@playwright/test';

test.describe('Console Errors', () => {
  let consoleErrors: string[] = [];
  let consoleWarnings: string[] = [];
  let httpErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    // Reset error/warning arrays for each test
    consoleErrors = [];
    consoleWarnings = [];
    httpErrors = [];

    // Capture console errors
    page.on('console', async (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // If we see "JSHandle@object", inspect the actual arguments to capture Error objects
        if (text === 'JSHandle@object') {
          const args = msg.args();
          for (const arg of args) {
            try {
              const jsonValue = await arg.jsonValue();
              if (
                jsonValue instanceof Error ||
                (jsonValue && typeof jsonValue === 'object' && 'message' in jsonValue)
              ) {
                consoleErrors.push(
                  `Error object: ${jsonValue.message || JSON.stringify(jsonValue)}`
                );
              }
            } catch {
              // If we can't convert to JSON, use the text representation
              const textValue = await arg.evaluate((obj) => String(obj));
              consoleErrors.push(textValue);
            }
          }
        } else {
          consoleErrors.push(text);
        }
      }
      if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    // Capture page errors (uncaught exceptions)
    page.on('pageerror', (error) => {
      consoleErrors.push(`Uncaught exception: ${error.message}`);
    });

    // Capture HTTP errors (4xx/5xx responses)
    page.on('response', (response) => {
      if (response.status() >= 400) {
        httpErrors.push(`${response.status()} from ${response.url()}`);
      }
    });
  });

  test('home page should load without console errors', async ({ page }) => {
    await page.goto('/');

    // Wait for auth initialization to complete
    await page.waitForFunction(() => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 10000);
        document.addEventListener(
          'auth-ready',
          () => {
            clearTimeout(timeout);
            resolve(true);
          },
          { once: true }
        );
      });
    });

    // Wait for page to be fully loaded
    await page.waitForLoadState('networkidle');

    // Check for console errors
    expect(consoleErrors, `Console errors found:\n${consoleErrors.join('\n')}`).toEqual([]);

    // Check for HTTP errors
    expect(httpErrors, `HTTP errors found:\n${httpErrors.join('\n')}`).toEqual([]);

    // Verify page loaded correctly
    await expect(page.locator('h1')).toContainText('Sync Files');
  });

  test('sync form should load without errors', async ({ page }) => {
    await page.goto('/');

    // Wait for auth initialization to complete
    await page.waitForFunction(() => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 10000);
        document.addEventListener(
          'auth-ready',
          () => {
            clearTimeout(timeout);
            resolve(true);
          },
          { once: true }
        );
      });
    });

    await page.waitForLoadState('networkidle');

    // Wait for sync form to load via HTMX
    await page.waitForSelector('[hx-get="/partials/sync/form"]', {
      state: 'visible',
      timeout: 5000,
    });

    // Wait for HTMX to complete the request by checking for form input
    await page.waitForFunction(
      () => {
        const input = document.querySelector('input[name="directory"]');
        return input !== null;
      },
      { timeout: 10000 }
    );

    // Check for console errors
    expect(consoleErrors, `Console errors found:\n${consoleErrors.join('\n')}`).toEqual([]);

    // Check for HTTP errors
    expect(httpErrors, `HTTP errors found:\n${httpErrors.join('\n')}`).toEqual([]);
  });

  test('sync history should load without errors', async ({ page }) => {
    await page.goto('/');

    // Wait for auth initialization to complete
    await page.waitForFunction(() => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 10000);
        document.addEventListener(
          'auth-ready',
          () => {
            clearTimeout(timeout);
            resolve(true);
          },
          { once: true }
        );
      });
    });

    await page.waitForLoadState('networkidle');

    // Wait for history section to load
    await page.waitForSelector('#sync-history', { timeout: 5000 });

    // Wait for HTMX to complete requests by checking for content
    await page.waitForFunction(
      () => {
        const history = document.querySelector('#sync-history');
        return history && !history.textContent?.includes('Loading');
      },
      { timeout: 10000 }
    );

    // Check for console errors
    expect(consoleErrors, `Console errors found:\n${consoleErrors.join('\n')}`).toEqual([]);

    // Check for HTTP errors
    expect(httpErrors, `HTTP errors found:\n${httpErrors.join('\n')}`).toEqual([]);
  });

  test('no React DevTools warnings should appear', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for page to be fully rendered (main content visible)
    await page.waitForFunction(
      () => {
        const main = document.querySelector('main');
        return main !== null && main.children.length > 0;
      },
      { timeout: 10000 }
    );

    // Check that there are no React-related warnings
    const reactWarnings = consoleWarnings.filter(
      (w) => w.includes('React') || w.includes('react-devtools')
    );

    expect(reactWarnings, `React warnings found:\n${reactWarnings.join('\n')}`).toEqual([]);
  });

  test('JavaScript files should load successfully', async ({ page }) => {
    const failedResources: string[] = [];

    page.on('response', (response) => {
      if (response.url().endsWith('.js') && !response.ok()) {
        failedResources.push(`${response.url()} - ${response.status()}`);
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(failedResources, `Failed to load JS files:\n${failedResources.join('\n')}`).toEqual([]);

    // Verify specific JS files loaded
    const responses = await page.evaluate(() => {
      return performance
        .getEntriesByType('resource')
        .filter((r: any) => r.name.endsWith('.js'))
        .map((r: any) => ({ name: r.name, transferSize: r.transferSize }));
    });

    // file-selection.js should be loaded
    const fileSelectionLoaded = responses.some((r: any) => r.name.includes('file-selection.js'));
    expect(fileSelectionLoaded, 'file-selection.js should be loaded').toBe(true);

    // islands.js should NOT be loaded (we removed it)
    const islandsLoaded = responses.some((r: any) => r.name.includes('islands.js'));
    expect(islandsLoaded, 'islands.js should not be loaded (removed React islands)').toBe(false);
  });

  test('HTMX should be loaded and working', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check if HTMX is defined
    const htmxLoaded = await page.evaluate(() => typeof (window as any).htmx !== 'undefined');
    expect(htmxLoaded, 'HTMX should be loaded').toBe(true);

    // Check if SSE extension is loaded
    const sseExtLoaded = await page.evaluate(() => {
      const htmx = (window as any).htmx;
      return htmx && htmx.createEventSource !== undefined;
    });
    expect(sseExtLoaded, 'HTMX SSE extension should be loaded').toBe(true);

    // Check for HTMX-related console errors
    const htmxErrors = consoleErrors.filter(
      (e) => e.includes('htmx') || e.includes('HTMX') || e.includes('hx-')
    );
    expect(htmxErrors, `HTMX errors found:\n${htmxErrors.join('\n')}`).toEqual([]);

    // Check for HTTP errors
    expect(httpErrors, `HTTP errors found:\n${httpErrors.join('\n')}`).toEqual([]);
  });

  test('sync start should not cause SSE errors', async ({ page }) => {
    await page.goto('/');

    // Wait for auth token cookie to be set
    await page.waitForFunction(
      () => {
        return document.cookie.includes('firebase_token');
      },
      { timeout: 10000 }
    );

    // Wait for auth-ready event
    await page.waitForFunction(() => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 10000);
        document.addEventListener(
          'auth-ready',
          () => {
            clearTimeout(timeout);
            resolve(true);
          },
          { once: true }
        );
      });
    });

    // Wait for sync form to load
    const directoryInput = page.locator('input#directory');
    await directoryInput.waitFor({ state: 'visible', timeout: 5000 });

    // Fill in directory path and submit
    await directoryInput.fill('/tmp/test-ebooks');

    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // Wait for sync progress UI to appear
    await page.waitForSelector('#sync-progress', { state: 'visible', timeout: 5000 });

    // Wait for SSE connection to establish by checking for SSE element
    await page.waitForFunction(
      () => {
        const sseElement = document.querySelector('[hx-ext="sse"]');
        return sseElement !== null && sseElement.hasAttribute('sse-connect');
      },
      { timeout: 10000 }
    );

    // Check for SSE/EventSource errors
    const sseErrors = consoleErrors.filter(
      (e) =>
        e.includes('EventSource') ||
        e.includes('SSE') ||
        e.includes('sse-connect') ||
        e.includes('streaming')
    );
    expect(sseErrors, `SSE errors found:\n${sseErrors.join('\n')}`).toEqual([]);

    // Check for HTTP errors
    expect(httpErrors, `HTTP errors found:\n${httpErrors.join('\n')}`).toEqual([]);
  });
});
