/**
 * Card Library - CRUD Operations and Tree Navigation
 *
 * Error handling improvements:
 * - Better auth state management with retry logic
 * - Structured error logging with context objects
 * - User-friendly error messages for Firebase operations
 */
// TODO: See issue #588 - Fix silent failures: narrow catch blocks, add specific error messages instead of generic ones

// Import Firestore operations
// TODO(#588): Fix silent failures and error handling in production code
// TODO(#462): Add JSDoc type annotations and validation for JavaScript types
// TODO(#331): Lower card render failure threshold and show which cards failed
// TODO(#322): Add E2E tests for library navigation error handling
// TODO(#321): Add tests for card rendering error recovery
import {
  getAllCards,
  createCard as createCardInDB,
  updateCard as updateCardInDB,
  deleteCard as deleteCardInDB,
  importCards as importCardsFromData,
  withTimeout,
  getAuthInstance,
} from './firebase.js';

// Import auth initialization and state
import { initializeAuth, onAuthStateChanged, onAuthReady } from './auth-init.js';

// Import shared navigation
import { initSidebarNav } from './sidebar-nav.js';
import { initLibraryNav } from './library-nav.js';

// Import cards data for initial seeding
import cardsData from '../data/cards.json';

// Timeout constants for various operations
// TODO(#1094): Consider freezing TIMEOUTS object to prevent runtime mutation
const TIMEOUTS = {
  BLUR_DELAY_MS: 200, // Browser event ordering safety margin
  AUTH_RETRY_MS: 500, // Firebase SDK init wait
  FIRESTORE_MS: 5000, // Firestore query timeout (unused - queries use hardcoded values)
  DEBOUNCE_MS: 300, // Button click debounce
};

// Submission lock to prevent double-submit on rapid clicks or Enter key spam.
// Set at start of handleCardSave(), cleared in finally block.
// Separate from button.disabled to handle Enter key submissions.
let isSaving = false;

// HTML escape utility to prevent XSS attacks
// Uses browser's built-in escaping via textContent property.
//
// XSS Attack Vectors Prevented:
//   - Script injection: <script>alert('xss')</script> → escaped, not executed
//   - Event handler injection: <img onerror="alert('xss')"> → escaped, not executed
//   - Protocol injection: <a href="javascript:alert('xss')"> → escaped, not clickable
//
// CRITICAL: Use for ALL user-generated content before inserting into DOM:
//   - Card titles, descriptions, types, subtypes in renderCards()
//   - Custom type/subtype values from combobox "Add New" feature
//   - User display names, error messages containing user input
// Example: escapeHtml("<script>alert('xss')</script>") → "&lt;script&gt;alert('xss')&lt;/script&gt;"
// NOTE: Only escapes HTML context. For JavaScript strings, use JSON.stringify(). For URLs, use encodeURIComponent(). This function does NOT provide URL injection protection.
// TODO(#480): Add E2E test for XSS in custom types via "Add New" combobox option
function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// Whitelist of valid card types for class attribute
// TODO(#1098): Freeze VALID_CARD_TYPES to prevent runtime mutations
const VALID_CARD_TYPES = ['Equipment', 'Skill', 'Upgrade', 'Foe', 'Origin'];
function sanitizeCardType(type) {
  return VALID_CARD_TYPES.includes(type) ? type : '';
}

// ==========================================================================
// Card Data Type Definitions and Validation
// ==========================================================================

/**
 * Card data structure for Firestore storage and local state.
 * @typedef {Object} CardData
 * @property {string} [id] - Firestore document ID (set by Firestore on create)
 * @property {string} title - Card title (required, max 100 chars)
 * @property {string} type - Card type (required, e.g., 'Equipment', 'Skill')
 * @property {string} subtype - Card subtype (required, e.g., 'Weapon', 'Magic')
 * @property {string[]} [tags] - Optional array of tag strings
 * @property {string} [description] - Optional description (max 500 chars)
 * @property {string} [stat1] - Optional primary stat value
 * @property {string} [stat2] - Optional secondary stat value
 * @property {string} [cost] - Optional cost value
 * @property {boolean} [isPublic] - Whether card is publicly visible (default: true for backward compatibility)
 * @property {string} [createdBy] - UID of user who created the card
 * @property {FirebaseFirestore.Timestamp} [createdAt] - Timestamp when card was created
 * @property {FirebaseFirestore.Timestamp} [updatedAt] - Timestamp when card was last updated
 */

/**
 * Validation constraints for card data fields.
 * Centralized to ensure consistency between client and server validation.
 */
// TODO(#1098): Freeze CARD_CONSTRAINTS to prevent runtime mutations
const CARD_CONSTRAINTS = {
  TITLE_MAX_LENGTH: 100,
  DESCRIPTION_MAX_LENGTH: 500,
  REQUIRED_FIELDS: ['title', 'type', 'subtype'],
};

/**
 * Validate card data structure and return validation errors.
 * TODO: Consolidate with firebase.js validateCardData - both functions validate same fields
 * but have different signatures (return errors vs throw). Consider shared validation module.
 * @param {Partial<CardData>} cardData - Card data to validate
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string }> }}
 */
function validateCardData(cardData) {
  const errors = [];

  if (!cardData || typeof cardData !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'cardData', message: 'Card data must be an object' }],
    };
  }

  // Required field validation
  if (!cardData.title || typeof cardData.title !== 'string' || !cardData.title.trim()) {
    errors.push({ field: 'title', message: 'Title is required' });
  } else if (cardData.title.length > CARD_CONSTRAINTS.TITLE_MAX_LENGTH) {
    errors.push({
      field: 'title',
      message: `Title must be ${CARD_CONSTRAINTS.TITLE_MAX_LENGTH} characters or less`,
    });
  }

  if (!cardData.type || typeof cardData.type !== 'string' || !cardData.type.trim()) {
    errors.push({ field: 'type', message: 'Type is required' });
  }

  if (!cardData.subtype || typeof cardData.subtype !== 'string' || !cardData.subtype.trim()) {
    errors.push({ field: 'subtype', message: 'Subtype is required' });
  }

  // Optional field validation
  if (
    cardData.description &&
    cardData.description.length > CARD_CONSTRAINTS.DESCRIPTION_MAX_LENGTH
  ) {
    errors.push({
      field: 'description',
      message: `Description must be ${CARD_CONSTRAINTS.DESCRIPTION_MAX_LENGTH} characters or less`,
    });
  }

  if (cardData.tags !== undefined && !Array.isArray(cardData.tags)) {
    errors.push({ field: 'tags', message: 'Tags must be an array' });
  }

  return { valid: errors.length === 0, errors };
}

// ==========================================================================
// State Management with Validation
// ==========================================================================

// TODO(#1096): Consider using Object.freeze for runtime immutability
/**
 * Valid view modes for card display.
 * @type {readonly ['grid', 'list']}
 */
const VALID_VIEW_MODES = /** @type {const} */ (['grid', 'list']);

/**
 * Global application state (singleton pattern)
 * @property {CardData[]} cards - All cards loaded from Firestore
 * @property {CardData[]} filteredCards - Cards matching current filters
 * @property {Object|null} selectedNode - Currently selected tree node
 * @property {'grid'|'list'} viewMode - Current view mode
 * @property {Object} filters - Current filter state (type, subtype, search)
 * @property {boolean} loading - Whether data is currently being loaded
 * @property {string|null} error - Current error message, if any
 * @property {boolean} initialized - Whether global listeners have been set up
 * @property {boolean} initializing - Whether initialization is currently in progress
 * @property {Function|null} authUnsubscribe - Cleanup function for auth state listener
 * @property {boolean} listenersAttached - Whether event listeners are attached
 * @property {number|null} authTimeoutId - Timeout ID for backup auth check cleanup
 * @property {number} authListenerRetries - Count of auth listener setup retry attempts
 *   Rationale: Firebase auth can be slow to initialize, especially on cold start or slow networks.
 *   Retries prevent race condition where UI initializes before auth state is available.
 *   10 retry attempts with 500ms delay between each = 4.5 seconds total wait (9 delays), plus initial attempt.
 * @property {number} authListenerMaxRetries - Maximum allowed retries for auth listener setup (default: 10)
 */
const state = {
  cards: [],
  filteredCards: [],
  selectedNode: null,
  viewMode: 'grid',
  filters: {
    type: '',
    subtype: '',
    search: '',
  },
  loading: false,
  error: null,
  initialized: false, // Track if we've set up global listeners
  initializing: false, // Track if init is in progress to prevent race conditions
  authUnsubscribe: null, // Store auth state listener unsubscribe function
  listenersAttached: false, // Track if event listeners are attached to prevent duplicates
  authTimeoutId: null, // Timeout ID for backup auth check cleanup
  authListenerRetries: 0, // Counter for auth listener setup retry attempts
  authListenerMaxRetries: 10, // Max retry attempts before giving up (10 retries = 5 seconds)
};

/**
 * Update state.viewMode with validation.
 * @param {'grid'|'list'} mode - New view mode
 * @returns {boolean} Whether the update was valid
 */
function updateViewMode(mode) {
  if (!VALID_VIEW_MODES.includes(mode)) {
    console.warn(
      `[Cards] Invalid view mode: ${mode}. Must be one of: ${VALID_VIEW_MODES.join(', ')}`
    );
    return false;
  }
  state.viewMode = mode;
  return true;
}

/**
 * Update state.cards with validation.
 * @param {CardData[]} cards - New cards array
 * @returns {boolean} Whether the update was valid
 */
function updateCards(cards) {
  if (!Array.isArray(cards)) {
    console.error('[Cards] Invalid cards update: must be an array');
    return false;
  }
  state.cards = cards;
  return true;
}

// Reset state for fresh initialization
function resetState() {
  isSaving = false;
  state.cards = [];
  state.filteredCards = [];
  state.selectedNode = null;
  state.viewMode = 'grid';
  state.filters = { type: '', subtype: '', search: '' };
  state.loading = false;
  state.error = null;
  state.listenersAttached = false;
  // TODO(#462): Add impact context to cleanup comment
  // Clean up pending auth timeout
  if (state.authTimeoutId) {
    clearTimeout(state.authTimeoutId);
    state.authTimeoutId = null;
  }
  // Clean up auth state listener to prevent memory leaks
  // IMPORTANT: Always unsubscribe before creating new listener to avoid:
  //   1. Multiple concurrent listeners (memory leak)
  //   2. Duplicate auth state change handlers (buggy UI updates)
  if (state.authUnsubscribe) {
    state.authUnsubscribe();
    state.authUnsubscribe = null;
  }
  // Don't reset initialized - that tracks global listeners
}

// ==========================================================================
// Combobox Component Functions
// ==========================================================================

function getTypesFromCards() {
  return [...new Set(state.cards.filter((c) => c.type).map((c) => c.type))].sort();
}

function getSubtypesForType(type) {
  if (!type) return [];
  return [
    ...new Set(state.cards.filter((c) => c.type === type && c.subtype).map((c) => c.subtype)),
  ].sort();
}

/**
 * @typedef {Object} ComboboxConfig
 * @property {string} comboboxId - ID of the combobox container element (required)
 * @property {string} inputId - ID of the combobox input element (required)
 * @property {string} listboxId - ID of the combobox listbox element (required)
 * @property {Function} getOptions - Function that returns array of available option strings (required)
 * @property {Function} [onSelect] - Callback function invoked when an option is selected (optional)
 * @property {string} [placeholder] - Placeholder text for the input field (optional)
 * @property {boolean} [allowCustom] - Whether to allow custom values via "Add New" option (optional, default: true)
 */

// Generic combobox controller
function createCombobox(config) {
  // Validate required config fields
  const requiredFields = ['comboboxId', 'inputId', 'listboxId', 'getOptions'];
  const missingFields = requiredFields.filter((field) => !config[field]);

  if (missingFields.length > 0) {
    throw new Error(`createCombobox: Missing required config fields: ${missingFields.join(', ')}`);
  }

  if (typeof config.getOptions !== 'function') {
    throw new Error('createCombobox: getOptions must be a function');
  }

  if (config.onSelect !== undefined && typeof config.onSelect !== 'function') {
    throw new Error('createCombobox: onSelect must be a function if provided');
  }

  const { inputId, listboxId, comboboxId, getOptions, onSelect } = config;

  const combobox = document.getElementById(comboboxId);
  const input = document.getElementById(inputId);
  const listbox = document.getElementById(listboxId);
  const toggle = combobox?.querySelector('.combobox-toggle');

  if (!combobox || !input || !listbox || !toggle) {
    console.warn(`Combobox elements not found for ${comboboxId}`);
    return null;
  }

  let highlightedIndex = -1;

  function show() {
    refresh();
    combobox.classList.add('open');
    input.setAttribute('aria-expanded', 'true');
  }

  function hide() {
    combobox.classList.remove('open');
    input.setAttribute('aria-expanded', 'false');
    highlightedIndex = -1;
  }

  // Create an option element for the listbox
  function createOption(value, label, extraClass = '') {
    const li = document.createElement('li');
    li.className = `combobox-option${extraClass ? ` ${extraClass}` : ''}`;
    li.textContent = label;
    li.setAttribute('role', 'option');
    li.dataset.value = value;
    if (value === input.value) li.classList.add('selected');
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectOption(value);
    });
    return li;
  }

  // Refresh options based on input value
  function refresh() {
    const inputValue = input.value.trim().toLowerCase();

    let availableOptions;
    try {
      availableOptions = getOptions();
      if (!Array.isArray(availableOptions)) {
        throw new TypeError(`getOptions() returned non-array: ${typeof availableOptions}`);
      }
    } catch (error) {
      // Categorize combobox-specific errors for debugging
      const errorCategory =
        error instanceof TypeError
          ? 'type_error'
          : error.name === 'ReferenceError'
            ? 'missing_data'
            : 'unknown';

      console.error('[Cards] Error fetching combobox options:', {
        comboboxId: comboboxId,
        inputValue: input.value,
        message: error.message,
        stack: error.stack,
        errorType: error.constructor.name,
        category: errorCategory,
      });

      // Show error state in UI
      listbox.replaceChildren();
      listbox.classList.add('combobox-error');

      const errorLi = document.createElement('li');
      errorLi.className = 'combobox-option combobox-error-message';
      errorLi.textContent = 'Unable to load options. Please refresh the page.';
      listbox.appendChild(errorLi);

      // Disable input to prevent submission with broken combobox
      input.disabled = true;
      input.placeholder = 'Options unavailable - please refresh';
      combobox.dataset.broken = 'true';

      // Don't re-throw - UI error is shown, form validation will catch broken state
      return;
    }

    // Render options - separate try-catch for DOM errors with clearer context
    try {
      // Clear any previous error state
      listbox.classList.remove('combobox-error');

      // Filter options based on input
      const filteredOptions = availableOptions.filter((opt) =>
        opt.toLowerCase().includes(inputValue)
      );

      // Check if input exactly matches an existing option
      const exactMatch = availableOptions.some((opt) => opt.toLowerCase() === inputValue);
      const showAddNew = inputValue && !exactMatch;

      // Clear listbox
      listbox.replaceChildren();

      // Show "no options" message if nothing to display
      if (filteredOptions.length === 0 && !showAddNew) {
        const li = document.createElement('li');
        li.className = 'combobox-option';
        li.textContent = 'No options available';
        li.style.cssText = 'font-style: italic; color: var(--color-text-tertiary);';
        listbox.appendChild(li);
        return;
      }

      // Add matching options
      filteredOptions.forEach((opt) => listbox.appendChild(createOption(opt, opt)));

      // Add "Add new" option for custom values
      if (showAddNew) {
        listbox.appendChild(
          createOption(input.value, `Add "${escapeHtml(input.value)}"`, 'combobox-option--new')
        );
      }
    } catch (error) {
      console.error('[Cards] Error rendering combobox options:', {
        comboboxId: comboboxId,
        errorType: error.constructor.name,
        message: error.message,
        stack: error.stack,
      });

      // Show error state in UI instead of crashing the app
      listbox.classList.add('combobox-error');
      listbox.replaceChildren();
      const errorLi = document.createElement('li');
      errorLi.className = 'combobox-option';
      errorLi.textContent = 'Error loading options';
      errorLi.style.cssText = 'font-style: italic; color: var(--color-error);';
      listbox.appendChild(errorLi);

      // Disable input to prevent submission with broken combobox
      input.disabled = true;
      input.placeholder = 'Options unavailable - please refresh';
      combobox.dataset.broken = 'true';

      // Don't re-throw - UI error is shown, form validation will catch broken state
      return;
    }
  }

  // Select an option
  function selectOption(value) {
    input.value = value;
    hide();
    if (onSelect) {
      try {
        onSelect(value);
      } catch (error) {
        console.error('[Cards] Error in combobox onSelect callback:', {
          comboboxId: comboboxId,
          value: value,
          message: error.message,
          stack: error.stack,
        });

        // Show user-facing error - don't re-throw as combobox should remain usable
        showFormError(
          `Failed to update form after selecting "${value}". Please try again or refresh the page.`
        );
        // Return without re-throwing - error is logged and user is notified
      }
    }
  }

  // Highlight option by index
  function highlightOption(index) {
    const options = listbox.querySelectorAll('.combobox-option');
    if (index < 0 || index >= options.length) return;

    options.forEach((opt, i) => {
      opt.classList.toggle('highlighted', i === index);
      if (i === index) {
        opt.scrollIntoView({ block: 'nearest' });
      }
    });

    highlightedIndex = index;
  }

  // Event listeners
  input.addEventListener('focus', show);

  input.addEventListener('input', () => {
    refresh();
    highlightedIndex = -1;
  });

  input.addEventListener('blur', () => {
    // Delay allows click events to fire before blur closes dropdown (browser event ordering varies)
    // TODO(#483): Replace setTimeout with relatedTarget check for more robust solution
    setTimeout(hide, TIMEOUTS.BLUR_DELAY_MS);
  });

  input.addEventListener('keydown', (e) => {
    const options = listbox.querySelectorAll('.combobox-option');
    const isOpen = combobox.classList.contains('open');

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen) {
          show();
        } else {
          highlightOption(Math.min(highlightedIndex + 1, options.length - 1));
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (isOpen) {
          highlightOption(Math.max(highlightedIndex - 1, 0));
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (isOpen && highlightedIndex >= 0 && options[highlightedIndex]) {
          selectOption(options[highlightedIndex].dataset.value);
        }
        break;
      case 'Escape':
        e.preventDefault();
        hide();
        break;
      case 'Tab':
        hide();
        break;
    }
  });

  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    // Toggle: if open, hide; if closed, focus triggers show via focus event
    if (combobox.classList.contains('open')) {
      hide();
    } else {
      input.focus();
    }
  });

  const outsideClickHandler = (e) => {
    if (!combobox.contains(e.target)) {
      hide();
    }
  };
  document.addEventListener('click', outsideClickHandler);

  return {
    refresh,
    destroy: () => document.removeEventListener('click', outsideClickHandler),
  };
}

// Safely destroy a combobox instance, returning null for reassignment
function destroyCombobox(combobox, name) {
  if (!combobox) return null;
  try {
    combobox.destroy();
  } catch (error) {
    // Distinguish between benign cleanup failures and critical errors
    const isListenerCleanupError =
      error.message?.includes('removeEventListener') || error.message?.includes('listener');

    if (isListenerCleanupError) {
      // Benign: event listener cleanup failed, log warning but continue
      console.warn(`[Cards] Failed to cleanup ${name} combobox listeners (benign):`, error.message);
      return null;
    }

    // Critical: unexpected error during destroy - show error UI but don't throw
    // Throwing would prevent further cleanup operations from running
    console.error(`[Cards] CRITICAL: Failed to destroy ${name} combobox:`, error);
    showErrorUI('Failed to reset combobox. Please refresh the page to avoid issues.', () =>
      window.location.reload()
    );
    // Return null to allow caller to continue cleanup (e.g., destroy other comboboxes)
  }
  return null;
}

// Initialize type combobox
let typeCombobox = null;
function initTypeCombobox() {
  typeCombobox = createCombobox({
    inputId: 'cardType',
    listboxId: 'typeListbox',
    comboboxId: 'typeCombobox',
    getOptions: getTypesFromCards,
    onSelect: (value) => {
      // When type changes, clear subtype and refresh subtype options
      const subtypeInput = document.getElementById('cardSubtype');
      if (subtypeInput) {
        subtypeInput.value = '';
      }
      if (subtypeCombobox) {
        subtypeCombobox.refresh();
      }
    },
  });
  if (!typeCombobox) {
    console.error('[Cards] Failed to initialize type combobox - DOM elements missing');
    return false;
  }
  return true;
}

// Initialize subtype combobox
let subtypeCombobox = null;
function initSubtypeCombobox() {
  subtypeCombobox = createCombobox({
    inputId: 'cardSubtype',
    listboxId: 'subtypeListbox',
    comboboxId: 'subtypeCombobox',
    getOptions: () => {
      const type = document.getElementById('cardType')?.value;
      return getSubtypesForType(type);
    },
    // onSelect is optional - omit it rather than passing null
  });
  if (!subtypeCombobox) {
    console.error('[Cards] Failed to initialize subtype combobox - DOM elements missing');
    return false;
  }
  return true;
}

// TODO(#1332): Consolidate showErrorUI and showWarningBanner patterns into unified factory
// Show error UI with retry option
function showErrorUI(message, onRetry) {
  const container = document.querySelector('.card-container');
  if (!container) return;

  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-banner';

  const errorContent = document.createElement('div');
  errorContent.className = 'error-content';

  const errorText = document.createElement('p');
  errorText.textContent = message;
  errorContent.appendChild(errorText);

  if (onRetry) {
    const retryButton = document.createElement('button');
    retryButton.className = 'retry-button';
    retryButton.textContent = 'Retry';
    retryButton.addEventListener('click', onRetry);
    errorContent.appendChild(retryButton);
  }

  errorDiv.appendChild(errorContent);
  container.insertBefore(errorDiv, container.firstChild);
}

// Create a warning banner element
function createBanner(message) {
  const banner = document.createElement('div');
  banner.className = 'warning-banner';

  const content = document.createElement('div');
  content.className = 'warning-content';

  const text = document.createElement('p');
  text.textContent = message;
  content.appendChild(text);

  banner.appendChild(content);
  return banner;
}

// Show warning banner
function showWarningBanner(message) {
  const container = document.querySelector('.card-container');
  if (!container) return;
  container.insertBefore(createBanner(message), container.firstChild);
}

// Initialize the app
async function init() {
  // Guard against concurrent initialization
  if (state.initializing) {
    return;
  }

  // Guard against double initialization
  if (state.initialized) {
    // CRITICAL: Clear hardcoded loading spinner from HTMX-swapped HTML
    removeLoadingSpinner();

    // Re-attach event listeners (they may be stale after HTMX swap)
    // Reset the flag so listeners can be re-attached to new DOM elements
    state.listenersAttached = false;
    setupEventListeners();

    // Show fresh loading state while we load data
    state.loading = true;
    renderCards(); // This will show the loading spinner

    // Load data
    try {
      await loadCards(); // This sets state.loading = false in finally block
    } catch (error) {
      console.error('[Cards] Error refreshing data:', error);
      state.loading = false; // Ensure loading state is cleared even on error
    }

    // Apply filters and render cards
    handleHashChange(); // This will call applyFilters() -> renderCards()
    return;
  }

  try {
    state.initializing = true;

    // CRITICAL: Clear any hardcoded loading spinner from HTMX-swapped HTML FIRST
    removeLoadingSpinner();

    // Validate auth - continue initialization even if not ready
    // Cards can still load for viewing even without auth
    // Auth state listener will retry automatically when auth becomes available
    const authInstance = getAuthInstance();

    // Note: Authentication is initialized globally in main.js DOMContentLoaded
    // Don't call initializeAuth() here to avoid duplicates

    // Initialize shared sidebar navigation (generates nav DOM)
    initSidebarNav();

    // Setup auth state listener - defer until auth is ready to prevent race condition
    // This prevents "can't access property 'onAuthStateChanged', auth is null" errors
    onAuthReady(() => {
      setupAuthStateListener();
    });

    // Initialize library navigation (populates library section)
    // Don't await - let it load in background to avoid blocking card display
    initLibraryNav().catch((error) => {
      console.warn('[Cards] Library navigation initialization failed - continuing anyway:', error);

      // Show non-blocking warning banner to user with auto-dismiss
      const warningBanner = createBanner(
        'Library navigation failed to load. You can still use cards normally.'
      );
      warningBanner.style.cssText =
        'background: var(--color-warning); color: white; padding: 0.75rem; text-align: center; font-size: 0.9rem;';

      const mainContent = document.querySelector('main') || document.body;
      mainContent.insertBefore(warningBanner, mainContent.firstChild);

      setTimeout(() => warningBanner.remove(), 5000);
    });

    // Setup hash routing (only once)
    setupHashRouting();

    // Setup UI components - these don't need data (only once)
    setupEventListeners();
    setupMobileMenu();

    // Mark as fully initialized
    state.initialized = true;

    // Set loading state before rendering to keep loading indicator visible
    state.loading = true;
    renderCards(); // Will keep loading state visible

    // Load data asynchronously WITHOUT blocking page load
    loadCards()
      .then(() => {
        // Apply hash route if present (this will filter and render)
        handleHashChange();
      })
      .catch((error) => {
        console.error('Failed to load cards:', error);
        showWarningBanner('Failed to load cards from cloud. Using cached data.');
        // Still apply hash route with fallback data
        handleHashChange();
      });
  } catch (error) {
    // Log initialization errors for debugging
    console.error('Card Library init error:', error);

    // Show user-friendly error UI with retry capability
    showErrorUI('Failed to initialize Card Library. Some features may not work correctly.', () => {
      document.querySelector('.error-banner')?.remove();
      state.initialized = false; // Reset so retry can work
      state.listenersAttached = false; // Reset listeners flag for retry
      init();
    });
  } finally {
    state.initializing = false;
  }
}

// Load cards from Firestore
async function loadCards() {
  try {
    state.loading = true;
    state.error = null;

    // Try to load from Firestore (now has built-in 5s timeout)
    const cards = await getAllCards();

    if (cards.length > 0) {
      state.cards = cards;
    } else {
      // If no cards in Firestore, show appropriate empty state
      if (getAuthInstance()?.currentUser) {
        // Authenticated users get empty Firestore state (don't auto-import)
        state.cards = [];
      } else {
        // Not authenticated - use static data to avoid slow import attempts
        state.cards = cardsData || [];
      }
    }

    state.filteredCards = [...state.cards];
  } catch (error) {
    console.error('[Cards] Error loading cards:', {
      errorId: 'CARDS_LOAD_FAILED',
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    state.error = error.message;

    // TODO(#483): loadCards() fallback could mask auth errors - getAuthInstance() might be null
    // Distinguish between permission-denied (expected for anonymous) and unauthenticated (session expired)
    // TODO(#588): Never fall back to demo data - show explicit auth error instead
    const isAuthenticated = !!getAuthInstance()?.currentUser;

    // TODO(#588): CRITICAL - Never fall back to demo data for authenticated users - causes data loss
    // Authenticated user with permission-denied will see demo data, add cards thinking they're saving → work lost
    if (error.code === 'permission-denied') {
      if (!isAuthenticated) {
        // Permission denied for anonymous users is expected
        console.warn(
          '[Cards] Permission denied for anonymous user (expected), using static data fallback'
        );
        state.cards = cardsData || [];
        state.filteredCards = [...state.cards];
        return;
      }
      // Authenticated user got permission-denied - unexpected, likely a security rules issue
      console.error('[Cards] Permission denied for authenticated user - check security rules');
      showAppError('Permission denied. Please contact support if this persists.');
      return;
    }

    if (error.code === 'unauthenticated') {
      // Unauthenticated error - session may have expired
      console.warn('[Cards] Unauthenticated error - session may have expired');
      state.cards = [];
      state.filteredCards = [];
      showErrorUI('Your session has expired. Please log in to view your cards.', () => {
        document.getElementById('loginBtn')?.click();
      });
      return;
    }

    // Transient network errors: offer retry
    if (error.message?.includes('timeout') || error.code === 'unavailable') {
      state.cards = [];
      state.filteredCards = [];
      showErrorUI(
        'Unable to connect to server. Please check your connection and try again.',
        () => {
          document.querySelector('.error-banner')?.remove();
          loadCards();
        }
      );
      return;
    }

    // TODO(#588): Never fall back to demo data for authenticated users
    // All other errors: show error without demo data fallback
    state.cards = [];
    state.filteredCards = [];
    showErrorUI(`Failed to load cards: ${error.message}. Please refresh to try again.`, () => {
      document.querySelector('.error-banner')?.remove();
      loadCards();
    });
  } finally {
    // ALWAYS clear loading state
    state.loading = false;
  }
}

// Helper to bind element listener with missing element tracking
function bindListener(elementOrSelector, event, handler, missingElements) {
  const el =
    typeof elementOrSelector === 'string'
      ? document.getElementById(elementOrSelector) || document.querySelector(elementOrSelector)
      : elementOrSelector;
  if (el) {
    el.addEventListener(event, handler);
    return true;
  }
  if (typeof elementOrSelector === 'string') {
    missingElements.push(elementOrSelector);
  }
  return false;
}

// Setup event listeners
function setupEventListeners() {
  // Guard against duplicate listener attachment
  if (state.listenersAttached) return;

  try {
    const missingElements = [];

    // Add Card button with debounce to prevent rapid clicks
    let addCardDebounce = null;
    bindListener(
      'addCardBtn',
      'click',
      () => {
        if (addCardDebounce) return;
        addCardDebounce = setTimeout(() => {
          addCardDebounce = null;
        }, TIMEOUTS.DEBOUNCE_MS);
        openCardEditor();
      },
      missingElements
    );

    // Export button
    bindListener('exportCardsBtn', 'click', exportCards, missingElements);

    // View mode buttons
    document.querySelectorAll('.view-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => setViewMode(btn.dataset.mode));
    });

    // Search filter
    bindListener('searchCards', 'input', handleFilterChange, missingElements);

    // Modal close buttons
    bindListener('closeModalBtn', 'click', closeCardEditor, missingElements);
    bindListener('cancelModalBtn', 'click', closeCardEditor, missingElements);
    bindListener('deleteCardBtn', 'click', deleteCard, missingElements);
    bindListener('cardForm', 'submit', handleCardSave, missingElements);
    bindListener('.modal-backdrop', 'click', closeCardEditor, missingElements);

    // TODO(#481): Extract combobox cleanup to helper function to remove duplication (~15 lines)
    // Clean up existing comboboxes to prevent memory leaks
    typeCombobox = destroyCombobox(typeCombobox, 'type');
    subtypeCombobox = destroyCombobox(subtypeCombobox, 'subtype');

    // Initialize comboboxes and report failures
    const typeOk = initTypeCombobox();
    const subtypeOk = initSubtypeCombobox();

    if (!typeOk || !subtypeOk) {
      // Build failed combobox list using filter/join pattern
      const failedComboboxes = [!typeOk && 'type', !subtypeOk && 'subtype']
        .filter(Boolean)
        .join(' and ');

      console.error('[Cards] CRITICAL: Combobox init failed:', {
        errorId: 'COMBOBOX_INIT_FAILED',
        failed: failedComboboxes,
        typeOk,
        subtypeOk,
      });

      // Disable Add Card functionality
      const addCardBtn = document.getElementById('addCardBtn');
      if (addCardBtn) {
        addCardBtn.disabled = true;
        addCardBtn.title = 'Add Card is unavailable. Please refresh the page.';
      }

      showErrorUI(
        `Card ${failedComboboxes} selection failed to initialize. Please refresh the page.`,
        () => window.location.reload()
      );
    }

    if (missingElements.length > 0) {
      console.warn('[Cards] Missing UI elements:', missingElements);
    }

    // Card list click delegation - handle card clicks and edit button clicks
    bindListener('cardList', 'click', handleCardListClick, missingElements);

    // Mark listeners as attached
    state.listenersAttached = true;
  } catch (error) {
    console.error('[Cards] CRITICAL: Event listener setup failed:', {
      message: error.message,
      stack: error.stack,
      listenersAttached: state.listenersAttached,
    });

    // Show blocking error UI - don't throw as it would halt app initialization
    // User can retry via the refresh button
    showErrorUI('Failed to initialize card controls. Please refresh the page.', () =>
      window.location.reload()
    );
    // Mark as not attached so retry can attempt again
    state.listenersAttached = false;
  }
}

// Handle card list click events (edit button and card clicks)
function handleCardListClick(e) {
  const cardItem = e.target.closest('.card-item');
  if (!cardItem) return;

  const cardId = cardItem.dataset.cardId;
  const card = state.filteredCards.find((c) => c.id === cardId);
  if (!card) return;

  if (e.target.closest('[data-action="edit"]')) {
    e.stopPropagation();
    openCardEditor(card);
    return;
  }

  if (!e.target.closest('.card-item-actions')) {
    openCardEditor(card);
  }
}

// Setup mobile menu toggle functionality
function setupMobileMenu() {
  const mobileMenuToggle = document.getElementById('mobileMenuToggle');
  const sidebar = document.getElementById('sidebar');

  if (!mobileMenuToggle || !sidebar) {
    console.warn('[Cards] Mobile menu elements not found:', {
      toggle: !!mobileMenuToggle,
      sidebar: !!sidebar,
    });
    return;
  }

  // Mobile menu toggle
  mobileMenuToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar.classList.toggle('active');
  });

  // Nav section expand/collapse toggles
  document.querySelectorAll('.nav-section-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('expanded');
      toggle.parentElement?.querySelector('.nav-section-content')?.classList.toggle('expanded');
    });
  });

  // Close sidebar on nav link click (mobile)
  sidebar.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('active');
      }
    });
  });

  // Close sidebar on outside click (mobile)
  document.addEventListener('click', (e) => {
    const isMobile = window.innerWidth <= 768;
    const isOutsideClick = !sidebar.contains(e.target) && !mobileMenuToggle.contains(e.target);
    if (isMobile && isOutsideClick && sidebar.classList.contains('active')) {
      sidebar.classList.remove('active');
    }
  });
}

/**
 * Check if error indicates Firebase Auth SDK is not initialized yet
 * Firebase Auth SDK initialization is asynchronous, this detects when it's not ready
 * @param {Error} error - The error to check
 * @returns {boolean} True if error indicates auth not initialized
 */
function isAuthNotInitializedError(error) {
  const message = String(error.message || '');
  return (
    error.code === 'auth-not-initialized' ||
    error.name === 'AuthNotInitializedError' ||
    message.includes('before auth initialized') ||
    message.includes("can't access property 'onAuthStateChanged'") ||
    message.includes('is null')
  );
}

// Setup auth state listener to show/hide auth-controls
// TODO(#480): Add E2E test coverage for auth listener retry logic
// Test scenarios: SDK not ready on first attempt, max retries exceeded, recovery after transient failure
// Missing tests: retry happens when auth not ready, retry succeeds after init, max retry limit respected,
// user sees UI when retries exhausted, auth listener properly attaches after successful retry
//
// Auth Initialization Retry Logic:
// Firebase Auth SDK initialization is asynchronous. When this function runs before
// the SDK is ready, onAuthStateChanged throws an error. We detect this using
// isAuthNotInitializedError() which checks:
//   1. error.code === 'auth-not-initialized' (preferred, if Firebase provides it)
//   2. error.name === 'AuthNotInitializedError' (custom error name)
//   3. error.message containing 'before auth initialized' (fallback string match)
// TODO(#483): Consolidate to error codes once Firebase provides consistent error.code
//
// On detection, we retry after AUTH_RETRY_MS (500ms) up to authListenerMaxRetries (10)
// times, totaling 5 seconds max wait. This handles cold starts and slow networks.
function setupAuthStateListener() {
  try {
    // Reset retry counter on successful setup
    state.authListenerRetries = 0;

    // Register listener for auth state changes
    // Once Firebase SDK is ready, it guarantees immediate callback with current state.
    if (state.authUnsubscribe) {
      state.authUnsubscribe();
    }
    state.authUnsubscribe = onAuthStateChanged((user) => {
      // Test instrumentation: Track auth state change count
      if (typeof window !== 'undefined') {
        window.__authStateChangeCount = (window.__authStateChangeCount || 0) + 1;
      }

      // Toggle authenticated class based on user presence
      document.body.classList.toggle('authenticated', !!user);
    });

    // Backup auth check for edge cases where onAuthStateChanged doesn't fire
    // due to module scope isolation (e.g., E2E tests with separate auth instances).
    if (state.authTimeoutId) clearTimeout(state.authTimeoutId);
    state.authTimeoutId = setTimeout(() => {
      const currentUser = getAuthInstance()?.currentUser;
      if (currentUser && !document.body.classList.contains('authenticated')) {
        document.body.classList.add('authenticated');
      }
    }, TIMEOUTS.AUTH_RETRY_MS);
  } catch (error) {
    // TODO(#483): Improve error categorization - string matching is fragile
    if (isAuthNotInitializedError(error)) {
      state.authListenerRetries++;
      if (state.authListenerRetries >= state.authListenerMaxRetries) {
        console.error('[Cards] Auth listener setup failed after max retries');
        showErrorUI('Authentication monitoring failed. Please refresh the page.', () =>
          window.location.reload()
        );
        // Don't throw - error UI is shown, app can continue in degraded mode
        // User will need to refresh to get auth-gated features
        return;
      }
      // Auth not ready yet - retry with debug logging for timing diagnostics
      console.debug(
        `[Cards] Auth not ready, retry ${state.authListenerRetries}/${state.authListenerMaxRetries}`
      );
      setTimeout(setupAuthStateListener, TIMEOUTS.AUTH_RETRY_MS);
      return;
    }

    // Only log if it's NOT an expected "auth not ready" error
    console.error('[Cards] Auth state listener setup failed:', error.message);
    showErrorUI('Authentication monitoring failed. Please refresh the page.', () =>
      window.location.reload()
    );
    // Don't throw - error UI is shown, app continues in degraded mode
  }
}

// Expose for E2E testing - allows tests to manually trigger auth UI updates
// when auth state callbacks don't fire due to module isolation
if (typeof window !== 'undefined') {
  window.__updateAuthUI = (user) => document.body.classList.toggle('authenticated', !!user);
}

// Setup hash routing (only once per page load)
function setupHashRouting() {
  if (!state.initialized) {
    window.addEventListener('hashchange', handleHashChange);
  }
}

// Handle hash change events
function handleHashChange() {
  const hash = window.location.hash.slice(1); // Remove '#'

  // Default: clear filters
  state.filters.type = '';
  state.filters.subtype = '';

  // Parse hash using - as separator (valid CSS selector character)
  // This ensures HTMX's querySelector-based scrolling works correctly
  // Format: #library, #library-equipment, #library-equipment-weapon
  if (hash.startsWith('library-')) {
    // Remove 'library-' prefix and split remaining parts
    const remainder = hash.slice('library-'.length);
    const parts = remainder.split('-');

    // #library-equipment - filter by type
    state.filters.type = capitalizeFirstLetter(parts[0]);

    // #library-equipment-weapon - filter by type and subtype
    if (parts.length >= 2) {
      state.filters.subtype = capitalizeFirstLetter(parts[1]);
    }
  }
  // For #library or non-library hashes, filters stay empty (already set above)

  applyFilters();
}

// Helper to capitalize first letter
function capitalizeFirstLetter(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// Set view mode
function setViewMode(mode) {
  if (!updateViewMode(mode)) {
    return; // Invalid mode, warning already logged by updateViewMode
  }

  document.querySelectorAll('.view-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const cardList = document.getElementById('cardList');
  cardList.className = mode === 'grid' ? 'card-grid' : 'card-list';
}

// Handle filter changes
function handleFilterChange() {
  state.filters.search = document.getElementById('searchCards').value.toLowerCase();
  applyFilters();
}

// Apply filters
function applyFilters() {
  // Clear loading state when applying filters (filters run after data is loaded)
  state.loading = false;

  state.filteredCards = state.cards.filter((card) => {
    // Type filter
    if (state.filters.type && card.type !== state.filters.type) {
      return false;
    }

    // Subtype filter
    if (state.filters.subtype && card.subtype !== state.filters.subtype) {
      return false;
    }

    // Search filter
    if (state.filters.search) {
      const searchLower = state.filters.search;
      const titleMatch = card.title?.toLowerCase().includes(searchLower);
      const descMatch = card.description?.toLowerCase().includes(searchLower);
      const tagsMatch = card.tags?.some((tag) => tag.toLowerCase().includes(searchLower));

      if (!titleMatch && !descMatch && !tagsMatch) {
        return false;
      }
    }

    return true;
  });

  renderCards();
  updateSearchPlaceholder();
}

// Update search placeholder with filtered count
function updateSearchPlaceholder() {
  const searchInput = document.getElementById('searchCards');
  if (searchInput) {
    searchInput.placeholder = `Search (${state.filteredCards.length} cards)...`;
  }
}

// Helper to remove loading spinner from card list
function removeLoadingSpinner() {
  const cardList = document.getElementById('cardList');
  const spinner = cardList?.querySelector('.loading-state');
  if (spinner) {
    spinner.remove();
  }
}

// Render cards
function renderCards() {
  try {
    const cardList = document.getElementById('cardList');
    const emptyState = document.getElementById('emptyState');

    if (!cardList || !emptyState) {
      console.warn('Card list or empty state element not found');
      return;
    }

    // If still loading, show loading spinner
    if (state.loading) {
      emptyState.style.display = 'none';
      cardList.style.display = 'grid';

      // Remove existing spinner first (handles HTMX-swapped HTML)
      removeLoadingSpinner();

      // Create fresh loading spinner
      const spinner = document.createElement('div');
      spinner.className = 'loading-state';
      const spinnerEl = document.createElement('div');
      spinnerEl.className = 'spinner';
      const text = document.createElement('p');
      text.textContent = 'Loading cards...';
      spinner.appendChild(spinnerEl);
      spinner.appendChild(text);
      cardList.innerHTML = '';
      cardList.appendChild(spinner);
      return;
    }

    // Not loading - remove loading spinner if present
    removeLoadingSpinner();

    if (state.filteredCards.length === 0) {
      cardList.style.display = 'none';
      emptyState.style.display = 'block';
      cardList.innerHTML = '';
      return;
    }

    cardList.style.display = 'grid';
    emptyState.style.display = 'none';

    // Render cards, skip broken ones
    const renderedCards = [];
    let failedCards = 0;
    state.filteredCards.forEach((card) => {
      try {
        renderedCards.push(renderCardItem(card));
      } catch (error) {
        console.error('[Cards] Error rendering card (possible data corruption):', {
          cardId: card?.id,
          cardTitle: card?.title,
          error: error.message,
        });
        failedCards++;

        // Show error placeholder for this card so it doesn't silently disappear
        const errorPlaceholder = `
          <li class="card-item card-item--error" data-card-id="${escapeHtml(card?.id || 'unknown')}">
            <div class="card-error-message">
              <strong>Error loading card</strong>
              <span>${escapeHtml(card?.title || 'Unknown card')}</span>
            </div>
          </li>
        `;
        renderedCards.push(errorPlaceholder);
      }
    });

    cardList.innerHTML = renderedCards.join('');

    // Warn user immediately if any cards failed to render
    if (failedCards > 0) {
      console.error(`[Cards] ${failedCards}/${state.filteredCards.length} cards failed to render`);
      showWarningBanner(
        `${failedCards} card${failedCards > 1 ? 's' : ''} could not be displayed. Please refresh the page or contact support if the issue persists.`
      );
    }
  } catch (error) {
    console.error('Error rendering cards:', error);
  }
}

// Render a single card item
function renderCardItem(card) {
  const tags = Array.isArray(card.tags) ? card.tags : [];
  const tagsHtml =
    tags.length > 0
      ? `<div class="card-item-tags">${tags.map((tag) => `<span class="card-tag">${escapeHtml(tag)}</span>`).join('')}</div>`
      : '';

  return `
    <div class="card-item" data-card-id="${escapeHtml(card.id)}">
      <div class="card-item-header">
        <h3 class="card-item-title">${escapeHtml(card.title)}</h3>
        <div class="card-item-actions auth-controls">
          <button class="btn-icon" data-action="edit" title="Edit">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12.146.854a.5.5 0 0 1 .708 0l2.292 2.292a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.5 1.207L1 11.707V13h1.293L12.793 2.5 11.5 1.207z"/>
            </svg>
          </button>
        </div>
      </div>
      <span class="card-item-type ${sanitizeCardType(card.type)}">${escapeHtml(card.type)} - ${escapeHtml(card.subtype || 'Unknown')}</span>
      ${tagsHtml}
      ${card.description ? `<p class="card-item-description">${escapeHtml(card.description)}</p>` : ''}
      <div class="card-item-stats">
        ${card.stat1 ? `<span class="card-stat"><strong>Stat:</strong> ${escapeHtml(card.stat1)}</span>` : ''}
        ${card.stat2 ? `<span class="card-stat"><strong>Slots:</strong> ${escapeHtml(card.stat2)}</span>` : ''}
        ${card.cost ? `<span class="card-stat"><strong>Cost:</strong> ${escapeHtml(card.cost)}</span>` : ''}
      </div>
    </div>
  `;
}

// Open card editor modal
function openCardEditor(card = null) {
  try {
    const modal = document.getElementById('cardEditorModal');
    const modalTitle = document.getElementById('modalTitle');
    const deleteBtn = document.getElementById('deleteCardBtn');
    const form = document.getElementById('cardForm');

    // Guard against missing modal elements (can happen during HTMX navigation)
    if (!modal || !form) {
      console.error('[Cards] Card editor modal not found:', {
        modalExists: !!modal,
        formExists: !!form,
      });
      showWarningBanner('Card editor is not available. Please refresh the page to continue.');
      return;
    }

    // Reset form
    form.reset();

    if (card) {
      // Edit mode
      modalTitle.textContent = 'Edit Card';
      deleteBtn.style.display = 'block';

      document.getElementById('cardId').value = card.id;
      document.getElementById('cardTitle').value = card.title || '';
      document.getElementById('cardType').value = card.type || '';
      document.getElementById('cardSubtype').value = card.subtype || '';
      document.getElementById('cardTags').value = Array.isArray(card.tags)
        ? card.tags.join(', ')
        : '';
      document.getElementById('cardDescription').value = card.description || '';
      document.getElementById('cardStat1').value = card.stat1 || '';
      document.getElementById('cardStat2').value = card.stat2 || '';
      document.getElementById('cardCost').value = card.cost || '';
    } else {
      // Add mode
      modalTitle.textContent = 'Add Card';
      deleteBtn.style.display = 'none';
      document.getElementById('cardId').value = '';
    }

    // Refresh combobox options when modal opens
    if (typeCombobox) typeCombobox.refresh();
    if (subtypeCombobox) subtypeCombobox.refresh();

    modal.classList.add('active');
  } catch (error) {
    console.error('[Cards] Error in openCardEditor:', {
      message: error.message,
      stack: error.stack,
      cardId: card?.id,
    });
    showWarningBanner('Failed to open card editor. Please refresh the page and try again.');
  }
}

// Close card editor modal
function closeCardEditor() {
  const modal = document.getElementById('cardEditorModal');
  if (!modal) {
    console.warn('[Cards] closeCardEditor called but modal not found');
    return;
  }
  modal.classList.remove('active');
}

// Validate card form before submission
// TODO(#511): Consolidate validation logic into centralized factory
// TODO(#475): Use createCardData() factory for centralized validation
function validateCardForm() {
  const errors = [];

  // Clear all existing error states
  document.querySelectorAll('.form-group').forEach((group) => {
    group.classList.remove('has-error');
    const errorMsg = group.querySelector('.error-message');
    if (errorMsg) errorMsg.textContent = '';
  });

  // Title validation
  const title = document.getElementById('cardTitle').value.trim();
  if (!title) {
    errors.push({ field: 'cardTitle', message: 'Title is required' });
  } else if (title.length > 100) {
    // TODO(#475): Use shared validation constants (CONSTRAINTS.TITLE_MAX_LENGTH)
    errors.push({ field: 'cardTitle', message: 'Title must be 100 characters or less' });
  }

  // Type validation
  const type = document.getElementById('cardType').value.trim();
  if (!type) {
    errors.push({ field: 'cardType', message: 'Type is required' });
  }

  // Subtype validation
  const subtype = document.getElementById('cardSubtype').value.trim();
  if (!subtype) {
    errors.push({ field: 'cardSubtype', message: 'Subtype is required' });
  }

  // Optional field length validations
  const description = document.getElementById('cardDescription').value.trim();
  if (description.length > 500) {
    errors.push({
      field: 'cardDescription',
      message: 'Description must be 500 characters or less',
    });
  }

  return errors;
}

// Show validation errors inline
function showValidationErrors(errors) {
  errors.forEach((error) => {
    const input = document.getElementById(error.field);
    const formGroup = input?.closest('.form-group');
    if (!formGroup) return;

    formGroup.classList.add('has-error');

    // Find or create error message element
    let errorMsg = formGroup.querySelector('.error-message');
    if (!errorMsg) {
      errorMsg = document.createElement('div');
      errorMsg.className = 'error-message';
      // Insert after the input/combobox
      const insertAfter = input.closest('.combobox') || input;
      insertAfter.parentElement.appendChild(errorMsg);
    }

    // Set the error message - using innerHTML instead of textContent for better compatibility
    if (errorMsg && error && error.message) {
      // Use textContent for plain text (safer against XSS)
      errorMsg.textContent = String(error.message);
    }
    input.classList.add('error');

    // Clear error state on next input (once: true auto-removes listener)
    input.addEventListener(
      'input',
      () => {
        input.classList.remove('error');
        formGroup.classList.remove('has-error');
        errorMsg.textContent = '';
      },
      { once: true }
    );
  });

  // Focus first error field
  if (errors.length > 0) {
    document.getElementById(errors[0].field)?.focus();
  }
}

// Show form-level error in modal
function showFormError(message) {
  const modalBody = document.querySelector('.modal-body');
  if (!modalBody) return;

  // Remove existing error
  modalBody.querySelector('.form-error-banner')?.remove();

  const errorBanner = document.createElement('div');
  errorBanner.className = 'form-error-banner error-banner';

  const errorContent = document.createElement('div');
  errorContent.className = 'error-content';

  const errorText = document.createElement('p');
  errorText.textContent = message;

  errorContent.appendChild(errorText);
  errorBanner.appendChild(errorContent);

  modalBody.insertBefore(errorBanner, modalBody.firstChild);

  // Scroll to top of modal to show error
  modalBody.scrollTop = 0;
}

// Handle card save
async function handleCardSave(e) {
  e.preventDefault();

  // Client-side validation BEFORE submission lock
  const validationErrors = validateCardForm();
  if (validationErrors.length > 0) {
    showValidationErrors(validationErrors);
    return; // Don't proceed with save
  }

  // Prevent double-submit
  if (isSaving) {
    return;
  }
  isSaving = true;

  // Disable Save button during submission
  const saveBtn = document.getElementById('saveCardBtn');
  if (saveBtn) {
    saveBtn.disabled = true;
  }

  const id = document.getElementById('cardId').value;
  // TODO(#475): Extract to createCardData() factory function with centralized validation
  // Factory should validate required fields, trim strings, normalize types
  const cardData = {
    title: document.getElementById('cardTitle').value.trim(),
    type: document.getElementById('cardType').value.trim(),
    subtype: document.getElementById('cardSubtype').value.trim(),
    tags: document
      .getElementById('cardTags')
      .value.split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    description: document.getElementById('cardDescription').value.trim(),
    stat1: document.getElementById('cardStat1').value.trim(),
    stat2: document.getElementById('cardStat2').value.trim(),
    cost: document.getElementById('cardCost').value.trim(),
  };

  // Separate try-catch blocks for Firestore, state updates, and UI operations
  let newCardId;
  try {
    // Firestore write operations
    if (id) {
      await updateCardInDB(id, cardData);
    } else {
      newCardId = await createCardInDB(cardData);
    }
  } catch (error) {
    console.error('[Cards] Error saving card to Firestore:', {
      message: error.message,
      code: error.code,
      stack: error.stack,
      cardData: { title: cardData.title, type: cardData.type },
    });

    // TODO(#1331): Simplify error categorization with lookup object pattern
    // Categorize errors for specific user guidance using switch for cleaner code
    let errorCategory = 'unknown';
    let userMessage = 'Failed to save card. ';

    switch (error.code) {
      case 'permission-denied':
        errorCategory = 'permission';
        userMessage += 'You do not have permission to save cards. Please contact support.';
        break;

      case 'unauthenticated':
        errorCategory = 'authentication';
        userMessage += 'You must be logged in to save cards. Please refresh and sign in again.';
        break;

      case 'unavailable':
        errorCategory = 'unavailable';
        userMessage += 'The server is temporarily unavailable. Please try again in a moment.';
        break;

      case 'invalid-argument':
        errorCategory = 'validation';
        userMessage += `Validation error: ${error.message}`;
        break;

      case 'failed-precondition':
        errorCategory = 'precondition';
        userMessage += 'Operation failed due to server validation. Please check your input.';
        break;

      default:
        // Handle cases where error.code is not set but message indicates specific errors
        // TODO(#483): Remove string matching once Firebase provides consistent error.code
        if (error.message?.includes('required')) {
          errorCategory = 'validation';
          userMessage += `Validation error: ${error.message}`;
        } else if (error.message?.includes('timeout')) {
          errorCategory = 'timeout';
          userMessage += 'The operation timed out. Please check your connection and try again.';
        } else {
          // TODO(#483): Sanitize error messages - don't expose raw Firebase errors to users
          errorCategory = 'unexpected';
          userMessage += `Unexpected error: ${error.message}. If this persists, please refresh the page.`;
        }
    }

    console.error(`[Cards] Save error category: ${errorCategory}`);

    // Show inline error instead of blocking alert
    showFormError(userMessage);
    // Modal stays open - user can retry or fix issues

    // Re-enable Save button and reset submission lock
    if (saveBtn) {
      saveBtn.disabled = false;
    }
    isSaving = false;
    return;
  }

  try {
    // Local state updates
    if (id) {
      const index = state.cards.findIndex((c) => c.id === id);
      if (index !== -1) {
        state.cards[index] = { ...state.cards[index], ...cardData };
      }
    } else {
      state.cards.push({ id: newCardId, ...cardData });
    }
  } catch (error) {
    console.error('[Cards] Error updating local state after save:', {
      message: error.message,
      stack: error.stack,
      cardId: id || newCardId,
    });
    // State corruption is recoverable via refresh - show warning but continue
    // Card is saved in Firestore, so data is safe
    showWarningBanner(
      'Card saved but local display may be outdated. Refresh the page to see all changes.'
    );
  }

  try {
    // UI operations
    closeCardEditor();
    applyFilters();
  } catch (error) {
    console.error('[Cards] Error updating UI after save:', {
      message: error.message,
      stack: error.stack,
    });
    // Card is saved in Firestore, just show warning
    showFormError('Card saved but UI update failed. Please refresh the page to see your card.');
  } finally {
    // Re-enable Save button and reset submission lock
    if (saveBtn) {
      saveBtn.disabled = false;
    }
    isSaving = false;
  }
}

// TODO(#291, #536): Add E2E tests for delete card functionality (confirm, verify removal from UI and Firestore, error paths)
// Delete card
async function deleteCard() {
  const id = document.getElementById('cardId').value;
  if (!id) return;

  // Verify card exists locally before attempting delete
  const cardExists = state.cards.some((c) => c.id === id);
  if (!cardExists) {
    console.warn('[Cards] Card not found in local state:', id);
    showFormError('Card not found. It may have already been deleted.');
    closeCardEditor();
    return;
  }

  if (confirm('Are you sure you want to delete this card?')) {
    try {
      // Delete from Firestore
      await deleteCardInDB(id);

      // Remove from local state
      state.cards = state.cards.filter((c) => c.id !== id);

      closeCardEditor();
      applyFilters();
    } catch (error) {
      console.error('[Cards] Error deleting card:', { id, error: error.message });

      // Handle not-found errors specifically
      if (error.message?.includes('not found') || error.code === 'not-found') {
        showFormError('Card was already deleted. Refreshing list.');
        // Remove from local state anyway
        state.cards = state.cards.filter((c) => c.id !== id);
        closeCardEditor();
        applyFilters();
      } else {
        showFormError(`Error deleting card: ${error.message}`);
      }
    }
  }
}

// Edit card (called from card item)
window.editCard = function (cardId) {
  const card = state.cards.find((c) => c.id === cardId);
  if (card) {
    openCardEditor(card);
  }
};

// Export cards to JSON
function exportCards() {
  const dataStr = JSON.stringify(state.cards, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `fellspiral-cards-${new Date().toISOString().split('T')[0]}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

// Export init function as initCardsPage for use in cards.html
export const initCardsPage = init;

// Note: Initialization is now handled explicitly by:
// 1. cards.html <script> tag for direct page loads
// 2. main.js htmx:afterSwap handler for HTMX navigation
// This prevents double initialization when dynamically importing the module
