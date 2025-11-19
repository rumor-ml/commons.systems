import { test, expect } from '@playwright/test';

test.describe('Combat Rules Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#combat');
  });

  test('should display combat rule cards', async ({ page }) => {
    const ruleTitles = ['Zones', 'Actions', 'Trading Initiative', 'Conditions'];

    for (const title of ruleTitles) {
      const card = page.locator('.rule-card', { hasText: title });
      await expect(card).toBeVisible();
    }
  });

  test('should explain zones', async ({ page }) => {
    const zonesCard = page.locator('.rule-card', { hasText: 'Zones' });
    await expect(zonesCard).toContainText('10 paces');
    await expect(zonesCard).toContainText('adjacent');
  });

  test('should list action types', async ({ page }) => {
    const actionsCard = page.locator('.rule-card', { hasText: 'Actions' });
    await expect(actionsCard).toContainText('Move');
    await expect(actionsCard).toContainText('Attack');
    await expect(actionsCard).toContainText('Equip');
    await expect(actionsCard).toContainText('Hold');
    await expect(actionsCard).toContainText('Hurry');
  });

  test('should explain initiative trading', async ({ page }) => {
    const initiativeCard = page.locator('.rule-card', { hasText: 'Trading Initiative' });
    await expect(initiativeCard).toContainText('Defender has initiative by default');
    await expect(initiativeCard).toContainText('crit');
  });

  test('should list all conditions', async ({ page }) => {
    const conditionsCard = page.locator('.rule-card', { hasText: 'Conditions' });
    const conditions = ['Pinned', 'Stunned', 'Exhausted', 'Afraid', 'Immobilized', 'Bleeding'];

    for (const condition of conditions) {
      await expect(conditionsCard).toContainText(condition);
    }
  });
});
