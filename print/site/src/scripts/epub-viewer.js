// EPUB viewer using epub.js
import ePub from 'epubjs';

let book = null;
let rendition = null;

/**
 * Initialize EPUB viewer
 * @param {string} fileURL - EPUB file URL
 * @param {Object} document - Document metadata
 */
export async function initEPUBViewer(fileURL, document) {
  try {
    // Set title
    document.getElementById('epubTitle').textContent = document.name;

    // Load EPUB
    book = ePub(fileURL);
    const epubArea = document.getElementById('epubArea');

    // Render book
    rendition = book.renderTo(epubArea, {
      width: '100%',
      height: '100%',
      spread: 'none',
    });

    await rendition.display();

    // Set up controls
    setupEPUBControls();

    // Load table of contents
    await loadTableOfContents();
  } catch (error) {
    console.error('EPUB loading error:', error);
    throw error;
  }
}

/**
 * Set up EPUB controls
 */
function setupEPUBControls() {
  document.getElementById('epubPrevPage').addEventListener('click', () => {
    rendition.prev();
    updateProgress();
  });

  document.getElementById('epubNextPage').addEventListener('click', () => {
    rendition.next();
    updateProgress();
  });

  document.getElementById('epubTocToggle').addEventListener('click', () => {
    const toc = document.getElementById('epubToc');
    toc.hidden = !toc.hidden;
  });

  // Update progress on page change
  rendition.on('relocated', () => {
    updateProgress();
  });
}

/**
 * Load and render table of contents
 */
async function loadTableOfContents() {
  try {
    const navigation = await book.loaded.navigation;
    const tocNav = document.getElementById('epubTocNav');
    tocNav.innerHTML = '';

    navigation.toc.forEach((chapter) => {
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = chapter.label;
      link.onclick = (e) => {
        e.preventDefault();
        rendition.display(chapter.href);
      };
      tocNav.appendChild(link);
    });
  } catch (error) {
    console.error('TOC loading error:', error);
  }
}

/**
 * Update progress display
 */
function updateProgress() {
  const location = rendition.currentLocation();
  if (location && location.start) {
    const progress = Math.round(location.start.percentage * 100);
    document.getElementById('epubProgress').textContent = `${progress}%`;
  }
}

/**
 * Navigate to next page (keyboard shortcut)
 */
export function epubNextPage() {
  if (rendition) {
    rendition.next();
    updateProgress();
  }
}

/**
 * Navigate to previous page (keyboard shortcut)
 */
export function epubPrevPage() {
  if (rendition) {
    rendition.prev();
    updateProgress();
  }
}
