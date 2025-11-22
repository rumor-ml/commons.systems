/**
 * Main library page logic
 * Handles document listing, upload UI, and Firebase Storage integration
 */
import {
  getAllDocuments,
  createDocument,
  deleteDocument,
  uploadFile,
  deleteFile,
  detectFileType,
  formatFileSize
} from './firebase.js';

// State
let documents = [];

// DOM Elements
const uploadBtn = document.getElementById('uploadBtn');
const uploadForm = document.getElementById('uploadForm');
const uploadFormElement = document.getElementById('uploadFormElement');
const cancelUploadBtn = document.getElementById('cancelUploadBtn');
const fileInput = document.getElementById('fileInput');
const uploadProgress = document.getElementById('uploadProgress');
const uploadProgressBar = document.getElementById('uploadProgressBar');
const uploadProgressText = document.getElementById('uploadProgressText');

const loading = document.getElementById('loading');
const emptyState = document.getElementById('emptyState');
const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');
const retryBtn = document.getElementById('retryBtn');
const documentsContainer = document.getElementById('documents');

// Icon map for file types
const iconMap = {
  'pdf': '📕',
  'epub': '📘',
  'md': '📗',
  'cbz': '📙',
  'cbr': '📙'
};

/**
 * Wrap a promise with a timeout to prevent indefinite hanging
 * @param {Promise} promise - Promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise} Promise that rejects if timeout is reached
 */
function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

/**
 * Initialize the app
 */
async function init() {
  setupEventListeners();
  await loadDocuments();
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  uploadBtn.addEventListener('click', showUploadForm);
  cancelUploadBtn.addEventListener('click', hideUploadForm);
  uploadFormElement.addEventListener('submit', handleUpload);
  retryBtn.addEventListener('click', loadDocuments);

  // Close upload form on overlay click
  uploadForm.addEventListener('click', (e) => {
    if (e.target === uploadForm) {
      hideUploadForm();
    }
  });
}

/**
 * Load all documents from Firebase Storage with timeout protection
 */
async function loadDocuments() {
  try {
    showLoading();

    // Add 5 second timeout to prevent indefinite hanging
    documents = await withTimeout(getAllDocuments(), 5000);

    renderDocuments();
  } catch (error) {
    console.error('Error loading documents:', error);
    showError(`Failed to load documents: ${error.message}`);
  }
}

/**
 * Render documents grid
 */
function renderDocuments() {
  hideAllStates();

  if (documents.length === 0) {
    emptyState.hidden = false;
    return;
  }

  documentsContainer.innerHTML = '';

  documents.forEach(doc => {
    const card = createDocumentCard(doc);
    documentsContainer.appendChild(card);
  });

  documentsContainer.hidden = false;
}

/**
 * Create a document card element
 * @param {Object} doc - Document data
 * @returns {HTMLElement} Card element
 */
function createDocumentCard(doc) {
  const card = document.createElement('div');
  card.className = 'document-card';
  card.onclick = () => openDocument(doc.id, doc.type);

  const preview = document.createElement('div');
  preview.className = `doc-preview doc-type-${doc.type}`;
  preview.textContent = iconMap[doc.type] || '📄';

  const info = document.createElement('div');
  info.className = 'doc-info';

  const title = document.createElement('div');
  title.className = 'doc-title';
  title.textContent = doc.name;
  title.title = doc.name;

  const meta = document.createElement('div');
  meta.className = 'doc-meta';
  meta.textContent = doc.type.toUpperCase();

  const size = document.createElement('div');
  size.className = 'doc-size';
  size.textContent = formatFileSize(doc.size);

  info.appendChild(title);
  info.appendChild(meta);
  info.appendChild(size);

  card.appendChild(preview);
  card.appendChild(info);

  return card;
}

/**
 * Open a document in the viewer
 * @param {string} documentId - Document ID
 * @param {string} type - Document type
 */
function openDocument(documentId, type) {
  window.location.href = `viewer.html?id=${documentId}&type=${type}`;
}

/**
 * Show upload form
 */
function showUploadForm() {
  uploadForm.hidden = false;
  fileInput.value = '';
  uploadProgress.hidden = true;
}

/**
 * Hide upload form
 */
function hideUploadForm() {
  uploadForm.hidden = true;
  uploadFormElement.reset();
  uploadProgress.hidden = true;
}

/**
 * Handle file upload
 * @param {Event} e - Submit event
 */
async function handleUpload(e) {
  e.preventDefault();

  const file = fileInput.files[0];
  if (!file) return;

  const fileType = detectFileType(file.name);
  if (fileType === 'unknown') {
    alert('Unsupported file type. Please upload PDF, EPUB, Markdown, CBZ, or CBR files.');
    return;
  }

  try {
    // Show progress
    uploadProgress.hidden = false;
    uploadProgressBar.style.width = '0%';
    uploadProgressText.textContent = 'Uploading...';

    // Disable form
    const submitBtn = uploadFormElement.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    cancelUploadBtn.disabled = true;

    // Upload file to Storage
    const { storagePath, downloadURL } = await uploadFile(file, (progress) => {
      uploadProgressBar.style.width = `${progress}%`;
      uploadProgressText.textContent = `Uploading... ${Math.round(progress)}%`;
    });

    // Create Firestore document
    uploadProgressText.textContent = 'Creating document record...';
    await createDocument({
      name: file.name,
      type: fileType,
      storagePath,
      size: file.size,
      metadata: {
        contentType: file.type,
        originalName: file.name
      }
    });

    // Success
    uploadProgressText.textContent = 'Upload complete!';
    setTimeout(async () => {
      hideUploadForm();
      await loadDocuments();
    }, 1000);

  } catch (error) {
    console.error('Upload error:', error);
    uploadProgressText.textContent = `Upload failed: ${error.message}`;
    alert(`Upload failed: ${error.message}`);

    // Re-enable form
    const submitBtn = uploadFormElement.querySelector('button[type="submit"]');
    submitBtn.disabled = false;
    cancelUploadBtn.disabled = false;
  }
}

/**
 * Show loading state
 */
function showLoading() {
  hideAllStates();
  loading.hidden = false;
}

/**
 * Show error state
 * @param {string} message - Error message
 */
function showError(message) {
  hideAllStates();
  errorMessage.textContent = message;
  errorState.hidden = false;
}

/**
 * Hide all states
 */
function hideAllStates() {
  loading.hidden = true;
  emptyState.hidden = true;
  errorState.hidden = true;
  documentsContainer.hidden = true;
}

// Initialize on load
init();
