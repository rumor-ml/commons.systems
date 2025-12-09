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
} from './firebase.js';

// Import auth initialization
import { initializeAuth } from './auth-init.js';

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

    // Setup UI components - these don't need data
    setupEventListeners();
    // Note: setupMobileMenu is called separately before init() to ensure
    // it runs synchronously before any async operations
    renderTree(); // Will show "no cards" initially
    renderCards(); // Will show empty state

    // Load data asynchronously WITHOUT blocking page load
    loadCards()
      .then(() => {
        // Update UI with loaded data
        renderTree();
        renderCards();
        updateStats();
      })
      .catch((error) => {
        console.error('Failed to load cards:', error);
        showWarningBanner('Failed to load cards from cloud. Using cached data.');
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

// Load cards from Firestore
async function loadCards() {
  try {
    state.loading = true;
    state.error = null;

    // Try to load from Firestore
    const cards = await getAllCards();

    if (cards.length > 0) {
      state.cards = cards;
    } else {
      // If no cards in Firestore, seed from JSON data
      await importCardsFromData(cardsData);
      state.cards = await getAllCards();
    }

    state.filteredCards = [...state.cards];
    state.loading = false;
  } catch (error) {
    console.error('Error loading cards:', error);
    state.error = error.message;
    state.loading = false;

    // Fallback to static data if Firestore fails
    console.warn('Falling back to static JSON data');
    state.cards = cardsData || [];
    state.filteredCards = [...state.cards];

    // Show warning to user
    showWarningBanner(
      'Unable to connect to Firestore. Using local data only. Changes will not be saved.'
    );
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

    // Tree controls
    const expandAllBtn = document.getElementById('expandAllBtn');
    const collapseAllBtn = document.getElementById('collapseAllBtn');
    const refreshTreeBtn = document.getElementById('refreshTreeBtn');
    const treeSearch = document.getElementById('treeSearch');

    if (expandAllBtn) expandAllBtn.addEventListener('click', () => expandCollapseAll(true));
    if (collapseAllBtn) collapseAllBtn.addEventListener('click', () => expandCollapseAll(false));
    if (refreshTreeBtn) refreshTreeBtn.addEventListener('click', refreshTree);
    if (treeSearch) treeSearch.addEventListener('input', handleTreeSearch);

    // View mode
    document.querySelectorAll('.view-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => setViewMode(btn.dataset.mode));
    });

    // Filters
    const filterType = document.getElementById('filterType');
    const filterSubtype = document.getElementById('filterSubtype');
    const searchCards = document.getElementById('searchCards');

    if (filterType) filterType.addEventListener('change', handleFilterChange);
    if (filterSubtype) filterSubtype.addEventListener('change', handleFilterChange);
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

// Build and render tree
function renderTree() {
  try {
    const treeContainer = document.getElementById('cardTree');
    if (!treeContainer) {
      console.warn('Tree container not found');
      return;
    }

    const tree = buildTree();
    treeContainer.innerHTML = renderTreeNodes(tree);

    // Attach tree node click handlers
    treeContainer.querySelectorAll('.tree-node-content').forEach((node) => {
      node.addEventListener('click', handleTreeNodeClick);
    });
  } catch (error) {
    console.error('Error rendering tree:', error);
  }
}

// Build tree structure
function buildTree() {
  const tree = {};

  state.cards.forEach((card) => {
    const type = card.type || 'Unknown';
    const subtype = card.subtype || 'Unknown';

    if (!tree[type]) {
      tree[type] = {
        count: 0,
        subtypes: {},
      };
    }

    if (!tree[type].subtypes[subtype]) {
      tree[type].subtypes[subtype] = {
        count: 0,
        cards: [],
      };
    }

    tree[type].count++;
    tree[type].subtypes[subtype].count++;
    tree[type].subtypes[subtype].cards.push(card);
  });

  return tree;
}

// Render tree nodes
function renderTreeNodes(tree) {
  let html = '';

  Object.keys(tree)
    .sort()
    .forEach((type) => {
      const typeData = tree[type];
      const typeId = `type-${type.toLowerCase()}`;

      html += `
      <div class="tree-node" data-level="type" data-value="${type}">
        <div class="tree-node-content" data-node-id="${typeId}">
          <span class="tree-node-toggle">▶</span>
          <span class="tree-node-icon">📁</span>
          <span class="tree-node-label">${type}</span>
          <span class="tree-node-count">${typeData.count}</span>
        </div>
        <div class="tree-node-children" data-parent="${typeId}">
    `;

      Object.keys(typeData.subtypes)
        .sort()
        .forEach((subtype) => {
          const subtypeData = typeData.subtypes[subtype];
          const subtypeId = `subtype-${type.toLowerCase()}-${subtype.toLowerCase()}`;

          html += `
        <div class="tree-node tree-node-leaf" data-level="subtype" data-type="${type}" data-subtype="${subtype}">
          <div class="tree-node-content" data-node-id="${subtypeId}">
            <span class="tree-node-toggle empty"></span>
            <span class="tree-node-icon">📄</span>
            <span class="tree-node-label">${subtype}</span>
            <span class="tree-node-count">${subtypeData.count}</span>
          </div>
        </div>
      `;
        });

      html += `
        </div>
      </div>
    `;
    });

  return html;
}

// Handle tree node click
function handleTreeNodeClick(e) {
  try {
    const content = e.currentTarget;
    if (!content) return;

    const node = content.closest('.tree-node');
    if (!node) return;

    const level = node.dataset.level;

    // Toggle expansion for type nodes
    if (level === 'type') {
      const toggle = content.querySelector('.tree-node-toggle');
      const children = content.parentElement.querySelector('.tree-node-children');

      if (toggle) toggle.classList.toggle('expanded');
      if (children) children.classList.toggle('expanded');
    }

    // Apply selection
    document.querySelectorAll('.tree-node-content').forEach((n) => n.classList.remove('selected'));
    content.classList.add('selected');

    // Filter cards based on selection
    if (level === 'type') {
      const type = node.dataset.value;
      filterCardsByTree(type, null);
    } else if (level === 'subtype') {
      const type = node.dataset.type;
      const subtype = node.dataset.subtype;
      filterCardsByTree(type, subtype);
    }
  } catch (error) {
    console.error('Error handling tree node click:', error);
  }
}

// Filter cards by tree selection
function filterCardsByTree(type, subtype) {
  state.filters.type = type || '';
  state.filters.subtype = subtype || '';

  // Update filter dropdowns
  document.getElementById('filterType').value = type || '';
  updateSubtypeFilterOptions(type);
  document.getElementById('filterSubtype').value = subtype || '';

  applyFilters();
}

// Expand/collapse all tree nodes
function expandCollapseAll(expand) {
  document.querySelectorAll('.tree-node-toggle').forEach((toggle) => {
    if (!toggle.classList.contains('empty')) {
      if (expand) {
        toggle.classList.add('expanded');
      } else {
        toggle.classList.remove('expanded');
      }
    }
  });

  document.querySelectorAll('.tree-node-children').forEach((children) => {
    if (expand) {
      children.classList.add('expanded');
    } else {
      children.classList.remove('expanded');
    }
  });
}

// Refresh tree and reload from Firestore
async function refreshTree() {
  try {
    state.loading = true;
    state.cards = await getAllCards();
    state.filteredCards = [...state.cards];
    state.loading = false;

    renderTree();
    applyFilters();
    updateStats();
  } catch (error) {
    console.error('Error refreshing cards:', error);
    state.loading = false;
    alert(`Error refreshing cards: ${error.message}`);
  }
}

// Handle tree search
function handleTreeSearch(e) {
  const query = e.target.value.toLowerCase();

  document.querySelectorAll('.tree-node').forEach((node) => {
    const label = node.querySelector('.tree-node-label').textContent.toLowerCase();
    const match = label.includes(query);

    node.style.display = match ? 'block' : 'none';
  });
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
  state.filters.type = document.getElementById('filterType').value;
  state.filters.subtype = document.getElementById('filterSubtype').value;
  state.filters.search = document.getElementById('searchCards').value.toLowerCase();

  // Update subtype options when type changes
  if (e.target.id === 'filterType') {
    updateSubtypeFilterOptions(state.filters.type);
  }

  applyFilters();
}

// Update subtype filter options
function updateSubtypeFilterOptions(type) {
  const subtypeSelect = document.getElementById('filterSubtype');
  subtypeSelect.innerHTML = '<option value="">All Subtypes</option>';

  if (type && SUBTYPES[type]) {
    SUBTYPES[type].forEach((subtype) => {
      const option = document.createElement('option');
      option.value = subtype;
      option.textContent = subtype;
      subtypeSelect.appendChild(option);
    });
  } else {
    // Show all subtypes from all cards
    const uniqueSubtypes = [...new Set(state.cards.map((c) => c.subtype))].filter(Boolean).sort();
    uniqueSubtypes.forEach((subtype) => {
      const option = document.createElement('option');
      option.value = subtype;
      option.textContent = subtype;
      subtypeSelect.appendChild(option);
    });
  }
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
        <div class="card-item-actions">
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

// Update stats
function updateStats() {
  document.getElementById('statTotal').textContent = state.cards.length;

  const statsByType = state.cards.reduce((acc, card) => {
    acc[card.type] = (acc[card.type] || 0) + 1;
    return acc;
  }, {});

  document.getElementById('statEquipment').textContent = statsByType.Equipment || 0;
  document.getElementById('statSkills').textContent = statsByType.Skill || 0;
  document.getElementById('statUpgrades').textContent = statsByType.Upgrade || 0;
  document.getElementById('statFoes').textContent = statsByType.Foe || 0;
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
    renderTree();
    applyFilters();
    updateStats();
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
      renderTree();
      applyFilters();
      updateStats();
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

      renderTree();
      applyFilters();
      updateStats();

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

// Parse URL hash and apply filters
function parseHashAndFilter() {
  const hash = window.location.hash;

  // Match #library, #library/type, or #library/type/subtype
  const match = hash.match(/^#library(?:\/([^/]+))?(?:\/([^/]+))?$/i);

  if (!match) {
    return;
  }

  const rawType = match[1] || '';
  const rawSubtype = match[2] || '';

  // Convert to proper case (first letter uppercase)
  const type = rawType ? rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase() : '';
  const subtype = rawSubtype
    ? rawSubtype.charAt(0).toUpperCase() + rawSubtype.slice(1).toLowerCase()
    : '';

  // Apply filters
  state.filters.type = type;
  state.filters.subtype = subtype;

  // Update filter dropdowns
  const filterType = document.getElementById('filterType');
  const filterSubtype = document.getElementById('filterSubtype');

  if (filterType) {
    filterType.value = type;
  }

  if (type) {
    updateSubtypeFilterOptions(type);
  }

  if (filterSubtype) {
    filterSubtype.value = subtype;
  }

  applyFilters();
}

// Update URL hash when filters change
function updateHashFromFilters() {
  const type = state.filters.type;
  const subtype = state.filters.subtype;

  let hash = '#library';
  if (type) {
    hash += `/${type.toLowerCase()}`;
  }
  if (subtype) {
    hash += `/${subtype.toLowerCase()}`;
  }

  // Update hash without triggering hashchange event
  if (window.location.hash !== hash) {
    history.replaceState(null, '', hash);
  }
}

// Initialize application
function initializeApp() {
  setupMobileMenu();
  init();

  // Handle initial hash on page load (after data loads)
  // We need to wait for cards to load before filtering
  const originalLoadCards = loadCards;
  window._hashRoutingInitialized = false;

  // Listen for hash changes
  window.addEventListener('hashchange', parseHashAndFilter);

  // Parse initial hash after DOM is ready and cards are loaded
  // The hash parsing is deferred to allow cards to load first
  setTimeout(() => {
    parseHashAndFilter();
    window._hashRoutingInitialized = true;
  }, 100);
}

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
