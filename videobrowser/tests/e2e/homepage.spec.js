import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('Video Browser Homepage', () => {
  test('should load successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Video Browser/);
  });

  test('should display header with title and subtitle', async ({ page }) => {
    await page.goto('/');

    // Check header title
    const headerTitle = page.locator('.header__title');
    await expect(headerTitle).toBeVisible();
    await expect(headerTitle).toContainText('Video Browser');

    // Check subtitle
    const subtitle = page.locator('.header__subtitle');
    await expect(subtitle).toBeVisible();
    await expect(subtitle).toContainText('rml-media/video');
  });

  test('should display video player', async ({ page }) => {
    await page.goto('/');

    // Check video player exists
    const videoPlayer = page.locator('#videoPlayer');
    await expect(videoPlayer).toBeVisible();

    // Check video info section
    const videoInfo = page.locator('#videoInfo');
    await expect(videoInfo).toBeVisible();
  });

  test('should display controls', async ({ page }) => {
    await page.goto('/');

    // Check refresh button
    const refreshBtn = page.locator('#refreshBtn');
    await expect(refreshBtn).toBeVisible();
    await expect(refreshBtn).toContainText('Refresh');

    // Check search input
    const searchInput = page.locator('#searchInput');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute('placeholder', /Search/i);
  });

  test('should display file list section', async ({ page }) => {
    await page.goto('/');

    // Check file list exists
    const fileList = page.locator('#fileList');
    await expect(fileList).toBeVisible();

    // Check stats section
    const stats = page.locator('#stats');
    await expect(stats).toBeVisible();
    await expect(stats).toContainText('Total videos:');
  });

  test('should show loading indicator initially', async ({ page }) => {
    await page.goto('/');

    // Loading indicator should be visible briefly
    const loadingIndicator = page.locator('#loadingIndicator');

    // Wait for either loading to disappear or file list to populate
    await expect(async () => {
      const isLoading = await loadingIndicator.isVisible();
      const hasContent = (await page.locator('.file-item, .empty-state, .error').count()) > 0;
      expect(isLoading || hasContent).toBe(true);
    }).toPass({ timeout: 10000 });
  });

  test('should have accessible video controls', async ({ page }) => {
    await page.goto('/');

    // Check video element has controls attribute
    const videoPlayer = page.locator('#videoPlayer');
    await expect(videoPlayer).toHaveAttribute('controls');

    // Check buttons have proper aria labels
    const refreshBtn = page.locator('#refreshBtn');
    await expect(refreshBtn).toHaveAttribute('aria-label');

    const searchInput = page.locator('#searchInput');
    await expect(searchInput).toHaveAttribute('aria-label');
  });

  test('should be responsive', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // All main sections should still be visible
    await expect(page.locator('.header')).toBeVisible();
    await expect(page.locator('.video-player')).toBeVisible();
    await expect(page.locator('.browser-section')).toBeVisible();
  });
});
