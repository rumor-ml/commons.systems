/**
 * HTMX Cross-Page Navigation Tests
 * Tests navigating from homepage to cards page via HTMX
 */

import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('HTMX Cross-Page Navigation', () => {
  test('should load cards when navigating from homepage to Equipment type', async ({ page }) => {
    // Start at homepage
    await page.goto('/');

    // Wait for library navigation to load
    await page.waitForSelector('.library-nav-type', { timeout: 10000 });

    // Click Equipment type in library nav
    const equipmentToggle = page.locator(
      '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
    );
    await equipmentToggle.click();

    // Wait for navigation to complete - URL should change to cards.html with hash
    await page.waitForURL(/cards\.html#library\/equipment$/, { timeout: 10000 });

    // Wait for cards to load (either cards visible or empty state)
    await page.waitForSelector('.card-item, .empty-state', { timeout: 10000 });

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

    // Wait for library navigation to load
    await page.waitForSelector('.library-nav-type', { timeout: 10000 });

    // Click Skill type in library nav
    const skillToggle = page.locator('.library-nav-type[data-type="Skill"] .library-nav-toggle');
    await skillToggle.click();

    // Wait for navigation to complete
    await page.waitForURL(/cards\.html#library\/skill$/, { timeout: 10000 });

    // Wait for cards to load
    await page.waitForSelector('.card-item, .empty-state', { timeout: 10000 });

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

    // Wait for library navigation to load
    await page.waitForSelector('.library-nav-type', { timeout: 10000 });

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
    await page.waitForURL(/cards\.html#library\/equipment\/weapon$/, { timeout: 10000 });

    // Wait for cards to load
    await page.waitForSelector('.card-item, .empty-state', { timeout: 10000 });

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

    // Wait for library navigation to load
    await page.waitForSelector('.library-nav-type', { timeout: 10000 });

    // Click Equipment type
    const equipmentToggle = page.locator(
      '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
    );
    await equipmentToggle.click();

    // Wait for navigation
    await page.waitForURL(/cards\.html#library\/equipment$/, { timeout: 10000 });

    // Verify the sidebar is still visible (not re-rendered with different state)
    const sidebarNav = page.locator('.sidebar-nav');
    await expect(sidebarNav).toBeVisible();

    // Library nav should still be present
    const libraryNav = page.locator('#libraryNavContainer');
    await expect(libraryNav).toBeVisible();

    // Equipment should be expanded (since we just clicked it)
    await expect(equipmentToggle).toHaveClass(/expanded/);
  });
});
