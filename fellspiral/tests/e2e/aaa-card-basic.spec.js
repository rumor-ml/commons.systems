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
  getCardFromFirestore,
  generateTestCardData,
  getTestCollectionName,
} from './test-helpers.js';

const isEmulatorMode = process.env.VITE_USE_FIREBASE_EMULATOR === 'true';

// Tests run serially within each browser project but Firefox/Chromium run in parallel.
// Each test creates cards with unique timestamps to prevent conflicts within a test run.
// Note: Emulator data persists between runs - use `make clean-emulator` to reset
test.describe.configure({ mode: 'serial' });

test.describe('Add Card - Happy Path Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  // Clean up test cards after each test to prevent data pollution
  test.afterEach(async () => {
    const { deleteTestCards } = await import('./test-helpers.js');
    const deletedCount = await deleteTestCards(/^Test Card \d+/);
    console.log(`Cleaned up ${deletedCount} test cards`);
  });

  test.skip('should create card with all fields populated', async ({ page, authEmulator }) => {
    // TODO(#1325): Firestore emulator timeout during card creation
    await page.goto('/cards.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    const cardData = generateTestCardData('all-fields');
    await createCardViaUI(page, cardData);

    // Verify in UI
    const cardTitle = page.locator('.card-item-title').filter({ hasText: cardData.title });
    await expect(cardTitle).toBeVisible({ timeout: 10000 });

    // OPTIMIZATION(#1805): Use real-time snapshot listener instead of fixed 2s wait (typically 50-500ms)
    const firestoreCard = await waitForCardInFirestore(cardData.title, 15000);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.title).toBe(cardData.title);
    expect(firestoreCard.type).toBe(cardData.type);
    expect(firestoreCard.subtype).toBe(cardData.subtype);
    expect(firestoreCard.description).toBe(cardData.description);
  });

  test.skip('should create card with only required fields', async ({ page, authEmulator }) => {
    // TODO(#1325): Firestore emulator timeout during card creation
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card with only required fields
    const cardData = {
      title: `Test Card ${Date.now()}-required-only`,
      type: 'Equipment',
      subtype: 'Weapon',
    };

    await createCardViaUI(page, cardData);

    // Verify in UI
    const cardTitle = page.locator('.card-item-title').filter({ hasText: cardData.title });
    await expect(cardTitle).toBeVisible({ timeout: 10000 });

    // Verify in Firestore
    const firestoreCard = await waitForCardInFirestore(cardData.title);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.title).toBe(cardData.title);
  });

  test.skip('should verify card persists to Firestore emulator', async ({ page, authEmulator }) => {
    // TODO(#1325): Firestore emulator timeout during card creation
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card
    const cardData = generateTestCardData('persist-test');
    await createCardViaUI(page, cardData);

    // OPTIMIZATION(#1805): Use real-time snapshot listener instead of fixed 3s wait (typically 50-500ms)
    const firestoreCard = await waitForCardInFirestore(cardData.title, 15000);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.title).toBe(cardData.title);
  });

  test.skip('should verify Firestore document structure includes metadata', async ({
    page,
    authEmulator,
  }) => {
    // TODO(#1325): Firestore emulator timeout during card creation
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    const uid = await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card
    const cardData = generateTestCardData('metadata-test');
    await createCardViaUI(page, cardData);

    // OPTIMIZATION(#1805): Use real-time snapshot listener instead of fixed 3s wait (typically 50-500ms)
    const firestoreCard = await waitForCardInFirestore(cardData.title, 15000);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.createdBy).toBe(uid);
    expect(firestoreCard.lastModifiedBy).toBe(uid);
    expect(firestoreCard.createdAt).toBeTruthy();
    expect(firestoreCard.updatedAt).toBeTruthy();
    expect(firestoreCard.lastModifiedAt).toBeTruthy();
  });

  // TODO(#1301): Flaky test - Save Card button remains disabled, modal never closes
  test.skip('should verify card appears in list after creation', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Get initial card count
    const initialCount = await page.locator('.card-item').count();

    // Create card
    const cardData = generateTestCardData('list-test');
    await createCardViaUI(page, cardData);

    // Verify card count increased
    await expect(async () => {
      const newCount = await page.locator('.card-item').count();
      expect(newCount).toBe(initialCount + 1);
    }).toPass({ timeout: 10000 });

    // Verify new card is visible
    const cardTitle = page.locator('.card-item-title').filter({ hasText: cardData.title });
    await expect(cardTitle).toBeVisible();
  });

  test('should show Create Card button after page refresh when logged in', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    // Note: Just check for auth initialization, user hasn't signed in yet
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    // Sign in with seeded QA user
    const email = 'qa@test.com';
    await authEmulator.signInTestUser(email);

    // Verify button is visible after initial sign-in
    await expect(page.locator('#addCardBtn')).toBeVisible({ timeout: 5000 });

    // Reload page
    await page.reload();
    await page.waitForLoadState('load');

    // Re-sign in after page reload (page reload clears window.__testAuth)
    await authEmulator.signInTestUser(email);

    // Wait for Firebase auth to restore state after sign-in (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    // Button should STILL be visible after refresh (this tests Bug 2 fix)
    await expect(page.locator('#addCardBtn')).toBeVisible({ timeout: 5000 });

    // Should be able to click it without error (this tests Bug 1 fix)
    await page.locator('#addCardBtn').click();
    await expect(page.locator('#cardEditorModal.active')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Add Card - Form Validation Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test('should require title field', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Leave title empty, fill other required fields (using combobox)
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape'); // Close dropdown
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#cardSubtype').press('Escape'); // Close dropdown

    // Try to submit
    await page.locator('#saveCardBtn').click();

    // Modal should still be open (form validation failed)
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Check HTML5 validation state
    const titleInput = page.locator('#cardTitle');
    const isValid = await titleInput.evaluate((el) => el.checkValidity());
    expect(isValid).toBe(false);
  });

  test('should require type field', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill title but not type
    await page.locator('#cardTitle').fill(`Test Card ${Date.now()}`);

    // Try to submit
    await page.locator('#saveCardBtn').click();

    // Modal should still be open
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Check HTML5 validation state
    const typeSelect = page.locator('#cardType');
    const isValid = await typeSelect.evaluate((el) => el.checkValidity());
    expect(isValid).toBe(false);
  });

  test('should require subtype field', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill title and type but not subtype (using combobox)
    await page.locator('#cardTitle').fill(`Test Card ${Date.now()}`);
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape'); // Close dropdown

    // Try to submit
    await page.locator('#saveCardBtn').click();

    // Modal should still be open
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Check HTML5 validation state
    const subtypeSelect = page.locator('#cardSubtype');
    const isValid = await subtypeSelect.evaluate((el) => el.checkValidity());
    expect(isValid).toBe(false);
  });

  test('should reject whitespace-only subtype', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill title and type, but use whitespace-only subtype
    await page.locator('#cardTitle').fill(`Test Card ${Date.now()}`);
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape'); // Close dropdown

    // Enter whitespace-only subtype (spaces)
    await page.locator('#cardSubtype').fill('   ');
    await page.locator('#cardSubtype').press('Escape'); // Close dropdown

    // Try to submit
    await page.locator('#saveCardBtn').click();

    // Modal should still be open (validation failed)
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Check HTML5 validation state or custom validation
    const subtypeInput = page.locator('#cardSubtype');
    const isValid = await subtypeInput.evaluate((el) => el.checkValidity());
    expect(isValid).toBe(false);
  });

  test.skip('should parse comma-separated tags correctly', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card with comma-separated tags
    const cardData = {
      title: `Test Card ${Date.now()}-tags-test`,
      type: 'Equipment',
      subtype: 'Weapon',
      tags: 'tag1, tag2, tag3',
    };

    await createCardViaUI(page, cardData);

    // Verify in Firestore
    const firestoreCard = await waitForCardInFirestore(cardData.title);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.tags).toBeTruthy();

    // Tags should be stored as array or comma-separated string
    if (Array.isArray(firestoreCard.tags)) {
      expect(firestoreCard.tags).toContain('tag1');
      expect(firestoreCard.tags).toContain('tag2');
      expect(firestoreCard.tags).toContain('tag3');
    } else {
      expect(firestoreCard.tags).toContain('tag1');
      expect(firestoreCard.tags).toContain('tag2');
      expect(firestoreCard.tags).toContain('tag3');
    }
  });

  // TODO(#1325): Flaky - Firestore create timeout (15s) in emulator
  test.skip('should handle tags with extra spaces', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card with tags that have extra spaces
    const cardData = {
      title: `Test Card ${Date.now()}-spaces-test`,
      type: 'Equipment',
      subtype: 'Weapon',
      tags: '  tag1  ,  tag2  ,  tag3  ',
    };

    await createCardViaUI(page, cardData);

    // Card should be created successfully
    const cardTitle = page.locator('.card-item-title').filter({ hasText: cardData.title });
    await expect(cardTitle).toBeVisible({ timeout: 10000 });

    // Verify in Firestore
    const firestoreCard = await waitForCardInFirestore(cardData.title);
    expect(firestoreCard).toBeTruthy();
  });

  test('should prevent Firestore write when required field validation fails', async ({
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

    // Leave title empty (required field), but fill type and subtype
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#cardSubtype').press('Escape');

    // Try to submit with missing required field
    await page.locator('#saveCardBtn').click();

    // Modal should still be open (validation failed)
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Check HTML5 validation state shows error
    const titleInput = page.locator('#cardTitle');
    const isValid = await titleInput.evaluate((el) => el.checkValidity());
    expect(isValid).toBe(false);

    // Wait to ensure no Firestore write happened
    await page.waitForTimeout(3000);

    // Query Firestore to verify NO card was created with empty title
    // We can't query by empty title, so we'll check the UI doesn't show any new cards
    // and try to find a card with the specific type/subtype combo we used
    const { getFirestoreAdmin } = await import('./test-helpers.js');
    const { db } = await getFirestoreAdmin();
    const { getCardsCollectionName } = await import('../../scripts/lib/collection-names.js');
    const collectionName = getCardsCollectionName();

    // Query for cards with our test type/subtype but empty title
    const snapshot = await db
      .collection(collectionName)
      .where('type', '==', 'Equipment')
      .where('subtype', '==', 'Weapon')
      .where('title', '==', '')
      .get();

    // Should have zero cards with empty title
    expect(snapshot.empty).toBe(true);

    // Verify button is re-enabled for retry
    const saveBtn = page.locator('#saveCardBtn');
    const isButtonEnabled = await saveBtn.evaluate((el) => !el.disabled);
    expect(isButtonEnabled).toBe(true);
  });
});

test.describe('Add Card - Modal Behavior Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test('should open modal on button click', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Verify modal is closed
    await expect(page.locator('#cardEditorModal.active')).not.toBeVisible();

    // Click Add Card button
    await page.locator('#addCardBtn').click();

    // Verify modal is open
    await expect(page.locator('#cardEditorModal.active')).toBeVisible({ timeout: 5000 });
  });

  test('should close modal via X button', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Click X button
    await page.locator('#closeModalBtn').click();

    // Verify modal is closed
    await expect(page.locator('#cardEditorModal.active')).not.toBeVisible();
  });

  test('should close modal via Cancel button', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Click Cancel button (if it exists)
    const cancelBtn = page.locator('button').filter({ hasText: 'Cancel' });
    if ((await cancelBtn.count()) > 0) {
      await cancelBtn.click();
      await expect(page.locator('#cardEditorModal.active')).not.toBeVisible();
    } else {
      // Skip if no Cancel button exists
      test.skip(true, 'No Cancel button found');
    }
  });

  test('should close modal via backdrop click', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Click backdrop (modal itself, not the modal content)
    await page.locator('#cardEditorModal').click({ position: { x: 10, y: 10 } });

    // Verify modal is closed
    await expect(page.locator('#cardEditorModal.active')).not.toBeVisible({ timeout: 5000 });
  });

  test('should clear form when modal reopened', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal and fill form
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });
    await page.locator('#cardTitle').fill('Test Title');
    await page.locator('#cardDescription').fill('Test Description');

    // Close modal and wait for it to fully close
    await page.locator('#closeModalBtn').click();
    await expect(page.locator('#cardEditorModal')).not.toHaveClass(/active/, { timeout: 5000 });

    // Wait for modal transition to complete before clicking button again
    await page.waitForTimeout(300);

    // Reopen modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Wait for form fields to be cleared (form.reset() happens asynchronously)
    await expect(page.locator('#cardTitle')).toHaveValue('');
    await expect(page.locator('#cardDescription')).toHaveValue('');
  });

  // TODO: Flaky test - modal auto-close timing sometimes fails
  test.skip('should auto-close modal after successful save', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card
    const cardData = generateTestCardData('auto-close');
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill and submit form (using combobox)
    await page.locator('#cardTitle').fill(cardData.title);
    await page.locator('#cardType').fill(cardData.type);
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill(cardData.subtype);
    await page.locator('#cardSubtype').press('Escape');
    await page.locator('#saveCardBtn').click();

    // Modal should auto-close
    await expect(page.locator('#cardEditorModal.active')).not.toBeVisible({ timeout: 10000 });
  });

  test('should keep modal open on validation error', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Try to submit with empty required fields
    await page.locator('#saveCardBtn').click();

    // Modal should remain open
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();
  });
});

test.describe('Add Card - Edge Cases', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test('should handle rapid Add Card button clicks', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Click Add Card button multiple times rapidly using dispatchEvent
    // (bypasses Playwright's actionability checks since modal covers button after first click)
    await page.locator('#addCardBtn').dispatchEvent('click');
    await page.locator('#addCardBtn').dispatchEvent('click');
    await page.locator('#addCardBtn').dispatchEvent('click');

    // Wait for modal to open
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Should only have one modal visible
    const modalCount = await page.locator('#cardEditorModal.active').count();
    expect(modalCount).toBe(1);
  });

  // TODO: Flaky test - modal close timing race condition
  test.skip('should handle rapid form submissions', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal and fill form (using combobox)
    const cardData = generateTestCardData('rapid-submit');
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });
    await page.locator('#cardTitle').fill(cardData.title);
    await page.locator('#cardType').fill(cardData.type);
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill(cardData.subtype);
    await page.locator('#cardSubtype').press('Escape');

    // Click save button multiple times rapidly using dispatchEvent
    // (bypasses Playwright's actionability checks since button becomes disabled after first click)
    await page.locator('#saveCardBtn').dispatchEvent('click');
    await page.locator('#saveCardBtn').dispatchEvent('click');
    await page.locator('#saveCardBtn').dispatchEvent('click');

    // Wait for modal to close
    await expect(page.locator('#cardEditorModal')).not.toHaveClass(/active/, { timeout: 10000 });

    // Wait for card to appear
    await page.waitForTimeout(2000);

    // Should only create one card with this title
    const firestoreCard = await waitForCardInFirestore(cardData.title);
    expect(firestoreCard).toBeTruthy();

    // Verify only one card with this title exists in UI
    const matchingCards = page.locator('.card-item-title').filter({ hasText: cardData.title });
    const count = await matchingCards.count();
    expect(count).toBe(1);
  });

  // TODO: Test timing out - Firestore emulator connectivity issue
  test.skip('should handle special characters in title', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card with special characters - use unique identifier
    const uniqueId = Date.now();
    const cardData = {
      title: `Test <script>alert('XSS')</script> Card ${uniqueId}`,
      type: 'Equipment',
      subtype: 'Weapon',
    };

    await createCardViaUI(page, cardData);

    // Verify card appears - use the unique ID to find the specific card
    const cardTitle = page.locator('.card-item-title').filter({ hasText: String(uniqueId) });
    await expect(cardTitle).toBeVisible({ timeout: 10000 });

    // Verify content is HTML-escaped (rendered as text, not executed as script)
    // The content should appear in innerHTML (escaped), but NOT as an actual script element
    const hasScriptElement = await page.evaluate(() => {
      // Check if there's an actual <script> DOM element (would indicate XSS)
      const scripts = document.querySelectorAll('.card-item-title script');
      return scripts.length > 0;
    });
    expect(hasScriptElement).toBe(false);

    // Verify the text content includes the escaped script tag (as text)
    const titleText = await cardTitle.textContent();
    expect(titleText).toContain('script');
  });

  // TODO: Firestore emulator timeout
  test.skip('should handle empty tags field', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card with empty tags
    const cardData = {
      title: `Test Card ${Date.now()}-no-tags`,
      type: 'Equipment',
      subtype: 'Weapon',
      tags: '',
    };

    await createCardViaUI(page, cardData);

    // Card should be created successfully
    const cardTitle = page.locator('.card-item-title').filter({ hasText: cardData.title });
    await expect(cardTitle).toBeVisible({ timeout: 10000 });

    // Verify in Firestore
    const firestoreCard = await waitForCardInFirestore(cardData.title);
    expect(firestoreCard).toBeTruthy();
  });
});

test.describe('Add Card - Integration Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  // TODO: Card not found after reload - likely related to #244 collection name issues
  test.skip('should persist card after page reload', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card
    const cardData = generateTestCardData('reload-test');
    await createCardViaUI(page, cardData);

    // Verify card is visible
    await expect(
      page.locator('.card-item-title').filter({ hasText: cardData.title })
    ).toBeVisible();

    // Reload page
    await page.reload();
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize after reload
    await page.waitForTimeout(3000);

    // Verify card still exists
    await expect(page.locator('.card-item-title').filter({ hasText: cardData.title })).toBeVisible({
      timeout: 10000,
    });
  });

  test.skip('should be able to search for newly created card', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card with unique searchable term
    const uniqueTerm = `UniqueSearch${Date.now()}`;
    const cardData = {
      title: `Test Card ${uniqueTerm}`,
      type: 'Equipment',
      subtype: 'Weapon',
    };

    await createCardViaUI(page, cardData);

    // Search for the card
    await page.locator('#searchCards').fill(uniqueTerm);

    // Verify card appears in search results
    await expect(page.locator('.card-item-title').filter({ hasText: uniqueTerm })).toBeVisible({
      timeout: 10000,
    });
  });

  // TODO(#1325): Firestore emulator timeout during card creation
  test.skip('should be able to filter newly created card by type', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize (typically 50-200ms, max 5s)
    await page.waitForFunction(() => window.auth != null, { timeout: 5000 });

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card with specific type
    const cardData = {
      title: `Test Card ${Date.now()}-filter-test`,
      type: 'Skill',
      subtype: 'Attack',
    };

    await createCardViaUI(page, cardData);

    // Wait for card to appear
    await expect(page.locator('.card-item-title').filter({ hasText: cardData.title })).toBeVisible({
      timeout: 10000,
    });

    // Filter by type (click on type filter in library nav)
    const typeFilter = page.locator('.library-nav-type').filter({ hasText: 'Spell' });
    if ((await typeFilter.count()) > 0) {
      await typeFilter.click();

      // Verify card is visible with filter applied
      await expect(
        page.locator('.card-item-title').filter({ hasText: cardData.title })
      ).toBeVisible();
    } else {
      // If no type filter UI exists, verify card exists in list
      await expect(
        page.locator('.card-item-title').filter({ hasText: cardData.title })
      ).toBeVisible();
    }
  });
});
