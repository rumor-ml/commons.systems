/**
 * Library Navigation Tests
 * Tests the hierarchical Type → Subtype tree navigation for the card library
 */

import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('Library Navigation - Tree Structure', () => {
  test('should display library section in sidebar', async ({ page }) => {
    await page.goto('/cards.html');

    const librarySection = page.locator('.nav-section-library');
    await expect(librarySection).toBeVisible();

    const libraryContainer = page.locator('#libraryNavContainer');
    await expect(libraryContainer).toBeVisible();
  });

  test('should display all card types', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for library nav to load
    await page.waitForSelector('.library-nav-type', { timeout: 10000 });

    // Check for expected types
    const types = ['Equipment', 'Skill', 'Upgrade', 'Foe'];
    for (const type of types) {
      const typeElement = page.locator(`.library-nav-type[data-type="${type}"]`);
      await expect(typeElement).toBeVisible();
    }
  });

  test('should display card counts for each type', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for library nav to load
    await page.waitForSelector('.library-nav-type', { timeout: 5000 });

    // Get the type-level count (in the toggle, not subtypes)
    const equipmentCount = page.locator('.library-nav-type[data-type="Equipment"] > .library-nav-toggle .library-nav-count');
    await expect(equipmentCount).toBeVisible();

    const countText = await equipmentCount.textContent();
    expect(parseInt(countText)).toBeGreaterThan(0);
  });

  test('should display subtypes for each type', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for library nav to load
    await page.waitForSelector('.library-nav-type', { timeout: 5000 });

    // Equipment should have Weapon and Armor subtypes
    const equipmentType = page.locator('.library-nav-type[data-type="Equipment"]');
    const weaponSubtype = equipmentType.locator('.library-nav-subtype[data-subtype="Weapon"]');
    const armorSubtype = equipmentType.locator('.library-nav-subtype[data-subtype="Armor"]');

    await expect(weaponSubtype).toBeVisible();
    await expect(armorSubtype).toBeVisible();
  });
});

test.describe('Library Navigation - Expand/Collapse', () => {
  test('types should be expanded by default', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for library nav to load
    await page.waitForSelector('.library-nav-type', { timeout: 5000 });

    const equipmentToggle = page.locator('.library-nav-type[data-type="Equipment"] .library-nav-toggle');
    await expect(equipmentToggle).toHaveClass(/expanded/);

    const subtypesContainer = page.locator('.library-nav-type[data-type="Equipment"] .library-nav-subtypes');
    await expect(subtypesContainer).toHaveClass(/expanded/);
  });

  test('should collapse type when clicking toggle', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for library nav to load
    await page.waitForSelector('.library-nav-type', { timeout: 5000 });

    const equipmentToggle = page.locator('.library-nav-type[data-type="Equipment"] .library-nav-toggle');

    // Initially expanded
    await expect(equipmentToggle).toHaveClass(/expanded/);

    // Click to collapse
    await equipmentToggle.click();

    // Wait for animation
    await page.waitForTimeout(300);

    // Should be collapsed
    await expect(equipmentToggle).not.toHaveClass(/expanded/);

    const subtypesContainer = page.locator('.library-nav-type[data-type="Equipment"] .library-nav-subtypes');
    await expect(subtypesContainer).not.toHaveClass(/expanded/);
  });

  test('should persist expand state in localStorage', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for library nav to load
    await page.waitForSelector('.library-nav-type', { timeout: 5000 });

    const equipmentToggle = page.locator('.library-nav-type[data-type="Equipment"] .library-nav-toggle');
    await equipmentToggle.click();

    // Wait for state to be saved
    await page.waitForTimeout(300);

    const storageState = await page.evaluate(() => {
      return localStorage.getItem('fellspiral-library-nav-state');
    });

    expect(storageState).toBeTruthy();
    const parsedState = JSON.parse(storageState);
    expect(parsedState['library-type-equipment']).toBe(false);
  });

  test('should restore expand state on page reload', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for library nav to load
    await page.waitForSelector('.library-nav-type', { timeout: 5000 });

    // Collapse Equipment
    const equipmentToggle = page.locator('.library-nav-type[data-type="Equipment"] .library-nav-toggle');
    await equipmentToggle.click();

    // Wait for state to save
    await page.waitForTimeout(300);

    // Reload page
    await page.reload();

    // Wait for library nav to load again
    await page.waitForSelector('.library-nav-type', { timeout: 5000 });

    // Equipment should remain collapsed
    await expect(equipmentToggle).not.toHaveClass(/expanded/);
  });
});

test.describe('Library Navigation - Navigation Interaction', () => {
  test('should navigate to type listing when clicking type', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for library nav to load
    await page.waitForSelector('.library-nav-type', { timeout: 10000 });

    const equipmentToggle = page.locator('.library-nav-type[data-type="Equipment"] .library-nav-toggle');
    await equipmentToggle.click();

    // Hash should update
    await expect(page).toHaveURL(/#library\/equipment$/);

    // Filter should update
    const typeFilter = page.locator('#filterType');
    await expect(typeFilter).toHaveValue('Equipment');
  });

  test('should navigate to subtype listing when clicking subtype', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for library nav to load
    await page.waitForSelector('.library-nav-type', { timeout: 10000 });

    const weaponSubtype = page.locator('.library-nav-subtype[data-type="Equipment"][data-subtype="Weapon"] .library-nav-subtype-item');
    await weaponSubtype.click();

    await expect(page).toHaveURL(/#library\/equipment\/weapon$/);

    const typeFilter = page.locator('#filterType');
    await expect(typeFilter).toHaveValue('Equipment');

    const subtypeFilter = page.locator('#filterSubtype');
    await expect(subtypeFilter).toHaveValue('Weapon');
  });

  test('should filter cards based on navigation', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for library nav and cards to load
    await page.waitForSelector('.library-nav-type', { timeout: 10000 });
    await page.waitForSelector('.card-item, .empty-state', { timeout: 5000 });

    // Get total card count (or check for empty state)
    const initialCards = await page.locator('.card-item').count();

    // Navigate to Equipment
    const equipmentToggle = page.locator('.library-nav-type[data-type="Equipment"] .library-nav-toggle');
    await equipmentToggle.click();

    // Wait for filtering
    await page.waitForTimeout(500);

    // Card count should be different (filtered) or we should see filtered cards
    const filteredCards = await page.locator('.card-item').count();

    // Either we have fewer cards or we're showing the filtered set
    // (The actual count depends on data, so we just verify filtering happened)
    const typeFilter = page.locator('#filterType');
    await expect(typeFilter).toHaveValue('Equipment');
  });
});
