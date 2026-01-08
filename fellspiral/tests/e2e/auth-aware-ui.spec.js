/**
 * Auth-Aware UI Tests
 * Tests visibility of CRUD controls based on authentication state
 */

import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('Auth-Aware UI - Logged Out State', () => {
  test('should hide Add Card button when logged out', async ({ page }) => {
    await page.goto('/cards.html');

    const addCardBtn = page.locator('#addCardBtn');
    await expect(addCardBtn).toBeAttached();
    await expect(addCardBtn).toHaveCSS('display', 'none');
  });

  test('should hide Import button when logged out', async ({ page }) => {
    await page.goto('/cards.html');

    const importBtn = page.locator('#importCardsBtn');
    await expect(importBtn).toBeAttached();
    await expect(importBtn).toHaveCSS('display', 'none');
  });

  test('should hide Export button when logged out', async ({ page }) => {
    await page.goto('/cards.html');

    const exportBtn = page.locator('#exportCardsBtn');
    await expect(exportBtn).toBeAttached();
    await expect(exportBtn).toHaveCSS('display', 'none');
  });

  test('should not have authenticated class on body when logged out', async ({ page }) => {
    await page.goto('/cards.html');

    const body = page.locator('body');
    await expect(body).not.toHaveClass(/authenticated/);
  });

  test('all auth-controls should be hidden when logged out', async ({ page }) => {
    await page.goto('/cards.html');

    // Get all elements with auth-controls class
    const authControls = page.locator('.auth-controls');
    const count = await authControls.count();

    // Verify all are hidden
    for (let i = 0; i < count; i++) {
      const control = authControls.nth(i);
      await expect(control).toHaveCSS('display', 'none');
    }
  });
});

test.describe('Auth-Aware UI - Modal Controls', () => {
  test('should hide Delete button in modal when logged out', async ({ page }) => {
    await page.goto('/cards.html');

    // Delete button should be in DOM but hidden
    const deleteBtn = page.locator('#deleteCardBtn');
    await expect(deleteBtn).toBeAttached();
    await expect(deleteBtn).toHaveCSS('display', 'none');
  });

  test('should hide Save button in modal when logged out', async ({ page }) => {
    await page.goto('/cards.html');

    // Save button should be in DOM but hidden
    const saveBtn = page.locator('#saveCardBtn');
    await expect(saveBtn).toBeAttached();
    await expect(saveBtn).toHaveCSS('display', 'none');
  });

  test('modal should not be open initially', async ({ page }) => {
    await page.goto('/cards.html');

    const modal = page.locator('#cardEditorModal');
    await expect(modal).not.toHaveClass(/active/);
  });
});

test.describe('Auth-Aware UI - Body Class Management', () => {
  test('body should not have authenticated class on page load', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for page to load
    await page.waitForSelector('.card-toolbar', { timeout: 5000 });

    const body = page.locator('body');
    await expect(body).not.toHaveClass(/authenticated/);
  });

  test('body should not have authenticated class on homepage', async ({ page }) => {
    await page.goto('/');

    // Wait for page to load
    await page.waitForSelector('#introduction', { timeout: 5000 });

    const body = page.locator('body');
    await expect(body).not.toHaveClass(/authenticated/);
  });
});

test.describe('Auth-Aware UI - CSS Verification', () => {
  test('auth-controls class should have display:none by default', async ({ page }) => {
    await page.goto('/cards.html');

    // Check computed styles for auth-controls class
    const addCardBtn = page.locator('#addCardBtn.auth-controls');
    const display = await addCardBtn.evaluate((el) => {
      return window.getComputedStyle(el).display;
    });

    expect(display).toBe('none');
  });

  test('body without authenticated class should hide auth-controls', async ({ page }) => {
    await page.goto('/cards.html');

    // Verify body doesn't have authenticated class
    const body = page.locator('body');
    await expect(body).not.toHaveClass(/authenticated/);

    // Verify auth controls are hidden
    const authControls = page.locator('.auth-controls');
    const firstControl = authControls.first();
    await expect(firstControl).toHaveCSS('display', 'none');
  });
});

test.describe('Auth-Aware UI - Read-Only Mode', () => {
  // TODO(#1264): Fix flaky card loading timeout with parallel execution
  test.skip('should allow viewing cards when logged out', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for cards to load
    await page.waitForSelector('.card-item, .empty-state', { timeout: 5000 });

    // Card list should be visible
    const cardList = page.locator('#cardList');
    await expect(cardList).toBeVisible();
  });

  test('should allow using search when logged out', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for page to load
    await page.waitForSelector('#searchCards', { timeout: 5000 });

    const searchInput = page.locator('#searchCards');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeEnabled();

    // Should be able to type in search
    await searchInput.fill('sword');
    await expect(searchInput).toHaveValue('sword');
  });
});
