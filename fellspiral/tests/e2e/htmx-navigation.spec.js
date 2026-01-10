/**
 * HTMX Cross-Page Navigation Tests
 * Tests navigating from homepage to cards page via HTMX
 */

import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('HTMX Cross-Page Navigation', () => {
  test('@smoke should load cards when navigating from homepage to Equipment type', async ({
    page,
  }) => {
    // Start at homepage
    await page.goto('/');

    // Wait for Equipment type to be visible
    await page.waitForSelector('.library-nav-type[data-type="Equipment"]', {
      timeout: 15000,
      state: 'visible',
    });

    // Click Equipment type in library nav
    const equipmentToggle = page.locator(
      '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
    );
    await equipmentToggle.click();

    // Wait for navigation to complete - URL should change to cards with hash
    await page.waitForURL(/cards(\.html)?#library-equipment$/, { timeout: 10000 });

    // Wait for cards to ACTUALLY load - not just empty state
    // The key is to wait for .card-item specifically, with a longer timeout
    await page.waitForSelector('.card-item', { timeout: 15000 });

    // Check if cards are visible (should be Equipment cards)
    const cardItems = await page.locator('.card-item').count();
    expect(cardItems).toBeGreaterThan(0);

    // Verify cards are filtered to Equipment type
    const firstCardType = await page.locator('.card-item .card-item-type').first().textContent();
    expect(firstCardType).toContain('Equipment');
  });

  test('should load cards when navigating from homepage to Skill type', async ({ page }) => {
    // Start at homepage
    await page.goto('/');

    // Wait for Skill type to be visible
    await page.waitForSelector('.library-nav-type[data-type="Skill"]', {
      timeout: 15000,
      state: 'visible',
    });

    // Click Skill type in library nav
    const skillToggle = page.locator('.library-nav-type[data-type="Skill"] .library-nav-toggle');
    await skillToggle.click();

    // Wait for navigation to complete
    await page.waitForURL(/cards(\.html)?#library-skill$/, { timeout: 10000 });

    // Wait for cards to ACTUALLY load - not just empty state
    await page.waitForSelector('.card-item', { timeout: 15000 });

    // Check if cards are visible
    const cardItems = await page.locator('.card-item').count();
    expect(cardItems).toBeGreaterThan(0);

    // Verify cards are filtered to Skill type
    const firstCardType = await page.locator('.card-item .card-item-type').first().textContent();
    expect(firstCardType).toContain('Skill');
  });

  test('should navigate to subtype and load filtered cards', async ({ page }) => {
    // Start at homepage
    await page.goto('/');

    // Wait for Equipment type to be visible
    await page.waitForSelector('.library-nav-type[data-type="Equipment"]', {
      timeout: 15000,
      state: 'visible',
    });

    // First expand Equipment to show subtypes
    const equipmentToggle = page.locator(
      '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
    );
    await equipmentToggle.click();

    // Wait for subtypes to appear
    await page.waitForSelector('.library-nav-subtype[data-subtype="Weapon"]', { timeout: 5000 });

    // Click Weapon subtype
    const weaponSubtype = page.locator(
      '.library-nav-subtype[data-type="Equipment"][data-subtype="Weapon"] .library-nav-subtype-item'
    );
    await weaponSubtype.click();

    // Wait for navigation to complete
    await page.waitForURL(/cards(\.html)?#library-equipment-weapon$/, { timeout: 10000 });

    // Wait for cards to ACTUALLY load - not just empty state
    await page.waitForSelector('.card-item', { timeout: 15000 });

    // Check if cards are visible
    const cardItems = await page.locator('.card-item').count();
    expect(cardItems).toBeGreaterThan(0);

    // Verify cards are filtered to Equipment - Weapon
    const firstCardType = await page.locator('.card-item .card-item-type').first().textContent();
    expect(firstCardType).toContain('Equipment');
    expect(firstCardType).toContain('Weapon');
  });

  test('should preserve sidebar state after HTMX navigation', async ({ page }) => {
    // Start at homepage
    await page.goto('/');

    // Wait for Equipment type to be visible
    await page.waitForSelector('.library-nav-type[data-type="Equipment"]', {
      timeout: 15000,
      state: 'visible',
    });

    // Click Equipment type
    const equipmentToggle = page.locator(
      '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
    );
    await equipmentToggle.click();

    // Wait for navigation
    await page.waitForURL(/cards(\.html)?#library-equipment$/, { timeout: 10000 });

    // Verify the sidebar is still visible (not re-rendered with different state)
    const sidebarNav = page.locator('.sidebar-nav');
    await expect(sidebarNav).toBeVisible();

    // Library nav should still be present
    const libraryNav = page.locator('#libraryNavContainer');
    await expect(libraryNav).toBeVisible();

    // Equipment should be expanded (since we just clicked it)
    await expect(equipmentToggle).toHaveClass(/expanded/);
  });

  // TODO(#1300): Flaky test - Origin type not appearing in library nav within timeout
  test.skip('should load cards with correct filter after fresh HTMX navigation', async ({
    page,
  }) => {
    // This test verifies that navigating via HTMX loads cards properly
    // by checking the actual card content matches the expected filter

    // Start at homepage
    await page.goto('/');

    // Wait for Origin type to be visible
    await page.waitForSelector('.library-nav-type[data-type="Origin"]', {
      timeout: 15000,
      state: 'visible',
    });

    // Click Origin type in library nav
    const originToggle = page.locator('.library-nav-type[data-type="Origin"] .library-nav-toggle');
    await originToggle.click();

    // Wait for navigation to complete
    await page.waitForURL(/cards(\.html)?#library-origin$/, { timeout: 10000 });

    // Wait for cards to load
    await page.waitForSelector('.card-item', { timeout: 15000 });

    // Verify ALL visible cards are Origin type (not just first one)
    const allCardTypes = await page.locator('.card-item .card-item-type').allTextContents();
    expect(allCardTypes.length).toBeGreaterThan(0);

    for (const cardType of allCardTypes) {
      expect(cardType).toContain('Origin');
    }
  });

  test('should navigate multiple times and load correct cards each time', async ({ page }) => {
    // Test multiple consecutive navigations work correctly

    // Start at homepage
    await page.goto('/');
    // Wait for both Equipment and Skill types to be visible
    await page.waitForSelector('.library-nav-type[data-type="Equipment"]', {
      timeout: 15000,
      state: 'visible',
    });
    await page.waitForSelector('.library-nav-type[data-type="Skill"]', {
      timeout: 15000,
      state: 'visible',
    });

    // First navigation: Equipment
    const equipmentToggle = page.locator(
      '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
    );
    await equipmentToggle.click();
    await page.waitForURL(/cards(\.html)?#library-equipment$/, { timeout: 10000 });
    await page.waitForSelector('.card-item', { timeout: 15000 });

    let firstCardType = await page.locator('.card-item .card-item-type').first().textContent();
    expect(firstCardType).toContain('Equipment');

    // Second navigation: Skill (from cards page, not homepage)
    const skillToggle = page.locator('.library-nav-type[data-type="Skill"] .library-nav-toggle');
    await skillToggle.click();

    // On cards page, this should use hash navigation, not HTMX
    await page.waitForURL(/cards(\.html)?#library-skill$/, { timeout: 10000 });

    // Wait for cards to re-filter
    await page.waitForTimeout(500); // Give time for filtering
    await page.waitForSelector('.card-item', { timeout: 15000 });

    firstCardType = await page.locator('.card-item .card-item-type').first().textContent();
    expect(firstCardType).toContain('Skill');
  });

  test('should preserve card-manager class after HTMX navigation for correct layout', async ({
    page,
  }) => {
    // Test that the card-manager class is present on main element after HTMX swap
    // This class is required for proper card layout CSS

    // Start at homepage
    await page.goto('/');
    // Wait for Equipment type to be visible
    await page.waitForSelector('.library-nav-type[data-type="Equipment"]', {
      timeout: 15000,
      state: 'visible',
    });

    // Click Equipment type to trigger HTMX navigation
    const equipmentToggle = page.locator(
      '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
    );
    await equipmentToggle.click();

    // Wait for navigation
    await page.waitForURL(/cards(\.html)?#library-equipment$/, { timeout: 10000 });

    // Wait for cards to load
    await page.waitForSelector('.card-item', { timeout: 15000 });

    // Verify the card-library class is present on main element
    // This is critical for proper layout - the class sets min-height: 100vh and background
    const mainContent = page.locator('.main-content');
    await expect(mainContent).toHaveClass(/card-library/);

    // Also verify the layout structure is correct
    const cardLibraryLayout = page.locator('.card-library-layout');
    await expect(cardLibraryLayout).toBeVisible();

    // Verify the card grid has proper dimensions (not collapsed)
    const cardGrid = page.locator('#cardList.card-grid');
    await expect(cardGrid).toBeVisible();
    const gridBox = await cardGrid.boundingBox();
    expect(gridBox?.height).toBeGreaterThan(100); // Should have some height
  });

  test('should have correct card styling after HTMX navigation', async ({ page }) => {
    // Navigate from homepage
    await page.goto('/');
    // Wait for Equipment type to be visible
    await page.waitForSelector('.library-nav-type[data-type="Equipment"]', {
      timeout: 15000,
      state: 'visible',
    });

    // Click Equipment
    const equipmentToggle = page.locator(
      '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
    );
    await equipmentToggle.click();

    // Wait for cards
    await page.waitForURL(/cards(\.html)?#library-equipment$/, { timeout: 10000 });
    await page.waitForSelector('.card-item', { timeout: 15000 });

    // Verify styling - the card-item-type element should have proper background styling
    const typeElement = page.locator('.card-item .card-item-type').first();
    const bgColor = await typeElement.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    // Should not be transparent/default (rgb(0, 0, 0) or rgba(0, 0, 0, 0))
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(bgColor).not.toBe('rgb(0, 0, 0)');

    // Also verify loading state is not visible
    const loadingVisible = await page.locator('.loading-state').isVisible();
    expect(loadingVisible).toBe(false);
  });

  test('should not show infinite loading on repeated navigation', async ({ page }) => {
    await page.goto('/');
    // Wait for both Equipment and Skill types to be visible
    await page.waitForSelector('.library-nav-type[data-type="Equipment"]', {
      timeout: 15000,
      state: 'visible',
    });
    await page.waitForSelector('.library-nav-type[data-type="Skill"]', {
      timeout: 15000,
      state: 'visible',
    });

    // First navigation
    await page.locator('.library-nav-type[data-type="Equipment"] .library-nav-toggle').click();
    await page.waitForURL(/cards(\.html)?#library-equipment$/, { timeout: 10000 });
    await page.waitForSelector('.card-item', { timeout: 15000 });

    // Second navigation (different type)
    await page.locator('.library-nav-type[data-type="Skill"] .library-nav-toggle').click();
    await page.waitForURL(/cards(\.html)?#library-skill$/, { timeout: 10000 });
    await page.waitForSelector('.card-item', { timeout: 15000 });

    // Verify no loading spinner stuck
    const loadingVisible = await page.locator('.loading-state').isVisible();
    expect(loadingVisible).toBe(false);
  });
});
