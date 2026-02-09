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
    const initialCount = await page.locator('#typeListbox .combobox-option').count();
    await page.locator('#cardType').fill('equip');
    const filteredCount = await page.locator('#typeListbox .combobox-option').count();
    expect(filteredCount).toBeLessThan(initialCount);
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
    let shouldThrow = true;
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

// PHASE 6: Missing Tests (Issues 33-38) - PR Review Improvements

test.describe('Add Card - Firestore Security Rules', () => {
  test.skip(!isEmulatorMode, 'Security tests only run against emulator');

  // TODO(#1245): Validate security rules before enabling this test
  test.skip('should prevent unauthenticated read access to cards', async ({ page }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    // Verify that without authentication, users see demo data or login prompt
    // NOT actual Firestore cards (which require authentication)
    const hasAuthWarning = await page
      .locator('text=/Please log in|You are offline|demo data/i')
      .isVisible();
    expect(hasAuthWarning).toBe(true);

    // Verify no real cards are shown (empty list or demo cards only)
    const cardCount = await page.locator('.card-item').count();
    // Either 0 cards (login required) or demo cards from cardsData
    // The key is: authenticated cards should not be visible
    console.log(`Unauthenticated card count: ${cardCount} (should be 0 or demo cards only)`);
  });

  // TODO(#1246): Implement window.__signOut() helper (#1248) before enabling this test
  test.skip('should prevent cross-user card access', async ({ page, authEmulator, context }) => {
    // User 1 creates a card
    const user1Email = `user1-${Date.now()}@example.com`;
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    await authEmulator.createTestUser(user1Email);
    await authEmulator.signInTestUser(user1Email);

    const user1CardData = generateTestCardData('user1-private');
    await createCardViaUI(page, user1CardData);

    // Verify card is visible for user1
    await expect(
      page.locator('.card-item-title').filter({ hasText: user1CardData.title })
    ).toBeVisible({ timeout: 10000 });

    // Sign out user 1
    await page.evaluate(() => window.__signOut());
    await page.waitForTimeout(1000);

    // User 2 signs in
    const user2Email = `user2-${Date.now()}@example.com`;
    await authEmulator.createTestUser(user2Email);
    await authEmulator.signInTestUser(user2Email);

    // Wait for cards to reload for user 2
    await page.waitForTimeout(2000);

    // Verify user1's card is NOT visible to user2
    const user1CardVisible = await page
      .locator('.card-item-title')
      .filter({ hasText: user1CardData.title })
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    expect(user1CardVisible).toBe(false);

    // Also verify via Firestore: attempt to query user1's card as user2
    // This tests that security rules prevent cross-user data access at the database level
    const user1Card = await waitForCardInFirestore(user1CardData.title);
    expect(user1Card).toBeTruthy(); // Card exists in Firestore

    // Verify that user2 cannot read user1's card through direct Firestore query
    // The card should exist but user2's auth context should not be able to access it
    const canReadAsUser2 = await page.evaluate(async (cardTitle) => {
      try {
        const { getFirestore, collection, query, where, getDocs } = await import(
          '/scripts/lib/firebase.js'
        );
        const { getCardsCollectionName } = await import('/scripts/lib/collection-names.js');
        const db = getFirestore();
        const cardsCollection = collection(db, getCardsCollectionName());
        const q = query(cardsCollection, where('title', '==', cardTitle));
        const snapshot = await getDocs(q);
        return !snapshot.empty; // Returns true if user2 can read the card
      } catch (error) {
        console.error('Error querying Firestore:', error);
        return false;
      }
    }, user1CardData.title);

    // User2 should NOT be able to read user1's card (security rules should block it)
    // Note: Since security rules only check createdBy on write, not read, this test
    // verifies the UI filtering behavior. Full read isolation would require updating
    // security rules to: allow read: if isAuthenticated() && resource.data.createdBy == request.auth.uid
    expect(canReadAsUser2).toBe(false);
  });

  // TODO(#1247): Test security rules for forged createdBy fields before enabling
  test.skip('should reject card creation with forged createdBy field', async ({
    page,
    authEmulator,
  }) => {
    const email = `forged-test-${Date.now()}@example.com`;
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create another user to impersonate
    const victimEmail = `victim-${Date.now()}@example.com`;
    const victimUser = await authEmulator.createTestUser(victimEmail);

    // Attempt to create a card with forged createdBy field
    const cardData = generateTestCardData('forged-creator');

    // Intercept the Firestore write and inject a forged createdBy field
    const forgedCreation = await page.evaluate(
      async ({ cardData, victimUid }) => {
        try {
          const { getFirestore, collection, addDoc } = await import('/scripts/lib/firebase.js');
          const { getCardsCollectionName } = await import('/scripts/lib/collection-names.js');

          const db = getFirestore();
          const cardsCollection = collection(db, getCardsCollectionName());

          // Try to forge createdBy to be the victim's UID
          const forgedCard = {
            title: cardData.title,
            type: cardData.type,
            subtype: cardData.subtype,
            tags: cardData.tags || '',
            description: cardData.description || '',
            stat1: cardData.stat1 || '',
            stat2: cardData.stat2 || '',
            cost: cardData.cost || '',
            createdBy: victimUid, // FORGED - attempting to impersonate victim
            createdAt: new Date(),
          };

          await addDoc(cardsCollection, forgedCard);
          return { success: true, error: null };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      { cardData, victimUid: victimUser.uid }
    );

    // Security rules should reject this (createdBy must equal request.auth.uid)
    expect(forgedCreation.success).toBe(false);
    expect(forgedCreation.error).toMatch(
      /PERMISSION_DENIED|permission-denied|Missing or insufficient permissions/i
    );
  });

  test('should use server timestamp for createdAt', async ({ page, authEmulator }) => {
    const email = `timestamp-test-${Date.now()}@example.com`;
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Record time before creating card
    const beforeCreate = Date.now();

    // Create card via UI (which uses serverTimestamp())
    const cardData = generateTestCardData('server-timestamp');
    await createCardViaUI(page, cardData);

    // Record time after creation
    const afterCreate = Date.now();

    // OPTIMIZATION(#1805): Use real-time snapshot listener instead of fixed 2s wait (typically 50-500ms)
    const firestoreCard = await waitForCardInFirestore(cardData.title, 15000);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.createdAt).toBeDefined();

    // Convert Firestore timestamp to milliseconds
    const createdAtMs = firestoreCard.createdAt.toMillis
      ? firestoreCard.createdAt.toMillis()
      : firestoreCard.createdAt.seconds * 1000;

    // Verify timestamp is within reasonable range (should be set by server, not client)
    // Allow 5 second window to account for clock skew and test execution time
    const timeDiff = Math.abs(createdAtMs - beforeCreate);
    expect(timeDiff).toBeLessThan(5000);

    // Verify timestamp is between before and after (allowing small buffer for server time)
    expect(createdAtMs).toBeGreaterThanOrEqual(beforeCreate - 1000);
    expect(createdAtMs).toBeLessThanOrEqual(afterCreate + 1000);
  });
});

test.describe('Add Card - Concurrent Save Handling', () => {
  test.skip(!isEmulatorMode, 'Concurrent tests only run against emulator');

  // TODO(#1251): Implement test infrastructure for concurrent edits before enabling
  test.skip('should handle concurrent edits in different tabs (last write wins)', async ({
    page,
    authEmulator,
    context,
  }) => {
    // Sign in
    const email = `concurrent-${Date.now()}@example.com`;
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create a card
    const cardData = generateTestCardData('concurrent-test');
    await createCardViaUI(page, cardData);

    // Wait for card to appear
    await expect(page.locator('.card-item-title').filter({ hasText: cardData.title })).toBeVisible({
      timeout: 10000,
    });

    // Open same card in two "tabs" (same page, two edit sessions)
    // Tab 1: Click to edit
    await page.locator('.card-item').filter({ hasText: cardData.title }).click();
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Change description in tab 1 (but don't save yet)
    await page.locator('#cardDescription').fill('Tab 1 description');

    // Open a second page/context for tab 2
    const page2 = await context.newPage();
    await page2.goto('/cards.html');
    await page2.waitForLoadState('load');
    await page2.waitForTimeout(3000);

    // Tab 2 is already authenticated (shared auth state in emulator)
    // Open same card for editing
    await page2.locator('.card-item').filter({ hasText: cardData.title }).click();
    await expect(page2.locator('#cardEditorModal.active')).toBeVisible();

    // Change description in tab 2
    await page2.locator('#cardDescription').fill('Tab 2 description');

    // Save tab 2 first
    await page2.locator('#saveCardBtn').click();
    await expect(page2.locator('#cardEditorModal.active')).not.toBeVisible({ timeout: 10000 });
    await page2.waitForTimeout(1000);

    // Save tab 1 second (last write wins)
    await page.locator('#saveCardBtn').click();
    await expect(page.locator('#cardEditorModal.active')).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Verify last write (tab 1) won
    const firestoreCard = await waitForCardInFirestore(cardData.title);
    expect(firestoreCard.description).toBe('Tab 1 description');

    await page2.close();
  });

  test.skip('should handle concurrent card edits with conflict detection', async ({
    page,
    authEmulator,
    context,
  }) => {
    // This test simulates two users editing the same card simultaneously
    // User 1 starts editing, User 2 edits and saves, then User 1 tries to save
    // The expected behavior is conflict detection when User 1 tries to save
    // TODO: Fix signInTestUser to properly support multi-page auth contexts

    // Create two users
    const user1Email = `user1-conflict-${Date.now()}@example.com`;
    const user2Email = `user2-conflict-${Date.now()}@example.com`;

    // User 1 creates a card
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    await authEmulator.createTestUser(user1Email);
    await authEmulator.signInTestUser(user1Email);

    const cardData = generateTestCardData('conflict-detection');
    await createCardViaUI(page, cardData);

    // Wait for card to appear
    await expect(page.locator('.card-item-title').filter({ hasText: cardData.title })).toBeVisible({
      timeout: 10000,
    });

    // OPTIMIZATION(#1805): Use real-time snapshot listener instead of fixed 2s wait (typically 50-500ms)
    const originalCard = await waitForCardInFirestore(cardData.title, 15000);
    expect(originalCard).toBeTruthy();

    // User 1 opens card for editing
    await page.locator('.card-item').filter({ hasText: cardData.title }).click();
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // User 1 changes description but doesn't save yet
    await page.locator('#cardDescription').fill('User 1 edit - should detect conflict');

    // Create second browser context for User 2
    const page2 = await context.newPage();
    await page2.goto('/cards.html');
    await page2.waitForLoadState('load');
    await page2.waitForTimeout(3000);

    // User 2 signs in
    await authEmulator.createTestUser(user2Email);
    await authEmulator.signInTestUser(user2Email, page2);

    // Wait for User 2's cards to load
    await page2.waitForTimeout(2000);

    // User 2 should NOT see User 1's card (cross-user isolation)
    // So instead, have User 1 stay signed in on both pages
    await page2.goto('/cards.html');
    await page2.waitForLoadState('load');
    await page2.waitForTimeout(3000);

    // Re-auth as user1 on page2
    await authEmulator.signInTestUser(user1Email, page2);
    await page2.waitForTimeout(2000);

    // User 2 (same user, different session) opens same card
    await page2.locator('.card-item').filter({ hasText: cardData.title }).click();
    await expect(page2.locator('#cardEditorModal.active')).toBeVisible();

    // User 2 changes description and saves
    await page2.locator('#cardDescription').fill('User 2 edit - saved first');
    await page2.locator('#saveCardBtn').click();
    await expect(page2.locator('#cardEditorModal.active')).not.toBeVisible({ timeout: 10000 });
    await page2.waitForTimeout(1000);

    // Verify User 2's edit is saved
    const updatedCard = await waitForCardInFirestore(cardData.title);
    expect(updatedCard.description).toBe('User 2 edit - saved first');

    // Now User 1 tries to save (should detect conflict or apply last-write-wins)
    await page.locator('#saveCardBtn').click();

    // In a last-write-wins scenario, the modal closes and User 1's edit overwrites
    // In a conflict detection scenario, an error should be shown
    // Since the current implementation uses last-write-wins, verify that behavior
    await expect(page.locator('#cardEditorModal.active')).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Verify final state (last write wins - User 1's edit)
    const finalCard = await waitForCardInFirestore(cardData.title);
    expect(finalCard.description).toBe('User 1 edit - should detect conflict');

    // NOTE: This test currently verifies last-write-wins behavior.
    // True conflict detection would require tracking document versions or timestamps
    // and showing an error when User 1 tries to save. This is documented as a
    // future enhancement in the test name but not currently implemented.

    await page2.close();
  });
});

test.describe('Add Card - Network Timeout & Offline Handling', () => {
  test.skip(!isEmulatorMode, 'Network tests only run against emulator');

  test('should show timeout error for slow Firestore responses', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `timeout-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Intercept Firestore requests and delay them significantly
    await page.route('**/*firestore*/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      await route.continue();
    });

    // Try to create a card - should timeout
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    const cardData = generateTestCardData('timeout-test');
    await page.locator('#cardTitle').fill(cardData.title);
    await page.locator('#cardType').fill(cardData.type);
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill(cardData.subtype);
    await page.locator('#cardSubtype').press('Escape');

    // Click save - should show timeout error
    await page.locator('#saveCardBtn').click();

    // Wait for error to appear (modal stays open on error)
    await page.waitForTimeout(2000);

    // Modal should still be open (error occurred)
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();
  });

  test('should retry save on transient network failure', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `retry-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    const cardData = generateTestCardData('retry-test');

    // Set up route interception to fail first request, then succeed
    let requestCount = 0;
    await page.route('**/*firestore.googleapis.com/*/documents/*', async (route) => {
      requestCount++;
      if (requestCount === 1 && route.request().method() === 'POST') {
        // First write request: simulate network failure
        await route.abort('failed');
      } else {
        // Subsequent requests: allow through
        await route.continue();
      }
    });

    // Try to create card
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    await page.locator('#cardTitle').fill(cardData.title);
    await page.locator('#cardType').fill(cardData.type);
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill(cardData.subtype);
    await page.locator('#cardSubtype').press('Escape');
    if (cardData.description) {
      await page.locator('#cardDescription').fill(cardData.description);
    }

    // Click save - first attempt will fail, but retry should succeed
    await page.locator('#saveCardBtn').click();

    // Modal should eventually close after successful retry
    // Give extra time for retry logic (10 seconds)
    await expect(page.locator('#cardEditorModal.active')).not.toBeVisible({ timeout: 10000 });

    // Wait for card to propagate
    await page.waitForTimeout(2000);

    // Verify card was eventually saved (retry succeeded)
    const firestoreCard = await waitForCardInFirestore(cardData.title);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.title).toBe(cardData.title);
  });

  // TODO(#1253): Implement retry logic and error UI before enabling this test
  test.skip('should show persistent error after max retries exceeded', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `max-retry-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    const cardData = generateTestCardData('max-retry-test');

    // Set up route interception to always fail
    await page.route('**/*firestore.googleapis.com/*/documents/*', async (route) => {
      if (route.request().method() === 'POST') {
        // Always fail write requests to simulate persistent network issue
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    // Try to create card
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    await page.locator('#cardTitle').fill(cardData.title);
    await page.locator('#cardType').fill(cardData.type);
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill(cardData.subtype);
    await page.locator('#cardSubtype').press('Escape');
    if (cardData.description) {
      await page.locator('#cardDescription').fill(cardData.description);
    }

    // Click save - all attempts should fail
    await page.locator('#saveCardBtn').click();

    // Wait for retries to complete and error to appear
    await page.waitForTimeout(5000);

    // Modal should stay open (error occurred and persisted)
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Should show error message to user
    // Look for common error indicators in the modal
    const hasError = await page.evaluate(() => {
      const modal = document.querySelector('#cardEditorModal');
      if (!modal) return false;

      // Check for error message elements or classes
      const errorIndicators = [
        modal.querySelector('.error'),
        modal.querySelector('[class*="error"]'),
        modal.querySelector('.alert-error'),
        // Check if save button is re-enabled after failure
        !modal.querySelector('#saveCardBtn')?.disabled,
      ];

      return errorIndicators.some((indicator) => indicator);
    });

    // Either error message is shown OR save button is re-enabled for retry
    expect(hasError).toBe(true);

    // Verify card was NOT saved to Firestore
    // waitForCardInFirestore throws if not found, so we expect it to throw
    await expect(async () => {
      await waitForCardInFirestore(cardData.title, 2000); // Short timeout since we expect failure
    }).rejects.toThrow('not found');
  });
});

test.describe('Add Card - Custom Type Persistence', () => {
  test.skip(!isEmulatorMode, 'Custom type tests only run against emulator');

  // TODO(#1252): Implement custom type persistence before enabling this test
  test.skip('should persist custom type for reuse in dropdown', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `custom-type-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card with custom type
    const customType = `CustomType-${Date.now()}`;
    const customSubtype = `CustomSubtype-${Date.now()}`;

    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    await page.locator('#cardTitle').fill(`Test Card ${Date.now()}`);
    await page.locator('#cardType').fill(customType);
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill(customSubtype);
    await page.locator('#cardSubtype').press('Escape');

    await page.locator('#saveCardBtn').click();
    await expect(page.locator('#cardEditorModal.active')).not.toBeVisible({ timeout: 10000 });

    // Wait for card to be created
    await page.waitForTimeout(2000);

    // Open modal again
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Click on type input to open dropdown
    await page.locator('#cardType').click();

    // Verify custom type appears in dropdown
    const customTypeOption = page
      .locator('#typeListbox .combobox-option')
      .filter({ hasText: customType });
    await expect(customTypeOption).toBeVisible({ timeout: 5000 });

    // Close modal
    await page.locator('#cancelCardBtn').click();
  });
});

test.describe('Add Card - Auth Session Management', () => {
  test.skip(!isEmulatorMode, 'Auth session tests only run against emulator');

  // TODO(#1326): Test expects "guest indicator" UI element that doesn't exist
  test.skip('should reload cards when signing in after guest browsing', async ({
    page,
    authEmulator,
  }) => {
    // Start as guest
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    // Verify not authenticated (no auth controls visible)
    const addCardBtnVisible = await page.locator('#addCardBtn').isVisible();
    expect(addCardBtnVisible).toBe(false);

    // Should show demo data or login prompt
    const hasGuestIndicator = await page
      .locator('text=/Please log in|demo data|offline/i')
      .isVisible();
    expect(hasGuestIndicator).toBe(true);

    // Count cards before sign-in
    const cardCountBeforeAuth = await page.locator('.card-item').count();
    expect(cardCountBeforeAuth).toBeGreaterThan(0); // Should have demo data or Firestore cards

    // Get first few card titles to verify they persist after sign-in
    const cardTitlesBeforeAuth = await page.locator('.card-item h3.card-title').allTextContents();
    const firstCardTitle = cardTitlesBeforeAuth[0];

    // Now sign in
    const email = `session-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Wait for auth state to propagate
    await page.waitForTimeout(2000);

    // Verify authenticated controls appear
    const addCardBtnVisibleAfterAuth = await page.locator('#addCardBtn').isVisible();
    expect(addCardBtnVisibleAfterAuth).toBe(true);

    // Verify body has authenticated class
    const hasAuthClass = await page.evaluate(() =>
      document.body.classList.contains('authenticated')
    );
    expect(hasAuthClass).toBe(true);

    // CRITICAL: Verify cards still visible after sign-in (regression test for #244)
    const cardCountAfterAuth = await page.locator('.card-item').count();
    expect(cardCountAfterAuth).toBeGreaterThan(0); // Cards should NOT disappear

    // Verify at least the first card is still findable
    const isFirstCardStillVisible = await page
      .locator('.card-item')
      .filter({ hasText: firstCardTitle })
      .isVisible();
    expect(isFirstCardStillVisible).toBe(true);
  });
});

test.describe('Add Card - Type/Subtype Mismatch Validation', () => {
  test.skip(!isEmulatorMode, 'Type/subtype tests only run against emulator');

  test('should allow any type/subtype combination (documents current behavior)', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `mismatch-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card with intentionally mismatched type/subtype
    // e.g., Equipment type with MagicSpell subtype
    const cardData = {
      title: `Test Card ${Date.now()}-mismatch`,
      type: 'Equipment',
      subtype: 'MagicSpell', // Normally doesn't belong to Equipment
    };

    await createCardViaUI(page, cardData);

    // Verify card was created successfully (current behavior: no validation)
    await expect(page.locator('.card-item-title').filter({ hasText: cardData.title })).toBeVisible({
      timeout: 10000,
    });

    // OPTIMIZATION(#1805): Use real-time snapshot listener instead of fixed 2s wait (typically 50-500ms)
    const firestoreCard = await waitForCardInFirestore(cardData.title, 15000);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.type).toBe('Equipment');
    expect(firestoreCard.subtype).toBe('MagicSpell');
  });
});

test.describe('Add Card - Validation Error Recovery', () => {
  test.skip(!isEmulatorMode, 'Validation tests only run against emulator');

  // TODO(#1250): Implement form validation error message display before enabling this test
  test.skip('should show inline errors, allow user to fix, and successfully retry', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `validation-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open the add card modal
    await page.click('#addCardBtn');
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Try to submit with all required fields empty
    await page.click('#saveCardBtn');

    // Verify inline errors appear for all required fields
    const titleError = page.locator('#cardTitle').locator('..').locator('.error-message');
    const typeError = page
      .locator('#cardType')
      .locator('..')
      .locator('..')
      .locator('.error-message');
    const subtypeError = page
      .locator('#cardSubtype')
      .locator('..')
      .locator('..')
      .locator('.error-message');

    await expect(titleError).toContainText('Title is required', { timeout: 3000 });
    await expect(typeError).toContainText('Type is required', { timeout: 3000 });
    await expect(subtypeError).toContainText('Subtype is required', { timeout: 3000 });

    // Verify form-group has has-error class
    const titleGroup = page.locator('#cardTitle').locator('..');
    await expect(titleGroup).toHaveClass(/has-error/);

    // Fix the title field
    await page.fill('#cardTitle', 'Test Card Title');

    // Verify title error clears on input
    await expect(titleError).toBeEmpty({ timeout: 2000 });
    await expect(titleGroup).not.toHaveClass(/has-error/);

    // Try to submit again with only title filled
    await page.click('#saveCardBtn');

    // Verify title error doesn't reappear, but type/subtype errors remain
    await expect(titleError).toBeEmpty();
    await expect(typeError).toContainText('Type is required', { timeout: 3000 });
    await expect(subtypeError).toContainText('Subtype is required', { timeout: 3000 });

    // Fix type field using combobox
    await page.click('#cardType');
    await page.waitForSelector('#typeListbox li', { timeout: 3000 });
    await page.click('#typeListbox li:first-child');

    // Verify type error clears
    await expect(typeError).toBeEmpty({ timeout: 2000 });

    // Fix subtype field using combobox
    await page.click('#cardSubtype');
    await page.waitForSelector('#subtypeListbox li', { timeout: 3000 });
    await page.click('#subtypeListbox li:first-child');

    // Verify subtype error clears
    await expect(subtypeError).toBeEmpty({ timeout: 2000 });

    // Now submit successfully
    await page.click('#saveCardBtn');

    // Verify modal closes
    await expect(page.locator('#cardEditorModal')).not.toHaveClass(/show/, { timeout: 5000 });

    // Verify card appears in list
    await expect(
      page.locator('.card-item-title').filter({ hasText: 'Test Card Title' })
    ).toBeVisible({
      timeout: 10000,
    });
  });

  test('should validate field length limits', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `length-validation-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open the add card modal
    await page.click('#addCardBtn');
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Test title length limit (max 100 characters)
    const longTitle = 'A'.repeat(101);
    await page.fill('#cardTitle', longTitle);

    // Fill required fields
    await page.click('#cardType');
    await page.waitForSelector('#typeListbox li', { timeout: 3000 });
    await page.click('#typeListbox li:first-child');

    await page.click('#cardSubtype');
    await page.waitForSelector('#subtypeListbox li', { timeout: 3000 });
    await page.click('#subtypeListbox li:first-child');

    // Try to submit
    await page.click('#saveCardBtn');

    // Verify title length error appears
    const titleError = page.locator('#cardTitle').locator('..').locator('.error-message');
    await expect(titleError).toContainText('Title must be 100 characters or less', {
      timeout: 3000,
    });

    // Fix by shortening title
    await page.fill('#cardTitle', 'A'.repeat(100));

    // Verify error clears
    await expect(titleError).toBeEmpty({ timeout: 2000 });

    // Test description length limit (max 500 characters)
    const longDescription = 'B'.repeat(501);
    await page.fill('#cardDescription', longDescription);

    // Try to submit
    await page.click('#saveCardBtn');

    // Verify description length error appears
    const descError = page.locator('#cardDescription').locator('..').locator('.error-message');
    await expect(descError).toContainText('Description must be 500 characters or less', {
      timeout: 3000,
    });

    // Fix by shortening description
    await page.fill('#cardDescription', 'B'.repeat(500));

    // Verify error clears
    await expect(descError).toBeEmpty({ timeout: 2000 });

    // Submit successfully
    await page.click('#saveCardBtn');

    // Verify modal closes
    await expect(page.locator('#cardEditorModal')).not.toHaveClass(/show/, { timeout: 5000 });
  });

  // TODO(#1248): Implement window.__signOut() test helper before enabling this test
  test.skip('should show server-side validation error in modal (not alert)', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `server-validation-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open the add card modal
    await page.click('#addCardBtn');
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill out form completely
    await page.fill('#cardTitle', `Server Error Test ${Date.now()}`);

    await page.click('#cardType');
    await page.waitForSelector('#typeListbox li', { timeout: 3000 });
    await page.click('#typeListbox li:first-child');

    await page.click('#cardSubtype');
    await page.waitForSelector('#subtypeListbox li', { timeout: 3000 });
    await page.click('#subtypeListbox li:first-child');

    // Sign out to trigger permission error
    await authEmulator.signOutTestUser();
    await page.waitForTimeout(1000);

    // Setup dialog listener to catch any alerts (there shouldn't be any)
    let alertTriggered = false;
    page.on('dialog', async (dialog) => {
      alertTriggered = true;
      await dialog.dismiss();
    });

    // Try to save
    await page.click('#saveCardBtn');
    await page.waitForTimeout(2000);

    // Verify NO alert was shown
    expect(alertTriggered).toBe(false);

    // Verify error banner appears in modal
    const formErrorBanner = page.locator('.modal-body .form-error-banner');
    await expect(formErrorBanner).toBeVisible({ timeout: 3000 });
    await expect(formErrorBanner).toContainText('Please sign in to create cards');

    // Verify modal is still open
    await expect(page.locator('#cardEditorModal')).toHaveClass(/show/);

    // Verify save button is re-enabled
    const saveBtn = page.locator('#saveCardBtn');
    await expect(saveBtn).not.toBeDisabled();

    // Sign back in and verify retry works
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Error banner should still be visible from previous attempt
    await expect(formErrorBanner).toBeVisible();

    // Click save again
    await page.click('#saveCardBtn');

    // Verify modal closes (save succeeded)
    await expect(page.locator('#cardEditorModal')).not.toHaveClass(/show/, { timeout: 5000 });
  });
});

test.describe('Combobox - Toggle Button Behavior', () => {
  test.skip(!isEmulatorMode, 'Combobox tests only run against emulator');

  test('should not flash dropdown when toggle button clicked while closed', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `combobox-toggle-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open the add card modal
    await page.click('#addCardBtn');
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Get references to combobox elements
    const typeInput = page.locator('#cardType');
    const typeListbox = page.locator('#typeListbox');
    const typeToggleBtn = page.locator('#typeCombobox .combobox-toggle');

    // Verify dropdown starts closed
    await expect(typeInput).toHaveAttribute('aria-expanded', 'false');
    await expect(typeListbox).not.toBeVisible();

    // Track aria-expanded state changes using MutationObserver
    const stateChanges = await page.evaluate(() => {
      return new Promise((resolve) => {
        const input = document.getElementById('cardType');
        const changes = [];
        let changeCount = 0;
        const maxChanges = 10; // Safety limit

        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.attributeName === 'aria-expanded') {
              const newValue = input.getAttribute('aria-expanded');
              changes.push({
                timestamp: Date.now(),
                value: newValue,
              });
              changeCount++;

              // Stop observing after reasonable number of changes
              if (changeCount >= maxChanges) {
                observer.disconnect();
                resolve(changes);
              }
            }
          });
        });

        observer.observe(input, { attributes: true, attributeFilter: ['aria-expanded'] });

        // Click the toggle button
        const toggleBtn = document.querySelector('#typeCombobox .combobox-toggle');
        toggleBtn.click();

        // Wait a bit to see if there are multiple state changes (flash)
        setTimeout(() => {
          observer.disconnect();
          resolve(changes);
        }, 1000);
      });
    });

    // Verify exactly ONE state change: closed (false) → open (true)
    // No flash means no sequence like: false → true → false → true
    expect(stateChanges.length).toBe(1);
    expect(stateChanges[0].value).toBe('true');

    // Verify final state is open
    await expect(typeInput).toHaveAttribute('aria-expanded', 'true');
    await expect(typeListbox).toBeVisible();

    // Now test clicking toggle while open (should close)
    const closeStateChanges = await page.evaluate(() => {
      return new Promise((resolve) => {
        const input = document.getElementById('cardType');
        const changes = [];
        let changeCount = 0;
        const maxChanges = 10;

        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.attributeName === 'aria-expanded') {
              const newValue = input.getAttribute('aria-expanded');
              changes.push({
                timestamp: Date.now(),
                value: newValue,
              });
              changeCount++;

              if (changeCount >= maxChanges) {
                observer.disconnect();
                resolve(changes);
              }
            }
          });
        });

        observer.observe(input, { attributes: true, attributeFilter: ['aria-expanded'] });

        // Click the toggle button again (to close)
        const toggleBtn = document.querySelector('#typeCombobox .combobox-toggle');
        toggleBtn.click();

        setTimeout(() => {
          observer.disconnect();
          resolve(changes);
        }, 1000);
      });
    });

    // Verify exactly ONE state change: open (true) → closed (false)
    expect(closeStateChanges.length).toBe(1);
    expect(closeStateChanges[0].value).toBe('false');

    // Verify final state is closed
    await expect(typeInput).toHaveAttribute('aria-expanded', 'false');
    await expect(typeListbox).not.toBeVisible();
  });

  // TODO(#1254): Fix race condition in rapid toggle click handling
  test.skip('should handle rapid toggle clicks without flashing', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `rapid-toggle-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open the add card modal
    await page.click('#addCardBtn');
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    const typeInput = page.locator('#cardType');
    const typeListbox = page.locator('#typeListbox');
    const typeToggleBtn = page.locator('#typeCombobox .combobox-toggle');

    // Track all state changes during rapid clicking
    const rapidClickResults = await page.evaluate(() => {
      return new Promise((resolve) => {
        const input = document.getElementById('cardType');
        const changes = [];
        let observerActive = true;

        const observer = new MutationObserver((mutations) => {
          if (!observerActive) return;
          mutations.forEach((mutation) => {
            if (mutation.attributeName === 'aria-expanded') {
              changes.push({
                timestamp: Date.now(),
                value: input.getAttribute('aria-expanded'),
              });
            }
          });
        });

        observer.observe(input, { attributes: true, attributeFilter: ['aria-expanded'] });

        // Rapid click 5 times
        const toggleBtn = document.querySelector('#typeCombobox .combobox-toggle');
        for (let i = 0; i < 5; i++) {
          toggleBtn.click();
        }

        // Wait to collect all state changes
        setTimeout(() => {
          observerActive = false;
          observer.disconnect();
          resolve({
            changes,
            finalState: input.getAttribute('aria-expanded'),
          });
        }, 1500);
      });
    });

    // Verify we got exactly 5 state changes (one per click)
    // No duplicate or skipped transitions
    expect(rapidClickResults.changes.length).toBe(5);

    // Verify alternating pattern: true, false, true, false, true
    expect(rapidClickResults.changes[0].value).toBe('true');
    expect(rapidClickResults.changes[1].value).toBe('false');
    expect(rapidClickResults.changes[2].value).toBe('true');
    expect(rapidClickResults.changes[3].value).toBe('false');
    expect(rapidClickResults.changes[4].value).toBe('true');

    // Verify final state matches last change
    expect(rapidClickResults.finalState).toBe('true');
    await expect(typeListbox).toBeVisible();
  });
});

// TODO(#1255): Fix auth listener cleanup and memory leak issues
test.describe.skip('Auth Listener - Cleanup and Memory Leak Prevention', () => {
  // TODO(#1255): Fix auth listener cleanup - authenticated class not being removed
  test('should clean up auth listener on re-initialization', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `auth-cleanup-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);

    // Reset the counter before starting
    await page.evaluate(() => {
      window.__authStateChangeCount = 0;
    });

    // Sign in - triggers initial auth state change
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Get initial count (should be 1 from sign-in)
    const countAfterSignIn = await page.evaluate(() => window.__authStateChangeCount);
    expect(countAfterSignIn).toBeGreaterThanOrEqual(1);

    // Re-initialize the page multiple times (simulates HTMX navigation)
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        // Re-init the cards page
        if (window.initCardsPage) {
          window.initCardsPage();
        }
      });
      await page.waitForTimeout(500);
    }

    // Reset counter to track sign-out events
    await page.evaluate(() => {
      window.__authStateChangeCount = 0;
    });

    // Sign out - should trigger auth state change only ONCE
    // If listeners weren't cleaned up, we'd see multiple events (one per init)
    await authEmulator.signOutTestUser();
    await page.waitForTimeout(1000);

    // Get final count - should be 1 (only one listener active)
    const countAfterSignOut = await page.evaluate(() => window.__authStateChangeCount);

    // If cleanup works correctly, we should see exactly 1 sign-out event
    // If cleanup failed, we'd see 4 events (initial + 3 re-inits = 4 listeners)
    expect(countAfterSignOut).toBe(1);

    // Verify UI reflects signed-out state
    const hasAuthClass = await page.evaluate(() =>
      document.body.classList.contains('authenticated')
    );
    expect(hasAuthClass).toBe(false);
  });

  // TODO(#1255): Fix memory leak detection
  test('should not accumulate listeners causing memory leaks', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `memory-leak-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Re-initialize 5 times
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        if (window.initCardsPage) {
          window.initCardsPage();
        }
      });
      await page.waitForTimeout(300);
    }

    // Reset counter
    await page.evaluate(() => {
      window.__authStateChangeCount = 0;
    });

    // Trigger a single auth state change by signing out
    await authEmulator.signOutTestUser();
    await page.waitForTimeout(1000);

    const eventCount = await page.evaluate(() => window.__authStateChangeCount);

    // Should be exactly 1 event (not 6, which would indicate leaked listeners)
    expect(eventCount).toBe(1);

    // Sign back in and verify still only 1 listener
    await page.evaluate(() => {
      window.__authStateChangeCount = 0;
    });

    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    const signInEventCount = await page.evaluate(() => window.__authStateChangeCount);
    expect(signInEventCount).toBe(1);
  });

  test('should handle auth listener errors gracefully during cleanup', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `error-cleanup-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Break the unsubscribe function intentionally
    await page.evaluate(() => {
      // Mock a broken unsubscribe
      const brokenUnsubscribe = () => {
        throw new Error('Unsubscribe failed');
      };
      // This simulates a scenario where cleanup might fail
      window.__testBrokenCleanup = brokenUnsubscribe;
    });

    // Re-init should still work even if previous cleanup had issues
    let errorThrown = false;
    try {
      await page.evaluate(() => {
        if (window.initCardsPage) {
          window.initCardsPage();
        }
      });
      await page.waitForTimeout(500);
    } catch (error) {
      errorThrown = true;
    }

    // Should not throw errors to the test (errors should be caught internally)
    expect(errorThrown).toBe(false);

    // Verify auth still works after error scenario
    await authEmulator.signOutTestUser();
    await page.waitForTimeout(1000);

    const hasAuthClass = await page.evaluate(() =>
      document.body.classList.contains('authenticated')
    );
    expect(hasAuthClass).toBe(false);
  });

  test('should show warning banner after auth listener retry exhaustion', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Mock onAuthStateChanged to always throw "before auth initialized" error
    await page.evaluate(() => {
      // Save original onAuthStateChanged
      const authInitModule = window.__authInitModule || {};
      window.__originalOnAuthStateChanged = authInitModule.onAuthStateChanged;

      // Override to always throw
      if (authInitModule) {
        authInitModule.onAuthStateChanged = () => {
          throw new Error('Cannot call onAuthStateChanged before auth initialized');
        };
      }
    });

    // Trigger cards page initialization which will try to setup auth listener
    await page.evaluate(() => {
      if (window.initCardsPage) {
        window.initCardsPage();
      }
    });

    // Wait for retry exhaustion (10 retries * 500ms = 5 seconds + buffer)
    await page.waitForTimeout(6000);

    // Verify warning banner appears
    const warningBanner = page.locator('.warning-banner');
    await expect(warningBanner).toBeVisible();

    // Verify banner message is actionable
    const bannerText = await warningBanner.textContent();
    expect(bannerText).toContain('Authentication system failed to initialize');
    expect(bannerText).toContain('refresh the page');

    // Restore original function
    await page.evaluate(() => {
      if (window.__originalOnAuthStateChanged && window.__authInitModule) {
        window.__authInitModule.onAuthStateChanged = window.__originalOnAuthStateChanged;
      }
    });
  });

  test('should retry auth listener setup with exponential backoff', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Track retry attempts
    const retryLog = [];

    // Mock onAuthStateChanged to fail first 3 times, then succeed
    await page.evaluate(() => {
      window.__retryAttempts = 0;
      window.__retryLog = [];

      const authInitModule = window.__authInitModule || {};
      window.__originalOnAuthStateChanged = authInitModule.onAuthStateChanged;

      if (authInitModule) {
        authInitModule.onAuthStateChanged = (callback) => {
          window.__retryAttempts++;
          window.__retryLog.push({
            attempt: window.__retryAttempts,
            timestamp: Date.now(),
          });

          if (window.__retryAttempts < 4) {
            throw new Error('Cannot call onAuthStateChanged before auth initialized');
          }

          // On 4th attempt, succeed and call original
          return window.__originalOnAuthStateChanged(callback);
        };
      }
    });

    // Trigger cards page initialization
    await page.evaluate(() => {
      if (window.initCardsPage) {
        window.initCardsPage();
      }
    });

    // Wait for retries to complete (4 attempts * 500ms avg delay = 2s + buffer)
    await page.waitForTimeout(3000);

    // Get retry log
    const retryAttempts = await page.evaluate(() => window.__retryAttempts);
    const retryTimestamps = await page.evaluate(() => window.__retryLog);

    // Verify 4 attempts were made (3 failures + 1 success)
    expect(retryAttempts).toBe(4);

    // Verify delays increased between retries (exponential backoff)
    if (retryTimestamps.length >= 2) {
      const delay1 = retryTimestamps[1].timestamp - retryTimestamps[0].timestamp;
      const delay2 = retryTimestamps[2].timestamp - retryTimestamps[1].timestamp;

      // Second delay should be approximately double the first (exponential backoff)
      // Using generous bounds due to timing variability in tests
      expect(delay2).toBeGreaterThan(delay1 * 1.5);
    }

    // Verify auth listener eventually succeeded (no warning banner)
    const warningBanner = page.locator('.warning-banner');
    await expect(warningBanner).not.toBeVisible();

    // Restore original function
    await page.evaluate(() => {
      if (window.__originalOnAuthStateChanged && window.__authInitModule) {
        window.__authInitModule.onAuthStateChanged = window.__originalOnAuthStateChanged;
      }
    });
  });
});

test.describe('Add Card - Timeout Error Recovery', () => {
  test.skip(!isEmulatorMode, 'Timeout tests only run against emulator');

  // TODO(#1256): Implement timeout error recovery UI (form error banner)
  test.skip('should clear isSaving flag and allow retry after timeout', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `timeout-recovery-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Open the add card modal
    await page.click('#addCardBtn');
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill out form
    const cardTitle = `Timeout Test ${Date.now()}`;
    await page.fill('#cardTitle', cardTitle);

    await page.click('#cardType');
    await page.waitForSelector('#typeListbox li', { timeout: 3000 });
    await page.click('#typeListbox li:first-child');

    await page.click('#cardSubtype');
    await page.waitForSelector('#subtypeListbox li', { timeout: 3000 });
    await page.click('#subtypeListbox li:first-child');

    // Intercept Firestore requests and delay them to simulate timeout
    await page.route('**/*firestore.googleapis.com/**', async (route) => {
      // Delay the response by 8 seconds (exceeds typical 5s timeout)
      await new Promise((resolve) => setTimeout(resolve, 8000));
      await route.abort('timedout');
    });

    // Try to save
    await page.click('#saveCardBtn');

    // Wait for timeout to occur
    await page.waitForTimeout(9000);

    // Verify error message appears in modal
    const formErrorBanner = page.locator('.modal-body .form-error-banner');
    await expect(formErrorBanner).toBeVisible({ timeout: 3000 });

    // Verify modal is still open (not closed)
    await expect(page.locator('#cardEditorModal')).toHaveClass(/show/);

    // Verify save button is re-enabled (isSaving flag cleared)
    const saveBtn = page.locator('#saveCardBtn');
    await expect(saveBtn).not.toBeDisabled({ timeout: 2000 });

    // Remove the intercept to allow retry to succeed
    await page.unroute('**/*firestore.googleapis.com/**');

    // Clear the error banner so we can verify success
    await page.evaluate(() => {
      document.querySelector('.form-error-banner')?.remove();
    });

    // Retry save - should work now
    await page.click('#saveCardBtn');

    // Verify modal closes (save succeeded)
    await expect(page.locator('#cardEditorModal')).not.toHaveClass(/show/, { timeout: 5000 });

    // Verify card appears in list
    await expect(page.locator('.card-item-title').filter({ hasText: cardTitle })).toBeVisible({
      timeout: 10000,
    });
  });

  // TODO(#1314): Test bug - routes firestore.googleapis.com but emulator uses 127.0.0.1:8081
  test.skip('should not allow double-submit while save in progress', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `double-submit-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Open the add card modal
    await page.click('#addCardBtn');
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill out form
    const cardTitle = `Double Submit Test ${Date.now()}`;
    await page.fill('#cardTitle', cardTitle);

    await page.click('#cardType');
    await page.waitForSelector('#typeListbox li', { timeout: 3000 });
    await page.click('#typeListbox li:first-child');

    await page.click('#cardSubtype');
    await page.waitForSelector('#subtypeListbox li', { timeout: 3000 });
    await page.click('#subtypeListbox li:first-child');

    // Track Firestore request count
    let firestoreRequestCount = 0;
    await page.route('**/*firestore.googleapis.com/**', async (route) => {
      if (route.request().method() === 'POST') {
        firestoreRequestCount++;
      }
      // Delay to give time for double-click attempt
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });

    // Click save button rapidly twice
    const saveBtn = page.locator('#saveCardBtn');
    await saveBtn.click();
    await saveBtn.click(); // Second click should be ignored

    // Wait for request to complete
    await page.waitForTimeout(3000);

    // Verify only ONE Firestore request was made
    expect(firestoreRequestCount).toBe(1);

    // Clean up route
    await page.unroute('**/*firestore.googleapis.com/**');

    // Verify modal closed (save succeeded)
    await expect(page.locator('#cardEditorModal')).not.toHaveClass(/show/, { timeout: 5000 });

    // Verify card appears exactly once in list (not duplicated)
    const cardElements = page.locator('.card-item-title').filter({ hasText: cardTitle });
    await expect(cardElements).toHaveCount(1);
  });

  // TODO(#1314): Test bug - routes firestore.googleapis.com but emulator uses 127.0.0.1:8081
  test.skip('should show appropriate error message for network timeout', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `network-timeout-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Open the add card modal
    await page.click('#addCardBtn');
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill out form
    await page.fill('#cardTitle', `Network Timeout Test ${Date.now()}`);

    await page.click('#cardType');
    await page.waitForSelector('#typeListbox li', { timeout: 3000 });
    await page.click('#typeListbox li:first-child');

    await page.click('#cardSubtype');
    await page.waitForSelector('#subtypeListbox li', { timeout: 3000 });
    await page.click('#subtypeListbox li:first-child');

    // Intercept and abort with timeout error
    await page.route('**/*firestore.googleapis.com/**', async (route) => {
      await route.abort('timedout');
    });

    // Try to save
    await page.click('#saveCardBtn');
    await page.waitForTimeout(2000);

    // Verify appropriate error message is shown
    const formErrorBanner = page.locator('.modal-body .form-error-banner');
    await expect(formErrorBanner).toBeVisible({ timeout: 3000 });

    // Error message should mention timeout or network issue
    const errorText = await formErrorBanner.textContent();
    expect(errorText).toMatch(/timeout|network|connection|failed/i);

    // Verify save button is enabled for retry
    const saveBtn = page.locator('#saveCardBtn');
    await expect(saveBtn).not.toBeDisabled();

    // Clean up
    await page.unroute('**/*firestore.googleapis.com/**');
  });
});

test.describe('Add Card - Field Length Validation Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test('should reject title exceeding 100 characters', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `length-test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill form with title exceeding 100 characters
    const longTitle = 'A'.repeat(101);
    await page.locator('#cardTitle').fill(longTitle);
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#cardSubtype').press('Escape');

    // Try to save
    await page.locator('#saveCardBtn').click();

    // Modal should still be open (validation failed)
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Verify error message is shown
    const titleGroup = page.locator('#cardTitle').locator('..');
    await expect(titleGroup.locator('.error-message')).toBeVisible({ timeout: 2000 });
    const errorText = await titleGroup.locator('.error-message').textContent();
    expect(errorText).toContain('100 characters');
  });

  test('should reject description exceeding 500 characters', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `desc-length-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill form with description exceeding 500 characters
    const longDescription = 'B'.repeat(501);
    await page.locator('#cardTitle').fill(`Test Card ${Date.now()}`);
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#cardSubtype').press('Escape');
    await page.locator('#cardDescription').fill(longDescription);

    // Try to save
    await page.locator('#saveCardBtn').click();

    // Modal should still be open (validation failed)
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Verify error message is shown
    const descGroup = page.locator('#cardDescription').locator('..');
    await expect(descGroup.locator('.error-message')).toBeVisible({ timeout: 2000 });
    const errorText = await descGroup.locator('.error-message').textContent();
    expect(errorText).toContain('500 characters');
  });

  test('should accept title with exactly 100 characters', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `boundary-title-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill form with exactly 100 character title
    const exactTitle = `Test-${Date.now()}-${'X'.repeat(100 - `Test-${Date.now()}-`.length)}`;
    expect(exactTitle.length).toBe(100);

    await page.locator('#cardTitle').fill(exactTitle);
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#cardSubtype').press('Escape');

    // Submit form
    await page.locator('#saveCardBtn').click();

    // Modal should close (validation succeeded)
    await expect(page.locator('#cardEditorModal')).not.toHaveClass(/active/, { timeout: 10000 });

    // Verify card appears in list
    await page.waitForTimeout(2000);
    const cardTitle = page.locator('.card-item-title').filter({ hasText: exactTitle });
    await expect(cardTitle).toBeVisible({ timeout: 10000 });
  });

  test('should accept description with exactly 500 characters', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `boundary-desc-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill form with exactly 500 character description
    const exactDescription = 'D'.repeat(500);
    expect(exactDescription.length).toBe(500);

    const testTitle = `Boundary Desc ${Date.now()}`;
    await page.locator('#cardTitle').fill(testTitle);
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#cardSubtype').press('Escape');
    await page.locator('#cardDescription').fill(exactDescription);

    // Submit form
    await page.locator('#saveCardBtn').click();

    // Modal should close (validation succeeded)
    await expect(page.locator('#cardEditorModal')).not.toHaveClass(/active/, { timeout: 10000 });

    // Verify card appears in list
    await page.waitForTimeout(2000);
    const cardTitle = page.locator('.card-item-title').filter({ hasText: testTitle });
    await expect(cardTitle).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Add Card - Whitespace-Only Field Validation Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test('should reject whitespace-only title', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `whitespace-title-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill form with whitespace-only title
    await page.locator('#cardTitle').fill('   ');
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#cardSubtype').press('Escape');

    // Try to save
    await page.locator('#saveCardBtn').click();

    // Modal should still be open (validation failed)
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Verify error message is shown
    const titleGroup = page.locator('#cardTitle').locator('..');
    await expect(titleGroup.locator('.error-message')).toBeVisible({ timeout: 2000 });
    const errorText = await titleGroup.locator('.error-message').textContent();
    expect(errorText).toContain('required');
  });

  test('should reject whitespace-only type', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `whitespace-type-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill form with whitespace-only type (whitespace will be trimmed to empty string)
    const testTitle = `Test Card ${Date.now()}`;
    await page.locator('#cardTitle').fill(testTitle);
    await page.locator('#cardType').fill('   ');
    await page.locator('#cardType').press('Escape');

    // Try to save
    await page.locator('#saveCardBtn').click();
    await page.waitForTimeout(1500);

    // Modal should still be open (validation failed - whitespace is trimmed to empty string which triggers required validation)
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Verify the card was NOT created (validation prevented save)
    const cardInList = page.locator('.card-item-title').filter({ hasText: testTitle });
    await expect(cardInList).not.toBeVisible();
  });
});

test.describe('Add Card - Combobox Error Recovery Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  // TODO(#480): Test relies on internal implementation details (window.__cardsState)
  test.skip('should show error UI when combobox options fail to load and recover', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `combobox-error-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // TODO(#480): Test is tightly coupled to implementation details (window.__getTypesFromCards)
    // Consider testing error behavior via network mocking or documented test hooks
    // Mock getTypesFromCards to throw error
    await page.evaluate(() => {
      const originalGetTypesFromCards = window.__getTypesFromCards;
      window.__forceComboboxError = true;

      // Inject error into getOptions function
      const typeComboboxElement = document.getElementById('typeCombobox');
      if (typeComboboxElement) {
        const typeInput = document.getElementById('cardType');
        if (typeInput) {
          // Trigger refresh which will call getOptions and hit our mocked error
          typeInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    });

    // Inject error by making getTypesFromCards throw
    await page.evaluate(() => {
      // Override the state.cards to cause getTypesFromCards to throw
      const cardsModule = document.querySelector('script[src*="cards.js"]');
      if (window.__cardsState) {
        // Save original cards
        window.__originalCards = window.__cardsState.cards;
        // Make cards.filter throw
        window.__cardsState.cards = {
          filter: () => {
            throw new Error('Simulated combobox error');
          },
        };
      }
    });

    // Focus type input to trigger refresh
    await page.locator('#cardType').focus();
    await page.waitForTimeout(500);

    // Verify error UI appears in combobox
    const typeListbox = page.locator('#typeListbox');
    await expect(typeListbox).toHaveClass(/combobox-error/, { timeout: 2000 });

    const errorMessage = page.locator('#typeListbox .combobox-error-message');
    await expect(errorMessage).toBeVisible();
    const errorText = await errorMessage.textContent();
    expect(errorText).toContain('Error loading options');

    // Fix error condition - restore cards
    await page.evaluate(() => {
      if (window.__cardsState && window.__originalCards) {
        window.__cardsState.cards = window.__originalCards;
      }
    });

    // Trigger refresh again to verify recovery
    await page.locator('#cardType').fill('E');
    await page.waitForTimeout(500);

    // Verify error UI is gone and options appear
    await expect(typeListbox).not.toHaveClass(/combobox-error/);
    const options = page.locator('#typeListbox .combobox-option');
    await expect(options.first()).toBeVisible({ timeout: 2000 });
  });
});

test.describe('Add Card - Form Pre-Population on Failed Save Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  // TODO(#1326): Flaky test - Save button not becoming visible within timeout
  // This tests sign-out/sign-in edge case during save failure recovery
  test.skip('should preserve all form values after save failure', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `prepop-test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill form with specific values
    const testData = {
      title: `PrePop Test ${Date.now()}`,
      type: 'Equipment',
      subtype: 'Weapon',
      description: 'This is a test description that should be preserved',
      tags: 'tag1, tag2, tag3',
      stat1: '10',
      stat2: '2',
      cost: '5',
    };

    await page.locator('#cardTitle').fill(testData.title);
    await page.locator('#cardType').fill(testData.type);
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill(testData.subtype);
    await page.locator('#cardSubtype').press('Escape');
    await page.locator('#cardDescription').fill(testData.description);
    await page.locator('#cardTags').fill(testData.tags);
    await page.locator('#cardStat1').fill(testData.stat1);
    await page.locator('#cardStat2').fill(testData.stat2);
    await page.locator('#cardCost').fill(testData.cost);

    // Sign out to trigger save failure
    await authEmulator.signOutTestUser();
    await page.waitForTimeout(1000);

    // Try to save
    await page.locator('#saveCardBtn').click();
    await page.waitForTimeout(2000);

    // Modal should still be open with error
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Verify error message is shown
    const formError = page.locator('.modal-body .form-error-banner');
    await expect(formError).toBeVisible({ timeout: 3000 });

    // Verify all form fields still contain original values
    await expect(page.locator('#cardTitle')).toHaveValue(testData.title);
    await expect(page.locator('#cardType')).toHaveValue(testData.type);
    await expect(page.locator('#cardSubtype')).toHaveValue(testData.subtype);
    await expect(page.locator('#cardDescription')).toHaveValue(testData.description);
    await expect(page.locator('#cardTags')).toHaveValue(testData.tags);
    await expect(page.locator('#cardStat1')).toHaveValue(testData.stat1);
    await expect(page.locator('#cardStat2')).toHaveValue(testData.stat2);
    await expect(page.locator('#cardCost')).toHaveValue(testData.cost);

    // Verify save button is enabled for retry
    await expect(page.locator('#saveCardBtn')).not.toBeDisabled();

    // Sign back in and verify retry works
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Retry save
    await page.locator('#saveCardBtn').click();

    // Modal should close (save succeeded)
    await expect(page.locator('#cardEditorModal')).not.toHaveClass(/active/, { timeout: 10000 });

    // Verify card appears in list
    await page.waitForTimeout(2000);
    const cardTitle = page.locator('.card-item-title').filter({ hasText: testData.title });
    await expect(cardTitle).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Form Validation - Field Length Limits', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test('should show error when title exceeds 100 characters', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Create a title longer than 100 characters
    const longTitle = 'A'.repeat(101);
    await page.locator('#cardTitle').fill(longTitle);
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#cardSubtype').press('Escape');

    // Try to submit
    await page.locator('#saveCardBtn').click();

    // Modal should still be open (validation failed)
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Verify error message is shown
    const errorMessage = page.locator('#cardTitle').locator('..').locator('.error-message');
    await expect(errorMessage).toBeVisible({ timeout: 3000 });
    await expect(errorMessage).toHaveText('Title must be 100 characters or less');

    // Verify field has error class
    await expect(page.locator('#cardTitle')).toHaveClass(/error/);
  });

  test('should show error when description exceeds 500 characters', async ({
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

    // Fill required fields
    await page.locator('#cardTitle').fill(`Test Card ${Date.now()}`);
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#cardSubtype').press('Escape');

    // Create a description longer than 500 characters
    const longDescription = 'B'.repeat(501);
    await page.locator('#cardDescription').fill(longDescription);

    // Try to submit
    await page.locator('#saveCardBtn').click();

    // Modal should still be open (validation failed)
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Verify error message is shown
    const errorMessage = page.locator('#cardDescription').locator('..').locator('.error-message');
    await expect(errorMessage).toBeVisible({ timeout: 3000 });
    await expect(errorMessage).toHaveText('Description must be 500 characters or less');

    // Verify field has error class
    await expect(page.locator('#cardDescription')).toHaveClass(/error/);
  });

  test.skip('should display multiple validation errors simultaneously', async ({
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

    // Fill required type/subtype fields
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#cardSubtype').press('Escape');

    // Create both title and description that exceed limits
    const longTitle = 'A'.repeat(101);
    const longDescription = 'B'.repeat(501);
    await page.locator('#cardTitle').fill(longTitle);
    await page.locator('#cardDescription').fill(longDescription);

    // Try to submit
    await page.locator('#saveCardBtn').click();

    // Modal should still be open (validation failed)
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();

    // Verify both error messages are shown
    const titleErrorMessage = page.locator('#cardTitle').locator('..').locator('.error-message');
    await expect(titleErrorMessage).toBeVisible({ timeout: 3000 });
    await expect(titleErrorMessage).toHaveText('Title must be 100 characters or less');

    const descErrorMessage = page
      .locator('#cardDescription')
      .locator('..')
      .locator('.error-message');
    await expect(descErrorMessage).toBeVisible({ timeout: 3000 });
    await expect(descErrorMessage).toHaveText('Description must be 500 characters or less');

    // Verify both fields have error class
    await expect(page.locator('#cardTitle')).toHaveClass(/error/);
    await expect(page.locator('#cardDescription')).toHaveClass(/error/);
  });

  test('should clear error message on next input', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Create a title longer than 100 characters
    const longTitle = 'A'.repeat(101);
    await page.locator('#cardTitle').fill(longTitle);
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#cardSubtype').press('Escape');

    // Try to submit
    await page.locator('#saveCardBtn').click();

    // Wait for error to appear
    const errorMessage = page.locator('#cardTitle').locator('..').locator('.error-message');
    await expect(errorMessage).toBeVisible({ timeout: 3000 });

    // Type in the field to clear error
    await page.locator('#cardTitle').fill('Valid Title');

    // Error message should disappear
    await expect(errorMessage).toHaveText('');

    // Error class should be removed
    await expect(page.locator('#cardTitle')).not.toHaveClass(/error/);
  });

  test('should focus first invalid field on submit attempt', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill required type/subtype fields
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#cardSubtype').press('Escape');

    // Create a title that exceeds limit
    const longTitle = 'A'.repeat(101);
    await page.locator('#cardTitle').fill(longTitle);

    // Focus another field first to ensure we're not already focused on title
    await page.locator('#cardDescription').focus();

    // Try to submit
    await page.locator('#saveCardBtn').click();

    // Wait for validation
    await page.waitForTimeout(500);

    // Title field should have focus
    await expect(page.locator('#cardTitle')).toBeFocused();
  });
});

test.describe('Add Card - Edge Cases and Security Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  // TODO(#1326): Test bug - accesses window.firestore which isn't exposed by Firebase SDK
  test.skip('should prevent double-submit via rapid Enter key presses', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `double-submit-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill form
    const cardData = generateTestCardData('double-submit-test');
    await page.locator('#cardTitle').fill(cardData.title);
    await page.locator('#cardType').fill(cardData.type);
    await page.locator('#cardSubtype').fill(cardData.subtype);

    // Rapidly press Enter multiple times on a field
    const titleInput = page.locator('#cardTitle');
    await titleInput.press('Enter');
    await titleInput.press('Enter');
    await titleInput.press('Enter');

    // Wait for save to complete
    await page.waitForTimeout(3000);

    // Verify only ONE card was created (isSaving lock worked)
    const firestoreCards = await page.evaluate(async (title) => {
      const { collection, query, where, getDocs } = window.firestore;
      const q = query(collection(window.db, 'cards'), where('title', '==', title));
      const snapshot = await getDocs(q);
      return snapshot.docs.length;
    }, cardData.title);

    expect(firestoreCards).toBe(1);
  });

  test('should sanitize XSS attempts in custom type values', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `xss-test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Try to inject XSS via custom type using "Add New" combobox
    const xssPayload = '<script>alert("XSS")</script>';
    const cardData = generateTestCardData('xss-test');

    await page.locator('#cardTitle').fill(cardData.title);
    await page.locator('#cardType').fill(xssPayload);
    // Trigger "Add New" option by typing non-existent type
    await page.locator('#cardType').press('ArrowDown');
    await page.locator('#cardType').press('Enter');

    await page.locator('#cardSubtype').fill('Normal Subtype');
    await page.locator('#saveCardBtn').click();

    await page.waitForTimeout(3000);

    // Verify the XSS payload was escaped in the rendered card
    const cardInList = page.locator('.card-item').filter({ hasText: cardData.title });
    await expect(cardInList).toBeVisible();

    // The escaped content should be visible as text, not executed
    const cardHtml = await cardInList.innerHTML();
    expect(cardHtml).toContain('&lt;script&gt;');
    expect(cardHtml).not.toContain('<script>alert');

    // Verify no alert was triggered (page should still be functional)
    const modalVisible = await page.locator('#cardEditorModal.active').isVisible();
    expect(modalVisible).toBe(false); // Modal should have closed normally
  });

  // TODO(#1326): Test bug - accesses window.firestore which isn't exposed by Firebase SDK
  test.skip('should clear isSaving flag after Firestore write failure', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `firestore-fail-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Mock Firestore to fail
    await page.evaluate(() => {
      const originalAddDoc = window.firestore.addDoc;
      window.firestore.addDoc = async () => {
        throw new Error('Firestore write failed');
      };
      window.__restoreFirestore = () => {
        window.firestore.addDoc = originalAddDoc;
      };
    });

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill and submit form
    const cardData = generateTestCardData('firestore-fail-test');
    await page.locator('#cardTitle').fill(cardData.title);
    await page.locator('#cardType').fill(cardData.type);
    await page.locator('#cardSubtype').fill(cardData.subtype);
    await page.locator('#saveCardBtn').click();

    // Wait for error to be handled
    await page.waitForTimeout(2000);

    // Verify save button is re-enabled (isSaving flag was cleared)
    const saveBtn = page.locator('#saveCardBtn');
    const isDisabled = await saveBtn.isDisabled();
    expect(isDisabled).toBe(false);

    // Restore Firestore and verify user can retry
    await page.evaluate(() => {
      window.__restoreFirestore();
    });

    await page.locator('#saveCardBtn').click();
    await page.waitForTimeout(3000);

    // Verify card was created on retry
    const cardInList = page.locator('.card-item').filter({ hasText: cardData.title });
    await expect(cardInList).toBeVisible();
  });
});

test.describe('Add Card - Security Tests', () => {
  test.skip(!isEmulatorMode, 'Security tests only run against emulator');

  // TODO(#1326): Test bug - page.evaluate attempting to import module causing execution issues
  test.skip('should prevent forged server timestamps (createdAt)', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Try to create a card with a forged createdAt timestamp
    const forgedTimestamp = new Date('2020-01-01').toISOString();
    const cardTitle = `Test Card ${Date.now()}-forged-timestamp`;

    await page.evaluate(
      async ({ title, timestamp }) => {
        const { createCard } = await import('/src/scripts/firebase.js');
        // Attempt to forge createdAt - this should be ignored by serverTimestamp()
        await createCard({
          title,
          type: 'Equipment',
          subtype: 'Weapon',
          isPublic: true,
          createdAt: timestamp, // Forged timestamp
        });
      },
      { title: cardTitle, timestamp: forgedTimestamp }
    );

    await page.waitForTimeout(2000);

    // Verify the card was created with SERVER timestamp, not forged one
    const firestoreCard = await waitForCardInFirestore(cardTitle);
    expect(firestoreCard).toBeTruthy();

    // Server timestamp should be recent (within last 10 seconds), not from 2020
    const createdAt = firestoreCard.createdAt?.toDate?.() || new Date(firestoreCard.createdAt);
    const now = new Date();
    const timeDiff = Math.abs(now - createdAt) / 1000; // seconds
    expect(timeDiff).toBeLessThan(10); // Should be created within last 10 seconds
  });

  test('should deny read access to cards missing isPublic field', async ({
    page,
    authEmulator,
  }) => {
    // This test verifies the migration safety - cards without isPublic are unreadable
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Initial card count
    const initialCount = await page.locator('.card-item').count();

    // Try to create a card WITHOUT isPublic field (bypass client-side validation)
    const cardTitle = `Test Card ${Date.now()}-no-ispublic`;

    try {
      await page.evaluate(
        async ({ title }) => {
          const { db } = await import('/src/scripts/firebase.js');
          const { collection, addDoc } = await import('firebase/firestore');
          const cardsCollection = collection(db, 'cards');

          // Directly add document without isPublic field
          await addDoc(cardsCollection, {
            title,
            type: 'Equipment',
            subtype: 'Weapon',
          });
        },
        { title: cardTitle }
      );
    } catch (error) {
      // Expected to fail - security rules should reject cards without isPublic
      console.log('Expected error creating card without isPublic:', error.message);
    }

    // Refresh the page
    await page.reload();
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    // Verify card count did NOT increase (card was rejected or is unreadable)
    const finalCount = await page.locator('.card-item').count();
    expect(finalCount).toBe(initialCount);
  });

  test('should handle empty library when all cards missing isPublic', async ({
    page,
    authEmulator,
  }) => {
    // Verifies UI properly handles the case where migration hasn't run yet
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // If no cards are visible (all missing isPublic), empty state should show
    // This test passes if the page doesn't crash when cards are filtered out
    const emptyState = page.locator('#emptyState');
    const cardList = page.locator('.card-item');

    const cardCount = await cardList.count();
    if (cardCount === 0) {
      await expect(emptyState).toBeVisible();
    }
  });

  // TODO(#1326): Test bug - page.evaluate attempting to import module causing execution issues
  test.skip('should reject oversized title field (server-side validation)', async ({
    page,
    authEmulator,
  }) => {
    // Verifies server-side length validation prevents DoS via oversized fields
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Attempt direct Firestore write with oversized title (>100 chars)
    const oversizedTitle = 'A'.repeat(101) + `-${Date.now()}`;

    let errorOccurred = false;
    try {
      await page.evaluate(
        async ({ title }) => {
          const { db, auth } = await import('/src/scripts/firebase.js');
          const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
          const cardsCollection = collection(db, 'cards');

          // Bypass client-side validation by directly calling Firestore
          await addDoc(cardsCollection, {
            title,
            type: 'Equipment',
            subtype: 'Weapon',
            isPublic: true,
            createdBy: auth.currentUser?.uid,
            createdAt: serverTimestamp(),
            lastModifiedAt: serverTimestamp(),
          });
        },
        { title: oversizedTitle }
      );
    } catch (error) {
      errorOccurred = true;
      // Expected: permission-denied or failed-precondition
      console.log('Expected error for oversized title:', error.message);
    }

    // Verify the write was rejected
    expect(errorOccurred).toBe(true);

    // Verify card does NOT appear in UI
    await page.reload();
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    const cardExists = await page.locator('.card-item-title').filter({ hasText: 'AAAA' }).count();
    expect(cardExists).toBe(0);
  });

  test('should reject oversized description field (server-side validation)', async ({
    page,
    authEmulator,
  }) => {
    // Verifies server-side length validation for optional description field
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Attempt direct Firestore write with oversized description (>500 chars)
    const cardTitle = `Test Card ${Date.now()}-oversized-desc`;
    const oversizedDescription = 'B'.repeat(501);

    let errorOccurred = false;
    try {
      await page.evaluate(
        async ({ title, description }) => {
          const { db, auth } = await import('/src/scripts/firebase.js');
          const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
          const cardsCollection = collection(db, 'cards');

          await addDoc(cardsCollection, {
            title,
            type: 'Equipment',
            subtype: 'Weapon',
            description,
            isPublic: true,
            createdBy: auth.currentUser?.uid,
            createdAt: serverTimestamp(),
            lastModifiedAt: serverTimestamp(),
          });
        },
        { title: cardTitle, description: oversizedDescription }
      );
    } catch (error) {
      errorOccurred = true;
      console.log('Expected error for oversized description:', error.message);
    }

    // Verify the write was rejected
    expect(errorOccurred).toBe(true);
  });

  test('should reject card with isPublic: false (prevents lockout)', async ({
    page,
    authEmulator,
  }) => {
    // Verifies users cannot create unreadable cards by setting isPublic: false
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    const cardTitle = `Test Card ${Date.now()}-ispublic-false`;

    // Attempt to create card with isPublic: false
    let cardCreated = false;
    try {
      await page.evaluate(
        async ({ title }) => {
          const { db, auth } = await import('/src/scripts/firebase.js');
          const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
          const cardsCollection = collection(db, 'cards');

          await addDoc(cardsCollection, {
            title,
            type: 'Equipment',
            subtype: 'Weapon',
            isPublic: false, // Should make card unreadable
            createdBy: auth.currentUser?.uid,
            createdAt: serverTimestamp(),
            lastModifiedAt: serverTimestamp(),
          });
        },
        { title: cardTitle }
      );
      cardCreated = true;
    } catch (error) {
      console.log('Card creation with isPublic:false result:', error.message);
    }

    // Refresh page to check if card is visible
    await page.reload();
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Card should either be rejected OR created but unreadable
    const cardVisible = await page
      .locator('.card-item-title')
      .filter({ hasText: cardTitle })
      .count();

    if (cardCreated) {
      // Card was created - verify it's NOT visible (demonstrates the lockout bug)
      expect(cardVisible).toBe(0);
    } else {
      // Ideal case: card creation was rejected by security rules
      expect(cardVisible).toBe(0);
    }
  });

  test('should validate timestamp on UPDATE operations', async ({ page, authEmulator }) => {
    // Verifies lastModifiedAt timestamp forgery protection on updates
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create a card normally first
    const cardData = generateTestCardData('timestamp-forgery');
    await createCardViaUI(page, cardData);

    // OPTIMIZATION(#1805): Use real-time snapshot listener instead of fixed 2s wait (typically 50-500ms)
    const firestoreCard = await waitForCardInFirestore(cardData.title, 15000);
    expect(firestoreCard).toBeTruthy();

    // Attempt to update with forged lastModifiedAt timestamp
    const forgedTimestamp = new Date('2020-01-01');
    let errorOccurred = false;

    try {
      await page.evaluate(
        async ({ cardId, forgedTime }) => {
          const { db } = await import('/src/scripts/firebase.js');
          const { doc, updateDoc } = await import('firebase/firestore');

          const cardRef = doc(db, 'cards', cardId);
          await updateDoc(cardRef, {
            title: 'Updated Title',
            lastModifiedAt: new Date(forgedTime), // Forged timestamp
            lastModifiedBy: 'user-id',
          });
        },
        { cardId: firestoreCard.id, forgedTime: forgedTimestamp.toISOString() }
      );
    } catch (error) {
      errorOccurred = true;
      // Expected: permission-denied due to lastModifiedAt != request.time check
      console.log('Expected error for timestamp forgery:', error.message);
    }

    // Verify the update was rejected
    expect(errorOccurred).toBe(true);
  });
});

test.describe('Add Card - XSS Protection Tests', () => {
  test.skip(!isEmulatorMode, 'XSS tests only run against emulator');

  // TODO(#1326): Test flakiness - strict mode violation due to multiple matching cards from previous test runs
  test.skip('should escape XSS in custom type via Add New', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Try to inject XSS via custom type using "Add New" combobox feature
    const xssPayload = '<script>alert("XSS")</script>';
    await page.locator('#cardTitle').fill(`Test Card ${Date.now()}-xss-type`);
    await page.locator('#cardType').fill(xssPayload);
    await page.locator('#cardType').press('Enter'); // Select the "Add New" option
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#saveCardBtn').click();

    // Wait for save
    await page.waitForTimeout(2000);

    // Verify XSS was escaped in the DOM (should show as text, not execute)
    const cardItem = page.locator('.card-item').filter({ hasText: xssPayload });
    await expect(cardItem).toBeVisible();

    // Verify the literal text is present, not executed
    const typeElement = cardItem.locator('.card-item-type');
    const typeText = await typeElement.textContent();
    expect(typeText).toContain('<script>'); // Should be escaped and visible as text
  });

  // TODO: Test selector matching multiple elements - need stricter selector
  test.skip('should escape XSS in custom subtype via Add New', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Try to inject XSS via custom subtype using "Add New" combobox feature
    const xssPayload = '<img src=x onerror=alert("XSS")>';
    await page.locator('#cardTitle').fill(`Test Card ${Date.now()}-xss-subtype`);
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardSubtype').fill(xssPayload);
    await page.locator('#cardSubtype').press('Enter'); // Select the "Add New" option
    await page.locator('#saveCardBtn').click();

    // Wait for save
    await page.waitForTimeout(2000);

    // Verify XSS was escaped in the DOM (should show as text, not execute)
    const cardItem = page.locator('.card-item').filter({ hasText: xssPayload });
    await expect(cardItem).toBeVisible();

    // Verify the literal text is present, not executed
    const typeElement = cardItem.locator('.card-item-type');
    const typeText = await typeElement.textContent();
    expect(typeText).toContain('<img'); // Should be escaped and visible as text
  });
});

test.describe('Add Card - isSaving Flag Tests', () => {
  test.skip(!isEmulatorMode, 'isSaving tests only run against emulator');

  // TODO: Modal timing issue - closes before timeout simulation completes
  test.skip('should reset isSaving flag after timeout error', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Fill form
    const cardData = generateTestCardData('timeout-test');
    await page.locator('#cardTitle').fill(cardData.title);
    await page.locator('#cardType').fill(cardData.type);
    await page.locator('#cardSubtype').fill(cardData.subtype);

    // Inject timeout error
    await page.evaluate(() => {
      window.__originalCreateCard = window.createCard;
      window.createCard = async () => {
        throw new Error('timeout');
      };
    });

    // Try to save (should timeout)
    await page.locator('#saveCardBtn').click();

    // Wait for error to be handled
    await page.waitForTimeout(2000);

    // Verify save button is re-enabled (isSaving flag was reset)
    const saveBtn = page.locator('#saveCardBtn');
    await expect(saveBtn).not.toBeDisabled({ timeout: 1000 });

    // Verify modal is still open (user can retry)
    await expect(page.locator('#cardEditorModal.active')).toBeVisible();
  });
});

test.describe('Add Card - Security Rules Extended Tests', () => {
  test.skip(!isEmulatorMode, 'Security tests only run against emulator');

  // TODO: Missing window.__signOut helper function in test setup
  test.skip('should prevent non-owner from deleting card', async ({ page, authEmulator }) => {
    // User1 creates a card
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const user1Email = `user1-${Date.now()}@example.com`;
    await authEmulator.createTestUser(user1Email);
    await authEmulator.signInTestUser(user1Email);

    const cardData = generateTestCardData('owner-only-delete');
    await createCardViaUI(page, cardData);

    // OPTIMIZATION(#1805): Use real-time snapshot listener instead of fixed 2s wait (typically 50-500ms)
    const firestoreCard = await waitForCardInFirestore(cardData.title, 15000);
    expect(firestoreCard).toBeTruthy();

    // Sign out user1, sign in user2
    await page.evaluate(() => window.__signOut());
    await page.waitForTimeout(1000);

    const user2Email = `user2-${Date.now()}@example.com`;
    await authEmulator.createTestUser(user2Email);
    await authEmulator.signInTestUser(user2Email);

    // User2 attempts to delete user1's card via direct Firestore API
    let deleteErrorOccurred = false;
    try {
      await page.evaluate(
        async ({ cardId }) => {
          const { db } = await import('/src/scripts/firebase.js');
          const { doc, deleteDoc } = await import('firebase/firestore');
          const cardRef = doc(db, 'cards', cardId);
          await deleteDoc(cardRef);
        },
        { cardId: firestoreCard.id }
      );
    } catch (error) {
      deleteErrorOccurred = true;
      // Expected: permission-denied error
      console.log('Expected delete rejection:', error.message);
    }

    expect(deleteErrorOccurred).toBe(true);

    // Verify card still exists
    const cardAfterAttempt = await waitForCardInFirestore(cardData.title);
    expect(cardAfterAttempt).toBeTruthy();
  });

  // TODO: createdBy UID mismatch - user1.uid doesn't match stored createdBy
  test.skip('should allow collaborative edit with valid lastModifiedBy', async ({
    page,
    authEmulator,
  }) => {
    // User1 creates a card
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const user1Email = `user1-${Date.now()}@example.com`;
    const user1 = await authEmulator.createTestUser(user1Email);
    await authEmulator.signInTestUser(user1Email);

    const cardData = generateTestCardData('collab-edit');
    await createCardViaUI(page, cardData);

    // OPTIMIZATION(#1805): Use real-time snapshot listener instead of fixed 2s wait (typically 50-500ms)
    const firestoreCard = await waitForCardInFirestore(cardData.title, 15000);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.createdBy).toBe(user1.uid);

    // Sign out user1, sign in user2
    await page.evaluate(() => window.__signOut());
    await page.waitForTimeout(1000);

    const user2Email = `user2-${Date.now()}@example.com`;
    const user2 = await authEmulator.createTestUser(user2Email);
    await authEmulator.signInTestUser(user2Email);

    // User2 updates the card with lastModifiedBy set to their own UID
    let updateSucceeded = false;
    try {
      await page.evaluate(
        async ({ cardId, user2Uid }) => {
          const { db } = await import('/src/scripts/firebase.js');
          const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore');
          const cardRef = doc(db, 'cards', cardId);
          await updateDoc(cardRef, {
            description: 'Updated by user2',
            lastModifiedBy: user2Uid,
            lastModifiedAt: serverTimestamp(),
          });
        },
        { cardId: firestoreCard.id, user2Uid: user2.uid }
      );
      updateSucceeded = true;
    } catch (error) {
      console.log('Collaborative update failed:', error.message);
    }

    expect(updateSucceeded).toBe(true);

    // Verify lastModifiedBy is user2's UID
    const updatedCard = await waitForCardInFirestore(cardData.title);
    expect(updatedCard.lastModifiedBy).toBe(user2.uid);
  });

  // TODO: Missing window.__signOut helper function
  test.skip('should reject collaborative edit with forged lastModifiedBy', async ({
    page,
    authEmulator,
  }) => {
    // User1 creates a card
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const user1Email = `user1-${Date.now()}@example.com`;
    await authEmulator.createTestUser(user1Email);
    await authEmulator.signInTestUser(user1Email);

    const cardData = generateTestCardData('forged-modifier');
    await createCardViaUI(page, cardData);

    // OPTIMIZATION(#1805): Use real-time snapshot listener instead of fixed 2s wait (typically 50-500ms)
    const firestoreCard = await waitForCardInFirestore(cardData.title, 15000);
    expect(firestoreCard).toBeTruthy();

    // Sign out user1, sign in user2
    await page.evaluate(() => window.__signOut());
    await page.waitForTimeout(1000);

    const user2Email = `user2-${Date.now()}@example.com`;
    await authEmulator.createTestUser(user2Email);
    await authEmulator.signInTestUser(user2Email);

    // Create a user3 to impersonate
    const user3Email = `user3-${Date.now()}@example.com`;
    const user3 = await authEmulator.createTestUser(user3Email);

    // User2 attempts to update with lastModifiedBy forged to user3's UID
    let forgeAttemptFailed = false;
    try {
      await page.evaluate(
        async ({ cardId, forgedUid }) => {
          const { db } = await import('/src/scripts/firebase.js');
          const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore');
          const cardRef = doc(db, 'cards', cardId);
          await updateDoc(cardRef, {
            description: 'Updated with forged identity',
            lastModifiedBy: forgedUid, // Forged to user3's UID
            lastModifiedAt: serverTimestamp(),
          });
        },
        { cardId: firestoreCard.id, forgedUid: user3.uid }
      );
    } catch (error) {
      forgeAttemptFailed = true;
      console.log('Expected forged update rejection:', error.message);
    }

    // Security rules should reject the forged lastModifiedBy
    expect(forgeAttemptFailed).toBe(true);
  });

  test('should set isPublic: true by default on card creation', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    const cardData = generateTestCardData('ispublic-default');
    await createCardViaUI(page, cardData);

    // OPTIMIZATION(#1805): Use real-time snapshot listener instead of fixed 2s wait (typically 50-500ms)
    const firestoreCard = await waitForCardInFirestore(cardData.title, 15000);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.isPublic).toBe(true);

    // Verify card is visible in UI (read rule allows it)
    const cardVisible = await page
      .locator('.card-item-title')
      .filter({ hasText: cardData.title })
      .isVisible();
    expect(cardVisible).toBe(true);
  });
});

test.describe('Add Card - Collection Pattern Tests', () => {
  test.skip(!isEmulatorMode, 'Collection pattern tests only run against emulator');

  // TODO: Firestore composite index not available in emulator
  test.skip('should query cards using composite index (isPublic + title)', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create multiple cards with different titles
    const cardA = generateTestCardData('composite-A');
    const cardB = generateTestCardData('composite-B');

    await createCardViaUI(page, cardA);
    await page.waitForTimeout(1000);
    // Need to spread since generateTestCardData now returns frozen object
    await createCardViaUI(page, { ...cardB, title: `Test Card ${Date.now()}-composite-B` });

    await page.waitForTimeout(2000);

    // Query using the composite index pattern (isPublic + title sort)
    const querySucceeded = await page.evaluate(async () => {
      try {
        const { db } = await import('/src/scripts/firebase.js');
        const { collection, query, where, orderBy, getDocs } = await import('firebase/firestore');
        const cardsCollection = collection(db, 'cards');

        // This query requires the composite index: isPublic (ASC) + title (ASC)
        const q = query(cardsCollection, where('isPublic', '==', true), orderBy('title', 'asc'));
        const snapshot = await getDocs(q);
        return { success: true, count: snapshot.size };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // If composite index is missing, query will fail with "index not found" error
    expect(querySucceeded.success).toBe(true);
    expect(querySucceeded.count).toBeGreaterThanOrEqual(2);
  });
});

test.describe('Add Card - Security & Edge Cases (batch-3)', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test.afterEach(async () => {
    const { deleteTestCards } = await import('./test-helpers.js');
    const deletedCount = await deleteTestCards(/^Test Card \d+/);
    console.log(`Cleaned up ${deletedCount} test cards`);
  });

  test('should prevent double-submit via rapid Enter key presses', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Wait for auth state to propagate
    await page.waitForTimeout(2000);

    // Open modal and fill form
    const cardData = generateTestCardData('enter-spam');
    await page.locator('#addCardBtn').click();
    await page.locator('#cardTitle').fill(cardData.title);
    await page.locator('#cardType').fill(cardData.type);
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill(cardData.subtype);
    await page.locator('#cardSubtype').press('Escape');

    // Focus Save button and spam Enter key
    await page.locator('#saveCardBtn').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    // Wait for modal to close
    await expect(page.locator('#cardEditorModal.active')).not.toBeVisible({ timeout: 10000 });

    // Wait for Firestore write
    await page.waitForTimeout(2000);

    // Verify only ONE card was created in Firestore
    const firestoreCard = await waitForCardInFirestore(cardData.title);
    expect(firestoreCard).toBeTruthy();

    // Query Firestore to count cards with this title
    const { getFirestoreAdmin } = await import('./test-helpers.js');
    const { db } = await getFirestoreAdmin();
    const { getCardsCollectionName } = await import('../../scripts/lib/collection-names.js');
    const snapshot = await db
      .collection(getCardsCollectionName())
      .where('title', '==', cardData.title)
      .get();

    expect(snapshot.size).toBe(1); // Should have exactly 1 card, not 3
  });

  test('should prevent XSS via custom type with malicious script', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.waitForTimeout(2000);

    // Open modal
    await page.locator('#addCardBtn').click();

    // Create card with XSS payload in custom type
    const xssPayload = '<img src=x onerror="window.xssTriggered=true">';
    const uniqueId = Date.now();
    await page.locator('#cardTitle').fill(`XSS Test ${uniqueId}`);
    await page.locator('#cardType').fill(xssPayload); // Custom type via "Add New"
    await page.locator('#cardType').press('Enter'); // Select the "Add New" option
    await page.locator('#cardSubtype').fill('SafeSubtype');
    await page.locator('#cardSubtype').press('Escape');
    await page.locator('#saveCardBtn').click();

    // Wait for card to appear
    await page.waitForTimeout(3000);

    // Verify XSS was NOT executed
    const xssTriggered = await page.evaluate(() => window.xssTriggered);
    expect(xssTriggered).toBeUndefined(); // Script should not have run

    // Verify the payload appears as escaped text in the UI
    const cardItem = page.locator('.card-item').filter({ hasText: String(uniqueId) });
    await expect(cardItem).toBeVisible();
    const cardHtml = await cardItem.innerHTML();
    // Should contain escaped HTML entities, not actual <img> tag
    expect(cardHtml).toMatch(/&lt;|&amp;/);

    // Verify no <img> element was created in the card item
    const imgElements = await cardItem.locator('img').count();
    expect(imgElements).toBe(0);
  });

  // TODO(#1382): Test timing issue - save button not visible on retry after permission-denied
  test.skip('should reset isSaving flag after Firestore permission-denied error', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.waitForTimeout(2000);

    // Inject Firestore error to simulate permission-denied
    await page.evaluate(() => {
      // Store original function
      const originalModule = window.__testFirebaseModule;
      if (originalModule && originalModule.createCard) {
        window.__originalCreateCard = originalModule.createCard;

        // Replace with error-throwing version
        originalModule.createCard = () => {
          const error = new Error('Missing or insufficient permissions');
          error.code = 'permission-denied';
          return Promise.reject(error);
        };

        // Restore original after first call
        setTimeout(() => {
          if (window.__originalCreateCard) {
            originalModule.createCard = window.__originalCreateCard;
          }
        }, 100);
      }
    });

    // Try to create card (will fail with permission-denied)
    const cardData = generateTestCardData('permission-test');
    await page.locator('#addCardBtn').click();
    await page.locator('#cardTitle').fill(cardData.title);
    await page.locator('#cardType').fill(cardData.type);
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill(cardData.subtype);
    await page.locator('#cardSubtype').press('Escape');
    await page.locator('#saveCardBtn').click();

    // Wait for error message to appear
    await page.waitForTimeout(2000);

    // CRITICAL: Verify Save button is re-enabled (isSaving flag was reset)
    const saveBtn = page.locator('#saveCardBtn');
    await expect(saveBtn).toBeEnabled({ timeout: 3000 });

    // Verify user can retry saving (original function restored)
    await saveBtn.click();

    // This time it should work
    await expect(page.locator('#cardEditorModal.active')).not.toBeVisible({ timeout: 10000 });
  });

  // TODO(#1250): Combobox error handling not implemented - missing .combobox-error-message element
  test.skip('should show error state when combobox getOptions() throws exception', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.waitForTimeout(2000);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active');

    // Inject error into state to cause getOptions to throw
    await page.evaluate(() => {
      // Corrupt state.cards to cause getTypesFromCards to throw
      if (window.__cardState) {
        window.__cardState.cards = {
          filter: () => {
            throw new Error('Simulated getOptions error');
          },
        };
      }
    });

    // Try to open type combobox (will trigger getOptions error)
    await page.locator('#cardType').focus();
    await page.waitForTimeout(1000);

    // Verify error message is shown in listbox
    const errorMessage = page.locator('#typeListbox .combobox-error-message');
    await expect(errorMessage).toBeVisible();
    const errorText = await errorMessage.textContent();
    expect(errorText).toContain('Unable to load options');

    // Verify input is disabled
    const typeInput = page.locator('#cardType');
    await expect(typeInput).toBeDisabled();
    const placeholder = await typeInput.getAttribute('placeholder');
    expect(placeholder).toContain('unavailable');

    // Verify combobox is marked as broken
    const combobox = page.locator('#typeCombobox');
    const isBroken = await combobox.getAttribute('data-broken');
    expect(isBroken).toBe('true');
  });

  test('should filter out empty tag segments from comma-separated list', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.waitForTimeout(2000);

    const cardData = {
      title: `Test Card ${Date.now()}-empty-tags`,
      type: 'Equipment',
      subtype: 'Weapon',
      tags: 'tag1, , , tag2, , tag3', // Empty segments between commas
    };

    await createCardViaUI(page, cardData);

    // OPTIMIZATION(#1805): Use real-time snapshot listener instead of fixed 3s wait (typically 50-500ms)
    const firestoreCard = await waitForCardInFirestore(cardData.title, 15000);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.tags).toEqual(['tag1', 'tag2', 'tag3']); // Empty strings filtered out
  });
});

// TODO(#1356): Replace fixed timeouts with condition-based waiting
// Many tests use page.waitForTimeout() with hardcoded values (2000ms, 3000ms, etc.)
// Replace with condition-based waiting for better reliability and faster test execution

// TODO(#480): Add 2 more critical tests from all-hands review:
//   1. Auth state restoration retry logic (lines 69-81, 871-887 in cards.js)
//   2. Combobox error state on getOptions() exception (already has partial coverage)
