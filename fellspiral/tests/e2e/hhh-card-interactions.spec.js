/**
 * Add Card E2E Tests
 * Tests the complete Add Card workflow including UI, validation, and persistence
 *
 * OPTIMIZATION(#1805): Firebase init waits optimized from fixed 2-3s timeouts to condition-based waits (50-200ms typical)
 * TODO(#1356): Replace fixed timeouts with condition-based waiting for better test reliability
 * TODO(#480): Add 5 critical missing tests from all-hands review:
 *   1. Double-submit prevention via rapid Enter key presses
 *   2. XSS protection for custom type values via "Add New"
 *   3. Firestore write failure state cleanup (isSaving flag)
 *   4. Auth state restoration retry logic
 *   5. Combobox error state on getOptions() exception
 * TODO: See issue #311 - Add delete card E2E tests (security, confirmation, Firestore removal)
 * TODO: See issue #311 - Add concurrent edit conflict detection tests
 * TODO: See issue #311 - Add network error handling tests (timeouts, retries, user guidance)
 */

import { test, expect } from '../../../playwright.fixtures.ts';
import {
  createCardViaUI,
  waitForCardInFirestore,
  generateTestCardData,
  getTestCollectionName,
} from './test-helpers.js';

const isEmulatorMode = process.env.VITE_USE_FIREBASE_EMULATOR === 'true';

// Tests run serially within each browser project but Firefox/Chromium run in parallel.
// Each test creates cards with unique timestamps to prevent conflicts within a test run.
// Note: Emulator data persists between runs - use `make clean-emulator` to reset
test.describe.configure({ mode: 'serial' });

test.describe('Combobox Keyboard Navigation', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test('should open dropdown with ArrowDown when closed', async ({ page, authEmulator }) => {
    await page.goto('/cards.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.locator('#addCardBtn').click();
    await page.locator('#cardType').focus();
    await page.locator('#cardType').press('ArrowDown');
    await expect(page.locator('#typeCombobox.open')).toBeVisible();
  });

  test('should navigate options with ArrowDown/ArrowUp', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.locator('#addCardBtn').click();
    await page.locator('#cardType').focus();
    await page.locator('#cardType').press('ArrowDown');
    await page.locator('#cardType').press('ArrowDown');
    const highlighted = page.locator('#typeListbox .combobox-option.highlighted');
    await expect(highlighted).toBeVisible();
  });

  test('should select option with Enter key', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.locator('#addCardBtn').click();
    await page.locator('#cardType').focus();
    await page.locator('#cardType').press('ArrowDown');
    await page.locator('#cardType').press('ArrowDown');
    await page.locator('#cardType').press('Enter');
    await expect(page.locator('#typeCombobox.open')).not.toBeVisible();
    expect(await page.locator('#cardType').inputValue()).not.toBe('');
  });

  test('should close dropdown with Escape key', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.locator('#addCardBtn').click();
    await page.locator('#cardType').focus();
    await page.locator('#cardType').press('ArrowDown');
    await expect(page.locator('#typeCombobox.open')).toBeVisible();
    await page.locator('#cardType').press('Escape');
    await expect(page.locator('#typeCombobox.open')).not.toBeVisible();
  });
});

test.describe('Combobox Add New Feature', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test('should show Add New option for non-matching input', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.locator('#addCardBtn').click();
    const newType = `CustomType${Date.now()}`;
    await page.locator('#cardType').fill(newType);
    await expect(page.locator('#typeListbox .combobox-option--new')).toContainText(
      `Add "${newType}"`
    );
  });

  test('should select Add New option and populate input', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.locator('#addCardBtn').click();
    const newType = `NewType${Date.now()}`;
    await page.locator('#cardType').fill(newType);
    await page.locator('#typeListbox .combobox-option--new').click();
    expect(await page.locator('#cardType').inputValue()).toBe(newType);
  });
});

test.describe('Combobox Subtype Clearing', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  // TODO: Combobox subtype not clearing when type changes - auth/firestore state issue
  test.skip('should clear subtype value when type changes', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Select Equipment type and Weapon subtype
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#cardSubtype').press('Escape');
    expect(await page.locator('#cardSubtype').inputValue()).toBe('Weapon');

    // Change type using keyboard navigation
    // Type a different value and use Enter to confirm selection
    await page.locator('#cardType').click();
    await page.locator('#cardType').fill('Skill');
    await page.waitForTimeout(100); // Let dropdown filter
    await page.locator('#cardType').press('ArrowDown');
    await page.locator('#cardType').press('Enter');
    await page.waitForTimeout(100); // Let onSelect handler run

    // Verify subtype was cleared
    expect(await page.locator('#cardSubtype').inputValue()).toBe('');
  });
});

test.describe('Combobox Interaction Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test('should filter combobox options as user types', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.locator('#addCardBtn').click();
    await page.locator('#cardType').focus();

    // Wait for the listbox to open and populate
    await expect(page.locator('#typeCombobox.open')).toBeVisible();
    await page.waitForTimeout(100); // Give time for options to populate

    const initialCount = await page.locator('#typeListbox .combobox-option').count();
    expect(initialCount).toBeGreaterThan(1); // Ensure we have multiple options to filter

    await page.locator('#cardType').fill('equip');

    // Wait for DOM update with a small timeout
    await page.waitForTimeout(200);

    const filteredCount = await page.locator('#typeListbox .combobox-option').count();
    expect(filteredCount).toBeLessThan(initialCount);
    expect(filteredCount).toBeGreaterThan(0); // Should still have at least "Equipment"
  });

  test('should toggle dropdown via toggle button', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.locator('#addCardBtn').click();

    // Wait for modal to open and form to be ready
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });
    await page.waitForSelector('#cardType', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(100); // Small delay to ensure form initialization completes

    await page.locator('#typeCombobox .combobox-toggle').click();
    await expect(page.locator('#typeCombobox.open')).toBeVisible();
    await page.locator('#typeCombobox .combobox-toggle').click();
    await expect(page.locator('#typeCombobox.open')).not.toBeVisible();
  });

  test('should close combobox when clicking outside', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.locator('#addCardBtn').click();
    await page.locator('#cardType').focus();
    await expect(page.locator('#typeCombobox.open')).toBeVisible();
    await page.locator('#cardTitle').click();
    await expect(page.locator('#typeCombobox.open')).not.toBeVisible();
  });

  test('should allow option selection despite blur delay', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.locator('#addCardBtn').click();
    await page.locator('#cardType').focus();
    await page.locator('#typeListbox .combobox-option').first().click();
    expect(await page.locator('#cardType').inputValue()).not.toBe('');
  });
});

test.describe('Combobox - Error State Recovery', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  // TODO(#1250): Fix combobox error message display when getOptions() throws
  test.skip('should show error message when getOptions() throws', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Inject error into getOptions function
    await page.evaluate(() => {
      // Override getTypesFromCards to throw error
      const originalGetTypes = window.getTypesFromCards;
      window.__originalGetTypes = originalGetTypes;
      window.getTypesFromCards = () => {
        throw new Error('Test error: getOptions failed');
      };
    });

    // Try to open combobox (should trigger error)
    await page.locator('#cardType').focus();

    // Wait for error message to appear (condition-based waiting)
    const errorMessage = page.locator('#typeListbox .combobox-error-message');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
    await expect(errorMessage).toHaveText('Unable to load options. Please refresh the page.');

    // Verify error class is added to listbox
    const listbox = page.locator('#typeListbox');
    await expect(listbox).toHaveClass(/combobox-error/);
  });

  test('should allow custom values when combobox has error', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Inject error into getOptions function
    await page.evaluate(() => {
      window.getTypesFromCards = () => {
        throw new Error('Test error: getOptions failed');
      };
    });

    // User should still be able to type custom value
    const customType = 'CustomType';
    await page.locator('#cardType').fill(customType);

    // Close the dropdown to accept custom value
    await page.locator('#cardType').press('Escape');

    // Verify value was set
    await expect(page.locator('#cardType')).toHaveValue(customType);

    // Restore function
    await page.evaluate(() => {
      if (window.__originalGetTypes) {
        window.getTypesFromCards = window.__originalGetTypes;
      }
    });
  });

  // TODO(#1250): Fix combobox error message display when getOptions() throws
  test.skip('should clear error state on successful refresh', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Inject error into getOptions function
    await page.evaluate(() => {
      window.__shouldThrowError = true;
      window.__originalGetTypes = window.getTypesFromCards;
      window.getTypesFromCards = () => {
        if (window.__shouldThrowError) {
          throw new Error('Test error: getOptions failed');
        }
        return window.__originalGetTypes ? window.__originalGetTypes() : [];
      };
    });

    // Trigger error by focusing
    await page.locator('#cardType').focus();
    await page.waitForTimeout(200);

    // Verify error is shown
    await expect(page.locator('#typeListbox .combobox-error-message')).toBeVisible();

    // Fix the error (restore normal behavior)
    await page.evaluate(() => {
      window.__shouldThrowError = false;
    });

    // Trigger refresh by typing
    await page.locator('#cardType').fill('E');
    await page.waitForTimeout(200);

    // Error should be cleared
    await expect(page.locator('#typeListbox .combobox-error-message')).not.toBeVisible();
    await expect(page.locator('#typeListbox')).not.toHaveClass(/combobox-error/);

    // Normal options should be shown
    const options = page.locator('#typeListbox .combobox-option');
    await expect(options.first()).toBeVisible();

    // Restore original function
    await page.evaluate(() => {
      if (window.__originalGetTypes) {
        window.getTypesFromCards = window.__originalGetTypes;
      }
    });
  });
});

test.describe('Add Card - XSS Protection in Custom Types', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test.skip('should sanitize script tags in custom type values via "Add New"', async ({
    page,
    authEmulator,
  }) => {
    // TODO(#1368): XSS sanitization not working for custom types - script tags stored unescaped in Firestore
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Try to inject XSS via custom type value
    const xssPayload = '<script>alert("xss")</script>';
    await page.locator('#cardType').fill(xssPayload);
    await page.waitForTimeout(200);

    // Verify "Add new" option appears with escaped content
    const addNewOption = page.locator('#typeListbox .combobox-option--new');
    await expect(addNewOption).toBeVisible();

    // Check that the option text contains escaped HTML, not raw script tag
    const optionText = await addNewOption.textContent();
    expect(optionText).toContain('Add');
    expect(optionText).not.toContain('<script>');

    // Select the custom value (click the "Add new" option)
    await addNewOption.click();

    // Fill remaining required fields
    const cardTitle = `XSS Test ${Date.now()}`;
    await page.locator('#cardTitle').fill(cardTitle);
    await page.locator('#cardSubtype').fill('TestSubtype');
    await page.locator('#cardSubtype').press('Escape');

    // Save the card
    await page.locator('#saveCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { state: 'hidden', timeout: 10000 });

    // Verify the card appears in UI with sanitized type (not script tag)
    await page.waitForTimeout(2000);

    // CRITICAL: Verify XSS payload is escaped in Firestore, not just in UI rendering
    const firestoreCard = await waitForCardInFirestore(cardTitle, 15000);
    expect(firestoreCard).toBeTruthy();
    // Type should contain escaped HTML entities, not raw script tags
    expect(firestoreCard.type).toContain('&lt;script&gt;');
    expect(firestoreCard.type).not.toContain('<script>');
    expect(firestoreCard.type).toContain('&lt;/script&gt;');
    expect(firestoreCard.type).not.toContain('</script>');

    // Check that no script was executed (page should not have alert)
    const hasAlert = await page.evaluate(() => {
      // If XSS worked, window.alert would have been called
      // We can't detect if it was called, but we can verify DOM doesn't contain script tags
      const cardItems = document.querySelectorAll('.card-item-type');
      for (const item of cardItems) {
        if (item.innerHTML.includes('<script>')) {
          return true;
        }
      }
      return false;
    });

    expect(hasAlert).toBe(false);
  });

  // TODO: Firestore emulator timeout when saving card with HTML payload in subtype
  test.skip('should sanitize HTML in custom subtype values', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill type first
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');

    // Try to inject HTML via custom subtype
    const htmlPayload = '<img src=x onerror=alert(1)>';
    await page.locator('#cardSubtype').fill(htmlPayload);
    await page.waitForTimeout(200);

    // Select custom subtype
    const addNewOption = page.locator('#subtypeListbox .combobox-option--new');
    if ((await addNewOption.count()) > 0) {
      await addNewOption.click();
    } else {
      await page.locator('#cardSubtype').press('Escape');
    }

    // Fill remaining fields
    await page.locator('#cardTitle').fill(`XSS Subtype Test ${Date.now()}`);

    // Save
    await page.locator('#saveCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(2000);

    // Verify no img tag exists in rendered card
    const hasImgTag = await page.evaluate(() => {
      const cardSubtypes = document.querySelectorAll('.card-item-type');
      for (const item of cardSubtypes) {
        if (item.innerHTML.includes('<img')) {
          return true;
        }
      }
      return false;
    });

    expect(hasImgTag).toBe(false);
  });
});

test.describe('Add Card - Double Submit Prevention', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test('should prevent double-submit via rapid Enter key presses', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill form completely
    const uniqueTitle = `Double Submit Test ${Date.now()}`;
    await page.locator('#cardTitle').fill(uniqueTitle);
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#cardSubtype').press('Escape');

    // Focus the last input field to enable Enter key submission
    await page.locator('#cardCost').focus();

    // Rapidly press Enter multiple times to try to trigger double-submit
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    // Wait for modal to close
    await page.waitForSelector('#cardEditorModal.active', { state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(3000); // Wait for potential duplicate writes

    // Query Firestore directly to verify only ONE card was created with this title
    // This is the critical test - UI count could hide duplicates if deduplication happens client-side
    const firestoreCard = await waitForCardInFirestore(uniqueTitle, 15000);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.title).toBe(uniqueTitle);

    // Verify UI also shows exactly one card (as secondary check)
    const cardsWithTitle = await page.evaluate(async (title) => {
      const cardTitles = Array.from(document.querySelectorAll('.card-item-title')).map(
        (el) => el.textContent
      );
      return cardTitles.filter((t) => t === title).length;
    }, uniqueTitle);

    // Should only have ONE card with this title in UI
    expect(cardsWithTitle).toBe(1);
  });

  // TODO(#1382): Test is flaky - modal doesn't close within timeout on some runs
  test.skip('should disable save button during submission', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill form
    const cardData = generateTestCardData('disable-btn-test');
    await page.locator('#cardTitle').fill(cardData.title);
    await page.locator('#cardType').fill(cardData.type);
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill(cardData.subtype);
    await page.locator('#cardSubtype').press('Escape');

    // Check button is enabled before click
    const saveBtn = page.locator('#saveCardBtn');
    await expect(saveBtn).toBeEnabled();

    // Wait for auth.currentUser to be populated (critical for Firestore writes)
    // IMPORTANT: Use != null (not !==) to check for both null AND undefined
    await page
      .waitForFunction(
        () => {
          const auth = window.__testAuth;
          return auth != null && auth.currentUser != null;
        },
        { timeout: 5000 }
      )
      .catch(async (originalError) => {
        // Enhance error with auth state snapshot for debugging
        const authState = await page.evaluate(() => ({
          authExists: !!window.__testAuth,
          currentUser: !!window.__testAuth?.currentUser,
          currentUserUid: window.__testAuth?.currentUser?.uid,
        }));

        // Create new error with enhanced message, preserving original as cause
        const enhancedError = new Error(
          `Auth not ready after 5s. Auth state: ${JSON.stringify(authState)}`
        );

        // Preserve original error properties
        enhancedError.name = originalError.name || 'TimeoutError';
        enhancedError.cause = originalError; // Standard Error.cause property (ES2022)

        // Copy stack trace from original error
        if (originalError.stack) {
          enhancedError.stack = originalError.stack;
        }

        throw enhancedError;
      });

    // Click save button
    await saveBtn.click();

    // Button should be disabled immediately during submission
    // Note: This check might be racy - the button could re-enable very quickly
    // So we'll check within a short timeout
    const wasDisabled = await page
      .waitForFunction(
        () => {
          const btn = document.getElementById('saveCardBtn');
          return btn && btn.disabled === true;
        },
        { timeout: 500 }
      )
      .then(() => true)
      .catch(() => false);

    // Button should have been disabled at some point during save
    // If this fails, the button was never disabled, which indicates a bug in the save handler
    // Note: This test may be racy on very fast systems. If it becomes flaky, consider removing
    // it and relying solely on the Enter key double-submit test.
    expect(wasDisabled).toBe(true);

    // Wait for modal to close
    await page.waitForSelector('#cardEditorModal.active', { state: 'hidden', timeout: 10000 });
  });
});

test.describe('Add Card - Error Handling on Save Failure', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  // TODO(#1248): Implement window.__signOut() helper before enabling this test
  test.skip('should keep modal open and show error when user signs out mid-save', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal and fill form
    const cardData = generateTestCardData('signout-test');
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });
    await page.locator('#cardTitle').fill(cardData.title);
    await page.locator('#cardType').fill(cardData.type);
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill(cardData.subtype);
    await page.locator('#cardSubtype').press('Escape');

    // Sign out while modal is still open (before save)
    await page.evaluate(() => window.__signOut());
    await page.waitForTimeout(500);

    // After sign-out, auth-controls elements (including save button) become hidden
    // This is the expected behavior - users shouldn't be able to save when not logged in
    await expect(page.locator('#saveCardBtn')).not.toBeVisible();

    // Modal should still be open (user can see their unsaved work)
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();
  });
});

test.describe('Add Card - Unauthenticated Creation Attempt', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test('should fail with auth error when attempting to create card without authentication', async ({
    page,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    // Force the Add Card button to be visible without auth (simulating a bug/hack)
    await page.evaluate(() => {
      // Simulate bypassing auth check by adding authenticated class
      document.body.classList.add('authenticated');
    });

    // Try to open modal and create card
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    const cardData = generateTestCardData('unauth-test');
    await page.locator('#cardTitle').fill(cardData.title);
    await page.locator('#cardType').fill(cardData.type);
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill(cardData.subtype);
    await page.locator('#cardSubtype').press('Escape');

    // Try to save - should fail with auth error
    await page.locator('#saveCardBtn').click();

    // Wait for error to be shown
    await page.waitForTimeout(1000);

    // Modal should still be open (error occurred)
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();
  });
});

test.describe('Add Card - Card Edit Flow', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test('should open edit modal with form populated when clicking existing card', async ({
    page,
    authEmulator,
  }) => {
    const testCollection = await getTestCollectionName();
    await page.goto(`/cards.html?testCollection=${testCollection}`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create a card first
    const cardData = generateTestCardData('edit-test');
    await createCardViaUI(page, cardData);

    // Wait for card to appear
    await expect(page.locator('.card-item-title').filter({ hasText: cardData.title })).toBeVisible({
      timeout: 10000,
    });

    // Click on the card to edit it
    await page.locator('.card-item').filter({ hasText: cardData.title }).click();

    // Modal should show "Edit Card" title
    await expect(page.locator('#modalTitle')).toHaveText('Edit Card');

    // Form should be populated with existing card data
    await expect(page.locator('#cardTitle')).toHaveValue(cardData.title);
    await expect(page.locator('#cardType')).toHaveValue(cardData.type);
    await expect(page.locator('#cardSubtype')).toHaveValue(cardData.subtype);

    // Delete button should be visible in edit mode
    await expect(page.locator('#deleteCardBtn')).toBeVisible();
  });

  test('should update existing card (not create new) when saving from edit modal', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create a card first
    const cardData = generateTestCardData('update-test');
    await createCardViaUI(page, cardData);

    // Wait for card to appear
    await expect(page.locator('.card-item-title').filter({ hasText: cardData.title })).toBeVisible({
      timeout: 10000,
    });

    // Get initial card count
    const initialCount = await page.locator('.card-item').count();

    // Click on the card to edit it
    await page.locator('.card-item').filter({ hasText: cardData.title }).click();

    // Update the description
    const updatedDescription = 'Updated description text';
    await page.locator('#cardDescription').fill(updatedDescription);

    // Save changes
    await page.locator('#saveCardBtn').click();

    // Wait for modal to close
    await expect(page.locator('#cardEditorModal.active')).not.toBeVisible({ timeout: 10000 });

    // Card count should remain the same (updated, not created)
    await expect(async () => {
      const newCount = await page.locator('.card-item').count();
      expect(newCount).toBe(initialCount);
    }).toPass({ timeout: 5000 });

    // Verify the card has the updated description in Firestore
    await page.waitForTimeout(1000);
    const firestoreCard = await waitForCardInFirestore(cardData.title);
    expect(firestoreCard.description).toBe(updatedDescription);
    expect(firestoreCard.lastModifiedAt).toBeTruthy();
    expect(firestoreCard.lastModifiedBy).toBeTruthy();
  });
});

test.describe('Add Card - XSS Protection in Other Fields', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test('should escape XSS payloads in description field', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    const cardData = {
      title: `Test Card ${Date.now()}-xss-desc`,
      type: 'Equipment',
      subtype: 'Weapon',
      description: '<script>alert("XSS")</script>',
    };

    await createCardViaUI(page, cardData);

    // Verify no script element was created
    const hasScriptElement = await page.evaluate(() => {
      const scripts = document.querySelectorAll('.card-item-description script');
      return scripts.length > 0;
    });
    expect(hasScriptElement).toBe(false);
  });

  test('should escape XSS payloads in tags field', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    const cardData = {
      title: `Test Card ${Date.now()}-xss-tags`,
      type: 'Equipment',
      subtype: 'Weapon',
      tags: '<img src=x onerror=alert("XSS")>',
    };

    await createCardViaUI(page, cardData);

    // Verify no img element with onerror was created
    const hasOnErrorHandler = await page.evaluate(() => {
      const imgs = document.querySelectorAll('.card-tag img[onerror]');
      return imgs.length > 0;
    });
    expect(hasOnErrorHandler).toBe(false);
  });

  test('should escape XSS payloads in stat fields', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    const cardData = {
      title: `Test Card ${Date.now()}-xss-stats`,
      type: 'Equipment',
      subtype: 'Weapon',
      stat1: '<script>alert("XSS")</script>',
      stat2: '<img src=x onerror=alert("XSS")>',
      cost: '<svg onload=alert("XSS")>',
    };

    await createCardViaUI(page, cardData);

    // Verify no script/img/svg elements with handlers were created
    const hasMaliciousElements = await page.evaluate(() => {
      const scripts = document.querySelectorAll('.card-stat script');
      const imgs = document.querySelectorAll('.card-stat img[onerror]');
      const svgs = document.querySelectorAll('.card-stat svg[onload]');
      return scripts.length > 0 || imgs.length > 0 || svgs.length > 0;
    });
    expect(hasMaliciousElements).toBe(false);
  });

  // TODO: Auth emulator socket hang up - emulator connectivity issue
  test.skip('should escape event handlers in type field (class attribute injection)', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Try to inject a malicious type that would add event handlers via class attribute
    const cardData = {
      title: `Test Card ${Date.now()}-xss-type`,
      type: 'Equipment" onclick="alert(\'XSS\')" class="evil',
      subtype: 'Weapon',
    };

    await createCardViaUI(page, cardData);

    // Verify the type element doesn't have an onclick handler
    const hasOnclickHandler = await page.evaluate(() => {
      const typeElements = document.querySelectorAll('.card-item-type[onclick]');
      return typeElements.length > 0;
    });
    expect(hasOnclickHandler).toBe(false);
  });
});
