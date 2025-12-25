/**
 * E2E tests for test helper functions
 * Tests verify input validation and error handling in test utilities
 */

import { test, expect } from '../../../playwright.fixtures.ts';
import {
  getCardFromFirestore,
  deleteTestCards,
  getFirestoreAdmin,
  createCardViaUI,
  generateTestCardData,
} from './test-helpers.js';

test.describe('Test Helper Input Validation', () => {
  test('getCardFromFirestore should reject invalid cardTitle', async () => {
    // Test empty string
    await expect(async () => {
      await getCardFromFirestore('');
    }).rejects.toThrow('cardTitle must be a non-empty string');

    // Test null
    await expect(async () => {
      await getCardFromFirestore(null);
    }).rejects.toThrow('cardTitle must be a non-empty string');

    // Test undefined
    await expect(async () => {
      await getCardFromFirestore(undefined);
    }).rejects.toThrow('cardTitle must be a non-empty string');

    // Test non-string type
    await expect(async () => {
      await getCardFromFirestore(123);
    }).rejects.toThrow('cardTitle must be a non-empty string');
  });

  test('getCardFromFirestore should reject invalid maxRetries', async () => {
    await expect(async () => {
      await getCardFromFirestore('Test Card', -1);
    }).rejects.toThrow('maxRetries must be >= 0');
  });

  test('getCardFromFirestore should reject invalid initialDelayMs', async () => {
    await expect(async () => {
      await getCardFromFirestore('Test Card', 5, 0);
    }).rejects.toThrow('initialDelayMs must be > 0');

    await expect(async () => {
      await getCardFromFirestore('Test Card', 5, -100);
    }).rejects.toThrow('initialDelayMs must be > 0');
  });

  test('deleteTestCards should reject empty or falsy patterns', async () => {
    // Test empty string
    await expect(async () => {
      await deleteTestCards('');
    }).rejects.toThrow('titlePattern must be a non-empty string or RegExp');

    // Test null
    await expect(async () => {
      await deleteTestCards(null);
    }).rejects.toThrow('titlePattern must be a non-empty string or RegExp');

    // Test undefined
    await expect(async () => {
      await deleteTestCards(undefined);
    }).rejects.toThrow('titlePattern must be a non-empty string or RegExp');
  });

  test('deleteTestCards should accept valid string patterns', async () => {
    // Should not throw with valid string
    const count = await deleteTestCards('Test Card');
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('deleteTestCards should accept valid RegExp patterns', async () => {
    // Should not throw with valid RegExp
    const count = await deleteTestCards(/^Test Card/);
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Test Helper Error Scenarios', () => {
  test('getFirestoreAdmin should initialize successfully', async () => {
    // Should not throw when Firestore emulator is running
    const { app, db } = await getFirestoreAdmin();
    expect(app).toBeDefined();
    expect(db).toBeDefined();
  });

  test('getFirestoreAdmin should reuse same instance on subsequent calls', async () => {
    const first = await getFirestoreAdmin();
    const second = await getFirestoreAdmin();

    // Should return the same instances
    expect(first.app).toBe(second.app);
    expect(first.db).toBe(second.db);
  });

  test('getCardFromFirestore should return null when card not found', async () => {
    const result = await getCardFromFirestore('NonExistentCard-' + Date.now(), 1, 100);
    expect(result).toBeNull();
  });

  test('getCardFromFirestore should use exponential backoff', async () => {
    const startTime = Date.now();
    // With maxRetries=3 and initialDelay=100ms, total time should be:
    // attempt 0: 0ms (immediate)
    // attempt 1: 100ms wait
    // attempt 2: 200ms wait
    // attempt 3: 400ms wait
    // Total: ~700ms
    await getCardFromFirestore('NonExistentCard-' + Date.now(), 3, 100);
    const elapsed = Date.now() - startTime;

    // Should take at least 700ms (sum of delays)
    expect(elapsed).toBeGreaterThanOrEqual(650); // Allow some timing variance
  });
});

test.describe('createCardViaUI Auth Race Conditions', () => {
  test('should handle auth.currentUser being set during form submission', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');

    // Create and sign in test user
    await authEmulator.createTestUser('test-auth@example.com');
    await authEmulator.signInTestUser('test-auth@example.com');
    await page.reload();

    // Verify auth is ready
    const authReady = await page.evaluate(() => {
      return window.__testAuth?.currentUser != null;
    });
    expect(authReady).toBe(true);

    // Create card via UI - should succeed with auth ready
    const cardData = generateTestCardData('auth-test');
    await createCardViaUI(page, cardData);

    // Verify card was created
    const cardElement = page.locator('.card-item').filter({ hasText: cardData.title });
    await expect(cardElement).toBeVisible();
  });

  test('should throw clear error when auth.currentUser is not ready', async ({ page }) => {
    await page.goto('/cards.html');

    // Don't sign in - auth.currentUser will be null
    const cardData = generateTestCardData('no-auth-test');

    // Should throw error with helpful message about auth not being ready
    await expect(async () => {
      await createCardViaUI(page, cardData);
    }).rejects.toThrow(/Auth not ready/);
  });

  test('should wait for auth.currentUser to be populated before submission', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');

    // Simulate delayed auth initialization
    await page.evaluate(() => {
      // Clear current user temporarily
      if (window.__testAuth) {
        const originalUser = window.__testAuth.currentUser;
        window.__testAuth.currentUser = null;

        // Restore after delay
        setTimeout(() => {
          window.__testAuth.currentUser = originalUser;
        }, 1000);
      }
    });

    // Create and sign in (this sets up auth state)
    await authEmulator.createTestUser('test-delayed@example.com');
    await authEmulator.signInTestUser('test-delayed@example.com');

    // The createCardViaUI helper waits for auth.currentUser to be set
    // This should succeed despite the temporary null state
    const cardData = generateTestCardData('delayed-auth');

    // This will wait up to 5s for auth.currentUser to be populated
    await createCardViaUI(page, cardData);

    // Verify card was created
    const cardElement = page.locator('.card-item').filter({ hasText: cardData.title });
    await expect(cardElement).toBeVisible();
  });
});
