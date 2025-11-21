import { test, expect } from '@playwright/test';

test.describe('Layout Module - Basic Tests', () => {
  test('should load the application', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Layout Module/);
    await expect(page.locator('h1')).toContainText('Layout Module');
  });

  test('should show all navigation tabs', async ({ page }) => {
    await page.goto('/');

    // Verify all tabs are present
    await expect(page.locator('[data-tab="templates"]')).toBeVisible();
    await expect(page.locator('[data-tab="cards"]')).toBeVisible();
    await expect(page.locator('[data-tab="card-pairs"]')).toBeVisible();
    await expect(page.locator('[data-tab="documents"]')).toBeVisible();
  });

  test('should switch between tabs', async ({ page }) => {
    await page.goto('/');

    // Initially, Templates tab should be active
    await expect(page.locator('[data-tab="templates"]')).toHaveClass(/active/);
    await expect(page.locator('#templates-tab')).toHaveClass(/active/);

    // Click Cards tab
    await page.click('[data-tab="cards"]');
    await expect(page.locator('[data-tab="cards"]')).toHaveClass(/active/);
    await expect(page.locator('#cards-tab')).toHaveClass(/active/);

    // Click Documents tab
    await page.click('[data-tab="documents"]');
    await expect(page.locator('[data-tab="documents"]')).toHaveClass(/active/);
    await expect(page.locator('#documents-tab')).toHaveClass(/active/);
  });

  test('should have create buttons on each tab', async ({ page }) => {
    await page.goto('/');

    // Templates tab
    await expect(page.locator('#create-template-btn')).toBeVisible();

    // Cards tab
    await page.click('[data-tab="cards"]');
    await expect(page.locator('#create-card-btn')).toBeVisible();

    // Card Pairs tab
    await page.click('[data-tab="card-pairs"]');
    await expect(page.locator('#create-pair-btn')).toBeVisible();

    // Documents tab
    await page.click('[data-tab="documents"]');
    await expect(page.locator('#create-document-btn')).toBeVisible();
  });

  test('should show search input on Cards tab', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-tab="cards"]');

    await expect(page.locator('#cards-search')).toBeVisible();
    await expect(page.locator('#cards-search')).toHaveAttribute('placeholder', /Search cards/);
  });

  test('should show group tree on Documents tab', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-tab="documents"]');

    await expect(page.locator('.group-tree-sidebar')).toBeVisible();
    await expect(page.locator('#group-tree')).toBeVisible();
    await expect(page.locator('#create-group-btn')).toBeVisible();
  });

  test('should show tag filters on Cards tab', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-tab="cards"]');

    await expect(page.locator('.tag-filters')).toBeVisible();
    await expect(page.locator('.filter-mode')).toBeVisible();
    await expect(page.locator('input[name="filter-mode"][value="or"]')).toBeVisible();
    await expect(page.locator('input[name="filter-mode"][value="and"]')).toBeVisible();
  });

  test('should have footer with correct text', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.app-footer')).toBeVisible();
    await expect(page.locator('.app-footer')).toContainText('Layout Module');
  });
});
