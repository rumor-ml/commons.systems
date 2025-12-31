/**
 * Test Helper Constants and Utilities
 */

// Playwright expect - imported once at module level for use in assertion helpers
import { expect as playwrightExpect } from '@playwright/test';

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Viewport size configuration
 * @typedef {Object} ViewportSize
 * @property {number} width - Viewport width in pixels
 * @property {number} height - Viewport height in pixels
 */

/**
 * Standard viewport sizes for responsive testing
 * @typedef {Object} ViewportSizes
 * @property {Readonly<ViewportSize>} mobile - Mobile viewport (iPhone 8: 375x667)
 * @property {Readonly<ViewportSize>} tablet - Tablet viewport (iPad portrait: 768x1024)
 * @property {Readonly<ViewportSize>} desktop - Desktop viewport (1280x720)
 * @property {Readonly<ViewportSize>} desktopLarge - Large desktop viewport (1920x1080)
 */

/**
 * Test card data structure
 * @typedef {Object} CardData
 * @property {string} title - Unique card title with timestamp and counter
 * @property {string} type - Card type (e.g., "Equipment")
 * @property {string} subtype - Card subtype (e.g., "Weapon")
 * @property {string} tags - Comma-separated tags
 * @property {string} description - Card description
 * @property {string} stat1 - First stat value
 * @property {string} stat2 - Second stat value
 * @property {string} cost - Card cost value
 */

/**
 * Console message capture controller
 * @typedef {Object} CaptureController
 * @property {() => string[]} getMessages - Get defensive copy of captured messages
 * @property {() => void} startCapture - Begin capturing console messages (must not already be capturing)
 * @property {() => void} stopCapture - Stop capturing and remove listener (must be capturing)
 */

/**
 * Firebase Admin app instance
 * @typedef {import('firebase-admin').app.App} FirebaseApp
 */

/**
 * Firestore database instance
 * @typedef {import('firebase-admin').firestore.Firestore} FirestoreDatabase
 */

/**
 * Firebase Admin and Firestore instances (singleton)
 * @typedef {Object} FirestoreAdminInstance
 * @property {FirebaseApp} app - Firebase Admin app instance
 * @property {FirestoreDatabase} db - Firestore database instance (pre-configured for emulator)
 */

/**
 * Result of deleteTestCards operation
 * @typedef {Object} DeleteResult
 * @property {number} deleted - Count of successfully deleted documents
 */

// =============================================================================
// Timing Constants
// =============================================================================

// Timing constants for UI interactions - ensure DOM updates complete before test assertions.
// Values determined through testing across browsers (Chrome, Firefox, Safari) to find minimum
// delays that prevent flaky failures while maintaining test speed. Increase if tests become
// flaky on slower systems; decrease if testing infrastructure improves.

// Modal animation and form hydration delay - allows modal CSS transitions to complete
// and combobox dropdown options to be properly initialized before interaction
const MODAL_ANIMATION_DELAY_MS = 100;

// Combobox dropdown rendering delay after input event - waits for filtered options
// to render in the DOM after typing triggers the input event
const DROPDOWN_RENDER_DELAY_MS = 50;

// Subtype combobox update delay after type selection - the subtype options are
// dynamically filtered based on selected type, requires DOM update to complete
const SUBTYPE_UPDATE_DELAY_MS = 100;

// =============================================================================
// Firestore Error Helpers
// =============================================================================

/**
 * Handle common Firestore error codes by throwing actionable error messages
 * @param {Error & {code?: string}} error - Error from Firestore operation
 * @throws {Error} Always throws with actionable message for known error codes
 */
function handleFirestoreErrorCode(error) {
  if (error.code === 'unavailable') {
    throw new Error(
      `Firestore emulator unavailable: ${error.message}. ` +
        `Check that emulator is running at ${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:11980'}.`
    );
  }
  if (error.code === 'permission-denied') {
    throw new Error(
      `Firestore permission denied: ${error.message}. ` +
        `Check Firestore security rules in emulator.`
    );
  }
  throw error;
}

/**
 * Wrap errors with context, re-throwing errors that already have detailed Firestore messages
 * @param {Error} error - Error to wrap
 * @param {string} context - Context string for error message (e.g., 'getCardFromFirestore')
 * @throws {Error} Always throws - either the original error or a wrapped version
 */
function wrapFirestoreError(error, context) {
  if (
    error instanceof Error &&
    (error.message.includes('Firestore') || error.message.includes('Failed to'))
  ) {
    throw error;
  }
  throw new Error(`${context} failed: ${error.message}`, { cause: error });
}

// =============================================================================
// Viewport Configuration
// =============================================================================

// TODO(#491): Add test coverage for E2E test helper error paths
// TODO(#490): Add comprehensive error handling to E2E test helpers

/**
 * Standard viewport sizes for responsive testing.
 * All viewports are frozen to prevent accidental mutations that could affect test consistency.
 * Mobile: iPhone 8, Tablet: iPad portrait, Desktop: Common 16:9 resolutions
 * @type {Readonly<ViewportSizes>}
 */
export const VIEWPORTS = Object.freeze({
  mobile: Object.freeze({ width: 375, height: 667 }),
  tablet: Object.freeze({ width: 768, height: 1024 }),
  desktop: Object.freeze({ width: 1280, height: 720 }),
  desktopLarge: Object.freeze({ width: 1920, height: 1080 }),
});

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

// TODO(#1043): Module-level _cardCounter lacks encapsulation and reset mechanism for test isolation
// Counter for ensuring unique card titles even when created in same millisecond
let _cardCounter = 0;

/**
 * Generate unique test card data with timestamp and counter-based title.
 * Guaranteed unique even when creating multiple cards rapidly within the same millisecond.
 *
 * **Note**: The returned object is frozen (immutable) to prevent accidental
 * modifications that could affect other tests. Create a new object if you need
 * to modify the data: `{ ...generateTestCardData(), title: 'Custom' }`
 *
 * @param {string} suffix - Optional suffix to add to title for additional uniqueness
 * @returns {Readonly<CardData>} Frozen card data object
 */
export function generateTestCardData(suffix = '') {
  const timestamp = Date.now();
  const uniqueSuffix = suffix ? `-${suffix}` : '';

  return Object.freeze({
    title: `Test Card ${timestamp}-${_cardCounter++}${uniqueSuffix}`,
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
      throw new Error(
        `Firebase not initialized after ${timeout}ms: ${JSON.stringify(initState)}. ` +
          `Check that authEmulator fixture is properly configured and Firebase scripts loaded.`,
        { cause: error }
      );
    });
}

/**
 * Capture console messages by type during a test operation
 *
 * **Message Accumulation**: Messages are stored in an internal array and accessed
 * via getMessages() which returns a defensive copy. The internal array accumulates
 * messages while the listener is active.
 *
 * **Listener Cleanup**: Always call `stopCapture()` when done to prevent memory
 * leaks. The listener persists until explicitly removed. State guards prevent
 * incorrect usage (e.g., calling startCapture twice without stopCapture).
 *
 * **Concurrent Usage**: Not thread-safe. Each capture controller maintains its own
 * message array, but listeners are independent. Be cautious when using multiple
 * controllers on the same page simultaneously.
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} messageType - Type of console messages to capture ('error', 'warning', 'log', etc.)
 * @returns {CaptureController} Capture controller with start/stop lifecycle
 */
export function captureConsoleMessages(page, messageType = 'error') {
  const messages = [];
  let _isCapturing = false;

  const listener = (msg) => {
    if (msg.type() === messageType) {
      messages.push(msg.text());
    }
  };

  return {
    // TODO(#1051): Add test verifying shallow copy behavior prevents external mutations
    // Return shallow copy of messages array (prevents caller from modifying internal array,
    // but message objects themselves could be mutated if they were non-primitives)
    getMessages: () => [...messages],
    startCapture: () => {
      if (_isCapturing) {
        throw new Error('captureConsoleMessages: already capturing, call stopCapture() first');
      }
      _isCapturing = true;
      page.on('console', listener);
    },
    stopCapture: () => {
      if (!_isCapturing) {
        throw new Error('captureConsoleMessages: not capturing, call startCapture() first');
      }
      _isCapturing = false;
      page.off('console', listener);
    },
  };
}

// TODO(#1035): Consider using Playwright's waitForEvent('console') with predicate filter for more reliable, event-driven testing instead of timeout-based approach
/**
 * Wait for console messages matching a pattern.
 * Uses single setTimeout for both listener cleanup and result resolution to avoid
 * race conditions where the timeout fires while the listener is still processing
 * a message, potentially missing late-arriving matches.
 *
 * Note: If the predicate throws an error, it will bubble up within the listener
 * and stop further message processing, but the promise may remain pending.
 * Ensure predicates handle their own exceptions if fault tolerance is needed.
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {(msg: string) => boolean} predicate - Function to test console messages
 * @param {number} timeout - Timeout in milliseconds (default: 2000)
 * @returns {Promise<boolean>} True if matching message found within timeout
 */
export async function waitForConsoleMessage(page, predicate, timeout = 2000) {
  const messages = [];

  return new Promise((resolve) => {
    const listener = (msg) => {
      const text = msg.text();
      messages.push(text);
      if (predicate(text)) {
        clearTimeout(timeoutId);
        page.off('console', listener);
        resolve(true);
      }
    };

    // Set up single timeout for cleanup and resolution
    const timeoutId = setTimeout(() => {
      page.off('console', listener);
      // Check collected messages as final fallback
      resolve(messages.some(predicate));
    }, timeout);

    page.on('console', listener);
  });
}

/**
 * Wait for element to have expanded class
 * @param {import('@playwright/test').Locator} element - Element to check
 * @param {boolean} shouldBeExpanded - Expected state
 * @param {number} timeout - Timeout in milliseconds (default: 1000)
 */
export async function waitForExpandedState(element, shouldBeExpanded, timeout = 1000) {
  await playwrightExpect(element).toHaveClass(
    shouldBeExpanded ? /expanded/ : /^(?!.*expanded).*$/,
    { timeout }
  );
}

/**
 * Wait for card count to stabilize
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {number} minCount - Minimum expected count
 * @param {number} timeout - Timeout in milliseconds (default: 5000)
 */
export async function waitForCardCount(page, minCount, timeout = 5000) {
  await playwrightExpect(async () => {
    const count = await page.locator('.card-item').count();
    playwrightExpect(count).toBeGreaterThanOrEqual(minCount);
  }).toPass({ timeout });
}

/**
 * Wait for Firestore write propagation by polling for document existence
 * @param {string} cardTitle - Title of card to wait for
 * @param {number} maxRetries - Maximum poll attempts (default: 10)
 * @param {number} intervalMs - Polling interval in ms (default: 200)
 * @returns {Promise<Object>} Card document with id and data
 * @throws {Error} If card not found after all retries
 */
export async function waitForFirestorePropagation(cardTitle, maxRetries = 10, intervalMs = 200) {
  for (let i = 0; i < maxRetries; i++) {
    const card = await getCardFromFirestore(cardTitle, 0, 100);
    if (card) return card;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Card "${cardTitle}" not found in Firestore after ${maxRetries} retries ` +
      `(${maxRetries * intervalMs}ms total). This could indicate: ` +
      `(1) Card was never created, (2) Firestore emulator is down, ` +
      `(3) Propagation delay exceeds timeout. Increase maxRetries or check card creation logic.`
  );
}

/**
 * Wait for URL hash to match pattern
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {RegExp} pattern - Pattern to match against URL
 * @param {number} timeout - Timeout in milliseconds (default: 2000)
 */
// TODO(#565): Add custom error message with actual vs expected URL when timeout occurs.
// Consider adding recovery suggestions like checking navigation timing or verifying
// hash change event handlers are properly registered.
export async function waitForUrlHash(page, pattern, timeout = 2000) {
  await playwrightExpect(page).toHaveURL(pattern, { timeout });
}

/**
 * Select a combobox option by value using JavaScript evaluation
 * This avoids Firefox's NS_ERROR_DOM_BAD_URI with CSS attribute selectors
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} listboxId - ID of the listbox element (e.g., 'typeListbox')
 * @param {string} targetValue - Value to select from the combobox
 * @throws {Error} If listbox or matching option not found
 */
async function selectComboboxOption(page, listboxId, targetValue) {
  if (!listboxId || !targetValue) {
    throw new Error('selectComboboxOption: listboxId and targetValue are required');
  }

  const result = await page.evaluate(
    ({ listboxId, targetValue }) => {
      const listbox = document.getElementById(listboxId);
      if (!listbox) {
        return { success: false, error: `Listbox with id '${listboxId}' not found` };
      }

      // Find option by matching dataset.value
      const options = Array.from(listbox.querySelectorAll('.combobox-option'));
      const matchingOption = options.find((opt) => opt.dataset.value === targetValue);

      if (!matchingOption) {
        const availableValues = options.map((opt) => opt.dataset.value).join(', ');
        return {
          success: false,
          error: `Option '${targetValue}' not found in listbox '${listboxId}'. Available options: ${availableValues}`,
        };
      }

      // Dispatch mousedown event (combobox uses mousedown listeners)
      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view: window,
      });
      matchingOption.dispatchEvent(event);
      return { success: true };
    },
    { listboxId, targetValue }
  );

  if (!result.success) {
    throw new Error(`selectComboboxOption failed: ${result.error}`);
  }
}

/**
 * Fill a combobox field by typing value and selecting from dropdown
 * Consolidates the common pattern: fill input, dispatch event, wait for dropdown, select option
 * If the option is not found in the dropdown, accepts custom value by pressing Escape
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} inputId - ID of the combobox input element
 * @param {string} listboxId - ID of the listbox dropdown element
 * @param {string} value - Value to fill and select
 * @param {number} dropdownDelay - Delay in ms for dropdown to render (default: 50)
 */
async function fillComboboxField(page, inputId, listboxId, value, dropdownDelay = 50) {
  // Fill the input field
  await page.locator(`#${inputId}`).fill(value);

  // Dispatch input event to trigger filtering
  await page.locator(`#${inputId}`).dispatchEvent('input');

  // Wait for dropdown to render after input event
  await page.waitForTimeout(dropdownDelay);

  // Try to select matching option using JavaScript evaluation (Firefox-safe)
  try {
    await selectComboboxOption(page, listboxId, value);
  } catch (error) {
    // Only handle "option not found" errors - re-throw all others (listbox not found, page errors, etc.)
    // This prevents masking critical errors like broken DOM or browser context issues
    if (error.message?.includes('not found in listbox')) {
      // No matching option found - close dropdown and accept custom value
      // This is expected behavior for custom values not in the predefined list
      await page.locator(`#${inputId}`).press('Escape');
    } else {
      throw error;
    }
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
  // KEEP: Modal animation and form element hydration delay (100ms)
  // This ensures combobox dropdowns are properly initialized and interactive before
  // we attempt to fill form fields. Combobox options are populated via JavaScript after
  // modal opens, and CSS transitions need to complete. Without this delay, combobox
  // options may not be ready and interactions will fail silently.
  await page.waitForTimeout(MODAL_ANIMATION_DELAY_MS);

  // Fill form fields
  await page.locator('#cardTitle').fill(cardData.title);

  // Set type using combobox (fill input and select from dropdown or accept custom value)
  await fillComboboxField(page, 'cardType', 'typeListbox', cardData.type, DROPDOWN_RENDER_DELAY_MS);

  // TODO(#1050): Inline KEEP comments lack context about removal criteria
  // KEEP: Subtype combobox update delay after type selection (100ms)
  // The subtype options are dynamically filtered based on selected type via JavaScript
  // (e.g., "Equipment" type → "Weapon", "Armor" subtypes). This DOM update requires
  // time to complete before the subtype field can be reliably filled.
  await page.waitForTimeout(SUBTYPE_UPDATE_DELAY_MS);

  // Set subtype using combobox (fill input and select from dropdown or accept custom value)
  await fillComboboxField(
    page,
    'cardSubtype',
    'subtypeListbox',
    cardData.subtype,
    DROPDOWN_RENDER_DELAY_MS
  );

  // Fill optional fields
  const optionalFields = [
    ['#cardTags', cardData.tags],
    ['#cardDescription', cardData.description],
    ['#cardStat1', cardData.stat1],
    ['#cardStat2', cardData.stat2],
    ['#cardCost', cardData.cost],
  ];

  for (const [selector, value] of optionalFields) {
    if (value) {
      await page.locator(selector).fill(value);
    }
  }

  // Wait for auth.currentUser to be populated (critical for Firestore writes)
  // window.__testAuth is set by authEmulator fixture and used by firebase.js's getAuthInstance()
  // Check for both null and undefined using != null
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
      throw new Error(
        `Auth not ready after 5s: ${JSON.stringify(authState)}. ` +
          `Ensure authEmulator.signInTestUser() was called before createCardViaUI().`,
        { cause: error }
      );
    });

  // Submit form
  await page.locator('#saveCardBtn').click();

  // Wait for modal to close (modal loses .active class and becomes hidden)
  // Increased timeout to 10000ms to allow for slow Firestore writes in emulator
  await page.waitForSelector('#cardEditorModal.active', { state: 'hidden', timeout: 10000 });

  // Wait for card to appear in UI by checking for the specific card title in the DOM
  // This replaces the fixed 2-second timeout with condition-based waiting
  await page
    .waitForFunction(
      (title) => {
        const cardItems = document.querySelectorAll('.card-item');
        return Array.from(cardItems).some(
          (item) => item.textContent && item.textContent.includes(title)
        );
      },
      cardData.title,
      { timeout: 5000 }
    )
    .catch(async (error) => {
      // If card doesn't appear, throw error with debugging context
      const cardCount = await page.locator('.card-item').count();
      throw new Error(
        `Card "${cardData.title}" did not appear in UI after 5s. ` +
          `Current card count: ${cardCount}. ` +
          `This indicates the card creation may have failed or Firestore write propagation is delayed.`,
        { cause: error }
      );
    });
}

// Shared Firebase Admin instance for Firestore operations
let _adminApp = null;
let _firestoreDb = null;
let _firestoreSettingsConfigured = false;

/**
 * Get or initialize Firebase Admin SDK and Firestore connection
 * Reuses the same instance across multiple calls to avoid settings() errors
 *
 * **IMPORTANT**: This function uses module-level state and may have race conditions
 * if called concurrently during async initialization. JavaScript is single-threaded
 * but async operations can interleave - multiple simultaneous calls may race during
 * first initialization. Designed for sequential test execution. If you need concurrent
 * test isolation, consider implementing an initialization lock or separate instances
 * per test.
 *
 * @returns {Promise<FirestoreAdminInstance>} Firebase Admin app and Firestore database instances
 */
export async function getFirestoreAdmin() {
  if (_adminApp && _firestoreDb) {
    return { app: _adminApp, db: _firestoreDb };
  }

  try {
    // Dynamic import to avoid loading firebase-admin in browser context
    const adminModule = await import('firebase-admin');
    const admin = adminModule.default;

    // Get or initialize Firebase Admin
    try {
      if (!admin.apps.length) {
        _adminApp = admin.initializeApp({
          projectId: 'demo-test',
        });
      } else {
        _adminApp = admin.app();
      }
    } catch (error) {
      throw new Error(
        `Failed to initialize Firebase Admin: ${error.message}. ` +
          `Check that firebase-admin is installed and FIRESTORE_EMULATOR_HOST is set.`
      );
    }

    // Connect to Firestore emulator (only call settings once)
    try {
      _firestoreDb = admin.firestore(_adminApp);

      // Only configure settings if not already configured
      if (!_firestoreSettingsConfigured) {
        const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:11980';
        const [host, port] = firestoreHost.split(':');

        // Validate host/port format before passing to Firestore
        if (!host || !port || isNaN(parseInt(port, 10))) {
          throw new Error(
            `Invalid FIRESTORE_EMULATOR_HOST format: "${firestoreHost}". ` +
              `Expected format: "host:port" (e.g., "127.0.0.1:11980")`
          );
        }

        _firestoreDb.settings({
          host: `${host}:${port}`,
          ssl: false,
        });

        // Mark as configured to prevent duplicate calls
        _firestoreSettingsConfigured = true;
      }
    } catch (error) {
      throw new Error(
        `Failed to connect to Firestore emulator: ${error.message}. ` +
          `Check that emulator is running at ${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:11980'}.`
      );
    }

    return { app: _adminApp, db: _firestoreDb };
  } catch (error) {
    // Re-throw errors that already have detailed messages (check if error is instance of Error with our message pattern)
    if (error instanceof Error && error.message.startsWith('Failed to')) {
      throw error;
    }
    throw new Error(
      `Failed to load firebase-admin module: ${error.message}. ` +
        `Ensure firebase-admin is installed in your project.`,
      { cause: error }
    );
  }
}

/**
 * Query Firestore emulator directly to get a card by title
 * Includes retry logic to handle emulator write propagation delays
 * @param {string} cardTitle - Title of the card to find
 * @param {number} maxRetries - Maximum number of retries (default: 5)
 * @param {number} initialDelayMs - Initial delay between retries in ms (default: 500)
 * @returns {Promise<Object|null>} Card document with id and data, or null if not found after retries
 */
export async function getCardFromFirestore(cardTitle, maxRetries = 5, initialDelayMs = 500) {
  // Input validation
  if (!cardTitle || typeof cardTitle !== 'string') {
    throw new Error('getCardFromFirestore: cardTitle must be a non-empty string');
  }
  if (maxRetries < 0) {
    throw new Error('getCardFromFirestore: maxRetries must be >= 0');
  }
  if (initialDelayMs <= 0) {
    throw new Error('getCardFromFirestore: initialDelayMs must be > 0');
  }

  try {
    // Import collection name helper
    const { getCardsCollectionName } = await import('../../scripts/lib/collection-names.js');

    // Get or initialize Firestore Admin (reuses same instance)
    const { db } = await getFirestoreAdmin();

    const collectionName = getCardsCollectionName();
    const cardsCollection = db.collection(collectionName);

    // Retry with exponential backoff
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const snapshot = await cardsCollection.where('title', '==', cardTitle).get();

        if (!snapshot.empty) {
          // Found the card!
          const doc = snapshot.docs[0];
          return {
            id: doc.id,
            ...doc.data(),
          };
        }
      } catch (error) {
        // Map Firestore error codes to actionable messages
        handleFirestoreErrorCode(error);
      }

      // If this was the last attempt, return null
      if (attempt === maxRetries) {
        return null;
      }

      // Wait before retrying (exponential backoff)
      const delayMs = initialDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    // Note: Loop always exits via early returns (found card at lines 721-724, last attempt at lines 732-733)
    // or throws from handleFirestoreErrorCode. This point is unreachable.
  } catch (error) {
    wrapFirestoreError(error, 'getCardFromFirestore');
  }
}

/**
 * Delete test cards from Firestore emulator by title pattern
 *
 * **IMPORTANT**: Firestore batch operations have a 500-operation limit per commit.
 * If more than 500 cards match the pattern, the batch.commit() will fail with a
 * Firestore error. For large cleanups, either:
 * - Use more specific patterns to keep matches under 500
 * - Call deleteTestCards multiple times with different patterns
 * - Split cleanup across test files/suites
 *
 * @param {RegExp|string} titlePattern - Pattern to match card titles (regex or string prefix)
 * @returns {Promise<DeleteResult>} Object with count of successfully deleted documents
 * @throws {Error} If titlePattern is falsy, empty string, or not string/RegExp
 * @throws {Error} If Firestore emulator is unavailable
 * @throws {Error} If batch deletion fails (e.g., exceeds 500 operation limit)
 */
export async function deleteTestCards(titlePattern) {
  // Input validation - reject falsy values and empty strings
  if (!titlePattern || (typeof titlePattern === 'string' && titlePattern.length === 0)) {
    throw new Error(
      'deleteTestCards: titlePattern must be a non-empty string or RegExp (empty pattern would delete all cards)'
    );
  }

  // Validate that titlePattern is either a string or RegExp instance
  if (typeof titlePattern !== 'string' && !(titlePattern instanceof RegExp)) {
    throw new Error(
      `deleteTestCards: titlePattern must be a string or RegExp, got ${typeof titlePattern}`
    );
  }

  try {
    // Import collection name helper
    const { getCardsCollectionName } = await import('../../scripts/lib/collection-names.js');

    // Get or initialize Firestore Admin (reuses same instance)
    const { db } = await getFirestoreAdmin();

    // Query all cards
    const collectionName = getCardsCollectionName();
    const cardsCollection = db.collection(collectionName);

    let snapshot;
    try {
      snapshot = await cardsCollection.get();
    } catch (error) {
      handleFirestoreErrorCode(error);
    }

    // Filter cards by title pattern
    const docsToDelete = snapshot.docs
      .filter((doc) => {
        const title = doc.data().title || '';
        if (titlePattern instanceof RegExp) {
          return titlePattern.test(title);
        }
        return title.startsWith(titlePattern);
      })
      .map((doc) => doc.ref);

    // Batch delete matching cards
    if (docsToDelete.length > 0) {
      try {
        const batch = db.batch();
        for (const docRef of docsToDelete) {
          batch.delete(docRef);
        }
        await batch.commit();
        return { deleted: docsToDelete.length };
      } catch (error) {
        throw new Error(
          `Failed to batch delete ${docsToDelete.length} cards: ${error.message}. ` +
            `Partial deletion may have occurred.`
        );
      }
    }

    return { deleted: 0 };
  } catch (error) {
    wrapFirestoreError(error, 'deleteTestCards');
  }
}
