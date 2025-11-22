/**
 * Playwright Global Authentication Setup
 *
 * This file handles GitHub OAuth authentication for E2E tests.
 * It authenticates once and saves the auth state for reuse in all tests.
 *
 * Usage:
 * 1. Set environment variables (optional for local dev):
 *    - GITHUB_TEST_USER: GitHub username for testing
 *    - GITHUB_TEST_PASSWORD: GitHub password for testing
 *
 * 2. Run: npx playwright test
 *
 * The auth state is saved to .auth/user.json and reused in all tests.
 */

import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const authFile = path.join(__dirname, '../.auth/user.json');

async function globalSetup() {
  // Check if we have test credentials
  const testUser = process.env.GITHUB_TEST_USER;
  const testPassword = process.env.GITHUB_TEST_PASSWORD;

  if (!testUser || !testPassword) {
    console.log('⏩ Skipping auth setup - no test credentials provided');
    console.log('   Set GITHUB_TEST_USER and GITHUB_TEST_PASSWORD to enable OAuth tests');
    return;
  }

  console.log('🔐 Starting authentication setup...');

  // Ensure .auth directory exists
  const authDir = path.dirname(authFile);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to the site
    const baseURL = process.env.DEPLOYED_URL || 'http://localhost:5173';
    console.log(`📍 Navigating to ${baseURL}`);
    await page.goto(baseURL);

    // Wait for auth button to be visible
    console.log('⏳ Waiting for auth button...');
    const authButton = page.locator('.auth-button');
    await authButton.waitFor({ state: 'visible', timeout: 10000 });

    // Click sign in
    console.log('🖱️  Clicking sign in button...');
    await authButton.click();

    // Wait for GitHub OAuth page
    console.log('⏳ Waiting for GitHub OAuth page...');
    await page.waitForURL('**/github.com/**', { timeout: 10000 });

    // Fill in GitHub credentials
    console.log('📝 Entering GitHub credentials...');
    await page.fill('input[name="login"]', testUser);
    await page.fill('input[name="password"]', testPassword);
    await page.click('input[type="submit"]');

    // Handle potential 2FA or authorization page
    try {
      // Check if we're on authorization page (for first-time auth)
      const authorizeButton = page.locator('button:has-text("Authorize")');
      if (await authorizeButton.isVisible({ timeout: 3000 })) {
        console.log('✅ Authorizing app...');
        await authorizeButton.click();
      }
    } catch (e) {
      // No authorization needed (app already authorized)
    }

    // Wait for redirect back to the site
    console.log('⏳ Waiting for redirect...');
    await page.waitForURL(baseURL + '**', { timeout: 15000 });

    // Wait for user profile to be visible (confirms successful auth)
    console.log('⏳ Verifying authentication...');
    const userProfile = page.locator('.user-profile');
    await userProfile.waitFor({ state: 'visible', timeout: 10000 });

    // Verify user profile shows content
    const isVisible = await userProfile.isVisible();
    if (!isVisible) {
      throw new Error('Authentication failed - user profile not visible');
    }

    console.log('✅ Authentication successful!');

    // Save auth state
    console.log(`💾 Saving auth state to ${authFile}`);
    await context.storageState({ path: authFile });

  } catch (error) {
    console.error('❌ Authentication setup failed:', error.message);
    throw error;
  } finally {
    await browser.close();
  }

  console.log('✅ Auth setup complete!');
}

export default globalSetup;
