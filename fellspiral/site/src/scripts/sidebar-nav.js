/**
 * Shared sidebar navigation module
 * Renders consistent navigation across all pages using safe DOM methods
 */

/**
 * Create a navigation item element
 * @param {string} href - The link href
 * @param {string} text - The link text
 * @param {boolean} isChild - Whether this is a child nav item
 * @returns {HTMLAnchorElement}
 */
function createNavItem(href, text, isChild = false) {
  const link = document.createElement('a');
  link.href = href;
  link.className = isChild ? 'nav-item nav-item-child' : 'nav-item';
  link.textContent = text;
  return link;
}

/**
 * Create a navigation section element
 * @param {string} title - The section title
 * @param {Array<{href: string, text: string}>} items - The section items
 * @param {string} linkPrefix - Prefix for links
 * @returns {HTMLDivElement}
 */
function createNavSection(title, items, linkPrefix) {
  const section = document.createElement('div');
  section.className = 'nav-section';

  const titleDiv = document.createElement('div');
  titleDiv.className = 'nav-section-title';
  titleDiv.textContent = title;
  section.appendChild(titleDiv);

  items.forEach((item) => {
    section.appendChild(createNavItem(linkPrefix + item.href, item.text, true));
  });

  return section;
}

/**
 * Create the Library section with toggle and container for dynamic content
 * @returns {HTMLDivElement}
 */
function createLibrarySection() {
  const section = document.createElement('div');
  section.className = 'nav-section nav-section-library';

  const toggle = document.createElement('div');
  toggle.className = 'nav-section-title nav-section-toggle';
  toggle.dataset.section = 'library';

  const icon = document.createElement('span');
  icon.className = 'toggle-icon';
  icon.textContent = '▶';
  toggle.appendChild(icon);

  toggle.appendChild(document.createTextNode(' Library'));
  section.appendChild(toggle);

  const container = document.createElement('div');
  container.id = 'libraryNavContainer';
  container.className = 'nav-section-content';
  section.appendChild(container);

  return section;
}

/**
 * Build the complete navigation structure using DOM methods
 * @param {Object} options - Configuration options
 * @param {boolean} options.isHomepage - Whether we're on the homepage
 * @returns {DocumentFragment}
 */
export function buildNavigation(options = {}) {
  const { isHomepage = false } = options;
  const linkPrefix = isHomepage ? '#' : '/#';

  const fragment = document.createDocumentFragment();

  // Introduction link
  fragment.appendChild(createNavItem(linkPrefix + 'introduction', 'Introduction'));

  // Core Concepts section
  fragment.appendChild(
    createNavSection(
      'Core Concepts',
      [
        { href: 'initiative', text: 'Initiative' },
        { href: 'roles', text: 'Referee & Antagonist' },
        { href: 'damage', text: 'Damage System' },
        { href: 'rounds', text: 'Combat Rounds' },
      ],
      linkPrefix
    )
  );

  // Combat Rules section
  fragment.appendChild(
    createNavSection(
      'Combat Rules',
      [
        { href: 'zones', text: 'Zones' },
        { href: 'actions', text: 'Actions' },
        { href: 'trading-initiative', text: 'Trading Initiative' },
        { href: 'conditions', text: 'Conditions' },
      ],
      linkPrefix
    )
  );

  // Library section (populated by library-nav.js)
  fragment.appendChild(createLibrarySection());

  // Simulator and Examples links
  fragment.appendChild(createNavItem(linkPrefix + 'simulator', 'Combat Simulator'));
  fragment.appendChild(createNavItem(linkPrefix + 'examples', 'Examples'));

  return fragment;
}

/**
 * Initialize the sidebar navigation
 * Detects the current page and renders appropriate navigation
 */
export function initSidebarNav() {
  const navContainer = document.querySelector('.sidebar-nav');
  if (!navContainer) {
    console.warn('Sidebar nav container not found');
    return;
  }

  // Detect if we're on the homepage
  const isHomepage =
    window.location.pathname === '/' ||
    window.location.pathname === '/index.html' ||
    window.location.pathname.endsWith('/index.html');

  // Clear existing content and append new navigation
  navContainer.textContent = '';
  navContainer.appendChild(buildNavigation({ isHomepage }));

  // Set up nav section toggle handlers
  const navSectionToggles = navContainer.querySelectorAll('.nav-section-toggle');
  navSectionToggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('expanded');
    });
  });
}
