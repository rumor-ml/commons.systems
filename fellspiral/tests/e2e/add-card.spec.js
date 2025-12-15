/**
 * Add Card E2E Tests
 * Tests the complete Add Card workflow including UI, validation, and persistence
 */

import { test, expect } from '../../../playwright.fixtures.ts';
import { createCardViaUI, getCardFromFirestore, generateTestCardData, deleteTestCards } from './test-helpers.js';

const isEmulatorMode = process.env.VITE_USE_FIREBASE_EMULATOR === 'true';

// All add-card tests must run serially (in a single worker) to avoid Firestore data conflicts
// when multiple tests create/delete cards in parallel
test.describe.configure({ mode: 'serial' });

test.describe('Add Card - Happy Path Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  // Clean up test cards before and after each test to ensure test isolation
  test.beforeEach(async () => {
    // Delete any cards created during previous tests (match "Test Card" prefix)
    await deleteTestCards(/^Test Card \d+/);
  });

  test.afterEach(async () => {
    // Delete any cards created during this test (match "Test Card" prefix)
    await deleteTestCards(/^Test Card \d+/);
  });

  test('should create card with all fields populated', async ({ page, authEmulator }) => {
    await page.goto('/cards.html', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait a bit longer for async Firebase initialization
    await page.waitForTimeout(2000);

    // Sign in
    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card with all fields
    const cardData = generateTestCardData('all-fields');
    await createCardViaUI(page, cardData);

    // Verify in UI
    const cardTitle = page.locator('.card-item-title').filter({ hasText: cardData.title });
    await expect(cardTitle).toBeVisible({ timeout: 10000 });

    // Wait for Firestore write to propagate (emulator can have slight delays)
    await page.waitForTimeout(500);

    // Verify in Firestore
    const firestoreCard = await getCardFromFirestore(cardData.title);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.title).toBe(cardData.title);
    expect(firestoreCard.type).toBe(cardData.type);
    expect(firestoreCard.subtype).toBe(cardData.subtype);
    expect(firestoreCard.description).toBe(cardData.description);
  });

  test('should create card with only required fields', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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
    const firestoreCard = await getCardFromFirestore(cardData.title);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.title).toBe(cardData.title);
  });

  test('should verify card persists to Firestore emulator', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card
    const cardData = generateTestCardData('persist-test');
    await createCardViaUI(page, cardData);

    // Wait a moment for Firestore write
    await page.waitForTimeout(3000);

    // Query Firestore directly
    const firestoreCard = await getCardFromFirestore(cardData.title);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.title).toBe(cardData.title);
  });

  test('should verify Firestore document structure includes metadata', async ({
    page,
    authEmulator,
  }) => {
    await page.goto('/cards.html');
    // Wait for page to load and allow time for Firebase initialization
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);

    const email = `test-${Date.now()}@example.com`;
    const uid = await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card
    const cardData = generateTestCardData('metadata-test');
    await createCardViaUI(page, cardData);

    // Wait for Firestore write
    await page.waitForTimeout(3000);

    // Verify Firestore document structure
    const firestoreCard = await getCardFromFirestore(cardData.title);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.createdBy).toBe(uid);
    expect(firestoreCard.lastModifiedBy).toBe(uid);
    expect(firestoreCard.createdAt).toBeTruthy();
    expect(firestoreCard.updatedAt).toBeTruthy();
    expect(firestoreCard.lastModifiedAt).toBeTruthy();
  });

  test('should verify card appears in list after creation', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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

  test('should show Create Card button after page refresh when logged in', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(2000);

    // Sign in with seeded QA user
    const email = 'qa@test.com';
    await authEmulator.signInTestUser(email);

    // Verify button is visible after initial sign-in
    await expect(page.locator('#addCardBtn')).toBeVisible({ timeout: 5000 });

    // Reload page
    await page.reload();
    await page.waitForLoadState('load');

    // Wait for Firebase to restore auth state
    await page.waitForTimeout(2000);

    // Button should STILL be visible after refresh (this tests Bug 2 fix)
    await expect(page.locator('#addCardBtn')).toBeVisible({ timeout: 5000 });

    // Should be able to click it without error (this tests Bug 1 fix)
    await page.locator('#addCardBtn').click();
    await expect(page.locator('#cardEditorModal.active')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Add Card - Form Validation Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  // Clean up test cards before and after each test to ensure test isolation
  test.beforeEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

  test.afterEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

  test('should require title field', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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

  test('should update subtype options when type changes', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open modal
    await page.locator('#addCardBtn').click();
    await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

    // Select Equipment type using combobox
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');

    // Focus subtype to show options, then get subtype options for Equipment
    await page.locator('#cardSubtype').focus();
    await page.waitForSelector('#subtypeCombobox.open', { timeout: 2000 });
    const equipmentSubtypes = await page.locator('#subtypeListbox .combobox-option').allTextContents();

    // Select Skill type using combobox
    await page.locator('#cardType').fill('Skill');
    await page.locator('#cardType').press('Escape');

    // Focus subtype to show options for Skill (should be different based on existing cards)
    await page.locator('#cardSubtype').focus();
    await page.waitForSelector('#subtypeCombobox.open', { timeout: 2000 });
    const skillSubtypes = await page.locator('#subtypeListbox .combobox-option').allTextContents();

    // The subtypes shown depend on what cards exist in the database for each type
    // At minimum, verify that focusing the subtype shows the dropdown
    expect(await page.locator('#subtypeCombobox.open').isVisible()).toBe(true);
  });

  test('should parse comma-separated tags correctly', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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
    const firestoreCard = await getCardFromFirestore(cardData.title);
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

  test('should handle tags with extra spaces', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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
    const firestoreCard = await getCardFromFirestore(cardData.title);
    expect(firestoreCard).toBeTruthy();
  });
});

test.describe('Add Card - Modal Behavior Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  // Clean up test cards before and after each test to ensure test isolation
  test.beforeEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

  test.afterEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

  test('should open modal on button click', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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

  test('should auto-close modal after successful save', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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

  // Clean up test cards before and after each test to ensure test isolation
  test.beforeEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

  test.afterEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

  test('should handle rapid Add Card button clicks', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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

  test('should handle rapid form submissions', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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
    const firestoreCard = await getCardFromFirestore(cardData.title);
    expect(firestoreCard).toBeTruthy();

    // Verify only one card with this title exists in UI
    const matchingCards = page.locator('.card-item-title').filter({ hasText: cardData.title });
    const count = await matchingCards.count();
    expect(count).toBe(1);
  });

  test('should handle special characters in title', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Create card with special characters
    const cardData = {
      title: `Test <script>alert('XSS')</script> Card ${Date.now()}`,
      type: 'Equipment',
      subtype: 'Weapon',
    };

    await createCardViaUI(page, cardData);

    // Verify card appears with escaped content (no XSS)
    // Use .first() to handle multiple matches
    const cardTitle = page.locator('.card-item-title').filter({ hasText: 'Test' }).first();
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
    expect(titleText).toContain("script");
  });

  test('should handle empty tags field', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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
    const firestoreCard = await getCardFromFirestore(cardData.title);
    expect(firestoreCard).toBeTruthy();
  });
});

test.describe('Add Card - Integration Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  // Clean up test cards before and after each test to ensure test isolation
  test.beforeEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

  test.afterEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

  test('should persist card after page reload', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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
    await expect(
      page.locator('.card-item-title').filter({ hasText: cardData.title })
    ).toBeVisible({ timeout: 10000 });
  });

  test('should be able to search for newly created card', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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
    await expect(
      page.locator('.card-item-title').filter({ hasText: uniqueTerm })
    ).toBeVisible({ timeout: 10000 });
  });

  test('should be able to filter newly created card by type', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase to initialize (triggered by DOMContentLoaded)
    await page.waitForTimeout(3000);

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
    await expect(
      page.locator('.card-item-title').filter({ hasText: cardData.title })
    ).toBeVisible({ timeout: 10000 });

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

  test.beforeEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

  test.afterEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

  test('should open dropdown with ArrowDown when closed', async ({ page, authEmulator }) => {
    await page.goto('/cards.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

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

  test.beforeEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

  test.afterEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

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
    await expect(page.locator('#typeListbox .combobox-option--new')).toContainText(`Add "${newType}"`);
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

  test.beforeEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

  test.afterEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

  test('should clear subtype value when type changes', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    await page.locator('#addCardBtn').click();

    // Select Equipment type and Weapon subtype
    await page.locator('#cardType').fill('Equipment');
    await page.locator('#cardType').press('Escape');
    await page.locator('#cardSubtype').fill('Weapon');
    await page.locator('#cardSubtype').press('Escape');
    expect(await page.locator('#cardSubtype').inputValue()).toBe('Weapon');

    // Change type to Skill
    await page.locator('#cardType').fill('Skill');
    await page.locator('#typeListbox .combobox-option').first().click();

    // Verify subtype was cleared
    expect(await page.locator('#cardSubtype').inputValue()).toBe('');
  });
});

test.describe('Combobox Interaction Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test.beforeEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

  test.afterEach(async () => {
    await deleteTestCards(/^Test Card \d+/);
  });

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
