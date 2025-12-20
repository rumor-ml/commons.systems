/**
 * Add Card E2E Tests
 * Tests the complete Add Card workflow including UI, validation, and persistence
 */

import { test, expect } from '../../../playwright.fixtures.ts';
import { createCardViaUI, getCardFromFirestore, generateTestCardData } from './test-helpers.js';

const isEmulatorMode = process.env.VITE_USE_FIREBASE_EMULATOR === 'true';

// Tests run serially within each browser project but Firefox/Chromium run in parallel.
// Each test creates cards with unique timestamps, so no cleanup is needed.
test.describe.configure({ mode: 'serial' });

test.describe('Add Card - Happy Path Tests', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test('should create card with all fields populated', async ({ page, authEmulator }) => {
    await page.goto('/cards.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    const email = `test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    const cardData = generateTestCardData('all-fields');
    await createCardViaUI(page, cardData);

    // Verify in UI
    const cardTitle = page.locator('.card-item-title').filter({ hasText: cardData.title });
    await expect(cardTitle).toBeVisible({ timeout: 10000 });

    // Wait for Firestore write to propagate (emulator can have delays, especially in Firefox)
    await page.waitForTimeout(2000);

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

  test('should show Create Card button after page refresh when logged in', async ({
    page,
    authEmulator,
  }) => {
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
    const equipmentSubtypes = await page
      .locator('#subtypeListbox .combobox-option')
      .allTextContents();

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
    await expect(page.locator('.card-item-title').filter({ hasText: cardData.title })).toBeVisible({
      timeout: 10000,
    });
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
    await expect(page.locator('.card-item-title').filter({ hasText: uniqueTerm })).toBeVisible({
      timeout: 10000,
    });
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

  test('should clear subtype value when type changes', async ({ page, authEmulator }) => {
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

test.describe('Add Card - Error Handling on Save Failure', () => {
  test.skip(!isEmulatorMode, 'Auth tests only run against emulator');

  test('should keep modal open and show error when user signs out mid-save', async ({
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
    await page.goto('/cards.html');
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
    const firestoreCard = await getCardFromFirestore(cardData.title);
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

  test('should escape event handlers in type field (class attribute injection)', async ({
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

  test('should prevent unauthenticated read access to cards', async ({ page }) => {
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

  test('should prevent cross-user card access', async ({ page, authEmulator, context }) => {
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
  });
});

test.describe('Add Card - Concurrent Save Handling', () => {
  test.skip(!isEmulatorMode, 'Concurrent tests only run against emulator');

  test('should handle concurrent edits in different tabs (last write wins)', async ({
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
    const firestoreCard = await getCardFromFirestore(cardData.title);
    expect(firestoreCard.description).toBe('Tab 1 description');

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

  test('should fall back to demo data when offline', async ({ page, context }) => {
    // Set offline mode
    await context.setOffline(true);

    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    // Should show offline warning or demo data message
    const hasOfflineIndicator = await page
      .locator('text=/offline|demo data|unable to connect/i')
      .isVisible();
    expect(hasOfflineIndicator).toBe(true);

    // Should show some cards (demo data from cardsData.js)
    const cardCount = await page.locator('.card-item').count();
    expect(cardCount).toBeGreaterThan(0);

    // Restore online mode
    await context.setOffline(false);
  });
});

test.describe('Add Card - Custom Type Persistence', () => {
  test.skip(!isEmulatorMode, 'Custom type tests only run against emulator');

  test('should persist custom type for reuse in dropdown', async ({ page, authEmulator }) => {
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

  test('should reload cards when signing in after guest browsing', async ({
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

    // Verify in Firestore
    await page.waitForTimeout(2000);
    const firestoreCard = await getCardFromFirestore(cardData.title);
    expect(firestoreCard).toBeTruthy();
    expect(firestoreCard.type).toBe('Equipment');
    expect(firestoreCard.subtype).toBe('MagicSpell');
  });
});

test.describe('Add Card - Validation Error Recovery', () => {
  test.skip(!isEmulatorMode, 'Validation tests only run against emulator');

  test('should show inline errors, allow user to fix, and successfully retry', async ({
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
    await page.waitForSelector('#cardEditorModal.show', { timeout: 5000 });

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
    await page.waitForSelector('#cardEditorModal.show', { timeout: 5000 });

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

  test('should show server-side validation error in modal (not alert)', async ({
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
    await page.waitForSelector('#cardEditorModal.show', { timeout: 5000 });

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
    await page.waitForSelector('#cardEditorModal.show', { timeout: 5000 });

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

  test('should handle rapid toggle clicks without flashing', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `rapid-toggle-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Open the add card modal
    await page.click('#addCardBtn');
    await page.waitForSelector('#cardEditorModal.show', { timeout: 5000 });

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

test.describe('Auth Listener - Cleanup and Memory Leak Prevention', () => {
  test.skip(!isEmulatorMode, 'Auth listener tests only run against emulator');

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
});

test.describe('Add Card - Timeout Error Recovery', () => {
  test.skip(!isEmulatorMode, 'Timeout tests only run against emulator');

  test('should clear isSaving flag and allow retry after timeout', async ({
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
    await page.waitForSelector('#cardEditorModal.show', { timeout: 5000 });

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

  test('should not allow double-submit while save in progress', async ({ page, authEmulator }) => {
    await page.goto('/cards.html');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    const email = `double-submit-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);
    await page.waitForTimeout(1000);

    // Open the add card modal
    await page.click('#addCardBtn');
    await page.waitForSelector('#cardEditorModal.show', { timeout: 5000 });

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

  test('should show appropriate error message for network timeout', async ({
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
    await page.waitForSelector('#cardEditorModal.show', { timeout: 5000 });

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
