/**
 * Card Manager - CRUD Operations and Tree Navigation
 */

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

// Submission lock to prevent double-submit
let isSaving = false;

// HTML escape utility to prevent XSS
function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
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
};

// Reset state for fresh initialization
function resetState() {
  state.cards = [];
  state.filteredCards = [];
  state.selectedNode = null;
  state.viewMode = 'grid';
  state.filters = { type: '', subtype: '', search: '' };
  state.loading = false;
  state.error = null;
  // Don't reset initialized - that tracks global listeners
}

// ==========================================================================
// Combobox Component Functions
// ==========================================================================

// Get unique types from cards
function getTypesFromCards() {
  const types = new Set();
  state.cards.forEach((card) => {
    if (card.type) {
      types.add(card.type);
    }
  });
  return Array.from(types).sort();
}

// Get unique subtypes for a given type
function getSubtypesForType(type) {
  if (!type) return [];
  const subtypes = new Set();
  state.cards.forEach((card) => {
    if (card.type === type && card.subtype) {
      subtypes.add(card.subtype);
    }
  });
  return Array.from(subtypes).sort();
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

  // Show listbox
  function show() {
    refresh();
    combobox.classList.add('open');
    input.setAttribute('aria-expanded', 'true');
  }

  // Hide listbox
  function hide() {
    combobox.classList.remove('open');
    input.setAttribute('aria-expanded', 'false');
    highlightedIndex = -1;
  }

  // Toggle listbox
  function toggleListbox() {
    if (combobox.classList.contains('open')) {
      hide();
    } else {
      show();
    }
  }

  // Refresh options based on input value
  function refresh() {
    const inputValue = input.value.trim().toLowerCase();
    const availableOptions = getOptions();

    // Filter options based on input
    currentOptions = availableOptions.filter((option) =>
      option.toLowerCase().includes(inputValue)
    );

    // Add "Add new" option if input doesn't match any option exactly
    const exactMatch = availableOptions.some(
      (option) => option.toLowerCase() === inputValue
    );
    const showAddNew = inputValue && !exactMatch;

    // Clear listbox
    while (listbox.firstChild) {
      listbox.removeChild(listbox.firstChild);
    }

    if (currentOptions.length === 0 && !showAddNew) {
      const li = document.createElement('li');
      li.className = 'combobox-option';
      li.textContent = 'No options available';
      li.style.fontStyle = 'italic';
      li.style.color = 'var(--color-text-tertiary)';
      listbox.appendChild(li);
      return;
    }

    currentOptions.forEach((option) => {
      const li = document.createElement('li');
      li.className = 'combobox-option';
      li.textContent = option;
      li.setAttribute('role', 'option');
      li.dataset.value = option;

      if (option === input.value) {
        li.classList.add('selected');
      }

      li.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur event
        selectOption(option);
      });

      listbox.appendChild(li);
    });

    // Add "Add new" option
    if (showAddNew) {
      const li = document.createElement('li');
      li.className = 'combobox-option combobox-option--new';
      li.textContent = `Add "${input.value}"`;
      li.setAttribute('role', 'option');
      li.dataset.value = input.value;

      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectOption(input.value);
      });

      listbox.appendChild(li);
    }
  }

  // Select an option
  function selectOption(value) {
    input.value = value;
    hide();
    if (onSelect) {
      onSelect(value);
    }
  }

  // Highlight option by index
  function highlightOption(index) {
    const options = listbox.querySelectorAll('.combobox-option');
    if (index < 0 || index >= options.length) return;

    options.forEach((opt, i) => {
      if (i === index) {
        opt.classList.add('highlighted');
        opt.scrollIntoView({ block: 'nearest' });
      } else {
        opt.classList.remove('highlighted');
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
    // Delay to allow click events on options
    setTimeout(() => {
      hide();
    }, 200);
  });

  input.addEventListener('keydown', (e) => {
    const options = listbox.querySelectorAll('.combobox-option');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!combobox.classList.contains('open')) {
        show();
      } else {
        highlightOption(Math.min(highlightedIndex + 1, options.length - 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (combobox.classList.contains('open')) {
        highlightOption(Math.max(highlightedIndex - 1, 0));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (combobox.classList.contains('open') && highlightedIndex >= 0) {
        const highlightedOption = options[highlightedIndex];
        if (highlightedOption) {
          selectOption(highlightedOption.dataset.value);
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hide();
    } else if (e.key === 'Tab') {
      hide();
    }
  });

  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    input.focus();
    toggleListbox();
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!combobox.contains(e.target)) {
      hide();
    }
  });

  return { show, hide, toggle: toggleListbox, refresh };
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

// Show warning banner
function showWarningBanner(message) {
  const container = document.querySelector('.card-container');
  if (!container) return;

  const warningDiv = document.createElement('div');
  warningDiv.className = 'warning-banner';

  const warningContent = document.createElement('div');
  warningContent.className = 'warning-content';

  const warningText = document.createElement('p');
  warningText.textContent = message;
  warningContent.appendChild(warningText);

  warningDiv.appendChild(warningContent);
  container.insertBefore(warningDiv, container.firstChild);
}

// Initialize the app
async function init() {
  // Guard against concurrent initialization
  if (state.initializing) {
    console.log('[Cards] Already initializing, skipping duplicate init call');
    return;
  }

  // Guard against double initialization
  if (state.initialized) {
    console.log('[Cards] Re-initializing after HTMX navigation');

    // CRITICAL: Clear hardcoded loading spinner from HTMX-swapped HTML
    const cardList = document.getElementById('cardList');
    if (cardList) {
      const hardcodedSpinner = cardList.querySelector('.loading-state');
      if (hardcodedSpinner) {
        console.log('[Cards] Removing hardcoded spinner from HTMX swap');
        hardcodedSpinner.remove();
      }
    }

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
    console.log('[Cards] Starting initialization');
    state.initializing = true;

    // CRITICAL: Clear any hardcoded loading spinner from HTMX-swapped HTML FIRST
    const cardList = document.getElementById('cardList');
    if (cardList) {
      const hardcodedSpinner = cardList.querySelector('.loading-state');
      if (hardcodedSpinner) {
        console.log('[Cards] Removing hardcoded spinner from HTML');
        hardcodedSpinner.remove();
      }
    }

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
    console.log('[Cards] Event listeners and UI setup complete');

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
    console.error('Card Manager init error:', error);

    // Show user-friendly error UI
    showErrorUI('Failed to initialize Card Manager. Please try again.', () => {
      document.querySelector('.error-banner')?.remove();
      state.initialized = false; // Reset so retry can work
      init();
    });
  } finally {
    state.initializing = false;
    console.log('[Cards] Initialization complete');
  }
}

// Load cards from Firestore
async function loadCards() {
  const FIRESTORE_TIMEOUT_MS = 5000;

  try {
    state.loading = true;
    state.error = null;

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
    console.error('Error loading cards:', error);
    state.error = error.message;

    // Fallback to static data if Firestore fails
    console.warn('Falling back to static JSON data');
    state.cards = cardsData || [];
    state.filteredCards = [...state.cards];

    showWarningBanner('Unable to connect to Firestore. Using local data only.');
  } finally {
    // ALWAYS clear loading state
    state.loading = false;
  }
}

// Setup event listeners
function setupEventListeners() {
  try {
    // Toolbar buttons
    const addCardBtn = document.getElementById('addCardBtn');
    const importCardsBtn = document.getElementById('importCardsBtn');
    const exportCardsBtn = document.getElementById('exportCardsBtn');

    if (!addCardBtn || !importCardsBtn || !exportCardsBtn) {
      console.error('Missing toolbar buttons');
      return;
    }

    // Add debounce to Add Card button to prevent rapid clicks
    let addCardDebounce = null;
    addCardBtn.addEventListener('click', () => {
      if (addCardDebounce) {
        console.log('[Cards] Add Card click ignored - debounce active');
        return;
      }
      addCardDebounce = setTimeout(() => { addCardDebounce = null; }, 300);
      openCardEditor();
    });

    importCardsBtn.addEventListener('click', importCards);
    exportCardsBtn.addEventListener('click', exportCards);

    // View mode
    document.querySelectorAll('.view-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => setViewMode(btn.dataset.mode));
    });

    // Filters
    const searchCards = document.getElementById('searchCards');

    if (searchCards) searchCards.addEventListener('input', handleFilterChange);

    // Modal
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const deleteCardBtn = document.getElementById('deleteCardBtn');
    const cardForm = document.getElementById('cardForm');
    const modalBackdrop = document.querySelector('.modal-backdrop');

    if (closeModalBtn) closeModalBtn.addEventListener('click', closeCardEditor);
    if (cancelModalBtn) cancelModalBtn.addEventListener('click', closeCardEditor);
    if (deleteCardBtn) deleteCardBtn.addEventListener('click', deleteCard);
    if (cardForm) cardForm.addEventListener('submit', handleCardSave);
    if (modalBackdrop) modalBackdrop.addEventListener('click', closeCardEditor);

    // Initialize comboboxes
    initTypeCombobox();
    initSubtypeCombobox();
  } catch (error) {
    console.error('Error setting up event listeners:', error);
  }
}

// Setup mobile menu toggle functionality
function setupMobileMenu() {
  try {
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const sidebar = document.getElementById('sidebar');

    if (!mobileMenuToggle) {
      console.warn('Mobile menu toggle button not found');
      return;
    }

    if (!sidebar) {
      console.warn('Sidebar element not found');
      return;
    }

    mobileMenuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('active');
    });

    // Nav section toggle handlers (for library section expand/collapse)
    const navSectionToggles = document.querySelectorAll('.nav-section-toggle');
    navSectionToggles.forEach((toggle) => {
      toggle.addEventListener('click', () => {
        toggle.classList.toggle('expanded');
        const content = toggle.parentElement.querySelector('.nav-section-content');
        if (content) {
          content.classList.toggle('expanded');
        }
      });
    });

    // Close sidebar when clicking a nav link on mobile
    const navItems = sidebar.querySelectorAll('.nav-item');
    navItems.forEach((item) => {
      item.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          sidebar.classList.remove('active');
        }
      });
    });

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
      if (
        window.innerWidth <= 768 &&
        document.body.contains(mobileMenuToggle) &&
        !sidebar.contains(e.target) &&
        !mobileMenuToggle?.contains(e.target) &&
        sidebar.classList.contains('active')
      ) {
        sidebar.classList.remove('active');
      }
    });
  } catch (error) {
    console.error('Error setting up mobile menu:', error);
  }
}

// Setup auth state listener to show/hide auth-controls
function setupAuthStateListener() {
  try {
    // Register listener for auth state changes
    // NOTE: onAuthStateChanged fires immediately with the current user (or null)
    // when the listener is registered, so this handles both initial state and changes
    const unsubscribe = onAuthStateChanged((user) => {
      console.log('[Cards] Auth state changed:', user ? `User ${user.uid}` : 'No user');
      if (user) {
        // User is logged in - show auth controls
        document.body.classList.add('authenticated');
      } else {
        // User is logged out - hide auth controls
        document.body.classList.remove('authenticated');
      }
    });

    // BACKUP: Also check current state after a brief delay
    // This handles the edge case where onAuthStateChanged's immediate callback
    // hasn't fired yet due to Firebase SDK still initializing
    setTimeout(() => {
      const auth = getAuthInstance();
      if (auth?.currentUser && !document.body.classList.contains('authenticated')) {
        console.log('[Cards] Backup auth check - current user detected:', auth.currentUser.uid);
        document.body.classList.add('authenticated');
      }
    }, 500);
  } catch (error) {
    console.error('Error setting up auth state listener:', error);
  }
}

// Expose for E2E testing - allows tests to manually trigger auth UI updates
// when auth state callbacks don't fire due to module isolation
if (typeof window !== 'undefined') {
  window.__updateAuthUI = (user) => {
    if (user) {
      document.body.classList.add('authenticated');
    } else {
      document.body.classList.remove('authenticated');
    }
  };
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
    const loadingState = cardList.querySelector('.loading-state');
    if (loadingState) {
      loadingState.remove();
    }

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
    state.filteredCards.forEach((card) => {
      try {
        renderedCards.push(renderCardItem(card));
      } catch (error) {
        console.warn('Error rendering card:', card, error);
      }
    });

    cardList.innerHTML = renderedCards.join('');

    // Attach card click handlers
    cardList.querySelectorAll('.card-item').forEach((item, index) => {
      try {
        item.addEventListener('click', (e) => {
          if (!e.target.closest('.card-item-actions')) {
            openCardEditor(state.filteredCards[index]);
          }
        });
      } catch (error) {
        console.warn('Error attaching card click handler:', error);
      }
    });
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
          <button class="btn-icon" onclick="event.stopPropagation(); editCard('${escapeHtml(card.id)}')" title="Edit">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12.146.854a.5.5 0 0 1 .708 0l2.292 2.292a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.5 1.207L1 11.707V13h1.293L12.793 2.5 11.5 1.207z"/>
            </svg>
          </button>
        </div>
      </div>
      <span class="card-item-type ${escapeHtml(card.type)}">${escapeHtml(card.type)} - ${escapeHtml(card.subtype || 'Unknown')}</span>
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
    console.error('[Cards] Card editor modal not found. Please refresh the page.');
    alert('Card editor is not available. Please refresh the page to continue.');
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

// Handle card save
async function handleCardSave(e) {
  console.log('[Cards] handleCardSave called');
  e.preventDefault();

  // Prevent double-submit
  if (isSaving) {
    console.log('[Cards] Save already in progress, ignoring duplicate submission');
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
    type: document.getElementById('cardType').value,
    subtype: document.getElementById('cardSubtype').value,
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

  console.log('[Cards] Card data collected:', { id, title: cardData.title });

  try {
    if (id) {
      console.log('[Cards] Updating existing card:', id);
      // Update existing card in Firestore
      await updateCardInDB(id, cardData);
      console.log('[Cards] Card updated successfully');

      // Update local state
      const index = state.cards.findIndex((c) => c.id === id);
      if (index !== -1) {
        state.cards[index] = { ...state.cards[index], ...cardData };
      }
    } else {
      console.log('[Cards] Creating new card, auth.currentUser:', getAuthInstance()?.currentUser?.uid);
      // Create new card in Firestore
      const newCardId = await createCardInDB(cardData);
      console.log('[Cards] Card created successfully:', newCardId);

      // Add to local state
      state.cards.push({ id: newCardId, ...cardData });
    }

    console.log('[Cards] Closing card editor');
    closeCardEditor();
    console.log('[Cards] Applying filters');
    applyFilters();
    console.log('[Cards] Save complete');
  } catch (error) {
    console.error('[Cards] Error saving card:', error);
    alert(`Error saving card: ${error.message}`);
    console.log('[Cards] Closing card editor after error');
    closeCardEditor(); // Always close modal, even on error
  } finally {
    // Re-enable Save button and reset submission lock
    if (saveBtn) {
      saveBtn.disabled = false;
    }
    isSaving = false;
  }
}

// Delete card
async function deleteCard() {
  const id = document.getElementById('cardId').value;
  if (!id) return;

  if (confirm('Are you sure you want to delete this card?')) {
    try {
      // Delete from Firestore
      await deleteCardInDB(id);

      // Remove from local state
      state.cards = state.cards.filter((c) => c.id !== id);

      closeCardEditor();
      applyFilters();
    } catch (error) {
      console.error('Error deleting card:', error);
      alert(`Error deleting card: ${error.message}`);
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

// Import cards from rules.md
async function importCards() {
  if (confirm('This will import cards from the parsed rules.md file to Firestore. Continue?')) {
    try {
      const importedCards = cardsData || [];

      // Import to Firestore
      const results = await importCardsFromData(importedCards);

      // Reload cards from Firestore
      state.cards = await getAllCards();
      state.filteredCards = [...state.cards];

      applyFilters();

      alert(
        `Import complete!\n` +
          `Created: ${results.created}\n` +
          `Updated: ${results.updated}\n` +
          `Errors: ${results.errors}`
      );
    } catch (error) {
      console.error('Error importing cards:', error);
      alert(`Error importing cards: ${error.message}`);
    }
  }
}

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
