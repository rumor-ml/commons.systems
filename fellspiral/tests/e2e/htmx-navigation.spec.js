/**
 * HTMX Cross-Page Navigation Tests
 * Tests navigating from homepage to cards page via HTMX
 */

import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('HTMX Cross-Page Navigation', () => {
  // Skip in CI: Tests require Firestore to have card data seeded.
  // In CI, Firestore credentials error prevents seeding.
  // Local tests pass because global-setup.ts seeds data.
  // TODO: Either seed test data in CI Firestore, or mock card data in tests
  const shouldSkip = process.env.CI;

  (shouldSkip ? test.skip : test)(
    'should load cards when navigating from homepage to Equipment type',
    async ({ page }) => {
      // Start at homepage
      await page.goto('/');

      // Wait for library navigation to load
      await page.waitForSelector('.library-nav-type', { timeout: 10000 });

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
    }
  );

  (shouldSkip ? test.skip : test)(
    'should load cards when navigating from homepage to Skill type',
    async ({ page }) => {
      // Start at homepage
      await page.goto('/');

      // Wait for library navigation to load
      await page.waitForSelector('.library-nav-type', { timeout: 10000 });

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
    }
  );

  (shouldSkip ? test.skip : test)(
    'should navigate to subtype and load filtered cards',
    async ({ page }) => {
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
    }
  );

  (shouldSkip ? test.skip : test)(
    'should preserve sidebar state after HTMX navigation',
    async ({ page }) => {
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
      await page.waitForURL(/cards(\.html)?#library-equipment$/, { timeout: 10000 });

      // Verify the sidebar is still visible (not re-rendered with different state)
      const sidebarNav = page.locator('.sidebar-nav');
      await expect(sidebarNav).toBeVisible();

      // Library nav should still be present
      const libraryNav = page.locator('#libraryNavContainer');
      await expect(libraryNav).toBeVisible();

      // Equipment should be expanded (since we just clicked it)
      await expect(equipmentToggle).toHaveClass(/expanded/);
    }
  );

  (shouldSkip ? test.skip : test)(
    'should load cards with correct filter after fresh HTMX navigation',
    async ({ page }) => {
      // This test verifies that navigating via HTMX loads cards properly
      // by checking the actual card content matches the expected filter

      // Start at homepage
      await page.goto('/');

      // Wait for library navigation to load
      await page.waitForSelector('.library-nav-type', { timeout: 10000 });

      // Click Foe type in library nav
      const foeToggle = page.locator('.library-nav-type[data-type="Foe"] .library-nav-toggle');
      await foeToggle.click();

      // Wait for navigation to complete
      await page.waitForURL(/cards(\.html)?#library-foe$/, { timeout: 10000 });

      // Wait for cards to load
      await page.waitForSelector('.card-item', { timeout: 15000 });

      // Verify ALL visible cards are Foe type (not just first one)
      const allCardTypes = await page.locator('.card-item .card-item-type').allTextContents();
      expect(allCardTypes.length).toBeGreaterThan(0);

      for (const cardType of allCardTypes) {
        expect(cardType).toContain('Foe');
      }
    }
  );

  (shouldSkip ? test.skip : test)(
    'should navigate multiple times and load correct cards each time',
    async ({ page }) => {
      // Test multiple consecutive navigations work correctly

      // Start at homepage
      await page.goto('/');
      await page.waitForSelector('.library-nav-type', { timeout: 10000 });

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
    }
  );
});
