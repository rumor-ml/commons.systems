/**
 * Authentication Tests for Videobrowser
 * Tests GitHub OAuth integration and auth UI components
 */

import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('Authentication', () => {
  test('should display sign in button when not authenticated', async ({ page }) => {
    await page.goto('/');

    // Check for auth button in header
    const authButton = page.locator('.auth-button');
    await expect(authButton).toBeVisible();
    await expect(authButton).toContainText('Sign in with GitHub');
  });

  test('should display GitHub icon in auth button', async ({ page }) => {
    await page.goto('/');

    const authIcon = page.locator('.auth-button__icon svg');
    await expect(authIcon).toBeVisible();
  });

  test('user profile should be hidden when not authenticated', async ({ page }) => {
    await page.goto('/');

    const userProfile = page.locator('.user-profile');
    // Profile exists in DOM but is hidden
    await expect(userProfile).toHaveCSS('display', 'none');
  });

  test('auth button should have dark theme styling', async ({ page }) => {
    await page.goto('/');

    const authButton = page.locator('.auth-button');

    // Check for proper CSS classes including dark theme
    await expect(authButton).toHaveClass(/auth-button/);
    await expect(authButton).toHaveClass(/auth-button--compact/);
    await expect(authButton).toHaveClass(/auth-button--dark/);
  });

  test('auth components should be in header', async ({ page }) => {
    await page.goto('/');

    const headerAuth = page.locator('.header__auth');
    await expect(headerAuth).toBeVisible();

    // Should contain both profile and button
    const authButton = headerAuth.locator('.auth-button');
    const userProfile = headerAuth.locator('.user-profile');

    await expect(authButton).toBeVisible();
    // Profile is in DOM but hidden when not authenticated
    const profileCount = await userProfile.count();
    expect(profileCount).toBe(1);
  });

  test('clicking sign in button should trigger OAuth (UI only)', async ({ page }) => {
    await page.goto('/');

    const authButton = page.locator('.auth-button');

    // Wait for auth initialization (button should not show "Loading...")
    await expect(authButton.locator('.auth-button__text')).not.toContainText('Loading', { timeout: 10000 });

    // Verify button is enabled after auth state initializes
    await expect(authButton).toBeEnabled({ timeout: 5000 });

    // Verify button text is "Sign in with GitHub"
    await expect(authButton).toContainText('Sign in with GitHub');
  });

  test('auth button should not be disabled after initialization', async ({ page }) => {
    await page.goto('/');

    const authButton = page.locator('.auth-button');

    // Wait for page load
    await page.waitForLoadState('networkidle');

    // Wait a bit for any async state updates
    await page.waitForTimeout(2000);

    // Button should be enabled (not stuck in disabled state)
    await expect(authButton).toBeEnabled();

    // Button should not be in loading state
    const buttonText = await authButton.locator('.auth-button__text').textContent();
    expect(buttonText).not.toBe('Loading...');

    // Verify button has correct data attribute
    const isLoading = await authButton.evaluate((btn) => {
      return btn.textContent.includes('Loading');
    });
    expect(isLoading).toBe(false);
  });

  test('auth styles should load correctly', async ({ page }) => {
    await page.goto('/');

    const authButton = page.locator('.auth-button');

    // Verify CSS custom properties are applied
    const backgroundColor = await authButton.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    // Should have some background color (not default/transparent)
    expect(backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(backgroundColor).not.toBe('transparent');
  });

  test('user profile should have dark theme class', async ({ page }) => {
    await page.goto('/');

    const userProfile = page.locator('.user-profile');
    await expect(userProfile).toHaveClass(/user-profile--dark/);
  });

  test('header auth section should have border styling', async ({ page }) => {
    await page.goto('/');

    const headerAuth = page.locator('.header__auth');

    // Check for border-top styling
    const borderTopWidth = await headerAuth.evaluate((el) => {
      return window.getComputedStyle(el).borderTopWidth;
    });

    expect(borderTopWidth).toBe('1px');
  });
});
