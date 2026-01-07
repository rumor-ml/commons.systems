/**
 * Library Navigation Module
 * Builds and manages hierarchical Type → Subtype tree navigation
 * for the Fellspiral card library
 */

import { getAllCards } from './firebase.js';
import cardsData from '../data/cards.json';

/**
 * LibraryNav class - manages the library navigation tree
 */
export class LibraryNav {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;

    if (!this.container) {
      throw new Error('Library nav container not found');
    }

    this.options = {
      onNavigate: options.onNavigate || (() => {}),
      storageKey: options.storageKey || 'fellspiral-library-nav-state',
      ...options,
    };

    this.cards = [];
    this.tree = {};
    this.expandState = this.loadExpandState();
    this.state = 'idle'; // idle, loading, loaded, error
    this.error = null;
  }

  /**
   * Set state and emit event for tests
   * @param {string} state - One of: idle, loading, loaded, error
   * @param {Error|null} error - Error object if state is 'error'
   */
  setState(state, error = null) {
    this.state = state;
    this.error = error;

    // Emit custom event for tests to listen to
    const event = new CustomEvent('librarynav:statechange', {
      detail: { state, error },
    });
    window.dispatchEvent(event);

    // Re-render based on state
    if (state === 'loading' || state === 'error') {
      this.renderStateUI();
    } else if (state === 'loaded') {
      // Render the actual tree when loaded
      this.render();
    }
  }

  /**
   * Render loading or error UI
   */
  renderStateUI() {
    if (!this.container) return;

    // Clear container safely
    this.container.textContent = '';

    if (this.state === 'loading') {
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'library-nav-loading';
      loadingDiv.textContent = 'Loading library...';
      this.container.appendChild(loadingDiv);
      return;
    }

    if (this.state === 'error') {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'library-nav-error';
      errorDiv.textContent = 'Failed to load library';
      this.container.appendChild(errorDiv);
      return;
    }
  }

  /**
   * Load cards from Firestore or fallback to JSON
   */
  async loadCards() {
    this.setState('loading');

    try {
      // Try to load from Firestore
      const cards = await getAllCards();

      if (cards.length > 0) {
        // Verify that we have cards with expected types
        // If we only have a subset (e.g., Equipment and MagicSpell but not Skill, Upgrade, Origin),
        // fall back to static data which is more complete
        const loadedTypes = new Set(cards.map((c) => c.type).filter(Boolean));
        const expectedTypes = new Set(['Equipment', 'Skill', 'Upgrade', 'Origin']);

        // Check if we have most expected types (allow for some variance in test data)
        const hasExpectedTypes = [...expectedTypes].some((type) => loadedTypes.has(type));
        const missingTypes = [...expectedTypes].filter((type) => !loadedTypes.has(type));

        // If we're missing more than 1 expected type, fall back to static data
        // This handles cases where Firestore has partial data from earlier test runs
        if (missingTypes.length > 1) {
          console.warn(
            `Firestore returned incomplete card types (${loadedTypes.size} types, missing: ${missingTypes.join(', ')}). ` +
              `Using fallback static data.`
          );
          this.cards = cardsData || [];
        } else {
          this.cards = cards;
        }
      } else {
        // Fallback to static data
        this.cards = cardsData || [];
      }

      this.buildTree();
      this.setState('loaded');
    } catch (error) {
      console.warn('Failed to load cards from Firestore, using fallback data:', error);
      this.cards = cardsData || [];
      this.buildTree();
      this.setState('loaded'); // Still loaded state since we have fallback data
    }
  }

  /**
   * Build Type → Subtype tree structure with counts
   */
  buildTree() {
    this.tree = {};

    this.cards.forEach((card) => {
      const type = card.type || 'Unknown';
      const subtype = card.subtype || 'Unknown';

      if (!this.tree[type]) {
        this.tree[type] = {
          count: 0,
          subtypes: {},
        };
      }

      if (!this.tree[type].subtypes[subtype]) {
        this.tree[type].subtypes[subtype] = {
          count: 0,
        };
      }

      this.tree[type].count++;
      this.tree[type].subtypes[subtype].count++;
    });
  }

  /**
   * Render the tree navigation using safe DOM methods
   */
  render() {
    if (!this.container) return;

    // Clear container
    this.container.textContent = '';

    if (Object.keys(this.tree).length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'library-nav-empty';
      emptyDiv.textContent = 'No cards available';
      this.container.appendChild(emptyDiv);
      return;
    }

    // Sort types alphabetically
    const sortedTypes = Object.keys(this.tree).sort();

    sortedTypes.forEach((type) => {
      const typeElement = this.createTypeElement(type);
      this.container.appendChild(typeElement);
    });

    this.attachEventListeners();

    // Tell HTMX to process dynamically created anchor tags for boosted navigation
    if (typeof htmx !== 'undefined') {
      htmx.process(this.container);
    }
  }

  /**
   * Create a type element with its subtypes
   */
  createTypeElement(type) {
    const typeData = this.tree[type];
    const typeId = `library-type-${type.toLowerCase()}`;
    const isExpanded = this.expandState[typeId] === true; // Collapsed by default

    // Create type container
    const typeDiv = document.createElement('div');
    typeDiv.className = 'library-nav-type';
    typeDiv.dataset.type = type;

    // Create type toggle/header - now an anchor tag
    const typeToggle = document.createElement('a');
    typeToggle.className = `library-nav-item library-nav-toggle ${isExpanded ? 'expanded' : ''}`;
    typeToggle.dataset.toggle = typeId;
    typeToggle.href = `/cards.html#library-${type.toLowerCase()}`;
    // Disable HTMX boost on cards.html since we handle hash navigation manually
    if (window.location.pathname.includes('cards.html')) {
      typeToggle.setAttribute('hx-boost', 'false');
    }

    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'toggle-icon';
    toggleIcon.textContent = '▶';

    const typeLabel = document.createElement('span');
    typeLabel.className = 'library-nav-label';
    typeLabel.textContent = type;

    const typeCount = document.createElement('span');
    typeCount.className = 'library-nav-count';
    typeCount.textContent = typeData.count;

    typeToggle.appendChild(toggleIcon);
    typeToggle.appendChild(typeLabel);
    typeToggle.appendChild(typeCount);
    typeDiv.appendChild(typeToggle);

    // Create subtypes container
    const subtypesDiv = document.createElement('div');
    subtypesDiv.className = `library-nav-subtypes ${isExpanded ? 'expanded' : ''}`;
    subtypesDiv.dataset.id = typeId;

    // Sort subtypes alphabetically
    const sortedSubtypes = Object.keys(typeData.subtypes).sort();

    sortedSubtypes.forEach((subtype) => {
      const subtypeElement = this.createSubtypeElement(type, subtype);
      subtypesDiv.appendChild(subtypeElement);
    });

    typeDiv.appendChild(subtypesDiv);

    return typeDiv;
  }

  /**
   * Create a subtype element
   */
  createSubtypeElement(type, subtype) {
    const subtypeData = this.tree[type].subtypes[subtype];
    const subtypeId = `library-subtype-${type.toLowerCase()}-${subtype.toLowerCase()}`;
    const isSubtypeExpanded = this.expandState[subtypeId] === true; // Collapsed by default

    const subtypeDiv = document.createElement('div');
    subtypeDiv.className = 'library-nav-subtype';
    subtypeDiv.dataset.type = type;
    subtypeDiv.dataset.subtype = subtype;

    // Create subtype item - now an anchor tag
    const subtypeItem = document.createElement('a');
    subtypeItem.className = `library-nav-item library-nav-subtype-item ${isSubtypeExpanded ? 'expanded' : ''}`;
    subtypeItem.dataset.toggle = subtypeId;
    subtypeItem.href = `/cards.html#library-${type.toLowerCase()}-${subtype.toLowerCase()}`;
    // Disable HTMX boost on cards.html since we handle hash navigation manually
    if (window.location.pathname.includes('cards.html')) {
      subtypeItem.setAttribute('hx-boost', 'false');
    }

    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'toggle-icon';
    toggleIcon.textContent = '';

    const subtypeLabel = document.createElement('span');
    subtypeLabel.className = 'library-nav-label';
    subtypeLabel.textContent = subtype;

    const subtypeCount = document.createElement('span');
    subtypeCount.className = 'library-nav-count';
    subtypeCount.textContent = subtypeData.count;

    subtypeItem.appendChild(toggleIcon);
    subtypeItem.appendChild(subtypeLabel);
    subtypeItem.appendChild(subtypeCount);
    subtypeDiv.appendChild(subtypeItem);

    return subtypeDiv;
  }

  /**
   * Attach event listeners to nav items
   */
  attachEventListeners() {
    if (!this.container) return;

    const isOnCardsPage = window.location.pathname.includes('cards.html');

    // Type clicks - expand/collapse AND navigate
    const typeToggles = this.container.querySelectorAll('.library-nav-type > .library-nav-toggle');
    typeToggles.forEach((toggle) => {
      toggle.addEventListener('click', (e) => {
        // Toggle expansion
        const toggleId = toggle.dataset.toggle;
        this.toggleExpand(toggleId);

        // On cards.html, handle hash navigation manually to prevent HTMX from doing a body swap
        // This keeps the expand state intact
        if (isOnCardsPage) {
          e.preventDefault();
          const type = toggle.closest('.library-nav-type').dataset.type;
          window.location.hash = `library-${type.toLowerCase()}`;
        }
        // On other pages (index.html), let HTMX handle the navigation to cards.html
      });
    });

    // Subtype clicks - navigate
    const subtypeItems = this.container.querySelectorAll('.library-nav-subtype-item');
    subtypeItems.forEach((item) => {
      item.addEventListener('click', (e) => {
        // On cards.html, handle hash navigation manually
        if (isOnCardsPage) {
          e.preventDefault();
          const subtypeDiv = item.closest('.library-nav-subtype');
          const type = subtypeDiv.dataset.type;
          const subtype = subtypeDiv.dataset.subtype;
          window.location.hash = `library-${type.toLowerCase()}-${subtype.toLowerCase()}`;
        }
        // On other pages, let HTMX handle navigation
      });
    });
  }

  /**
   * Toggle expand/collapse state
   */
  toggleExpand(toggleId) {
    const toggle = this.container.querySelector(`[data-toggle="${toggleId}"]`);
    const content = this.container.querySelector(`[data-id="${toggleId}"]`);

    if (!toggle) return;

    const isExpanded = toggle.classList.contains('expanded');

    // Update UI
    toggle.classList.toggle('expanded');
    if (content) {
      content.classList.toggle('expanded');
    }

    // Save state
    this.expandState[toggleId] = !isExpanded;
    this.saveExpandState();
  }

  /**
   * Navigate to a filtered view (deprecated - now using HTMX)
   * Kept for backwards compatibility with hash change events
   */
  navigate({ type, subtype }) {
    // Construct hash
    let hash = '#library';
    if (type) {
      hash += `/${type.toLowerCase()}`;
    }
    if (subtype) {
      hash += `/${subtype.toLowerCase()}`;
    }

    // Update URL (only for hash-based navigation within same page)
    if (window.location.pathname.includes('cards.html')) {
      window.location.hash = hash;
    }

    // Call callback
    this.options.onNavigate({ type, subtype });
  }

  /**
   * Load expand state from localStorage
   */
  loadExpandState() {
    try {
      const stored = localStorage.getItem(this.options.storageKey);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.warn('Failed to load expand state:', error);
      return {};
    }
  }

  /**
   * Save expand state to localStorage
   */
  saveExpandState() {
    try {
      localStorage.setItem(this.options.storageKey, JSON.stringify(this.expandState));
    } catch (error) {
      console.warn('Failed to save expand state:', error);
    }
  }

  /**
   * Initialize the library navigation
   */
  async init() {
    await this.loadCards();
    // No need to call render() - setState('loaded') triggers it
  }
}

/**
 * Initialize library navigation on both index.html and cards.html
 */
export async function initLibraryNav() {
  const container = document.getElementById('libraryNavContainer');

  if (!container) {
    console.warn('Library nav container not found');
    return null;
  }

  const libraryNav = new LibraryNav(container, {
    onNavigate: ({ type, subtype }) => {
      // If we're on cards.html, trigger filtering via hash change
      if (window.location.pathname.includes('cards.html')) {
        // This will be handled by cards.js hash change listener
      }
      // If we're on index.html, HTMX will handle the navigation to cards.html
      // No need to manually set window.location.href
    },
  });

  await libraryNav.init();

  // Ensure the LIBRARY section is expanded by default
  const librarySection = libraryNav.container.closest('.nav-section');
  if (librarySection) {
    const toggle = librarySection.querySelector('.nav-section-toggle');
    if (toggle && !toggle.classList.contains('expanded')) {
      toggle.classList.add('expanded');
    }
  }

  return libraryNav;
}
