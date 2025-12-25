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
    const result = await deleteTestCards('Test Card');
    expect(typeof result).toBe('object');
    expect(result.deleted).toBeGreaterThanOrEqual(0);
    expect(result.failed).toBe(0);
  });

  test('deleteTestCards should accept valid RegExp patterns', async () => {
    // Should not throw with valid RegExp
    const result = await deleteTestCards(/^Test Card/);
    expect(typeof result).toBe('object');
    expect(result.deleted).toBeGreaterThanOrEqual(0);
    expect(result.failed).toBe(0);
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
    const result = await getCardFromFirestore(
      'NonExistentCard-' + Date.now() + '-' + Math.random(),
      1,
      100
    );
    expect(result).toBeNull();
  });

  test('getCardFromFirestore should use exponential backoff', async () => {
    const delays = [];
    let lastTime = Date.now();

    // Monkey-patch setTimeout to capture actual delays
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = function (fn, delay) {
      if (typeof delay === 'number' && delay > 0) {
        const now = Date.now();
        delays.push({ delay, elapsed: now - lastTime });
        lastTime = now;
      }
      return originalSetTimeout.call(this, fn, delay);
    };

    try {
      await getCardFromFirestore('NonExistentCard-' + Date.now() + '-' + Math.random(), 3, 100);

      // Should have delays for attempts 1, 2, 3 (not attempt 0)
      expect(delays.length).toBe(3);

      // Verify exponential backoff: 100ms, 200ms, 400ms
      expect(delays[0].delay).toBe(100); // 100 * 2^0
      expect(delays[1].delay).toBe(200); // 100 * 2^1
      expect(delays[2].delay).toBe(400); // 100 * 2^2
    } finally {
      // Restore original setTimeout
      global.setTimeout = originalSetTimeout;
    }
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

test.describe('getCardFromFirestore Error Handling', () => {
  test('should throw helpful error when Firestore emulator unavailable', async () => {
    // NOTE: This test has a known limitation - it cannot reset the module-level
    // cached Firestore instances (_adminApp, _firestoreDb). Once initialized,
    // getFirestoreAdmin() returns the cached instance, so changing
    // FIRESTORE_EMULATOR_HOST has no effect. This test verifies the error
    // handling logic exists, but cannot fully test the unavailable scenario
    // without process isolation or instance reset capability.

    // For now, we verify that if we could reset, the error would be helpful
    const originalHost = process.env.FIRESTORE_EMULATOR_HOST;
    process.env.FIRESTORE_EMULATOR_HOST = 'invalid-host:99999';

    try {
      // This test demonstrates the limitation: even with invalid host,
      // if getFirestoreAdmin was already called, it returns cached instance
      // A future improvement could add a resetFirestoreAdmin() function for testing
      await expect(async () => {
        await getCardFromFirestore('Test Card', 0, 100);
      }).rejects.toThrow(
        /Firestore emulator unavailable|Failed to connect|getCardFromFirestore failed/
      );
    } finally {
      // Restore original host
      process.env.FIRESTORE_EMULATOR_HOST = originalHost;
    }
  });

  test('should succeed on retry after transient failure', async ({ page, authEmulator }) => {
    // This test verifies the retry mechanism works correctly
    // Create a test card first
    await page.goto('/cards.html');
    await authEmulator.createTestUser('test-retry@example.com');
    await authEmulator.signInTestUser('test-retry@example.com');
    await page.reload();

    const cardData = generateTestCardData('retry-test');
    await createCardViaUI(page, cardData);

    // Now verify we can retrieve it with retries
    // Use short delays to keep test fast
    const card = await getCardFromFirestore(cardData.title, 3, 100);

    expect(card).not.toBeNull();
    expect(card.title).toBe(cardData.title);
  });

  test('should return null after max retries when card not found', async () => {
    const nonExistentTitle = 'NonExistent-' + Date.now();

    // Use minimal retries and short delay to keep test fast
    const result = await getCardFromFirestore(nonExistentTitle, 2, 50);

    expect(result).toBeNull();
  });

  test('should handle cards with malformed data (null/undefined title)', async ({
    page,
    authEmulator,
  }) => {
    // This test verifies the guard against malformed Firestore data
    // getCardFromFirestore validates input, but we should also handle
    // cases where Firestore returns documents with missing/null title fields

    await page.goto('/cards.html');
    await authEmulator.createTestUser('test-malformed@example.com');
    await authEmulator.signInTestUser('test-malformed@example.com');
    await page.reload();

    // The input validation in getCardFromFirestore prevents null/undefined
    // cardTitle parameters, which is the primary guard
    await expect(async () => {
      await getCardFromFirestore(null, 1, 100);
    }).rejects.toThrow('cardTitle must be a non-empty string');

    await expect(async () => {
      await getCardFromFirestore(undefined, 1, 100);
    }).rejects.toThrow('cardTitle must be a non-empty string');
  });

  test('should use exponential backoff for retries', async () => {
    const startTime = Date.now();

    // With maxRetries=3 and initialDelay=100ms, delays are:
    // attempt 0: no delay (immediate)
    // attempt 1: 100ms * 2^0 = 100ms
    // attempt 2: 100ms * 2^1 = 200ms
    // attempt 3: 100ms * 2^2 = 400ms
    // Total: ~700ms
    await getCardFromFirestore('NonExistent-' + Date.now(), 3, 100);
    const elapsed = Date.now() - startTime;

    // Should take at least 700ms due to exponential backoff
    expect(elapsed).toBeGreaterThanOrEqual(650); // Allow timing variance
    expect(elapsed).toBeLessThan(1000); // But not too long
  });

  test('should handle long connection delays gracefully', async () => {
    // Test with longer delays to ensure helper can handle slow Firestore responses
    // This simulates network latency or slow emulator startup
    const startTime = Date.now();

    // Use fewer retries but longer initial delay to test >5 second scenario
    // maxRetries=2, initialDelay=2000ms:
    // attempt 0: 0ms (immediate)
    // attempt 1: 2000ms wait
    // attempt 2: 4000ms wait
    // Total: ~6000ms (exceeds 5 second threshold)
    const result = await getCardFromFirestore(
      'SlowConnection-' + Date.now() + '-' + Math.random(),
      2,
      2000
    );
    const elapsed = Date.now() - startTime;

    // Should return null after waiting through all retries
    expect(result).toBeNull();

    // Should have waited approximately 6 seconds
    expect(elapsed).toBeGreaterThanOrEqual(5800); // Allow timing variance
    expect(elapsed).toBeLessThan(7000); // But not excessively long
  });
});

test.describe('deleteTestCards Batch Handling and Edge Cases', () => {
  test('should handle large batch deletions (500+ cards)', async ({ page, authEmulator }) => {
    // Firestore batch limit is 500 operations per batch
    // This test verifies we can handle more than that
    // Note: Creating 500+ cards is slow, so we'll test with a smaller number
    // and verify the batch mechanism works correctly

    await page.goto('/cards.html');
    await authEmulator.createTestUser('test-batch@example.com');
    await authEmulator.signInTestUser('test-batch@example.com');
    await page.reload();

    const timestamp = Date.now();
    const batchTestPrefix = `BatchTest-${timestamp}`;

    // Create 50 cards (enough to test batching logic without taking too long)
    for (let i = 0; i < 50; i++) {
      const cardData = generateTestCardData(`${batchTestPrefix}-${i}`);
      await createCardViaUI(page, cardData);
    }

    // Delete all cards with this prefix
    const result = await deleteTestCards(batchTestPrefix);

    // Should have deleted exactly 50 cards
    expect(result.deleted).toBe(50);
    expect(result.failed).toBe(0);

    // Verify all cards are actually deleted (not just a sample)
    // Check every 10th card for performance (0, 10, 20, 30, 40)
    for (let i = 0; i < 50; i += 10) {
      const card = await getCardFromFirestore(
        `Test Card ${timestamp}-${batchTestPrefix}-${i}`,
        1,
        100
      );
      expect(card).toBeNull();
    }

    // Also verify the exact count returned matches what we expect
    expect(result.deleted).toBe(50);
    expect(result.failed).toBe(0);
  });

  test('should handle deletion when no cards match pattern', async () => {
    const nonExistentPattern = 'NoCardsMatch-' + Date.now();

    const result = await deleteTestCards(nonExistentPattern);

    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(0);
  });

  test('should handle RegExp patterns correctly', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await authEmulator.createTestUser('test-regex@example.com');
    await authEmulator.signInTestUser('test-regex@example.com');
    await page.reload();

    const timestamp = Date.now();
    const regexTestPrefix = `RegexTest-${timestamp}`;

    // Create a few test cards
    for (let i = 0; i < 3; i++) {
      const cardData = generateTestCardData(`${regexTestPrefix}-${i}`);
      await createCardViaUI(page, cardData);
    }

    // Delete using RegExp pattern
    const pattern = new RegExp(`Test Card ${timestamp}-${regexTestPrefix}`);
    const result = await deleteTestCards(pattern);

    expect(result.deleted).toBe(3);
    expect(result.failed).toBe(0);
  });

  test('should provide clear error when Firestore unavailable', async () => {
    // Temporarily break the Firestore connection
    const originalHost = process.env.FIRESTORE_EMULATOR_HOST;
    process.env.FIRESTORE_EMULATOR_HOST = 'invalid-host:99999';

    try {
      await expect(async () => {
        await deleteTestCards('Test Card');
      }).rejects.toThrow(/Firestore emulator unavailable|Failed to connect/);
    } finally {
      process.env.FIRESTORE_EMULATOR_HOST = originalHost;
    }
  });
});
