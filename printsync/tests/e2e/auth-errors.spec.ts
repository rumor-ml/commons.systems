import { test, expect } from '@playwright/test';

test.describe('Auth Error Handling', () => {
  test('should display warning toast for localStorage quota exceeded', async ({ page }) => {
    // Navigate to homepage
    await page.goto('/');

    // Wait for page to load
    await page.waitForLoadState('domcontentloaded');

    // Inject a mock that makes localStorage.setItem throw QuotaExceededError
    await page.evaluate(() => {
      const originalSetItem = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function (key: string, value: string) {
        if (key === 'commons_auth_state') {
          const err = new Error('QuotaExceededError');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return originalSetItem(key, value);
      };
    });

    // Trigger auth state change that will attempt to persist
    await page.evaluate(() => {
      // Simulate auth state update that triggers storage
      const event = new CustomEvent('auth-state-update');
      window.dispatchEvent(event);
    });

    // Wait for toast to appear
    const toast = page.locator('.toast.toast--warning');
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Verify toast content
    await expect(toast.locator('.toast__title')).toContainText('Storage Error');
    await expect(toast.locator('.toast__body')).toContainText('Browser storage is full');

    // Verify action button is present
    const actionButton = toast.locator('.toast__action button');
    await expect(actionButton).toBeVisible();
    await expect(actionButton).toContainText('Clear and Reload');
  });

  test('should display toast and clear corrupted localStorage data', async ({ page }) => {
    // Set corrupted data in localStorage before navigation
    await page.addInitScript(() => {
      localStorage.setItem('commons_auth_state', '{invalid json!!!}');
    });

    // Navigate to homepage
    await page.goto('/');

    // Wait for page to load
    await page.waitForLoadState('domcontentloaded');

    // Wait for toast to appear
    const toast = page.locator('.toast.toast--warning');
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Verify toast content
    await expect(toast.locator('.toast__title')).toContainText('Storage Error');
    await expect(toast.locator('.toast__body')).toContainText('corrupted');

    // Verify corrupted data was cleared
    const clearedData = await page.evaluate(() => {
      return localStorage.getItem('commons_auth_state');
    });
    expect(clearedData).toBeNull();

    // Verify action button is present
    const actionButton = toast.locator('.toast__action button');
    await expect(actionButton).toBeVisible();
    await expect(actionButton).toContainText('Clear and Reload');
  });

  test('should trigger error toast with refresh action for systemic listener failures', async ({
    page,
  }) => {
    // Navigate to homepage
    await page.goto('/');

    // Wait for auth to initialize
    await page.waitForFunction(
      () => {
        return document.cookie.includes('firebase_token=');
      },
      { timeout: 15000 }
    );

    // Inject code to simulate multiple listener failures
    await page.evaluate(() => {
      // Force listener failures by subscribing with failing listeners
      const { subscribeToAuthState } = (window as any).authState || {};
      if (subscribeToAuthState) {
        // Create 3 listeners that will fail
        for (let i = 0; i < 3; i++) {
          subscribeToAuthState(() => {
            throw new Error(`Listener failure ${i + 1}`);
          });
        }

        // Trigger auth state change to invoke listeners
        const event = new CustomEvent('auth-state-change');
        window.dispatchEvent(event);
      }
    });

    // Wait for error toast to appear
    const toast = page.locator('.toast.toast--error');
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Verify toast content
    await expect(toast.locator('.toast__title')).toContainText('Authentication Error');
    await expect(toast.locator('.toast__body')).toContainText('Multiple authentication components');

    // Verify toast does NOT auto-dismiss (duration: 0)
    await page.waitForTimeout(6000); // Wait longer than typical auto-dismiss
    await expect(toast).toBeVisible();

    // Verify refresh action button
    const actionButton = toast.locator('.toast__action button');
    await expect(actionButton).toBeVisible();
    await expect(actionButton).toContainText('Refresh Page');
  });

  test('should include structured error in auth-ready event', async ({ page }) => {
    // Listen for auth-ready event before navigation
    const authReadyPromise = page.evaluate(() => {
      return new Promise((resolve) => {
        document.addEventListener(
          'auth-ready',
          (event: any) => {
            resolve(event.detail);
          },
          { once: true }
        );
      });
    });

    // Navigate to homepage
    await page.goto('/');

    // Wait for auth-ready event
    const authReadyDetail = await authReadyPromise;

    // Verify event detail structure
    expect(authReadyDetail).toBeTruthy();
    expect(authReadyDetail).toHaveProperty('authenticated');

    // If there's an error, verify it has the correct structure
    if ((authReadyDetail as any).error) {
      const error = (authReadyDetail as any).error;
      expect(error).toHaveProperty('code');
      expect(error).toHaveProperty('message');
      expect(error.code).toMatch(/^auth\//); // Should start with 'auth/'
    }
  });

  test('should auto-dismiss toast after specified duration', async ({ page }) => {
    // Navigate to homepage
    await page.goto('/');

    // Wait for page to load
    await page.waitForLoadState('domcontentloaded');

    // Show a toast with short duration
    await page.evaluate(() => {
      if ((window as any).showToast) {
        (window as any).showToast({
          title: 'Test Toast',
          message: 'This will auto-dismiss',
          type: 'info',
          duration: 2000, // 2 seconds
        });
      }
    });

    // Verify toast appears
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible();

    // Wait for auto-dismiss (2s + animation time)
    await page.waitForTimeout(2500);

    // Verify toast is gone
    await expect(toast).not.toBeVisible();
  });

  test('should dismiss toast immediately when close button clicked', async ({ page }) => {
    // Navigate to homepage
    await page.goto('/');

    // Wait for page to load
    await page.waitForLoadState('domcontentloaded');

    // Show a toast with no auto-dismiss
    await page.evaluate(() => {
      if ((window as any).showToast) {
        (window as any).showToast({
          title: 'Test Toast',
          message: 'Click close to dismiss',
          type: 'info',
          duration: 0, // No auto-dismiss
        });
      }
    });

    // Verify toast appears
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible();

    // Click close button
    const closeButton = toast.locator('.toast__close');
    await closeButton.click();

    // Wait for dismiss animation
    await page.waitForTimeout(500);

    // Verify toast is gone
    await expect(toast).not.toBeVisible();
  });

  test('should dispatch auth-error event for storage failures', async ({ page }) => {
    // Listen for auth-error event before navigation
    const authErrorPromise = page.evaluate(() => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 10000);
        window.addEventListener(
          'auth-error',
          (event: any) => {
            clearTimeout(timeout);
            resolve(event.detail);
          },
          { once: true }
        );
      });
    });

    // Set corrupted data in localStorage before navigation
    await page.addInitScript(() => {
      localStorage.setItem('commons_auth_state', '{invalid json}');
    });

    // Navigate to homepage
    await page.goto('/');

    // Wait for auth-error event
    const authErrorDetail = await authErrorPromise;

    // Verify event was dispatched with correct structure
    expect(authErrorDetail).toBeTruthy();
    expect(authErrorDetail).toHaveProperty('code');
    expect(authErrorDetail).toHaveProperty('message');
    expect(authErrorDetail).toHaveProperty('recoverable');
    expect((authErrorDetail as any).code).toMatch(/^auth\//);
  });
});
