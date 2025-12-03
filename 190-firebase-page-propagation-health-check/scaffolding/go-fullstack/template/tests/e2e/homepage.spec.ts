// {{APP_NAME}}/tests/e2e/homepage.spec.ts
import { test, expect } from '../../../playwright.fixtures';

test.describe('Homepage', () => {
  test('loads successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/{{APP_NAME_TITLE}}/);
  });

  test('HTMX partial loading works', async ({ page }) => {
    await page.goto('/');

    // Wait for HTMX to load partials
    const itemsList = page.locator('#items-list');
    await expect(itemsList).toBeVisible();
    await expect(itemsList).not.toContainText('Loading...');
  });

  test('React island hydrates', async ({ page }) => {
    await page.goto('/');

    // Check React island is hydrated
    const island = page.locator('[data-island-component="DataChart"]');
    await expect(island).toHaveAttribute('data-island-hydrated', 'true');
  });

  test('health endpoint returns OK', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toBe('healthy');
  });

  test('navigation works', async ({ page }) => {
    await page.goto('/');

    // Click dashboard link
    await page.click('a[href="/dashboard"]');
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.locator('h1')).toContainText('Dashboard');

    // Navigate back
    await page.click('a[href="/"]');
    await expect(page).toHaveURL(/\/$/);
  });
});
