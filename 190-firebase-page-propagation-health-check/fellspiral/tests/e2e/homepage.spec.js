import { test, expect } from '../../../playwright.fixtures.ts';
import { setupMobileViewport } from './test-helpers.js';

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

    // Check nav links exist using href selectors to avoid ambiguity
    const navLinks = [
      { href: '#introduction', text: 'Introduction' },
      { href: '#initiative', text: 'Initiative' },
      { href: '#weapons', text: 'Weapons' },
      { href: '#armor', text: 'Armor' },
      { href: '#skills', text: 'Skills' },
      { href: '#simulator', text: 'Combat Simulator' },
      { href: '#examples', text: 'Examples' }
    ];
    for (const navLink of navLinks) {
      const link = page.locator(`.sidebar-nav a[href="${navLink.href}"]`);
      await expect(link).toBeVisible();
      await expect(link).toContainText(navLink.text);
    }

    // Test navigation clicking
    await page.click('.sidebar-nav a[href="#initiative"]');
    await expect(page.url()).toContain('#initiative');

    // Wait for section to scroll into view
    const initiativeSection = page.locator('#initiative');
    await page.waitForTimeout(300); // Small delay for scroll animation
    await expect(initiativeSection).toBeInViewport();
  });

  test('should have Card Manager link in sidebar', async ({ page }) => {
    await page.goto('/');

    // Wait for sidebar navigation to be ready
    await page.locator('.sidebar-nav').waitFor({ state: 'visible' });

    // Check Card Manager link exists
    const cardManagerLink = page.locator('.sidebar-nav a[href="/cards.html"]');
    await expect(cardManagerLink).toBeVisible();
    await expect(cardManagerLink).toContainText('Card Manager');

    // Click Card Manager link
    await cardManagerLink.click();

    // Should navigate to cards page (Firebase cleanUrls strips .html extension in deployed environment)
    await page.waitForURL(/\/cards(\.html)?/);
    await expect(page.url()).toMatch(/\/cards(\.html)?$/);
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

  test.describe('Mobile menu functionality', () => {
    test('should toggle mobile menu on homepage', async ({ page }) => {
      await setupMobileViewport(page);
      await page.goto('/');

      const sidebar = page.locator('#sidebar');
      const toggle = page.locator('#mobileMenuToggle');

      await expect(toggle).toBeVisible();

      // Initially closed
      await expect(sidebar).not.toHaveClass(/active/);

      // Open menu
      await toggle.click();
      await expect(sidebar).toHaveClass(/active/);

      // Close menu
      await toggle.click();
      await expect(sidebar).not.toHaveClass(/active/);
    });

    test('should close sidebar when clicking outside on mobile', async ({ page }) => {
      await setupMobileViewport(page);
      await page.goto('/');

      const sidebar = page.locator('#sidebar');
      const toggle = page.locator('#mobileMenuToggle');

      await toggle.click();
      await expect(sidebar).toHaveClass(/active/);

      // Click on main content area
      await page.locator('#introduction h1').click();
      await expect(sidebar).not.toHaveClass(/active/);
    });
  });
});
