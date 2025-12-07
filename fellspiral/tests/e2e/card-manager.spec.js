import { test, expect } from '../../../playwright.fixtures.ts';
import { VIEWPORTS, setupMobileViewport, setupDesktopViewport } from './test-helpers.js';

test.describe('Card Manager Page', () => {
  test('should load successfully', async ({ page }) => {
    await page.goto('/cards.html');
    await expect(page).toHaveTitle(/Card Manager - Fellspiral/);
  });

  test('should display sidebar navigation', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for sidebar to be ready
    await page.locator('.sidebar').waitFor({ state: 'visible' });

    // Check sidebar header
    const siteTitle = page.locator('.site-title');
    await expect(siteTitle).toBeVisible();
    await expect(siteTitle).toContainText('Fellspiral');

    const siteTagline = page.locator('.site-tagline');
    await expect(siteTagline).toBeVisible();
    await expect(siteTagline).toContainText('Tactical Tabletop RPG');
  });

  test('should have all navigation links in sidebar', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for sidebar navigation to be ready
    await page.locator('.sidebar-nav').waitFor({ state: 'visible' });

    // Check nav links exist
    const navLinks = [
      { href: '/#introduction', text: 'Introduction' },
      { href: '/#initiative', text: 'Initiative' },
      { href: '/#roles', text: 'Referee & Antagonist' },
      { href: '/#damage', text: 'Damage System' },
      { href: '/#rounds', text: 'Combat Rounds' },
      { href: '/#zones', text: 'Zones' },
      { href: '/#actions', text: 'Actions' },
      { href: '/#trading-initiative', text: 'Trading Initiative' },
      { href: '/#conditions', text: 'Conditions' },
      { href: '/#simulator', text: 'Combat Simulator' },
      { href: '/#examples', text: 'Examples' },
      { href: '/cards.html', text: 'Card Manager' },
    ];

    for (const navLink of navLinks) {
      const link = page.locator(`.sidebar-nav a[href="${navLink.href}"]`);
      await expect(link).toBeVisible();
      await expect(link).toContainText(navLink.text);
    }
  });

  test('should have Library section in sidebar', async ({ page }) => {
    await page.goto('/cards.html');

    // Library section should exist
    const librarySection = page.locator('.nav-section-library');
    await expect(librarySection).toBeVisible();

    // Library section toggle should be present
    const librarySectionToggle = page.locator('.nav-section-title[data-section="library"]');
    await expect(librarySectionToggle).toBeVisible();
    await expect(librarySectionToggle).toContainText('Library');
  });

  test('should navigate to homepage sections when clicking nav links', async ({ page }) => {
    await page.goto('/cards.html');

    // Click on a nav link that goes to homepage
    await page.click('.sidebar-nav a[href="/#initiative"]');

    // Should navigate to homepage with hash
    await page.waitForURL(/\/#initiative/);
    await expect(page.url()).toContain('/#initiative');
  });

  test('should display library navigation in main sidebar', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for library navigation to load
    await page.waitForSelector('#libraryNavContainer', { timeout: 5000 });

    // Library nav container should be visible
    const libraryNavContainer = page.locator('#libraryNavContainer');
    await expect(libraryNavContainer).toBeVisible();

    // Should have library nav items (types)
    const libraryNavItems = page.locator('.library-nav-type');
    const itemCount = await libraryNavItems.count();
    expect(itemCount).toBeGreaterThan(0);
  });

  test('should display card management interface', async ({ page }) => {
    await page.goto('/cards.html');

    // Card toolbar should be visible
    const toolbar = page.locator('.card-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator('h1')).toContainText('Card Management');

    // Toolbar buttons exist but are hidden when not authenticated
    const addCardBtn = page.locator('#addCardBtn');
    const importCardsBtn = page.locator('#importCardsBtn');
    const exportCardsBtn = page.locator('#exportCardsBtn');

    // Buttons should exist in DOM
    await expect(addCardBtn).toBeAttached();
    await expect(importCardsBtn).toBeAttached();
    await expect(exportCardsBtn).toBeAttached();

    // Buttons should be hidden (auth-controls class)
    await expect(addCardBtn).toHaveCSS('display', 'none');
    await expect(importCardsBtn).toHaveCSS('display', 'none');
    await expect(exportCardsBtn).toHaveCSS('display', 'none');
  });

  test('should display stats overview', async ({ page }) => {
    await page.goto('/cards.html');

    const statsOverview = page.locator('.stats-overview');
    await expect(statsOverview).toBeVisible();

    // Check stat cards
    const statLabels = ['Total Cards', 'Equipment', 'Skills', 'Upgrades', 'Foes'];
    for (const label of statLabels) {
      const statCard = page.locator('.stat-card', { hasText: label });
      await expect(statCard).toBeVisible();
    }
  });

  test('should have mobile menu toggle button in DOM', async ({ page }) => {
    await page.goto('/cards.html');

    const mobileMenuToggle = page.locator('#mobileMenuToggle');
    // Button exists in DOM but may be hidden on desktop
    await expect(mobileMenuToggle).toBeAttached();
    await expect(mobileMenuToggle).toHaveAttribute('aria-label', 'Toggle navigation');
  });

  test.describe('Mobile menu functionality', () => {
    test('should toggle sidebar on mobile', async ({ page }) => {
      await setupMobileViewport(page);
      await page.goto('/cards.html');

      const sidebar = page.locator('#sidebar');
      const mobileMenuToggle = page.locator('#mobileMenuToggle');

      // Wait for mobile menu toggle to be visible
      await expect(mobileMenuToggle).toBeVisible();

      // Sidebar should not have active class initially
      await expect(sidebar).not.toHaveClass(/active/);

      // Click mobile menu toggle to open sidebar
      await mobileMenuToggle.click();

      // Sidebar should now have active class
      await expect(sidebar).toHaveClass(/active/);

      // Click again to close
      await mobileMenuToggle.click();

      await expect(sidebar).not.toHaveClass(/active/);
    });

    test('should close sidebar when clicking nav link on mobile', async ({ page }) => {
      await setupMobileViewport(page);
      await page.goto('/cards.html');

      const sidebar = page.locator('#sidebar');
      const mobileMenuToggle = page.locator('#mobileMenuToggle');

      // Wait for mobile menu toggle to be visible
      await expect(mobileMenuToggle).toBeVisible();

      // Open sidebar by clicking mobile menu toggle
      await mobileMenuToggle.click();
      await expect(sidebar).toHaveClass(/active/);

      // Click a nav link (should navigate and close sidebar)
      const navLink = page.locator('.sidebar-nav a[href="/#introduction"]');
      await navLink.click();

      // Should navigate to homepage with hash
      await page.waitForURL(/\/#introduction/);
    });

    test('should close sidebar when clicking outside on mobile', async ({ page }) => {
      await setupMobileViewport(page);
      await page.goto('/cards.html');

      const sidebar = page.locator('#sidebar');
      const toggle = page.locator('#mobileMenuToggle');

      await toggle.click();
      await expect(sidebar).toHaveClass(/active/);

      // Click outside the sidebar using mouse coordinates (right side of screen)
      await page.mouse.click(350, 200);

      // Wait a bit for the click handler to process
      await page.waitForTimeout(100);

      await expect(sidebar).not.toHaveClass(/active/);
    });

    test('should handle rapid toggle clicks', async ({ page }) => {
      await setupMobileViewport(page);
      await page.goto('/cards.html');

      const sidebar = page.locator('#sidebar');
      const toggle = page.locator('#mobileMenuToggle');

      // Click toggle 5 times rapidly
      for (let i = 0; i < 5; i++) {
        await toggle.click();
      }

      // Final state should be open (odd number of clicks)
      await expect(sidebar).toHaveClass(/active/);
    });
  });

  test('should display view mode controls', async ({ page }) => {
    await page.goto('/cards.html');

    const viewControls = page.locator('.card-view-controls');
    await expect(viewControls).toBeVisible();

    // View mode buttons
    const gridModeBtn = page.locator('.view-mode-btn[data-mode="grid"]');
    const listModeBtn = page.locator('.view-mode-btn[data-mode="list"]');

    await expect(gridModeBtn).toBeVisible();
    await expect(listModeBtn).toBeVisible();

    // Grid mode should be active by default
    await expect(gridModeBtn).toHaveClass(/active/);
  });

  test('should display filter controls', async ({ page }) => {
    await page.goto('/cards.html');

    // Filter dropdowns
    const typeFilter = page.locator('#filterType');
    const subtypeFilter = page.locator('#filterSubtype');
    const searchInput = page.locator('#searchCards');

    await expect(typeFilter).toBeVisible();
    await expect(subtypeFilter).toBeVisible();
    await expect(searchInput).toBeVisible();
  });

  test('should navigate to external links on desktop', async ({ page }) => {
    await setupDesktopViewport(page);
    await page.goto('/cards.html');

    const introLink = page.locator('.sidebar-nav a[href="/#introduction"]');
    await expect(introLink).toBeVisible();

    await introLink.click();
    await page.waitForURL(/\/#introduction/);
    await expect(page).toHaveURL(/\/#introduction/);
  });

  test('should handle missing elements gracefully', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/cards.html');
    await page.evaluate(() => {
      const toggle = document.getElementById('mobileMenuToggle');
      if (toggle) toggle.remove();
    });
    await page.locator('.card-toolbar h1').click();
    await page.waitForTimeout(100);

    // Filter out expected warnings
    const actualErrors = consoleErrors.filter((err) => !err.includes('Warning'));

    // Log errors for debugging before assertion
    if (actualErrors.length > 0) {
      console.log('Console errors detected:', actualErrors);
    }

    expect(actualErrors).toHaveLength(0);
  });
});
