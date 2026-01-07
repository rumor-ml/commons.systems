/**
 * Card Visibility Auth Tests
 * Tests visibility of public and private cards based on authentication state
 * Regression tests for #244: Ensure cards don't disappear after sign-in
 */

import { test, expect } from '../../../playwright.fixtures.ts';
import { createCardInFirestore, waitForCardCount, isCardVisibleInUI } from './test-helpers.js';

// Only run against emulator (requires auth state changes)
const isEmulatorMode = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

test.describe('Card Visibility - Unauthenticated Users', () => {
  test.skip(!isEmulatorMode, 'Card visibility tests only run against emulator');

  test('should only see public cards when not authenticated', async ({ page }) => {
    // Create test data: 1 public card, 1 private card
    const publicCard = {
      title: `Public Card ${Date.now()}`,
      type: 'Equipment',
      subtype: 'Weapon',
      isPublic: true,
      createdBy: 'other-user-uid',
      description: 'This is a public card',
    };

    const privateCard = {
      title: `Private Card ${Date.now()}`,
      type: 'MagicSpell',
      subtype: 'Offensive',
      isPublic: false,
      createdBy: 'other-user-uid',
      description: 'This is a private card',
    };

    await createCardInFirestore(publicCard);
    await createCardInFirestore(privateCard);

    // Navigate to cards page as guest
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize
    await page.waitForFunction(() => window.auth != null, { timeout: 10000 });

    // Wait for cards to load
    await page.waitForTimeout(3000);

    // Verify only public card is visible
    const isPublicVisible = await isCardVisibleInUI(page, publicCard.title);
    const isPrivateVisible = await isCardVisibleInUI(page, privateCard.title);

    expect(isPublicVisible).toBe(true);
    expect(isPrivateVisible).toBe(false);
  });

  test('should see demo data when Firestore is empty and not authenticated', async ({ page }) => {
    // Navigate to cards page as guest (Firestore might be empty or have other user's cards)
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize
    await page.waitForFunction(() => window.auth != null, { timeout: 10000 });

    // Wait for cards to load
    await page.waitForTimeout(3000);

    // Should see cards (either from Firestore or demo data)
    const cardCount = await page.locator('.card-item').count();
    expect(cardCount).toBeGreaterThan(0);
  });
});

test.describe('Card Visibility - Authenticated Users', () => {
  test.skip(!isEmulatorMode, 'Card visibility tests only run against emulator');

  test('should see both public and own private cards when authenticated', async ({
    page,
    authEmulator,
  }) => {
    // Navigate to cards page first (required for auth initialization)
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize
    await page.waitForFunction(() => window.auth != null, { timeout: 10000 });

    // Create test user
    const email = `visibility-test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Get the user's UID from the page context
    const userUid = await page.evaluate(() => {
      return window.__testAuth?.currentUser?.uid;
    });

    if (!userUid) {
      throw new Error('Failed to get user UID from authenticated session');
    }

    // Create test cards
    const publicCard = {
      title: `Public Card ${Date.now()}`,
      type: 'Equipment',
      subtype: 'Weapon',
      isPublic: true,
      createdBy: 'other-user-uid',
      description: 'Public card by another user',
    };

    const ownPrivateCard = {
      title: `My Private Card ${Date.now()}`,
      type: 'MagicSpell',
      subtype: 'Offensive',
      isPublic: false,
      createdBy: userUid, // Owned by current user
      description: 'Private card owned by me',
    };

    const otherPrivateCard = {
      title: `Other Private Card ${Date.now()}`,
      type: 'Blessing',
      subtype: 'Utility',
      isPublic: false,
      createdBy: 'other-user-uid', // Not owned by current user
      description: 'Private card by another user',
    };

    await createCardInFirestore(publicCard);
    await createCardInFirestore(ownPrivateCard);
    await createCardInFirestore(otherPrivateCard);

    // Navigate to cards page
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize
    await page.waitForFunction(() => window.auth != null, { timeout: 10000 });

    // Wait for cards to load
    await page.waitForTimeout(3000);

    // Verify visibility
    const isPublicVisible = await isCardVisibleInUI(page, publicCard.title);
    const isOwnPrivateVisible = await isCardVisibleInUI(page, ownPrivateCard.title);
    const isOtherPrivateVisible = await isCardVisibleInUI(page, otherPrivateCard.title);

    expect(isPublicVisible).toBe(true);
    expect(isOwnPrivateVisible).toBe(true);
    expect(isOtherPrivateVisible).toBe(false); // Should NOT see other users' private cards
  });

  test('should show empty state when authenticated user has no cards in Firestore', async ({
    page,
    authEmulator,
  }) => {
    // Navigate to cards page first (required for auth initialization)
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize
    await page.waitForFunction(() => window.auth != null, { timeout: 10000 });

    // Create and sign in test user
    const email = `empty-state-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Wait for cards to load
    await page.waitForTimeout(3000);

    // Should show empty state (not demo data)
    const cardCount = await page.locator('.card-item').count();
    expect(cardCount).toBe(0);

    // Should have authenticated controls visible
    const addCardBtn = page.locator('#addCardBtn');
    await expect(addCardBtn).toBeVisible();
  });
});

test.describe('Card Visibility - Auth State Changes (Regression for #244)', () => {
  test.skip(!isEmulatorMode, 'Auth state change tests only run against emulator');

  test('CRITICAL: cards should persist and remain visible after signing in (fix #244)', async ({
    page,
    authEmulator,
  }) => {
    // Create public cards that guest user can see
    const publicCard1 = {
      title: `Public Card 1 ${Date.now()}`,
      type: 'Equipment',
      subtype: 'Weapon',
      isPublic: true,
      createdBy: 'other-user-uid',
      description: 'First public card',
    };

    const publicCard2 = {
      title: `Public Card 2 ${Date.now()}`,
      type: 'MagicSpell',
      subtype: 'Offensive',
      isPublic: true,
      createdBy: 'other-user-uid',
      description: 'Second public card',
    };

    await createCardInFirestore(publicCard1);
    await createCardInFirestore(publicCard2);

    // Step 1: Visit as guest and verify cards are visible
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize
    await page.waitForFunction(() => window.auth != null, { timeout: 10000 });

    // Wait for cards to load
    await page.waitForTimeout(3000);

    const guestCardCount = await page.locator('.card-item').count();
    expect(guestCardCount).toBeGreaterThanOrEqual(2); // At least our 2 public cards

    const isCard1VisibleAsGuest = await isCardVisibleInUI(page, publicCard1.title);
    const isCard2VisibleAsGuest = await isCardVisibleInUI(page, publicCard2.title);
    expect(isCard1VisibleAsGuest).toBe(true);
    expect(isCard2VisibleAsGuest).toBe(true);

    // Step 2: Sign in
    const email = `persist-test-${Date.now()}@example.com`;
    await authEmulator.createTestUser(email);
    await authEmulator.signInTestUser(email);

    // Wait for auth state to propagate and cards to reload
    await page.waitForTimeout(2000);

    // Step 3: CRITICAL - Verify cards are STILL visible after sign-in
    const authenticatedCardCount = await page.locator('.card-item').count();

    // This is the regression test for #244:
    // Cards should NOT disappear after sign-in (count should not drop to zero)
    expect(authenticatedCardCount).toBeGreaterThanOrEqual(2);

    const isCard1VisibleAfterAuth = await isCardVisibleInUI(page, publicCard1.title);
    const isCard2VisibleAfterAuth = await isCardVisibleInUI(page, publicCard2.title);

    expect(isCard1VisibleAfterAuth).toBe(true);
    expect(isCard2VisibleAfterAuth).toBe(true);

    // Verify authenticated state
    const addCardBtn = page.locator('#addCardBtn');
    await expect(addCardBtn).toBeVisible();
  });

  test('cards should update correctly when switching between users', async ({
    page,
    authEmulator,
  }) => {
    // Navigate to cards page first (required for auth initialization)
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for Firebase auth to initialize
    await page.waitForFunction(() => window.auth != null, { timeout: 10000 });

    // Create two users
    const user1Email = `user1-${Date.now()}@example.com`;
    const user2Email = `user2-${Date.now()}@example.com`;
    await authEmulator.createTestUser(user1Email);
    await authEmulator.createTestUser(user2Email);

    // Sign in as user1
    await authEmulator.signInTestUser(user1Email);

    const user1Uid = await page.evaluate(() => {
      return window.__testAuth?.currentUser?.uid;
    });

    // Sign out
    await authEmulator.signOutTestUser();
    await page.waitForTimeout(1000);

    // Sign in as user2
    await authEmulator.signInTestUser(user2Email);

    const user2Uid = await page.evaluate(() => {
      return window.__testAuth?.currentUser?.uid;
    });

    if (!user1Uid || !user2Uid) {
      throw new Error('Failed to get user UIDs');
    }

    // Create private cards for each user
    const user1PrivateCard = {
      title: `User1 Private ${Date.now()}`,
      type: 'Equipment',
      subtype: 'Weapon',
      isPublic: false,
      createdBy: user1Uid,
      description: 'User 1 private card',
    };

    const user2PrivateCard = {
      title: `User2 Private ${Date.now()}`,
      type: 'MagicSpell',
      subtype: 'Offensive',
      isPublic: false,
      createdBy: user2Uid,
      description: 'User 2 private card',
    };

    const publicCard = {
      title: `Public Shared ${Date.now()}`,
      type: 'Blessing',
      subtype: 'Utility',
      isPublic: true,
      createdBy: user1Uid,
      description: 'Public card visible to all',
    };

    await createCardInFirestore(user1PrivateCard);
    await createCardInFirestore(user2PrivateCard);
    await createCardInFirestore(publicCard);

    // Currently signed in as user2 - reload page to see user2's cards
    await page.goto('/cards.html');
    await page.waitForLoadState('load');

    // Wait for cards to load
    await page.waitForTimeout(3000);

    // User2 should see: their private card + public card (NOT user1's private card)
    const isUser2PrivateVisible = await isCardVisibleInUI(page, user2PrivateCard.title);
    const isPublicVisible = await isCardVisibleInUI(page, publicCard.title);
    const isUser1PrivateVisible = await isCardVisibleInUI(page, user1PrivateCard.title);

    expect(isUser2PrivateVisible).toBe(true);
    expect(isPublicVisible).toBe(true);
    expect(isUser1PrivateVisible).toBe(false); // Should NOT see user1's private card

    // Sign out and sign in as user1
    await authEmulator.signOutTestUser();
    await page.waitForTimeout(1000);
    await authEmulator.signInTestUser(user1Email);
    await page.waitForTimeout(2000);

    // Reload page to trigger card reload
    await page.reload();
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    // User1 should now see: their private card + public card (NOT user2's private card)
    const isUser1PrivateVisibleNow = await isCardVisibleInUI(page, user1PrivateCard.title);
    const isPublicVisibleNow = await isCardVisibleInUI(page, publicCard.title);
    const isUser2PrivateVisibleNow = await isCardVisibleInUI(page, user2PrivateCard.title);

    expect(isUser1PrivateVisibleNow).toBe(true);
    expect(isPublicVisibleNow).toBe(true);
    expect(isUser2PrivateVisibleNow).toBe(false); // Should NOT see user2's private card
  });
});
