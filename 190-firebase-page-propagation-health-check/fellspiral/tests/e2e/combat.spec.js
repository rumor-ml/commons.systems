import { test, expect } from '../../../playwright.fixtures.ts';

test.describe('Combat Rules Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#zones');
  });

  test('should display combat rule sections', async ({ page }) => {
    const ruleSections = ['#zones', '#actions', '#trading-initiative', '#conditions'];

    for (const sectionId of ruleSections) {
      const section = page.locator(sectionId);
      await expect(section).toBeVisible();
    }
  });

  test('should explain zones', async ({ page }) => {
    const zonesSection = page.locator('#zones');
    await expect(zonesSection).toContainText('10 paces');
    await expect(zonesSection).toContainText('adjacent');
  });

  test('should list action types', async ({ page }) => {
    const actionsSection = page.locator('#actions');
    await expect(actionsSection).toContainText('Move');
    await expect(actionsSection).toContainText('Attack');
    await expect(actionsSection).toContainText('Equip');
    await expect(actionsSection).toContainText('Hold');
    await expect(actionsSection).toContainText('Hurry');
  });

  test('should explain initiative trading', async ({ page }) => {
    const initiativeSection = page.locator('#trading-initiative');
    await expect(initiativeSection).toContainText('Defender has initiative by default');
    await expect(initiativeSection).toContainText('crit');
  });

  test('should list all conditions', async ({ page }) => {
    const conditionsSection = page.locator('#conditions');
    const conditions = ['Pinned', 'Stunned', 'Exhausted', 'Afraid', 'Immobilized', 'Bleeding'];

    for (const condition of conditions) {
      await expect(conditionsSection).toContainText(condition);
    }
  });
});
