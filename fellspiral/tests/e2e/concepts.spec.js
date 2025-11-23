import { test, expect } from '@playwright/test';

test.describe('Core Concepts Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#initiative');
  });

  test('should display all concept sections', async ({ page }) => {
    // Check all concept sections are visible
    const conceptSections = [
      '#initiative',
      '#roles',
      '#damage',
      '#rounds'
    ];

    for (const sectionId of conceptSections) {
      const section = page.locator(sectionId);
      await expect(section).toBeVisible();
    }
  });

  test('should explain initiative concept', async ({ page }) => {
    const initiativeSection = page.locator('#initiative');
    await expect(initiativeSection).toBeVisible();
    await expect(initiativeSection).toContainText('narrative control');
    await expect(initiativeSection).toContainText('tempo of battle');
  });

  test('should explain damage system', async ({ page }) => {
    const damageSection = page.locator('#damage');
    await expect(damageSection).toContainText('slots');
    await expect(damageSection).toContainText('conditions');
    await expect(damageSection).toContainText('10 equipment slots');
    await expect(damageSection).toContainText('10 skill slots');
  });

  test('should explain combat rounds', async ({ page }) => {
    const roundsSection = page.locator('#rounds');
    await expect(roundsSection).toContainText('5 phases');
    await expect(roundsSection).toContainText('d20');
  });
});
