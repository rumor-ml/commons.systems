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
  auth,
} from './firebase.js';

// Import auth initialization and state
import { initializeAuth, onAuthStateChanged } from './auth-init.js';

// Import shared navigation
import { initSidebarNav } from './sidebar-nav.js';
// Import library navigation
import { initLibraryNav } from './library-nav.js';

// Import cards data for initial seeding
import cardsData from '../data/cards.json';

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
};

// Subtype mappings
const SUBTYPES = {
  Equipment: ['Weapon', 'Armor'],
  Skill: ['Attack', 'Defense', 'Tenacity', 'Core'],
  Upgrade: ['Weapon', 'Armor'],
  Foe: ['Undead', 'Vampire', 'Beast', 'Demon'],
  Origin: ['Human', 'Elf', 'Dwarf', 'Orc'],
};

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
  try {
    // Initialize authentication
    initializeAuth();

    // Initialize shared sidebar navigation (generates nav DOM)
    initSidebarNav();

    // Setup auth state listener
    setupAuthStateListener();

    // Initialize library navigation (populates library section)
    // Don't await - let it load in background to avoid blocking card display
    initLibraryNav().catch((error) => {
      console.error('Failed to initialize library navigation:', error);
    });

    // Setup hash routing
    setupHashRouting();

    // Setup UI components - these don't need data
    setupEventListeners();
    // Note: setupMobileMenu is called separately before init() to ensure
    // it runs synchronously before any async operations

    // Set loading state before rendering to keep loading indicator visible
    state.loading = true;
    renderCards(); // Will keep loading state visible

    // Load data asynchronously WITHOUT blocking page load
    loadCards()
      .then(() => {
        // Update UI with loaded data
        renderCards();

        // Apply hash route if present
        handleHashChange();
      })
      .catch((error) => {
        console.error('Failed to load cards:', error);
        showWarningBanner('Failed to load cards from cloud. Using cached data.');
        // Still render cards with fallback data
        renderCards();
        handleHashChange();
      });
  } catch (error) {
    // Log initialization errors for debugging
    console.error('Card Manager init error:', error);

    // Show user-friendly error UI
    showErrorUI('Failed to initialize Card Manager. Please try again.', () => {
      document.querySelector('.error-banner')?.remove();
      init();
    });
  }
}

// Helper to wrap a promise with a timeout
function withTimeout(promise, ms, errorMessage = 'Operation timed out') {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(errorMessage)), ms)
  );
  return Promise.race([promise, timeoutPromise]);
}

// Load cards from Firestore
async function loadCards() {
  const FIRESTORE_TIMEOUT_MS = 5000;

  try {
    state.loading = true;
    state.error = null;

    // Try to load from Firestore with a timeout to prevent hanging
    // On slow/unresponsive Firestore connections, fall back to static data quickly
    const cards = await withTimeout(getAllCards(), FIRESTORE_TIMEOUT_MS, 'Firestore query timeout');

    if (cards.length > 0) {
      state.cards = cards;
    } else {
      // If no cards in Firestore, only attempt to seed if user is authenticated
      // This avoids expensive failed import attempts on production with empty Firestore
      if (auth.currentUser) {
        // Also apply timeout to import and subsequent fetch
        await withTimeout(
          importCardsFromData(cardsData),
          FIRESTORE_TIMEOUT_MS,
          'Import cards timeout'
        );
        state.cards = await withTimeout(
          getAllCards(),
          FIRESTORE_TIMEOUT_MS,
          'Firestore query timeout after import'
        );
      } else {
        // Not authenticated - use static data immediately to avoid slow import attempts
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

    // Show warning to user
    showWarningBanner(
      'Unable to connect to Firestore. Using local data only. Changes will not be saved.'
    );
  } finally {
    // ALWAYS clear loading state, even if there's an unexpected error
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

    addCardBtn.addEventListener('click', () => openCardEditor());
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
    const cardType = document.getElementById('cardType');
    const modalBackdrop = document.querySelector('.modal-backdrop');

    if (closeModalBtn) closeModalBtn.addEventListener('click', closeCardEditor);
    if (cancelModalBtn) cancelModalBtn.addEventListener('click', closeCardEditor);
    if (deleteCardBtn) deleteCardBtn.addEventListener('click', deleteCard);
    if (cardForm) cardForm.addEventListener('submit', handleCardSave);
    if (cardType) cardType.addEventListener('change', updateSubtypeOptions);
    if (modalBackdrop) modalBackdrop.addEventListener('click', closeCardEditor);
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
    onAuthStateChanged((user) => {
      if (user) {
        // User is logged in - show auth controls
        document.body.classList.add('authenticated');
      } else {
        // User is logged out - hide auth controls
        document.body.classList.remove('authenticated');
      }
    });
  } catch (error) {
    console.error('Error setting up auth state listener:', error);
  }
}

// Setup hash routing
function setupHashRouting() {
  window.addEventListener('hashchange', handleHashChange);
}

// Handle hash change events
function handleHashChange() {
  const hash = window.location.hash.slice(1); // Remove '#'

  if (!hash || !hash.startsWith('library')) {
    // Clear filters if no library hash
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

    // If still loading, keep the loading state visible (don't hide cardList)
    if (state.loading) {
      emptyState.style.display = 'none';
      return;
    }

    if (state.filteredCards.length === 0) {
      cardList.style.display = 'none';
      emptyState.style.display = 'block';
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
      ? `<div class="card-item-tags">${tags.map((tag) => `<span class="card-tag">${tag}</span>`).join('')}</div>`
      : '';

  return `
    <div class="card-item" data-card-id="${card.id}">
      <div class="card-item-header">
        <h3 class="card-item-title">${card.title}</h3>
        <div class="card-item-actions auth-controls">
          <button class="btn-icon" onclick="event.stopPropagation(); editCard('${card.id}')" title="Edit">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12.146.854a.5.5 0 0 1 .708 0l2.292 2.292a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.5 1.207L1 11.707V13h1.293L12.793 2.5 11.5 1.207z"/>
            </svg>
          </button>
        </div>
      </div>
      <span class="card-item-type ${card.type}">${card.type} - ${card.subtype || 'Unknown'}</span>
      ${tagsHtml}
      ${card.description ? `<p class="card-item-description">${card.description}</p>` : ''}
      <div class="card-item-stats">
        ${card.stat1 ? `<span class="card-stat"><strong>Stat:</strong> ${card.stat1}</span>` : ''}
        ${card.stat2 ? `<span class="card-stat"><strong>Slots:</strong> ${card.stat2}</span>` : ''}
        ${card.cost ? `<span class="card-stat"><strong>Cost:</strong> ${card.cost}</span>` : ''}
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

  // Reset form
  form.reset();

  if (card) {
    // Edit mode
    modalTitle.textContent = 'Edit Card';
    deleteBtn.style.display = 'block';

    document.getElementById('cardId').value = card.id;
    document.getElementById('cardTitle').value = card.title || '';
    document.getElementById('cardType').value = card.type || '';
    updateSubtypeOptions();
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
    updateSubtypeOptions();
  }

  modal.classList.add('active');
}

// Close card editor modal
function closeCardEditor() {
  const modal = document.getElementById('cardEditorModal');
  modal.classList.remove('active');
}

// Update subtype options in form
function updateSubtypeOptions() {
  const type = document.getElementById('cardType').value;
  const subtypeSelect = document.getElementById('cardSubtype');

  subtypeSelect.innerHTML = '<option value="">Select subtype...</option>';

  if (type && SUBTYPES[type]) {
    SUBTYPES[type].forEach((subtype) => {
      const option = document.createElement('option');
      option.value = subtype;
      option.textContent = subtype;
      subtypeSelect.appendChild(option);
    });
  }
}

// Handle card save
async function handleCardSave(e) {
  e.preventDefault();

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

  try {
    if (id) {
      // Update existing card in Firestore
      await updateCardInDB(id, cardData);

      // Update local state
      const index = state.cards.findIndex((c) => c.id === id);
      if (index !== -1) {
        state.cards[index] = { ...state.cards[index], ...cardData };
      }
    } else {
      // Create new card in Firestore
      const newCardId = await createCardInDB(cardData);

      // Add to local state
      state.cards.push({ id: newCardId, ...cardData });
    }

    closeCardEditor();
    applyFilters();
  } catch (error) {
    console.error('Error saving card:', error);
    alert(`Error saving card: ${error.message}`);
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

// Initialize card-specific functionality only (no sidebar reinit)
// Called when navigating to cards.html via HTMX
export async function initCardsPage() {
  try {
    // Initialize authentication
    initializeAuth();

    // Initialize shared sidebar navigation (generates nav DOM)
    initSidebarNav();

    // Setup auth state listener
    setupAuthStateListener();

    // Initialize library navigation (populates library section)
    // Don't await - let it load in background to avoid blocking card display
    initLibraryNav().catch((error) => {
      console.error('Failed to initialize library navigation:', error);
    });

    // Setup hash routing
    setupHashRouting();

    // Setup UI components
    setupEventListeners();
    setupMobileMenu();

    // Set loading state before rendering to keep loading indicator visible
    state.loading = true;
    renderCards(); // Will keep loading state visible

    // Load data asynchronously WITHOUT blocking
    loadCards()
      .then(() => {
        // Update UI with loaded data
        renderCards();
        // Apply hash route if present
        handleHashChange();
      })
      .catch((error) => {
        console.error('Failed to load cards:', error);
        showWarningBanner('Failed to load cards from cloud. Using cached data.');
        // Still render cards with fallback data
        renderCards();
        handleHashChange();
      });
  } catch (error) {
    console.error('Failed to initialize Card Manager:', error);
    showErrorUI('Failed to initialize Card Manager. Please try again.', () => {
      document.querySelector('.error-banner')?.remove();
      initCardsPage();
    });
  }
}

// Note: Initialization is now handled explicitly by:
// 1. cards.html <script> tag for direct page loads
// 2. main.js htmx:afterSwap handler for HTMX navigation
// This prevents double initialization when dynamically importing the module
