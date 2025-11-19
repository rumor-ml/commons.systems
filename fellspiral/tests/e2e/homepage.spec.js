import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('should load successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Fellspiral/);
  });

  test('should display hero section', async ({ page }) => {
    await page.goto('/');

    // Check hero content
    const heroHeading = page.locator('.hero h1');
    await expect(heroHeading).toBeVisible();
    await expect(heroHeading).toContainText('Welcome to Fellspiral');

    // Check hero description
    const heroDescription = page.locator('.hero-description');
    await expect(heroDescription).toBeVisible();
    await expect(heroDescription).toContainText('tactical tabletop RPG');

    // Check hero buttons
    const primaryButton = page.locator('.btn-primary');
    await expect(primaryButton).toBeVisible();

    const secondaryButton = page.locator('.btn-secondary');
    await expect(secondaryButton).toBeVisible();
  });

  test('should have working navigation', async ({ page }) => {
    await page.goto('/');

    // Check nav links exist
    const navLinks = ['Concepts', 'Combat', 'Equipment', 'Examples'];
    for (const linkText of navLinks) {
      const link = page.locator('.nav-menu a', { hasText: linkText });
      await expect(link).toBeVisible();
    }

    // Test navigation clicking
    await page.click('text=Concepts');
    await expect(page.url()).toContain('#concepts');

    // Verify section is visible
    const conceptsSection = page.locator('#concepts');
    await expect(conceptsSection).toBeInViewport();
  });

  test('should display all main sections', async ({ page }) => {
    await page.goto('/');

    // Check all major sections are present
    const sections = ['#concepts', '#combat', '#equipment', '#examples'];
    for (const sectionId of sections) {
      const section = page.locator(sectionId);
      await expect(section).toBeVisible();
    }
  });
});
