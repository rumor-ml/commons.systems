import { test, expect } from '../../../playwright.fixtures.ts';

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

  test('should show loading state initially then resolve', async ({ page }) => {
    await page.goto('/');

    // Loading indicator should be visible initially
    const loading = page.locator('#loading');
    await expect(loading).toBeVisible();

    // Wait for loading to disappear and content state to appear
    // Reduced timeout to 10 seconds - document loading should be fast
    await page.waitForFunction(() => {
      const loadingEl = document.querySelector('#loading');
      return loadingEl && loadingEl.hidden;
    }, { timeout: 10000 });

    // Verify loading is now hidden
    await expect(loading).toBeHidden();

    // Verify exactly one content state is visible
    const emptyState = page.locator('#emptyState');
    const documentsContainer = page.locator('#documents');
    const errorState = page.locator('#errorState');

    const emptyVisible = await emptyState.isVisible();
    const docsVisible = await documentsContainer.isVisible();
    const errorVisible = await errorState.isVisible();

    // Exactly one state should be visible
    const visibleCount = [emptyVisible, docsVisible, errorVisible].filter(Boolean).length;
    expect(visibleCount).toBe(1);

    // CRITICAL: Firebase should be working - fail if timeout error occurs
    if (errorVisible) {
      const errorMessage = await page.locator('#errorMessage').textContent();
      console.log('Error state shown:', errorMessage);

      // Fail the test if it's a timeout error - this indicates Firebase isn't working
      expect(errorMessage).not.toContain('timed out');
      expect(errorMessage).not.toContain('timeout');

      // For other errors, just verify message exists
      expect(errorMessage).toBeTruthy();
      expect(errorMessage.length).toBeGreaterThan(0);
    }
  });

  test('should successfully load Firebase data', async ({ page }) => {
    // Capture console errors for debugging Firebase issues
    const consoleMessages = [];
    page.on('console', msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
    });

    await page.goto('/');

    // Wait for one of the SUCCESS states to become visible (docs or empty)
    // Firebase initialization should be quick - timeout errors indicate misconfiguration
    try {
      await page.waitForFunction(() => {
        const empty = document.querySelector('#emptyState');
        const docs = document.querySelector('#documents');

        return (empty && !empty.hidden) || (docs && !docs.hidden);
      }, { timeout: 10000 });
    } catch (e) {
      // Print console messages to help debug Firebase errors
      console.log('Browser console output:');
      consoleMessages.forEach(msg => console.log('  ', msg));
      throw e;
    }

    // Loading should be hidden once content is shown
    const loading = page.locator('#loading');
    await expect(loading).toBeHidden();

    // Verify exactly one SUCCESS state is visible (not error)
    const emptyState = page.locator('#emptyState');
    const documentsContainer = page.locator('#documents');
    const errorState = page.locator('#errorState');

    const emptyVisible = await emptyState.isVisible();
    const docsVisible = await documentsContainer.isVisible();
    const errorVisible = await errorState.isVisible();

    // Error state should NOT be visible - Firebase must work
    expect(errorVisible).toBe(false);

    // Either empty or docs should be visible
    expect(emptyVisible || docsVisible).toBe(true);

    // Log which state is shown for debugging
    if (emptyVisible) console.log('Empty state shown - no documents in storage');
    if (docsVisible) console.log('Documents shown successfully');
  });

  test('should not hang on loading state indefinitely', async ({ page }) => {
    await page.goto('/');

    // Loading should resolve within 10 seconds
    await page.waitForFunction(() => {
      const loading = document.querySelector('#loading');
      return loading && loading.hidden;
    }, { timeout: 10000 });

    // Verify a final state is reached
    const emptyState = page.locator('#emptyState');
    const documentsContainer = page.locator('#documents');
    const errorState = page.locator('#errorState');

    const emptyVisible = await emptyState.isVisible();
    const docsVisible = await documentsContainer.isVisible();
    const errorVisible = await errorState.isVisible();

    // At least one final state should be visible
    expect(emptyVisible || docsVisible || errorVisible).toBe(true);

    // If error state, should not be a timeout error
    if (errorVisible) {
      const errorMessage = await page.locator('#errorMessage').textContent();
      expect(errorMessage).not.toContain('timed out');
      expect(errorMessage).not.toContain('timeout');
    }
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
