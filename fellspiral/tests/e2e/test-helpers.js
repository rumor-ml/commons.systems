/**
 * Test Helper Constants and Utilities
 */

// Standard viewport sizes for responsive testing
export const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 },
  desktopLarge: { width: 1920, height: 1080 },
};

/**
 * Setup mobile viewport
 * @param {import('@playwright/test').Page} page
 */
export async function setupMobileViewport(page) {
  await page.setViewportSize(VIEWPORTS.mobile);
}

/**
 * Setup tablet viewport
 * @param {import('@playwright/test').Page} page
 */
export async function setupTabletViewport(page) {
  await page.setViewportSize(VIEWPORTS.tablet);
}

/**
 * Setup desktop viewport
 * @param {import('@playwright/test').Page} page
 */
export async function setupDesktopViewport(page) {
  await page.setViewportSize(VIEWPORTS.desktop);
}

/**
 * Generate unique test card data
 * @param {string} suffix - Optional suffix to add to title for uniqueness
 * @returns {{
 *   title: string, type: string, subtype: string,
 *   tags: string, description: string,
 *   stat1: string, stat2: string, cost: string
 * }} Card data object
 */
export function generateTestCardData(suffix = '') {
  const timestamp = Date.now();
  const uniqueSuffix = suffix ? `-${suffix}` : '';

  return {
    title: `Test Card ${timestamp}${uniqueSuffix}`,
    type: 'Equipment',
    subtype: 'Weapon',
    tags: 'test, automation, e2e',
    description: 'This is a test card created by automated tests',
    stat1: 'd8',
    stat2: '2 slot',
    cost: '5 pt',
  };
}

/**
 * Wait for Firebase to initialize after page load
 * Firebase initialization happens asynchronously on DOMContentLoaded, so tests
 * need to wait for it to complete before interacting with auth-dependent features
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {number} timeout - Timeout in milliseconds (default: 5000)
 */
export async function waitForFirebaseInit(page, timeout = 5000) {
  // Wait for window.__testAuth to be available (set by authEmulator fixture)
  // This indicates Firebase Auth has been initialized and connected to emulator
  await page
    .waitForFunction(() => window.__testAuth != null, { timeout })
    .catch(async (error) => {
      // Enhanced error with init state snapshot for debugging
      const initState = await page.evaluate(() => ({
        testAuthExists: window.__testAuth != null,
        firebaseAppExists: typeof window.firebase !== 'undefined',
      }));
      throw new Error(`Firebase not initialized after ${timeout}ms: ${JSON.stringify(initState)}`);
    });
}

/**
 * Select a combobox option by value using JavaScript evaluation
 * This avoids Firefox's NS_ERROR_DOM_BAD_URI with CSS attribute selectors
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} listboxId - ID of the listbox element (e.g., 'typeListbox')
 * @param {string} targetValue - Value to select from the combobox
 * @returns {Promise<boolean>} True if option was found and clicked, false otherwise
 */
async function selectComboboxOption(page, listboxId, targetValue) {
  const optionFound = await page.evaluate(
    ({ listboxId, targetValue }) => {
      const listbox = document.getElementById(listboxId);
      if (!listbox) return false;

      // Find option by matching dataset.value
      const options = Array.from(listbox.querySelectorAll('.combobox-option'));
      const matchingOption = options.find((opt) => opt.dataset.value === targetValue);

      if (matchingOption) {
        // Dispatch mousedown event (combobox uses mousedown listeners)
        const event = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        matchingOption.dispatchEvent(event);
        return true;
      }

      return false;
    },
    { listboxId, targetValue }
  );

  return optionFound;
}

/**
 * Create a card through the UI
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Object} cardData - Card data to fill in the form
 */
export async function createCardViaUI(page, cardData) {
  // Click Add Card button
  await page.locator('#addCardBtn').click();

  // Wait for modal to open
  await page.waitForSelector('#cardEditorModal.active', { timeout: 5000 });

  // Wait for form elements to be fully ready (not just attached, but visible and enabled)
  await page.waitForSelector('#cardType', { state: 'visible', timeout: 5000 });
  await page.waitForTimeout(100); // Small delay to ensure form initialization completes

  // Fill form fields
  await page.locator('#cardTitle').fill(cardData.title);

  // Set type using combobox (fill input and select from dropdown or accept custom value)
  await page.locator('#cardType').fill(cardData.type);
  // Dispatch input event to trigger filtering
  await page.locator('#cardType').dispatchEvent('input');
  // Small delay for dropdown to render options
  await page.waitForTimeout(50);

  // Try to select matching option using JavaScript evaluation (Firefox-safe)
  const typeSelected = await selectComboboxOption(page, 'typeListbox', cardData.type);

  if (!typeSelected) {
    // No matching option found - close dropdown and accept custom value
    await page.locator('#cardType').press('Escape');
  }

  // Wait for subtype combobox to be ready after type change
  await page.waitForTimeout(100);

  // Set subtype using combobox (fill input and select from dropdown or accept custom value)
  await page.locator('#cardSubtype').fill(cardData.subtype);
  // Dispatch input event to trigger filtering
  await page.locator('#cardSubtype').dispatchEvent('input');
  // Small delay for dropdown to render options
  await page.waitForTimeout(50);

  // Try to select matching option using JavaScript evaluation (Firefox-safe)
  const subtypeSelected = await selectComboboxOption(page, 'subtypeListbox', cardData.subtype);

  if (!subtypeSelected) {
    // No matching option found - close dropdown and accept custom value
    await page.locator('#cardSubtype').press('Escape');
  }

  if (cardData.tags) {
    await page.locator('#cardTags').fill(cardData.tags);
  }

  if (cardData.description) {
    await page.locator('#cardDescription').fill(cardData.description);
  }

  if (cardData.stat1) {
    await page.locator('#cardStat1').fill(cardData.stat1);
  }

  if (cardData.stat2) {
    await page.locator('#cardStat2').fill(cardData.stat2);
  }

  if (cardData.cost) {
    await page.locator('#cardCost').fill(cardData.cost);
  }

  // Wait for auth.currentUser to be populated (critical for Firestore writes)
  // window.__testAuth is set by authEmulator fixture and used by firebase.js's getAuthInstance()
  // IMPORTANT: Use != null (not !==) to check for both null AND undefined
  await page
    .waitForFunction(
      () => {
        const auth = window.__testAuth;
        return auth != null && auth.currentUser != null;
      },
      { timeout: 5000 }
    )
    .catch(async (error) => {
      // Enhanced error with auth state snapshot for debugging
      const authState = await page.evaluate(() => ({
        authExists: !!window.__testAuth,
        currentUser: !!window.__testAuth?.currentUser,
        currentUserUid: window.__testAuth?.currentUser?.uid,
      }));
      throw new Error(`Auth not ready after 5s: ${JSON.stringify(authState)}`);
    });

  // Submit form
  await page.locator('#saveCardBtn').click();

  // Wait for modal to close (modal loses .active class and becomes hidden)
  // Increased timeout to 10000ms to allow for slow Firestore writes in emulator
  await page.waitForSelector('#cardEditorModal.active', { state: 'hidden', timeout: 10000 });

  // Wait for card to appear in UI by checking for the specific card title in the DOM
  // This replaces the fixed 2-second timeout with condition-based waiting
  try {
    await page.waitForFunction(
      (title) => {
        const cardItems = document.querySelectorAll('.card-item');
        return Array.from(cardItems).some(
          (item) => item.textContent && item.textContent.includes(title)
        );
      },
      cardData.title,
      { timeout: 5000 }
    );
  } catch (error) {
    // If card doesn't appear, log warning but don't fail
    // Some tests may not need to verify card appearance immediately
    console.warn(
      `Card "${cardData.title}" did not appear in UI after 5s - may need explicit verification in test`
    );
  }
}

// Shared Firebase Admin instance for Firestore operations
let _adminApp = null;
let _firestoreDb = null;

/**
 * Get or initialize Firebase Admin SDK and Firestore connection
 * Reuses the same instance across multiple calls to avoid settings() errors
 */
async function getFirestoreAdmin() {
  if (_adminApp && _firestoreDb) {
    return { app: _adminApp, db: _firestoreDb };
  }

  // Dynamic import to avoid loading firebase-admin in browser context
  const adminModule = await import('firebase-admin');
  const admin = adminModule.default;

  // Get or initialize Firebase Admin
  if (!admin.apps.length) {
    _adminApp = admin.initializeApp({
      projectId: 'demo-test',
    });
  } else {
    _adminApp = admin.app();
  }

  // Connect to Firestore emulator (only call settings once)
  _firestoreDb = admin.firestore(_adminApp);

  // Only configure settings if not already configured
  if (!_firestoreDb._settingsConfigured) {
    const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:11980';
    const [host, port] = firestoreHost.split(':');

    _firestoreDb.settings({
      host: `${host}:${port}`,
      ssl: false,
    });

    // Mark as configured to prevent duplicate calls
    _firestoreDb._settingsConfigured = true;
  }

  return { app: _adminApp, db: _firestoreDb };
}

/**
 * Query Firestore emulator directly to get a card by title
 * Includes retry logic to handle emulator write propagation delays (especially in Firefox)
 * @param {string} cardTitle - Title of the card to find
 * @param {number} maxRetries - Maximum number of retries (default: 5)
 * @param {number} initialDelayMs - Initial delay between retries in ms (default: 500, higher for Firefox compatibility)
 * @returns {Promise<Object|null>} Card document with id and data, or null if not found after retries
 */
export async function getCardFromFirestore(cardTitle, maxRetries = 5, initialDelayMs = 500) {
  // Import collection name helper
  const { getCardsCollectionName } = await import('../../scripts/lib/collection-names.js');

  // Get or initialize Firestore Admin (reuses same instance)
  const { db } = await getFirestoreAdmin();

  const collectionName = getCardsCollectionName();
  const cardsCollection = db.collection(collectionName);

  // Retry with exponential backoff
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const snapshot = await cardsCollection.where('title', '==', cardTitle).get();

    if (!snapshot.empty) {
      // Found the card!
      const doc = snapshot.docs[0];
      return {
        id: doc.id,
        ...doc.data(),
      };
    }

    // If this was the last attempt, return null
    if (attempt === maxRetries) {
      return null;
    }

    // Wait before retrying (exponential backoff)
    const delayMs = initialDelayMs * Math.pow(2, attempt);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return null;
}

/**
 * Delete test cards from Firestore emulator by title pattern
 * @param {RegExp|string} titlePattern - Pattern to match card titles (regex or string prefix)
 * @returns {Promise<number>} Number of cards deleted
 */
export async function deleteTestCards(titlePattern) {
  // Import collection name helper
  const { getCardsCollectionName } = await import('../../scripts/lib/collection-names.js');

  // Get or initialize Firestore Admin (reuses same instance)
  const { db } = await getFirestoreAdmin();

  // Query all cards
  const collectionName = getCardsCollectionName();
  const cardsCollection = db.collection(collectionName);
  const snapshot = await cardsCollection.get();

  // Filter cards by title pattern
  const docsToDelete = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    const title = data.title || '';

    // Use ternary for cleaner pattern matching
    const matches =
      titlePattern instanceof RegExp ? titlePattern.test(title) : title.startsWith(titlePattern);

    if (matches) {
      docsToDelete.push(doc.ref);
    }
  });

  // Batch delete matching cards
  if (docsToDelete.length > 0) {
    const batch = db.batch();
    docsToDelete.forEach((docRef) => {
      batch.delete(docRef);
    });
    await batch.commit();
  }

  return docsToDelete.length;
}
