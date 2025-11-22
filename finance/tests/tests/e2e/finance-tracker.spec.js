import { test, expect } from '@playwright/test';

test.describe('Finance Tracker E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Track console errors and warnings
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('Browser console error:', msg.text());
      }
    });

    // Track page errors
    page.on('pageerror', err => {
      console.log('Page error:', err.message);
    });
  });

  test('should load the finance tracker homepage', async ({ page }) => {
    await page.goto('/');

    // Check title
    await expect(page.locator('.header__title')).toContainText('Finance Tracker');

    // Check navigation exists
    await expect(page.locator('.nav-btn[data-view="dashboard"]')).toBeVisible();
    await expect(page.locator('.nav-btn[data-view="transactions"]')).toBeVisible();
    await expect(page.locator('.nav-btn[data-view="accounts"]')).toBeVisible();
    await expect(page.locator('.nav-btn[data-view="budget"]')).toBeVisible();
  });

  test('should check Firebase configuration', async ({ page }) => {
    await page.goto('/');

    // Check that Firebase config is loaded
    const firebaseConfig = await page.evaluate(() => {
      return window.firebaseConfig || null;
    });

    if (firebaseConfig) {
      expect(firebaseConfig).toHaveProperty('apiKey');
      expect(firebaseConfig).toHaveProperty('projectId');
      console.log('Firebase config found:', {
        projectId: firebaseConfig.projectId,
        apiKey: firebaseConfig.apiKey ? '***' : 'missing'
      });
    } else {
      console.log('Firebase config not found in window object');
    }
  });

  test('should not be stuck on loading forever', async ({ page }) => {
    await page.goto('/');

    // Wait a reasonable time for data to load
    await page.waitForTimeout(3000);

    // Check if we're still showing only loading indicators
    const accountSummary = page.locator('#account-summary');
    const accountSummaryText = await accountSummary.textContent();

    // We should either see actual data or an error message, not just "Loading"
    const isStuckLoading = accountSummaryText?.includes('Loading') &&
                          !accountSummaryText?.includes('error') &&
                          !accountSummaryText?.includes('Total Balance');

    if (isStuckLoading) {
      // Log page content for debugging
      const pageContent = await page.content();
      console.log('Page appears stuck on loading. Current state:');
      console.log('Account summary:', accountSummaryText);

      // Check for JavaScript errors
      const errors = await page.evaluate(() => {
        return window.errors || [];
      });
      console.log('JavaScript errors:', errors);
    }

    expect(isStuckLoading).toBe(false);
  });

  test('should show account data or error state', async ({ page }) => {
    await page.goto('/');

    // Wait for the loading to complete (max 10 seconds)
    await expect(async () => {
      const accountSummary = page.locator('#account-summary');
      const text = await accountSummary.textContent();

      // Should show either data, empty state, or error - but not loading
      const hasData = text?.includes('Total Balance') || text?.includes('$');
      const hasEmptyState = text?.includes('No accounts') || text?.includes('Add your first account');
      const hasError = text?.includes('error') || text?.includes('Error');
      const isLoading = text?.includes('Loading');

      expect(hasData || hasEmptyState || hasError).toBe(true);
      expect(isLoading).toBe(false);
    }).toPass({ timeout: 10000 });
  });

  test('should handle Firebase initialization errors gracefully', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Log any Firebase-related errors
    const firebaseErrors = consoleErrors.filter(err =>
      err.toLowerCase().includes('firebase') ||
      err.toLowerCase().includes('firestore')
    );

    if (firebaseErrors.length > 0) {
      console.log('Firebase errors detected:', firebaseErrors);
    }

    // Page should still be functional even with errors
    await expect(page.locator('.header__title')).toBeVisible();
  });

  test('should display account summary section', async ({ page }) => {
    await page.goto('/');

    // Account summary section should be visible
    await expect(page.locator('#account-summary')).toBeVisible();

    // Check the section has a title
    const cardTitle = page.locator('.card__title').filter({ hasText: 'Account Summary' });
    await expect(cardTitle).toBeVisible();
  });

  test('should display recent transactions section', async ({ page }) => {
    await page.goto('/');

    // Recent transactions section should be visible
    await expect(page.locator('#recent-transactions')).toBeVisible();

    // Check the section has a title
    const cardTitle = page.locator('.card__title').filter({ hasText: 'Recent Transactions' });
    await expect(cardTitle).toBeVisible();
  });

  test('should display budget overview section', async ({ page }) => {
    await page.goto('/');

    // Budget overview section should be visible
    await expect(page.locator('#budget-overview')).toBeVisible();

    // Check the section has a title
    const cardTitle = page.locator('.card__title').filter({ hasText: 'Monthly Budget' });
    await expect(cardTitle).toBeVisible();
  });

  test('should navigate between views', async ({ page }) => {
    await page.goto('/');

    // Click on Transactions tab
    await page.click('.nav-btn[data-view="transactions"]');
    await expect(page.locator('#transactions-view')).toBeVisible();
    await expect(page.locator('#dashboard-view')).not.toBeVisible();

    // Click on Accounts tab
    await page.click('.nav-btn[data-view="accounts"]');
    await expect(page.locator('#accounts-view')).toBeVisible();
    await expect(page.locator('#transactions-view')).not.toBeVisible();

    // Click on Budget tab
    await page.click('.nav-btn[data-view="budget"]');
    await expect(page.locator('#budget-view')).toBeVisible();
    await expect(page.locator('#accounts-view')).not.toBeVisible();

    // Click back to Dashboard
    await page.click('.nav-btn[data-view="dashboard"]');
    await expect(page.locator('#dashboard-view')).toBeVisible();
    await expect(page.locator('#budget-view')).not.toBeVisible();
  });

  test('should open add transaction modal', async ({ page }) => {
    await page.goto('/');

    // Navigate to transactions view
    await page.click('.nav-btn[data-view="transactions"]');

    // Click add transaction button
    await page.click('#add-transaction-btn');

    // Modal should be visible
    await expect(page.locator('#transaction-modal')).toBeVisible();
    await expect(page.locator('#transaction-modal-title')).toContainText('Add Transaction');

    // Form fields should be visible
    await expect(page.locator('#transaction-date')).toBeVisible();
    await expect(page.locator('#transaction-amount')).toBeVisible();
    await expect(page.locator('#transaction-description')).toBeVisible();
    await expect(page.locator('#transaction-category')).toBeVisible();
    await expect(page.locator('#transaction-account')).toBeVisible();
  });

  test('should open add account modal', async ({ page }) => {
    await page.goto('/');

    // Navigate to accounts view
    await page.click('.nav-btn[data-view="accounts"]');

    // Click add account button
    await page.click('#add-account-btn');

    // Modal should be visible
    await expect(page.locator('#account-modal')).toBeVisible();
    await expect(page.locator('#account-modal-title')).toContainText('Add Account');

    // Form fields should be visible
    await expect(page.locator('#account-name')).toBeVisible();
    await expect(page.locator('#account-type')).toBeVisible();
    await expect(page.locator('#account-institution')).toBeVisible();
    await expect(page.locator('#account-balance')).toBeVisible();
  });

  test('should have health check endpoint', async ({ page }) => {
    const response = await page.goto('/health');
    expect(response?.status()).toBe(200);
  });

  test('should log Firebase connection details', async ({ page }) => {
    await page.goto('/');

    // Get Firebase initialization status
    const firebaseStatus = await page.evaluate(async () => {
      try {
        // Check if Firebase is initialized
        const firebase = window.firebase;
        if (!firebase) {
          return { status: 'Firebase not loaded', error: 'window.firebase is undefined' };
        }

        // Try to get Firestore instance
        const app = firebase.getApps?.()?.[0];
        if (!app) {
          return { status: 'No Firebase app', error: 'No Firebase app initialized' };
        }

        // Check if we can access Firestore
        try {
          const db = firebase.firestore?.();
          if (!db) {
            return { status: 'Firestore unavailable', error: 'Could not get Firestore instance' };
          }

          // Try a test query
          const testQuery = await db.collection('finance_accounts').limit(1).get();
          return {
            status: 'Connected',
            accountsFound: testQuery.size,
            projectId: app.options.projectId
          };
        } catch (firestoreError) {
          return {
            status: 'Firestore error',
            error: firestoreError.message,
            projectId: app.options.projectId
          };
        }
      } catch (error) {
        return { status: 'Error', error: error.message };
      }
    });

    console.log('Firebase connection status:', firebaseStatus);

    // At minimum, we should have some status
    expect(firebaseStatus).toBeDefined();
    expect(firebaseStatus.status).toBeDefined();
  });
});
