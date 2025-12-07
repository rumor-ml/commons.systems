/**
 * Hash Routing Tests
 * Tests URL-based navigation patterns for the card library
 */

import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('Hash Routing - Pattern Recognition', () => {
  test('should filter all cards on #library', async ({ page }) => {
    await page.goto('/cards.html#library');

    // Wait for page to load
    await page.waitForSelector('#filterType', { timeout: 5000 });

    const typeFilter = page.locator('#filterType');
    await expect(typeFilter).toHaveValue('');

    const subtypeFilter = page.locator('#filterSubtype');
    await expect(subtypeFilter).toHaveValue('');
  });

  test('should filter by type on #library/equipment', async ({ page }) => {
    await page.goto('/cards.html#library/equipment');

    // Wait for page to load
    await page.waitForSelector('#filterType', { timeout: 5000 });

    const typeFilter = page.locator('#filterType');
    await expect(typeFilter).toHaveValue('Equipment');

    const subtypeFilter = page.locator('#filterSubtype');
    await expect(subtypeFilter).toHaveValue('');
  });

  test('should filter by type+subtype on #library/equipment/weapon', async ({ page }) => {
    await page.goto('/cards.html#library/equipment/weapon');

    // Wait for page to load
    await page.waitForSelector('#filterType', { timeout: 5000 });

    const typeFilter = page.locator('#filterType');
    await expect(typeFilter).toHaveValue('Equipment');

    const subtypeFilter = page.locator('#filterSubtype');
    await expect(subtypeFilter).toHaveValue('Weapon');
  });

  test('should handle invalid type gracefully', async ({ page }) => {
    await page.goto('/cards.html#library/invalidtype');

    // Wait for page to load - just check DOM is ready, not networkidle
    await page.waitForLoadState('domcontentloaded');

    // Should not crash - verify main heading is visible
    const heading = page.locator('h1');
    await expect(heading.first()).toBeVisible({ timeout: 5000 });

    // May show empty state or no results (which is fine - page didn't crash)
  });

  test('should handle case-insensitive hashes', async ({ page }) => {
    await page.goto('/cards.html#library/EQUIPMENT/WEAPON');

    // Wait for page to load
    await page.waitForSelector('#filterType', { timeout: 5000 });

    const typeFilter = page.locator('#filterType');
    await expect(typeFilter).toHaveValue('Equipment');

    const subtypeFilter = page.locator('#filterSubtype');
    await expect(subtypeFilter).toHaveValue('Weapon');
  });

  test('should handle skill type routing', async ({ page }) => {
    await page.goto('/cards.html#library/skill');

    // Wait for page to load
    await page.waitForSelector('#filterType', { timeout: 5000 });

    const typeFilter = page.locator('#filterType');
    await expect(typeFilter).toHaveValue('Skill');
  });

  test('should handle skill subtypes routing', async ({ page }) => {
    await page.goto('/cards.html#library/skill/attack');

    // Wait for page to load
    await page.waitForSelector('#filterType', { timeout: 5000 });

    const typeFilter = page.locator('#filterType');
    await expect(typeFilter).toHaveValue('Skill');

    const subtypeFilter = page.locator('#filterSubtype');
    await expect(subtypeFilter).toHaveValue('Attack');
  });
});

test.describe('Hash Routing - Hash Updates', () => {
  test('should update hash when using filter dropdowns', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for page to load
    await page.waitForSelector('#filterType', { timeout: 5000 });

    const typeFilter = page.locator('#filterType');
    await typeFilter.selectOption('Equipment');

    // Wait for hash to update
    await page.waitForTimeout(300);

    await expect(page).toHaveURL(/#library\/equipment$/);
  });

  test('should update hash when changing subtype filter', async ({ page }) => {
    await page.goto('/cards.html#library/equipment');

    // Wait for page to load
    await page.waitForSelector('#filterSubtype', { timeout: 5000 });

    const subtypeFilter = page.locator('#filterSubtype');
    await subtypeFilter.selectOption('Weapon');

    // Wait for hash to update
    await page.waitForTimeout(300);

    await expect(page).toHaveURL(/#library\/equipment\/weapon$/);
  });

  test('should update hash when clicking sidebar navigation', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for library nav to load
    await page.waitForSelector('.library-nav-type', { timeout: 5000 });

    const equipmentToggle = page.locator('.library-nav-type[data-type="Equipment"] .library-nav-toggle');
    await equipmentToggle.click();

    // Wait for hash to update
    await page.waitForTimeout(300);

    await expect(page).toHaveURL(/#library\/equipment$/);
  });

  test('should support browser back/forward', async ({ page }) => {
    await page.goto('/cards.html#library');
    await page.goto('/cards.html#library/equipment');
    await page.goto('/cards.html#library/equipment/weapon');

    // Go back
    await page.goBack();
    await expect(page).toHaveURL(/#library\/equipment$/);

    // Verify filter state updated
    const typeFilter = page.locator('#filterType');
    await expect(typeFilter).toHaveValue('Equipment');

    const subtypeFilter = page.locator('#filterSubtype');
    await expect(subtypeFilter).toHaveValue('');

    // Go back again
    await page.goBack();
    await expect(page).toHaveURL(/#library$/);

    // Go forward
    await page.goForward();
    await expect(page).toHaveURL(/#library\/equipment$/);
  });

  test('should clear subtype when changing type filter', async ({ page }) => {
    await page.goto('/cards.html#library/equipment/weapon');

    // Wait for page to load
    await page.waitForSelector('#filterType', { timeout: 5000 });

    // Change type to Skill
    const typeFilter = page.locator('#filterType');
    await typeFilter.selectOption('Skill');

    // Wait for hash to update
    await page.waitForTimeout(300);

    // Hash should not include weapon subtype
    await expect(page).toHaveURL(/#library\/skill$/);

    // Subtype filter should be cleared
    const subtypeFilter = page.locator('#filterSubtype');
    await expect(subtypeFilter).toHaveValue('');
  });

  test('should handle rapid hash changes', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for page to load
    await page.waitForSelector('#filterType', { timeout: 5000 });

    const typeFilter = page.locator('#filterType');

    // Rapidly change filters
    await typeFilter.selectOption('Equipment');
    await typeFilter.selectOption('Skill');
    await typeFilter.selectOption('Upgrade');

    // Wait for final hash to settle
    await page.waitForTimeout(500);

    // Should end on Upgrade
    await expect(page).toHaveURL(/#library\/upgrade$/);
    await expect(typeFilter).toHaveValue('Upgrade');
  });
});
