/**
 * Card Library - CRUD Operations and Tree Navigation
 */

// TODO(#305): Improve error logging for library nav initialization
// TODO(#305): Show warning banner when event listener setup fails
// TODO(#305): Add JSDoc for getAllCards() explaining error handling

// Import Firestore operations
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
import { initializeAuth, onAuthStateChanged } from './auth-init.js';

// Import shared navigation
import { initSidebarNav } from './sidebar-nav.js';
// Import library navigation
import { initLibraryNav } from './library-nav.js';

// Import cards data for initial seeding
import cardsData from '../data/cards.json';

// Submission lock to prevent double-submit on rapid clicks or Enter key spam.
// Set at start of handleCardSave(), cleared in finally block.
// Separate from button.disabled to handle Enter key submissions.
let isSaving = false;

// HTML escape utility to prevent XSS attacks
// Uses browser's built-in escaping via textContent property.
// Use for ALL user-generated content (titles, descriptions, types, etc.)
// TODO(#305): Add concrete XSS attack examples (e.g., <script>alert('xss')</script> in titles)
// NOTE: Only escapes HTML context - do NOT use for JS strings or URLs
function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// Whitelist of valid card types for class attribute
const VALID_CARD_TYPES = ['Equipment', 'Skill', 'Upgrade', 'Foe', 'Origin'];
function sanitizeCardType(type) {
  return VALID_CARD_TYPES.includes(type) ? type : '';
}

// State management
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

// Reset state for fresh initialization
function resetState() {
  isSaving = false; // Reset submission lock
  state.cards = [];
  state.filteredCards = [];
  state.selectedNode = null;
  state.viewMode = 'grid';
  state.filters = { type: '', subtype: '', search: '' };
  state.loading = false;
  state.error = null;
  state.listenersAttached = false; // Reset listeners flag
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

// Get unique types from cards
function getTypesFromCards() {
  return [...new Set(state.cards.filter((c) => c.type).map((c) => c.type))].sort();
}

// Get unique subtypes for a given type
function getSubtypesForType(type) {
  if (!type) return [];
  return [
    ...new Set(state.cards.filter((c) => c.type === type && c.subtype).map((c) => c.subtype)),
  ].sort();
}

// Generic combobox controller
function createCombobox(config) {
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
  let currentOptions = [];

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

  function toggleListbox() {
    if (combobox.classList.contains('open')) {
      hide();
    } else {
      show();
    }
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
    try {
      const inputValue = input.value.trim().toLowerCase();
      const availableOptions = getOptions();

      // Clear any previous error state
      listbox.classList.remove('combobox-error');

      // Filter options based on input
      currentOptions = availableOptions.filter((opt) => opt.toLowerCase().includes(inputValue));

      // Check if input exactly matches an existing option
      const exactMatch = availableOptions.some((opt) => opt.toLowerCase() === inputValue);
      const showAddNew = inputValue && !exactMatch;

      // Clear listbox
      listbox.replaceChildren();

      // Show "no options" message if nothing to display
      if (currentOptions.length === 0 && !showAddNew) {
        const li = document.createElement('li');
        li.className = 'combobox-option';
        li.textContent = 'No options available';
        li.style.cssText = 'font-style: italic; color: var(--color-text-tertiary);';
        listbox.appendChild(li);
        return;
      }

      // Add matching options
      currentOptions.forEach((opt) => listbox.appendChild(createOption(opt, opt)));

      // Add "Add new" option for custom values
      if (showAddNew) {
        listbox.appendChild(
          createOption(input.value, `Add "${input.value}"`, 'combobox-option--new')
        );
      }
    } catch (error) {
      // TODO(#285): Categorize errors and provide specific user guidance (DOM vs data vs unexpected)
      // Log comprehensive error details for debugging
      console.error('[Cards] Error refreshing combobox options:', {
        comboboxId: comboboxId,
        inputValue: input.value,
        message: error.message,
        stack: error.stack,
        errorType: error.constructor.name,
      });

      // Show error state in UI
      listbox.replaceChildren();
      listbox.classList.add('combobox-error');

      const errorLi = document.createElement('li');
      errorLi.className = 'combobox-option combobox-error-message';
      errorLi.textContent = 'Error loading options. Please try again.';
      listbox.appendChild(errorLi);
    }
  }

  // Select an option
  function selectOption(value) {
    input.value = value;
    hide();
    if (onSelect) {
      // Let callback errors propagate - caller is responsible for error handling
      onSelect(value);
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
  input.addEventListener('focus', () => {
    show();
  });

  input.addEventListener('input', () => {
    refresh();
    highlightedIndex = -1;
  });

  input.addEventListener('blur', () => {
    // CRITICAL: 200ms delay prevents race condition in dropdown click handling
    // Event sequence on option click: mousedown → blur → mouseup → click
    // The mousedown handler calls e.preventDefault() to suppress blur, but this
    // TODO(#286): Specify which browsers/scenarios need this or test comprehensively
    // only works for some browsers/scenarios. The delay ensures that even if blur
    // fires immediately, the mousedown handler has time to execute selectOption()
    // before the dropdown is hidden. 200ms provides margin for slower event loops.
    // Alternative approaches considered: mousedown-only handling (accessibility issues),
    // relatedTarget checking (unreliable cross-browser).
    setTimeout(() => {
      hide();
    }, 200);
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
    // EVENT SEQUENCE FIX: Check dropdown state BEFORE calling input.focus()
    // Problem: When toggle is clicked while dropdown is closed:
    //   1. Click handler calls input.focus()
    //   2. Focus event listener immediately shows dropdown (adds 'open' class)
    //   3. If we then check state and call show(), dropdown is already open
    //   4. Calling show() again when already open causes visual flash/flicker
    // Solution: Check if dropdown is already open before calling focus()
    //   - If closed: call focus() which triggers show() via focus event
    //   - If open: call hide() directly to close it
    // This is an event ordering issue, not a race condition (no async/timing involved)
    if (combobox.classList.contains('open')) {
      hide();
    } else {
      input.focus(); // This will trigger show() via focus event
    }
  });

  // Close on outside click
  const outsideClickHandler = (e) => {
    if (!combobox.contains(e.target)) {
      hide();
    }
  };
  document.addEventListener('click', outsideClickHandler);

  return {
    show,
    hide,
    toggle: toggleListbox,
    refresh,
    destroy: () => document.removeEventListener('click', outsideClickHandler),
  };
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
    onSelect: null,
  });
  if (!subtypeCombobox) {
    console.error('[Cards] Failed to initialize subtype combobox - DOM elements missing');
    return false;
  }
  return true;
}

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

// Create a banner element with optional icon
function createBanner(message, options = {}) {
  const { className = 'warning-banner', icon = null, extraClass = null } = options;

  const banner = document.createElement('div');
  banner.className = extraClass ? `${extraClass} ${className}` : className;

  const content = document.createElement('div');
  content.className = 'warning-content';

  if (icon) {
    const iconSpan = document.createElement('span');
    iconSpan.textContent = icon;
    iconSpan.style.cssText = 'font-size: 1.25rem; flex-shrink: 0;';
    content.appendChild(iconSpan);
  }

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

// Show demo data indicator - persistent visual indicator for fallback mode
function showDemoDataIndicator(message) {
  const container = document.querySelector('.card-container');
  if (!container) return;

  // Remove any existing demo data indicator
  document.querySelector('.demo-data-indicator')?.remove();

  const indicator = createBanner(message, {
    extraClass: 'demo-data-indicator',
    icon: '\u26A0\uFE0F', // Warning emoji
  });
  container.insertBefore(indicator, container.firstChild);
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

    // Note: Authentication is initialized globally in main.js DOMContentLoaded
    // Don't call initializeAuth() here to avoid duplicates

    // Initialize shared sidebar navigation (generates nav DOM)
    initSidebarNav();

    // Setup auth state listener
    setupAuthStateListener();

    // Initialize library navigation (populates library section)
    // Don't await - let it load in background to avoid blocking card display
    initLibraryNav().catch((error) => {
      console.error('Failed to initialize library navigation:', error);
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
  const FIRESTORE_TIMEOUT_MS = 5000;

  try {
    state.loading = true;
    state.error = null;

    // Remove any existing demo data indicator on successful load attempt
    document.querySelector('.demo-data-indicator')?.remove();

    // Try to load from Firestore (now has built-in 5s timeout)
    const cards = await getAllCards();

    if (cards.length > 0) {
      state.cards = cards;
    } else {
      // If no cards in Firestore, only attempt to seed if authenticated
      if (getAuthInstance()?.currentUser) {
        await withTimeout(
          importCardsFromData(cardsData),
          FIRESTORE_TIMEOUT_MS,
          'Import cards timeout'
        );
        state.cards = await getAllCards();
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

    // Auth errors: prompt login
    if (error.code === 'permission-denied' || error.code === 'unauthenticated') {
      state.cards = [];
      state.filteredCards = [];
      showErrorUI('Please log in to view your cards.', () => {
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

    // All other errors: show error without demo data fallback
    state.cards = [];
    state.filteredCards = [];
    showErrorUI(
      `Failed to load cards: ${error.message}. Please refresh to try again.`,
      () => {
        document.querySelector('.error-banner')?.remove();
        loadCards();
      }
    );
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
        }, 300);
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

    // Clean up existing comboboxes to prevent memory leaks
    if (typeCombobox) {
      try {
        typeCombobox.destroy();
      } catch (error) {
        console.error('[Cards] Failed to destroy type combobox:', {
          message: error.message,
          stack: error.stack,
          errorType: error.constructor.name,
        });
      }
    }
    if (subtypeCombobox) {
      try {
        subtypeCombobox.destroy();
      } catch (error) {
        console.error('[Cards] Failed to destroy subtype combobox:', {
          message: error.message,
          stack: error.stack,
          errorType: error.constructor.name,
        });
      }
    }

    // Initialize comboboxes and report failures
    const typeOk = initTypeCombobox();
    const subtypeOk = initSubtypeCombobox();

    if (!typeOk || !subtypeOk) {
      const failed = !typeOk && !subtypeOk ? 'type and subtype' : !typeOk ? 'type' : 'subtype';

      console.error('[Cards] CRITICAL: Combobox init failed:', {
        errorId: 'COMBOBOX_INIT_FAILED',
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
        `Card ${failed} selection failed to initialize. Please refresh the page.`,
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

    // TODO(#305): Show blocking error UI instead of continuing in broken state
    // Re-throw critical errors so caller (init) can handle them
    throw new Error(`Event listener setup failed: ${error.message}`);
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

// Setup auth state listener to show/hide auth-controls
function setupAuthStateListener() {
  try {
    // Reset retry counter on successful setup
    state.authListenerRetries = 0;

    // Register listener for auth state changes
    // NOTE: onAuthStateChanged is provided by auth-init.js module. If this code runs
    // before auth-init.js is fully loaded, onAuthStateChanged will be undefined,
    // causing "before auth initialized" errors. The retry logic below handles this
    // module initialization race by retrying every 500ms until auth-init exports
    // are available (up to 10 retries = 5 seconds). Once available, Firebase SDK
    // guarantees immediate callback invocation with current auth state.
    // TODO(#286): Clarify why ES6 static imports don't prevent this race (dynamic init?)
    if (state.authUnsubscribe) {
      state.authUnsubscribe();
    }
    state.authUnsubscribe = onAuthStateChanged((user) => {
      console.log('[Cards] Auth state changed:', user ? `User ${user.uid}` : 'No user');

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
        console.log('[Cards] Backup auth check - user detected:', currentUser.uid);
        document.body.classList.add('authenticated');
      }
    }, 500);
  } catch (error) {
    const errorStr = String(error.message || error);

    // Expected: auth not initialized yet - retry with limit
    if (errorStr.includes('before auth initialized')) {
      state.authListenerRetries++;

      if (state.authListenerRetries >= state.authListenerMaxRetries) {
        console.error('[Cards] CRITICAL: Auth listener setup failed after max retries:', {
          retries: state.authListenerRetries,
          maxRetries: state.authListenerMaxRetries,
        });
        showErrorUI(
          'Authentication monitoring failed. Please refresh the page.',
          () => window.location.reload(),
          { blocking: true }
        );
        throw error; // Don't continue in broken state
      }

      console.log(
        `[Cards] Auth not ready yet, retry ${state.authListenerRetries}/${state.authListenerMaxRetries} in 500ms`
      );
      setTimeout(() => {
        setupAuthStateListener();
      }, 500);
      return;
    }

    // Unexpected errors are critical - show blocking error
    console.error('[Cards] CRITICAL: Auth state listener setup failed:', {
      errorId: 'AUTH_LISTENER_FAILED',
      message: error.message,
      stack: error.stack,
    });

    showErrorUI(
      'Authentication monitoring failed. Please refresh the page.',
      () => window.location.reload(),
      { blocking: true }
    );

    throw error; // Don't continue in broken state
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

  if (!hash || !hash.startsWith('library')) {
    // Clear filters if no library hash
    state.filters.type = '';
    state.filters.subtype = '';
    applyFilters();
    return;
  }

  // Parse hash using - as separator (valid CSS selector character)
  // This ensures HTMX's querySelector-based scrolling works correctly
  // Format: #library, #library-equipment, #library-equipment-weapon
  if (hash === 'library') {
    // #library - show all cards
    state.filters.type = '';
    state.filters.subtype = '';
  } else if (hash.startsWith('library-')) {
    // Remove 'library-' prefix and split remaining parts
    const remainder = hash.slice('library-'.length);
    const parts = remainder.split('-');

    if (parts.length === 1) {
      // #library-equipment - filter by type
      const type = capitalizeFirstLetter(parts[0]);
      state.filters.type = type;
      state.filters.subtype = '';
    } else if (parts.length >= 2) {
      // #library-equipment-weapon - filter by type and subtype
      const type = capitalizeFirstLetter(parts[0]);
      const subtype = capitalizeFirstLetter(parts[1]);
      state.filters.type = type;
      state.filters.subtype = subtype;
    }
  }

  // Apply filters
  applyFilters();
}

// Helper to capitalize first letter
function capitalizeFirstLetter(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// Set view mode
function setViewMode(mode) {
  state.viewMode = mode;

  document.querySelectorAll('.view-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const cardList = document.getElementById('cardList');
  cardList.className = mode === 'grid' ? 'card-grid' : 'card-list';
}

// Handle filter changes
function handleFilterChange(e) {
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

      // Always remove existing spinner first (handles HTMX-swapped HTML)
      const existingSpinner = cardList.querySelector('.loading-state');
      if (existingSpinner) {
        existingSpinner.remove();
      }

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
      }
    });

    cardList.innerHTML = renderedCards.join('');

    // TODO(#305): Lower render failure threshold to 1 card and show which cards failed
    // TODO(#331): Current threshold >10% means users don't see missing cards
    // Warn if significant failures
    if (failedCards > 0) {
      console.error(`[Cards] ${failedCards}/${state.filteredCards.length} cards failed to render`);
      if (failedCards > state.filteredCards.length * 0.1) {
        showWarningBanner('Some cards could not be displayed. Please refresh the page.');
      }
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
}

// Close card editor modal
function closeCardEditor() {
  const modal = document.getElementById('cardEditorModal');
  modal.classList.remove('active');
}

// Validate card form before submission
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

    errorMsg.textContent = error.message;
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

  try {
    if (id) {
      await updateCardInDB(id, cardData);

      // Update local state
      const index = state.cards.findIndex((c) => c.id === id);
      if (index !== -1) {
        state.cards[index] = { ...state.cards[index], ...cardData };
      }
    } else {
      const newCardId = await createCardInDB(cardData);
      state.cards.push({ id: newCardId, ...cardData });
    }

    closeCardEditor();
    applyFilters();
  } catch (error) {
    console.error('[Cards] Error saving card:', error);

    // Categorize errors for user-friendly messages
    let userMessage = 'Failed to save card. ';
    if (error.code === 'permission-denied' || error.message?.includes('authenticated')) {
      userMessage += 'You must be logged in to save cards.';
    } else if (error.message?.includes('timeout')) {
      userMessage += 'The operation timed out. Please check your connection and try again.';
    } else if (error.message?.includes('required')) {
      userMessage += error.message;
    } else if (error.code === 'unavailable') {
      userMessage += 'The server is temporarily unavailable. Please try again in a moment.';
    } else {
      userMessage += `Error: ${error.message}. If this persists, please refresh the page.`;
    }

    // Show inline error instead of blocking alert
    showFormError(userMessage);
    // Modal stays open - user can retry or fix issues
  } finally {
    // Re-enable Save button and reset submission lock
    if (saveBtn) {
      saveBtn.disabled = false;
    }
    isSaving = false;
  }
}

// TODO(#291): Add E2E tests for delete card functionality (confirm, verify removal from UI and Firestore, error paths)
// Delete card
async function deleteCard() {
  const id = document.getElementById('cardId').value;
  if (!id) return;

  // Verify card exists locally before attempting delete
  const cardExists = state.cards.some((c) => c.id === id);
  if (!cardExists) {
    console.warn('[Cards] Card not found in local state:', id);
    alert('Card not found. It may have already been deleted. Closing editor.');
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
        alert('Card was already deleted. Refreshing list.');
        // Remove from local state anyway
        state.cards = state.cards.filter((c) => c.id !== id);
        closeCardEditor();
        applyFilters();
      } else {
        alert(`Error deleting card: ${error.message}`);
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
