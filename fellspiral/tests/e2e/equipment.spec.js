import { test, expect } from '@playwright/test';

test.describe('Equipment Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#weapons');
    // Wait for JavaScript to load
    await page.waitForLoadState('networkidle');
  });

  test('should display all equipment sections', async ({ page }) => {
    // All sections should be visible (no tabs in new design)
    const sections = ['#weapons', '#armor', '#skills', '#upgrades'];

    for (const sectionId of sections) {
      const section = page.locator(sectionId);
      await expect(section).toBeVisible();
    }
  });

  test('should display weapons', async ({ page }) => {
    const weapons = ['Long Sword', 'Long Bow', 'Dagger', 'Scimitar', 'Spear', 'Musket'];

    for (const weapon of weapons) {
      const weaponItem = page.locator('.equipment-item', { hasText: weapon });
      await expect(weaponItem).toBeVisible();
    }
  });

  test('should display weapon details', async ({ page }) => {
    const longSword = page.locator('.equipment-item', { hasText: 'Long Sword' }).first();

    // Check for tags
    await expect(longSword).toContainText('2h');
    await expect(longSword).toContainText('swept');
    await expect(longSword).toContainText('precise');

    // Check for stats
    await expect(longSword).toContainText('d10');
    await expect(longSword).toContainText('2 slots');
  });

  test('should display armor', async ({ page }) => {
    await page.goto('/#armor');

    const armorPieces = ['Chain Mail', 'Scale Vest', 'Helm', 'Greaves', 'Cloak'];

    for (const armor of armorPieces) {
      const armorItem = page.locator('.equipment-item', { hasText: armor });
      await expect(armorItem).toBeVisible();
    }
  });

  test('should display skills', async ({ page }) => {
    await page.goto('/#skills');

    // Check skill categories
    await expect(page.locator('h3', { hasText: 'Attack Skills' })).toBeVisible();
    await expect(page.locator('h3', { hasText: 'Defense Skills' })).toBeVisible();
    await expect(page.locator('h3', { hasText: 'Tenacity Skills' })).toBeVisible();

    // Check some specific skills in definition lists
    const skills = ['Surgical', 'Dual Wielding', 'Counter Strike', 'Moving Target', 'Grit'];

    for (const skill of skills) {
      const skillItem = page.locator('.skill-list dt', { hasText: skill });
      await expect(skillItem).toBeVisible();
    }
  });

  test('should display upgrades', async ({ page }) => {
    await page.goto('/#upgrades');

    const upgrades = ['Master-Craft', 'Serrated', 'Sword Breaker', 'Lucky', 'Balanced', 'Deadly'];

    for (const upgrade of upgrades) {
      const upgradeItem = page.locator('.equipment-item', { hasText: upgrade });
      await expect(upgradeItem).toBeVisible();
    }
  });
});
