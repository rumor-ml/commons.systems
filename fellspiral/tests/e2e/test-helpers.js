/**
 * Test Helper Constants and Utilities
 */

// Standard viewport sizes for responsive testing
// TODO(#491): Add test coverage for E2E test helper error paths
// TODO(#490): Add comprehensive error handling to E2E test helpers
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
 * Get the Firestore collection name for test cards
 * This returns the same collection name that createCardInFirestore uses,
 * so tests can pass it via URL parameter to the frontend for consistency.
 * @returns {Promise<string>} Collection name (e.g., "cards-worker-0")
 */
export async function getTestCollectionName() {
  const { getCardsCollectionName } = await import('../../scripts/lib/collection-names.js');
  return getCardsCollectionName();
}

/**
 * Generate unique test card data
 * Returns a shallowly frozen object to prevent accidental mutation of top-level properties.
 * Note: nested properties (arrays, objects) are not frozen and can still be mutated.
 * @param {string} suffix - Optional suffix to add to title for uniqueness
 * @returns {Readonly<{
 *   title: string, type: string, subtype: string,
 *   tags: string, description: string,
 *   stat1: string, stat2: string, cost: string
 * }>} Immutable card data object
 */
export function generateTestCardData(suffix = '') {
  const timestamp = Date.now();
  const uniqueSuffix = suffix ? `-${suffix}` : '';

  return Object.freeze({
    title: `Test Card ${timestamp}${uniqueSuffix}`,
    type: 'Equipment',
    subtype: 'Weapon',
    tags: 'test, automation, e2e',
    description: 'This is a test card created by automated tests',
    stat1: 'd8',
    stat2: '2 slot',
    cost: '5 pt',
  });
}

/**
 * Wait for app initialization after page load
 * INFRASTRUCTURE STABILITY FIX: Use event-driven wait instead of hard-coded timeout
 * App initialization (including Firebase) happens asynchronously on DOMContentLoaded,
 * so tests need to wait for it to complete before interacting with auth-dependent features.
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {number} timeout - Maximum timeout in milliseconds (default: 10000)
 */
export async function waitForAppInit(page, timeout = 10000) {
  // Wait for Firebase auth to be initialized
  await page.waitForFunction(() => window.auth != null, { timeout });
}

/**
 * Select a combobox option by value using JavaScript evaluation
 * This avoids Firefox's NS_ERROR_DOM_BAD_URI error that occurs when using
 * CSS attribute selectors with special characters in the value (e.g.,
 * [data-value="Weapon"] where "Weapon" contains characters Firefox doesn't
 * like in attribute selector contexts). Using page.evaluate() bypasses CSS
 * selectors entirely by directly accessing the DOM.
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
 * Fill a combobox field and try to select matching option
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} inputId - ID of the combobox input element
 * @param {string} listboxId - ID of the listbox element
 * @param {string} value - Value to fill and select
 * @returns {Promise<boolean>} True if option was selected, false if value was typed but option not found
 */
async function fillCombobox(page, inputId, listboxId, value) {
  await page.locator(`#${inputId}`).fill(value);
  await page.locator(`#${inputId}`).dispatchEvent('input');

  // INFRASTRUCTURE STABILITY FIX: Use event-driven wait for listbox visibility
  // Wait for listbox to appear after input event (combobox shows dropdown on input)
  await page.waitForSelector(`#${listboxId}`, { state: 'visible', timeout: 1000 }).catch(() => {
    // Listbox may not appear if no matching options - this is acceptable
  });

  const selected = await selectComboboxOption(page, listboxId, value);
  if (!selected) {
    // Option not found in dropdown - close it but keep the typed value
    // This allows custom values via the "Add New" feature
    await page.locator(`#${inputId}`).press('Escape');
  }
  return selected;
}

/**
 * Fill an optional form field if value is provided
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} id - Element ID
 * @param {string} value - Value to fill (skipped if falsy)
 */
async function fillOptionalField(page, id, value) {
  if (value) {
    await page.locator(`#${id}`).fill(value);
  }
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

  // INFRASTRUCTURE STABILITY FIX: Wait for form initialization signal instead of timeout
  // The form dispatches 'cardeditor:ready' event when initialization completes
  await page
    .waitForFunction(
      () => {
        const form = document.getElementById('cardForm');
        return form && !form.classList.contains('initializing');
      },
      { timeout: 2000 }
    )
    .catch(() => {
      // Form may not have 'initializing' class - fallback to basic visibility check
    });

  // Fill required fields
  await page.locator('#cardTitle').fill(cardData.title);

  // Fill type combobox
  await fillCombobox(page, 'cardType', 'typeListbox', cardData.type);

  // INFRASTRUCTURE STABILITY FIX: Wait for subtype options to load after type change
  // The subtype field updates based on selected type
  await page.waitForFunction(
    () => {
      const subtypeInput = document.getElementById('cardSubtype');
      return subtypeInput && !subtypeInput.disabled;
    },
    { timeout: 2000 }
  );

  // Fill subtype combobox
  await fillCombobox(page, 'cardSubtype', 'subtypeListbox', cardData.subtype);

  // Fill optional fields
  await fillOptionalField(page, 'cardTags', cardData.tags);
  await fillOptionalField(page, 'cardDescription', cardData.description);
  await fillOptionalField(page, 'cardStat1', cardData.stat1);
  await fillOptionalField(page, 'cardStat2', cardData.stat2);
  await fillOptionalField(page, 'cardCost', cardData.cost);

  // Wait for auth.currentUser to be populated (critical for Firestore writes)
  // window.__testAuth is set by the auth emulator setup and contains the Firebase Auth instance.
  // Tests must wait for auth.currentUser to be populated before performing Firestore writes.
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

  // Ensure save button is enabled before clicking
  const saveBtn = page.locator('#saveCardBtn');
  await saveBtn.waitFor({ state: 'visible', timeout: 5000 });

  // Wait for button to be enabled (not disabled)
  await page.waitForFunction(
    () => {
      const btn = document.getElementById('saveCardBtn');
      return btn && !btn.disabled;
    },
    { timeout: 5000 }
  );

  // Submit form
  await saveBtn.click();

  // Wait for modal to close (modal loses .active class and becomes hidden)
  // Timeout set to 5s (typical: 100-500ms) - fails fast when something is wrong
  await page
    .waitForSelector('#cardEditorModal.active', { state: 'hidden', timeout: 5000 })
    .catch(async (originalError) => {
      // Capture diagnostic state when modal doesn't close
      const modalState = await page.evaluate(() => {
        const modal = document.getElementById('cardEditorModal');
        const errorBanner = modal?.querySelector('.error-banner');
        const validationErrors = Array.from(
          modal?.querySelectorAll('.has-error .error-message') || []
        ).map((el) => el.textContent);

        return {
          modalActive: modal?.classList.contains('active'),
          formFields: {
            title: document.getElementById('cardTitle')?.value,
            type: document.getElementById('cardType')?.value,
            subtype: document.getElementById('cardSubtype')?.value,
          },
          hasErrorBanner: !!errorBanner,
          errorBannerText: errorBanner?.textContent?.trim(),
          validationErrors,
          saveButtonDisabled: document.getElementById('saveCardBtn')?.disabled,
        };
      });

      // Create enhanced error with clear message and diagnostic data as property
      const enhancedError = new Error(
        `Modal did not close after clicking save (timeout: 16s). Check error.diagnostics for details.`
      );

      // Attach diagnostic data as structured property (not in message)
      enhancedError.diagnostics = modalState;
      enhancedError.cause = originalError;
      enhancedError.name = 'ModalCloseTimeoutError';

      // Preserve original stack trace
      if (originalError.stack) {
        enhancedError.stack = originalError.stack;
      }

      // Log diagnostic state separately for debugging
      console.error('[Test] Modal close timeout diagnostics:', modalState);

      throw enhancedError;
    });

  // Wait for card to appear in UI list using DOM condition wait (faster and more reliable than fixed timeout)
  // The card list updates via Firestore real-time listeners, so we wait for the specific card title to appear
  await page
    .locator('.card-item')
    .filter({ hasText: cardData.title })
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .catch(async (error) => {
      // If card doesn't appear, provide debug info
      const cardCount = await page.locator('.card-item').count();
      const emptyState = await page.locator('#emptyState').isVisible();
      throw new Error(
        `Card "${cardData.title}" not visible in UI after 5s. ` +
          `Card count: ${cardCount}, Empty state: ${emptyState}. ` +
          `Original error: ${error.message}`
      );
    });
}

// Shared Firebase Admin instance for Firestore operations
// TODO(#1334): Consider using simpler initialization promise pattern
let _adminApp = null;
let _firestoreDb = null;

/**
 * Get or initialize Firebase Admin SDK and Firestore connection
 * Reuses the same instance across multiple calls to avoid settings() errors
 */
export async function getFirestoreAdmin() {
  if (_adminApp && _firestoreDb) {
    return { app: _adminApp, db: _firestoreDb };
  }

  // Dynamic import to avoid loading firebase-admin in browser context
  const adminModule = await import('firebase-admin');
  const admin = adminModule.default;

  // Get or initialize Firebase Admin
  if (!admin.apps.length) {
    _adminApp = admin.initializeApp({
      projectId: process.env.GCP_PROJECT_ID || 'demo-test',
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
 * Wait for a card to appear in Firestore using real-time snapshot listeners
 * This is faster and more reliable than polling with exponential backoff.
 * Uses Firestore's onSnapshot to get notified immediately when the card is written.
 * @param {string} cardTitle - Title of the card to find
 * @param {number} timeout - Maximum wait time in ms (default: 10000)
 * @returns {Promise<Object>} Card document with id and data
 * @throws {Error} If card not found within timeout
 */
export async function waitForCardInFirestore(cardTitle, timeout = 10000) {
  // TODO(#1336): Consider caching dynamic import pattern at module level
  // Import collection name helper
  const { getCardsCollectionName } = await import('../../scripts/lib/collection-names.js');

  // Get or initialize Firestore Admin (reuses same instance)
  const { db } = await getFirestoreAdmin();

  const collectionName = getCardsCollectionName();

  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Card "${cardTitle}" not found in Firestore after ${timeout}ms`));
    }, timeout);

    const unsubscribe = db
      .collection(collectionName)
      .where('title', '==', cardTitle)
      .onSnapshot(
        (snapshot) => {
          if (!snapshot.empty) {
            clearTimeout(timeoutHandle);
            unsubscribe();
            const doc = snapshot.docs[0];
            resolve({ id: doc.id, ...doc.data() });
          }
        },
        (error) => {
          clearTimeout(timeoutHandle);
          unsubscribe();
          reject(error);
        }
      );
  });
}

/**
 * Query Firestore emulator directly to get a card by title
 * Includes retry logic to handle emulator write propagation delays.
 * Empirically measured: Firefox requires higher retry delays than Chromium (500ms vs 200ms baseline).
 * @deprecated Use waitForCardInFirestore() instead for better performance with snapshot listeners
 * @param {string} cardTitle - Title of the card to find
 * @param {number} maxRetries - Maximum number of retries (default: 5)
 * @param {number} initialDelayMs - Initial delay between retries in ms (default: 500, higher for Firefox compatibility)
 * @returns {Promise<Object|null>} Card document with id and data, or null if not found after retries
 */
// TODO(#311): Replace all uses of getCardFromFirestore() with waitForCardInFirestore() and remove this deprecated function
export async function getCardFromFirestore(cardTitle, maxRetries = 5, initialDelayMs = 500) {
  // Import collection name helper
  const { getCardsCollectionName } = await import('../../scripts/lib/collection-names.js');

  // Get or initialize Firestore Admin (reuses same instance)
  const { db } = await getFirestoreAdmin();

  const collectionName = getCardsCollectionName();
  const cardsCollection = db.collection(collectionName);

  // Retry with exponential backoff (includes initial attempt)
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const snapshot = await cardsCollection.where('title', '==', cardTitle).get();

    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      return { id: doc.id, ...doc.data() };
    }

    // Wait before retrying (skip delay on final attempt)
    if (attempt < maxRetries) {
      const delayMs = initialDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
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
  const docsToDelete = snapshot.docs
    .filter((doc) => {
      const title = doc.data().title || '';
      return titlePattern instanceof RegExp
        ? titlePattern.test(title)
        : title.startsWith(titlePattern);
    })
    .map((doc) => doc.ref);

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

/**
 * Create a card directly in Firestore using Admin SDK
 * Used to seed test data for card visibility tests
 * @param {Object} cardData - Card data to insert
 * @param {string} cardData.title - Card title (required)
 * @param {string} cardData.type - Card type (required)
 * @param {string} cardData.subtype - Card subtype (required)
 * @param {boolean} cardData.isPublic - Public visibility flag (required)
 * @param {string} cardData.createdBy - User UID who owns the card (required)
 * @param {string} [cardData.description] - Card description (optional)
 * @returns {Promise<string>} Document ID of created card
 */
export async function createCardInFirestore(cardData) {
  // Import Node.js version of collection name helper (handles TEST_PARALLEL_INDEX env var)
  const { getCardsCollectionName } = await import('../../scripts/lib/collection-names.js');

  // Get or initialize Firestore Admin (reuses same instance)
  const { db } = await getFirestoreAdmin();
  const adminModule = await import('firebase-admin');
  const admin = adminModule.default;

  // Validate required fields
  if (!cardData.title || !cardData.type || !cardData.subtype) {
    throw new Error('Card must have title, type, and subtype');
  }
  if (typeof cardData.isPublic !== 'boolean') {
    throw new Error('Card must have isPublic boolean field');
  }
  if (!cardData.createdBy) {
    throw new Error('Card must have createdBy field');
  }

  // Create card document with timestamps
  const collectionName = getCardsCollectionName();
  const cardsCollection = db.collection(collectionName);

  const cardDoc = {
    title: cardData.title,
    type: cardData.type,
    subtype: cardData.subtype,
    isPublic: cardData.isPublic,
    createdBy: cardData.createdBy,
    description: cardData.description || '',
    tags: cardData.tags || '',
    stat1: cardData.stat1 || '',
    stat2: cardData.stat2 || '',
    cost: cardData.cost || '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const docRef = await cardsCollection.add(cardDoc);
  return docRef.id;
}

/**
 * Wait for a specific card count to appear in the UI
 * INFRASTRUCTURE STABILITY FIX: Use Playwright's built-in polling with waitForFunction
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {number} expectedCount - Expected number of cards
 * @param {number} timeout - Maximum wait time in ms (default: 10000)
 * @returns {Promise<void>}
 * @throws {Error} If expected count not reached within timeout
 */
export async function waitForCardCount(page, expectedCount, timeout = 10000) {
  try {
    await page.waitForFunction(
      (expected) => {
        const cards = document.querySelectorAll('.card-item');
        return cards.length === expected;
      },
      expectedCount,
      { timeout, polling: 200 }
    );
  } catch (error) {
    const finalCount = await page.locator('.card-item').count();
    throw new Error(
      `Timeout waiting for ${expectedCount} cards. Current count: ${finalCount} after ${timeout}ms`
    );
  }
}

/**
 * Check if a card with the given title is visible in the UI
 * Searches for .card-item elements containing the title text
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} cardTitle - Title of the card to find
 * @returns {Promise<boolean>} True if card is visible, false otherwise
 */
export async function isCardVisibleInUI(page, cardTitle) {
  try {
    // Look for card title in any .card-item element
    // Cards display title in an h3.card-title element
    const cardLocator = page.locator('.card-item').filter({ hasText: cardTitle });
    const count = await cardLocator.count();
    return count > 0;
  } catch (error) {
    // If locator fails, card is not visible
    return false;
  }
}

/**
 * Wait for library nav to include specific card types
 * Waits for each specified type to appear in the library navigation tree
 * Provides helpful error messages showing which types are actually available
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string[]} types - Card types to wait for (e.g., ['Skill', 'Origin'])
 * @param {number} timeout - Max wait time in ms (default: 15000)
 * @returns {Promise<void>}
 * @throws {Error} If any type not visible within timeout, with list of available types
 */
export async function waitForLibraryNavTypes(page, types, timeout = 15000) {
  const startTime = Date.now();

  for (const type of types) {
    const selector = `.library-nav-type[data-type="${type}"]`;
    const remainingTime = timeout - (Date.now() - startTime);

    if (remainingTime <= 0) {
      const availableTypes = await getVisibleLibraryNavTypes(page);
      throw new Error(
        `Timeout waiting for library nav types. ` +
          `Expected: ${types.join(', ')} | ` +
          `Available: ${availableTypes.join(', ') || 'none'} | ` +
          `Timeout: ${timeout}ms`
      );
    }

    try {
      await page.waitForSelector(selector, {
        timeout: remainingTime,
        state: 'visible',
      });
    } catch (error) {
      const availableTypes = await getVisibleLibraryNavTypes(page);
      throw new Error(
        `Library nav did not show type "${type}" within ${timeout}ms. ` +
          `Available types: ${availableTypes.join(', ') || 'none'}`
      );
    }
  }
}

/**
 * Get list of visible card types in library navigation
 * Helper function to show what types are actually rendered
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {Promise<string[]>} Array of visible type names
 */
async function getVisibleLibraryNavTypes(page) {
  try {
    const typeElements = await page.locator('.library-nav-type').all();
    const types = [];

    for (const element of typeElements) {
      const dataType = await element.getAttribute('data-type');
      if (dataType) {
        types.push(dataType);
      }
    }

    return types;
  } catch (error) {
    // If locator fails, no types are visible
    return [];
  }
}
