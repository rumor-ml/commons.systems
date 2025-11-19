import { test, expect } from '@playwright/test';

test.describe('Equipment Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#equipment');
  });

  test('should display equipment tabs', async ({ page }) => {
    const tabs = ['Weapons', 'Armor', 'Skills', 'Upgrades'];

    for (const tabName of tabs) {
      const tab = page.locator('.tab-btn', { hasText: tabName });
      await expect(tab).toBeVisible();
    }

    // Weapons tab should be active by default
    const weaponsTab = page.locator('.tab-btn', { hasText: 'Weapons' });
    await expect(weaponsTab).toHaveClass(/active/);
  });

  test('should switch between tabs', async ({ page }) => {
    // Click armor tab
    await page.click('text=Armor');

    // Armor tab should be active
    const armorTab = page.locator('.tab-btn[data-tab="armor"]');
    await expect(armorTab).toHaveClass(/active/);

    // Armor content should be visible
    const armorContent = page.locator('#armor');
    await expect(armorContent).toHaveClass(/active/);

    // Weapons content should not be visible
    const weaponsContent = page.locator('#weapons');
    await expect(weaponsContent).not.toHaveClass(/active/);
  });

  test('should display weapons', async ({ page }) => {
    const weapons = ['Long Sword', 'Long Bow', 'Dagger', 'Scimitar', 'Spear', 'Musket'];

    for (const weapon of weapons) {
      const weaponCard = page.locator('.equipment-card', { hasText: weapon });
      await expect(weaponCard).toBeVisible();
    }
  });

  test('should display weapon details', async ({ page }) => {
    const longSword = page.locator('.equipment-card', { hasText: 'Long Sword' }).first();

    // Check for tags
    await expect(longSword).toContainText('2h');
    await expect(longSword).toContainText('swept');
    await expect(longSword).toContainText('precise');

    // Check for stats
    await expect(longSword).toContainText('d10');
    await expect(longSword).toContainText('2 slots');
  });

  test('should display armor when armor tab clicked', async ({ page }) => {
    await page.click('text=Armor');

    const armorPieces = ['Chain Mail', 'Scale Vest', 'Helm', 'Greaves', 'Cloak'];

    for (const armor of armorPieces) {
      const armorCard = page.locator('.equipment-card', { hasText: armor });
      await expect(armorCard).toBeVisible();
    }
  });

  test('should display skills when skills tab clicked', async ({ page }) => {
    await page.click('text=Skills');

    // Check skill categories
    await expect(page.locator('h3', { hasText: 'Attack Skills' })).toBeVisible();
    await expect(page.locator('h3', { hasText: 'Defense Skills' })).toBeVisible();
    await expect(page.locator('h3', { hasText: 'Tenacity Skills' })).toBeVisible();

    // Check some specific skills
    const skills = ['Surgical', 'Dual Wielding', 'Counter Strike', 'Moving Target', 'Grit'];

    for (const skill of skills) {
      const skillCard = page.locator('.skill-card', { hasText: skill });
      await expect(skillCard).toBeVisible();
    }
  });

  test('should display upgrades when upgrades tab clicked', async ({ page }) => {
    await page.click('text=Upgrades');

    const upgrades = ['Master-Craft', 'Serrated', 'Sword Breaker', 'Lucky', 'Balanced', 'Deadly'];

    for (const upgrade of upgrades) {
      const upgradeCard = page.locator('.equipment-card', { hasText: upgrade });
      await expect(upgradeCard).toBeVisible();
    }
  });
});
