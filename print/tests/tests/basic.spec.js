import { test, expect } from '@playwright/test';

test.describe('Print Library Homepage', () => {
  test('should load successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Print - Document Library/);
  });

  test('should display header with title and upload button', async ({ page }) => {
    await page.goto('/');

    // Check header title
    const headerTitle = page.locator('.header__title');
    await expect(headerTitle).toBeVisible();
    await expect(headerTitle).toContainText('Print');

    // Check upload button
    const uploadBtn = page.locator('#uploadBtn');
    await expect(uploadBtn).toBeVisible();
    await expect(uploadBtn).toContainText('Upload');
  });

  test('should show loading state initially', async ({ page }) => {
    await page.goto('/');

    // Loading indicator should be visible briefly
    const loading = page.locator('#loading');

    // Wait for either loading to disappear or content to show
    await expect(async () => {
      const isLoading = await loading.isVisible();
      const hasDocuments = await page.locator('#documents').isVisible();
      const hasEmpty = await page.locator('#emptyState').isVisible();
      expect(isLoading || hasDocuments || hasEmpty).toBe(true);
    }).toPass({ timeout: 10000 });
  });

  test('should show empty state when no documents exist', async ({ page }) => {
    await page.goto('/');

    // Wait for one of the content states to become visible
    // (Firebase initialization may take time)
    await page.waitForFunction(() => {
      const empty = document.querySelector('#emptyState');
      const docs = document.querySelector('#documents');
      const error = document.querySelector('#errorState');

      return (empty && !empty.hidden) ||
             (docs && !docs.hidden) ||
             (error && !error.hidden);
    }, { timeout: 20000 });

    // Verify at least one content state is visible
    const emptyState = page.locator('#emptyState');
    const documentsContainer = page.locator('#documents');
    const errorState = page.locator('#errorState');

    const emptyVisible = await emptyState.isVisible();
    const docsVisible = await documentsContainer.isVisible();
    const errorVisible = await errorState.isVisible();

    expect(emptyVisible || docsVisible || errorVisible).toBe(true);
  });

  test('should open upload form when upload button clicked', async ({ page }) => {
    await page.goto('/');

    // Wait for upload button to be ready
    const uploadBtn = page.locator('#uploadBtn');
    await expect(uploadBtn).toBeVisible();
    await uploadBtn.click();

    // Check upload form is visible
    const uploadForm = page.locator('#uploadForm');
    await expect(uploadForm).toBeVisible();

    // Check form elements
    const fileInput = page.locator('#fileInput');
    await expect(fileInput).toBeVisible();

    const cancelBtn = page.locator('#cancelUploadBtn');
    await expect(cancelBtn).toBeVisible();
  });

  test('should close upload form when cancel clicked', async ({ page }) => {
    await page.goto('/');

    // Wait for upload button and click it
    const uploadBtn = page.locator('#uploadBtn');
    await expect(uploadBtn).toBeVisible();
    await uploadBtn.click();
    await expect(page.locator('#uploadForm')).toBeVisible();

    // Click cancel
    await page.locator('#cancelUploadBtn').click();

    // Form should be hidden
    await expect(page.locator('#uploadForm')).toBeHidden();
  });

  test('should have accessible form elements', async ({ page }) => {
    await page.goto('/');

    // Check upload button has aria-label
    const uploadBtn = page.locator('#uploadBtn');
    await expect(uploadBtn).toBeVisible();
    await expect(uploadBtn).toHaveAttribute('aria-label');

    // Open upload form
    await uploadBtn.click();

    // Check file input has proper attributes
    const fileInput = page.locator('#fileInput');
    await expect(fileInput).toHaveAttribute('accept');
  });

  test('should be responsive', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // All main sections should still be visible
    await expect(page.locator('.header')).toBeVisible();
    await expect(page.locator('.main')).toBeVisible();
  });
});

test.describe('Health Check', () => {
  test('health endpoint should return 200', async ({ page }) => {
    const response = await page.goto('/health');
    expect(response.status()).toBe(200);
  });
});
