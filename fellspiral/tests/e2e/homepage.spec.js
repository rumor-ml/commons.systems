import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('should load successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Fellspiral/);
  });

  test('should display introduction section', async ({ page }) => {
    await page.goto('/');

    // Check introduction content
    const introHeading = page.locator('#introduction h1');
    await expect(introHeading).toBeVisible();
    await expect(introHeading).toContainText('Fellspiral');

    // Check introduction description (lead paragraph)
    const introDescription = page.locator('#introduction .lead');
    await expect(introDescription).toBeVisible();
    await expect(introDescription).toContainText('tactical tabletop RPG');
  });

  test('should have working sidebar navigation', async ({ page }) => {
    await page.goto('/');

    // Wait for sidebar navigation to be ready
    await page.locator('.sidebar-nav').waitFor({ state: 'visible' });

    // Check sidebar header
    const siteTitle = page.locator('.site-title');
    await expect(siteTitle).toBeVisible();
    await expect(siteTitle).toContainText('Fellspiral');

    // Check nav links exist
    const navLinks = ['Introduction', 'Initiative', 'Weapons', 'Armor', 'Skills', 'Combat Simulator', 'Examples'];
    for (const linkText of navLinks) {
      const link = page.locator('.sidebar-nav a', { hasText: linkText });
      await expect(link).toBeVisible();
    }

    // Test navigation clicking
    await page.click('.sidebar-nav a[href="#initiative"]');
    await expect(page.url()).toContain('#initiative');

    // Wait for section to scroll into view
    const initiativeSection = page.locator('#initiative');
    await page.waitForTimeout(300); // Small delay for scroll animation
    await expect(initiativeSection).toBeInViewport();
  });

  test('should display all main sections', async ({ page }) => {
    await page.goto('/');

    // Check all major sections are present
    const sections = ['#introduction', '#initiative', '#weapons', '#armor', '#skills', '#simulator', '#examples'];
    for (const sectionId of sections) {
      const section = page.locator(sectionId);
      await expect(section).toBeVisible();
    }
  });
});
