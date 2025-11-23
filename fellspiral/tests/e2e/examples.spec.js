import { test, expect } from '@playwright/test';

test.describe('Combat Example Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#examples');
  });

  test('should display combat example story', async ({ page }) => {
    const exampleSection = page.locator('#examples');
    await expect(exampleSection).toBeVisible();

    const storyTitle = page.locator('#examples h2');
    await expect(storyTitle).toContainText('The Hungry Goblin');
  });

  test('should show different narration types', async ({ page }) => {
    // Check for player narrations
    const playerNarrations = page.locator('.player-narration');
    await expect(playerNarrations.first()).toBeVisible();

    // Check for antagonist narrations
    const antagonistNarrations = page.locator('.antagonist-narration');
    await expect(antagonistNarrations.first()).toBeVisible();

    // Check for mechanics explanations
    const mechanics = page.locator('.mechanics');
    await expect(mechanics.first()).toBeVisible();
  });

  test('should demonstrate initiative mechanics', async ({ page }) => {
    const example = page.locator('#examples');

    // Check that initiative changes are shown
    await expect(example).toContainText('with initiative');
    await expect(example).toContainText('takes initiative');
  });

  test('should demonstrate conditions', async ({ page }) => {
    const example = page.locator('#examples');

    // Check that conditions are demonstrated
    await expect(example).toContainText('Afraid');
    await expect(example).toContainText('Pinned');
  });
});
