// Document viewer routing and initialization
import { getDocument, getFileURL } from './firebase.js';
import { initPDFViewer } from './pdf-viewer.js';
import { initMarkdownViewer } from './markdown-viewer.js';
import { initEPUBViewer } from './epub-viewer.js';
import { initComicViewer } from './comic-viewer.js';
import { setupKeyboardNav } from './keyboard.js';

// Parse URL parameters
const params = new URLSearchParams(window.location.search);
const documentId = params.get('id');
const documentType = params.get('type');

// DOM Elements
const viewerLoading = document.getElementById('viewerLoading');
const viewerError = document.getElementById('viewerError');
const viewerErrorMessage = document.getElementById('viewerErrorMessage');

const pdfViewer = document.getElementById('pdfViewer');
const markdownViewer = document.getElementById('markdownViewer');
const epubViewer = document.getElementById('epubViewer');
const comicViewer = document.getElementById('comicViewer');

/**
 * Initialize viewer
 */
async function init() {
  if (!documentId || !documentType) {
    showError('Invalid document parameters');
    return;
  }

  try {
    showLoading();

    // Fetch document metadata
    const document = await getDocument(documentId);

    // Get file URL
    const fileURL = await getFileURL(document.storagePath);

    // Hide loading
    viewerLoading.hidden = true;

    // Initialize appropriate viewer based on type
    switch (documentType) {
      case 'pdf':
        pdfViewer.hidden = false;
        await initPDFViewer(fileURL, document);
        break;

      case 'md':
        markdownViewer.hidden = false;
        await initMarkdownViewer(fileURL, document);
        break;

      case 'epub':
        epubViewer.hidden = false;
        await initEPUBViewer(fileURL, document);
        break;

      case 'cbz':
      case 'cbr':
        comicViewer.hidden = false;
        await initComicViewer(fileURL, document);
        break;

      default:
        showError(`Unsupported document type: ${documentType}`);
        return;
    }

    // Set up keyboard navigation
    setupKeyboardNav(documentType);

  } catch (error) {
    console.error('Viewer initialization error:', error);
    showError(`Failed to load document: ${error.message}`);
  }
}

/**
 * Show loading state
 */
function showLoading() {
  viewerLoading.hidden = false;
  viewerError.hidden = true;
}

/**
 * Show error state
 * @param {string} message - Error message
 */
function showError(message) {
  viewerLoading.hidden = true;
  viewerError.hidden = false;
  viewerErrorMessage.textContent = message;
}

// Initialize on load
init();
