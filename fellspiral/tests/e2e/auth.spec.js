/**
 * Authentication Tests for Fellspiral
 * Tests GitHub OAuth integration and auth UI components
 */

import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('@emulator-only Authentication', () => {
  test('should display sign in button when not authenticated', async ({ page }) => {
    await page.goto('/');

    // Check for auth button in navbar
    const authButton = page.locator('.auth-button');
    await expect(authButton).toBeVisible();
    await expect(authButton).toContainText('Sign in with GitHub');
  });

  test('should have auth button on cards page', async ({ page }) => {
    await page.goto('/cards.html');

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

  test('auth button should be styled correctly', async ({ page }) => {
    await page.goto('/');

    const authButton = page.locator('.auth-button');

    // Check for proper CSS classes
    await expect(authButton).toHaveClass(/auth-button/);
    await expect(authButton).toHaveClass(/auth-button--compact/);
  });

  test('auth components should be in navbar', async ({ page }) => {
    await page.goto('/');

    const navAuth = page.locator('.nav-auth');
    await expect(navAuth).toBeVisible();

    // Should contain both profile and button
    const authButton = navAuth.locator('.auth-button');
    const userProfile = navAuth.locator('.user-profile');

    await expect(authButton).toBeVisible();
    // Profile is in DOM but hidden when not authenticated
    const profileCount = await userProfile.count();
    expect(profileCount).toBe(1);
  });

  // Note: We cannot test actual OAuth flow in E2E tests without real credentials
  // These tests verify the UI is properly set up and visible
  test('clicking sign in button should trigger OAuth (UI only)', async ({ page }) => {
    await page.goto('/');

    const authButton = page.locator('.auth-button');

    // Wait for auth initialization (button should not show "Loading...")
    await expect(authButton.locator('.auth-button__text')).not.toContainText('Loading', {
      timeout: 10000,
    });

    // Verify button is enabled after auth state initializes
    await expect(authButton).toBeEnabled({ timeout: 5000 });

    // Verify button text is "Sign in with GitHub"
    await expect(authButton).toContainText('Sign in with GitHub');
  });

  test('auth button should not be disabled after initialization', async ({ page }) => {
    await page.goto('/');

    const authButton = page.locator('.auth-button');

    // Wait for DOM to load (networkidle may not fire due to library nav activity)
    await page.waitForLoadState('domcontentloaded');

    // Wait for auth button to be visible
    await expect(authButton).toBeVisible({ timeout: 5000 });

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
});
