// Keyboard navigation for viewers
import { pdfNextPage, pdfPrevPage } from './pdf-viewer.js';
import { epubNextPage, epubPrevPage } from './epub-viewer.js';
import { comicNextPage, comicPrevPage } from './comic-viewer.js';

let currentType = null;

/**
 * Set up keyboard navigation
 * @param {string} documentType - Document type
 */
export function setupKeyboardNav(documentType) {
  currentType = documentType;

  document.addEventListener('keydown', handleKeyPress);
}

/**
 * Handle key press events
 * @param {KeyboardEvent} event - Keyboard event
 */
function handleKeyPress(event) {
  // Ignore if user is typing in an input
  if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
    return;
  }

  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault();
      navigatePrevious();
      break;

    case 'ArrowRight':
      event.preventDefault();
      navigateNext();
      break;

    case 'Escape':
      event.preventDefault();
      window.location.href = 'index.html';
      break;
  }
}

/**
 * Navigate to next page/section
 */
function navigateNext() {
  switch (currentType) {
    case 'pdf':
      pdfNextPage();
      break;
    case 'epub':
      epubNextPage();
      break;
    case 'cbz':
    case 'cbr':
      comicNextPage();
      break;
  }
}

/**
 * Navigate to previous page/section
 */
function navigatePrevious() {
  switch (currentType) {
    case 'pdf':
      pdfPrevPage();
      break;
    case 'epub':
      epubPrevPage();
      break;
    case 'cbz':
    case 'cbr':
      comicPrevPage();
      break;
  }
}
