import { test, expect } from '@playwright/test';

test.describe('Combat Simulator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#simulator');
  });

  test('should display combat simulator section', async ({ page }) => {
    const heading = page.locator('h2', { hasText: 'Combat Simulator' });
    await expect(heading).toBeVisible();
  });

  test('should have character selection dropdowns', async ({ page }) => {
    const combatant1Select = page.locator('#combatant1');
    const combatant2Select = page.locator('#combatant2');

    await expect(combatant1Select).toBeVisible();
    await expect(combatant2Select).toBeVisible();
  });

  test('should list all available characters in dropdowns', async ({ page }) => {
    const combatant1Select = page.locator('#combatant1');

    // Check that all characters are available
    const characters = [
      'Caleb',
      'Skeleton',
      'Skeleton Commander',
      'Ghoul',
      'Krovnaya Striga'
    ];

    for (const character of characters) {
      const option = combatant1Select.locator('option', { hasText: character });
      await expect(option).toHaveCount(1);
    }
  });

  test('should have a simulate combat button', async ({ page }) => {
    const simulateBtn = page.locator('#simulateBtn');
    await expect(simulateBtn).toBeVisible();
    await expect(simulateBtn).toContainText('Simulate Combat');
  });

  test('should display combat log after simulation', async ({ page }) => {
    // Select different combatants
    await page.selectOption('#combatant1', 'caleb');
    await page.selectOption('#combatant2', 'skeleton');

    // Click simulate button
    await page.click('#simulateBtn');

    // Wait for combat log to appear
    const combatLog = page.locator('#combatLog');
    await expect(combatLog).toBeVisible();

    // Check that log contains combat information
    const logContent = page.locator('#logContent');
    await expect(logContent).toContainText('COMBAT BEGINS');
    await expect(logContent).toContainText('ROUND');
  });

  test('should prevent selecting the same combatant twice', async ({ page }) => {
    // Select same character for both
    await page.selectOption('#combatant1', 'skeleton');
    await page.selectOption('#combatant2', 'skeleton');

    // Setup dialog handler to capture alert
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('different combatants');
      await dialog.accept();
    });

    // Click simulate button
    await page.click('#simulateBtn');
  });

  test('should run complete combat simulation', async ({ page }) => {
    // Select combatants
    await page.selectOption('#combatant1', 'skeletonCommander');
    await page.selectOption('#combatant2', 'ghoul');

    // Click simulate button
    await page.click('#simulateBtn');

    // Wait for combat log
    const logContent = page.locator('#logContent');
    await expect(logContent).toBeVisible();

    // Check for winner or draw
    const content = await logContent.textContent();
    expect(content).toMatch(/WINNER|DRAW|maximum rounds/);
  });

  test('should show combat mechanics in log', async ({ page }) => {
    // Run a simulation
    await page.selectOption('#combatant1', 'caleb');
    await page.selectOption('#combatant2', 'skeleton');
    await page.click('#simulateBtn');

    // Check for combat mechanics
    const logContent = page.locator('#logContent');
    await expect(logContent).toContainText('attacks');
    await expect(logContent).toContainText('AC');
  });
});
