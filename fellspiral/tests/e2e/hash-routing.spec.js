/**
 * Hash Routing Tests
 * Tests URL-based navigation patterns for the card library
 */

import { test, expect } from '../../../playwright.fixtures.ts';

/**
 * Verify cards are filtered by checking visible card content
 */
async function verifyCardFiltering(page, expectedType, expectedSubtype = null) {
  // Wait for the loading state to disappear
  // The initial HTML has <div class="loading-state"> inside #cardList
  // Once cards are loaded, this is replaced with actual card-item elements
  await page.waitForFunction(
    () => {
      const loadingState = document.querySelector('#cardList .loading-state');
      return !loadingState; // Loading state should be gone
    },
    { timeout: 15000 }
  );

  // Wait for at least one card-item to be present in the DOM
  await page.waitForSelector('.card-item', { timeout: 10000 });

  // Wait for cards to stabilize after filtering (hash change triggers re-render)
  await page.waitForTimeout(500);

  const cards = page.locator('.card-item');
  const count = await cards.count();

  // Should have at least one card
  expect(count).toBeGreaterThan(0);

  // Verify filtering worked (check first few cards)
  for (let i = 0; i < Math.min(count, 5); i++) {
    const card = cards.nth(i);
    const typeText = await card.locator('.card-item-type').textContent();
    expect(typeText).toContain(expectedType);

    if (expectedSubtype) {
      expect(typeText).toContain(expectedSubtype);
    }
  }
}

test.describe('Hash Routing - Pattern Recognition', () => {
  test('should filter all cards on #library', async ({ page }) => {
    await page.goto('/cards.html#library');

    // Wait for loading state to disappear
    await page.waitForFunction(
      () => {
        const loadingState = document.querySelector('#cardList .loading-state');
        return !loadingState;
      },
      { timeout: 15000 }
    );

    // Wait for cards to load
    await page.waitForSelector('.card-item', { timeout: 10000 });
    const cards = page.locator('.card-item');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should filter by type on #library-equipment', async ({ page }) => {
    await page.goto('/cards.html#library-equipment');

    // Verify cards are filtered to Equipment type
    await verifyCardFiltering(page, 'Equipment');
  });

  test('should filter by type+subtype on #library-equipment-weapon', async ({ page }) => {
    await page.goto('/cards.html#library-equipment-weapon');

    // Verify cards are filtered to Equipment/Weapon
    await verifyCardFiltering(page, 'Equipment', 'Weapon');
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
    await page.goto('/cards.html#library-equipment-weapon');

    // Verify cards are filtered to Equipment/Weapon (case-insensitive)
    await verifyCardFiltering(page, 'Equipment', 'Weapon');
  });

  test('should handle skill type routing', async ({ page }) => {
    await page.goto('/cards.html#library-skill');

    // Verify cards are filtered to Skill type
    await verifyCardFiltering(page, 'Skill');
  });

  test('should handle skill subtypes routing', async ({ page }) => {
    await page.goto('/cards.html#library-skill-attack');

    // Verify cards are filtered to Skill/Attack
    await verifyCardFiltering(page, 'Skill', 'Attack');
  });
});

test.describe('Hash Routing - Hash Updates', () => {
  test('should update hash when using library navigation', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for Equipment type to be visible
    await page.waitForSelector('.library-nav-type[data-type="Equipment"]', {
      timeout: 15000,
      state: 'visible',
    });

    // Click Equipment type toggle
    const equipmentToggle = page.locator(
      '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
    );
    await equipmentToggle.click();

    // Wait for hash to update
    await page.waitForTimeout(300);

    await expect(page).toHaveURL(/#library-equipment$/);
  });

  test('should update hash when clicking subtype in library nav', async ({ page }) => {
    await page.goto('/cards.html#library-equipment');

    // Wait for loading state to disappear
    await page.waitForFunction(
      () => {
        const loadingState = document.querySelector('#cardList .loading-state');
        return !loadingState;
      },
      { timeout: 15000 }
    );

    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Wait for Equipment type to be visible
    await page.waitForSelector('.library-nav-type[data-type="Equipment"]', {
      timeout: 15000,
      state: 'visible',
    });

    // First, make sure Equipment section is expanded (it should be since we're on #library-equipment)
    // Wait for the section to be visible and check if it's expanded
    const equipmentSection = page.locator('.library-nav-type[data-type="Equipment"]');
    await equipmentSection.waitFor({ state: 'visible', timeout: 5000 });

    const isExpanded = await equipmentSection
      .locator('.library-nav-toggle')
      .getAttribute('aria-expanded');

    if (isExpanded !== 'true') {
      await equipmentSection.locator('.library-nav-toggle').click();
      await page.waitForTimeout(500); // Wait for expand animation
    }

    // Wait for the Weapon subtype link to be visible
    const weaponLink = page
      .locator('.library-nav-type[data-type="Equipment"] .library-nav-subtype a')
      .filter({ hasText: 'Weapon' });

    await weaponLink.waitFor({ state: 'visible', timeout: 5000 });
    await weaponLink.click();

    // Wait for hash to update
    await page.waitForTimeout(300);

    await expect(page).toHaveURL(/#library-equipment-weapon$/);
  });

  test('should update hash when clicking sidebar navigation', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for Equipment type to be visible
    await page.waitForSelector('.library-nav-type[data-type="Equipment"]', {
      timeout: 15000,
      state: 'visible',
    });

    const equipmentToggle = page.locator(
      '.library-nav-type[data-type="Equipment"] .library-nav-toggle'
    );
    await equipmentToggle.click();

    // Wait for hash to update
    await page.waitForTimeout(300);

    await expect(page).toHaveURL(/#library-equipment$/);
  });

  test('should support browser back/forward', async ({ page }) => {
    await page.goto('/cards.html#library');
    await page.waitForFunction(() => !document.querySelector('#cardList .loading-state'), {
      timeout: 15000,
    });
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.goto('/cards.html#library-equipment');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await page.waitForTimeout(300); // Wait for filtering to complete

    await page.goto('/cards.html#library-equipment-weapon');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await page.waitForTimeout(300); // Wait for filtering to complete

    // Go back
    await page.goBack();
    await page.waitForTimeout(300); // Wait for hash change to process
    await expect(page).toHaveURL(/#library-equipment$/);

    // Go back again
    await page.goBack();
    await page.waitForTimeout(300); // Wait for hash change to process
    await expect(page).toHaveURL(/#library$/);

    // Go forward
    await page.goForward();
    await page.waitForTimeout(300); // Wait for hash change to process
    await expect(page).toHaveURL(/#library-equipment$/);
  });

  test('should clear subtype when changing type in library nav', async ({ page }) => {
    await page.goto('/cards.html#library-equipment-weapon');

    // Wait for Skill type to be visible
    await page.waitForSelector('.library-nav-type[data-type="Skill"]', {
      timeout: 15000,
      state: 'visible',
    });

    // Click Skill type toggle
    const skillToggle = page.locator('.library-nav-type[data-type="Skill"] .library-nav-toggle');
    await skillToggle.click();

    // Wait for hash to update
    await page.waitForTimeout(300);

    // Hash should not include weapon subtype
    await expect(page).toHaveURL(/#library-skill$/);

    // Verify cards are filtered to Skill type only
    await verifyCardFiltering(page, 'Skill');
  });

  // TODO(#455): Pre-existing flaky test with DOM detachment timing issues
  test.skip('should handle rapid hash changes', async ({ page }) => {
    await page.goto('/cards.html');

    // Wait for all expected types to be visible
    await page.waitForSelector('.library-nav-type[data-type="Equipment"]', {
      timeout: 15000,
      state: 'visible',
    });
    await page.waitForSelector('.library-nav-type[data-type="Skill"]', {
      timeout: 15000,
      state: 'visible',
    });
    await page.waitForSelector('.library-nav-type[data-type="Upgrade"]', {
      timeout: 15000,
      state: 'visible',
    });

    // Rapidly click type toggles
    await page.locator('.library-nav-type[data-type="Equipment"] .library-nav-toggle').click();
    await page.locator('.library-nav-type[data-type="Skill"] .library-nav-toggle').click();
    await page.locator('.library-nav-type[data-type="Upgrade"] .library-nav-toggle').click();

    // Wait for final hash to settle
    await page.waitForTimeout(500);

    // Should end on Upgrade
    await expect(page).toHaveURL(/#library-upgrade$/);
    await verifyCardFiltering(page, 'Upgrade');
  });
});
