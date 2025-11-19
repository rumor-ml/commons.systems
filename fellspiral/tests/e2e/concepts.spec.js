import { test, expect } from '@playwright/test';

test.describe('Core Concepts Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#concepts');
  });

  test('should display all concept cards', async ({ page }) => {
    const conceptTitles = [
      'Initiative',
      'Referee & Antagonist Roles',
      'Damage System',
      'Combat Rounds'
    ];

    for (const title of conceptTitles) {
      const card = page.locator('.concept-card', { hasText: title });
      await expect(card).toBeVisible();
    }
  });

  test('should explain initiative concept', async ({ page }) => {
    const initiativeCard = page.locator('.concept-card', { hasText: 'Initiative' });
    await expect(initiativeCard).toContainText('narrative control');
    await expect(initiativeCard).toContainText('tempo of battle');
  });

  test('should explain damage system', async ({ page }) => {
    const damageCard = page.locator('.concept-card', { hasText: 'Damage System' });
    await expect(damageCard).toContainText('slots');
    await expect(damageCard).toContainText('conditions');
    await expect(damageCard).toContainText('10 equipment slots');
    await expect(damageCard).toContainText('10 skill slots');
  });

  test('should explain combat rounds', async ({ page }) => {
    const roundsCard = page.locator('.concept-card', { hasText: 'Combat Rounds' });
    await expect(roundsCard).toContainText('5 phases');
    await expect(roundsCard).toContainText('d20');
  });
});
