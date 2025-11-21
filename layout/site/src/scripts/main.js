/**
 * Layout Module - Main Application
 */

import {
  getAllTemplates,
  getAllPages,
  getAllCardPairs,
  getAllDocuments,
  getAllGroups,
  getAllTags,
  createTemplate,
  createPage,
  createCardPair,
  createDocument,
  createGroup,
  updateDocument,
  deleteDocument
} from './firebase.js';

import { exportDocumentPDF } from './pdf-export.js';

// Application State
const appState = {
  currentTab: 'templates',
  templates: [],
  pages: [],
  cardPairs: [],
  documents: [],
  groups: [],
  tags: [],
  selectedGroupId: null,
  selectedDocumentId: null,
  filterTags: [],
  filterMode: 'or', // 'or' | 'and'
  searchText: ''
};

/**
 * Initialize the application
 */
async function initApp() {
  setupTabNavigation();
  setupEventListeners();
  await loadInitialData();
  renderCurrentTab();
}

/**
 * Set up tab navigation
 */
function setupTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-button');
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.dataset.tab;
      switchTab(tabName);
    });
  });
}

/**
 * Switch to a different tab
 */
function switchTab(tabName) {
  appState.currentTab = tabName;

  // Update tab buttons
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `${tabName}-tab`);
  });

  renderCurrentTab();
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Template actions
  document.getElementById('create-template-btn')?.addEventListener('click', handleCreateTemplate);

  // Card actions
  document.getElementById('create-card-btn')?.addEventListener('click', handleCreateCard);
  document.getElementById('cards-search')?.addEventListener('input', handleSearchCards);

  // Card pair actions
  document.getElementById('create-pair-btn')?.addEventListener('click', handleCreateCardPair);

  // Document actions
  document.getElementById('create-document-btn')?.addEventListener('click', handleCreateDocument);
  document.getElementById('create-group-btn')?.addEventListener('click', handleCreateGroup);
  document.getElementById('back-to-documents-btn')?.addEventListener('click', handleBackToDocuments);
  document.getElementById('save-document-btn')?.addEventListener('click', handleSaveDocument);
  document.getElementById('export-pdf-btn')?.addEventListener('click', handleExportPDF);

  // Filter mode
  document.querySelectorAll('input[name="filter-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      appState.filterMode = e.target.value;
      renderCards();
    });
  });
}

/**
 * Load initial data from Firestore
 */
async function loadInitialData() {
  try {
    const [templates, pages, cardPairs, documents, groups, tags] = await Promise.all([
      getAllTemplates(),
      getAllPages(),
      getAllCardPairs(),
      getAllDocuments(),
      getAllGroups(),
      getAllTags()
    ]);

    appState.templates = templates;
    appState.pages = pages;
    appState.cardPairs = cardPairs;
    appState.documents = documents;
    appState.groups = groups;
    appState.tags = tags;
  } catch (error) {
    showError('Failed to load data');
  }
}

/**
 * Render the current tab content
 */
function renderCurrentTab() {
  switch (appState.currentTab) {
    case 'templates':
      renderTemplates();
      break;
    case 'cards':
      renderCards();
      renderTagFilters();
      break;
    case 'card-pairs':
      renderCardPairs();
      break;
    case 'documents':
      renderDocuments();
      renderGroupTree();
      break;
  }
}

/**
 * Render templates list
 */
function renderTemplates() {
  const container = document.getElementById('templates-list');

  if (appState.templates.length === 0) {
    container.innerHTML = '<p class="empty-state">No templates yet. Create your first template to get started.</p>';
    return;
  }

  container.innerHTML = appState.templates.map(template => `
    <div class="card-item" data-id="${template.id}">
      <h3>${escapeHtml(template.name)}</h3>
      <p class="card-meta">${template.regions?.length || 0} regions</p>
      <p class="card-meta">Created: ${formatDate(template.createdAt)}</p>
    </div>
  `).join('');

  // Add click listeners
  container.querySelectorAll('.card-item').forEach(item => {
    item.addEventListener('click', () => {
      const templateId = item.dataset.id;
      handleEditTemplate(templateId);
    });
  });
}

/**
 * Render cards list
 */
function renderCards() {
  const container = document.getElementById('cards-list');

  // Filter cards
  let filteredCards = appState.pages;

  // Apply search filter
  if (appState.searchText) {
    const searchLower = appState.searchText.toLowerCase();
    filteredCards = filteredCards.filter(card =>
      card.pageName?.toLowerCase().includes(searchLower) ||
      card.content?.toLowerCase().includes(searchLower)
    );
  }

  // Apply tag filters
  if (appState.filterTags.length > 0) {
    filteredCards = filteredCards.filter(card => {
      const cardTags = card.tags || [];
      if (appState.filterMode === 'or') {
        return appState.filterTags.some(tag => cardTags.includes(tag));
      } else {
        return appState.filterTags.every(tag => cardTags.includes(tag));
      }
    });
  }

  if (filteredCards.length === 0) {
    container.innerHTML = '<p class="empty-state">No cards found. Create your first card to get started.</p>';
    return;
  }

  container.innerHTML = filteredCards.map(card => `
    <div class="card-item" data-id="${card.id}">
      <h3>${escapeHtml(card.pageName || 'Untitled')}</h3>
      <p class="card-meta">Template: ${card.templateName || 'None'}</p>
      ${card.tags ? `<div class="tag-list">${card.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
    </div>
  `).join('');

  // Add click listeners
  container.querySelectorAll('.card-item').forEach(item => {
    item.addEventListener('click', () => {
      const cardId = item.dataset.id;
      handleEditCard(cardId);
    });
  });
}

/**
 * Render tag filters
 */
function renderTagFilters() {
  const container = document.getElementById('tag-filter-list');

  if (appState.tags.length === 0) {
    container.innerHTML = '<p class="empty-state">No tags available</p>';
    return;
  }

  container.innerHTML = appState.tags.map(tag => `
    <span class="tag ${appState.filterTags.includes(tag.name) ? 'active' : ''}" data-tag="${escapeHtml(tag.name)}">
      ${escapeHtml(tag.name)}
    </span>
  `).join('');

  // Add click listeners
  container.querySelectorAll('.tag').forEach(tagEl => {
    tagEl.addEventListener('click', () => {
      const tagName = tagEl.dataset.tag;
      toggleTagFilter(tagName);
    });
  });
}

/**
 * Toggle tag filter
 */
function toggleTagFilter(tagName) {
  const index = appState.filterTags.indexOf(tagName);
  if (index === -1) {
    appState.filterTags.push(tagName);
  } else {
    appState.filterTags.splice(index, 1);
  }
  renderCards();
  renderTagFilters();
}

/**
 * Render card pairs list
 */
function renderCardPairs() {
  const container = document.getElementById('pairs-list');

  if (appState.cardPairs.length === 0) {
    container.innerHTML = '<p class="empty-state">No card pairs yet. Create your first card pair for poker cards.</p>';
    return;
  }

  container.innerHTML = appState.cardPairs.map(pair => `
    <div class="card-item" data-id="${pair.id}">
      <h3>${escapeHtml(pair.name)}</h3>
      <p class="card-meta">Front: ${pair.frontCardId ? 'Set' : 'None'} | Back: ${pair.backCardId ? 'Set' : 'None'}</p>
    </div>
  `).join('');

  // Add click listeners
  container.querySelectorAll('.card-item').forEach(item => {
    item.addEventListener('click', () => {
      const pairId = item.dataset.id;
      handleEditCardPair(pairId);
    });
  });
}

/**
 * Render documents list
 */
function renderDocuments() {
  const container = document.getElementById('documents-list');

  // Filter documents by selected group
  let filteredDocuments = appState.documents;
  if (appState.selectedGroupId) {
    filteredDocuments = appState.documents.filter(doc => doc.groupId === appState.selectedGroupId);
  }

  if (filteredDocuments.length === 0) {
    container.innerHTML = '<p class="empty-state">No documents in this group. Create a new document to get started.</p>';
    return;
  }

  container.innerHTML = filteredDocuments.map(doc => `
    <div class="card-item" data-id="${doc.id}">
      <h3>${escapeHtml(doc.name)}</h3>
      <p class="card-meta">${doc.pages?.length || 0} pages</p>
      <p class="card-meta">Modified: ${formatDate(doc.updatedAt)}</p>
    </div>
  `).join('');

  // Add click listeners
  container.querySelectorAll('.card-item').forEach(item => {
    item.addEventListener('click', () => {
      const documentId = item.dataset.id;
      openDocument(documentId);
    });
  });
}

/**
 * Render group tree
 */
function renderGroupTree() {
  const container = document.getElementById('group-tree');

  if (appState.groups.length === 0) {
    container.innerHTML = '<p class="empty-state">No groups yet</p>';
    return;
  }

  // Build hierarchical structure (simplified - flat list for now)
  container.innerHTML = appState.groups.map(group => `
    <div class="tree-item ${group.id === appState.selectedGroupId ? 'active' : ''}" data-id="${group.id}">
      ${escapeHtml(group.name)}
    </div>
  `).join('');

  // Add click listeners
  container.querySelectorAll('.tree-item').forEach(item => {
    item.addEventListener('click', () => {
      const groupId = item.dataset.id;
      selectGroup(groupId);
    });
  });
}

/**
 * Select a group
 */
function selectGroup(groupId) {
  appState.selectedGroupId = groupId;
  renderGroupTree();
  renderDocuments();
}

/**
 * Open document editor
 */
function openDocument(documentId) {
  appState.selectedDocumentId = documentId;
  const document = appState.documents.find(doc => doc.id === documentId);

  if (!document) return;

  document.getElementById('document-list-view').classList.add('hidden');
  document.getElementById('document-editor-view').classList.remove('hidden');
  document.getElementById('document-title').textContent = document.name;

  renderDocumentEditor(document);
}

/**
 * Render document editor
 */
function renderDocumentEditor(document) {
  const container = document.getElementById('document-editor');

  if (!document.pages || document.pages.length === 0) {
    container.innerHTML = '<p class="empty-state">No pages in this document. Add pages to begin composition.</p>';
    return;
  }

  container.innerHTML = document.pages.map((page, index) => `
    <div class="page-item" draggable="true" data-index="${index}">
      <h4>Page ${index + 1}</h4>
      <p>${page.pageName || 'Untitled'}</p>
    </div>
  `).join('');

  // Add drag-and-drop listeners (simplified)
  setupDragAndDrop(container);
}

/**
 * Set up drag and drop for pages
 */
function setupDragAndDrop(container) {
  let draggedElement = null;

  container.querySelectorAll('.page-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedElement = item;
      item.classList.add('dragging');
    });

    item.addEventListener('dragend', (e) => {
      item.classList.remove('dragging');
      draggedElement = null;
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      if (draggedElement && draggedElement !== item) {
        // Reorder pages
        const fromIndex = parseInt(draggedElement.dataset.index);
        const toIndex = parseInt(item.dataset.index);

        const document = appState.documents.find(doc => doc.id === appState.selectedDocumentId);
        if (document) {
          const [movedPage] = document.pages.splice(fromIndex, 1);
          document.pages.splice(toIndex, 0, movedPage);
          renderDocumentEditor(document);
        }
      }
    });
  });
}

/**
 * Event Handlers
 */

function handleCreateTemplate() {
  showMessage('Template creation UI coming soon');
}

function handleCreateCard() {
  showMessage('Card creation UI coming soon');
}

function handleCreateCardPair() {
  showMessage('Card pair creation UI coming soon');
}

async function handleCreateDocument() {
  const name = prompt('Enter document name:');
  if (!name) return;

  try {
    const documentId = await createDocument({
      name,
      groupId: appState.selectedGroupId,
      pages: []
    });

    appState.documents.push({
      id: documentId,
      name,
      groupId: appState.selectedGroupId,
      pages: []
    });

    renderDocuments();
    showMessage('Document created successfully');
  } catch (error) {
    showError('Failed to create document');
  }
}

async function handleCreateGroup() {
  const name = prompt('Enter group name:');
  if (!name) return;

  try {
    const groupId = await createGroup({
      name,
      parentId: null
    });

    appState.groups.push({
      id: groupId,
      name,
      parentId: null
    });

    renderGroupTree();
    showMessage('Group created successfully');
  } catch (error) {
    showError('Failed to create group');
  }
}

function handleBackToDocuments() {
  appState.selectedDocumentId = null;
  document.getElementById('document-list-view').classList.remove('hidden');
  document.getElementById('document-editor-view').classList.add('hidden');
}

async function handleSaveDocument() {
  if (!appState.selectedDocumentId) return;

  try {
    const document = appState.documents.find(doc => doc.id === appState.selectedDocumentId);
    if (!document) return;

    await updateDocument(appState.selectedDocumentId, {
      pages: document.pages
    });

    showMessage('Document saved successfully');
  } catch (error) {
    showError('Failed to save document');
  }
}

async function handleExportPDF() {
  if (!appState.selectedDocumentId) return;

  try {
    const document = appState.documents.find(doc => doc.id === appState.selectedDocumentId);
    if (!document) return;

    await exportDocumentPDF(document, 'combined');
    showMessage('PDF exported successfully');
  } catch (error) {
    showError('Failed to export PDF');
  }
}

function handleEditTemplate(templateId) {
  showMessage('Template editing UI coming soon');
}

function handleEditCard(cardId) {
  showMessage('Card editing UI coming soon');
}

function handleEditCardPair(pairId) {
  showMessage('Card pair editing UI coming soon');
}

function handleSearchCards(e) {
  appState.searchText = e.target.value;
  // Debounce search
  clearTimeout(appState.searchTimeout);
  appState.searchTimeout = setTimeout(() => {
    renderCards();
  }, 300);
}

/**
 * Utility Functions
 */

function showMessage(message) {
  alert(message);
}

function showError(message) {
  alert('Error: ' + message);
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  if (timestamp.toDate) {
    return timestamp.toDate().toLocaleDateString();
  }
  return new Date(timestamp).toLocaleDateString();
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);
