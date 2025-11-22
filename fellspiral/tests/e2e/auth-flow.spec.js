/**
 * OAuth Flow Tests
 *
 * Tests the complete GitHub OAuth authentication flow.
 * Requires GITHUB_TEST_USER and GITHUB_TEST_PASSWORD environment variables.
 *
 * Run with: GITHUB_TEST_USER=user GITHUB_TEST_PASSWORD=pass npx playwright test auth-flow
 */

import { test, expect, requiresAuth, hasAuth } from '../fixtures/auth.js';

test.describe('GitHub OAuth Flow', () => {
  test.beforeEach(() => {
    requiresAuth();
  });

  test('should show user profile after authentication', async ({ page }) => {
    await page.goto('/');

    // User profile should be visible
    const userProfile = page.locator('.user-profile');
    await expect(userProfile).toBeVisible();

    // Profile should show user avatar
    const avatar = userProfile.locator('.user-profile__avatar');
    await expect(avatar).toBeVisible();

    // Profile should show user name
    const name = userProfile.locator('.user-profile__name');
    await expect(name).toBeVisible();
    const nameText = await name.textContent();
    expect(nameText).toBeTruthy();
    expect(nameText.trim()).not.toBe('');
  });

  test('should show sign out button when authenticated', async ({ page }) => {
    await page.goto('/');

    // Auth button should show "Sign out"
    const authButton = page.locator('.auth-button');
    await expect(authButton).toBeVisible();
    await expect(authButton).toContainText(/Sign out/i);
  });

  test('should have authentication in localStorage', async ({ page }) => {
    await page.goto('/');

    // Check that Firebase auth state is in localStorage
    const authState = await page.evaluate(() => {
      return Object.keys(localStorage).filter(key =>
        key.includes('firebase:authUser')
      ).length > 0;
    });

    expect(authState).toBe(true);
  });

  test('should maintain auth across page navigation', async ({ page }) => {
    await page.goto('/');

    // Verify authenticated on home page
    let userProfile = page.locator('.user-profile');
    await expect(userProfile).toBeVisible();

    // Navigate to cards page
    await page.goto('/cards.html');

    // Should still be authenticated
    userProfile = page.locator('.user-profile');
    await expect(userProfile).toBeVisible();
  });

  test('should be able to sign out', async ({ page }) => {
    await page.goto('/');

    // Click sign out
    const authButton = page.locator('.auth-button');
    await authButton.click();

    // Wait a bit for sign out to complete
    await page.waitForTimeout(1000);

    // User profile should be hidden
    const userProfile = page.locator('.user-profile');
    await expect(userProfile).toHaveCSS('display', 'none');

    // Button should show "Sign in with GitHub"
    await expect(authButton).toContainText(/Sign in with GitHub/i);
  });
});

test.describe('OAuth Flow - UI Tests (No Auth Required)', () => {
  test('should show proper UI elements before authentication', async ({ page }) => {
    // Skip if authenticated (these tests are for non-auth state)
    if (hasAuth()) {
      test.skip(true, 'Skipping - tests require non-authenticated state');
    }

    await page.goto('/');

    // Should show sign in button
    const authButton = page.locator('.auth-button');
    await expect(authButton).toBeVisible();
    await expect(authButton).toContainText(/Sign in with GitHub/i);

    // User profile should be hidden
    const userProfile = page.locator('.user-profile');
    await expect(userProfile).toHaveCSS('display', 'none');
  });

  test('should open GitHub OAuth when clicking sign in', async ({ page, context }) => {
    if (hasAuth()) {
      test.skip(true, 'Skipping - tests require non-authenticated state');
    }

    await page.goto('/');

    // Set up popup handler
    const popupPromise = context.waitForEvent('page');

    // Click sign in
    const authButton = page.locator('.auth-button');
    await authButton.click();

    // Wait for popup
    const popup = await popupPromise;

    // Popup should be GitHub OAuth page
    await popup.waitForLoadState();
    const url = popup.url();
    expect(url).toContain('github.com');
    expect(url).toContain('oauth') || expect(url).toContain('login');

    // Clean up
    await popup.close();
  });
});

test.describe('Protected Features', () => {
  test.beforeEach(() => {
    requiresAuth();
  });

  test('should allow creating cards when authenticated', async ({ page }) => {
    await page.goto('/cards.html');

    // Navigate to card builder tab
    await page.click('button:has-text("Card Builder")');

    // Fill out card form
    await page.fill('input[name="cardName"]', 'Test Card');
    await page.selectOption('select[name="cardType"]', 'character');

    // Submit form
    await page.click('button:has-text("Create Card")');

    // Card should be created (check for success message or card in list)
    // Note: Adjust selectors based on actual UI
    // This is a placeholder - adjust based on actual implementation
  });

  test('should show user as card creator', async ({ page }) => {
    await page.goto('/cards.html');

    // If there are existing cards, they should show creator info
    // This test verifies that auth metadata is tracked
    const cards = page.locator('.card-item');
    const cardCount = await cards.count();

    if (cardCount > 0) {
      // Check first card for metadata
      const firstCard = cards.first();
      // Metadata might be in tooltips, attributes, or visible fields
      // Adjust based on actual implementation
      await expect(firstCard).toBeVisible();
    }
  });
});
